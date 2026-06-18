"""应用时间工具测试。"""

from datetime import datetime, timedelta, timezone

from app.time_utils import APP_TIMEZONE, convert_storage_time_to_app_timezone, storage_now


def test_storage_now_uses_utc_timezone() -> None:
    """数据库写入时间应使用 UTC，避免 MySQL 丢失时区后混淆本地墙钟时间。"""

    current_time = storage_now()

    assert current_time.utcoffset() == timedelta(0)


def test_naive_storage_time_is_converted_from_utc_to_utc8() -> None:
    """数据库读出的无时区时间应按 UTC 解释，再转换为 UTC+8。"""

    storage_time = datetime(2026, 6, 18, 13, 47, 53)

    app_time = convert_storage_time_to_app_timezone(storage_time)

    assert app_time == datetime(2026, 6, 18, 21, 47, 53, tzinfo=APP_TIMEZONE)


def test_aware_storage_time_is_converted_to_utc8() -> None:
    """带时区时间应按真实瞬时时间转换，而不是直接替换时区。"""

    storage_time = datetime(2026, 6, 18, 13, 47, 53, tzinfo=timezone.utc)

    app_time = convert_storage_time_to_app_timezone(storage_time)

    assert app_time == datetime(2026, 6, 18, 21, 47, 53, tzinfo=APP_TIMEZONE)
