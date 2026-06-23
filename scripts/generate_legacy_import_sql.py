"""生成旧版题库与提交记录导入 SQL。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Sequence

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_QUESTION_SOURCE = ROOT_DIR / "assets" / "old_data" / "题目.txt"
DEFAULT_LEGACY_SQL_SOURCE = ROOT_DIR / "assets" / "old_data" / "旧版提交记录.sql"
DEFAULT_OUTPUT_SQL = ROOT_DIR / "assets" / "old_data" / "import_legacy_question_bank.sql"

BANK_NAME = "旧版英语配对题库"
BANK_SLUG = "legacy-english-pairs"
BANK_DESCRIPTION = "由 assets/old_data/题目.txt 和旧版提交记录.sql 迁移生成。"
BANK_LEADERBOARD_LIMIT = 10
BANK_SUBMISSION_STYLE = "classic"
BANK_ANNOUNCEMENT = ""
MAX_SCORE = 100
MAX_ELAPSED_SECONDS = 24 * 60 * 60
MAX_TEXT_LENGTH = 120
MAX_STUDENT_FIELD_LENGTH = 40
MYSQL_DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
SQL_GROUP_CONCAT_MAX_LENGTH = 10000

QUESTION_LINE_PATTERN = re.compile(
    r"^\s*(?P<order>\d+)\.\s*(?P<left>.+?)\s+[—–-]\s+(?P<right>.+?)\s*$"
)
SCORE_RECORD_INSERT_PATTERN = re.compile(
    r"INSERT\s+INTO\s+`score_records`\s*\((?P<columns>.*?)\)\s*VALUES\s*(?P<values>.*?);",
    re.IGNORECASE | re.DOTALL,
)
REQUIRED_LEGACY_COLUMNS = (
    "id",
    "student_class",
    "student_id",
    "student_name",
    "correct_count",
    "total_pairs",
    "score",
    "elapsed_seconds",
    "matched_pair_ids",
    "submitted_at",
    "created_at",
)


class LegacyImportError(ValueError):
    """旧数据无法安全转换时抛出的异常。"""


@dataclass(frozen=True)
class QuestionPair:
    """当前题库的一条配对题。"""

    old_index: int
    sort_order: int
    left_text: str
    right_text: str


@dataclass(frozen=True)
class LegacyScoreRecord:
    """旧版最佳成绩记录。"""

    legacy_id: int
    student_class: str
    student_id: str
    student_name: str
    correct_count: int
    total_pairs: int
    score: int
    elapsed_seconds: int
    matched_pair_ids: str
    submitted_at: str
    created_at: str


def read_text_file(path: Path) -> str:
    """读取 UTF-8 文本文件。

    Args:
        path: 需要读取的文件路径。

    Returns:
        文件的完整文本内容。

    Raises:
        LegacyImportError: 文件不存在或读取失败时抛出。
    """

    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise LegacyImportError(f"无法读取文件：{path}") from exc


def ensure_non_empty_text(value: str, field_name: str, max_length: int) -> str:
    """校验字符串非空并符合当前表字段长度。

    Args:
        value: 待校验文本。
        field_name: 错误信息中的字段名。
        max_length: 当前数据库字段允许的最大长度。

    Returns:
        去除首尾空白后的文本。

    Raises:
        LegacyImportError: 文本为空或超长时抛出。
    """

    normalized_value = value.strip()
    if not normalized_value:
        raise LegacyImportError(f"{field_name} 不能为空")
    if len(normalized_value) > max_length:
        raise LegacyImportError(f"{field_name} 超过 {max_length} 个字符：{normalized_value}")
    return normalized_value


def parse_question_pairs(text: str) -> list[QuestionPair]:
    """从题目文本提取配对题。

    Args:
        text: `题目.txt` 的原始内容。

    Returns:
        按原始顺序排列的配对题列表。

    Raises:
        LegacyImportError: 题目行格式、序号或字段长度不符合预期时抛出。
    """

    pairs: list[QuestionPair] = []
    for line in text.splitlines():
        match = QUESTION_LINE_PATTERN.match(line)
        if match is None:
            continue
        sort_order = int(match.group("order"))
        expected_sort_order = len(pairs) + 1
        if sort_order != expected_sort_order:
            raise LegacyImportError(f"题目序号必须连续，期望 {expected_sort_order}，实际 {sort_order}")
        left_text = ensure_non_empty_text(match.group("left"), f"第 {sort_order} 题左侧文本", MAX_TEXT_LENGTH)
        right_text = ensure_non_empty_text(match.group("right"), f"第 {sort_order} 题右侧文本", MAX_TEXT_LENGTH)
        pairs.append(
            QuestionPair(
                old_index=sort_order - 1,
                sort_order=sort_order,
                left_text=left_text,
                right_text=right_text,
            )
        )

    if not pairs:
        raise LegacyImportError("未从题目文本中解析到任何题目")
    return pairs


def parse_insert_columns(columns_sql: str) -> list[str]:
    """解析旧版 INSERT 语句中的字段名。

    Args:
        columns_sql: INSERT 字段列表 SQL 片段。

    Returns:
        字段名列表。

    Raises:
        LegacyImportError: 缺少必要字段时抛出。
    """

    columns = re.findall(r"`([^`]+)`", columns_sql)
    missing_columns = [column for column in REQUIRED_LEGACY_COLUMNS if column not in columns]
    if missing_columns:
        raise LegacyImportError(f"旧版 INSERT 缺少字段：{', '.join(missing_columns)}")
    return columns


def skip_sql_whitespace(sql: str, index: int) -> int:
    """跳过 SQL 片段中的空白字符。

    Args:
        sql: SQL 文本。
        index: 当前读取位置。

    Returns:
        第一个非空白字符的位置，或文本末尾位置。
    """

    while index < len(sql) and sql[index].isspace():
        index += 1
    return index


def parse_sql_quoted_value(sql: str, index: int) -> tuple[str, int]:
    """解析 SQL 单引号字符串。

    Args:
        sql: SQL 文本。
        index: 指向开头单引号的位置。

    Returns:
        解析后的字符串和下一个读取位置。

    Raises:
        LegacyImportError: 字符串未闭合或转义不完整时抛出。
    """

    if sql[index] != "'":
        raise LegacyImportError("内部错误：字符串解析位置不是单引号")

    index += 1
    chars: list[str] = []
    while index < len(sql):
        char = sql[index]
        if char == "'":
            if index + 1 < len(sql) and sql[index + 1] == "'":
                chars.append("'")
                index += 2
                continue
            return "".join(chars), index + 1
        if char == "\\":
            if index + 1 >= len(sql):
                raise LegacyImportError("SQL 字符串存在不完整的反斜杠转义")
            chars.append(sql[index + 1])
            index += 2
            continue
        chars.append(char)
        index += 1
    raise LegacyImportError("SQL 字符串未闭合")


def parse_sql_value(sql: str, index: int) -> tuple[str, int]:
    """解析单个 SQL 值。

    Args:
        sql: VALUES SQL 片段。
        index: 当前读取位置。

    Returns:
        值文本和下一个读取位置。

    Raises:
        LegacyImportError: 值结构不完整时抛出。
    """

    index = skip_sql_whitespace(sql, index)
    if index >= len(sql):
        raise LegacyImportError("VALUES 片段提前结束")
    if sql[index] == "'":
        value, index = parse_sql_quoted_value(sql, index)
        return value, skip_sql_whitespace(sql, index)

    start_index = index
    while index < len(sql) and sql[index] not in ",)":
        index += 1
    return sql[start_index:index].strip(), skip_sql_whitespace(sql, index)


def parse_sql_rows(values_sql: str) -> list[list[str]]:
    """解析 INSERT VALUES 中的多行值。

    Args:
        values_sql: INSERT 语句 VALUES 后面的 SQL 片段。

    Returns:
        二维值列表。

    Raises:
        LegacyImportError: 行结构不完整或分隔符异常时抛出。
    """

    rows: list[list[str]] = []
    index = 0
    while True:
        index = skip_sql_whitespace(values_sql, index)
        if index >= len(values_sql):
            break
        if values_sql[index] == ",":
            index += 1
            continue
        if values_sql[index] != "(":
            raise LegacyImportError(f"VALUES 行必须以左括号开始，位置：{index}")

        index += 1
        row: list[str] = []
        while True:
            value, index = parse_sql_value(values_sql, index)
            row.append(value)
            if index >= len(values_sql):
                raise LegacyImportError("VALUES 行未正常闭合")
            if values_sql[index] == ",":
                index += 1
                continue
            if values_sql[index] == ")":
                index += 1
                rows.append(row)
                break
            raise LegacyImportError(f"VALUES 行存在非法分隔符：{values_sql[index]}")
    return rows


def parse_int(value: str, field_name: str) -> int:
    """解析整数字段并提供明确错误信息。

    Args:
        value: 原始字段文本。
        field_name: 错误信息中的字段名。

    Returns:
        解析后的整数。

    Raises:
        LegacyImportError: 字段不是合法整数时抛出。
    """

    try:
        return int(value)
    except ValueError as exc:
        raise LegacyImportError(f"{field_name} 必须是整数：{value}") from exc


def validate_datetime(value: str, field_name: str) -> str:
    """校验 MySQL DATETIME 文本格式。

    Args:
        value: 原始时间文本。
        field_name: 错误信息中的字段名。

    Returns:
        通过校验的时间文本。

    Raises:
        LegacyImportError: 时间格式不是 MySQL DATETIME 时抛出。
    """

    try:
        datetime.strptime(value, MYSQL_DATETIME_FORMAT)
    except ValueError as exc:
        raise LegacyImportError(f"{field_name} 不是合法 DATETIME：{value}") from exc
    return value


def validate_matched_pair_ids(raw_value: str, question_count: int, legacy_id: int) -> str:
    """校验旧版正确配对索引并标准化为 JSON 文本。

    Args:
        raw_value: 旧 SQL 中保存的 JSON 数组文本。
        question_count: 当前题目数量。
        legacy_id: 旧记录 ID，用于错误定位。

    Returns:
        排序后的 JSON 数组文本。

    Raises:
        LegacyImportError: JSON 非法、索引越界或重复时抛出。
    """

    try:
        pair_ids = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise LegacyImportError(f"旧记录 {legacy_id} 的 matched_pair_ids 不是合法 JSON") from exc
    if not isinstance(pair_ids, list):
        raise LegacyImportError(f"旧记录 {legacy_id} 的 matched_pair_ids 必须是数组")

    seen_ids: set[int] = set()
    normalized_ids: list[int] = []
    for pair_id in pair_ids:
        if type(pair_id) is not int:
            raise LegacyImportError(f"旧记录 {legacy_id} 的配对索引必须是整数：{pair_id}")
        if pair_id < 0 or pair_id >= question_count:
            raise LegacyImportError(f"旧记录 {legacy_id} 的配对索引越界：{pair_id}")
        if pair_id in seen_ids:
            raise LegacyImportError(f"旧记录 {legacy_id} 的配对索引重复：{pair_id}")
        seen_ids.add(pair_id)
        normalized_ids.append(pair_id)
    return json.dumps(sorted(normalized_ids), ensure_ascii=False)


def validate_legacy_record(raw_record: dict[str, str], question_count: int) -> LegacyScoreRecord:
    """把旧版字段字典转换为强类型记录。

    Args:
        raw_record: 由旧 SQL INSERT 行解析出的字段字典。
        question_count: 当前题目数量，用于边界校验。

    Returns:
        校验后的旧版成绩记录。

    Raises:
        LegacyImportError: 任一字段不符合当前系统约束时抛出。
    """

    legacy_id = parse_int(raw_record["id"], "旧记录 ID")
    if legacy_id <= 0:
        raise LegacyImportError(f"旧记录 ID 必须为正整数：{legacy_id}")

    student_class = ensure_non_empty_text(
        raw_record["student_class"],
        f"旧记录 {legacy_id} 的班级",
        MAX_STUDENT_FIELD_LENGTH,
    )
    student_id = ensure_non_empty_text(
        raw_record["student_id"],
        f"旧记录 {legacy_id} 的学号",
        MAX_STUDENT_FIELD_LENGTH,
    )
    student_name = ensure_non_empty_text(
        raw_record["student_name"],
        f"旧记录 {legacy_id} 的姓名",
        MAX_STUDENT_FIELD_LENGTH,
    )
    correct_count = parse_int(raw_record["correct_count"], f"旧记录 {legacy_id} 的正确数")
    total_pairs = parse_int(raw_record["total_pairs"], f"旧记录 {legacy_id} 的题目总数")
    score = parse_int(raw_record["score"], f"旧记录 {legacy_id} 的分数")
    elapsed_seconds = parse_int(raw_record["elapsed_seconds"], f"旧记录 {legacy_id} 的耗时")
    matched_pair_ids = validate_matched_pair_ids(raw_record["matched_pair_ids"], question_count, legacy_id)
    submitted_at = validate_datetime(raw_record["submitted_at"], f"旧记录 {legacy_id} 的提交时间")
    created_at = validate_datetime(raw_record["created_at"], f"旧记录 {legacy_id} 的创建时间")

    matched_count = len(json.loads(matched_pair_ids))
    expected_score = round(matched_count * MAX_SCORE / question_count)
    if total_pairs != question_count:
        raise LegacyImportError(f"旧记录 {legacy_id} 的题目总数 {total_pairs} 与题库题目数 {question_count} 不一致")
    if correct_count != matched_count:
        raise LegacyImportError(f"旧记录 {legacy_id} 的正确数 {correct_count} 与配对数量 {matched_count} 不一致")
    if score != expected_score:
        raise LegacyImportError(f"旧记录 {legacy_id} 的分数 {score} 与正确数推导分数 {expected_score} 不一致")
    if elapsed_seconds < 0 or elapsed_seconds > MAX_ELAPSED_SECONDS:
        raise LegacyImportError(f"旧记录 {legacy_id} 的耗时越界：{elapsed_seconds}")

    return LegacyScoreRecord(
        legacy_id=legacy_id,
        student_class=student_class,
        student_id=student_id,
        student_name=student_name,
        correct_count=correct_count,
        total_pairs=total_pairs,
        score=score,
        elapsed_seconds=elapsed_seconds,
        matched_pair_ids=matched_pair_ids,
        submitted_at=submitted_at,
        created_at=created_at,
    )


def parse_legacy_records(sql_text: str, question_count: int) -> list[LegacyScoreRecord]:
    """从旧 SQL dump 解析所有旧版成绩记录。

    Args:
        sql_text: `旧版提交记录.sql` 的完整文本。
        question_count: 当前题目数量。

    Returns:
        按旧记录 ID 升序排列的记录列表。

    Raises:
        LegacyImportError: 未找到 INSERT、字段异常或旧 ID 重复时抛出。
    """

    matches = list(SCORE_RECORD_INSERT_PATTERN.finditer(sql_text))
    if not matches:
        raise LegacyImportError("旧 SQL 中未找到 score_records 的 INSERT 数据")

    records: list[LegacyScoreRecord] = []
    seen_legacy_ids: set[int] = set()
    for match in matches:
        columns = parse_insert_columns(match.group("columns"))
        for values in parse_sql_rows(match.group("values")):
            if len(values) != len(columns):
                raise LegacyImportError(f"旧 SQL 行字段数量不匹配，期望 {len(columns)}，实际 {len(values)}")
            raw_record = dict(zip(columns, values, strict=True))
            record = validate_legacy_record(raw_record, question_count)
            if record.legacy_id in seen_legacy_ids:
                raise LegacyImportError(f"旧记录 ID 重复：{record.legacy_id}")
            seen_legacy_ids.add(record.legacy_id)
            records.append(record)

    if not records:
        raise LegacyImportError("旧 SQL 中没有可导入的 score_records 数据")
    return sorted(records, key=lambda item: item.legacy_id)


def sql_string(value: str) -> str:
    """把普通文本转换为 MySQL 字符串字面量。

    Args:
        value: 需要写入 SQL 的文本。

    Returns:
        已转义的 MySQL 单引号字符串。
    """

    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def build_tuple_rows(rows: Sequence[Sequence[object]]) -> str:
    """把二维数据转换为 INSERT VALUES 片段。

    Args:
        rows: 需要渲染为 SQL tuple 的二维数据。

    Returns:
        可拼接到 INSERT VALUES 后的 SQL 片段。
    """

    rendered_rows: list[str] = []
    for row in rows:
        rendered_values = [str(value) if isinstance(value, int) else sql_string(str(value)) for value in row]
        rendered_rows.append("(" + ", ".join(rendered_values) + ")")
    return ",\n".join(rendered_rows)


def build_import_sql(question_pairs: Sequence[QuestionPair], records: Sequence[LegacyScoreRecord]) -> str:
    """构建完整导入 SQL。

    Args:
        question_pairs: 当前题库题目。
        records: 旧版成绩记录。

    Returns:
        可直接执行的 MySQL 导入脚本文本。
    """

    generated_at = datetime.now().strftime(MYSQL_DATETIME_FORMAT)
    expected_question_count = len(question_pairs)
    expected_record_count = len(records)
    question_rows = [
        (pair.old_index, pair.sort_order, pair.left_text, pair.right_text)
        for pair in question_pairs
    ]
    record_rows = [
        (
            record.legacy_id,
            record.student_class,
            record.student_id,
            record.student_name,
            record.correct_count,
            record.total_pairs,
            record.score,
            record.elapsed_seconds,
            record.matched_pair_ids,
            record.submitted_at,
            record.created_at,
        )
        for record in records
    ]

    return f"""-- 旧版题库和提交记录导入脚本
