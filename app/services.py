"""成绩计算和排行榜业务逻辑。"""

import json

from sqlalchemy import Select, desc, select
from sqlalchemy.orm import Session

from app.config import POINTS_PER_PAIR, TOTAL_PAIRS
from app.models import ScoreRecord
from app.schemas import LeaderboardEntry, ScoreRecordResponse, ScoreSubmission
from app.time_utils import app_now, normalize_to_app_timezone


def calculate_score(matched_pair_ids: list[int]) -> tuple[int, int]:
    """根据正确配对 ID 计算正确数量和分数。

    Args:
        matched_pair_ids: 已通过校验的正确配对 ID。

    Returns:
        正确数量和整数分数。
    """

    correct_count = len(set(matched_pair_ids))
    score = round(correct_count * POINTS_PER_PAIR)
    return correct_count, score


def encode_pair_ids(pair_ids: list[int]) -> str:
    """序列化配对 ID，排序后保存便于比较和排查。"""

    return json.dumps(sorted(pair_ids), ensure_ascii=False)


def decode_pair_ids(pair_ids_json: str) -> list[int]:
    """反序列化配对 ID。

    Args:
        pair_ids_json: 数据库存储的 JSON 字符串。

    Returns:
        配对 ID 列表；历史脏数据解析失败时返回空列表，避免排行榜整体不可用。
    """

    try:
        value = json.loads(pair_ids_json)
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) and all(isinstance(item, int) for item in value) else []


def is_better_submission(existing: ScoreRecord, score: int, elapsed_seconds: int) -> bool:
    """判断新成绩是否应覆盖旧最佳成绩。"""

    return score > existing.score or (score == existing.score and elapsed_seconds < existing.elapsed_seconds)


def upsert_best_score(session: Session, submission: ScoreSubmission) -> tuple[ScoreRecord, bool]:
    """写入或更新学生最佳成绩。

    Args:
        session: 当前请求数据库会话。
        submission: 已通过 Pydantic 校验的提交数据。

    Returns:
        当前最佳成绩记录，以及本次提交是否被保存为最佳成绩。
    """

    correct_count, score = calculate_score(submission.matched_pair_ids)
    now = app_now()
    existing = session.scalar(
        select(ScoreRecord).where(
            ScoreRecord.student_class == submission.student_class,
            ScoreRecord.student_id == submission.student_id,
        )
    )

    if existing is None:
        record = ScoreRecord(
            student_class=submission.student_class,
            student_id=submission.student_id,
            student_name=submission.student_name,
            correct_count=correct_count,
            total_pairs=TOTAL_PAIRS,
            score=score,
            elapsed_seconds=submission.elapsed_seconds,
            matched_pair_ids=encode_pair_ids(submission.matched_pair_ids),
            submitted_at=now,
            created_at=now,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record, True

    if not is_better_submission(existing, score, submission.elapsed_seconds):
        return existing, False

    existing.student_name = submission.student_name
    existing.correct_count = correct_count
    existing.total_pairs = TOTAL_PAIRS
    existing.score = score
    existing.elapsed_seconds = submission.elapsed_seconds
    existing.matched_pair_ids = encode_pair_ids(submission.matched_pair_ids)
    existing.submitted_at = now
    session.commit()
    session.refresh(existing)
    return existing, True


def build_score_response(record: ScoreRecord) -> ScoreRecordResponse:
    """将数据库模型转换成 API 响应模型。

    数据库驱动可能丢失 DateTime 的时区信息；这里按应用时区补齐，保证接口输出稳定。
    """

    submitted_at = normalize_to_app_timezone(record.submitted_at)
    return ScoreRecordResponse(
        id=record.id,
        student_class=record.student_class,
        student_id=record.student_id,
        student_name=record.student_name,
        correct_count=record.correct_count,
        total_pairs=record.total_pairs,
        score=record.score,
        elapsed_seconds=record.elapsed_seconds,
        matched_pair_ids=decode_pair_ids(record.matched_pair_ids),
        submitted_at=submitted_at,
    )


def leaderboard_query() -> Select[tuple[ScoreRecord]]:
    """构建排行榜查询，分数优先，同分耗时短优先。"""

    return select(ScoreRecord).order_by(
        desc(ScoreRecord.score),
        ScoreRecord.elapsed_seconds.asc(),
        ScoreRecord.submitted_at.asc(),
        ScoreRecord.id.asc(),
    )


def list_leaderboard(session: Session, limit: int) -> list[LeaderboardEntry]:
    """读取排行榜。

    Args:
        session: 当前请求数据库会话。
        limit: 返回条数上限，已由 API 查询参数校验。

    Returns:
        带排名的排行榜条目。
    """

    records = session.scalars(leaderboard_query().limit(limit)).all()
    return [
        LeaderboardEntry(rank=index, **build_score_response(record).model_dump())
        for index, record in enumerate(records, start=1)
    ]
