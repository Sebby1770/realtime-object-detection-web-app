/**
 * Command palette (⌘K / Ctrl+K) and the shortcut sheet (?).
 * Commands: { id, title, group, keys?: string[], enabled?: () => boolean, run: () => void }
 */

import { h } from "../core/dom.js";

/** Subsequence match with a bonus for word starts and runs. Pure. */
export function scoreCommand(query, text) {
  const q = String(query || "").trim().toLowerCase();
  const t = String(text || "").toLowerCase();
  if (!q) {
    return 1;
  }
  if (t.includes(q)) {
    return 100 - t.indexOf(q);
  }
  let score = 0;
  let position = 0;
  let previous = -2;
  for (const char of q) {
    const found = t.indexOf(char, position);
    if (found < 0) {
      return 0;
    }
    score += 1;
    if (found === previous + 1) {
      score += 2;
    }
    if (found === 0 || t[found - 1] === " ") {
      score += 3;
    }
    previous = found;
    position = found + 1;
  }
  return score;
}

export function filterCommands(commands, query) {
  return commands
    .map((command) => ({ command, score: scoreCommand(query, `${command.title} ${command.group || ""}`) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.command);
}

function keyCaps(keys) {
  return (keys || []).map((key) => h("kbd", {}, key));
}

export function createCommandPalette({ dialog, input, list, getCommands }) {
  let visible = [];
  let active = 0;

  function render() {
    visible = filterCommands(getCommands(), input.value).slice(0, 40);
    active = Math.min(active, Math.max(0, visible.length - 1));
    list.replaceChildren(
      ...visible.map((command, index) => {
        const enabled = command.enabled ? command.enabled() : true;
        const item = h(
          "li",
          {
            role: "option",
            id: `cmd-${command.id.replace(/[^a-z0-9-]/gi, "-")}`,
            "aria-selected": index === active ? "true" : "false",
            "aria-disabled": enabled ? "false" : "true",
            onClick: () => run(command),
            onMousemove: () => {
              if (active !== index) {
                active = index;
                highlight();
              }
            },
          },
          h("span", { class: "group-label" }, command.group || ""),
          h("span", {}, command.title),
          command.keys?.length ? h("span", { class: "hint" }, ...keyCaps(command.keys)) : null,
        );
        return item;
      }),
    );
    if (!visible.length) {
      list.append(h("li", { "aria-disabled": "true" }, h("span", {}, "No command matches that.")));
    }
    highlight();
  }

  function highlight() {
    [...list.children].forEach((item, index) => {
      item.setAttribute("aria-selected", index === active ? "true" : "false");
      if (index === active) {
        item.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", item.id || "");
      }
    });
  }

  function run(command) {
    if (command.enabled && !command.enabled()) {
      return;
    }
    close();
    window.setTimeout(() => command.run(), 0);
  }

  function open() {
    input.value = "";
    active = 0;
    render();
    if (!dialog.open) {
      dialog.showModal();
    }
    input.focus();
  }

  function close() {
    if (dialog.open) {
      dialog.close();
    }
  }

  input.addEventListener("input", () => {
    active = 0;
    render();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = Math.min(visible.length - 1, active + 1);
      highlight();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.max(0, active - 1);
      highlight();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (visible[active]) {
        run(visible[active]);
      }
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
    }
  });

  return { open, close, get isOpen() { return dialog.open; } };
}

export function renderShortcutSheet(container, shortcuts) {
  container.replaceChildren(
    ...shortcuts.flatMap((item) => [h("dt", {}, ...keyCaps(item.keys)), h("dd", {}, item.title)]),
  );
}
