"""Studio copilot. The browser sends a provider key with each question.

The key is used once for that request and is never written to disk or logs.
All three providers are called over plain HTTP (no vendor SDKs) so the module
stays provider-neutral and easy to audit.
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import urllib.error
import urllib.request
from collections.abc import AsyncIterator, Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any

SYSTEM_PROMPT = (
    "You are the studio copilot beside a local object-detection console. "
    "Answer the operator's question in plain sentences. When they include scene labels, "
    "use those labels and do not invent objects that are not listed. "
    "You cannot see the live camera. If the operator attaches a still from the camera, "
    "describe only what is visible in it. "
    "Your reply stays on their computer and is not part of the outgoing picture."
)

PROVIDERS: dict[str, dict[str, Any]] = {
    "grok": {
        "label": "Grok",
        "vendor": "xAI",
        "api": "responses",
        "url": "https://api.x.ai/v1/responses",
        "model": "grok-4.7",
        "suggestions": ["grok-4.7", "grok-4.6", "grok-4.5"],
        "env": "COPILOT_GROK_MODEL",
    },
    "openai": {
        "label": "ChatGPT",
        "vendor": "OpenAI",
        "api": "chat",
        "url": "https://api.openai.com/v1/chat/completions",
        "model": "chat-latest",
        "suggestions": ["chat-latest", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"],
        "env": "COPILOT_OPENAI_MODEL",
    },
    "anthropic": {
        "label": "Claude",
        "vendor": "Anthropic",
        "api": "messages",
        "url": "https://api.anthropic.com/v1/messages",
        "model": "claude-opus-5-5",
        "suggestions": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
        "env": "COPILOT_ANTHROPIC_MODEL",
    },
}

ANTHROPIC_VERSION = "2026-10-21"
ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01"
ANTHROPIC_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}
ANTHROPIC_EFFORT_PATTERN = re.compile(r"^claude-(opus|sonnet|haiku|fable|mythos)-5")
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$")
IMAGE_PATTERN = re.compile(r"^data:([A-Za-z0-9.+/-]+);base64,(.*)$", re.DOTALL)
IMAGE_MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 1_500_000

MAX_MESSAGES = 12
MAX_CHARS = 4000
REFUSAL_REPLY = "Claude declined to answer that one."


class CopilotError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def default_model(provider: str) -> str:
    spec = PROVIDERS[provider]
    override = os.getenv(spec["env"], "").strip()
    if override and MODEL_PATTERN.match(override):
        return override
    return spec["model"]


def provider_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": key,
            "label": item["label"],
            "vendor": item["vendor"],
            "model": default_model(key),
            "suggestions": list(item["suggestions"]),
            "vision": True,
        }
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


def resolve_model(provider: str, model: object) -> str:
    if model is None:
        return default_model(provider)
    if not isinstance(model, str):
        raise CopilotError(400, "That model name is not valid.")
    name = model.strip()
    if not name:
        return default_model(provider)
    if not MODEL_PATTERN.match(name):
        raise CopilotError(400, "That model name is not valid.")
    return name


@dataclass(frozen=True)
class Still:
    media_type: str
    data: str  # base64 payload, no prefix

    @property
    def data_url(self) -> str:
        return f"data:{self.media_type};base64,{self.data}"


def parse_image(image: object) -> Still | None:
    if image is None or image == "":
        return None
    if not isinstance(image, str):
        raise CopilotError(400, "Attach the still as a data URL.")
    match = IMAGE_PATTERN.match(image.strip())
    if not match:
        raise CopilotError(400, "Attach the still as a base64 data URL (data:image/jpeg;base64,...).")
    media_type = match.group(1).lower()
    if media_type not in IMAGE_MEDIA_TYPES:
        raise CopilotError(400, "Attach a JPEG, PNG, or WebP still.")
    payload = "".join(match.group(2).split())
    if not payload:
        raise CopilotError(400, "The attached still is empty.")
    if len(payload) > (MAX_IMAGE_BYTES * 4) // 3 + 8:
        raise CopilotError(400, "The attached still is larger than 1.5 MB.")
    try:
        decoded = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise CopilotError(400, "The attached still is not valid base64.") from exc
    if not decoded:
        raise CopilotError(400, "The attached still is empty.")
    if len(decoded) > MAX_IMAGE_BYTES:
        raise CopilotError(400, "The attached still is larger than 1.5 MB.")
    return Still(media_type=media_type, data=payload)


def _image_turn(api: str, text: str, still: Still) -> list[dict[str, Any]]:
    if api == "responses":
        return [{"type": "input_text", "text": text}, {"type": "input_image", "image_url": still.data_url}]
    if api == "chat":
        return [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": still.data_url}}]
    return [
        {"type": "image", "source": {"type": "base64", "media_type": still.media_type, "data": still.data}},
        {"type": "text", "text": text},
    ]


def _turns(api: str, turns: list[dict[str, str]], still: Still | None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = [dict(turn) for turn in turns]
    if still is None:
        return result
    for turn in reversed(result):
        if turn["role"] == "user":
            turn["content"] = _image_turn(api, turn["content"], still)
            break
    return result


def build_request(
    provider: str,
    api_key: str,
    messages: object,
    *,
    model: object = None,
    image: object = None,
    stream: bool = False,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    spec = PROVIDERS.get(provider)
    if spec is None:
        raise CopilotError(400, "Pick Grok, ChatGPT, or Claude.")
    key = _require_key(api_key)
    name = resolve_model(provider, model)
    still = parse_image(image)
    turns = _turns(spec["api"], conversation(messages), still)
    body: dict[str, Any]
    if spec["api"] == "responses":
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        body = {
            "model": name,
            "input": [{"role": "system", "content": SYSTEM_PROMPT}, *turns],
            "store": False,
        }
    elif spec["api"] == "chat":
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        body = {
            "model": name,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *turns],
            "max_completion_tokens": 4000,
        }
    else:
        headers = {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        body = {
            "model": name,
            "max_tokens": 64000 if stream else 16000,
            "system": SYSTEM_PROMPT,
            "messages": turns,
        }
        if ANTHROPIC_EFFORT_PATTERN.match(name):
            body["output_config"] = {"effort": "low"}
        if name in ANTHROPIC_FALLBACK_MODELS:
            headers["anthropic-beta"] = ANTHROPIC_FALLBACK_BETA
            body["fallbacks"] = "default"
    if stream:
        body["stream"] = True
    return spec["url"], headers, body


def _secret_from(headers: dict[str, str]) -> str:
    secret = headers.get("Authorization", "").removeprefix("Bearer ").strip()
    return secret or headers.get("x-api-key", "")


def _provider_message(detail: str) -> str:
    try:
        payload = json.loads(detail)
    except (json.JSONDecodeError, TypeError):
        return detail
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"]
        if isinstance(error, str):
            return error
        if isinstance(payload.get("message"), str):
            return payload["message"]
    return detail


def http_error(status: int, detail: str, secret: str, model: str) -> CopilotError:
    """Map a provider HTTP status to a safe, operator-facing error."""
    if status in {401, 403}:
        return CopilotError(401, "The provider rejected that API key.")
    if status == 404:
        return CopilotError(404, f"The provider does not recognise the model {model}.")
    if status == 429:
        return CopilotError(429, "The provider is rate limiting this key. Try again shortly.")
    if status >= 500:
        return CopilotError(502, "The provider had an error. Try again.")
    message = redact(_provider_message(detail), secret) or "The model provider rejected the request."
    return CopilotError(400, message)


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
                    if not isinstance(part, dict) or not isinstance(part.get("text"), str):
                        continue
                    if part.get("type", "output_text") in {"output_text", "text"}:
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
    if payload.get("stop_reason") == "refusal":
        return REFUSAL_REPLY
    raise CopilotError(502, "The model response did not include text.")


def post_json(url: str, headers: dict[str, str], body: dict[str, Any], timeout: float) -> object:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(2_000_000)
    except urllib.error.HTTPError as exc:
        detail = exc.read(4000).decode("utf-8", errors="replace")
        raise http_error(exc.code, detail, _secret_from(headers), str(body.get("model", ""))) from exc
    except TimeoutError as exc:
        raise CopilotError(504, "The model took too long.") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise CopilotError(504, "The model took too long.") from exc
        raise CopilotError(502, "Could not reach the model provider.") from exc
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise CopilotError(502, "The model response was not JSON.") from exc


@dataclass(frozen=True)
class PreparedCall:
    provider: str
    model: str
    url: str
    headers: dict[str, str] = field(repr=False)
    body: dict[str, Any] = field(repr=False)

    @property
    def api(self) -> str:
        return PROVIDERS[self.provider]["api"]

    @property
    def label(self) -> str:
        return PROVIDERS[self.provider]["label"]

    @property
    def secret(self) -> str:
        return _secret_from(self.headers)


def prepare_call(payload: object, *, stream: bool = False) -> PreparedCall:
    if not isinstance(payload, dict):
        raise CopilotError(400, "Expected a JSON object.")
    provider = str(payload.get("provider") or "")
    url, headers, body = build_request(
        provider,
        str(payload.get("apiKey") or ""),
        payload.get("messages"),
        model=payload.get("model"),
        image=payload.get("image"),
        stream=stream,
    )
    return PreparedCall(provider=provider, model=str(body["model"]), url=url, headers=headers, body=body)


def ask_prepared(call: PreparedCall, timeout: float = 60) -> dict[str, str]:
    payload = post_json(call.url, call.headers, call.body, timeout)
    return {"provider": call.provider, "model": call.model, "label": call.label, "reply": extract_text(payload)}


def ask_copilot(
    provider: str,
    api_key: str,
    messages: object,
    timeout: float = 60,
    *,
    model: object = None,
    image: object = None,
) -> dict[str, str]:
    call = prepare_call(
        {"provider": provider, "apiKey": api_key, "messages": messages, "model": model, "image": image}
    )
    return ask_prepared(call, timeout)


# --- Streaming -------------------------------------------------------------


class SSEParser:
    """Incremental text/event-stream parser: feed lines, get (event, data) pairs."""

    def __init__(self) -> None:
        self._event = ""
        self._data: list[str] = []

    def feed(self, line: str) -> tuple[str, str] | None:
        line = line.rstrip("\r\n")
        if line == "":
            return self._dispatch()
        if line.startswith(":"):
            return None
        name, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if name == "event":
            self._event = value
        elif name == "data":
            self._data.append(value)
        return None

    def flush(self) -> tuple[str, str] | None:
        return self._dispatch()

    def _dispatch(self) -> tuple[str, str] | None:
        if not self._data:
            self._event = ""
            return None
        pair = (self._event or "message", "\n".join(self._data))
        self._event = ""
        self._data = []
        return pair


def iter_sse(lines: Iterable[str]) -> Iterator[tuple[str, str]]:
    parser = SSEParser()
    for raw in lines:
        # A chunk may carry several lines; split defensively.
        for line in raw.splitlines() or [""]:
            pair = parser.feed(line)
            if pair is not None:
                yield pair
    tail = parser.flush()
    if tail is not None:
        yield tail


async def aiter_sse(lines: AsyncIterator[str]) -> AsyncIterator[tuple[str, str]]:
    parser = SSEParser()
    async for raw in lines:
        for line in raw.splitlines() or [""]:
            pair = parser.feed(line)
            if pair is not None:
                yield pair
    tail = parser.flush()
    if tail is not None:
        yield tail


StreamEvent = tuple[str, str | None]


def _error_message(obj: dict[str, Any], fallback: str) -> str:
    error = obj.get("error")
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"]
    if isinstance(error, str) and error:
        return error
    if isinstance(obj.get("message"), str) and obj["message"]:
        return obj["message"]
    return fallback


def parse_stream_event(api: str, event: str, data: str) -> StreamEvent | None:
    text = data.strip()
    if api == "chat" and text == "[DONE]":
        return ("done", None)
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None

    if api == "chat":
        if "error" in obj:
            return ("error", _error_message(obj, "The provider reported an error."))
        choices = obj.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            choice = choices[0]
            delta = choice.get("delta")
            if isinstance(delta, dict) and isinstance(delta.get("content"), str) and delta["content"]:
                return ("delta", delta["content"])
            if isinstance(delta, dict) and isinstance(delta.get("refusal"), str) and delta["refusal"]:
                return ("delta", delta["refusal"])
            if isinstance(choice.get("finish_reason"), str):
                return ("stop", choice["finish_reason"])
        return None

    kind = obj.get("type") or event
    if api == "responses":
        if kind == "response.output_text.delta" and isinstance(obj.get("delta"), str):
            return ("delta", obj["delta"])
        if kind == "response.completed":
            return ("done", None)
        if kind == "response.incomplete":
            response = obj.get("response")
            details = response.get("incomplete_details") if isinstance(response, dict) else None
            reason = details.get("reason") if isinstance(details, dict) else None
            return ("stop", str(reason or "incomplete"))
        if kind == "response.failed":
            response = obj.get("response")
            source = response if isinstance(response, dict) else obj
            return ("error", _error_message(source, "The model could not finish that answer."))
        if kind == "error":
            return ("error", _error_message(obj, "The provider reported an error."))
        return None

    # Anthropic Messages API
    if kind == "content_block_delta":
        delta = obj.get("delta")
        if isinstance(delta, dict) and delta.get("type") == "text_delta" and isinstance(delta.get("text"), str):
            return ("delta", delta["text"])
        return None
    if kind == "message_delta":
        delta = obj.get("delta")
        reason = delta.get("stop_reason") if isinstance(delta, dict) else None
        return ("stop", reason) if isinstance(reason, str) else None
    if kind == "message_stop":
        return ("done", None)
    if kind == "error":
        return ("error", _error_message(obj, "The provider reported an error."))
    return None


async def open_provider_stream(
    url: str, headers: dict[str, str], body: dict[str, Any], timeout: float
) -> AsyncIterator[str]:
    """Yield raw text lines from the provider. Tests monkeypatch this seam."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code >= 400:
                    detail = (await response.aread())[:4000].decode("utf-8", errors="replace")
                    raise http_error(response.status_code, detail, _secret_from(headers), str(body.get("model", "")))
                async for line in response.aiter_lines():
                    yield line
    except httpx.TimeoutException as exc:
        raise CopilotError(504, "The model took too long.") from exc
    except httpx.TransportError as exc:
        raise CopilotError(502, "Could not reach the model provider.") from exc


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_copilot(call: PreparedCall, timeout: float = 90) -> AsyncIterator[str]:
    """Translate a provider stream into delta/done/error events. Ends with exactly one done or error."""
    stop_reason: str | None = None
    secret = call.secret
    lines: Any = None
    events: Any = None
    try:
        lines = globals()["open_provider_stream"](call.url, call.headers, call.body, timeout)
        events = aiter_sse(lines)
        async for event, data in events:
            parsed = parse_stream_event(call.api, event, data)
            if parsed is None:
                continue
            kind, value = parsed
            if kind == "delta" and value:
                yield sse("delta", {"text": value})
            elif kind == "stop":
                stop_reason = value
            elif kind == "done":
                break
            elif kind == "error":
                message = redact(value or "", secret) or "The provider reported an error."
                yield sse("error", {"status": 502, "message": message})
                return
    except CopilotError as exc:
        yield sse("error", {"status": exc.status, "message": redact(exc.message, secret)})
        return
    except Exception:  # noqa: BLE001 - never leak internals into the stream
        yield sse("error", {"status": 502, "message": "Could not reach the model provider."})
        return
    finally:
        for source in (events, lines):
            closer = getattr(source, "aclose", None)
            if closer is not None:
                try:
                    await closer()
                except Exception:  # noqa: BLE001 - best-effort cleanup
                    pass
    yield sse(
        "done",
        {"provider": call.provider, "model": call.model, "label": call.label, "stop_reason": stop_reason},
    )
