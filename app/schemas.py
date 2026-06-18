"""API 输入输出模型。"""

from datetime import datetime
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import (
    MAX_ELAPSED_SECONDS,
    MAX_SCORE,
    POINTS_PER_PAIR,
    QUIZ_ITEMS,
    TOTAL_PAIRS,
)

STUDENT_ID_LENGTH = 9
STUDENT_ID_PATTERN = re.compile(rf"^\d{{{STUDENT_ID_LENGTH}}}$")


class TrimmedModel(BaseModel):
    """自动去除字符串首尾空白，降低前端输入差异带来的校验噪声。"""

    model_config = ConfigDict(str_strip_whitespace=True)


class WordPairResponse(BaseModel):
    """单个词汇配对项。"""

    id: int
    english: str
    chinese: str


class QuizResponse(BaseModel):
    """测验配置响应。"""

    total_pairs: int
    max_score: int
    points_per_pair: float
    word_pairs: list[WordPairResponse]


class ScoreSubmission(TrimmedModel):
    """成绩提交请求。

    前端只提交已确认正确的配对 ID，后端重新计算分数，避免信任客户端传来的分数字段。
    """

    student_class: str = Field(min_length=1, max_length=40)
    student_id: str = Field(min_length=1, max_length=40)
    student_name: str = Field(min_length=1, max_length=40)
    elapsed_seconds: int = Field(ge=0, le=MAX_ELAPSED_SECONDS)
    matched_pair_ids: list[int] = Field(default_factory=list, max_length=TOTAL_PAIRS)

    @field_validator("student_id")
    @classmethod
    def validate_student_id(cls, student_id: str) -> str:
        """校验学号必须是固定长度数字。

        Args:
            student_id: 已去除首尾空白的学号。

        Returns:
            合法学号。

        Raises:
            ValueError: 学号不是 9 位数字时触发。
        """

        if not STUDENT_ID_PATTERN.fullmatch(student_id):
            raise ValueError(f"学号必须是 {STUDENT_ID_LENGTH} 位数字")
        return student_id

    @field_validator("matched_pair_ids")
    @classmethod
    def validate_matched_pair_ids(cls, pair_ids: list[int]) -> list[int]:
        """校验配对 ID 的范围和唯一性。

        Args:
            pair_ids: 前端提交的正确配对 ID 列表。

        Returns:
            原始 ID 列表，顺序由服务层统一排序。

        Raises:
            ValueError: ID 越界或重复时触发。
        """

        seen_pair_ids: set[int] = set()
        valid_ids = {item.id for item in QUIZ_ITEMS}
        for pair_id in pair_ids:
            if pair_id not in valid_ids:
                raise ValueError(f"配对 ID 超出范围: {pair_id}")
            if pair_id in seen_pair_ids:
                raise ValueError(f"配对 ID 重复: {pair_id}")
            seen_pair_ids.add(pair_id)
        return pair_ids


class ScoreRecordResponse(BaseModel):
    """成绩记录响应。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    student_class: str
    student_id: str
    student_name: str
    correct_count: int
    total_pairs: int
    score: int
    elapsed_seconds: int
    matched_pair_ids: list[int]
    submitted_at: datetime


class ScoreSubmissionResponse(BaseModel):
    """成绩提交结果。"""

    saved_as_best: bool
    record: ScoreRecordResponse


class LeaderboardEntry(ScoreRecordResponse):
    """排行榜条目。"""

    rank: int


class LeaderboardResponse(BaseModel):
    """排行榜响应。"""

    entries: list[LeaderboardEntry]


def build_quiz_response() -> QuizResponse:
    """构建测验配置响应。

    Returns:
        包含词汇、满分和每题分值的测验配置。
    """

    return QuizResponse(
        total_pairs=TOTAL_PAIRS,
        max_score=MAX_SCORE,
        points_per_pair=POINTS_PER_PAIR,
        word_pairs=[
            WordPairResponse(id=item.id, english=item.english, chinese=item.chinese)
            for item in QUIZ_ITEMS
        ],
    )
