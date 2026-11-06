import base64
import json

import pytest
from fastapi.testclient import TestClient

from app import copilot, main
from app.copilot import (
    CopilotError,
    build_request,
    conversation,
    extract_text,
    http_error,
    iter_sse,
    parse_stream_event,
    redact,
)

JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0fake-jpeg\xff\xd9").decode()
USER = [{"role": "user", "content": "What is on the desk?"}]


def test_catalog_lists_grok_chatgpt_and_claude() -> None:
    client = TestClient(main.app)
    response = client.get("/api/copilot")

    assert response.status_code == 200
    providers = response.json()["providers"]
    assert [item["id"] for item in providers] == ["grok", "openai", "anthropic"]
    assert [item["label"] for item in providers] == ["Grok", "ChatGPT", "Claude"]
    assert providers[0]["model"] == "grok-4.7"
    assert providers[1]["model"] == "chat-latest"
    assert providers[2]["model"] == "claude-opus-5-5"
    assert providers[2]["suggestions"] == ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]
    assert all(item["vision"] is True for item in providers)
    assert set(providers[0]) == {"id", "label", "vendor", "model", "suggestions", "vision"}
    body = response.json()
    assert body["streaming"] is True
    assert body["max_image_bytes"] == 1_500_000


def test_catalog_honours_env_model_override(monkeypatch) -> None:
    monkeypatch.setenv("COPILOT_ANTHROPIC_MODEL", "claude-sonnet-5-5")
    providers = TestClient(main.app).get("/api/copilot").json()["providers"]
    assert providers[2]["model"] == "claude-sonnet-5-5"
    _, _, body = build_request("anthropic", "sk-ant-test", USER)
    assert body["model"] == "claude-sonnet-5-5"


def test_missing_key_and_unknown_provider_are_rejected() -> None:
    client = TestClient(main.app)
    missing = client.post(
        "/api/copilot",
        json={"provider": "grok", "apiKey": "", "messages": [{"role": "user", "content": "Hello"}]},
    )
    unknown = client.post(
        "/api/copilot",
        json={"provider": "gemini", "apiKey": "abcdefgh", "messages": [{"role": "user", "content": "Hello"}]},
    )

    assert missing.status_code == 400
    assert "key" in missing.json()["detail"].lower()
    assert unknown.status_code == 400
    assert "Grok" in unknown.json()["detail"]


def test_build_request_shapes_for_each_provider() -> None:
    messages = [
        {"role": "assistant", "content": "skip me"},
        {"role": "user", "content": "What is on the desk?"},
    ]
    grok_url, grok_headers, grok_body = build_request("grok", "xai-test-key", messages)
    openai_url, openai_headers, openai_body = build_request("openai", "sk-test-key", messages)
    claude_url, claude_headers, claude_body = build_request("anthropic", "sk-ant-test", messages)

    assert grok_url == "https://api.x.ai/v1/responses"
    assert grok_headers["Authorization"] == "Bearer xai-test-key"
    assert grok_body["model"] == "grok-4.7"
    assert grok_body["input"][0]["role"] == "system"
    assert grok_body["input"][-1]["content"] == "What is on the desk?"
    assert grok_body["store"] is False
    assert "stream" not in grok_body

    assert openai_url == "https://api.openai.com/v1/chat/completions"
    assert openai_body["model"] == "chat-latest"
    assert openai_headers["Authorization"] == "Bearer sk-test-key"

    assert claude_url == "https://api.anthropic.com/v1/messages"
    assert claude_headers["x-api-key"] == "sk-ant-test"
    assert claude_body["model"] == "claude-opus-5-5"
    assert claude_body["messages"][0]["role"] == "user"
    assert "system" not in claude_body["messages"][0]
    assert claude_body["max_tokens"] == 16000
    assert openai_body["max_completion_tokens"] == 4000
    for body in (grok_body, openai_body, claude_body):
        assert not {"temperature", "top_p", "top_k"} & set(body)


def test_stream_flag_is_added_for_each_provider() -> None:
    for provider in ("grok", "openai", "anthropic"):
        _, _, body = build_request(provider, "test-key-123", USER, stream=True)
        assert body["stream"] is True
    _, _, claude = build_request("anthropic", "sk-ant-test", USER, stream=True)
    assert claude["max_tokens"] == 64000


