"""REST API 路由。"""

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import (
    authenticate_admin,
    clear_admin_cookie,
    create_session_token,
    get_current_admin,
    read_admin_settings_or_error,
    set_admin_cookie,
    verify_session_token,
)
from app.config import ADMIN_SESSION_COOKIE, MAX_LEADERBOARD_LIMIT
from app.database import get_db_session
from app.schemas import (
    AccessLogInput,
    AccessLogListResponse,
    AdminBatchDeleteRequest,
    AdminLeaderboardListResponse,
    AdminLeaderboardRecordPayload,
    AdminLoginRequest,
    AdminOverviewStats,
    AdminSessionResponse,
    DefaultQuestionBankResponse,
    IpBlacklistItem,
    IpBlacklistListResponse,
    IpBlacklistPayload,
    LeaderboardResponse,
    QuestionBankDetail,
    QuestionBankListResponse,
    QuestionBankPayload,
    QuizResponse,
    ScoreRecordResponse,
    ScoreSubmission,
    ScoreSubmissionResponse,
    SiteSettingsResponse,
    SiteSettingsUpdate,
    SubmissionLogListResponse,
    SubmissionStyleResponse,
    SubmissionTrendResponse,
)
from app.services import (
    ServiceConflictError,
    ServiceNotFoundError,
    ServiceValidationError,
    batch_delete_access_logs,
    batch_delete_question_banks,
    batch_delete_score_records,
    batch_delete_submission_logs,
    build_leaderboard_response,
    build_question_bank_detail,
    build_quiz_response,
    build_score_response,
    create_access_log,
    create_ip_blacklist_entry,
    create_manual_score_record,
    create_question_bank,
    delete_ip_blacklist_entry,
    delete_question_bank,
    delete_score_record,
    generate_unique_random_slug,
    get_admin_overview_stats,
    get_default_question_bank,
    get_question_bank_by_id,
    get_question_bank_by_slug,
    get_site_settings,
    get_submission_trend,
    is_ip_blocked,
    list_access_logs,
    list_bank_submission_logs,
    list_ip_blacklist_entries,
    list_leaderboard_entries,
    list_question_banks,
    normalize_ip_address,
    style_options,
    update_question_bank,
    update_score_record,
    update_site_settings,
    upsert_best_score,
)

router = APIRouter(prefix="/api")
SessionDep = Annotated[Session, Depends(get_db_session)]
AdminDep = Annotated[str, Depends(get_current_admin)]
BLOCKED_IP_DETAIL = "当前 IP 已被限制访问"


def raise_http_from_service_error(exc: ValueError) -> None:
    """把业务异常转换成明确 HTTP 状态码。"""

    if isinstance(exc, ServiceNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, ServiceConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, ServiceValidationError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def client_ip_from_request(request: Request) -> str:
    """从请求头和连接信息提取客户端 IP。"""

    forwarded_for = request.headers.get("x-forwarded-for")
    direct_ip = request.client.host if request.client else None
    return normalize_ip_address(forwarded_for or direct_ip)


def reject_blacklisted_ip(request: Request, session: Session) -> str:
    """检查公开访问 IP，命中黑名单时直接拒绝请求。"""

    ip_address = client_ip_from_request(request)
    if is_ip_blocked(session, ip_address):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=BLOCKED_IP_DETAIL)
    return ip_address


def read_public_quiz_response(slug: str, session: Session) -> QuizResponse:
    """读取公开题库测验响应，供新旧公开接口复用。"""

    bank = get_question_bank_by_slug(session, slug)
    return build_quiz_response(bank)


def submit_public_score_response(
    slug: str,
    submission: ScoreSubmission,
    session: Session,
    *,
    ip_address: str,
) -> ScoreSubmissionResponse:
    """提交公开成绩响应，供新旧公开接口复用。"""

    bank = get_question_bank_by_slug(session, slug)
    record, saved_as_best = upsert_best_score(session, bank, submission, ip_address=ip_address)
    response_record = build_score_response(record)
    return ScoreSubmissionResponse(saved_as_best=saved_as_best, record=response_record)


