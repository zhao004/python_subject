"""数据库模型。"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.time_utils import storage_now


class ScoreRecord(Base):
    """学生最佳成绩记录。

    同一学生以班级和学号唯一定位，只保存当前最佳成绩，避免排行榜被重复提交刷屏。
    """

    __tablename__ = "score_records"
    __table_args__ = (UniqueConstraint("student_class", "student_id", name="uq_student_best_score"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_class: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    student_name: Mapped[str] = mapped_column(String(40), nullable=False)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_pairs: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    elapsed_seconds: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    matched_pair_ids: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now)