def test_anthropic_headers_and_fallbacks_for_opus() -> None:
    _, headers, body = build_request("anthropic", "sk-ant-test", USER, model="claude-opus-5-5")
    assert headers["anthropic-version"] == "2026-10-21"
    assert headers["content-type"] == "application/json"
    assert headers["anthropic-beta"] == "server-side-fallback-2026-07-01"
    assert body["fallbacks"] == "default"
    assert body["output_config"] == {"effort": "low"}


def test_anthropic_haiku_gets_effort_but_no_fallbacks() -> None:
    _, headers, body = build_request("anthropic", "sk-ant-test", USER, model="claude-haiku-5-5")
    assert "anthropic-beta" not in headers
    assert "fallbacks" not in body
    assert body["output_config"] == {"effort": "low"}


def test_anthropic_older_models_get_neither_effort_nor_fallbacks() -> None:
    _, headers, body = build_request("anthropic", "sk-ant-test", USER, model="claude-4-legacy")
    assert "anthropic-beta" not in headers
    assert "fallbacks" not in body
    assert "output_config" not in body


def test_model_override_and_invalid_model() -> None:
    _, _, body = build_request("openai", "sk-test-key", USER, model="gpt-6.1-sol")
    assert body["model"] == "gpt-6.1-sol"
    _, _, default = build_request("openai", "sk-test-key", USER, model="  ")
    assert default["model"] == "chat-latest"
    for bad in ("bad model", "-leading-dash", "x" * 81, "model;rm"):
        with pytest.raises(CopilotError) as caught:
            build_request("openai", "sk-test-key", USER, model=bad)
        assert caught.value.status == 400
        assert caught.value.message == "That model name is not valid."


