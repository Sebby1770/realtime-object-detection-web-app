/**
 * A small, safe Markdown subset for copilot replies.
 * parseMarkdown() is pure (tested in Node); renderMarkdown() builds DOM nodes
 * with textContent only — model output is never parsed as HTML.
 *
 * Blocks: paragraphs, headings (#, ##, ###), bullet and numbered lists, fenced code.
 * Inline: **bold**, *italic* / _italic_, `code`, [links](https://…).
 */

export function parseInline(text) {
  const out = [];
  let rest = String(text ?? "");
  const patterns = [
    { type: "code", re: /^`([^`]+)`/ },
    { type: "strong", re: /^\*\*([^*]+(?:\*(?!\*)[^*]*)*)\*\*/ },
    { type: "strong", re: /^__([^_]+)__/ },
    { type: "em", re: /^\*([^*\s][^*]*)\*/ },
    { type: "em", re: /^_([^_\s][^_]*)_(?![A-Za-z0-9])/ },
    { type: "link", re: /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/ },
  ];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      out.push({ type: "text", text: buffer });
      buffer = "";
    }
  };
  while (rest) {
    let matched = false;
    if ("`*_[".includes(rest[0])) {
      for (const pattern of patterns) {
        const match = rest.match(pattern.re);
        if (!match) {
          continue;
        }
        flush();
        if (pattern.type === "code") {
          out.push({ type: "code", text: match[1] });
        } else if (pattern.type === "link") {
          out.push({ type: "link", href: match[2], children: parseInline(match[1]) });
        } else {
          out.push({ type: pattern.type, children: parseInline(match[1]) });
        }
        rest = rest.slice(match[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      buffer += rest[0];
      rest = rest.slice(1);
    }
  }
  flush();
  return out;
}

export function parseMarkdown(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "p", inline: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*```/);
    if (fence) {
      flushParagraph();
      flushList();
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h", inline: parseInline(heading[2].replace(/\s+#+\s*$/, "")) });
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*•])\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.type !== kind) {
        flushList();
        list = { type: kind, items: [] };
      }
      list.items.push(parseInline((bullet || numbered)[1]));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      const last = list.items[list.items.length - 1];
      last.push({ type: "text", text: " " }, ...parseInline(line.trim()));
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

function renderInline(nodes, doc) {
  const fragment = doc.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === "text") {
      fragment.append(doc.createTextNode(node.text));
    } else if (node.type === "code") {
      const code = doc.createElement("code");
      code.textContent = node.text;
      fragment.append(code);
    } else if (node.type === "link") {
      const link = doc.createElement("a");
      link.href = node.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.append(renderInline(node.children, doc));
      fragment.append(link);
    } else {
      const element = doc.createElement(node.type === "strong" ? "strong" : "em");
      element.append(renderInline(node.children, doc));
      fragment.append(element);
    }
  }
  return fragment;
}

export function renderMarkdown(text, doc = document) {
  const fragment = doc.createDocumentFragment();
  for (const block of parseMarkdown(text)) {
    if (block.type === "p" || block.type === "h") {
      const element = doc.createElement(block.type === "p" ? "p" : "h3");
      element.append(renderInline(block.inline, doc));
      fragment.append(element);
    } else if (block.type === "code") {
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = block.text;
      pre.append(code);
      fragment.append(pre);
    } else {
      const listElement = doc.createElement(block.type);
      for (const item of block.items) {
        const li = doc.createElement("li");
        li.append(renderInline(item, doc));
        listElement.append(li);
      }
      fragment.append(listElement);
    }
  }
  return fragment;
}
