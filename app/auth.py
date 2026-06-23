"""后台管理员认证工具。"""

from __future__ import annotations

from typing import Annotated
import base64
import hashlib
import hmac
import json
import time

from fastapi import Cookie, HTTPException, Response, status

from app.config import (
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_TTL_SECONDS,
    AdminSettings,
    AppConfigError,
    load_admin_settings,
)


def encode_urlsafe_json(payload: dict[str, object]) -> str:
    """将会话载荷编码为 URL 安全字符串。"""

    raw_payload = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw_payload).decode("ascii").rstrip("=")


def decode_urlsafe_json(encoded_payload: str) -> dict[str, object]:
    """解码 URL 安全 JSON 载荷。"""

    padding = "=" * (-len(encoded_payload) % 4)
    raw_payload = base64.urlsafe_b64decode(f"{encoded_payload}{padding}".encode("ascii"))
    value = json.loads(raw_payload.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("会话载荷格式不正确")
    return value


def sign_payload(encoded_payload: str, secret: str) -> str:
    """对会话载荷签名。"""

    digest = hmac.new(secret.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def create_session_token(settings: AdminSettings) -> str:
    """创建管理员会话令牌。"""

    expires_at = int(time.time()) + ADMIN_SESSION_TTL_SECONDS
    encoded_payload = encode_urlsafe_json({"sub": settings.username, "exp": expires_at})
    signature = sign_payload(encoded_payload, settings.session_secret)
    return f"{encoded_payload}.{signature}"


def verify_session_token(token: str, settings: AdminSettings) -> str:
    """校验管理员会话令牌并返回用户名。"""

    try:
        encoded_payload, signature = token.split(".", maxsplit=1)
        expected_signature = sign_payload(encoded_payload, settings.session_secret)
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("会话签名不正确")
        payload = decode_urlsafe_json(encoded_payload)
        username = payload.get("sub")
        expires_at = payload.get("exp")
        if username != settings.username or not isinstance(expires_at, int):
            raise ValueError("会话载荷不正确")
        if expires_at < int(time.time()):
            raise ValueError("会话已过期")
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="后台登录已失效") from exc
    return settings.username


def read_admin_settings_or_error() -> AdminSettings:
    """读取管理员配置，缺失时返回明确服务端错误。"""

    try:
        return load_admin_settings()
    except AppConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def authenticate_admin(username: str, password: str) -> AdminSettings:
    """校验管理员账号密码。"""

    settings = read_admin_settings_or_error()
    username_ok = hmac.compare_digest(username, settings.username)
    password_ok = hmac.compare_digest(password, settings.password)
    if not username_ok or not password_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")
    return settings


def set_admin_cookie(response: Response, token: str, settings: AdminSettings) -> None:
    """写入后台管理员会话 Cookie。"""

    response.set_cookie(
        key=ADMIN_SESSION_COOKIE,
        value=token,
        max_age=ADMIN_SESSION_TTL_SECONDS,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )


def clear_admin_cookie(response: Response) -> None:
    """清除后台管理员会话 Cookie。"""

    response.delete_cookie(key=ADMIN_SESSION_COOKIE, httponly=True, samesite="lax")


def get_current_admin(
    session_token: Annotated[str | None, Cookie(alias=ADMIN_SESSION_COOKIE)] = None,
) -> str:
    """FastAPI 依赖：读取并校验当前管理员。"""

    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录后台")
    settings = read_admin_settings_or_error()
    return verify_session_token(session_token, settings)
