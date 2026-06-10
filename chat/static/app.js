const modelSelect = document.getElementById("model-select");
const customModelInput = document.getElementById("custom-model");
const refreshModelsButton = document.getElementById("refresh-models");
const newChatButton = document.getElementById("new-chat");
const messagesEl = document.getElementById("messages");
const welcomeEl = document.getElementById("welcome");
const scrollBottomBtn = document.getElementById("scroll-bottom");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const stopButton = document.getElementById("stop-button");
const statusEl = document.getElementById("status");

const MODEL_STORAGE_KEY = "ada-si-selected-model";
const SCROLL_THRESHOLD = 80;
const MAX_TEXTAREA_ROWS = 6;

let conversation = [];
let isSending = false;
let abortController = null;
let renderScheduled = false;
let pendingRender = null;

marked.setOptions({
  gfm: true,
  breaks: true,
});

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function parseErrorMessage(raw) {
  if (!raw) return "Unknown error";
  try {
    const json = JSON.parse(raw);
    return json.detail || json.error?.message || json.message || raw;
  } catch {
    return raw;
  }
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getSelectedModel() {
  const custom = customModelInput.value.trim();
  if (custom) return custom;
  return modelSelect.value;
}

function hideWelcome() {
  if (welcomeEl) welcomeEl.classList.add("hidden");
}

function showWelcome() {
  if (welcomeEl) welcomeEl.classList.remove("hidden");
}

function shouldAutoScroll() {
  const distance =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return distance <= SCROLL_THRESHOLD;
}

function scrollToBottom(force = false) {
  if (force || shouldAutoScroll()) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    scrollBottomBtn.classList.add("hidden");
  } else if (isSending) {
    scrollBottomBtn.classList.remove("hidden");
  }
}

function onMessagesScroll() {
  if (shouldAutoScroll()) {
    scrollBottomBtn.classList.add("hidden");
  } else if (isSending) {
    scrollBottomBtn.classList.remove("hidden");
  }
}

function renderMarkdown(text) {
  if (!text) return "";
  const raw = marked.parse(text);
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["class"],
    ADD_TAGS: ["code", "pre", "span"],
  });
}

function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre code").forEach((codeEl) => {
    const pre = codeEl.parentElement;
    if (pre.dataset.enhanced === "true") return;
    pre.dataset.enhanced = "true";

    hljs.highlightElement(codeEl);

    const langClass = [...codeEl.classList].find((c) => c.startsWith("language-"));
    const lang = langClass ? langClass.replace("language-", "") : "text";

    const header = document.createElement("div");
    header.className = "code-block-header";
    header.innerHTML = `<span>${lang}</span>`;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "code-copy-btn";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(codeEl.textContent);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });
    header.appendChild(copyBtn);

    pre.parentNode.insertBefore(header, pre);
  });
}

function createThinkingIndicator() {
  const el = document.createElement("div");
  el.className = "thinking-indicator";
  el.innerHTML =
    'Thinking <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
  return el;
}

function createThinkingBlock(reasoningText, { open = true, streaming = false } = {}) {
  const details = document.createElement("details");
  details.className = "thinking-block";
  details.open = open;

  const summary = document.createElement("summary");
  summary.textContent = streaming ? "Thinking..." : "Thinking";

  const content = document.createElement("div");
  content.className = "thinking-content";
  content.textContent = reasoningText;

  details.appendChild(summary);
  details.appendChild(content);
  return { details, content };
}

function createUserMessage(content) {
  hideWelcome();
  const el = document.createElement("article");
  el.className = "message user";
  el.innerHTML = `<span class="role">You</span>${escapeHtml(content)}`;
  messagesEl.appendChild(el);
  scrollToBottom(true);
  return el;
}

