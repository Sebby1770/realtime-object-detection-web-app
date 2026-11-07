/**
 * Copilot panel: Grok, ChatGPT, or Claude through the local server.
 * Keys and the thread live in this browser only. Replies stream in and are
 * rendered as a safe Markdown subset. Nothing here touches the outgoing picture.
 */

import { h } from "./core/dom.js";
import { renderMarkdown } from "./markdown.js";
import { readEventStream } from "./sse.js";

export const COPILOT_STORE = "object-detection-copilot";

export const FALLBACK_PROVIDERS = [
  { id: "grok", label: "Grok", vendor: "xAI", model: "grok-4.7", suggestions: ["grok-4.7", "grok-4.6", "grok-4.5"] },
  {
    id: "openai",
    label: "ChatGPT",
    vendor: "OpenAI",
    model: "chat-latest",
    suggestions: ["chat-latest", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"],
  },
  {
    id: "anthropic",
    label: "Claude",
    vendor: "Anthropic",
    model: "claude-opus-5-5",
    suggestions: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
];

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

function readStore(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(COPILOT_STORE) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function writeStore(storage, patch) {
  try {
    storage?.setItem(COPILOT_STORE, JSON.stringify({ ...readStore(storage), ...patch }));
  } catch {
    // Storage can be full or blocked; the panel still works for this visit.
  }
}

export function cleanThread(thread) {
  if (!Array.isArray(thread)) {
    return [];
  }
  return thread
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 4000),
      ...(message.image ? { image: true } : {}),
    }))
    .filter((message) => message.content)
    .slice(-30);
}

