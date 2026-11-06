import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown } from "../static/markdown.js";

test("paragraphs, headings, lists and fenced code become blocks", () => {
  const blocks = parseMarkdown("# Desk\n\nA **laptop** and a cup.\n\n- one\n- two\n\n1. first\n2. second\n\n```\nprint('hi')\n```");
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["h", "p", "ul", "ol", "code"],
  );
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[4].text, "print('hi')");
});

test("inline bold, italic, code and links parse", () => {
  const nodes = parseInline("**bold** _it_ *em* `x<y` [docs](https://example.com/a)");
  const types = nodes.filter((node) => node.type !== "text").map((node) => node.type);
  assert.deepEqual(types, ["strong", "em", "em", "code", "link"]);
  assert.equal(nodes.find((node) => node.type === "link").href, "https://example.com/a");
});

test("HTML stays text and only http(s) links are links", () => {
  const nodes = parseInline('<img src=x onerror="alert(1)"> [bad](javascript:alert(1))');
  assert.ok(nodes.every((node) => node.type === "text"));
  assert.ok(nodes.map((node) => node.text).join("").includes("<img"));
});

test("snake_case words are not italicised", () => {
  const nodes = parseInline("use snake_case_names here");
  assert.ok(nodes.every((node) => node.type === "text"));
});

test("an unterminated fence keeps its text (streaming)", () => {
  const blocks = parseMarkdown("Here:\n```\nhalf a block");
  assert.equal(blocks.at(-1).type, "code");
  assert.equal(blocks.at(-1).text, "half a block");
});
