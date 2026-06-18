"""MySQL 表结构同步工具。"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Column, Engine, MetaData, Table, UniqueConstraint, inspect, text
from sqlalchemy.schema import AddConstraint, CreateColumn, CreateIndex

logger = logging.getLogger(__name__)
WHITESPACE_PATTERN = re.compile(r"\s+")


@dataclass(frozen=True)
class ColumnSyncAction:
    """字段同步动作，用于隔离差异判断和 DDL 执行。"""

    table: Table
    column: Column[Any]
    action: str


def normalize_type_sql(type_sql: str) -> str:
    """标准化类型 SQL，降低大小写和空白差异带来的误判。

    Args:
        type_sql: SQLAlchemy 编译出的类型字符串。

    Returns:
        标准化后的类型描述。
    """

    return WHITESPACE_PATTERN.sub(" ", type_sql.strip().lower())


def compiled_column_type(column: Column[Any], dialect: Any) -> str:
    """编译模型字段类型。"""

    return normalize_type_sql(column.type.compile(dialect=dialect))


def reflected_column_type(reflected_column: Mapping[str, Any], dialect: Any) -> str:
    """编译数据库中已存在字段类型。"""

    return normalize_type_sql(reflected_column["type"].compile(dialect=dialect))


def expected_nullable(column: Column[Any]) -> bool:
    """计算模型字段是否允许为空。"""

    return bool(column.nullable and not column.primary_key)


def should_modify_column(
    model_column: Column[Any],
    reflected_column: Mapping[str, Any],
    dialect: Any,
) -> bool:
    """判断已有字段是否需要按模型定义修改。

    Args:
        model_column: SQLAlchemy 模型字段。
        reflected_column: Inspector 反射出的数据库字段。
        dialect: 当前数据库方言。

    Returns:
        需要执行 MODIFY COLUMN 时返回 True。
    """

    type_changed = compiled_column_type(model_column, dialect) != reflected_column_type(
        reflected_column,
        dialect,
    )
    nullable_changed = expected_nullable(model_column) != bool(reflected_column.get("nullable", True))
    return type_changed or nullable_changed


def collect_column_sync_actions(
    table: Table,
    reflected_columns: Mapping[str, Mapping[str, Any]],
    dialect: Any,
) -> list[ColumnSyncAction]:
    """收集字段新增和修改动作。

    Args:
        table: 模型表定义。
        reflected_columns: 数据库已有字段，以字段名索引。
        dialect: 当前数据库方言。

    Returns:
        字段同步动作列表。
    """

    actions: list[ColumnSyncAction] = []
    for column in table.columns:
        reflected_column = reflected_columns.get(column.name)
        if reflected_column is None:
            actions.append(ColumnSyncAction(table=table, column=column, action="add"))
        elif should_modify_column(column, reflected_column, dialect):
            actions.append(ColumnSyncAction(table=table, column=column, action="modify"))
    return actions


def compile_column_definition(column: Column[Any], dialect: Any) -> str:
    """编译 ALTER TABLE 可复用的字段定义。"""

    return str(CreateColumn(column).compile(dialect=dialect)).strip()


def compile_column_action(action: ColumnSyncAction, dialect: Any) -> str:
    """把字段同步动作编译为 MySQL DDL。"""

    table_sql = dialect.identifier_preparer.format_table(action.table)
    column_sql = compile_column_definition(action.column, dialect)
    if action.action == "add":
        return f"ALTER TABLE {table_sql} ADD COLUMN {column_sql}"
    if action.action == "modify":
        return f"ALTER TABLE {table_sql} MODIFY COLUMN {column_sql}"
    raise ValueError(f"不支持的字段同步动作：{action.action}")


def normalize_name(name: str | None) -> str:
    """统一对象名称大小写。"""

    return (name or "").lower()


def column_names(columns: Any) -> tuple[str, ...]:
    """提取字段名称元组。"""

    return tuple(column.name for column in columns)


def sync_columns(engine: Engine, metadata: MetaData) -> None:
    """同步字段定义，不删除模型中已不存在的历史字段。"""

    inspector = inspect(engine)
    dialect = engine.dialect
    with engine.begin() as connection:
        for table in metadata.sorted_tables:
            reflected_columns = {
                column["name"]: column
                for column in inspector.get_columns(table.name, schema=table.schema)
            }
            for action in collect_column_sync_actions(table, reflected_columns, dialect):
                ddl = compile_column_action(action, dialect)
                logger.info("同步字段结构：%s", ddl)
                connection.execute(text(ddl))


def sync_unique_constraints(engine: Engine, metadata: MetaData) -> None:
    """同步模型定义中的唯一约束。"""

    inspector = inspect(engine)
    dialect = engine.dialect
    with engine.begin() as connection:
        for table in metadata.sorted_tables:
            reflected_constraints = inspector.get_unique_constraints(table.name, schema=table.schema)
            existing_names = {normalize_name(item.get("name")) for item in reflected_constraints}
            existing_columns = {tuple(item.get("column_names") or []) for item in reflected_constraints}
            for constraint in table.constraints:
                if not isinstance(constraint, UniqueConstraint):
                    continue
                constraint_columns = column_names(constraint.columns)
                if normalize_name(constraint.name) in existing_names or constraint_columns in existing_columns:
                    continue
                ddl = str(AddConstraint(constraint).compile(dialect=dialect)).strip()
                logger.info("同步唯一约束：%s", ddl)
                connection.execute(text(ddl))


def sync_indexes(engine: Engine, metadata: MetaData) -> None:
    """同步模型定义中的普通索引。"""

    inspector = inspect(engine)
    dialect = engine.dialect
    with engine.begin() as connection:
        for table in metadata.sorted_tables:
            reflected_indexes = inspector.get_indexes(table.name, schema=table.schema)
            existing_names = {normalize_name(item.get("name")) for item in reflected_indexes}
            existing_columns = {tuple(item.get("column_names") or []) for item in reflected_indexes}
            for index in table.indexes:
                index_columns = column_names(index.columns)
                if normalize_name(index.name) in existing_names or index_columns in existing_columns:
                    continue
                ddl = str(CreateIndex(index).compile(dialect=dialect)).strip()
                logger.info("同步索引：%s", ddl)
                connection.execute(text(ddl))


def sync_mysql_schema(engine: Engine, metadata: MetaData) -> None:
    """同步 MySQL 表结构。

    该函数只补齐或修改模型明确声明的结构，不删除数据库中额外存在的字段。
    """

    sync_columns(engine, metadata)
    sync_unique_constraints(engine, metadata)
    sync_indexes(engine, metadata)
