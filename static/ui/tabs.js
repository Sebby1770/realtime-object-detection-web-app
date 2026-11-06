/** ARIA tabs: click, arrow keys, Home and End. Panels are hidden when inactive. */

export function createTabs(tablist, { onChange } = {}) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  let current = tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];

  function idOf(tab) {
    return tab.id.replace(/^tab-/, "");
  }

  function select(id, { focus = false, silent = false } = {}) {
    const next = tabs.find((tab) => idOf(tab) === id);
    if (!next) {
      return;
    }
    for (const tab of tabs) {
      const active = tab === next;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute("aria-controls"));
      if (panel) {
        panel.hidden = !active;
      }
    }
    const changed = current !== next;
    current = next;
    if (focus) {
      next.focus();
    }
    if (changed && !silent) {
      onChange?.(id);
    }
  }

  tablist.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) {
      select(idOf(tab));
    }
  });

  tablist.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) {
      return;
    }
    let next = null;
    if (event.key === "ArrowRight") {
      next = tabs[(index + 1) % tabs.length];
    } else if (event.key === "ArrowLeft") {
      next = tabs[(index - 1 + tabs.length) % tabs.length];
    } else if (event.key === "Home") {
      next = tabs[0];
    } else if (event.key === "End") {
      next = tabs[tabs.length - 1];
    }
    if (next) {
      event.preventDefault();
      select(idOf(next), { focus: true });
    }
  });

  select(idOf(current), { silent: true });

  return {
    select,
    get current() {
      return idOf(current);
    },
    badge(id, text) {
      const tab = tabs.find((item) => idOf(item) === id);
      if (!tab) {
        return;
      }
      let badge = tab.querySelector(".badge");
      if (!text) {
        badge?.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "badge";
        tab.append(badge);
      }
      badge.textContent = text;
    },
  };
}
