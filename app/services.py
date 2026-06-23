"""题库、成绩、排行榜、访问日志和提交流水业务逻辑。"""

from collections.abc import Iterable
from datetime import timedelta
import ipaddress
import json
import secrets
import string

from sqlalchemy import Select, delete, desc, func, select, update
from sqlalchemy.orm import Session, selectinload

from app.config import MAX_LEADERBOARD_LIMIT, MAX_SCORE, RESERVED_PUBLIC_SLUGS
from app.models import AccessLog, QuestionBank, QuestionItem, ScoreRecord, SiteSetting, SubmissionLog
from app.schemas import (
    AccessLogInput,
    AccessLogListResponse,
    AccessLogResponse,
    AdminBatchDeleteRequest,
    AdminLeaderboardListResponse,
    AdminLeaderboardRecordPayload,
    AdminOverviewStats,
    DefaultQuestionBankResponse,
    LeaderboardEntry,
    LeaderboardResponse,
    QuestionBankDetail,
    QuestionBankListResponse,
    QuestionBankPayload,
    QuestionBankSummary,
    QuestionItemResponse,
    QuizResponse,
    ScoreRecordResponse,
    ScoreSubmission,
    SiteSettingsResponse,
    SiteSettingsUpdate,
    SubmissionLogItem,
    SubmissionLogListResponse,
    SubmissionStyleResponse,
    SubmissionTrendResponse,
    WordPairResponse,
)
from app.time_utils import convert_storage_time_to_app_timezone, storage_now

STYLE_OPTIONS = (
    SubmissionStyleResponse(
        key="classic",
        name="青绿考试",
        description="延续当前中英配对测验的沉稳风格，适合课堂测验。",
    ),
    SubmissionStyleResponse(
        key="slate",
        name="深色专注",
        description="高对比深色界面，适合投屏或低光环境。",
    ),
    SubmissionStyleResponse(
        key="paper",
        name="纸面练习",
        description="更轻的纸张质感，适合低年级或练习场景。",
    ),
)
UNKNOWN_REGION = "未知"
UNKNOWN_DEVICE = "未知设备"
FALLBACK_IP = "0.0.0.0"
SITE_SETTING_ID = 1
# 随机短码字符集：纯字母 6 位，避免与系统根路径和数字资源路径冲突。
SLUG_ALPHABET = string.ascii_letters
SLUG_RANDOM_LENGTH = 6
SLUG_RANDOM_MAX_ATTEMPTS = 10
TREND_WINDOW_DAYS = 7
ACCESS_LOG_MAX_LIMIT = 500
ADMIN_LIST_DEFAULT_PAGE_SIZE = 10
ADMIN_LIST_MAX_PAGE_SIZE = 100
ADMIN_LIST_DEFAULT_LIMIT = 100


class ServiceNotFoundError(ValueError):
    """业务资源不存在。"""


class ServiceConflictError(ValueError):
    """业务资源冲突。"""


class ServiceValidationError(ValueError):
    """业务输入未通过跨字段或跨资源校验。"""


def calculate_points_per_pair(total_pairs: int) -> float:
    """计算每题分值，空题库时返回 0，避免除零错误。"""

    return MAX_SCORE / total_pairs if total_pairs > 0 else 0.0


def calculate_score(matched_pair_ids: list[int], total_pairs: int) -> tuple[int, int]:
    """根据正确配对 ID 和题库总题数计算正确数量和分数。"""

    correct_count = len(set(matched_pair_ids))
    if total_pairs <= 0:
        return correct_count, 0
    score = round(correct_count * calculate_points_per_pair(total_pairs))
    return correct_count, score


def encode_pair_ids(pair_ids: list[int]) -> str:
    """序列化配对 ID，排序后保存便于比较和排查。"""

    return json.dumps(sorted(pair_ids), ensure_ascii=False)


def decode_pair_ids(pair_ids_json: str) -> list[int]:
    """反序列化配对 ID，历史脏数据解析失败时返回空列表。"""

    try:
        value = json.loads(pair_ids_json)
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) and all(isinstance(item, int) for item in value) else []


def style_options() -> list[SubmissionStyleResponse]:
    """返回内置提交页样式。"""

    return list(STYLE_OPTIONS)


def build_question_item_response(item: QuestionItem) -> QuestionItemResponse:
    """转换题目响应。"""

    return QuestionItemResponse(
        id=item.id,
        left_text=item.left_text,
        right_text=item.right_text,
        sort_order=item.sort_order,
    )