-- 生成时间：{generated_at}
-- 设计意图：创建或复用 slug 为 {BANK_SLUG} 的题库，并把旧版最佳成绩绑定到当前多题库结构。
-- 异常策略：生成期已校验题目、分数、时间和索引边界；执行期通过临时校验表阻止部分导入。
-- 注意：本脚本假定当前系统表结构已由 FastAPI 应用初始化完成。

SET NAMES utf8mb4;
SET @legacy_bank_slug := {sql_string(BANK_SLUG)};
SET @legacy_import_time := NOW();
SET @legacy_expected_question_count := {expected_question_count};
SET @legacy_expected_record_count := {expected_record_count};
SET @old_group_concat_max_len := @@SESSION.group_concat_max_len;
SET SESSION group_concat_max_len = {SQL_GROUP_CONCAT_MAX_LENGTH};

START TRANSACTION;

INSERT INTO `question_banks` (
  `name`,
  `slug`,
  `description`,
  `is_active`,
  `leaderboard_limit`,
  `submission_style`,
  `announcement`,
  `created_at`,
  `updated_at`
) VALUES (
  {sql_string(BANK_NAME)},
  @legacy_bank_slug,
  {sql_string(BANK_DESCRIPTION)},
  1,
  {BANK_LEADERBOARD_LIMIT},
  {sql_string(BANK_SUBMISSION_STYLE)},
  {sql_string(BANK_ANNOUNCEMENT)},
  @legacy_import_time,
  @legacy_import_time
) ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `is_active` = VALUES(`is_active`),
  `leaderboard_limit` = VALUES(`leaderboard_limit`),
  `submission_style` = VALUES(`submission_style`),
  `announcement` = VALUES(`announcement`),
  `updated_at` = VALUES(`updated_at`);