def read_public_leaderboard_response(
    slug: str,
    session: Session,
    *,
    limit: int | None = None,
) -> LeaderboardResponse:
    """读取公开排行榜响应，供新旧公开接口复用。"""

    bank = get_question_bank_by_slug(session, slug)
    return build_leaderboard_response(session, bank, limit=limit)


@router.get("/public/default-question-bank", response_model=DefaultQuestionBankResponse)
def read_default_question_bank(request: Request, session: SessionDep) -> DefaultQuestionBankResponse:
    """读取主域名默认跳转题库。"""

    reject_blacklisted_ip(request, session)
    try:
        return get_default_question_bank(session)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="默认题库读取失败") from exc


@router.get("/public/question-banks/{slug}/quiz", response_model=QuizResponse)
def read_public_quiz(slug: str, request: Request, session: SessionDep) -> QuizResponse:
    """读取指定题库测验配置。"""

    reject_blacklisted_ip(request, session)
    try:
        return read_public_quiz_response(slug, session)
    except ValueError as exc:
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="测验数据读取失败") from exc


@router.post("/public/question-banks/{slug}/scores", response_model=ScoreSubmissionResponse, status_code=201)
def submit_public_score(
    slug: str,
    submission: ScoreSubmission,
    request: Request,
    session: SessionDep,
) -> ScoreSubmissionResponse:
    """提交指定题库成绩并维护最佳记录。"""

    ip_address = reject_blacklisted_ip(request, session)
    try:
        return submit_public_score_response(slug, submission, session, ip_address=ip_address)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="成绩保存失败，请稍后重试") from exc


@router.get("/public/question-banks/{slug}/leaderboard", response_model=LeaderboardResponse)
def read_public_leaderboard(
    slug: str,
    request: Request,
    session: SessionDep,
    limit: Annotated[int | None, Query(ge=1, le=MAX_LEADERBOARD_LIMIT)] = None,
) -> LeaderboardResponse:
    """读取指定题库公开排行榜。"""

    reject_blacklisted_ip(request, session)
    try:
        return read_public_leaderboard_response(slug, session, limit=limit)
    except ValueError as exc:
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="排行榜读取失败，请稍后重试") from exc


@router.post("/public/access-logs", status_code=204)
def write_access_log(payload: AccessLogInput, request: Request, session: SessionDep) -> Response:
    """写入公开页面访问记录。"""

    ip_address = reject_blacklisted_ip(request, session)
    user_agent = request.headers.get("user-agent", "")
    resolver = getattr(request.app.state, "ip_region_resolver", None)
    region = resolver.resolve(ip_address) if resolver is not None else None
    try:
        create_access_log(
            session,
            payload,
            raw_ip=ip_address,
            user_agent=user_agent,
            region=region,
        )
    except SQLAlchemyError:
        session.rollback()
    return Response(status_code=204)


@router.get("/quiz", response_model=QuizResponse, include_in_schema=False)
def read_legacy_quiz(request: Request, session: SessionDep) -> QuizResponse:
    """兼容旧接口：读取默认题库测验。"""

    reject_blacklisted_ip(request, session)
    default_bank = get_default_question_bank(session).question_bank
    if default_bank is None:
        raise HTTPException(status_code=404, detail="尚未配置默认题库")
    return read_public_quiz_response(default_bank.slug, session)


@router.post("/scores", response_model=ScoreSubmissionResponse, status_code=201, include_in_schema=False)
def submit_legacy_score(
    submission: ScoreSubmission,
    request: Request,
    session: SessionDep,
) -> ScoreSubmissionResponse:
    """兼容旧接口：向默认题库提交成绩。"""

    ip_address = reject_blacklisted_ip(request, session)
    default_bank = get_default_question_bank(session).question_bank
    if default_bank is None:
        raise HTTPException(status_code=404, detail="尚未配置默认题库")
    try:
        return submit_public_score_response(default_bank.slug, submission, session, ip_address=ip_address)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="成绩保存失败，请稍后重试") from exc


