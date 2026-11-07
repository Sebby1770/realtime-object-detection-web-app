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


def test_cross_origin_resource_policy_blocks_embedding_elsewhere() -> None:
    client = TestClient(main.app)
    for path in ("/", "/health", "/api/virtualcam/status"):
        assert client.get(path).headers["cross-origin-resource-policy"] == "same-origin"


def test_copilot_slot_is_released_when_the_stream_never_starts() -> None:
    """Stop right after Ask can cancel the response before its body runs; the slot must not leak."""
    import asyncio
    import gc
    import json

    from starlette.requests import Request

    body = json.dumps(
        {"provider": "anthropic", "apiKey": "sk-ant-test-123456", "messages": [{"role": "user", "content": "hi"}]}
    ).encode()

    async def receive() -> dict:
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/copilot/stream",
        "headers": [(b"content-type", b"application/json")],
        "query_string": b"",
    }
    main._COPILOT_SLOTS.clear()
    response = asyncio.run(main.copilot_stream(Request(scope, receive)))
    assert len(main._COPILOT_SLOTS) == 1
    del response
    gc.collect()
    assert main._COPILOT_SLOTS == {}


def test_websocket_survives_malformed_config_messages() -> None:
    client = TestClient(main.app)
    with client.websocket_connect("/ws/detect", headers={"origin": "http://127.0.0.1:8000"}) as websocket:
        websocket.send_text("[1, 2, 3]")
        websocket.send_text('"just a string"')
        websocket.send_json({"type": "config", "classes": None})
        ack = websocket.receive_json()
        assert ack["type"] == "config_ack"
        assert ack["classes"] is None
        websocket.send_json({"type": "config", "classes": ["person"]})
        assert websocket.receive_json()["classes"] == ["person"]


def test_host_guard_understands_bracketed_ipv6_and_rejects_others() -> None:
    from app.main import host_name

    assert host_name("[::1]:8000") == "[::1]"
    assert host_name("LOCALHOST:8000") == "localhost"
    assert host_name("127.0.0.1") == "127.0.0.1"
    client = TestClient(main.app)
    assert client.get("/health", headers={"host": "[::1]:8000"}).status_code == 200
    assert client.get("/health", headers={"host": "evil.example:8000"}).status_code == 400


def test_websocket_with_a_foreign_host_is_refused() -> None:
    from starlette.websockets import WebSocketDisconnect

    client = TestClient(main.app)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/detect", headers={"host": "evil.example", "origin": "http://evil.example"}):
            pass


def test_websocket_accepts_the_page_it_served_on_another_port() -> None:
    client = TestClient(main.app)
    headers = {"host": "localhost:9000", "origin": "http://localhost:9000"}
    with client.websocket_connect("/ws/detect", headers=headers) as websocket:
        websocket.send_json({"type": "config", "confidence": 0.5})
        assert websocket.receive_json()["type"] == "config_ack"


def test_other_sites_cannot_push_frames_into_the_virtual_camera() -> None:
    main.studio_bridge.reset()
    client = TestClient(main.app)
    jpeg = b"\xff\xd8\xff\xd9"
    simple = client.post(
        "/api/virtualcam/frame", content=jpeg, headers={"content-type": "text/plain", "origin": "https://evil.example"}
    )
    assert simple.status_code in {403, 415}
    foreign = client.post(
        "/api/virtualcam/frame", content=jpeg, headers={"content-type": "image/jpeg", "origin": "https://evil.example"}
    )
    assert foreign.status_code == 403
    assert main.studio_bridge.status()["frames"] == 0
    own = client.post(
        "/api/virtualcam/frame", content=jpeg, headers={"content-type": "image/jpeg", "origin": "http://testserver"}
    )
    assert own.status_code == 200
    assert own.json()["frames"] == 1


def test_copilot_refuses_a_foreign_origin() -> None:
    client = TestClient(main.app)
    response = client.post(
        "/api/copilot/stream",
        json={"provider": "grok", "apiKey": "xai-test-key", "messages": [{"role": "user", "content": "hi"}]},
        headers={"origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_copilot_slots_outlast_long_answers() -> None:
    assert main.COPILOT_SLOT_SAFETY_SECONDS >= 20 * 60


def test_launcher_allows_the_host_it_binds(monkeypatch: pytest.MonkeyPatch) -> None:
    import sys
    import types

    from app import __main__ as launcher

    calls = {}
    monkeypatch.setitem(sys.modules, "uvicorn", types.SimpleNamespace(run=lambda *a, **k: calls.update(k)))
    monkeypatch.delenv("ALLOWED_HOSTS", raising=False)
    launcher.main(["--host", "192.168.1.20", "--port", "9000"])
    import os

    assert "192.168.1.20" in os.environ["ALLOWED_HOSTS"].split(",")
    assert calls["port"] == 9000
    monkeypatch.delenv("ALLOWED_HOSTS", raising=False)