export function createCopilot({ els, storage, apiUrl, toast, getSceneSummary, getFrameDataUrl, serverAvailable }) {
  const store = readStore(storage);
  let providers = FALLBACK_PROVIDERS;
  let provider = providers.some((item) => item.id === store.provider) ? store.provider : "grok";
  let messages = cleanThread(store.thread);
  let controller = null;
  let listener = null;
  let renderQueued = false;

  const keyFor = (id) => (store.keys && typeof store.keys[id] === "string" ? store.keys[id] : "");
  const spec = () => providers.find((item) => item.id === provider) || providers[0];

  function saveKeys(patch) {
    const keys = { ...(readStore(storage).keys || {}), ...patch };
    store.keys = keys;
    writeStore(storage, { keys });
  }

  function saveModels(patch) {
    const models = { ...(readStore(storage).models || {}), ...patch };
    store.models = models;
    writeStore(storage, { models });
  }

  function currentModel() {
    const typed = els.copilotModel.value.trim();
    return typed || spec().model;
  }

  function setStatus(text, tone = "") {
    els.copilotStatus.textContent = text;
    if (tone) {
      els.copilotStatus.dataset.tone = tone;
    } else {
      delete els.copilotStatus.dataset.tone;
    }
  }

  function selectProvider(id, { remember = true } = {}) {
    if (!providers.some((item) => item.id === id)) {
      return;
    }
    if (remember) {
      saveKeys({ [provider]: els.copilotKey.value.trim() });
    }
    provider = id;
    writeStore(storage, { provider });
    for (const button of els.providerButtons) {
      button.setAttribute("aria-checked", button.dataset.provider === id ? "true" : "false");
      button.tabIndex = button.dataset.provider === id ? 0 : -1;
    }
    const current = spec();
    els.copilotKey.value = keyFor(id);
    els.copilotKey.placeholder = `${current.label} key, kept in this browser only`;
    els.copilotModel.value = store.models?.[id] || current.model;
    els.copilotModels.replaceChildren(...(current.suggestions || [current.model]).map((model) => h("option", { value: model })));
  }

  function updatePrivacyNote() {
    const labels = els.copilotUseScene.checked;
    const frame = els.copilotAttachFrame.checked;
    let text = "With both off, the model only sees what you type.";
    if (labels && frame) {
      text = "Your question, the labels in frame, and one still go to the provider through the local server.";
    } else if (labels) {
      text = "Your question and the labels in frame go to the provider. The picture does not.";
    } else if (frame) {
      text = "Your question and one still of the picture go to the provider through the local server.";
    }
    els.copilotPrivacy.textContent = text;
    writeStore(storage, { useScene: labels, attachFrame: frame });
  }

  function scheduleRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderThread();
    });
  }

  function renderThread() {
    const thread = els.copilotThread;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    if (!messages.length) {
      thread.replaceChildren(
        h(
          "p",
          { class: "thread-empty" },
          serverAvailable()
            ? "Ask what is on the desk, how to frame a shot, or what the diary means."
            : "The copilot needs the local server: run python -m app, then open http://127.0.0.1:8000. Detection on this page still works without it.",
        ),
      );
      return;
    }
    thread.replaceChildren(
      ...messages.map((message, index) => {
        const isUser = message.role === "user";
        const body = h("div", { class: "message-body" });
        if (isUser) {
          body.textContent = message.content;
        } else {
          body.append(renderMarkdown(message.content || ""));
        }
        const parts = [h("span", { class: "message-who" }, isUser ? "You" : message.label || spec().label), body];
        if (isUser && message.image) {
          parts.push(h("span", { class: "message-note" }, "Sent with a still of the picture"));
        }
        if (!isUser && message.note) {
          parts.push(h("span", { class: "message-note" }, message.note));
        }
        if (!isUser && !message.streaming && message.content) {
          parts.push(
            h(
              "div",
              { class: "message-tools" },
              h("button", { type: "button", onClick: () => copyMessage(index) }, "Copy"),
            ),
          );
        }
        return h(
          "div",
          { class: `message ${isUser ? "message-user" : "message-assistant"}${message.streaming ? " is-streaming" : ""}` },
          ...parts,
        );
      }),
    );
    if (nearBottom) {
      thread.scrollTop = thread.scrollHeight;
    }
  }

  async function copyMessage(index) {
    try {
      await navigator.clipboard.writeText(messages[index]?.content || "");
      toast.ok("Reply copied");
    } catch {
      toast.error("The browser blocked the clipboard.");
    }
  }

  function persist() {
    writeStore(storage, {
      thread: messages.filter((message) => !message.streaming).map(({ role, content, image }) => ({ role, content, image })),
    });
  }

  function setBusy(busy) {
    els.copilotAsk.textContent = busy ? "Stop" : "Ask";
    els.copilotAsk.dataset.state = busy ? "stop" : "";
    // While a reply streams in, screen readers wait for the finished message instead of re-reading the thread.
    els.copilotThread.setAttribute("aria-busy", busy ? "true" : "false");
  }

  async function ask() {
    if (controller) {
      controller.abort();
      return;
    }
    const question = els.copilotInput.value.trim();
    const apiKey = els.copilotKey.value.trim();
    const model = currentModel();
    if (!serverAvailable()) {
      setStatus("The copilot needs the local server. Run python -m app and open http://127.0.0.1:8000.", "warn");
      return;
    }
    if (!question) {
      setStatus("Type a question, or press Listen and speak it.");
      els.copilotInput.focus();
      return;
    }
    if (!apiKey) {
      setStatus(`Add a ${spec().label} API key first. It stays in this browser.`, "warn");
      els.copilotKey.focus();
      return;
    }
    if (!MODEL_PATTERN.test(model)) {
      setStatus("That model name has characters the providers do not use.", "warn");
      els.copilotModel.focus();
      return;
    }
    saveKeys({ [provider]: apiKey });
    saveModels({ [provider]: model });

    let content = question;
    if (els.copilotUseScene.checked) {
      content = `${question}\n\nLabels in frame: ${getSceneSummary()}.`;
    }
    let image = null;
    if (els.copilotAttachFrame.checked) {
      image = getFrameDataUrl();
      if (!image) {
        setStatus("There is no picture to attach yet. Start a source first.", "warn");
        return;
      }
    }

    const userMessage = { role: "user", content, ...(image ? { image: true } : {}) };
    const reply = { role: "assistant", content: "", streaming: true, label: spec().label };
    messages.push(userMessage, reply);
    els.copilotInput.value = "";
    renderThread();
    els.copilotThread.scrollTop = els.copilotThread.scrollHeight;
    setStatus(`Asking ${spec().label}…`);
    setBusy(true);
    controller = new AbortController();
    const history = messages
      .filter((message) => message !== reply && message.content)
      .slice(-12)
      .map(({ role, content: text }) => ({ role, content: text }));

    let failure = "";
    let stopReason = "";
    try {
      const response = await fetch(apiUrl("api/copilot/stream"), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ provider, apiKey, model, messages: history, ...(image ? { image } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        failure = payload.detail || `The server answered ${response.status}.`;
      } else {
        await readEventStream(
          response,
          ({ event, data }) => {
            let payload = {};
            try {
              payload = JSON.parse(data);
            } catch {
              return;
            }
            if (event === "delta" && typeof payload.text === "string") {
              reply.content += payload.text;
              scheduleRender();
            } else if (event === "done") {
              stopReason = payload.stop_reason || "";
              if (payload.label) {
                reply.label = payload.label;
              }
            } else if (event === "error") {
              failure = payload.message || "The provider could not answer.";
            }
          },
          { signal: controller.signal },
        );
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        failure = reply.content ? "" : "Stopped.";
        reply.note = "Stopped early.";
      } else {
        failure = "Could not reach the local server. Is python -m app still running?";
      }
    } finally {
      controller = null;
      setBusy(false);
    }

    reply.streaming = false;
    if (stopReason === "refusal") {
      reply.note = `${reply.label} declined to answer this one.`;
      if (!reply.content) {
        reply.content = "No answer for this one.";
      }
    } else if (stopReason === "max_tokens" || stopReason === "length") {
      reply.note = "The reply hit its length limit.";
    }
    if (failure && !reply.content) {
      messages = messages.filter((message) => message !== reply);
      setStatus(failure, "warn");
      if (failure !== "Stopped.") {
        toast.error(failure);
      }
    } else if (failure) {
      reply.note = failure;
      setStatus(failure, "warn");
    } else {
      setStatus(`${reply.label} answered. Replies stay in this panel.`);
    }
    persist();
    renderThread();
  }

  function clear() {
    if (controller) {
      controller.abort();
    }
    messages = [];
    persist();
    renderThread();
    setStatus("Thread cleared.");
  }

  function forgetKey() {
    els.copilotKey.value = "";
    saveKeys({ [provider]: "" });
    toast.ok(`${spec().label} key removed from this browser`);
  }

  function listen() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setStatus("This browser has no speech recognition. Type the question instead.");
      return;
    }
    if (listener) {
      listener.stop();
      return;
    }
    const recognizer = new Recognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.onresult = (event) => {
      let text = "";
      for (let index = 0; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript;
      }
      els.copilotInput.value = text.trim().slice(0, 4000);
    };
    const finish = () => {
      if (listener === recognizer) {
        listener = null;
        els.copilotListen.textContent = "Listen";
      }
    };
    recognizer.onerror = () => {
      setStatus("Listening stopped. Check the microphone permission.");
      finish();
    };
    recognizer.onend = finish;
    listener = recognizer;
    els.copilotListen.textContent = "Stop listening";
    setStatus("Listening. Press Ask when the question looks right.");
    recognizer.start();
  }

  function fillFrom(text) {
    els.copilotInput.value = text;
    els.copilotInput.focus();
    setStatus("The line is in the box. Ask when you are ready.");
  }

  async function loadCatalog() {
    if (!serverAvailable()) {
      renderThread();
      return;
    }
    try {
      const response = await fetch(apiUrl("api/copilot"), { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (Array.isArray(payload.providers) && payload.providers.length) {
        providers = payload.providers.map((item) => ({ ...FALLBACK_PROVIDERS.find((f) => f.id === item.id), ...item }));
        selectProvider(provider, { remember: false });
      }
    } catch {
      // Keep the built-in list.
    } finally {
      renderThread();
    }
  }

  // Wire up.
  for (const button of els.providerButtons) {
    button.addEventListener("click", () => selectProvider(button.dataset.provider));
  }
  els.providerGroup.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const ids = els.providerButtons.map((button) => button.dataset.provider);
    const next = ids[(ids.indexOf(provider) + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
    selectProvider(next);
    els.providerButtons.find((button) => button.dataset.provider === next)?.focus();
  });
  els.copilotKey.addEventListener("change", () => saveKeys({ [provider]: els.copilotKey.value.trim() }));
  els.copilotModel.addEventListener("change", () => saveModels({ [provider]: els.copilotModel.value.trim() }));
  els.copilotUseScene.checked = store.useScene === true;
  els.copilotAttachFrame.checked = store.attachFrame === true;
  els.copilotUseScene.addEventListener("change", updatePrivacyNote);
  els.copilotAttachFrame.addEventListener("change", updatePrivacyNote);
  els.copilotInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      ask();
    }
  });

  selectProvider(provider, { remember: false });
  updatePrivacyNote();
  renderThread();

  return {
    ask,
    clear,
    forgetKey,
    listen,
    fillFrom,
    loadCatalog,
    renderThread,
    get busy() {
      return Boolean(controller);
    },
  };
}
