"""API 输入输出模型。"""

from datetime import datetime
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import (
    DEFAULT_LEADERBOARD_LIMIT,
    MAX_BANK_DESCRIPTION_LENGTH,
    MAX_BANK_NAME_LENGTH,
    MAX_ELAPSED_SECONDS,
    MAX_LEADERBOARD_LIMIT,
    MAX_QUESTION_ITEM_COUNT,
    MAX_QUESTION_TEXT_LENGTH,
    MAX_SCORE,
    MAX_SLUG_LENGTH,
    MIN_QUESTION_ITEM_COUNT,
    MIN_SLUG_LENGTH,
    RESERVED_PUBLIC_SLUGS,
    SUPPORTED_SUBMISSION_STYLES,
)

STUDENT_ID_LENGTH = 9
STUDENT_ID_PATTERN = re.compile(rf"^\d{{{STUDENT_ID_LENGTH}}}$")
# 兼容大小写字母/数字/下划线/连字符，长度 3-32，避免被路径参数误吞
SLUG_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,32}$")
MAX_ANNOUNCEMENT_LENGTH = 1000
MAX_BATCH_DELETE_IDS = 500


class TrimmedModel(BaseModel):
    """自动去除字符串首尾空白，降低前端输入差异带来的校验噪声。"""

    model_config = ConfigDict(str_strip_whitespace=True)


class AdminLoginRequest(TrimmedModel):
    """后台登录请求。"""

    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class AdminSessionResponse(BaseModel):
    """后台登录状态响应。"""

    authenticated: bool
    username: str | None = None


class QuestionItemInput(TrimmedModel):
    """后台维护题目输入。"""

    left_text: str = Field(min_length=1, max_length=MAX_QUESTION_TEXT_LENGTH)
    right_text: str = Field(min_length=1, max_length=MAX_QUESTION_TEXT_LENGTH)


class QuestionItemResponse(BaseModel):
    """题目响应。"""

    id: int
    left_text: str
    right_text: str
    sort_order: int


class QuestionBankPayload(TrimmedModel):
    """题库创建和更新请求。"""

    name: str = Field(min_length=1, max_length=MAX_BANK_NAME_LENGTH)
    slug: str = Field(min_length=MIN_SLUG_LENGTH, max_length=MAX_SLUG_LENGTH)
    description: str = Field(default="", max_length=MAX_BANK_DESCRIPTION_LENGTH)
    is_active: bool = True
    leaderboard_limit: int = Field(default=DEFAULT_LEADERBOARD_LIMIT, ge=1, le=MAX_LEADERBOARD_LIMIT)
    submission_style: str = "classic"
    announcement: str = Field(default="", max_length=MAX_ANNOUNCEMENT_LENGTH)
    items: list[QuestionItemInput] = Field(
        default_factory=list,
        min_length=MIN_QUESTION_ITEM_COUNT,
        max_length=MAX_QUESTION_ITEM_COUNT,
    )

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, slug: str) -> str:
        """校验题库链接标识，保留大小写以便支持 6 位随机短码。"""

        if not SLUG_PATTERN.fullmatch(slug):
            raise ValueError("题库链接只能包含字母、数字、下划线和连字符，长度 3-32 位")
        if slug.lower() in RESERVED_PUBLIC_SLUGS:
            raise ValueError("题库链接不能使用系统保留路径")
        return slug

    @field_validator("submission_style")
    @classmethod
    def validate_submission_style(cls, submission_style: str) -> str:
        """校验提交页样式必须来自内置样式列表。"""

        if submission_style not in SUPPORTED_SUBMISSION_STYLES:
            raise ValueError("提交页样式不存在")
        return submission_style


class QuestionBankSummary(BaseModel):
    """题库摘要响应。"""

    id: int
    name: str
    slug: str
    description: str
    is_active: bool
    leaderboard_limit: int
    submission_style: str
    announcement: str
    item_count: int
    created_at: datetime
    updated_at: datetime


class QuestionBankDetail(QuestionBankSummary):
    """题库详情响应。"""

    items: list[QuestionItemResponse]


class SiteSettingsUpdate(BaseModel):
    """站点设置更新请求。"""

    default_question_bank_id: int | None = Field(default=None, ge=1)


class SiteSettingsResponse(BaseModel):
    """站点设置响应。"""

    default_question_bank_id: int | None
    default_question_bank_slug: str | None


class SubmissionStyleResponse(BaseModel):
    """提交页样式选项。"""

    key: str
    name: str
    description: str


class WordPairResponse(BaseModel):
    """公开答题配对项。"""

    id: int
    left_text: str
    right_text: str


class AdminOverviewStats(BaseModel):
    """后台概览页统计卡片聚合数据。

    汇总四个核心口径：题库总数、启用题库数、题目总数、近 7 天提交总数。"""

    bank_count: int
    active_bank_count: int
    total_question_count: int
    submission_count_7d: int


class SubmissionTrendPoint(BaseModel):
    """单个题库在某个日期的提交数。"""

    date: str
    bank_id: int
    bank_name: str
    count: int


class SubmissionTrendResponse(BaseModel):
    """7 天提交趋势响应。

    顶层给出日期横轴，每条题库一条序列，便于前端直接绘柱状图/折线图。"""

    dates: list[str]
    series: list[dict[str, object]]


class SubmissionLogItem(BaseModel):
    """题库提交历史单条记录。"""

    id: int
    question_bank_id: int
    student_class: str
    student_id: str
    student_name: str
    correct_count: int
    total_pairs: int
    score: int
    elapsed_seconds: int
    is_manual: bool
    submitted_at: datetime