function createAssistantMessage() {
  hideWelcome();
  const el = document.createElement("article");
  el.className = "message assistant";

  const header = document.createElement("div");
  header.className = "message-header";

  const role = document.createElement("span");
  role.className = "role";
  role.textContent = "Assistant";

  const actions = document.createElement("div");
  actions.className = "message-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "icon-btn";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy message";
  copyBtn.classList.add("hidden");
  actions.appendChild(copyBtn);

  header.appendChild(role);
  header.appendChild(actions);

  const body = document.createElement("div");
  body.className = "message-body";

  const indicator = createThinkingIndicator();
  body.appendChild(indicator);

  const contentEl = document.createElement("div");
  contentEl.className = "message-content hidden";
  body.appendChild(contentEl);

  el.appendChild(header);
  el.appendChild(body);
  messagesEl.appendChild(el);
  scrollToBottom(true);

  return {
    el,
    body,
    indicator,
    contentEl,
    thinkingBlock: null,
    thinkingContent: null,
    copyBtn,
    reasoningText: "",
    assistantText: "",
    hasContent: false,
    hasReasoning: false,
  };
}

function scheduleAssistantRender(state) {
  pendingRender = state;
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (!pendingRender) return;
    renderAssistantState(pendingRender);
    pendingRender = null;
  });
}

function renderAssistantState(state) {
  if (state.hasReasoning && state.reasoningText) {
    if (!state.thinkingBlock) {
      state.indicator.classList.add("hidden");
      const block = createThinkingBlock(state.reasoningText, {
        open: !state.hasContent,
        streaming: !state.hasContent,
      });
      state.thinkingBlock = block.details;
      state.thinkingContent = block.content;
      state.body.insertBefore(block.details, state.contentEl);
    } else {
      state.thinkingContent.textContent = state.reasoningText;
      if (state.hasContent && state.thinkingBlock.open) {
        state.thinkingBlock.open = false;
        state.thinkingBlock.querySelector("summary").textContent = "Thinking";
      }
    }
  }

  if (state.hasContent) {
    state.indicator.classList.add("hidden");
    state.contentEl.classList.remove("hidden");
    state.contentEl.innerHTML = renderMarkdown(state.assistantText);
    enhanceCodeBlocks(state.contentEl);
  } else if (!state.hasReasoning) {
    state.indicator.classList.remove("hidden");
  }

  scrollToBottom();
}

function finalizeAssistantMessage(state) {
  if (!state.hasContent && !state.hasReasoning) {
    state.assistantText = "(No response)";
    state.hasContent = true;
  }

  state.indicator.classList.add("hidden");
  renderAssistantState(state);

  if (state.thinkingBlock) {
    state.thinkingBlock.querySelector("summary").textContent = "Thinking";
  }

  state.copyBtn.classList.remove("hidden");
  state.copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.assistantText);
    state.copyBtn.textContent = "Copied!";
    setTimeout(() => {
      state.copyBtn.textContent = "Copy";
    }, 1500);
  });
}

function parseStreamDelta(delta, state) {
  const reasoning =
    delta.reasoning_content || delta.reasoning || delta.thinking || "";
  const content = delta.content || "";

  if (reasoning) {
    state.hasReasoning = true;
    state.reasoningText += reasoning;
  }
  if (content) {
    state.hasContent = true;
    state.assistantText += content;
  }

  if (reasoning || content) {
    scheduleAssistantRender(state);
  }
}

function isWildcardModel(id) {
  return id.endsWith("/*") || id === "*";
}

function getProvider(modelId) {
  const slash = modelId.indexOf("/");
  return slash === -1 ? "other" : modelId.slice(0, slash);
}

function getModelLabel(modelId) {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(slash + 1);
}