SET @legacy_bank_id := (
  SELECT `id`
  FROM `question_banks`
  WHERE `slug` = @legacy_bank_slug
  LIMIT 1
);

DROP TEMPORARY TABLE IF EXISTS `tmp_legacy_validation_guard`;
CREATE TEMPORARY TABLE `tmp_legacy_validation_guard` (
  `id` INT NOT NULL PRIMARY KEY
) ENGINE=MEMORY;
INSERT INTO `tmp_legacy_validation_guard` (`id`) VALUES (1);

DROP TEMPORARY TABLE IF EXISTS `tmp_legacy_question_items`;
CREATE TEMPORARY TABLE `tmp_legacy_question_items` (
  `old_index` INT NOT NULL PRIMARY KEY,
  `sort_order` INT NOT NULL,
  `left_text` VARCHAR(120) NOT NULL,
  `right_text` VARCHAR(120) NOT NULL
) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4;

INSERT INTO `tmp_legacy_question_items` (
  `old_index`,
  `sort_order`,
  `left_text`,
  `right_text`
) VALUES
{build_tuple_rows(question_rows)};

INSERT INTO `question_items` (
  `question_bank_id`,
  `left_text`,
  `right_text`,
  `sort_order`,
  `created_at`,
  `updated_at`
)
SELECT
  @legacy_bank_id,
  source_items.`left_text`,
  source_items.`right_text`,
  source_items.`sort_order`,
  @legacy_import_time,
  @legacy_import_time
