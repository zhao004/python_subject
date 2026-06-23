"""API 行为测试。"""

from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import ADMIN_SESSION_COOKIE
from app.factory import create_app
from app.models import QuestionBank, QuestionItem, SiteSetting
from app.time_utils import storage_now

TEST_BANK_SLUG = "english-pairs"
TEST_ADMIN_USERNAME = "admin"
TEST_ADMIN_PASSWORD = "secret"
TEST_ADMIN_SECRET = "test-session-secret-for-admin-1234567890"


@pytest.fixture()
def client(tmp_path) -> Iterator[TestClient]:
    """创建使用临时 SQLite 和默认题库的测试客户端。"""

    database_url = f"sqlite:///{tmp_path / 'quiz-test.db'}"
    app = create_app(database_url=database_url)
    with TestClient(app) as test_client:
        seed_default_question_bank(app)
        yield test_client


def seed_default_question_bank(app) -> None:
    """写入测试默认题库，模拟后台上线后的配置状态。"""

    now = storage_now()
    with Session(app.state.engine) as session:
        bank = QuestionBank(
            name="英语配对",
            slug=TEST_BANK_SLUG,
            description="测试题库",
            is_active=True,
            leaderboard_limit=10,
            submission_style="classic",
            created_at=now,
            updated_at=now,
        )
        for index in range(1, 21):
            bank.question_items.append(
                QuestionItem(
                    left_text=f"word-{index}",
                    right_text=f"释义-{index}",
                    sort_order=index,
                    created_at=now,
                    updated_at=now,
                )
            )
        session.add(bank)
        session.flush()
        session.add(SiteSetting(id=1, default_question_bank_id=bank.id, updated_at=now))
        session.commit()


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
        "matched_pair_ids": matched_pair_ids if matched_pair_ids is not None else [1, 2, 3],
    }


def set_admin_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """写入后台管理员测试环境变量。"""

    monkeypatch.setenv("ADMIN_USERNAME", TEST_ADMIN_USERNAME)
    monkeypatch.setenv("ADMIN_PASSWORD", TEST_ADMIN_PASSWORD)
    monkeypatch.setenv("ADMIN_SESSION_SECRET", TEST_ADMIN_SECRET)
    monkeypatch.setenv("ADMIN_COOKIE_SECURE", "false")


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


def test_root_redirects_to_default_bank_slug(tmp_path: Path) -> None:
    """首页在配置默认题库时应跳转到根路径短码。"""

    static_dir = tmp_path / "static"
    static_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<div id='root'></div>", encoding="utf-8")

    database_url = f"sqlite:///{tmp_path / 'redirect-test.db'}"
    app = create_app(database_url=database_url, static_dir=static_dir)
    with TestClient(app) as test_client:
        seed_default_question_bank(app)
        response = test_client.get("/", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == f"/{TEST_BANK_SLUG}"


def test_read_quiz_returns_word_pairs(client: TestClient) -> None:
    """默认题库测验配置应包含 20 组配对题和计分规则。"""

    response = client.get("/api/quiz")

    assert response.status_code == 200
    body = response.json()
    assert body["total_pairs"] == 20
    assert body["max_score"] == 100
    assert body["points_per_pair"] == 5.0
    assert len(body["word_pairs"]) == 20
    assert body["question_bank"]["slug"] == TEST_BANK_SLUG


def test_public_quiz_by_slug_returns_question_bank(client: TestClient) -> None:
    """专属链接接口应返回对应题库。"""

    response = client.get(f"/api/public/question-banks/{TEST_BANK_SLUG}/quiz")

    assert response.status_code == 200
    assert response.json()["question_bank"]["name"] == "英语配对"


def test_submit_partial_score(client: TestClient) -> None:
    """未完成全部配对也允许提交，并由后端计算分数。"""

    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2, 3, 4]))

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is True
    assert body["record"]["correct_count"] == 4
    assert body["record"]["score"] == 20
    assert body["record"]["elapsed_seconds"] == 60


def test_submit_score_returns_utc8_submitted_time(client: TestClient) -> None:
    """成绩提交响应时间必须携带 UTC+8 偏移量。"""

    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2, 3]))

    assert response.status_code == 201
    assert_utc8_datetime(response.json()["record"]["submitted_at"])


