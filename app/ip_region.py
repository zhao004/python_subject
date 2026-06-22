"""基于 ip2region 的 IP 地理位置解析。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import IpRegionSettings

UNKNOWN_REGION = "未知"


class IpRegionResolver:
    """IP 地址归属地解析器。

    解析器在服务启动时尽量加载 xdb 到内存；如果依赖或数据文件不可用，查询会稳定返回未知。
    """

    def __init__(self, settings: IpRegionSettings) -> None:
        self._searcher: Any | None = None
        self._available = False
        if settings.xdb_path is None:
            return
        xdb_path = Path(settings.xdb_path)
        if not xdb_path.exists() or not xdb_path.is_file():
            return
        try:
            import ip2region.searcher as searcher
            import ip2region.util as util

            content_buffer = util.load_content_from_file(str(xdb_path))
            self._searcher = searcher.new_with_buffer(util.IPv4, content_buffer)
            self._available = True
        except Exception:
            self._searcher = None
            self._available = False

    def resolve(self, ip_address: str) -> str:
        """解析 IP 地址归属地。"""

        if not self._available or self._searcher is None:
            return UNKNOWN_REGION
        try:
            region = self._searcher.search(ip_address)
        except Exception:
            return UNKNOWN_REGION
        return region or UNKNOWN_REGION

    def close(self) -> None:
        """关闭 ip2region 查询资源。"""

        if self._searcher is None:
            return
        try:
            self._searcher.close()
        except Exception:
            pass