FROM `tmp_legacy_question_items` AS source_items
WHERE NOT EXISTS (
  SELECT 1
  FROM `question_items` AS existing_items
  WHERE existing_items.`question_bank_id` = @legacy_bank_id
    AND existing_items.`sort_order` = source_items.`sort_order`
    AND existing_items.`left_text` = source_items.`left_text`
    AND existing_items.`right_text` = source_items.`right_text`
);

SET @legacy_exact_question_count := (
  SELECT COUNT(*)
  FROM `question_items` AS current_items
  INNER JOIN `tmp_legacy_question_items` AS source_items
    ON source_items.`sort_order` = current_items.`sort_order`
   AND source_items.`left_text` = current_items.`left_text`
   AND source_items.`right_text` = current_items.`right_text`
  WHERE current_items.`question_bank_id` = @legacy_bank_id
);
SET @legacy_bank_question_count := (
  SELECT COUNT(*)
  FROM `question_items`
  WHERE `question_bank_id` = @legacy_bank_id
);

-- 若同名 slug 已绑定其他题目，触发主键冲突回滚，避免旧成绩绑定到错误题库。
INSERT INTO `tmp_legacy_validation_guard` (`id`)
SELECT 1
WHERE @legacy_exact_question_count <> @legacy_expected_question_count
   OR @legacy_bank_question_count <> @legacy_expected_question_count;