@router.get("/leaderboard", response_model=LeaderboardResponse, include_in_schema=False)
def read_legacy_leaderboard(request: Request, session: SessionDep) -> LeaderboardResponse:
    """兼容旧接口：读取默认题库排行榜。"""

    reject_blacklisted_ip(request, session)
    default_bank = get_default_question_bank(session).question_bank
    if default_bank is None:
        raise HTTPException(status_code=404, detail="尚未配置默认题库")
    return read_public_leaderboard_response(default_bank.slug, session)


@router.post("/admin/login", response_model=AdminSessionResponse)
def login_admin(payload: AdminLoginRequest, response: Response) -> AdminSessionResponse:
    """后台登录。"""

    settings = authenticate_admin(payload.username, payload.password)
    set_admin_cookie(response, create_session_token(settings), settings)
    return AdminSessionResponse(authenticated=True, username=settings.username)


@router.get("/admin/session", response_model=AdminSessionResponse)
def read_admin_session(
    session_token: Annotated[str | None, Cookie(alias=ADMIN_SESSION_COOKIE)] = None,
) -> AdminSessionResponse:
    """读取后台登录状态。"""

    if not session_token:
        return AdminSessionResponse(authenticated=False, username=None)
    settings = read_admin_settings_or_error()
    try:
        username = verify_session_token(session_token, settings)
    except HTTPException:
        return AdminSessionResponse(authenticated=False, username=None)
    return AdminSessionResponse(authenticated=True, username=username)


@router.post("/admin/logout", response_model=AdminSessionResponse)
def logout_admin(response: Response) -> AdminSessionResponse:
    """后台退出登录。"""

    clear_admin_cookie(response)
    return AdminSessionResponse(authenticated=False, username=None)


@router.get("/admin/submission-styles", response_model=list[SubmissionStyleResponse])
def read_submission_styles(_: AdminDep) -> list[SubmissionStyleResponse]:
    """读取内置提交页样式。"""

    return style_options()


@router.get("/admin/question-banks", response_model=QuestionBankListResponse)
def read_question_banks(
    _: AdminDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    is_active: Annotated[bool | None, Query()] = None,
) -> QuestionBankListResponse:
    """后台列出题库，支持分页、关键字搜索和启用状态筛选。"""

    try:
        return list_question_banks(
            session, limit=limit, offset=offset, search=search, is_active=is_active
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="题库读取失败") from exc


@router.post("/admin/question-banks", response_model=QuestionBankDetail, status_code=201)
def create_admin_question_bank(
    payload: QuestionBankPayload,
    _: AdminDep,
    session: SessionDep,
) -> QuestionBankDetail:
    """后台创建题库。"""

    try:
        return create_question_bank(session, payload)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="题库创建失败") from exc


@router.get("/admin/question-banks/{bank_id}", response_model=QuestionBankDetail)
def read_admin_question_bank(bank_id: int, _: AdminDep, session: SessionDep) -> QuestionBankDetail:
    """后台读取题库详情。"""

    try:
        bank = get_question_bank_by_id(session, bank_id)
        return build_question_bank_detail(bank)
    except ValueError as exc:
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="题库读取失败") from exc


@router.put("/admin/question-banks/{bank_id}", response_model=QuestionBankDetail)
def update_admin_question_bank(
    bank_id: int,
    payload: QuestionBankPayload,
    _: AdminDep,
    session: SessionDep,
) -> QuestionBankDetail:
    """后台更新题库。"""

    try:
        return update_question_bank(session, bank_id, payload)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="题库更新失败") from exc


@router.delete("/admin/question-banks/{bank_id}", status_code=204)
def delete_admin_question_bank(bank_id: int, _: AdminDep, session: SessionDep) -> Response:
    """后台删除题库。"""

    try:
        delete_question_bank(session, bank_id)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="题库删除失败") from exc
    return Response(status_code=204)


