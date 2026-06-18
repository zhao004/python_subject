"""数据库连接、建表和会话依赖。"""

from collections.abc import Generator
import re

from fastapi import Request
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, Session

from app.config import MySQLSettings

MYSQL_DRIVER = "mysql+pymysql"
MYSQL_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_]+$")


class Base(DeclarativeBase):
    """SQLAlchemy 声明式基类。"""


def build_mysql_url(settings: MySQLSettings, *, include_database: bool = True) -> URL:
    """构建 MySQL SQLAlchemy 连接地址。

    Args:
        settings: MySQL 配置。
        include_database: 是否包含目标数据库名，创建数据库前需先连服务器。

    Returns:
        SQLAlchemy URL 对象，密码等特殊字符由 SQLAlchemy 负责转义。
    """

    return URL.create(
        MYSQL_DRIVER,
        username=settings.user,
        password=settings.password,
        host=settings.host,
        port=settings.port,
        database=settings.database if include_database else None,
        query={"charset": settings.charset},
    )


def build_engine(database_url: str | URL) -> Engine:
    """创建数据库引擎。

    Args:
        database_url: SQLAlchemy 数据库连接地址。

    Returns:
        可供 FastAPI 生命周期和请求依赖复用的数据库引擎。
    """

    database_url_text = str(database_url)
    connect_args = {"check_same_thread": False} if database_url_text.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)


def validate_mysql_token(value: str, label: str) -> None:
    """校验 MySQL 字符集和排序规则名称，避免拼接 DDL 时注入非法内容。

    Args:
        value: 待校验的名称。
        label: 错误提示使用的字段名。
    """

    if not MYSQL_TOKEN_PATTERN.fullmatch(value):
        raise ValueError(f"{label} 只能包含字母、数字和下划线")


def ensure_mysql_database(settings: MySQLSettings) -> None:
    """确保目标 MySQL 数据库存在。

    Args:
        settings: MySQL 配置。
    """

    validate_mysql_token(settings.charset, "MYSQL_CHARSET")
    validate_mysql_token(settings.collation, "MYSQL_COLLATION")
    server_engine = build_engine(build_mysql_url(settings, include_database=False))
    quoted_database = server_engine.dialect.identifier_preparer.quote(settings.database)
    create_database_sql = (
        f"CREATE DATABASE IF NOT EXISTS {quoted_database} "
        f"CHARACTER SET {settings.charset} COLLATE {settings.collation}"
    )
    try:
        with server_engine.begin() as connection:
            connection.execute(text(create_database_sql))
    finally:
        server_engine.dispose()


def init_database(engine: Engine, *, sync_schema: bool = True) -> None:
    """初始化数据库表结构。

    Args:
        engine: 已创建的数据库引擎。
        sync_schema: 是否同步已有表结构。
    """

    Base.metadata.create_all(bind=engine)
    if sync_schema and engine.dialect.name == "mysql":
        from app.schema_sync import sync_mysql_schema

        sync_mysql_schema(engine, Base.metadata)


def get_db_session(request: Request) -> Generator[Session, None, None]:
    """为单个请求提供数据库会话。

    Args:
        request: FastAPI 请求对象，从应用状态中获取引擎。

    Yields:
        当前请求独占的 SQLAlchemy 会话。
    """

    with Session(request.app.state.engine) as session:
        yield session