DROP TEMPORARY TABLE IF EXISTS `tmp_legacy_question_item_map`;
CREATE TEMPORARY TABLE `tmp_legacy_question_item_map` (
  `old_index` INT NOT NULL PRIMARY KEY,
  `question_item_id` INT NOT NULL
) ENGINE=MEMORY;

INSERT INTO `tmp_legacy_question_item_map` (
  `old_index`,
  `question_item_id`
)
SELECT
  source_items.`old_index`,
  MIN(current_items.`id`) AS `question_item_id`
FROM `tmp_legacy_question_items` AS source_items
INNER JOIN `question_items` AS current_items
  ON current_items.`question_bank_id` = @legacy_bank_id
 AND current_items.`sort_order` = source_items.`sort_order`
 AND current_items.`left_text` = source_items.`left_text`
 AND current_items.`right_text` = source_items.`right_text`
GROUP BY source_items.`old_index`;

SET @legacy_map_count := (
  SELECT COUNT(*)
  FROM `tmp_legacy_question_item_map`
);

-- 题目 ID 映射不完整时中断，避免 matched_pair_ids 写入不可用 ID。
INSERT INTO `tmp_legacy_validation_guard` (`id`)
SELECT 1
WHERE @legacy_map_count <> @legacy_expected_question_count;

