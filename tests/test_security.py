import time

import pytest
from fastapi.testclient import TestClient

from app import main

EXPECTED_HEADERS = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(self), microphone=(self), display-capture=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
}


def test_unknown_host_header_is_rejected() -> None:
    client = TestClient(main.app)
    response = client.get("/health", headers={"host": "attacker.example"})
    assert response.status_code == 400


@pytest.mark.parametrize("host", ["localhost:8000", "127.0.0.1:8000", "testserver"])
def test_local_hosts_are_allowed(host: str) -> None:
    client = TestClient(main.app)
    assert client.get("/health", headers={"host": host}).status_code == 200


@pytest.mark.parametrize("path", ["/", "/health"])
def test_security_headers_are_present(path: str) -> None:
    response = TestClient(main.app).get(path)
    for name, value in EXPECTED_HEADERS.items():
        assert response.headers.get(name) == value, name


def test_index_is_not_cached_but_health_is_untouched() -> None:
    client = TestClient(main.app)
    assert client.get("/").headers.get("cache-control") == "no-cache"
    assert client.get("/health").headers.get("cache-control") is None


def test_security_headers_reach_static_files() -> None:
    response = TestClient(main.app).get("/static/runtime-browser.js")
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("path", ["/api/copilot", "/api/copilot/stream"])
def test_copilot_requires_json_content_type(path: str) -> None:
    response = TestClient(main.app).post(
        path,
        content=b'{"provider":"grok"}',
        headers={"content-type": "text/plain"},
    )
    assert response.status_code == 415
    assert response.json() == {"detail": "Send JSON with Content-Type: application/json."}


@pytest.mark.parametrize("path", ["/api/copilot", "/api/copilot/stream"])
def test_copilot_rejects_oversized_bodies(path: str) -> None:
    oversized = b'{"pad":"' + b"a" * (main.MAX_COPILOT_BODY_BYTES + 10) + b'"}'
    response = TestClient(main.app).post(path, content=oversized, headers={"content-type": "application/json"})
    assert response.status_code == 413


def test_copilot_limits_calls_in_flight(monkeypatch: pytest.MonkeyPatch) -> None:
    now = time.monotonic()
    monkeypatch.setattr(main, "_COPILOT_SLOTS", {1: now, 2: now})
    response = TestClient(main.app).post(
        "/api/copilot",
        json={"provider": "grok", "apiKey": "xai-test-key", "messages": [{"role": "user", "content": "Hi"}]},
    )
    assert response.status_code == 429
    assert response.json()["detail"] == "The copilot is still answering. Try again in a moment."
