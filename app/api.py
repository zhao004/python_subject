"""REST API 路由。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import DEFAULT_LEADERBOARD_LIMIT, MAX_LEADERBOARD_LIMIT
from app.database import get_db_session
from app.schemas import (
    LeaderboardResponse,
    QuizResponse,
    ScoreSubmission,
    ScoreSubmissionResponse,
    build_quiz_response,
)
from app.services import build_score_response, list_leaderboard, upsert_best_score

router = APIRouter(prefix="/api")
SessionDep = Annotated[Session, Depends(get_db_session)]


@router.get("/quiz", response_model=QuizResponse)
def read_quiz() -> QuizResponse:
    """返回测验配置。"""

    return build_quiz_response()


@router.post("/scores", response_model=ScoreSubmissionResponse, status_code=201)
def submit_score(submission: ScoreSubmission, session: SessionDep) -> ScoreSubmissionResponse:
    """提交成绩并维护最佳记录。"""

    try:
        record, saved_as_best = upsert_best_score(session, submission)
        response_record = build_score_response(record)
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail="成绩保存失败，请稍后重试") from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="成绩数据异常，请联系管理员") from exc

    return ScoreSubmissionResponse(
        saved_as_best=saved_as_best,
        record=response_record,
    )


@router.get("/leaderboard", response_model=LeaderboardResponse)
def read_leaderboard(
        session: SessionDep,
        limit: Annotated[
            int,
            Query(ge=1, le=MAX_LEADERBOARD_LIMIT, description="排行榜返回条数"),
        ] = DEFAULT_LEADERBOARD_LIMIT,
) -> LeaderboardResponse:
    """读取全局排行榜。"""

    try:
        entries = list_leaderboard(session, limit)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="排行榜读取失败，请稍后重试") from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="排行榜数据异常，请联系管理员") from exc
    return LeaderboardResponse(entries=entries)