DROP TEMPORARY TABLE IF EXISTS `tmp_legacy_score_records`;
CREATE TEMPORARY TABLE `tmp_legacy_score_records` (
  `legacy_id` INT NOT NULL PRIMARY KEY,
  `student_class` VARCHAR(40) NOT NULL,
  `student_id` VARCHAR(40) NOT NULL,
  `student_name` VARCHAR(40) NOT NULL,
  `correct_count` INT NOT NULL,
  `total_pairs` INT NOT NULL,
  `score` INT NOT NULL,
  `elapsed_seconds` INT NOT NULL,
  `matched_pair_ids` VARCHAR(255) NOT NULL,
  `submitted_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL
) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4;

INSERT INTO `tmp_legacy_score_records` (
  `legacy_id`,
  `student_class`,
  `student_id`,
  `student_name`,
  `correct_count`,
  `total_pairs`,
  `score`,
  `elapsed_seconds`,
  `matched_pair_ids`,
  `submitted_at`,
  `created_at`
) VALUES
{build_tuple_rows(record_rows)};

SET @legacy_source_record_count := (
  SELECT COUNT(*)
  FROM `tmp_legacy_score_records`
);

-- 源记录数不一致通常表示 SQL 文件被截断，直接中断事务。
INSERT INTO `tmp_legacy_validation_guard` (`id`)
SELECT 1
WHERE @legacy_source_record_count <> @legacy_expected_record_count;

DROP TEMPORARY TABLE IF EXISTS `tmp_legacy_mapped_records`;
CREATE TEMPORARY TABLE `tmp_legacy_mapped_records` (
  `legacy_id` INT NOT NULL PRIMARY KEY,
  `student_class` VARCHAR(40) NOT NULL,
  `student_id` VARCHAR(40) NOT NULL,
  `student_name` VARCHAR(40) NOT NULL,
  `correct_count` INT NOT NULL,
  `total_pairs` INT NOT NULL,
  `score` INT NOT NULL,
  `elapsed_seconds` INT NOT NULL,
  `matched_question_item_ids` VARCHAR(1024) NOT NULL,
  `submitted_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL
) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4;

