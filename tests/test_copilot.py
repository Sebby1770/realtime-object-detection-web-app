from fastapi.testclient import TestClient

from app import main
from app.copilot import build_request, conversation, extract_text, redact


def test_catalog_lists_grok_chatgpt_and_claude() -> None:
    client = TestClient(main.app)
    response = client.get("/api/copilot")

    assert response.status_code == 200
    providers = response.json()["providers"]
    assert [item["id"] for item in providers] == ["grok", "openai", "anthropic"]
    assert [item["label"] for item in providers] == ["Grok", "ChatGPT", "Claude"]
    assert providers[0]["model"] == "grok-4.7"
    assert providers[1]["model"] == "chat-latest"
    assert providers[2]["model"] == "claude-sonnet-5"


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

    assert openai_url == "https://api.openai.com/v1/chat/completions"
    assert openai_body["model"] == "chat-latest"
    assert openai_headers["Authorization"] == "Bearer sk-test-key"

    assert claude_url == "https://api.anthropic.com/v1/messages"
    assert claude_headers["x-api-key"] == "sk-ant-test"
    assert claude_body["model"] == "claude-sonnet-5"
    assert claude_body["messages"][0]["role"] == "user"
    assert "system" not in claude_body["messages"][0]


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