def test_invalid_model_is_rejected_over_http() -> None:
    response = TestClient(main.app).post(
        "/api/copilot",
        json={"provider": "grok", "apiKey": "xai-test-key", "messages": USER, "model": "no spaces"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "That model name is not valid."


def test_image_parts_for_each_provider() -> None:
    payload = JPEG.split(",", 1)[1]
    messages = [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "What is in this still?"},
    ]
    _, _, grok = build_request("grok", "xai-test-key", messages, image=JPEG)
    _, _, openai = build_request("openai", "sk-test-key", messages, image=JPEG)
    _, _, claude = build_request("anthropic", "sk-ant-test", messages, image=JPEG)

    assert grok["input"][-1]["content"] == [
        {"type": "input_text", "text": "What is in this still?"},
        {"type": "input_image", "image_url": JPEG},
    ]
    assert grok["input"][1]["content"] == "first question"
    assert openai["messages"][-1]["content"] == [
        {"type": "text", "text": "What is in this still?"},
        {"type": "image_url", "image_url": {"url": JPEG}},
    ]
    assert openai["messages"][1]["content"] == "first question"
    assert claude["messages"][-1]["content"] == [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": payload}},
        {"type": "text", "text": "What is in this still?"},
    ]
    assert claude["messages"][0]["content"] == "first question"


@pytest.mark.parametrize(
    ("image", "needle"),
    [
        ("https://example.com/cat.jpg", "data URL"),
        ("data:image/gif;base64,R0lGODlh", "JPEG, PNG, or WebP"),
        ("data:image/png;base64,***not-base64***", "base64"),
        (12345, "data URL"),
    ],
)
def test_image_validation_errors(image, needle: str) -> None:
    with pytest.raises(CopilotError) as caught:
        build_request("grok", "xai-test-key", USER, image=image)
    assert caught.value.status == 400
    assert needle in caught.value.message


def test_image_size_limit() -> None:
    big = "data:image/png;base64," + base64.b64encode(b"\0" * 1_500_001).decode()
    with pytest.raises(CopilotError) as caught:
        build_request("grok", "xai-test-key", USER, image=big)
    assert "1.5 MB" in caught.value.message
    ok = "data:image/webp;base64," + base64.b64encode(b"\0" * 1_500_000).decode()
    build_request("grok", "xai-test-key", USER, image=ok)


def test_extract_text_reads_responses_output_and_claude_refusal() -> None:
    payload = {
        "output": [
            {"type": "reasoning", "content": [{"type": "reasoning_text", "text": "thinking"}]},
            {"type": "message", "content": [{"type": "output_text", "text": "A mug."}]},
        ]
    }
    assert extract_text(payload) == "A mug."
    assert extract_text({"content": [], "stop_reason": "refusal"}) == "Claude declined to answer that one."


def test_http_error_mapping_redacts_the_key() -> None:
    assert http_error(401, "", "k", "m").status == 401
    assert http_error(403, "", "k", "m").message == "The provider rejected that API key."
    assert http_error(404, "", "k", "grok-9").message == "The provider does not recognise the model grok-9."
    assert http_error(429, "", "k", "m").status == 429
    assert (http_error(503, "", "k", "m").status, http_error(503, "", "k", "m").message) == (
        502,
        "The provider had an error. Try again.",
    )
    detail = json.dumps({"error": {"message": "Key sk-secret-123 cannot use " + "x" * 400}})
    error = http_error(400, detail, "sk-secret-123", "m")
    assert error.status == 400
    assert "sk-secret-123" not in error.message
    assert error.message.startswith("Key [key] cannot use")
    assert len(error.message) <= 240


def test_extract_text_reads_each_provider_shape() -> None:
    assert extract_text({"output_text": " From Grok "}) == "From Grok"
    assert extract_text({"choices": [{"message": {"content": "From ChatGPT"}}]}) == "From ChatGPT"
    assert extract_text({"content": [{"type": "text", "text": "From Claude"}]}) == "From Claude"


def test_reply_does_not_echo_the_key(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_post(url: str, headers: dict[str, str], body: dict[str, object], timeout: float) -> dict[str, str]:
        seen["url"] = url
        seen["authorization"] = headers.get("Authorization")
        seen["model"] = body.get("model")
        return {"output_text": "A cup is on the desk."}

    monkeypatch.setattr("app.copilot.post_json", fake_post)
    client = TestClient(main.app)
    response = client.post(
        "/api/copilot",
        json={
            "provider": "grok",
            "apiKey": "xai-test-key",
            "messages": [{"role": "user", "content": "What is on the desk?"}],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["reply"] == "A cup is on the desk."
    assert payload["model"] == "grok-4.7"
    assert "xai-test-key" not in response.text
    assert seen["url"] == "https://api.x.ai/v1/responses"
    assert seen["authorization"] == "Bearer xai-test-key"


def test_redact_removes_the_key_and_conversation_drops_a_leading_assistant() -> None:
    assert "secret-key" not in redact("provider said secret-key is bad", "secret-key")
    turns = conversation(
        [
            {"role": "assistant", "content": "earlier"},
            {"role": "user", "content": "  hello   there  "},
        ]
    )
    assert turns == [{"role": "user", "content": "hello there"}]


# --- Streaming ---------------------------------------------------------------

CHAT_LINES = [
    'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}',
    "",
    'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"A cup"}}]}',
    "",
    'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" is here."}}]}',
    "",
    'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    "",
    "data: [DONE]",
    "",
]

RESPONSES_LINES = [
    "event: response.created",
    'data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}',
    "",
    "event: response.output_text.delta",
    'data: {"type":"response.output_text.delta","item_id":"m1","output_index":0,"content_index":0,"delta":"A laptop"}',
    "",
    "event: response.output_text.delta",
    'data: {"type":"response.output_text.delta","item_id":"m1","output_index":0,"content_index":0,"delta":" is open."}',
    "",
    "event: response.completed",
    'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}',
    "",
]

MESSAGES_LINES = [
    "event: message_start",
    'data: {"type":"message_start","message":{"id":"msg_1","role":"assistant","content":[]}}',
    "",
    "event: content_block_start",
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    "",
    ": keep-alive comment",
    "event: ping",
    'data: {"type": "ping"}',
    "",
    "event: content_block_delta",
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"One person"}}',
    "",
    "event: content_block_delta",
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" at the desk."}}',
    "",
    "event: content_block_stop",
    'data: {"type":"content_block_stop","index":0}',
    "",
    "event: message_delta",
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":6}}',
    "",
    "event: message_stop",
    'data: {"type":"message_stop"}',
    "",
]


def _parsed(api: str, lines: list[str]) -> list:
    return [item for event, data in iter_sse(lines) if (item := parse_stream_event(api, event, data))]


