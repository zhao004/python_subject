"""应用时间工具。"""

from datetime import datetime, timedelta, timezone

APP_TIMEZONE_OFFSET_HOURS = 8
APP_TIMEZONE = timezone(timedelta(hours=APP_TIMEZONE_OFFSET_HOURS), "UTC+8")
STORAGE_TIMEZONE = timezone.utc


def storage_now() -> datetime:
    """生成数据库统一存储的 UTC 当前时间。

    Returns:
        带 UTC 时区信息的当前时间。
    """

    return datetime.now(STORAGE_TIMEZONE)


def convert_storage_time_to_app_timezone(value: datetime | str) -> datetime:
    """将数据库时间统一转换为 UTC+8。

    Args:
        value: 数据库模型中的时间字段，可能是 datetime 或 ISO 字符串；无时区值按 UTC 存储值处理。

    Returns:
        带 UTC+8 时区信息的时间。

    Raises:
        ValueError: ISO 字符串格式非法时触发。
        TypeError: 传入值不是 datetime 或字符串时触发。
    """

    if isinstance(value, str):
        parsed_datetime = datetime.fromisoformat(value)
    elif isinstance(value, datetime):
        parsed_datetime = value
    else:
        raise TypeError("时间字段必须是 datetime 或 ISO 字符串")

    if parsed_datetime.tzinfo is None or parsed_datetime.utcoffset() is None:
        parsed_datetime = parsed_datetime.replace(tzinfo=STORAGE_TIMEZONE)
    return parsed_datetime.astimezone(APP_TIMEZONE)
