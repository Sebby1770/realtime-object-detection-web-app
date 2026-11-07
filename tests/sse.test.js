import assert from "node:assert/strict";
import test from "node:test";
import { createSseParser } from "../static/sse.js";

function collect(chunks) {
  const events = [];
  const parser = createSseParser((event) => events.push(event));
  for (const chunk of chunks) {
    parser.push(chunk);
  }
  parser.end();
  return events;
}

test("named events with JSON data", () => {
  const events = collect(['event: delta\ndata: {"text":"Hel"}\n\n', 'event: delta\ndata: {"text":"lo"}\n\nevent: done\ndata: {}\n\n']);
  assert.deepEqual(
    events.map((event) => event.event),
    ["delta", "delta", "done"],
  );
  assert.equal(JSON.parse(events[1].data).text, "lo");
});

test("an event split across chunks, mid-line, is reassembled", () => {
  const events = collect(["event: del", 'ta\nda', 'ta: {"text":"x"}', "\n", "\n"]);
  assert.deepEqual(events, [{ event: "delta", data: '{"text":"x"}' }]);
});

test("CRLF line endings, including a CR at a chunk boundary", () => {
  const events = collect(["event: done\r", "\ndata: {}\r\n\r\n"]);
  assert.deepEqual(events, [{ event: "done", data: "{}" }]);
});

test("comments are ignored and multi-line data joins with newlines", () => {
  const events = collect([": keep-alive\n\ndata: one\ndata: two\n\n"]);
  assert.deepEqual(events, [{ event: "message", data: "one\ntwo" }]);
});

test("a final event without a trailing blank line is still delivered", () => {
  const events = collect(['event: error\ndata: {"status":401}']);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "error");
});
