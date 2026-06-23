"""应用配置和常量。"""

from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


MAX_SCORE = 100
MAX_ELAPSED_SECONDS = 24 * 60 * 60
DEFAULT_LEADERBOARD_LIMIT = 10
MAX_LEADERBOARD_LIMIT = 100
MIN_QUESTION_ITEM_COUNT = 0
MAX_QUESTION_ITEM_COUNT = 200
MAX_QUESTION_TEXT_LENGTH = 120
MAX_BANK_NAME_LENGTH = 80
MAX_BANK_DESCRIPTION_LENGTH = 500
MIN_SLUG_LENGTH = 2
MAX_SLUG_LENGTH = 60
ADMIN_SESSION_COOKIE = "quiz_admin_session"
ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60
ADMIN_SESSION_SECRET_MIN_LENGTH = 32
SUPPORTED_SUBMISSION_STYLES = ("classic", "slate", "paper")
DEFAULT_MYSQL_PORT = 3306
DEFAULT_MYSQL_CHARSET = "utf8mb4"
DEFAULT_MYSQL_COLLATION = "utf8mb4_unicode_ci"
ENV_FILE = ".env"
BOOLEAN_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
BOOLEAN_FALSE_VALUES = frozenset({"0", "false", "no", "off"})


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


@dataclass(frozen=True)
class AdminSettings:
    """后台管理员配置。

    管理员账号、密码、会话签名密钥和 Cookie 安全策略全部来自环境变量，避免在代码中固化凭据。
    """

    username: str
    password: str
    session_secret: str
    cookie_secure: bool = False


@dataclass(frozen=True)
class IpRegionSettings:
    """IP 地址库配置。

    xdb 文件可能在开发环境不存在，因此缺失时访问记录仍会保存，只是地理位置降级为未知。
    """

    xdb_path: str | None


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


def read_bool_env(name: str, default: bool = False) -> bool:
    """读取布尔环境变量。

    Args:
        name: 环境变量名称。
        default: 未配置或配置为空时使用的默认值。

    Returns:
        解析后的布尔值。

    Raises:
        AppConfigError: 变量值不是受支持的布尔文本时触发。
    """

    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    normalized_value = raw_value.strip().lower()
    if normalized_value in BOOLEAN_TRUE_VALUES:
        return True
    if normalized_value in BOOLEAN_FALSE_VALUES:
        return False
    raise AppConfigError(f"{name} 必须是布尔值：true/false、1/0、yes/no 或 on/off")


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


def load_admin_settings(env_file: str | Path = ENV_FILE) -> AdminSettings:
    """从环境变量读取后台管理员配置。

    Args:
        env_file: .env 文件路径。

    Returns:
        管理员登录和 Cookie 签名配置。
    """

    load_app_env(env_file)
    session_secret = read_required_env("ADMIN_SESSION_SECRET")
    if len(session_secret) < ADMIN_SESSION_SECRET_MIN_LENGTH:
        raise AppConfigError(
            f"ADMIN_SESSION_SECRET 长度不能少于 {ADMIN_SESSION_SECRET_MIN_LENGTH} 个字符"
        )
    return AdminSettings(
        username=read_required_env("ADMIN_USERNAME"),
        password=read_required_env("ADMIN_PASSWORD"),
        session_secret=session_secret,
        cookie_secure=read_bool_env("ADMIN_COOKIE_SECURE", default=False),
    )


def load_ip_region_settings(env_file: str | Path = ENV_FILE) -> IpRegionSettings:
    """读取 IP 地址库配置。

    Args:
        env_file: .env 文件路径。

    Returns:
        地址库路径配置；未配置时返回 None。
    """

    load_app_env(env_file)
    xdb_path = os.getenv("IP2REGION_XDB_PATH", "").strip()
    return IpRegionSettings(xdb_path=xdb_path or None)
