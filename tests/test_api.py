"""API 行为测试。"""

from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.factory import create_app


@pytest.fixture()
def client(tmp_path) -> Iterator[TestClient]:
    """创建使用临时 SQLite 的测试客户端。"""

    database_url = f"sqlite:///{tmp_path / 'quiz-test.db'}"
    app = create_app(database_url=database_url)
    with TestClient(app) as test_client:
        yield test_client


def build_payload(
    *,
    student_id: str = "000000001",
    matched_pair_ids: list[int] | None = None,
    elapsed_seconds: int = 60,
) -> dict[str, object]:
    """构造成绩提交请求。"""

    return {
        "student_class": "一班",
        "student_id": student_id,
        "student_name": "张三",
        "elapsed_seconds": elapsed_seconds,
        "matched_pair_ids": matched_pair_ids if matched_pair_ids is not None else [0, 1, 2],
    }


def assert_utc8_datetime(value: str) -> None:
    """断言接口返回时间携带 UTC+8 偏移量，避免前端按无时区时间误解析。"""

    parsed_datetime = datetime.fromisoformat(value)
    assert parsed_datetime.utcoffset() == timedelta(hours=8)


def test_static_javascript_uses_module_mime_type(tmp_path: Path) -> None:
    """构建后的 JS 必须以模块可执行的 MIME 返回，避免后端托管页面白屏。"""

    static_dir = tmp_path / "static"
    assets_dir = static_dir / "assets"
    assets_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text('<div id="root"></div>', encoding="utf-8")
    (assets_dir / "app.js").write_text("export default {};\n", encoding="utf-8")

    database_url = f"sqlite:///{tmp_path / 'static-test.db'}"
    app = create_app(database_url=database_url, static_dir=static_dir)
    with TestClient(app) as test_client:
        response = test_client.get("/assets/app.js")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/javascript")


def test_read_quiz_returns_word_pairs(client: TestClient) -> None:
    """测验配置应包含 20 组词汇和计分规则。"""

    response = client.get("/api/quiz")

    assert response.status_code == 200
    body = response.json()
    assert body["total_pairs"] == 20
    assert body["max_score"] == 100
    assert body["points_per_pair"] == 5.0
    assert len(body["word_pairs"]) == 20


def test_submit_partial_score(client: TestClient) -> None:
    """未完成全部配对也允许提交，并由后端计算分数。"""

    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1, 2, 3]))

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is True
    assert body["record"]["correct_count"] == 4
    assert body["record"]["score"] == 20
    assert body["record"]["elapsed_seconds"] == 60


def test_submit_score_returns_utc8_submitted_time(client: TestClient) -> None:
    """成绩提交响应时间必须携带 UTC+8 偏移量。"""

    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1, 2]))

    assert response.status_code == 201
    assert_utc8_datetime(response.json()["record"]["submitted_at"])


def test_better_score_overwrites_existing_best(client: TestClient) -> None:
    """同一学生提交更高分时应覆盖最佳成绩。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1], elapsed_seconds=40))
    response = client.post(
        "/api/scores",
        json=build_payload(matched_pair_ids=[0, 1, 2, 3], elapsed_seconds=90),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is True
    assert body["record"]["score"] == 20
    assert body["record"]["elapsed_seconds"] == 90


def test_shorter_time_overwrites_same_score(client: TestClient) -> None:
    """同分时耗时更短应覆盖最佳成绩。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1], elapsed_seconds=80))
    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1], elapsed_seconds=50))

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is True
    assert body["record"]["score"] == 10
    assert body["record"]["elapsed_seconds"] == 50


def test_lower_or_slower_score_does_not_overwrite_best(client: TestClient) -> None:
    """低分或同分更慢时不应覆盖已保存的最佳成绩。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1, 2], elapsed_seconds=40))
    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1], elapsed_seconds=10))

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is False
    assert body["record"]["score"] == 15
    assert body["record"]["elapsed_seconds"] == 40


def test_leaderboard_orders_by_score_then_elapsed_time(client: TestClient) -> None:
    """排行榜应先按分数降序，再按耗时升序。"""

    client.post(
        "/api/scores",
        json=build_payload(student_id="000000001", matched_pair_ids=[0, 1, 2], elapsed_seconds=70),
    )
    client.post(
        "/api/scores",
        json=build_payload(student_id="000000002", matched_pair_ids=[0, 1, 2], elapsed_seconds=50),
    )
    client.post(
        "/api/scores",
        json=build_payload(student_id="000000003", matched_pair_ids=[0, 1, 2, 3], elapsed_seconds=90),
    )

    response = client.get("/api/leaderboard?limit=3")

    assert response.status_code == 200
    entries = response.json()["entries"]
    assert [entry["student_id"] for entry in entries] == ["000000003", "000000002", "000000001"]
    assert [entry["rank"] for entry in entries] == [1, 2, 3]


def test_leaderboard_returns_utc8_submitted_time(client: TestClient) -> None:
    """排行榜提交时间必须携带 UTC+8 偏移量。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[0, 1, 2]))

    response = client.get("/api/leaderboard?limit=1")

    assert response.status_code == 200
    assert_utc8_datetime(response.json()["entries"][0]["submitted_at"])


@pytest.mark.parametrize(
    "payload",
    [
        build_payload(student_id="", matched_pair_ids=[0]),
        build_payload(student_id="12345678", matched_pair_ids=[0]),
        build_payload(student_id="1234567890", matched_pair_ids=[0]),
        build_payload(student_id="12345678A", matched_pair_ids=[0]),
        build_payload(matched_pair_ids=[0, 0]),
        build_payload(matched_pair_ids=[999]),
        build_payload(matched_pair_ids=[0], elapsed_seconds=-1),
    ],
)
def test_invalid_submission_returns_validation_error(client: TestClient, payload: dict[str, object]) -> None:
    """非法提交应返回 422，避免脏数据进入数据库。"""

    response = client.post("/api/scores", json=payload)

    assert response.status_code == 422