INSERT INTO `tmp_legacy_mapped_records` (
  `legacy_id`,
  `student_class`,
  `student_id`,
  `student_name`,
  `correct_count`,
  `total_pairs`,
  `score`,
  `elapsed_seconds`,
  `matched_question_item_ids`,
  `submitted_at`,
  `created_at`
)
SELECT
  source_records.`legacy_id`,
  source_records.`student_class`,
  source_records.`student_id`,
  source_records.`student_name`,
  source_records.`correct_count`,
  source_records.`total_pairs`,
  source_records.`score`,
  source_records.`elapsed_seconds`,
  CONCAT(
    '[',
    COALESCE((
      SELECT GROUP_CONCAT(item_map.`question_item_id` ORDER BY item_map.`old_index` SEPARATOR ', ')
      FROM `tmp_legacy_question_item_map` AS item_map
      WHERE JSON_CONTAINS(source_records.`matched_pair_ids`, CAST(item_map.`old_index` AS CHAR), '$')
    ), ''),
    ']'
  ) AS `matched_question_item_ids`,
  source_records.`submitted_at`,
  source_records.`created_at`
FROM `tmp_legacy_score_records` AS source_records;

INSERT INTO `submission_logs` (
  `question_bank_id`,
  `student_class`,
  `student_id`,
  `student_name`,
  `correct_count`,
  `total_pairs`,
  `score`,
  `elapsed_seconds`,
  `is_manual`,
  `submitted_at`,
  `created_at`
)
SELECT
  @legacy_bank_id,
  mapped_records.`student_class`,
  mapped_records.`student_id`,
  mapped_records.`student_name`,
  mapped_records.`correct_count`,
  mapped_records.`total_pairs`,
  mapped_records.`score`,
  mapped_records.`elapsed_seconds`,
  0,
  mapped_records.`submitted_at`,
  mapped_records.`created_at`
