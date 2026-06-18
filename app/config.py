"""测验配置和应用常量。"""

from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class WordPair:
    """单词配对项，使用不可变结构避免运行时被意外改写。"""

    id: int
    english: str
    chinese: str


QUIZ_ITEMS: tuple[WordPair, ...] = (
    WordPair(0, "minimalism", "极简主义"),
    WordPair(1, "fashion icon", "时尚达人"),
    WordPair(2, "crush", "迷恋；热恋"),
    WordPair(3, "bike sharing", "共享单车"),
    WordPair(4, "lovesickness", "相思病"),
    WordPair(5, "believe it or not", "信不信由你"),
    WordPair(6, "smoky eyes", "烟熏妆"),
    WordPair(7, "AI", "人工智能"),
    WordPair(8, "display affection", "秀恩爱"),
    WordPair(9, "E-learning", "线上学习"),
    WordPair(10, "Valentine’s Day", "情人节"),
    WordPair(11, "gender", "性别"),
    WordPair(12, "gossip", "八卦"),
    WordPair(13, "blind date", "相亲"),
    WordPair(14, "online shopping", "网购"),
    WordPair(15, "on time", "按时，准时"),
    WordPair(16, "freedom", "自由"),
    WordPair(17, "lifestyle", "生活方式"),
    WordPair(18, "brand", "品牌"),
    WordPair(19, "log into", "登陆"),
)

MAX_SCORE = 100
TOTAL_PAIRS = len(QUIZ_ITEMS)
POINTS_PER_PAIR = MAX_SCORE / TOTAL_PAIRS
MAX_ELAPSED_SECONDS = 24 * 60 * 60
DEFAULT_LEADERBOARD_LIMIT = 10
MAX_LEADERBOARD_LIMIT = 100
DEFAULT_MYSQL_PORT = 3306
DEFAULT_MYSQL_CHARSET = "utf8mb4"
DEFAULT_MYSQL_COLLATION = "utf8mb4_unicode_ci"
ENV_FILE = ".env"


class AppConfigError(RuntimeError):
    """应用配置错误，启动时直接抛出以避免连接到错误数据库。"""


@dataclass(frozen=True)
class MySQLSettings:
    """MySQL 连接配置。

    字段全部来自环境变量或 .env 文件，不在代码中写入任何真实密钥。
    """

    host: str
    port: int
    user: str
    password: str
    database: str
    charset: str = DEFAULT_MYSQL_CHARSET
    collation: str = DEFAULT_MYSQL_COLLATION


def load_app_env(env_file: str | Path = ENV_FILE) -> None:
    """加载 .env 文件。

    Args:
        env_file: .env 文件路径。
    """

    load_dotenv(dotenv_path=env_file, override=False)


def read_required_env(name: str) -> str:
    """读取必填环境变量。

    Args:
        name: 环境变量名称。

    Returns:
        去除首尾空白后的变量值。

    Raises:
        AppConfigError: 变量缺失或为空时触发。
    """

    value = os.getenv(name, "").strip()
    if not value:
        raise AppConfigError(f"缺少必填环境变量：{name}")
    return value


def read_mysql_port() -> int:
    """读取并校验 MySQL 端口。"""

    raw_port = os.getenv("MYSQL_PORT", str(DEFAULT_MYSQL_PORT)).strip()
    try:
        port = int(raw_port)
    except ValueError as exc:
        raise AppConfigError("MYSQL_PORT 必须是整数") from exc
    if port < 1 or port > 65535:
        raise AppConfigError("MYSQL_PORT 必须在 1 到 65535 之间")
    return port


def load_mysql_settings(env_file: str | Path = ENV_FILE) -> MySQLSettings:
    """从 .env 或系统环境变量读取 MySQL 配置。

    Args:
        env_file: .env 文件路径。

    Returns:
        MySQL 连接配置。
    """

    load_app_env(env_file)
    return MySQLSettings(
        host=read_required_env("MYSQL_HOST"),
        port=read_mysql_port(),
        user=read_required_env("MYSQL_USER"),
        password=read_required_env("MYSQL_PASSWORD"),
        database=read_required_env("MYSQL_DATABASE"),
        charset=os.getenv("MYSQL_CHARSET", DEFAULT_MYSQL_CHARSET).strip() or DEFAULT_MYSQL_CHARSET,
        collation=os.getenv("MYSQL_COLLATION", DEFAULT_MYSQL_COLLATION).strip() or DEFAULT_MYSQL_COLLATION,
    )