def test_iter_sse_handles_events_multiline_data_comments_and_a_trailing_event() -> None:
    lines = [": hello", "event: one", "data: a", "data: b", "", "", "data: plain", "", "event: tail", "data: last"]
    assert list(iter_sse(lines)) == [("one", "a\nb"), ("message", "plain"), ("tail", "last")]
    assert list(iter_sse(["data:no-space", ""])) == [("message", "no-space")]
    assert list(iter_sse(["event: lonely", "", ""])) == []


def test_parse_chat_stream() -> None:
    assert _parsed("chat", CHAT_LINES) == [("delta", "A cup"), ("delta", " is here."), ("stop", "stop"), ("done", None)]
    assert parse_stream_event("chat", "message", '{"error":{"message":"quota"}}') == ("error", "quota")


def test_parse_responses_stream() -> None:
    assert _parsed("responses", RESPONSES_LINES) == [
        ("delta", "A laptop"),
        ("delta", " is open."),
        ("done", None),
    ]
    failed = '{"type":"response.failed","response":{"error":{"code":"server_error","message":"boom"}}}'
    assert parse_stream_event("responses", "response.failed", failed) == ("error", "boom")
    assert parse_stream_event("responses", "error", '{"type":"error","message":"bad"}') == ("error", "bad")


def test_parse_messages_stream() -> None:
    assert _parsed("messages", MESSAGES_LINES) == [
        ("delta", "One person"),
        ("delta", " at the desk."),
        ("stop", "end_turn"),
        ("done", None),
    ]
    overloaded = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'
    assert parse_stream_event("messages", "error", overloaded) == ("error", "Overloaded")
    assert parse_stream_event("messages", "ping", "not json") is None


def _sse_events(text: str) -> list[tuple[str, dict]]:
    return [(event, json.loads(data)) for event, data in iter_sse(text.splitlines())]


def _fake_stream(lines: list[str], seen: dict | None = None, error: CopilotError | None = None):
    async def fake_open(url, headers, body, timeout):
        if seen is not None:
            seen.update(url=url, headers=headers, body=body)
        if error is not None:
            raise error
        for line in lines:
            yield line

    return fake_open


def _stream_post(payload: dict):
    return TestClient(main.app).post("/api/copilot/stream", json=payload)


def test_stream_endpoint_emits_deltas_then_done(monkeypatch) -> None:
    seen: dict = {}
    monkeypatch.setattr(copilot, "open_provider_stream", _fake_stream(MESSAGES_LINES, seen))
    response = _stream_post({"provider": "anthropic", "apiKey": "sk-ant-secret", "messages": USER, "image": JPEG})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    assert response.text.startswith('event: delta\ndata: {"text": "One person"}\n\n')
    events = _sse_events(response.text)
    assert events == [
        ("delta", {"text": "One person"}),
        ("delta", {"text": " at the desk."}),
        ("done", {"provider": "anthropic", "model": "claude-opus-5-5", "label": "Claude", "stop_reason": "end_turn"}),
    ]
    assert seen["body"]["stream"] is True
    assert seen["body"]["max_tokens"] == 64000
    assert seen["body"]["messages"][-1]["content"][0]["type"] == "image"
    assert "sk-ant-secret" not in response.text


@pytest.mark.parametrize(("provider", "lines"), [("openai", CHAT_LINES), ("grok", RESPONSES_LINES)])
def test_stream_endpoint_for_chat_and_responses(monkeypatch, provider: str, lines: list[str]) -> None:
    monkeypatch.setattr(copilot, "open_provider_stream", _fake_stream(lines))
    response = _stream_post({"provider": provider, "apiKey": "secret-key-123", "messages": USER})
    events = _sse_events(response.text)
    assert [event for event, _ in events] == ["delta", "delta", "done"]
    assert events[-1][1]["provider"] == provider


def test_stream_endpoint_reports_provider_errors_as_an_error_event(monkeypatch) -> None:
    failure = CopilotError(401, "The provider rejected that API key.")
    monkeypatch.setattr(copilot, "open_provider_stream", _fake_stream([], error=failure))
    response = _stream_post({"provider": "grok", "apiKey": "xai-secret-key", "messages": USER})
    assert response.status_code == 200
    assert _sse_events(response.text) == [("error", {"status": 401, "message": "The provider rejected that API key."})]
    assert "xai-secret-key" not in response.text