def build_question_bank_summary(bank: QuestionBank) -> QuestionBankSummary:
    """转换题库摘要响应。"""

    return QuestionBankSummary(
        id=bank.id,
        name=bank.name,
        slug=bank.slug,
        description=bank.description,
        is_active=bank.is_active,
        leaderboard_limit=bank.leaderboard_limit,
        submission_style=bank.submission_style,
        announcement=bank.announcement,
        item_count=len(bank.question_items),
        created_at=convert_storage_time_to_app_timezone(bank.created_at),
        updated_at=convert_storage_time_to_app_timezone(bank.updated_at),
    )


def build_question_bank_detail(bank: QuestionBank) -> QuestionBankDetail:
    """转换题库详情响应。"""

    summary = build_question_bank_summary(bank)
    return QuestionBankDetail(
        **summary.model_dump(),
        items=[build_question_item_response(item) for item in bank.question_items],
    )


def bank_query() -> Select[tuple[QuestionBank]]:
    """构建题库查询，统一预加载题目避免响应转换时重复查询。"""

    return select(QuestionBank).options(selectinload(QuestionBank.question_items))


def get_question_bank_by_id(session: Session, bank_id: int) -> QuestionBank:
    """按 ID 获取题库。"""

    bank = session.scalar(bank_query().where(QuestionBank.id == bank_id))
    if bank is None:
        raise ServiceNotFoundError("题库不存在")
    return bank


def get_question_bank_by_slug(session: Session, slug: str, *, active_only: bool = True) -> QuestionBank:
    """按专属链接标识获取题库。"""

    conditions = [QuestionBank.slug == slug]
    if active_only:
        conditions.append(QuestionBank.is_active.is_(True))
    bank = session.scalar(bank_query().where(*conditions))
    if bank is None:
        raise ServiceNotFoundError("题库不存在或已停用")
    return bank


def list_question_banks(
    session: Session,
    *,
    limit: int = ADMIN_LIST_DEFAULT_LIMIT,
    offset: int = 0,
    search: str | None = None,
    is_active: bool | None = None,
) -> QuestionBankListResponse:
    """列出后台题库，支持分页、关键字搜索和启用状态筛选。

    Args:
        session: 数据库会话。
        limit: 每页条数，默认 100，上限 100。
        offset: 偏移量，默认 0。
        search: 搜索关键字，模糊匹配题库名称和链接标识。
        is_active: 启用状态筛选，True 仅启用、False 仅停用、None 不筛选。

    Returns:
        包含总数和当前页题库摘要的响应。
    """

    safe_limit = max(1, min(limit, ADMIN_LIST_MAX_PAGE_SIZE))
    safe_offset = max(0, offset)

    conditions: list = []
    if search:
        keyword = f"%{search.strip()}%"
        conditions.append(
            (QuestionBank.name.ilike(keyword)) | (QuestionBank.slug.ilike(keyword))
        )
    if is_active is not None:
        conditions.append(QuestionBank.is_active.is_(is_active))

    base_query = bank_query()
    if conditions:
        base_query = base_query.where(*conditions)

    total = session.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    banks = session.scalars(
        base_query.order_by(QuestionBank.created_at.desc(), QuestionBank.id.desc())
        .limit(safe_limit)
        .offset(safe_offset)
    ).all()
    entries = [build_question_bank_summary(bank) for bank in banks]
    return QuestionBankListResponse(total=total, entries=entries)


def assert_slug_available(session: Session, slug: str, *, current_bank_id: int | None = None) -> None:
    """确保题库链接标识未被其他题库占用。"""

    existing = session.scalar(select(QuestionBank).where(QuestionBank.slug == slug))
    if existing is not None and existing.id != current_bank_id:
        raise ServiceConflictError("题库链接已存在")


def generate_unique_random_slug(session: Session) -> str:
    """生成 6 位大小写字母随机短码并确保库内唯一。

    冲突时重试最多 10 次，仍失败则抛业务冲突。
    """

    for _ in range(SLUG_RANDOM_MAX_ATTEMPTS):
        candidate = "".join(secrets.choice(SLUG_ALPHABET) for _ in range(SLUG_RANDOM_LENGTH))
        if candidate.lower() in RESERVED_PUBLIC_SLUGS:
            continue
        collision = session.scalar(select(QuestionBank).where(QuestionBank.slug == candidate))
        if collision is None:
            return candidate
    raise ServiceConflictError("无法生成唯一题库链接，请稍后再试")


