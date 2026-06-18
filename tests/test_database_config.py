"""数据库配置和表结构同步测试。"""

import os
from pathlib import Path

import pytest
from sqlalchemy.dialects import mysql

from app.config import AppConfigError, MySQLSettings, load_mysql_settings
from app.database import build_mysql_url, validate_mysql_token
from app.models import ScoreRecord
from app.schema_sync import collect_column_sync_actions, expected_nullable, should_modify_column

MYSQL_ENV_NAMES = (
    "MYSQL_HOST",
    "MYSQL_PORT",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE",
    "MYSQL_CHARSET",
    "MYSQL_COLLATION",
)


def clear_mysql_env() -> None:
    """清理测试写入的 MySQL 环境变量，避免污染其他用例。"""

    for name in MYSQL_ENV_NAMES:
        os.environ.pop(name, None)


def test_load_mysql_settings_from_env_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """MySQL 配置应能从 .env 文件读取。"""

    for name in MYSQL_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "MYSQL_HOST=127.0.0.1",
                "MYSQL_PORT=3307",
                "MYSQL_USER=quiz_user",
                "MYSQL_PASSWORD=secret",
                "MYSQL_DATABASE=quiz_db",
            ]
        ),
        encoding="utf-8",
    )

    try:
        settings = load_mysql_settings(env_file)
    finally:
        clear_mysql_env()

    assert settings == MySQLSettings(
        host="127.0.0.1",
        port=3307,
        user="quiz_user",
        password="secret",
        database="quiz_db",
    )


def test_load_mysql_settings_requires_database_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """缺少必填数据库配置时应抛出明确错误。"""

    for name in MYSQL_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "MYSQL_HOST=127.0.0.1",
                "MYSQL_USER=quiz_user",
                "MYSQL_PASSWORD=secret",
            ]
        ),
        encoding="utf-8",
    )

    try:
        with pytest.raises(AppConfigError, match="MYSQL_DATABASE"):
            load_mysql_settings(env_file)
    finally:
        clear_mysql_env()


def test_build_mysql_url_preserves_special_password() -> None:
    """MySQL URL 应保留密码原值，并由 SQLAlchemy 负责安全编码。"""

    settings = MySQLSettings(
        host="db.local",
        port=3306,
        user="quiz_user",
        password="p@ ss/word",
        database="quiz_db",
    )

    url = build_mysql_url(settings)
    server_url = build_mysql_url(settings, include_database=False)

    assert url.drivername == "mysql+pymysql"
    assert url.password == "p@ ss/word"
    assert url.database == "quiz_db"
    assert url.query["charset"] == "utf8mb4"
    assert server_url.database is None


def test_validate_mysql_token_rejects_unsafe_value() -> None:
    """字符集和排序规则只允许安全 token。"""

    with pytest.raises(ValueError, match="MYSQL_CHARSET"):
        validate_mysql_token("utf8mb4;DROP", "MYSQL_CHARSET")


def test_should_modify_column_detects_type_and_nullable_changes() -> None:
    """字段同步应识别类型和可空性差异。"""

    dialect = mysql.dialect()
    student_id_column = ScoreRecord.__table__.c.student_id

    assert not should_modify_column(
        student_id_column,
        {"type": mysql.VARCHAR(length=40), "nullable": False},
        dialect,
    )
    assert should_modify_column(
        student_id_column,
        {"type": mysql.VARCHAR(length=20), "nullable": False},
        dialect,
    )
    assert should_modify_column(
        student_id_column,
        {"type": mysql.VARCHAR(length=40), "nullable": True},
        dialect,
    )


def test_collect_column_sync_actions_keeps_extra_columns() -> None:
    """同步动作只处理模型字段，数据库额外字段应被保留。"""

    dialect = mysql.dialect()
    table = ScoreRecord.__table__
    reflected_columns = {
        column.name: {"type": column.type, "nullable": expected_nullable(column)}
        for column in table.columns
        if column.name != "student_name"
    }
    reflected_columns["legacy_note"] = {"type": mysql.TEXT(), "nullable": True}

    actions = collect_column_sync_actions(table, reflected_columns, dialect)

    assert [(action.column.name, action.action) for action in actions] == [("student_name", "add")]