async function loadModels() {
  modelSelect.disabled = true;
  setStatus("Loading models...");

  try {
    const response = await fetch("/api/models");
    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }

    const data = await response.json();
    const models = (data.data || [])
      .map((item) => item.id)
      .filter((id) => id && !isWildcardModel(id));

    modelSelect.innerHTML = "";

    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No models found</option>';
      setStatus("No models available. Add API keys to .env and restart.", true);
      return;
    }

    const grouped = new Map();
    for (const model of models) {
      const provider = getProvider(model);
      if (!grouped.has(provider)) grouped.set(provider, []);
      grouped.get(provider).push(model);
    }

    const sortedProviders = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
    for (const provider of sortedProviders) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = provider;
      const providerModels = grouped.get(provider).sort((a, b) => a.localeCompare(b));
      for (const model of providerModels) {
        const option = document.createElement("option");
        option.value = model;
        option.textContent = getModelLabel(model);
        optgroup.appendChild(option);
      }
      modelSelect.appendChild(optgroup);
    }

    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    if (saved && models.includes(saved)) {
      modelSelect.value = saved;
    }

    modelSelect.disabled = false;
    setStatus(`${models.length} models available`);
  } catch (error) {
    modelSelect.innerHTML = '<option value="">Failed to load models</option>';
    setStatus(`Could not load models: ${error.message}`, true);
  }
}

function parseSseChunks(buffer, onData) {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() || "";

  for (const part of parts) {
    const lines = part.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      onData(payload);
    }
  }

  return remainder;
}

function setSendingState(active) {
  isSending = active;
  sendButton.classList.toggle("hidden", active);
  stopButton.classList.toggle("hidden", !active);
  sendButton.disabled = active;
  messageInput.disabled = active;
}

function resetTextareaHeight() {
  messageInput.style.height = "auto";
  messageInput.rows = 2;
}

function autoResizeTextarea() {
  messageInput.style.height = "auto";
  const lineHeight = parseFloat(getComputedStyle(messageInput).lineHeight) || 22;
  const maxHeight = lineHeight * MAX_TEXTAREA_ROWS;
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, maxHeight)}px`;
}

function startNewChat() {
  if (isSending && abortController) {
    abortController.abort();
  }
  conversation = [];
  messagesEl.querySelectorAll(".message").forEach((el) => el.remove());
  showWelcome();
  setStatus("");
  messageInput.value = "";
  resetTextareaHeight();
  messageInput.focus();
}

async function sendMessage(event) {
  event.preventDefault();
  if (isSending) return;

  const model = getSelectedModel();
  const content = messageInput.value.trim();

  if (!model) {
    setStatus("Select or enter a model first.", true);
    return;
  }

  if (!content) return;

  localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value);

  abortController = new AbortController();
  setSendingState(true);
  setStatus("");

  conversation.push({ role: "user", content });
  createUserMessage(content);
  messageInput.value = "";
  resetTextareaHeight();

  const state = createAssistantMessage();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: conversation,
        stream: true,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunks(buffer, (payload) => {
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta || {};
          parseStreamDelta(delta, state);
        } catch {
          // Ignore malformed chunks.
        }
      });
    }

    finalizeAssistantMessage(state);

    if (state.assistantText) {
      conversation.push({ role: "assistant", content: state.assistantText });
    }

    setStatus("");
  } catch (error) {
    if (error.name === "AbortError") {
      finalizeAssistantMessage(state);
      if (state.assistantText) {
        conversation.push({ role: "assistant", content: state.assistantText });
        setStatus("Generation stopped.");
      } else {
        state.el.remove();
        conversation.pop();
        setStatus("Generation stopped.");
      }
    } else {
      state.el.remove();
      conversation.pop();
      setStatus(`Chat failed: ${error.message}`, true);
    }
  } finally {
    abortController = null;
    setSendingState(false);
    scrollBottomBtn.classList.add("hidden");
    messageInput.focus();
  }
}

function stopGeneration() {
  if (abortController) {
    abortController.abort();
  }
}

refreshModelsButton.addEventListener("click", loadModels);
newChatButton.addEventListener("click", startNewChat);
stopButton.addEventListener("click", stopGeneration);
scrollBottomBtn.addEventListener("click", () => scrollToBottom(true));
messagesEl.addEventListener("scroll", onMessagesScroll);
chatForm.addEventListener("submit", sendMessage);

modelSelect.addEventListener("change", () => {
  if (modelSelect.value) {
    localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value);
  }
});

messageInput.addEventListener("input", autoResizeTextarea);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!isSending) chatForm.requestSubmit();
  }
});

loadModels();
