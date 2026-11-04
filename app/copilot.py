"""Studio copilot. The browser sends a provider key with each question.

The key is used once for that request and is never written to disk or logs.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

SYSTEM_PROMPT = (
    "You are the studio copilot beside a local object-detection console. "
    "Answer the operator's question in plain sentences. When they include scene labels, "
    "use those labels and do not invent objects that are not listed. "
    "You cannot see the camera. Your reply stays on their computer and is not part of the outgoing picture."
)

PROVIDERS: dict[str, dict[str, str]] = {
    "grok": {
        "label": "Grok",
        "model": "grok-4.7",
        "vendor": "xAI",
        "url": "https://api.x.ai/v1/responses",
    },
    "openai": {
        "label": "ChatGPT",
        "model": "chat-latest",
        "vendor": "OpenAI",
        "url": "https://api.openai.com/v1/chat/completions",
    },
    "anthropic": {
        "label": "Claude",
        "model": "claude-sonnet-5",
        "vendor": "Anthropic",
        "url": "https://api.anthropic.com/v1/messages",
    },
}

MAX_MESSAGES = 12
MAX_CHARS = 4000


class CopilotError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def provider_catalog() -> list[dict[str, str]]:
    return [
        {"id": key, "label": item["label"], "model": item["model"], "vendor": item["vendor"]}
        for key, item in PROVIDERS.items()
    ]


def redact(text: str, secret: str) -> str:
    cleaned = text.replace(secret, "[key]") if secret else text
    return " ".join(cleaned.split())[:240]


def conversation(messages: object) -> list[dict[str, str]]:
    if not isinstance(messages, list):
        raise CopilotError(400, "Messages must be a list.")
    cleaned: list[dict[str, str]] = []
    for message in messages[-MAX_MESSAGES:]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = message.get("content")
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        text = " ".join(content.split())[:MAX_CHARS]
        if not text:
            continue
        if cleaned and cleaned[-1]["role"] == role:
            cleaned[-1]["content"] = f"{cleaned[-1]['content']}\n{text}"[:MAX_CHARS]
        else:
            cleaned.append({"role": role, "content": text})
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)
    if not cleaned:
        raise CopilotError(400, "Write a message first.")
    return cleaned


def _require_key(api_key: str) -> str:
    key = api_key.strip()
    if not key:
        raise CopilotError(400, "Add an API key for the model you picked.")
    if any(char.isspace() for char in key) or len(key) < 8 or len(key) > 400:
        raise CopilotError(400, "That API key does not look usable.")
    return key


def build_request(provider: str, api_key: str, messages: object) -> tuple[str, dict[str, str], dict[str, object]]:
    spec = PROVIDERS.get(provider)
    if spec is None:
        raise CopilotError(400, "Pick Grok, ChatGPT, or Claude.")
    key = _require_key(api_key)
    turns = conversation(messages)
    if provider == "grok":
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        body: dict[str, object] = {
            "model": spec["model"],
            "input": [{"role": "system", "content": SYSTEM_PROMPT}, *turns],
        }
    elif provider == "openai":
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        body = {
            "model": spec["model"],
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *turns],
            "max_completion_tokens": 700,
        }
    else:
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": spec["model"],
            "max_tokens": 700,
            "system": SYSTEM_PROMPT,
            "messages": turns,
        }
    return spec["url"], headers, body


def extract_text(payload: object) -> str:
    if not isinstance(payload, dict):
        raise CopilotError(502, "The model response was not JSON.")
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    output = payload.get("output")
    if isinstance(output, list):
        chunks: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if isinstance(content, str) and content.strip():
                chunks.append(content.strip())
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        chunks.append(part["text"])
        joined = "\n".join(chunk for chunk in chunks if chunk).strip()
        if joined:
            return joined
    choices = payload.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message")
        if isinstance(message, dict) and isinstance(message.get("content"), str):
            text = message["content"].strip()
            if text:
                return text
    content = payload.get("content")
    if isinstance(content, list):
        chunks = [
            part["text"].strip()
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str) and part["text"].strip()
        ]
        if chunks:
            return "\n".join(chunks)
    raise CopilotError(502, "The model response did not include text.")


def post_json(url: str, headers: dict[str, str], body: dict[str, object], timeout: float) -> object:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(1_000_000)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4000).decode("utf-8", errors="replace")
        secret = headers.get("Authorization", "").removeprefix("Bearer ").strip()
        secret = secret or headers.get("x-api-key", "")
        message = redact(detail, secret) or "The model provider rejected the request."
        status = 401 if exc.code in {401, 403} else 502
        if status == 401:
            message = "The provider rejected that API key."
        raise CopilotError(status, message) from exc
    except TimeoutError as exc:
        raise CopilotError(504, "The model took too long.") from exc
    except urllib.error.URLError as exc:
        raise CopilotError(502, "Could not reach the model provider.") from exc
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise CopilotError(502, "The model response was not JSON.") from exc


def ask_copilot(provider: str, api_key: str, messages: object, timeout: float = 45) -> dict[str, str]:
    url, headers, body = build_request(provider, api_key, messages)
    payload = post_json(url, headers, body, timeout)
    spec = PROVIDERS[provider]
    return {
        "provider": provider,
        "model": spec["model"],
        "label": spec["label"],
        "reply": extract_text(payload),
    }