FROM `tmp_legacy_mapped_records` AS mapped_records
WHERE NOT EXISTS (
  SELECT 1
  FROM `submission_logs` AS existing_logs
  WHERE existing_logs.`question_bank_id` = @legacy_bank_id
    AND existing_logs.`student_class` = mapped_records.`student_class`
    AND existing_logs.`student_id` = mapped_records.`student_id`
    AND existing_logs.`student_name` = mapped_records.`student_name`
    AND existing_logs.`correct_count` = mapped_records.`correct_count`
    AND existing_logs.`total_pairs` = mapped_records.`total_pairs`
    AND existing_logs.`score` = mapped_records.`score`
    AND existing_logs.`elapsed_seconds` = mapped_records.`elapsed_seconds`
    AND existing_logs.`is_manual` = 0
    AND existing_logs.`submitted_at` = mapped_records.`submitted_at`
    AND existing_logs.`created_at` = mapped_records.`created_at`
);

INSERT INTO `leaderboard_records` (
  `question_bank_id`,
  `student_class`,
  `student_id`,
  `student_name`,
  `correct_count`,
  `total_pairs`,
  `score`,
  `elapsed_seconds`,
  `matched_pair_ids`,
  `is_manual`,
  `submitted_at`,
  `created_at`,
  `updated_at`
)
SELECT
  @legacy_bank_id,
  mapped_records.`student_class`,
  mapped_records.`student_id`,
  mapped_records.`student_name`,
  mapped_records.`correct_count`,
  mapped_records.`total_pairs`,
  mapped_records.`score`,
  mapped_records.`elapsed_seconds`,
  mapped_records.`matched_question_item_ids`,
  0,
  mapped_records.`submitted_at`,
  mapped_records.`created_at`,
  mapped_records.`submitted_at`
FROM `tmp_legacy_mapped_records` AS mapped_records
ON DUPLICATE KEY UPDATE
  `student_name` = VALUES(`student_name`),
  `correct_count` = VALUES(`correct_count`),
  `total_pairs` = VALUES(`total_pairs`),
  `score` = VALUES(`score`),
  `elapsed_seconds` = VALUES(`elapsed_seconds`),
  `matched_pair_ids` = VALUES(`matched_pair_ids`),
  `is_manual` = VALUES(`is_manual`),
  `submitted_at` = VALUES(`submitted_at`),
  `created_at` = VALUES(`created_at`),
  `updated_at` = VALUES(`updated_at`);

COMMIT;

SET SESSION group_concat_max_len = @old_group_concat_max_len;

SELECT
  @legacy_bank_id AS `question_bank_id`,
  @legacy_bank_slug AS `question_bank_slug`,
  @legacy_expected_question_count AS `question_count`,
  @legacy_expected_record_count AS `legacy_record_count`;
"""


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    """解析命令行参数。

    Args:
        argv: 命令行参数列表。

    Returns:
        argparse 解析结果。
    """

    parser = argparse.ArgumentParser(description="生成旧版题库与提交记录导入 SQL")
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTION_SOURCE, help="题目文本路径")
    parser.add_argument("--legacy-sql", type=Path, default=DEFAULT_LEGACY_SQL_SOURCE, help="旧版提交 SQL 路径")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_SQL, help="输出 SQL 文件路径")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    """执行 SQL 生成流程。

    Args:
        argv: 可选命令行参数，测试时可传入。

    Returns:
        进程退出码。

    Side Effects:
        读取旧数据文件，并覆盖写入目标 SQL 文件。
    """

    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        question_text = read_text_file(args.questions)
        legacy_sql_text = read_text_file(args.legacy_sql)
        question_pairs = parse_question_pairs(question_text)
        records = parse_legacy_records(legacy_sql_text, len(question_pairs))
        import_sql = build_import_sql(question_pairs, records)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(import_sql, encoding="utf-8")
    except LegacyImportError as exc:
        print(f"生成失败：{exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"写入失败：{exc}", file=sys.stderr)
        return 1

    print(f"已生成 SQL：{args.output}")
    print(f"题目数量：{len(question_pairs)}")
    print(f"旧记录数量：{len(records)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
