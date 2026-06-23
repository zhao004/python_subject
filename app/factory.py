"""FastAPI 应用工厂。"""

import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api import router
from app.config import load_ip_region_settings, load_mysql_settings
from app.database import build_engine, build_mysql_url, ensure_mysql_database, init_database
from app.ip_region import IpRegionResolver
from app.services import get_default_question_bank

JAVASCRIPT_MEDIA_TYPE = "text/javascript"


def configure_static_mime_types() -> None:
    """修正前端构建产物的 MIME 类型。

    Windows 环境可能从注册表读取到错误的 .js 映射，导致 ES module 被返回为
    text/plain；浏览器会拒绝执行模块脚本，所以在应用启动时显式覆盖。
    """

    mimetypes.add_type(JAVASCRIPT_MEDIA_TYPE, ".js")
    mimetypes.add_type(JAVASCRIPT_MEDIA_TYPE, ".mjs")


def resolve_static_dir(static_dir: str | Path | None) -> Path:
    """解析前端静态目录。

    Args:
        static_dir: 显式传入的目录，未传时使用仓库根目录下的 static。

    Returns:
        绝对路径形式的静态目录。
    """

    if static_dir is not None:
        return Path(static_dir).resolve()
    return Path(__file__).resolve().parent.parent / "static"


def create_app(database_url: str | None = None, static_dir: str | Path | None = None) -> FastAPI:
    """创建 FastAPI 应用。

    Args:
        database_url: 可选数据库地址，测试中用于隔离 SQLite 文件。
        static_dir: 可选前端构建产物目录。

    Returns:
        已配置 API、数据库生命周期和静态文件托管的 FastAPI 应用。
    """

    configure_static_mime_types()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """应用生命周期，启动时建表，关闭时释放连接。"""

        if database_url is not None:
            engine = build_engine(database_url)
        else:
            mysql_settings = load_mysql_settings()
            ensure_mysql_database(mysql_settings)
            engine = build_engine(build_mysql_url(mysql_settings))
        app.state.engine = engine
        app.state.ip_region_resolver = IpRegionResolver(load_ip_region_settings())
        try:
            init_database(engine)
            yield
        finally:
            app.state.ip_region_resolver.close()
            engine.dispose()

    app = FastAPI(title="配对测验 API", version="1.0.0", lifespan=lifespan)
    app.include_router(router)

    frontend_dir = resolve_static_dir(static_dir)
    index_file = frontend_dir / "index.html"
    assets_dir = frontend_dir / "assets"

    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    if index_file.exists():

        @app.get("/", include_in_schema=False)
        def serve_index():
            """返回 React 应用入口，已配置默认题库时跳转到专属链接。"""

            try:
                with Session(app.state.engine) as session:
                    default_bank = get_default_question_bank(session).question_bank
            except SQLAlchemyError:
                default_bank = None
            if default_bank is not None:
                return RedirectResponse(url=f"/{default_bank.slug}", status_code=307)

            return FileResponse(index_file)

        @app.get("/{path:path}", include_in_schema=False)
        def serve_spa(path: str):
            """支持前端路由刷新。

            Args:
                path: 浏览器请求路径，仅用于兼容 SPA 路由。
            """

            return FileResponse(index_file)

    else:

        @app.get("/", include_in_schema=False)
        def read_root():
            """前端尚未构建时返回 API 引导信息。"""

            return {"message": "单词配对测验 API 已启动", "docs": "/docs"}

    return app