@router.post("/admin/question-banks/random-slug")
def generate_admin_slug(_: AdminDep, session: SessionDep) -> dict[str, str]:
    """生成题库专属访问链接后缀。

    返回 6 位大小写字母随机串，前端默认填入新建表单 slug 字段。
    """

    try:
        return {"slug": generate_unique_random_slug(session)}
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="短码生成失败") from exc


@router.post("/admin/question-banks/batch-delete")
def batch_delete_admin_question_banks(
    payload: AdminBatchDeleteRequest,
    _: AdminDep,
    session: SessionDep,
) -> dict[str, int]:
    """后台批量删除题库，返回实际删除条数。"""

    try:
        deleted = batch_delete_question_banks(session, payload)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="题库批量删除失败") from exc
    return {"deleted": deleted}


@router.get("/admin/overview", response_model=AdminOverviewStats)
def read_admin_overview(_: AdminDep, session: SessionDep) -> AdminOverviewStats:
    """后台概览页统计聚合。"""

    try:
        return get_admin_overview_stats(session)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="概览数据读取失败") from exc


@router.get("/admin/submission-trend", response_model=SubmissionTrendResponse)
def read_admin_submission_trend(
    _: AdminDep,
    session: SessionDep,
    bank_id: Annotated[int | None, Query(ge=1)] = None,
) -> SubmissionTrendResponse:
    """后台 7 天提交趋势统计。支持按单个题库过滤，未指定时聚合全部题库。"""

    try:
        return get_submission_trend(session, bank_ids=[bank_id] if bank_id else None)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="提交趋势读取失败") from exc


@router.get(
    "/admin/question-banks/{bank_id}/submission-logs",
    response_model=SubmissionLogListResponse,
)
def read_admin_submission_logs(
    bank_id: int,
    _: AdminDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
) -> SubmissionLogListResponse:
    """后台读取题库提交流水，支持分页和按学生姓名/学号搜索。"""

    try:
        return list_bank_submission_logs(
            session, bank_id, limit=limit, offset=offset, search=search
        )
    except ValueError as exc:
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="提交流水读取失败") from exc


@router.post("/admin/question-banks/{bank_id}/submission-logs/batch-delete")
def batch_delete_admin_submission_logs(
    bank_id: int,
    payload: AdminBatchDeleteRequest,
    _: AdminDep,
    session: SessionDep,
) -> dict[str, int]:
    """后台批量删除指定题库的提交流水，返回实际删除条数。"""

    try:
        deleted = batch_delete_submission_logs(session, bank_id, payload)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="提交流水批量删除失败") from exc
    return {"deleted": deleted}


@router.get("/admin/site-settings", response_model=SiteSettingsResponse)
def read_admin_site_settings(_: AdminDep, session: SessionDep) -> SiteSettingsResponse:
    """后台读取站点设置。"""

    try:
        return get_site_settings(session)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="站点设置读取失败") from exc


@router.put("/admin/site-settings", response_model=SiteSettingsResponse)
def update_admin_site_settings(
    payload: SiteSettingsUpdate,
    _: AdminDep,
    session: SessionDep,
) -> SiteSettingsResponse:
    """后台更新站点设置。"""

    try:
        return update_site_settings(session, payload)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="站点设置更新失败") from exc


@router.get("/admin/question-banks/{bank_id}/leaderboard", response_model=AdminLeaderboardListResponse)
def read_admin_leaderboard(
    bank_id: int,
    _: AdminDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=MAX_LEADERBOARD_LIMIT)] = MAX_LEADERBOARD_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
) -> AdminLeaderboardListResponse:
    """后台读取题库排行榜记录，支持分页和按学生姓名/学号搜索。"""

    try:
        get_question_bank_by_id(session, bank_id)
        return list_leaderboard_entries(
            session, bank_id, limit, offset=offset, search=search
        )
    except ValueError as exc:
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="排行榜读取失败") from exc


