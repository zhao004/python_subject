"""数据库模型。"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.time_utils import storage_now


class QuestionBank(Base):
    """题库配置。

    题库是公开访问、题目、排行榜和访问统计的隔离边界。
    """

    __tablename__ = "question_banks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1", index=True
    )
    leaderboard_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=10, server_default="10")
    submission_style: Mapped[str] = mapped_column(
        String(40), nullable=False, default="classic", server_default="classic"
    )
    announcement: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=storage_now,
        onupdate=storage_now,
    )

    question_items: Mapped[list["QuestionItem"]] = relationship(
        back_populates="question_bank",
        cascade="all, delete-orphan",
        order_by="QuestionItem.sort_order",
    )
    score_records: Mapped[list["ScoreRecord"]] = relationship(
        back_populates="question_bank",
        cascade="all, delete-orphan",
    )
    submission_logs: Mapped[list["SubmissionLog"]] = relationship(
        back_populates="question_bank",
        cascade="all, delete-orphan",
    )


class QuestionItem(Base):
    """题库中的一组配对题。"""

    __tablename__ = "question_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_bank_id: Mapped[int] = mapped_column(
        ForeignKey("question_banks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    left_text: Mapped[str] = mapped_column(String(120), nullable=False)
    right_text: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=storage_now,
        onupdate=storage_now,
    )

    question_bank: Mapped[QuestionBank] = relationship(back_populates="question_items")


class ScoreRecord(Base):
    """题库内学生最佳成绩记录。

    同一题库内按班级和学号唯一定位，只保存当前最佳成绩，避免自动提交刷榜。
    """

    __tablename__ = "leaderboard_records"
    __table_args__ = (
        UniqueConstraint(
            "question_bank_id",
            "student_class",
            "student_id",
            name="uq_bank_student_best_score",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_bank_id: Mapped[int] = mapped_column(
        ForeignKey("question_banks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_class: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    student_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    student_name: Mapped[str] = mapped_column(String(40), nullable=False)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_pairs: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    elapsed_seconds: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    matched_pair_ids: Mapped[str] = mapped_column(Text, nullable=False)
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=storage_now,
        onupdate=storage_now,
    )

    question_bank: Mapped[QuestionBank] = relationship(back_populates="score_records")


class SubmissionLog(Base):
    """题库每次提交的历史流水。

    与 ScoreRecord 区别：ScoreRecord 仅保留同学生同题库的单条最佳记录，
    本表记录每一次提交快照，用于后台趋势统计和明细查看。座位由题库删除级联。
    """

    __tablename__ = "submission_logs"
    __table_args__ = (
        Index("idx_submission_log_bank_date", "question_bank_id", "submitted_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_bank_id: Mapped[int] = mapped_column(
        ForeignKey("question_banks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_class: Mapped[str] = mapped_column(String(40), nullable=False)
    student_id: Mapped[str] = mapped_column(String(40), nullable=False)
    student_name: Mapped[str] = mapped_column(String(40), nullable=False)
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_pairs: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    elapsed_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now)

    question_bank: Mapped[QuestionBank] = relationship(back_populates="submission_logs")


class SiteSetting(Base):
    """站点级设置。

    当前只需要维护主域名默认跳转题库，使用单行表比键值表更容易做类型校验。
    """

    __tablename__ = "site_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    default_question_bank_id: Mapped[int | None] = mapped_column(
        ForeignKey("question_banks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=storage_now,
        onupdate=storage_now,
    )


class AccessLog(Base):
    """公开页面访问记录。"""

    __tablename__ = "access_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_bank_id: Mapped[int | None] = mapped_column(
        ForeignKey("question_banks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    page_path: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    device: Mapped[str] = mapped_column(String(40), nullable=False)
    ip_address: Mapped[str] = mapped_column(String(45), nullable=False, index=True)
    region: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent: Mapped[str] = mapped_column(Text, nullable=False)
    visited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=storage_now, index=True)

    question_bank: Mapped[QuestionBank | None] = relationship()
