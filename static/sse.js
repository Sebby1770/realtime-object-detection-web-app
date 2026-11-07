/**
 * Server-sent events over fetch(). The parser is pure and incremental:
 * feed it text chunks as they arrive, it calls back once per complete event.
 */

export function createSseParser(onEvent) {
  let buffer = "";
  let event = "message";
  let data = [];

  function dispatch() {
    if (data.length) {
      onEvent({ event, data: data.join("\n") });
    }
    event = "message";
    data = [];
  }

  function line(text) {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) {
      return;
    }
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      event = value || "message";
    } else if (field === "data") {
      data.push(value);
    }
  }

  return {
    push(chunk) {
      buffer += chunk;
      let index;
      while ((index = buffer.search(/\r\n|\n|\r/)) >= 0) {
        if (buffer[index] === "\r" && index === buffer.length - 1) {
          break; // a "\n" may still arrive in the next chunk
        }
        const newline = buffer.startsWith("\r\n", index) ? 2 : 1;
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + newline);
      }
    },
    end() {
      if (buffer) {
        line(buffer);
        buffer = "";
      }
      dispatch();
    },
  };
}

/** Read a fetch Response body as SSE; resolves when the stream ends. */
export async function readEventStream(response, onEvent, { signal } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  const abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