def test_stream_endpoint_redacts_mid_stream_errors(monkeypatch) -> None:
    lines = [
        'data: {"choices":[{"delta":{"content":"Part"}}]}',
        "",
        'data: {"error":{"message":"key sk-leaky-key-1 exhausted"}}',
        "",
    ]
    monkeypatch.setattr(copilot, "open_provider_stream", _fake_stream(lines))
    response = _stream_post({"provider": "openai", "apiKey": "sk-leaky-key-1", "messages": USER})
    events = _sse_events(response.text)
    assert events[0] == ("delta", {"text": "Part"})
    assert events[-1][0] == "error"
    assert [event for event, _ in events].count("error") == 1
    assert "done" not in [event for event, _ in events]
    assert "sk-leaky-key-1" not in response.text


def test_stream_endpoint_reports_refusals(monkeypatch) -> None:
    lines = [
        "event: message_start",
        'data: {"type":"message_start","message":{"id":"msg_2","content":[]}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}',
        "",
        "event: message_stop",
        'data: {"type":"message_stop"}',
        "",
    ]
    monkeypatch.setattr(copilot, "open_provider_stream", _fake_stream(lines))
    response = _stream_post({"provider": "anthropic", "apiKey": "sk-ant-secret", "messages": USER})
    events = _sse_events(response.text)
    assert events == [
        ("done", {"provider": "anthropic", "model": "claude-opus-5-5", "label": "Claude", "stop_reason": "refusal"})
    ]


def test_stream_endpoint_validates_before_streaming(monkeypatch) -> None:
    called: list[bool] = []

    async def never(url, headers, body, timeout):
        called.append(True)
        yield ""

    monkeypatch.setattr(copilot, "open_provider_stream", never)
    bad_image = _stream_post({"provider": "grok", "apiKey": "xai-test-key", "messages": USER, "image": "nope"})
    missing_key = _stream_post({"provider": "grok", "apiKey": "", "messages": USER})
    assert bad_image.status_code == 400
    assert bad_image.headers["content-type"].startswith("application/json")
    assert "detail" in bad_image.json()
    assert missing_key.status_code == 400
    assert called == []


def test_stream_releases_its_copilot_slot(monkeypatch) -> None:
    monkeypatch.setattr(copilot, "open_provider_stream", _fake_stream(CHAT_LINES))
    for _ in range(3):
        response = _stream_post({"provider": "openai", "apiKey": "sk-test-key", "messages": USER})
        assert response.status_code == 200
    assert main._COPILOT_SLOTS == {}


def test_non_stream_reply_with_image_and_model(monkeypatch) -> None:
    seen: dict = {}

    def fake_post(url, headers, body, timeout):
        seen.update(body=body)
        return {"content": [{"type": "text", "text": "A mug."}], "stop_reason": "end_turn"}

    monkeypatch.setattr("app.copilot.post_json", fake_post)
    response = TestClient(main.app).post(
        "/api/copilot",
        json={
            "provider": "anthropic",
            "apiKey": "sk-ant-secret",
            "messages": USER,
            "model": "claude-haiku-5-5",
            "image": JPEG,
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "provider": "anthropic",
        "model": "claude-haiku-5-5",
        "label": "Claude",
        "reply": "A mug.",
    }
    assert seen["body"]["messages"][0]["content"][0]["type"] == "image"
    assert "sk-ant-secret" not in response.text


def test_non_stream_provider_error_does_not_echo_the_key(monkeypatch) -> None:
    def fake_post(url, headers, body, timeout):
        raise http_error(400, '{"error":{"message":"bad key sk-ant-secret"}}', "sk-ant-secret", body["model"])

    monkeypatch.setattr("app.copilot.post_json", fake_post)
    response = TestClient(main.app).post(
        "/api/copilot",
        json={"provider": "anthropic", "apiKey": "sk-ant-secret", "messages": USER},
    )
    assert response.status_code == 400
    assert "sk-ant-secret" not in response.text


def test_history_keeps_line_breaks_but_collapses_spaces() -> None:
    turns = conversation(
        [
            {"role": "user", "content": "List it"},
            {"role": "assistant", "content": "Here:\n\n\n\n- one   item\n- two\r\n\n```\ncode\n```"},
            {"role": "user", "content": "  thanks   "},
        ]
    )
    assert turns[1]["content"] == "Here:\n\n- one item\n- two\n\n```\ncode\n```"
    assert turns[2]["content"] == "thanks"