def replace_question_items(bank: QuestionBank, items: Iterable) -> None:
    """用后台提交的题目列表替换题库题目。

    选择整体替换可以让排序和删除逻辑简单可靠；代价是更新后旧题目 ID 会失效。
    """

    bank.question_items.clear()
    for index, item in enumerate(items, start=1):
        bank.question_items.append(
            QuestionItem(
                left_text=item.left_text,
                right_text=item.right_text,
                sort_order=index,
            )
        )


def create_question_bank(session: Session, payload: QuestionBankPayload) -> QuestionBankDetail:
    """创建题库及其题目。"""

    assert_slug_available(session, payload.slug)
    now = storage_now()
    bank = QuestionBank(
        name=payload.name,
        slug=payload.slug,
        description=payload.description,
        is_active=payload.is_active,
        leaderboard_limit=payload.leaderboard_limit,
        submission_style=payload.submission_style,
        announcement=payload.announcement,
        created_at=now,
        updated_at=now,
    )
    replace_question_items(bank, payload.items)
    session.add(bank)
    session.commit()
    session.refresh(bank)
    return build_question_bank_detail(get_question_bank_by_id(session, bank.id))


def update_question_bank(session: Session, bank_id: int, payload: QuestionBankPayload) -> QuestionBankDetail:
    """更新题库及其题目。"""

    bank = get_question_bank_by_id(session, bank_id)
    assert_slug_available(session, payload.slug, current_bank_id=bank.id)
    bank.name = payload.name
    bank.slug = payload.slug
    bank.description = payload.description
    bank.is_active = payload.is_active
    bank.leaderboard_limit = payload.leaderboard_limit
    bank.submission_style = payload.submission_style
    bank.announcement = payload.announcement
    bank.updated_at = storage_now()
    replace_question_items(bank, payload.items)
    session.commit()
    return build_question_bank_detail(get_question_bank_by_id(session, bank.id))


def delete_question_bank(session: Session, bank_id: int) -> None:
    """删除题库。

    删除前先解除默认题库和访问日志引用，避免历史访问记录阻塞题库管理。
    """

    bank = get_question_bank_by_id(session, bank_id)
    settings = ensure_site_settings(session)
    if settings.default_question_bank_id == bank.id:
        settings.default_question_bank_id = None
    session.execute(update(AccessLog).where(AccessLog.question_bank_id == bank.id).values(question_bank_id=None))
    session.delete(bank)
    session.commit()


def batch_delete_question_banks(session: Session, payload: AdminBatchDeleteRequest) -> int:
    """批量删除题库，返回实际删除条数。

    复用单条删除前的默认题库与访问日志解绑逻辑，避免外键约束冲突。
    """

    settings = ensure_site_settings(session)
    deleted_count = 0
    for bank_id in payload.ids:
        bank = session.get(QuestionBank, bank_id)
        if bank is None:
            continue
        if settings.default_question_bank_id == bank.id:
            settings.default_question_bank_id = None
        session.execute(
            update(AccessLog).where(AccessLog.question_bank_id == bank.id).values(question_bank_id=None)
        )
        session.delete(bank)
        deleted_count += 1
    session.commit()
    return deleted_count


def get_admin_overview_stats(session: Session) -> AdminOverviewStats:
    """汇总概览页四张卡片所需的聚合指标。"""

    bank_count = session.scalar(select(func.count(QuestionBank.id))) or 0
    active_bank_count = session.scalar(
        select(func.count(QuestionBank.id)).where(QuestionBank.is_active.is_(True))
    ) or 0
    total_question_count = session.scalar(select(func.count(QuestionItem.id))) or 0
    threshold = storage_now() - timedelta(days=TREND_WINDOW_DAYS)
    submission_count_7d = (
        session.scalar(select(func.count(SubmissionLog.id)).where(SubmissionLog.submitted_at >= threshold)) or 0
    )
    return AdminOverviewStats(
        bank_count=bank_count,
        active_bank_count=active_bank_count,
        total_question_count=total_question_count,
        submission_count_7d=submission_count_7d,
    )