def test_better_score_overwrites_existing_best(client: TestClient) -> None:
    """同一学生提交更高分时应覆盖最佳成绩。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2], elapsed_seconds=40))
    response = client.post(
        "/api/scores",
        json=build_payload(matched_pair_ids=[1, 2, 3, 4], elapsed_seconds=90),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is True
    assert body["record"]["score"] == 20
    assert body["record"]["elapsed_seconds"] == 90


def test_shorter_time_overwrites_same_score(client: TestClient) -> None:
    """同分时耗时更短应覆盖最佳成绩。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2], elapsed_seconds=80))
    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2], elapsed_seconds=50))

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is True
    assert body["record"]["score"] == 10
    assert body["record"]["elapsed_seconds"] == 50


def test_lower_or_slower_score_does_not_overwrite_best(client: TestClient) -> None:
    """低分或同分更慢时不应覆盖已保存的最佳成绩。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2, 3], elapsed_seconds=40))
    response = client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2], elapsed_seconds=10))

    assert response.status_code == 201
    body = response.json()
    assert body["saved_as_best"] is False
    assert body["record"]["score"] == 15
    assert body["record"]["elapsed_seconds"] == 40


def test_leaderboard_orders_by_score_then_elapsed_time(client: TestClient) -> None:
    """排行榜应先按分数降序，再按耗时升序。"""

    client.post(
        "/api/scores",
            json=build_payload(student_id="000000001", matched_pair_ids=[1, 2, 3], elapsed_seconds=70),
    )
    client.post(
        "/api/scores",
            json=build_payload(student_id="000000002", matched_pair_ids=[1, 2, 3], elapsed_seconds=50),
    )
    client.post(
        "/api/scores",
            json=build_payload(student_id="000000003", matched_pair_ids=[1, 2, 3, 4], elapsed_seconds=90),
    )

    response = client.get("/api/leaderboard?limit=3")

    assert response.status_code == 200
    entries = response.json()["entries"]
    assert [entry["student_id"] for entry in entries] == ["000000003", "000000002", "000000001"]
    assert [entry["rank"] for entry in entries] == [1, 2, 3]


def test_leaderboard_returns_utc8_submitted_time(client: TestClient) -> None:
    """排行榜提交时间必须携带 UTC+8 偏移量。"""

    client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2, 3]))

    response = client.get("/api/leaderboard?limit=1")

    assert response.status_code == 200
    assert_utc8_datetime(response.json()["entries"][0]["submitted_at"])


@pytest.mark.parametrize(
    "payload",
    [
        build_payload(student_id="", matched_pair_ids=[1]),
        build_payload(student_id="12345678", matched_pair_ids=[1]),
        build_payload(student_id="1234567890", matched_pair_ids=[1]),
        build_payload(student_id="12345678A", matched_pair_ids=[1]),
        build_payload(matched_pair_ids=[1, 1]),
        build_payload(matched_pair_ids=[999]),
        build_payload(matched_pair_ids=[1], elapsed_seconds=-1),
    ],
)
def test_invalid_submission_returns_validation_error(client: TestClient, payload: dict[str, object]) -> None:
    """非法提交应返回 422，避免脏数据进入数据库。"""

    response = client.post("/api/scores", json=payload)

    assert response.status_code in {400, 422}


def test_admin_login_and_question_bank_crud(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """后台应支持登录、创建题库、设置默认和删除题库。"""

    set_admin_env(monkeypatch)

    login_response = client.post(
        "/api/admin/login",
        json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD},
    )
    assert login_response.status_code == 200
    assert login_response.json()["authenticated"] is True

    create_response = client.post(
        "/api/admin/question-banks",
        json={
            "name": "新题库",
            "slug": "new-bank",
            "description": "后台创建",
            "is_active": True,
            "leaderboard_limit": 5,
            "submission_style": "paper",
            "items": [
                {"left_text": "alpha", "right_text": "阿尔法"},
                {"left_text": "beta", "right_text": "贝塔"},
            ],
        },
    )
    assert create_response.status_code == 201
    created_bank = create_response.json()
    assert created_bank["item_count"] == 2
    assert created_bank["submission_style"] == "paper"

    settings_response = client.put(
        "/api/admin/site-settings",
        json={"default_question_bank_id": created_bank["id"]},
    )
    assert settings_response.status_code == 200
    assert settings_response.json()["default_question_bank_slug"] == "new-bank"

    delete_response = client.delete(f"/api/admin/question-banks/{created_bank['id']}")
    assert delete_response.status_code == 204


def test_admin_login_sets_session_cookie_attributes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """后台登录 Cookie 应固定 HttpOnly 和 SameSite=Lax，降低脚本读取与跨站请求风险。"""

    set_admin_env(monkeypatch)

    login_response = client.post(
        "/api/admin/login",
        json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD},
    )

    cookie_header = login_response.headers.get("set-cookie", "")
    normalized_cookie_header = cookie_header.lower()
    assert login_response.status_code == 200
    assert f"{ADMIN_SESSION_COOKIE}=" in cookie_header
    assert "httponly" in normalized_cookie_header
    assert "samesite=lax" in normalized_cookie_header


def test_admin_login_cookie_supports_secure_attribute(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """开启 ADMIN_COOKIE_SECURE 后，登录响应应写入 Secure Cookie 属性。"""

    set_admin_env(monkeypatch)
    monkeypatch.setenv("ADMIN_COOKIE_SECURE", "true")

    login_response = client.post(
        "/api/admin/login",
        json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD},
    )

    cookie_header = login_response.headers.get("set-cookie", "")
    assert login_response.status_code == 200
    assert "secure" in cookie_header.lower()


def test_admin_question_bank_update_preserves_theme_style_and_announcement(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """题库更新应保留主题风格与公告，并在公开接口中同步回显。"""

    _admin_login(client, monkeypatch)
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]

    update_response = client.put(
        f"/api/admin/question-banks/{bank_id}",
        json={
            "name": "英语配对",
            "slug": TEST_BANK_SLUG,
            "description": "更新后的描述",
            "is_active": True,
            "leaderboard_limit": 8,
            "submission_style": "paper",
            "announcement": "主题风格已更新",
            "items": [
                {"left_text": "word-1", "right_text": "释义-1"},
                {"left_text": "word-2", "right_text": "释义-2"},
            ],
        },
    )

    assert update_response.status_code == 200
    updated_bank = update_response.json()
    assert updated_bank["submission_style"] == "paper"
    assert updated_bank["announcement"] == "主题风格已更新"

    detail_response = client.get(f"/api/admin/question-banks/{bank_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["submission_style"] == "paper"

    quiz_response = client.get(f"/api/public/question-banks/{TEST_BANK_SLUG}/quiz")
    assert quiz_response.status_code == 200
    quiz_body = quiz_response.json()
    assert quiz_body["question_bank"]["submission_style"] == "paper"
    assert quiz_body["question_bank"]["announcement"] == "主题风格已更新"


def test_admin_can_crud_leaderboard_records(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """后台应支持手工新增、修改和删除排行榜记录。"""

    set_admin_env(monkeypatch)
    client.post("/api/admin/login", json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD})
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]

    create_response = client.post(
        f"/api/admin/question-banks/{bank_id}/leaderboard",
        json={
            "student_class": "二班",
            "student_id": "000000008",
            "student_name": "李四",
            "correct_count": 10,
            "elapsed_seconds": 88,
        },
    )
    assert create_response.status_code == 201
    record = create_response.json()
    assert record["is_manual"] is True
    assert record["score"] == 50

    update_response = client.put(
        f"/api/admin/leaderboard-records/{record['id']}",
        json={
            "student_class": "二班",
            "student_id": "000000008",
            "student_name": "李四",
            "correct_count": 12,
            "elapsed_seconds": 70,
            "score": 66,
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["score"] == 66

    delete_response = client.delete(f"/api/admin/leaderboard-records/{record['id']}")
    assert delete_response.status_code == 204


def test_access_log_records_public_page(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """公开访问上报应保存设备、IP、地址和页面。"""

    response = client.post(
        "/api/public/access-logs",
        json={"page_path": f"/{TEST_BANK_SLUG}", "question_bank_slug": TEST_BANK_SLUG},
        headers={"user-agent": "Mozilla/5.0 iPhone", "x-forwarded-for": "8.8.8.8"},
    )
    assert response.status_code == 204

    set_admin_env(monkeypatch)
    client.post("/api/admin/login", json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD})
    logs_response = client.get("/api/admin/access-logs?limit=1")

    assert logs_response.status_code == 200
    body = logs_response.json()
    assert body["total"] >= 1
    log = body["entries"][0]
    assert log["page_path"] == f"/{TEST_BANK_SLUG}"
    assert log["device"] == "移动设备"
    assert log["ip_address"] == "8.8.8.8"


def _admin_login(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """便捷登录后台。"""

    set_admin_env(monkeypatch)
    client.post("/api/admin/login", json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD})


def _create_extra_bank(client: TestClient, slug: str = "Bank_ABC") -> dict[str, object]:
    """创建测试附加题库，返回响应。"""

    response = client.post(
        "/api/admin/question-banks",
        json={
            "name": "随机测试库",
            "slug": slug,
            "description": "用于批量删除与统计",
            "is_active": True,
            "leaderboard_limit": 5,
            "submission_style": "classic",
            "announcement": "重要通知",
            "items": [
                {"left_text": "alpha", "right_text": "阿尔法"},
                {"left_text": "beta", "right_text": "贝塔"},
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_admin_bank_payload_supports_announcement_and_uppercase_slug(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """题库创建应支持 announcement 字段并保留大小写字母 slug。"""

    _admin_login(client, monkeypatch)
    bank = _create_extra_bank(client, slug="Bank_ABC")
    assert bank["slug"] == "Bank_ABC"
    assert bank["announcement"] == "重要通知"


def test_admin_rejects_reserved_public_slug(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """题库短码不能占用后台、接口或静态资源等系统根路径。"""

    _admin_login(client, monkeypatch)
    response = client.post(
        "/api/admin/question-banks",
        json={
            "name": "保留路径题库",
            "slug": "admin",
            "description": "",
            "is_active": True,
            "leaderboard_limit": 5,
            "submission_style": "classic",
            "announcement": "",
            "items": [{"left_text": "alpha", "right_text": "阿尔法"}],
        },
    )

    assert response.status_code == 422


def test_random_slug_endpoint_returns_unique_6char_slug(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """后台生成 slug 应返回 6 位字母字符且保证唯一。"""

    import re

    _admin_login(client, monkeypatch)
    response = client.post("/api/admin/question-banks/random-slug")
    assert response.status_code == 200
    slug = response.json()["slug"]
    assert len(slug) == 6
    assert re.fullmatch(r"[A-Za-z]{6}", slug) is not None

    # 第二次生成不应与第一次重复
    second_response = client.post("/api/admin/question-banks/random-slug")
    assert second_response.status_code == 200
    assert second_response.json()["slug"] != slug


def test_batch_delete_removes_multiple_question_banks(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """批量删除应一次性清除多个题库。"""

    _admin_login(client, monkeypatch)
    bank_a = _create_extra_bank(client, slug="Bank-A")
    bank_b = _create_extra_bank(client, slug="Bank-B")

    response = client.post(
        "/api/admin/question-banks/batch-delete",
        json={"ids": [bank_a["id"], bank_b["id"]]},
    )
    assert response.status_code == 200
    assert response.json()["deleted"] == 2

    list_response = client.get("/api/admin/question-banks")
    assert list_response.status_code == 200
    remaining_ids = [bank["id"] for bank in list_response.json()["entries"]]
    assert bank_a["id"] not in remaining_ids
    assert bank_b["id"] not in remaining_ids


def test_overview_returns_aggregated_stats(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """概览接口应返回题库总数、启用数量、题目总数、近 7 天提交数。"""

    _admin_login(client, monkeypatch)
    response = client.get("/api/admin/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["bank_count"] == 1
    assert body["active_bank_count"] == 1
    assert body["total_question_count"] == 20
    assert body["submission_count_7d"] == 0


def test_submission_trend_includes_7_day_dates(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """提交趋势应返回 7 个日期横轴；提交后该日数据应为 1。"""

    _admin_login(client, monkeypatch)
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]

    client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2, 3]))

    response = client.get("/api/admin/submission-trend")
    assert response.status_code == 200
    body = response.json()
    assert len(body["dates"]) == 7
    assert body["series"][0]["bank_id"] == bank_id
    assert sum(body["series"][0]["data"]) == 1


def test_submission_trend_keeps_old_bank_data_when_many_banks(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """题库数量超过 20 个时，旧题库的提交趋势不能被截断丢失。"""

    _admin_login(client, monkeypatch)
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]
    for index in range(1, 22):
        _create_extra_bank(client, slug=f"trend-bank-{index}")

    client.post("/api/scores", json=build_payload(matched_pair_ids=[1, 2, 3]))

    response = client.get("/api/admin/submission-trend")
    assert response.status_code == 200
    all_series = response.json()["series"]
    default_bank_series = next((series for series in all_series if series["bank_id"] == bank_id), None)
    assert default_bank_series is not None
    assert sum(default_bank_series["data"]) == 1

    filtered_response = client.get(f"/api/admin/submission-trend?bank_id={bank_id}")
    assert filtered_response.status_code == 200
    filtered_series = filtered_response.json()["series"]
    assert len(filtered_series) == 1
    assert filtered_series[0]["bank_id"] == bank_id
    assert sum(filtered_series[0]["data"]) == 1


def test_submission_logs_track_every_submission(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """每次提交（公开或手工）都应在提交流水中留下记录。"""

    _admin_login(client, monkeypatch)
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]

    client.post("/api/scores", json=build_payload(student_id="000000001", matched_pair_ids=[1, 2, 3]))
    client.post("/api/scores", json=build_payload(student_id="000000002", matched_pair_ids=[1, 2, 3, 4]))

    response = client.get(f"/api/admin/question-banks/{bank_id}/submission-logs?limit=10")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert len(body["entries"]) == 2
    assert body["entries"][0]["is_manual"] is False


def test_access_logs_filtered_by_bank_id(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """访问日志接口按 bank_id 过滤时只返回该题库记录。"""

    client.post(
        "/api/public/access-logs",
        json={"page_path": f"/{TEST_BANK_SLUG}", "question_bank_slug": TEST_BANK_SLUG},
        headers={"user-agent": "Mozilla/5.0", "x-forwarded-for": "1.1.1.1"},
    )
    bank_id = 1
    client.post(
        "/api/public/access-logs",
        json={"page_path": "/other-bank"},
    )

    _admin_login(client, monkeypatch)
    response = client.get(f"/api/admin/access-logs?bank_id={bank_id}&limit=5")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    entries = body["entries"]
    # 过滤后应只包含 bank_id=1 的记录
    assert len(entries) == 1
    assert entries[0]["question_bank_id"] == bank_id


def test_question_banks_pagination_returns_total_and_entries(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """题库列表接口应返回 total 和 entries，支持 limit/offset 分页。"""

    _admin_login(client, monkeypatch)
    _create_extra_bank(client, slug="Bank-Pg1")
    _create_extra_bank(client, slug="Bank-Pg2")

    page1 = client.get("/api/admin/question-banks?limit=2&offset=0")
    assert page1.status_code == 200
    body1 = page1.json()
    assert body1["total"] == 3
    assert len(body1["entries"]) == 2

    page2 = client.get("/api/admin/question-banks?limit=2&offset=2")
    assert page2.status_code == 200
    body2 = page2.json()
    assert body2["total"] == 3
    assert len(body2["entries"]) == 1


def test_question_banks_search_matches_name_or_slug(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """题库列表搜索应模糊匹配名称和链接标识。"""

    _admin_login(client, monkeypatch)
    _create_extra_bank(client, slug="search-test")

    response = client.get("/api/admin/question-banks?search=search")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["entries"][0]["slug"] == "search-test"


def test_question_banks_filter_by_is_active(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """题库列表应支持按启用状态筛选。"""

    _admin_login(client, monkeypatch)
    _create_extra_bank(client, slug="inactive-bank")
    # 将刚创建的题库设为停用
    bank_list = client.get("/api/admin/question-banks").json()["entries"]
    inactive_bank = next(b for b in bank_list if b["slug"] == "inactive-bank")
    client.put(
        f"/api/admin/question-banks/{inactive_bank['id']}",
        json={
            "name": inactive_bank["name"],
            "slug": inactive_bank["slug"],
            "description": inactive_bank["description"],
            "is_active": False,
            "leaderboard_limit": inactive_bank["leaderboard_limit"],
            "submission_style": inactive_bank["submission_style"],
            "announcement": inactive_bank.get("announcement", ""),
            "items": [{"left_text": "alpha", "right_text": "阿尔法"}],
        },
    )

    active_response = client.get("/api/admin/question-banks?is_active=true")
    assert active_response.status_code == 200
    active_body = active_response.json()
    assert all(entry["is_active"] for entry in active_body["entries"])

    inactive_response = client.get("/api/admin/question-banks?is_active=false")
    assert inactive_response.status_code == 200
    inactive_body = inactive_response.json()
    assert all(not entry["is_active"] for entry in inactive_body["entries"])
    assert any(entry["slug"] == "inactive-bank" for entry in inactive_body["entries"])


def test_access_logs_search_matches_path_or_ip(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """访问日志搜索应模糊匹配页面路径和 IP 地址。"""

    client.post(
        "/api/public/access-logs",
        json={"page_path": "/search-test-page", "question_bank_slug": TEST_BANK_SLUG},
        headers={"user-agent": "Mozilla/5.0", "x-forwarded-for": "9.9.9.9"},
    )

    _admin_login(client, monkeypatch)
    response = client.get("/api/admin/access-logs?search=9.9.9.9")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    assert any(log["ip_address"] == "9.9.9.9" for log in body["entries"])

    path_response = client.get("/api/admin/access-logs?search=search-test")
    assert path_response.status_code == 200
    path_body = path_response.json()
    assert any("search-test" in log["page_path"] for log in path_body["entries"])


def test_access_logs_pagination_with_offset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """访问日志应支持 offset 分页，total 反映全量条数。"""

    for i in range(5):
        client.post(
            "/api/public/access-logs",
            json={"page_path": f"/page-{i}", "question_bank_slug": TEST_BANK_SLUG},
            headers={"user-agent": "Mozilla/5.0", "x-forwarded-for": "1.2.3.4"},
        )

    _admin_login(client, monkeypatch)
    page1 = client.get("/api/admin/access-logs?limit=2&offset=0")
    assert page1.status_code == 200
    body1 = page1.json()
    assert body1["total"] >= 5
    assert len(body1["entries"]) == 2

    page2 = client.get("/api/admin/access-logs?limit=2&offset=2")
    assert page2.status_code == 200
    body2 = page2.json()
    assert len(body2["entries"]) == 2
    # 两页记录不应重复
    page1_ids = {entry["id"] for entry in body1["entries"]}
    page2_ids = {entry["id"] for entry in body2["entries"]}
    assert page1_ids.isdisjoint(page2_ids)


def test_leaderboard_pagination_and_search(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """后台排行榜应支持分页和按学生姓名搜索。"""

    _admin_login(client, monkeypatch)
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]

    # 创建多条排行榜记录
    for i in range(5):
        client.post(
            f"/api/admin/question-banks/{bank_id}/leaderboard",
            json={
                "student_class": "一班",
                "student_id": f"0000000{i + 10}",
                "student_name": f"学生{i}",
                "correct_count": 10,
                "elapsed_seconds": 60 + i,
            },
        )

    # 验证分页
    page1 = client.get(f"/api/admin/question-banks/{bank_id}/leaderboard?limit=2&offset=0")
    assert page1.status_code == 200
    body1 = page1.json()
    assert body1["total"] == 5
    assert len(body1["entries"]) == 2

    page2 = client.get(f"/api/admin/question-banks/{bank_id}/leaderboard?limit=2&offset=2")
    assert page2.status_code == 200
    body2 = page2.json()
    assert len(body2["entries"]) == 2

    # 验证搜索
    search_response = client.get(f"/api/admin/question-banks/{bank_id}/leaderboard?search=学生0")
    assert search_response.status_code == 200
    search_body = search_response.json()
    assert search_body["total"] == 1
    assert search_body["entries"][0]["student_name"] == "学生0"


def test_submission_logs_search_by_student(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """提交流水应支持按学生姓名或学号搜索。"""

    _admin_login(client, monkeypatch)
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]

    client.post("/api/scores", json=build_payload(student_id="000000001", matched_pair_ids=[1, 2, 3]))
    client.post("/api/scores", json=build_payload(student_id="000000002", matched_pair_ids=[1, 2, 3]))

    # 按学号搜索
    response = client.get(f"/api/admin/question-banks/{bank_id}/submission-logs?search=000000001")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["entries"][0]["student_id"] == "000000001"


def test_batch_delete_leaderboard_records(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """排行榜记录批量删除应只删除已选 ID，并返回实际删除数量。"""

    _admin_login(client, monkeypatch)
    bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]
    record_ids: list[int] = []
    for index in range(3):
        response = client.post(
            f"/api/admin/question-banks/{bank_id}/leaderboard",
            json={
                "student_class": "一班",
                "student_id": f"0000001{index:02d}",
                "student_name": f"批量学生{index}",
                "correct_count": 10,
                "elapsed_seconds": 60 + index,
            },
        )
        assert response.status_code == 201
        record_ids.append(response.json()["id"])

    delete_response = client.post(
        "/api/admin/leaderboard-records/batch-delete",
        json={"ids": [record_ids[0], record_ids[1], record_ids[1], 999999]},
    )

    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] == 2
    list_response = client.get(f"/api/admin/question-banks/{bank_id}/leaderboard?limit=10")
    remaining_ids = {entry["id"] for entry in list_response.json()["entries"]}
    assert record_ids[0] not in remaining_ids
    assert record_ids[1] not in remaining_ids
    assert record_ids[2] in remaining_ids


def test_batch_delete_submission_logs_is_scoped_to_bank(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """提交流水批量删除必须限定当前题库，避免跨题库误删。"""

    _admin_login(client, monkeypatch)
    default_bank_id = client.get("/api/admin/question-banks").json()["entries"][0]["id"]
    other_bank = _create_extra_bank(client, slug="submission-delete-scope")

    client.post("/api/scores", json=build_payload(student_id="000000001", matched_pair_ids=[1, 2, 3]))
    client.post(
        f"/api/admin/question-banks/{other_bank['id']}/leaderboard",
        json={
            "student_class": "一班",
            "student_id": "000000777",
            "student_name": "其他题库学生",
            "correct_count": 1,
            "elapsed_seconds": 70,
        },
    )

    default_logs = client.get(f"/api/admin/question-banks/{default_bank_id}/submission-logs?limit=5").json()["entries"]
    other_logs = client.get(f"/api/admin/question-banks/{other_bank['id']}/submission-logs?limit=5").json()["entries"]
    assert default_logs
    assert other_logs

    delete_response = client.post(
        f"/api/admin/question-banks/{default_bank_id}/submission-logs/batch-delete",
        json={"ids": [default_logs[0]["id"], other_logs[0]["id"]]},
    )

    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] == 1
    remaining_other = client.get(
        f"/api/admin/question-banks/{other_bank['id']}/submission-logs?limit=5"
    ).json()["entries"]
    assert any(entry["id"] == other_logs[0]["id"] for entry in remaining_other)


def test_batch_delete_access_logs_and_reject_invalid_ids(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """访问记录批量删除应删除已选记录，非法 ID 应被请求体校验拒绝。"""

    for index in range(3):
        client.post(
            "/api/public/access-logs",
            json={"page_path": f"/batch-access-{index}", "question_bank_slug": TEST_BANK_SLUG},
            headers={"user-agent": "Mozilla/5.0", "x-forwarded-for": f"10.0.0.{index + 1}"},
        )

    _admin_login(client, monkeypatch)
    logs = client.get("/api/admin/access-logs?limit=10&search=batch-access").json()["entries"]
    target_ids = [entry["id"] for entry in logs[:2]]

    invalid_response = client.post("/api/admin/access-logs/batch-delete", json={"ids": [0]})
    assert invalid_response.status_code == 422

    delete_response = client.post("/api/admin/access-logs/batch-delete", json={"ids": target_ids})
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] == 2

    remaining = client.get("/api/admin/access-logs?limit=10&search=batch-access").json()["entries"]
    remaining_ids = {entry["id"] for entry in remaining}
    assert all(log_id not in remaining_ids for log_id in target_ids)