@router.post(
    "/admin/question-banks/{bank_id}/leaderboard",
    response_model=ScoreRecordResponse,
    status_code=201,
)
def create_admin_leaderboard_record(
    bank_id: int,
    payload: AdminLeaderboardRecordPayload,
    _: AdminDep,
    session: SessionDep,
) -> ScoreRecordResponse:
    """后台新增排行榜记录。"""

    try:
        bank = get_question_bank_by_id(session, bank_id)
        return create_manual_score_record(session, bank, payload)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="排行榜记录创建失败") from exc


@router.put("/admin/leaderboard-records/{record_id}", response_model=ScoreRecordResponse)
def update_admin_leaderboard_record(
    record_id: int,
    payload: AdminLeaderboardRecordPayload,
    _: AdminDep,
    session: SessionDep,
) -> ScoreRecordResponse:
    """后台更新排行榜记录。"""

    try:
        return update_score_record(session, record_id, payload)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="排行榜记录更新失败") from exc


@router.delete("/admin/leaderboard-records/{record_id}", status_code=204)
def delete_admin_leaderboard_record(record_id: int, _: AdminDep, session: SessionDep) -> Response:
    """后台删除排行榜记录。"""

    try:
        delete_score_record(session, record_id)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="排行榜记录删除失败") from exc
    return Response(status_code=204)


@router.post("/admin/leaderboard-records/batch-delete")
def batch_delete_admin_leaderboard_records(
    payload: AdminBatchDeleteRequest,
    _: AdminDep,
    session: SessionDep,
) -> dict[str, int]:
    """后台批量删除排行榜记录，返回实际删除条数。"""

    try:
        deleted = batch_delete_score_records(session, payload)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="排行榜记录批量删除失败") from exc
    return {"deleted": deleted}


@router.get("/admin/ip-blacklist", response_model=IpBlacklistListResponse)
def read_admin_ip_blacklist(
    _: AdminDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: Annotated[str | None, Query(min_length=1, max_length=255)] = None,
) -> IpBlacklistListResponse:
    """后台读取 IP 黑名单，支持分页和搜索。"""

    try:
        return list_ip_blacklist_entries(session, limit=limit, offset=offset, search=search)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="IP 黑名单读取失败") from exc


@router.post("/admin/ip-blacklist", response_model=IpBlacklistItem, status_code=201)
def create_admin_ip_blacklist_entry(
    payload: IpBlacklistPayload,
    _: AdminDep,
    session: SessionDep,
) -> IpBlacklistItem:
    """后台新增 IP 黑名单记录。"""

    try:
        return create_ip_blacklist_entry(session, payload)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="IP 黑名单保存失败") from exc


@router.delete("/admin/ip-blacklist/{entry_id}", status_code=204)
def delete_admin_ip_blacklist_entry(entry_id: int, _: AdminDep, session: SessionDep) -> Response:
    """后台解除 IP 黑名单。"""

    try:
        delete_ip_blacklist_entry(session, entry_id)
    except ValueError as exc:
        session.rollback()
        raise_http_from_service_error(exc)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="IP 黑名单删除失败") from exc
    return Response(status_code=204)


@router.get("/admin/access-logs", response_model=AccessLogListResponse)
def read_admin_access_logs(
    _: AdminDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    bank_id: Annotated[int | None, Query(ge=1)] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=255)] = None,
) -> AccessLogListResponse:
    """后台读取访问记录，支持按题库过滤、分页和搜索。"""

    try:
        return list_access_logs(
            session, limit, bank_id=bank_id, offset=offset, search=search
        )
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="访问记录读取失败") from exc


@router.post("/admin/access-logs/batch-delete")
def batch_delete_admin_access_logs(
    payload: AdminBatchDeleteRequest,
    _: AdminDep,
    session: SessionDep,
) -> dict[str, int]:
    """后台批量删除访问记录，返回实际删除条数。"""

    try:
        deleted = batch_delete_access_logs(session, payload)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="访问记录批量删除失败") from exc
    return {"deleted": deleted}