def get_submission_trend(session: Session, bank_ids: list[int] | None = None) -> SubmissionTrendResponse:
    """读取最近 7 天各题库每日提交数量，按 date → bank 聚合。

    bank_ids 传入时仅查询指定题库，否则查询全部题库。
    """

    now = storage_now()
    start = (now - timedelta(days=TREND_WINDOW_DAYS - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=TREND_WINDOW_DAYS)

    query_args = [
        SubmissionLog.submitted_at >= start,
        SubmissionLog.submitted_at < end,
    ]
    if bank_ids:
        query_args.append(SubmissionLog.question_bank_id.in_(bank_ids))

    dates: list[str] = []
    for offset in range(TREND_WINDOW_DAYS):
        day = start + timedelta(days=offset)
        dates.append(day.strftime("%Y-%m-%d"))

    bank_query_args = []
    if bank_ids:
        bank_query_args.append(QuestionBank.id.in_(bank_ids))
    bank_rows_query = select(QuestionBank.id, QuestionBank.name).order_by(
        QuestionBank.created_at.desc(),
        QuestionBank.id.desc(),
    )
    if bank_query_args:
        bank_rows_query = bank_rows_query.where(*bank_query_args)
    bank_rows = session.execute(bank_rows_query).all()
    if not bank_rows:
        return SubmissionTrendResponse(dates=dates, series=[])

    available_bank_ids = {row.id for row in bank_rows}
    if not bank_ids:
        effective_bank_ids = list(available_bank_ids)
    else:
        effective_bank_ids = [bank_id for bank_id in bank_ids if bank_id in available_bank_ids]

    grouped_rows = session.execute(
        select(
            SubmissionLog.question_bank_id,
            func.date(SubmissionLog.submitted_at).label("day"),
            func.count(SubmissionLog.id).label("count"),
        )
        .where(*query_args)
        .group_by(SubmissionLog.question_bank_id, "day")
    ).all()

    daily_map: dict[tuple[int, str], int] = {}
    for row in grouped_rows:
        day_key = row.day.strftime("%Y-%m-%d") if hasattr(row.day, "strftime") else str(row.day)
        daily_map[(row.question_bank_id, day_key)] = row.count

    series: list[dict[str, object]] = []
    for bank_row in bank_rows:
        if bank_row.id not in effective_bank_ids:
            continue
        series.append(
            {
                "bank_id": bank_row.id,
                "bank_name": bank_row.name,
                "data": [daily_map.get((bank_row.id, day), 0) for day in dates],
            }
        )

    return SubmissionTrendResponse(dates=dates, series=series)


def list_bank_submission_logs(
    session: Session,
    bank_id: int,
    *,
    limit: int = 100,
    offset: int = 0,
    search: str | None = None,
) -> SubmissionLogListResponse:
    """读取题库的提交流水，按时间倒序分页，支持按学生姓名或学号搜索。

    Args:
        session: 数据库会话。
        bank_id: 题库 ID。
        limit: 每页条数，默认 100，上限 500。
        offset: 偏移量，默认 0。
        search: 搜索关键字，模糊匹配学生姓名和学号。

    Returns:
        包含总数和当前页提交流水的响应。
    """

    bank = get_question_bank_by_id(session, bank_id)
    safe_limit = max(1, min(limit, 500))
    safe_offset = max(0, offset)

    base_conditions = [SubmissionLog.question_bank_id == bank.id]
    if search:
        keyword = f"%{search.strip()}%"
        base_conditions.append(
            (SubmissionLog.student_name.ilike(keyword))
            | (SubmissionLog.student_id.ilike(keyword))
        )

    total = (
        session.scalar(
            select(func.count(SubmissionLog.id)).where(*base_conditions)
        )
        or 0
    )
    rows = session.scalars(
        select(SubmissionLog)
        .where(*base_conditions)
        .order_by(SubmissionLog.submitted_at.desc(), SubmissionLog.id.desc())
        .limit(safe_limit)
        .offset(safe_offset)
    ).all()
    entries = [
        SubmissionLogItem(
            id=row.id,
            question_bank_id=row.question_bank_id,
            student_class=row.student_class,
            student_id=row.student_id,
            student_name=row.student_name,
            correct_count=row.correct_count,
            total_pairs=row.total_pairs,
            score=row.score,
            elapsed_seconds=row.elapsed_seconds,
            is_manual=row.is_manual,
            submitted_at=convert_storage_time_to_app_timezone(row.submitted_at),
        )
        for row in rows
    ]
    return SubmissionLogListResponse(total=total, entries=entries)


def batch_delete_submission_logs(session: Session, bank_id: int, payload: AdminBatchDeleteRequest) -> int:
    """批量删除指定题库的提交流水，按题库限定避免误删其他题库记录。"""

    get_question_bank_by_id(session, bank_id)
    result = session.execute(
        delete(SubmissionLog).where(
            SubmissionLog.question_bank_id == bank_id,
            SubmissionLog.id.in_(payload.ids),
        )
    )
    session.commit()
    return result.rowcount or 0


def ensure_site_settings(session: Session) -> SiteSetting:
    """获取或创建站点设置单行记录。"""

    settings = session.get(SiteSetting, SITE_SETTING_ID)
    if settings is None:
        settings = SiteSetting(id=SITE_SETTING_ID, default_question_bank_id=None)
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


def get_site_settings(session: Session) -> SiteSettingsResponse:
    """读取站点设置。"""

    settings = ensure_site_settings(session)
    default_bank = None
    if settings.default_question_bank_id is not None:
        default_bank = session.get(QuestionBank, settings.default_question_bank_id)
    return SiteSettingsResponse(
        default_question_bank_id=settings.default_question_bank_id if default_bank is not None else None,
        default_question_bank_slug=default_bank.slug if default_bank is not None else None,
    )


def update_site_settings(session: Session, payload: SiteSettingsUpdate) -> SiteSettingsResponse:
    """更新站点设置。"""

    settings = ensure_site_settings(session)
    if payload.default_question_bank_id is not None:
        get_question_bank_by_id(session, payload.default_question_bank_id)
    settings.default_question_bank_id = payload.default_question_bank_id
    settings.updated_at = storage_now()
    session.commit()
    return get_site_settings(session)


def get_default_question_bank(session: Session) -> DefaultQuestionBankResponse:
    """读取公开默认题库。"""

    settings = ensure_site_settings(session)
    if settings.default_question_bank_id is None:
        return DefaultQuestionBankResponse(question_bank=None)
    bank = session.scalar(
        bank_query().where(
            QuestionBank.id == settings.default_question_bank_id,
            QuestionBank.is_active.is_(True),
        )
    )
    return DefaultQuestionBankResponse(
        question_bank=build_question_bank_summary(bank) if bank is not None else None,
    )


def build_quiz_response(bank: QuestionBank) -> QuizResponse:
    """构建公开测验配置响应。"""

    total_pairs = len(bank.question_items)
    return QuizResponse(
        question_bank=build_question_bank_summary(bank),
        total_pairs=total_pairs,
        max_score=MAX_SCORE,
        points_per_pair=calculate_points_per_pair(total_pairs),
        word_pairs=[
            WordPairResponse(id=item.id, left_text=item.left_text, right_text=item.right_text)
            for item in bank.question_items
        ],
    )


def validate_submission_pair_ids(bank: QuestionBank, pair_ids: list[int]) -> None:
    """校验提交的配对 ID 是否全部属于当前题库。"""

    if not bank.question_items:
        raise ServiceValidationError("题库暂无题目，无法提交成绩")
    valid_ids = {item.id for item in bank.question_items}
    for pair_id in pair_ids:
        if pair_id not in valid_ids:
            raise ServiceValidationError(f"配对 ID 不属于当前题库: {pair_id}")


def is_better_submission(existing: ScoreRecord, score: int, elapsed_seconds: int) -> bool:
    """判断新成绩是否应覆盖旧最佳成绩。"""

    return score > existing.score or (score == existing.score and elapsed_seconds < existing.elapsed_seconds)


def _add_submission_log(
    session: Session,
    bank: QuestionBank,
    *,
    student_class: str,
    student_id: str,
    student_name: str,
    correct_count: int,
    total_pairs: int,
    score: int,
    elapsed_seconds: int,
    is_manual: bool,
) -> None:
    """写入提交流水快照（不单独提交，由调用方统一提交事务）。"""

    now = storage_now()
    session.add(
        SubmissionLog(
            question_bank_id=bank.id,
            student_class=student_class,
            student_id=student_id,
            student_name=student_name,
            correct_count=correct_count,
            total_pairs=total_pairs,
            score=score,
            elapsed_seconds=elapsed_seconds,
            is_manual=is_manual,
            submitted_at=now,
            created_at=now,
        )
    )


def upsert_best_score(
    session: Session,
    bank: QuestionBank,
    submission: ScoreSubmission,
) -> tuple[ScoreRecord, bool]:
    """写入或更新题库内学生最佳成绩，同时记录提交流水。"""

    validate_submission_pair_ids(bank, submission.matched_pair_ids)
    total_pairs = len(bank.question_items)
    correct_count, score = calculate_score(submission.matched_pair_ids, total_pairs)
    now = storage_now()
    existing = session.scalar(
        select(ScoreRecord).where(
            ScoreRecord.question_bank_id == bank.id,
            ScoreRecord.student_class == submission.student_class,
            ScoreRecord.student_id == submission.student_id,
        )
    )

    if existing is None:
        record = ScoreRecord(
            question_bank_id=bank.id,
            student_class=submission.student_class,
            student_id=submission.student_id,
            student_name=submission.student_name,
            correct_count=correct_count,
            total_pairs=total_pairs,
            score=score,
            elapsed_seconds=submission.elapsed_seconds,
            matched_pair_ids=encode_pair_ids(submission.matched_pair_ids),
            is_manual=False,
            submitted_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        _add_submission_log(
            session,
            bank,
            student_class=submission.student_class,
            student_id=submission.student_id,
            student_name=submission.student_name,
            correct_count=correct_count,
            total_pairs=total_pairs,
            score=score,
            elapsed_seconds=submission.elapsed_seconds,
            is_manual=False,
        )
        session.commit()
        session.refresh(record)
        return record, True

    if not is_better_submission(existing, score, submission.elapsed_seconds):
        _add_submission_log(
            session,
            bank,
            student_class=submission.student_class,
            student_id=submission.student_id,
            student_name=submission.student_name,
            correct_count=correct_count,
            total_pairs=total_pairs,
            score=score,
            elapsed_seconds=submission.elapsed_seconds,
            is_manual=False,
        )
        session.commit()
        return existing, False

    existing.student_name = submission.student_name
    existing.correct_count = correct_count
    existing.total_pairs = total_pairs
    existing.score = score
    existing.elapsed_seconds = submission.elapsed_seconds
    existing.matched_pair_ids = encode_pair_ids(submission.matched_pair_ids)
    existing.is_manual = False
    existing.submitted_at = now
    existing.updated_at = now
    _add_submission_log(
        session,
        bank,
        student_class=submission.student_class,
        student_id=submission.student_id,
        student_name=submission.student_name,
        correct_count=correct_count,
        total_pairs=total_pairs,
        score=score,
        elapsed_seconds=submission.elapsed_seconds,
        is_manual=False,
    )
    session.commit()
    session.refresh(existing)
    return existing, True


def build_score_response(record: ScoreRecord) -> ScoreRecordResponse:
    """将数据库成绩模型转换成 API 响应模型。"""

    return ScoreRecordResponse(
        id=record.id,
        question_bank_id=record.question_bank_id,
        student_class=record.student_class,
        student_id=record.student_id,
        student_name=record.student_name,
        correct_count=record.correct_count,
        total_pairs=record.total_pairs,
        score=record.score,
        elapsed_seconds=record.elapsed_seconds,
        matched_pair_ids=decode_pair_ids(record.matched_pair_ids),
        is_manual=record.is_manual,
        submitted_at=convert_storage_time_to_app_timezone(record.submitted_at),
    )


def list_leaderboard_entries(
    session: Session,
    bank_id: int,
    limit: int,
    *,
    offset: int = 0,
    search: str | None = None,
) -> AdminLeaderboardListResponse:
    """读取题库排行榜条目，支持分页和按学生姓名/学号搜索。

    Args:
        session: 数据库会话。
        bank_id: 题库 ID。
        limit: 每页条数，上限 100。
        offset: 偏移量，默认 0。
        search: 搜索关键字，模糊匹配学生姓名和学号。

    Returns:
        包含总数和当前页排行榜条目的响应。
    """

    safe_limit = max(1, min(limit, MAX_LEADERBOARD_LIMIT))
    safe_offset = max(0, offset)

    conditions = [ScoreRecord.question_bank_id == bank_id]
    if search:
        keyword = f"%{search.strip()}%"
        conditions.append(
            (ScoreRecord.student_name.ilike(keyword))
            | (ScoreRecord.student_id.ilike(keyword))
        )

    total = (
        session.scalar(select(func.count(ScoreRecord.id)).where(*conditions)) or 0
    )
    records = session.scalars(
        select(ScoreRecord)
        .where(*conditions)
        .order_by(
            desc(ScoreRecord.score),
            ScoreRecord.elapsed_seconds.asc(),
            ScoreRecord.submitted_at.asc(),
            ScoreRecord.id.asc(),
        )
        .limit(safe_limit)
        .offset(safe_offset)
    ).all()
    entries = [
        LeaderboardEntry(rank=safe_offset + index, **build_score_response(record).model_dump())
        for index, record in enumerate(records, start=1)
    ]
    return AdminLeaderboardListResponse(total=total, entries=entries)


def build_leaderboard_response(
    session: Session,
    bank: QuestionBank,
    *,
    limit: int | None = None,
) -> LeaderboardResponse:
    """构建公开排行榜响应，默认使用题库配置的显示条数。"""

    effective_limit = bank.leaderboard_limit if limit is None else min(limit, bank.leaderboard_limit)
    result = list_leaderboard_entries(session, bank.id, effective_limit)
    return LeaderboardResponse(
        question_bank=build_question_bank_summary(bank),
        entries=result.entries,
    )


def validate_admin_record_payload(bank: QuestionBank, payload: AdminLeaderboardRecordPayload) -> int:
    """校验后台手工排行榜记录，并返回最终分数。"""

    total_pairs = len(bank.question_items)
    if total_pairs <= 0:
        raise ServiceValidationError("题库暂无题目，无法维护排行榜记录")
    if payload.correct_count > total_pairs:
        raise ServiceValidationError("正确数不能超过题库题目数")
    derived_score = round(payload.correct_count * calculate_points_per_pair(total_pairs))
    return payload.score if payload.score is not None else derived_score


def create_manual_score_record(
    session: Session,
    bank: QuestionBank,
    payload: AdminLeaderboardRecordPayload,
) -> ScoreRecordResponse:
    """后台手工新增排行榜记录。"""

    existing = session.scalar(
        select(ScoreRecord).where(
            ScoreRecord.question_bank_id == bank.id,
            ScoreRecord.student_class == payload.student_class,
            ScoreRecord.student_id == payload.student_id,
        )
    )
    if existing is not None:
        raise ServiceConflictError("该学生在当前题库已有排行榜记录")

    total_pairs = len(bank.question_items)
    score = validate_admin_record_payload(bank, payload)
    now = storage_now()
    record = ScoreRecord(
        question_bank_id=bank.id,
        student_class=payload.student_class,
        student_id=payload.student_id,
        student_name=payload.student_name,
        correct_count=payload.correct_count,
        total_pairs=total_pairs,
        score=score,
        elapsed_seconds=payload.elapsed_seconds,
        matched_pair_ids=encode_pair_ids([]),
        is_manual=True,
        submitted_at=now,
        created_at=now,
        updated_at=now,
    )
    session.add(record)
    _add_submission_log(
        session,
        bank,
        student_class=payload.student_class,
        student_id=payload.student_id,
        student_name=payload.student_name,
        correct_count=payload.correct_count,
        total_pairs=total_pairs,
        score=score,
        elapsed_seconds=payload.elapsed_seconds,
        is_manual=True,
    )
    session.commit()
    session.refresh(record)
    return build_score_response(record)


def update_score_record(
    session: Session,
    record_id: int,
    payload: AdminLeaderboardRecordPayload,
) -> ScoreRecordResponse:
    """后台更新排行榜记录。"""

    record = session.get(ScoreRecord, record_id)
    if record is None:
        raise ServiceNotFoundError("排行榜记录不存在")
    bank = get_question_bank_by_id(session, record.question_bank_id)
    score = validate_admin_record_payload(bank, payload)
    duplicate = session.scalar(
        select(ScoreRecord).where(
            ScoreRecord.question_bank_id == record.question_bank_id,
            ScoreRecord.student_class == payload.student_class,
            ScoreRecord.student_id == payload.student_id,
            ScoreRecord.id != record.id,
        )
    )
    if duplicate is not None:
        raise ServiceConflictError("该学生在当前题库已有排行榜记录")

    record.student_class = payload.student_class
    record.student_id = payload.student_id
    record.student_name = payload.student_name
    record.correct_count = payload.correct_count
    record.total_pairs = len(bank.question_items)
    record.score = score
    record.elapsed_seconds = payload.elapsed_seconds
    record.is_manual = True
    record.updated_at = storage_now()
    session.commit()
    session.refresh(record)
    return build_score_response(record)


def delete_score_record(session: Session, record_id: int) -> None:
    """后台删除排行榜记录。"""

    record = session.get(ScoreRecord, record_id)
    if record is None:
        raise ServiceNotFoundError("排行榜记录不存在")
    session.delete(record)
    session.commit()


def batch_delete_score_records(session: Session, payload: AdminBatchDeleteRequest) -> int:
    """批量删除排行榜记录，忽略不存在的 ID 并返回实际删除数量。"""

    result = session.execute(delete(ScoreRecord).where(ScoreRecord.id.in_(payload.ids)))
    session.commit()
    return result.rowcount or 0


def normalize_ip_address(raw_ip: str | None) -> str:
    """规范化 IP 地址，非法值降级为 0.0.0.0。"""

    if not raw_ip:
        return FALLBACK_IP
    first_ip = raw_ip.split(",", maxsplit=1)[0].strip()
    try:
        return str(ipaddress.ip_address(first_ip))
    except ValueError:
        return FALLBACK_IP


def detect_device(user_agent: str) -> str:
    """根据 User-Agent 粗略识别访问设备。"""

    normalized_agent = user_agent.lower()
    if not normalized_agent:
        return UNKNOWN_DEVICE
    if "ipad" in normalized_agent or "tablet" in normalized_agent:
        return "平板设备"
    if "mobile" in normalized_agent or "iphone" in normalized_agent or "android" in normalized_agent:
        return "移动设备"
    return "桌面设备"


def create_access_log(
    session: Session,
    payload: AccessLogInput,
    *,
    raw_ip: str | None,
    user_agent: str,
    region: str | None,
) -> None:
    """保存公开页面访问记录。

    访问统计不能影响页面访问，因此上层会吞掉数据库异常并返回 204。
    """

    bank_id = None
    if payload.question_bank_slug is not None:
        bank = session.scalar(select(QuestionBank).where(QuestionBank.slug == payload.question_bank_slug))
        bank_id = bank.id if bank is not None else None
    ip_address = normalize_ip_address(raw_ip)
    log = AccessLog(
        question_bank_id=bank_id,
        page_path=payload.page_path,
        device=detect_device(user_agent),
        ip_address=ip_address,
        region=region or UNKNOWN_REGION,
        user_agent=user_agent[:1000],
        visited_at=storage_now(),
    )
    session.add(log)
    session.commit()


def build_access_log_response(log: AccessLog) -> AccessLogResponse:
    """转换访问日志响应。"""

    return AccessLogResponse(
        id=log.id,
        question_bank_id=log.question_bank_id,
        question_bank_name=log.question_bank.name if log.question_bank_id and log.question_bank else None,
        page_path=log.page_path,
        device=log.device,
        ip_address=log.ip_address,
        region=log.region,
        user_agent=log.user_agent,
        visited_at=convert_storage_time_to_app_timezone(log.visited_at),
    )


def list_access_logs(
    session: Session,
    limit: int,
    *,
    bank_id: int | None = None,
    offset: int = 0,
    search: str | None = None,
) -> AccessLogListResponse:
    """读取访问记录，按最新访问倒序返回，支持按题库过滤、分页和搜索。

    Args:
        session: 数据库会话。
        limit: 每页条数，上限 500。
        bank_id: 按题库过滤，None 表示不过滤。
        offset: 偏移量，默认 0。
        search: 搜索关键字，模糊匹配页面路径、IP 地址和地区。

    Returns:
        包含总数和当前页访问记录的响应。
    """

    safe_limit = max(1, min(limit, ACCESS_LOG_MAX_LIMIT))
    safe_offset = max(0, offset)

    conditions: list = []
    if bank_id is not None:
        conditions.append(AccessLog.question_bank_id == bank_id)
    if search:
        keyword = f"%{search.strip()}%"
        conditions.append(
            (AccessLog.page_path.ilike(keyword))
            | (AccessLog.ip_address.ilike(keyword))
            | (AccessLog.region.ilike(keyword))
        )

    base_query = select(AccessLog).options(selectinload(AccessLog.question_bank))
    if conditions:
        base_query = base_query.where(*conditions)

    total = session.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    logs = session.scalars(
        base_query.order_by(AccessLog.visited_at.desc(), AccessLog.id.desc())
        .limit(safe_limit)
        .offset(safe_offset)
    ).all()
    entries = [build_access_log_response(log) for log in logs]
    return AccessLogListResponse(total=total, entries=entries)


def batch_delete_access_logs(session: Session, payload: AdminBatchDeleteRequest) -> int:
    """批量删除访问日志，忽略不存在的 ID 并返回实际删除数量。"""

    result = session.execute(delete(AccessLog).where(AccessLog.id.in_(payload.ids)))
    session.commit()
    return result.rowcount or 0