class SubmissionLogListResponse(BaseModel):
    """题库提交历史列表响应，包含总数与明细。"""

    total: int
    entries: list[SubmissionLogItem]


class AdminBatchDeleteRequest(BaseModel):
    """后台批量删除请求，统一校验 ID 边界并去重。"""

    ids: list[int] = Field(min_length=1, max_length=MAX_BATCH_DELETE_IDS)

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, ids: list[int]) -> list[int]:
        """拒绝非法 ID，并保持原始顺序去重，避免重复计算删除数量。"""

        normalized_ids: list[int] = []
        seen_ids: set[int] = set()
        for item_id in ids:
            if item_id <= 0:
                raise ValueError("批量删除 ID 必须是正整数")
            if item_id not in seen_ids:
                normalized_ids.append(item_id)
                seen_ids.add(item_id)
        return normalized_ids


class QuizResponse(BaseModel):
    """公开测验配置响应。"""

    question_bank: QuestionBankSummary
    total_pairs: int
    max_score: int
    points_per_pair: float
    word_pairs: list[WordPairResponse]


class DefaultQuestionBankResponse(BaseModel):
    """默认题库响应。"""

    question_bank: QuestionBankSummary | None


class ScoreSubmission(TrimmedModel):
    """成绩提交请求。

    前端只提交已确认正确的配对 ID，后端会按当前题库重新计算分数。
    """

    student_class: str = Field(min_length=1, max_length=40)
    student_id: str = Field(min_length=1, max_length=40)
    student_name: str = Field(min_length=1, max_length=40)
    elapsed_seconds: int = Field(ge=0, le=MAX_ELAPSED_SECONDS)
    matched_pair_ids: list[int] = Field(default_factory=list, max_length=MAX_QUESTION_ITEM_COUNT)

    @field_validator("student_id")
    @classmethod
    def validate_student_id(cls, student_id: str) -> str:
        """校验学号必须是固定长度数字。"""

        if not STUDENT_ID_PATTERN.fullmatch(student_id):
            raise ValueError(f"学号必须是 {STUDENT_ID_LENGTH} 位数字")
        return student_id

    @field_validator("matched_pair_ids")
    @classmethod
    def validate_matched_pair_ids(cls, pair_ids: list[int]) -> list[int]:
        """校验配对 ID 唯一，归属校验交给服务层按题库处理。"""

        seen_pair_ids: set[int] = set()
        for pair_id in pair_ids:
            if pair_id < 1:
                raise ValueError(f"配对 ID 必须是正整数: {pair_id}")
            if pair_id in seen_pair_ids:
                raise ValueError(f"配对 ID 重复: {pair_id}")
            seen_pair_ids.add(pair_id)
        return pair_ids


class ScoreRecordResponse(BaseModel):
    """成绩记录响应。"""

    id: int
    question_bank_id: int
    student_class: str
    student_id: str
    student_name: str
    correct_count: int
    total_pairs: int
    score: int
    elapsed_seconds: int
    matched_pair_ids: list[int]
    is_manual: bool
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

    question_bank: QuestionBankSummary
    entries: list[LeaderboardEntry]


class AdminLeaderboardRecordPayload(TrimmedModel):
    """后台排行榜记录创建和更新请求。"""

    student_class: str = Field(min_length=1, max_length=40)
    student_id: str = Field(min_length=1, max_length=40)
    student_name: str = Field(min_length=1, max_length=40)
    correct_count: int = Field(ge=0, le=MAX_QUESTION_ITEM_COUNT)
    elapsed_seconds: int = Field(ge=0, le=MAX_ELAPSED_SECONDS)
    score: int | None = Field(default=None, ge=0, le=MAX_SCORE)

    @field_validator("student_id")
    @classmethod
    def validate_student_id(cls, student_id: str) -> str:
        """校验后台录入的学号格式，防止排行榜数据口径不一致。"""

        if not STUDENT_ID_PATTERN.fullmatch(student_id):
            raise ValueError(f"学号必须是 {STUDENT_ID_LENGTH} 位数字")
        return student_id

    @model_validator(mode="after")
    def validate_score_and_correct_count(self) -> "AdminLeaderboardRecordPayload":
        """校验管理员录入的成绩边界。"""

        if self.score is not None and self.correct_count == 0 and self.score > 0:
            raise ValueError("正确数为 0 时分数不能大于 0")
        return self


class AccessLogInput(TrimmedModel):
    """公开页面访问上报。"""

    page_path: str = Field(min_length=1, max_length=255)
    question_bank_slug: str | None = Field(default=None, min_length=MIN_SLUG_LENGTH, max_length=MAX_SLUG_LENGTH)

    @field_validator("question_bank_slug")
    @classmethod
    def validate_optional_slug(cls, slug: str | None) -> str | None:
        """校验可选题库标识。"""

        if slug is None:
            return None
        if not SLUG_PATTERN.fullmatch(slug):
            raise ValueError("题库链接格式不正确")
        return slug


class AccessLogResponse(BaseModel):
    """访问记录响应。"""

    id: int
    question_bank_id: int | None
    question_bank_name: str | None
    page_path: str
    device: str
    ip_address: str
    region: str
    user_agent: str
    visited_at: datetime


class AccessLogListResponse(BaseModel):
    """访问记录列表响应，包含总数与明细。"""

    total: int
    entries: list[AccessLogResponse]


class QuestionBankListResponse(BaseModel):
    """题库列表响应，包含总数与明细，支持后台分页。"""

    total: int
    entries: list[QuestionBankSummary]


class AdminLeaderboardListResponse(BaseModel):
    """后台排行榜列表响应，包含总数与明细，支持分页。"""

    total: int
    entries: list[LeaderboardEntry]
