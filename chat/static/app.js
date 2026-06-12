const chatModelSelect = document.getElementById("chat-model-select");
const secondModelSelect = document.getElementById("second-model-select");
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
const systemInput = document.getElementById("system-input");
const systemPanel = document.getElementById("system-panel");
const processRunsEl = document.getElementById("process-runs");
const toolsListEl = document.getElementById("tools-list");
const processRunCountEl = document.getElementById("process-run-count");
const toolsCountEl = document.getElementById("tools-count");

const CHAT_MODEL_STORAGE_KEY = "ada-si-chat-model";
const SECOND_MODEL_STORAGE_KEY = "ada-si-second-model";
const SYSTEM_STORAGE_KEY = "ada-si-system-instructions";
const SCROLL_THRESHOLD = 80;
const MAX_TEXTAREA_ROWS = 6;

const BUILD_STEPS = [
  { step_id: "generate_code", label: "Generate tool code" },
  { step_id: "validate_code", label: "Validate module structure" },
  { step_id: "sandbox_test", label: "Run sandbox tests" },
  { step_id: "pip_review", label: "Review pip packages" },
  { step_id: "runtime_verify", label: "Verify in tool runtime" },
  { step_id: "install_tool", label: "Install tool" },
];

let appConfig = {};
let conversation = [];
let processRuns = [];
let activeRunId = null;
let isSending = false;
let abortController = null;
let runAbortControllers = new Map();
let renderScheduled = false;
let pendingRender = null;

marked.setOptions({
  gfm: true,
  breaks: true,
});

function createRunId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `run${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function truncateText(text, max = 80) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function processEmptyStateHtml() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
          <circle cx="12" cy="12" r="4"/>
        </svg>
      </div>
      <p class="empty-state-title">No activity yet</p>
      <p class="empty-state-text">Your routing timeline appears here as the agent works.</p>
    </div>
  `;
}

function toolsEmptyStateHtml() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77A6 6 0 0 1 21 12v0a6 6 0 0 1-6 6H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1"/>
          <path d="M16 2l4 4"/>
        </svg>
      </div>
      <p class="empty-state-title">No tools yet</p>
      <p class="empty-state-text">Approved tools appear here automatically.</p>
    </div>
  `;
}

function iconTrash() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/>
  </svg>`;
}

function iconTool() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77A6 6 0 0 1 21 12v0a6 6 0 0 1-6 6H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1"/>
  </svg>`;
}

function stepIconSvg(status) {
  if (status === "done") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 12l3 3 5-6"/>
    </svg>`;
  }
  if (status === "active") {
    return `<svg class="icon-active-ring" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
    </svg>`;
  }
  if (status === "error") {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="12" r="10"/>
      <path d="M15 9l-6 6M9 9l6 6"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="9"/>
  </svg>`;
}

function updateProcessRunCount() {
  const count = processRuns.length;
  if (!processRunCountEl) return;
  if (count === 0) {
    processRunCountEl.classList.add("hidden");
    return;
  }
  processRunCountEl.textContent = String(count);
  processRunCountEl.classList.remove("hidden");
}

function updateToolsCount(count) {
  if (!toolsCountEl) return;
  toolsCountEl.textContent = String(count);
}

function clearProcessRuns() {
  for (const runId of runAbortControllers.keys()) {
    runAbortControllers.get(runId)?.abort();
  }
  runAbortControllers.clear();
  processRuns = [];
  activeRunId = null;
  processRunsEl.innerHTML = processEmptyStateHtml();
  updateProcessRunCount();
}

function getProcessRun(runId) {
  return processRuns.find((run) => run.runId === runId);
}

function startProcessRun(prompt) {
  const empty = processRunsEl.querySelector(".empty-state");
  if (empty) empty.remove();

  const runId = createRunId();
  const run = {
    runId,
    prompt,
    stepsEl: null,
    steps: new Map(),
    runEl: null,
    stopBtn: null,
  };
  processRuns.push(run);
  activeRunId = runId;

  const runEl = document.createElement("div");
  runEl.className = "process-run";
  runEl.dataset.runId = runId;

  const headerEl = document.createElement("div");
  headerEl.className = "process-run-header";

  const promptEl = document.createElement("p");
  promptEl.className = "process-run-prompt";
  promptEl.textContent = truncateText(prompt);
  promptEl.title = prompt;

  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "process-run-stop hidden";
  stopBtn.textContent = "Stop";
  stopBtn.title = "Stop this process";
  stopBtn.setAttribute("aria-label", "Stop process");
  stopBtn.addEventListener("click", () => stopProcessRun(runId));

  headerEl.appendChild(promptEl);
  headerEl.appendChild(stopBtn);

  const stepsList = document.createElement("ul");
  stepsList.className = "process-steps";

  runEl.appendChild(headerEl);
  runEl.appendChild(stepsList);
  processRunsEl.appendChild(runEl);

  run.stepsEl = stepsList;
  run.runEl = runEl;
  run.stopBtn = stopBtn;
  processRunsEl.scrollTop = processRunsEl.scrollHeight;
  updateProcessRunCount();

  updateProcessStep(runId, "lite_model", {
    label: "Lite model processing",
    status: "active",
    model: getSelectedModel(),
  });

  return runId;
}

function updateProcessRunStopVisibility(runId) {
  const run = getProcessRun(runId);
  if (!run?.stopBtn) return;

  const hasActive = [...run.steps.values()].some((stepEl) =>
    stepEl.classList.contains("step-active"),
  );
  run.stopBtn.classList.toggle("hidden", !hasActive);
}

async function cancelRunOnServer(runId) {
  try {
    await fetch("/api/cancel_run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    });
  } catch {
    // Best-effort; client abort still stops the UI.
  }
}

function stopActiveProcessStep(runId, label = "Stopped by user") {
  const run = getProcessRun(runId);
  if (!run) return;

  for (const stepEl of run.steps.values()) {
    if (stepEl.classList.contains("step-active")) {
      const stepId = stepEl.dataset.stepId;
      updateProcessStep(runId, stepId, { label, status: "error" });
    }
  }
  skipRemainingBuildSteps(runId);
  updateProcessRunStopVisibility(runId);
}

function stopProcessRun(runId) {
  runAbortControllers.get(runId)?.abort();
  runAbortControllers.delete(runId);
  cancelRunOnServer(runId);
  stopActiveProcessStep(runId);

  if (runId === activeRunId && isSending) {
    abortController = null;
    setSendingState(false);
  }

  document.querySelectorAll(".tool-plan-card").forEach((card) => {
    if (card.dataset.runId === runId) {
      setToolPlanCardBusy(card, false);
      const retryBtn = card._viewerUi?.retryBtn;
      if (retryBtn) {
        retryBtn.classList.remove("hidden");
        retryBtn.disabled = false;
      }
    }
  });

  setStatus("Process stopped.");
}

function bindRunAbortController(runId) {
  const controller = new AbortController();
  runAbortControllers.set(runId, controller);
  abortController = controller;
  return controller;
}

function updateProcessStep(runId, stepId, { label, status, model = "", detail = "" }) {
  const run = getProcessRun(runId);
  if (!run) return;

  let stepEl = run.steps.get(stepId);
  if (!stepEl) {
    stepEl = document.createElement("li");
    stepEl.className = "process-step";
    stepEl.dataset.stepId = stepId;
    run.stepsEl.appendChild(stepEl);
    run.steps.set(stepId, stepEl);
  }

  stepEl.className = `process-step step-${status}`;
  const metaParts = [model, detail].filter(Boolean);
  stepEl.innerHTML = `
    <span class="process-step-icon">${stepIconSvg(status)}</span>
    <div class="process-step-content">
      <div class="process-step-label">${escapeHtml(label)}</div>
      ${metaParts.map((m) => `<div class="process-step-meta">${escapeHtml(m)}</div>`).join("")}
    </div>
  `;

  processRunsEl.scrollTop = processRunsEl.scrollHeight;
  updateProcessRunStopVisibility(runId);
}

function registerBuildSteps(runId) {
  for (const step of BUILD_STEPS) {
    updateProcessStep(runId, step.step_id, {
      label: step.label,
      status: "pending",
    });
  }
}

function skipRemainingBuildSteps(runId) {
  for (const step of BUILD_STEPS) {
    const run = getProcessRun(runId);
    if (!run) continue;
    const stepEl = run.steps.get(step.step_id);
    if (stepEl && stepEl.classList.contains("step-pending")) {
      stepEl.classList.add("step-skipped");
    }
  }
}

function handleProcessEvent(json) {
  updateProcessStep(json.run_id, json.step_id, {
    label: json.label,
    status: json.status,
    model: json.model || "",
    detail: json.detail || "",
  });
}

function renderToolsPanel(tools) {
  const list = tools || [];
  updateToolsCount(list.length);
  toolsListEl.innerHTML = "";
  if (list.length === 0) {
    toolsListEl.innerHTML = toolsEmptyStateHtml();
    return;
  }

  for (const tool of list) {
    const card = document.createElement("div");
    card.className = "tool-card";
    card.dataset.toolName = tool.name;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tool-delete-btn";
    deleteBtn.title = "Delete tool";
    deleteBtn.innerHTML = iconTrash();
    deleteBtn.addEventListener("click", () => deleteTool(tool.name, card));

    const header = document.createElement("div");
    header.className = "tool-card-header";
    header.innerHTML = `<span class="tool-card-icon">${iconTool()}</span>`;

    const nameEl = document.createElement("h3");
    nameEl.className = "tool-card-name";
    nameEl.textContent = tool.name;
    header.appendChild(nameEl);

    const descEl = document.createElement("p");
    descEl.className = "tool-card-desc";
    descEl.textContent = tool.description || "No description.";

    card.appendChild(deleteBtn);
    card.appendChild(header);
    card.appendChild(descEl);
    toolsListEl.appendChild(card);
  }
}

async function refreshToolsPanel() {
  try {
    const response = await fetch("/api/tools");
    if (!response.ok) return;
    const data = await response.json();
    renderToolsPanel(data.tools || []);
  } catch {
    renderToolsPanel(appConfig.tools || []);
  }
}

async function deleteTool(toolName, cardEl) {
  if (!confirm(`Delete tool "${toolName}"? This cannot be undone.`)) return;

  try {
    const response = await fetch(`/api/tools/${encodeURIComponent(toolName)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }
    cardEl.remove();
    if (!toolsListEl.querySelector(".tool-card")) {
      toolsListEl.innerHTML = toolsEmptyStateHtml();
      updateToolsCount(0);
    }
    await loadConfig();
    setStatus(`Tool "${toolName}" deleted.`);
  } catch (error) {
    setStatus(`Delete failed: ${error.message}`, true);
  }
}

function handleAdaEvent(json) {
  if (json.ada_event === "process_step") {
    handleProcessEvent(json);
    return true;
  }
  if (json.ada_event === "run_cancelled") {
    stopActiveProcessStep(json.run_id);
    return true;
  }
  return false;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text || "";
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
  return chatModelSelect.value;
}

function getSecondModel() {
  return secondModelSelect.value;
}

function getSystemInstructions() {
  return systemInput.value.trim();
}

function buildMessages() {
  const messages = [];
  const system = getSystemInstructions();
  if (system) {
    messages.push({ role: "system", content: system });
  }
  return messages.concat(conversation);
}

function loadSystemInstructions() {
  const saved = localStorage.getItem(SYSTEM_STORAGE_KEY);
  if (saved) {
    systemInput.value = saved;
    systemPanel.open = true;
  }
}

function saveSystemInstructions() {
  localStorage.setItem(SYSTEM_STORAGE_KEY, systemInput.value);
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
  const row = document.createElement("div");
  row.className = "message-row user-row";

  const avatar = document.createElement("span");
  avatar.className = "message-avatar user-avatar";
  avatar.textContent = "You";

  const el = document.createElement("article");
  el.className = "message user";
  el.textContent = content;

  row.appendChild(avatar);
  row.appendChild(el);
  messagesEl.appendChild(row);
  scrollToBottom(true);
  return el;
}

function createAssistantMessage() {
  hideWelcome();

  const row = document.createElement("div");
  row.className = "message-row assistant-row";

  const avatar = document.createElement("span");
  avatar.className = "message-avatar assistant-avatar";
  avatar.textContent = "AI";

  const el = document.createElement("article");
  el.className = "message assistant";

  const header = document.createElement("div");
  header.className = "message-header";

  const actions = document.createElement("div");
  actions.className = "message-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "icon-btn";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy message";
  copyBtn.classList.add("hidden");
  actions.appendChild(copyBtn);

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
  row.appendChild(avatar);
  row.appendChild(el);
  messagesEl.appendChild(row);
  scrollToBottom(true);

  return {
    el,
    row,
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

function populateModelSelect(select, models, { savedValue, defaultValue } = {}) {
  select.innerHTML = "";

  if (models.length === 0) {
    select.innerHTML = '<option value="">No models found</option>';
    select.disabled = true;
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
    select.appendChild(optgroup);
  }

  const preferred = [savedValue, defaultValue].find(
    (value) => value && models.includes(value),
  );
  if (preferred) {
    select.value = preferred;
  }

  select.disabled = false;
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    appConfig = await response.json();
  } catch {
    // Use empty defaults if config is unavailable.
  }
}

async function loadModels() {
  chatModelSelect.disabled = true;
  secondModelSelect.disabled = true;
  setStatus("Loading models...");

  try {
    await loadConfig();

    const response = await fetch("/api/models");
    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }

    const data = await response.json();
    const models = (data.data || [])
      .map((item) => item.id)
      .filter((id) => id && !isWildcardModel(id));

    if (models.length === 0) {
      chatModelSelect.innerHTML = '<option value="">No models found</option>';
      secondModelSelect.innerHTML = '<option value="">No models found</option>';
      setStatus("No models available. Add API keys to .env and restart.", true);
      return;
    }

    populateModelSelect(chatModelSelect, models, {
      savedValue: localStorage.getItem(CHAT_MODEL_STORAGE_KEY),
      defaultValue: appConfig.lite_model || appConfig.chat_model,
    });
    populateModelSelect(secondModelSelect, models, {
      savedValue: localStorage.getItem(SECOND_MODEL_STORAGE_KEY),
      defaultValue: appConfig.tool_creator_model || appConfig.second_model,
    });

    const toolCount = (appConfig.tools || []).length;
    await refreshToolsPanel();
    setStatus("");
  } catch (error) {
    chatModelSelect.innerHTML = '<option value="">Failed to load models</option>';
    secondModelSelect.innerHTML = '<option value="">Failed to load models</option>';
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
  messagesEl.querySelectorAll(".message-row, .tool-plan-card").forEach((el) => el.remove());
  clearProcessRuns();
  showWelcome();
  setStatus("");
  messageInput.value = "";
  resetTextareaHeight();
  messageInput.focus();
}

function updateToolPlanCardContent(card, plan) {
  const body = card.querySelector(".tool-plan-body");
  if (!body) return;
  body.innerHTML = renderMarkdown(plan);
  enhanceCodeBlocks(body);
  const feedbackInput = card.querySelector(".tool-plan-feedback textarea");
  if (feedbackInput) feedbackInput.value = "";
  updateScrollShadow(card);
  focusActiveToolCard(card, { collapseOthers: false });
}

const VIEWER_PHASES = [
  { id: "generate_code", label: "Generate" },
  { id: "validate_code", label: "Validate" },
  { id: "sandbox_test", label: "Sandbox" },
  { id: "pip_review", label: "Pip review" },
  { id: "runtime_verify", label: "Runtime" },
  { id: "install_tool", label: "Install" },
];

function getToolCardShell(card) {
  return {
    summary: card.querySelector(".tool-card-summary"),
    chrome: card.querySelector(".tool-card-chrome"),
    attention: card.querySelector(".tool-card-attention"),
    scroll: card.querySelector(".tool-card-scroll"),
    actions: card.querySelector(".tool-card-actions"),
  };
}

function ensureToolCardShell(card) {
  const existing = getToolCardShell(card);
  if (existing.scroll) return existing;

  const summary = document.createElement("div");
  summary.className = "tool-card-summary hidden";

  const chrome = document.createElement("div");
  chrome.className = "tool-card-chrome";

  const attention = document.createElement("div");
  attention.className = "tool-card-attention";

  const scroll = document.createElement("div");
  scroll.className = "tool-card-scroll scroll-area";

  const actions = document.createElement("div");
  actions.className = "tool-card-actions";

  const shellClasses = [
    "tool-card-summary",
    "tool-card-chrome",
    "tool-card-attention",
    "tool-card-scroll",
    "tool-card-actions",
  ];

  const toMove = [...card.children].filter(
    (child) => !shellClasses.some((cls) => child.classList.contains(cls)),
  );

  card.prepend(summary, chrome, attention, scroll, actions);

  for (const child of toMove) {
    if (
      child.classList.contains("tool-plan-header") ||
      child.classList.contains("tool-viewer-phases")
    ) {
      chrome.appendChild(child);
    } else if (child.classList.contains("pip-install-card")) {
      attention.appendChild(child);
    } else if (
      child.classList.contains("tool-plan-actions") ||
      child.classList.contains("tool-viewer-footer") ||
      child.classList.contains("tool-plan-result")
    ) {
      actions.appendChild(child);
    } else {
      scroll.appendChild(child);
    }
  }

  attachScrollShadowListener(card);
  return getToolCardShell(card);
}

function attachScrollShadowListener(card) {
  const scroll = card.querySelector(".tool-card-scroll");
  if (!scroll || scroll.dataset.shadowBound) return;
  scroll.dataset.shadowBound = "1";
  scroll.addEventListener("scroll", () => updateScrollShadow(card));
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => updateScrollShadow(card)).observe(scroll);
  }
}

function updateScrollShadow(card) {
  const scroll = card.querySelector(".tool-card-scroll");
  if (!scroll) return;
  scroll.classList.toggle("has-scroll", scroll.scrollHeight > scroll.clientHeight + 2);
}

function scrollCardRegion(card, selector) {
  if (!card) return;
  const region = card.querySelector(selector);
  if (region) {
    region.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function expandToolCard(card) {
  card.classList.remove("tool-card-collapsed");
  card.classList.add("tool-card-active");
  card.querySelector(".tool-card-summary")?.classList.add("hidden");
  focusActiveToolCard(card, { collapseOthers: false });
}

function collapseToolCard(
  card,
  { summary = "", status = "Done", statusClass = "success" } = {},
) {
  ensureToolCardShell(card);
  card.classList.remove("tool-card-active");
  card.classList.add("tool-card-collapsed");

  const toolName =
    card.dataset.toolName ||
    card.querySelector(".tool-plan-title")?.textContent ||
    "Tool";

  let summaryEl = card.querySelector(".tool-card-summary");
  if (!summaryEl) return;

  summaryEl.replaceChildren();

  const nameSpan = document.createElement("span");
  nameSpan.className = "tool-card-summary-name";
  nameSpan.textContent = toolName;

  const badge = document.createElement("span");
  badge.className = `tool-card-summary-badge status-${statusClass}`;
  badge.textContent = status;

  const summaryActions = document.createElement("div");
  summaryActions.className = "tool-card-summary-actions";

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "btn-secondary btn-sm";
  expandBtn.textContent = "Expand";
  expandBtn.addEventListener("click", () => expandToolCard(card));

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn-ghost btn-sm";
  dismissBtn.textContent = "Dismiss";
  dismissBtn.addEventListener("click", () => card.remove());

  summaryActions.appendChild(expandBtn);
  summaryActions.appendChild(dismissBtn);

  summaryEl.appendChild(nameSpan);
  summaryEl.appendChild(badge);
  if (summary) {
    const detail = document.createElement("span");
    detail.className = "tool-card-summary-detail";
    detail.textContent =
      summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
    summaryEl.appendChild(detail);
  }
  summaryEl.appendChild(summaryActions);
  summaryEl.classList.remove("hidden");
}

function collapseOtherToolCards(exceptCard) {
  document.querySelectorAll(".tool-plan-card").forEach((card) => {
    if (card === exceptCard || card.classList.contains("tool-card-collapsed")) {
      return;
    }
    if (card.classList.contains("tool-creation-viewer-success")) {
      collapseToolCard(card, {
        summary: card._lastSuccessMessage || "",
        status: "Installed",
        statusClass: "success",
      });
      return;
    }
    if (
      card.classList.contains("tool-creation-viewer") &&
      !card.classList.contains("tool-creation-viewer-success")
    ) {
      return;
    }
    if (!card.classList.contains("tool-creation-viewer")) {
      collapseToolCard(card, {
        status: "Plan pending",
        statusClass: "pending",
      });
    }
  });
}

function focusActiveToolCard(card, { collapseOthers = true } = {}) {
  if (!card) return;
  if (collapseOthers) collapseOtherToolCards(card);

  document.querySelectorAll(".tool-plan-card.tool-card-active").forEach((c) => {
    if (c !== card && !c.classList.contains("tool-card-collapsed")) {
      c.classList.remove("tool-card-active");
    }
  });

  card.classList.remove("tool-card-collapsed");
  card.querySelector(".tool-card-summary")?.classList.add("hidden");
  card.classList.add("tool-card-active");
  ensureToolCardShell(card);

  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    scrollCardRegion(card, ".tool-card-actions, .pip-install-actions");
    updateScrollShadow(card);
  });
}

function setToolPlanCardBusy(card, busy) {
  card.querySelectorAll("button, textarea").forEach((el) => {
    el.disabled = busy;
  });
}

function createToolPlanCodePanel() {
  const panel = document.createElement("div");
  panel.className = "tool-plan-code-panel hidden";

  const panelHeader = document.createElement("div");
  panelHeader.className = "tool-plan-code-header";

  const panelTitle = document.createElement("span");
  panelTitle.className = "tool-plan-code-title";
  panelTitle.textContent = "Code generation";

  const tabs = document.createElement("div");
  tabs.className = "tool-plan-code-tabs hidden";

  const toolTab = document.createElement("button");
  toolTab.type = "button";
  toolTab.className = "tool-plan-code-tab active";
  toolTab.dataset.tab = "tool";
  toolTab.textContent = "tool.py";

  const testTab = document.createElement("button");
  testTab.type = "button";
  testTab.className = "tool-plan-code-tab";
  testTab.dataset.tab = "test";
  testTab.textContent = "test_run.py";

  const outputTab = document.createElement("button");
  outputTab.type = "button";
  outputTab.className = "tool-plan-code-tab";
  outputTab.dataset.tab = "output";
  outputTab.textContent = "Output";

  tabs.appendChild(toolTab);
  tabs.appendChild(testTab);
  tabs.appendChild(outputTab);

  panelHeader.appendChild(panelTitle);
  panelHeader.appendChild(tabs);

  const body = document.createElement("div");
  body.className = "tool-plan-code-body scroll-area";

  const thinkingBlock = document.createElement("details");
  thinkingBlock.className = "thinking-block tool-viewer-thinking hidden";
  thinkingBlock.open = true;
  const thinkingSummary = document.createElement("summary");
  thinkingSummary.textContent = "Thinking…";
  const thinkingContent = document.createElement("div");
  thinkingContent.className = "thinking-content";
  thinkingBlock.appendChild(thinkingSummary);
  thinkingBlock.appendChild(thinkingContent);

  const streamPre = document.createElement("pre");
  streamPre.className = "tool-plan-code-stream";
  const streamCode = document.createElement("code");
  streamPre.appendChild(streamCode);
  body.appendChild(thinkingBlock);
  body.appendChild(streamPre);

  const toolPre = document.createElement("pre");
  toolPre.className = "tool-plan-code-view hidden";
  const toolCode = document.createElement("code");
  toolCode.className = "language-python";
  toolPre.appendChild(toolCode);

  const testPre = document.createElement("pre");
  testPre.className = "tool-plan-code-view hidden";
  const testCodeEl = document.createElement("code");
  testCodeEl.className = "language-python";
  testPre.appendChild(testCodeEl);

  const outputPre = document.createElement("pre");
  outputPre.className = "tool-viewer-output hidden";
  const outputCode = document.createElement("code");
  outputPre.appendChild(outputCode);

  body.appendChild(toolPre);
  body.appendChild(testPre);
  body.appendChild(outputPre);

  function showCodeTab(activeTab) {
    [toolTab, testTab, outputTab].forEach((tab) => {
      tab.classList.toggle("active", tab === activeTab);
    });
    streamPre.classList.add("hidden");
    toolPre.classList.toggle("hidden", activeTab !== toolTab);
    testPre.classList.toggle("hidden", activeTab !== testTab);
    outputPre.classList.toggle("hidden", activeTab !== outputTab);
  }

  toolTab.addEventListener("click", () => showCodeTab(toolTab));
  testTab.addEventListener("click", () => showCodeTab(testTab));
  outputTab.addEventListener("click", () => showCodeTab(outputTab));

  panel.appendChild(panelHeader);
  panel.appendChild(body);

  return {
    panel,
    panelTitle,
    tabs,
    body,
    streamPre,
    streamCode,
    toolPre,
    toolCode,
    testPre,
    testCodeEl,
    outputPre,
    outputCode,
    toolTab,
    testTab,
    outputTab,
    showCodeTab,
    thinkingBlock,
    thinkingSummary,
    thinkingContent,
  };
}

function reuseViewerPhases(card) {
  const strip = card.querySelector(".tool-viewer-phases");
  if (!strip) return null;
  const pills = new Map();
  strip.querySelectorAll(".tool-viewer-phase").forEach((pill) => {
    if (pill.dataset.phaseId) pills.set(pill.dataset.phaseId, pill);
  });
  return { strip, pills };
}

function dedupeViewerPhaseStrips(card, keepStrip) {
  card.querySelectorAll(".tool-viewer-phases").forEach((el) => {
    if (el !== keepStrip) el.remove();
  });
}

function createViewerPhaseStrip() {
  const strip = document.createElement("div");
  strip.className = "tool-viewer-phases";
  const pills = new Map();

  for (const phase of VIEWER_PHASES) {
    const pill = document.createElement("span");
    pill.className = "tool-viewer-phase step-pending";
    pill.dataset.phaseId = phase.id;
    pill.textContent = phase.label;
    strip.appendChild(pill);
    pills.set(phase.id, pill);
  }

  return { strip, pills };
}

function buildViewerUi(card) {
  const shell = ensureToolCardShell(card);

  let phases = reuseViewerPhases(card);
  if (!phases) {
    phases = createViewerPhaseStrip();
    shell.chrome.appendChild(phases.strip);
  } else if (!shell.chrome.contains(phases.strip)) {
    shell.chrome.appendChild(phases.strip);
  }
  dedupeViewerPhaseStrips(card, phases.strip);

  const codeUi = card._codeUi || createToolPlanCodePanel();
  if (!card._codeUi) {
    card._codeUi = codeUi;
  }
  if (!shell.scroll.contains(codeUi.panel)) {
    shell.scroll.appendChild(codeUi.panel);
  }

  let footer = shell.actions.querySelector(".tool-viewer-footer");
  let retryBtn;
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "tool-viewer-footer hidden";
    retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "btn-secondary btn-sm";
    retryBtn.textContent = "Retry Build";
    retryBtn.classList.add("hidden");
    footer.appendChild(retryBtn);
    shell.actions.appendChild(footer);
  } else {
    retryBtn = footer.querySelector("button");
  }

  shell.actions.querySelectorAll(".tool-viewer-footer").forEach((el) => {
    if (el !== footer) el.remove();
  });

  return {
    phases,
    codeUi,
    footer,
    retryBtn,
    card,
    outputLines: card._viewerUi?.outputLines || [],
  };
}

function enterToolCreationViewer(card, toolName) {
  card.classList.add("tool-creation-viewer");
  card.dataset.toolName = toolName;

  const shell = ensureToolCardShell(card);
  const header = card.querySelector(".tool-plan-header");
  if (header && !shell.chrome.contains(header)) {
    shell.chrome.prepend(header);
  }

  const badge = card.querySelector(".tool-plan-badge");
  if (badge) badge.textContent = "Tool Creation Viewer";

  const title = card.querySelector(".tool-plan-title");
  if (title) title.textContent = toolName;

  card.querySelector(".tool-plan-body-wrap")?.remove();
  card.querySelector(".tool-plan-feedback")?.remove();
  shell.actions.querySelector(".tool-plan-actions")?.remove();
  card.querySelector(".tool-plan-result")?.classList.add("hidden");

  const viewerUi = buildViewerUi(card);
  card._viewerUi = viewerUi;

  for (const pill of viewerUi.phases.pills.values()) {
    pill.className = "tool-viewer-phase step-pending";
  }

  viewerUi.outputLines = [];
  viewerUi.codeUi.outputCode.textContent = "";
  viewerUi.codeUi.thinkingBlock.classList.add("hidden");
  viewerUi.codeUi.thinkingContent.textContent = "";
  viewerUi.codeUi.thinkingSummary.textContent = "Thinking…";
  viewerUi.codeUi.thinkingBlock.open = true;
  viewerUi.footer.classList.remove("hidden");
  viewerUi.retryBtn.classList.add("hidden");
  showToolPlanCodePanel(viewerUi.codeUi);
  focusActiveToolCard(card, { collapseOthers: true });

  return viewerUi;
}

function updateViewerPhase(viewerUi, phaseId, status) {
  if (!viewerUi?.phases?.pills) return;
  const pill = viewerUi.phases.pills.get(phaseId);
  if (!pill) return;
  pill.className = `tool-viewer-phase step-${status}`;
}

function appendViewerLog(viewerUi, message, level = "info") {
  if (!viewerUi || !message) return;
  const prefix = level === "error" ? "[ERROR] " : level === "warn" ? "[WARN] " : "";
  viewerUi.outputLines.push(`${prefix}${message}`);
  viewerUi.codeUi.outputCode.textContent = viewerUi.outputLines.join("\n\n");
  viewerUi.codeUi.body.scrollTop = viewerUi.codeUi.body.scrollHeight;
}

function showViewerOutputTab(viewerUi) {
  if (!viewerUi?.codeUi) return;
  viewerUi.codeUi.tabs.classList.remove("hidden");
  viewerUi.codeUi.showCodeTab(viewerUi.codeUi.outputTab);
}

function showViewerSuccess(card, viewerUi, message) {
  if (viewerUi) {
    for (const phase of VIEWER_PHASES) {
      updateViewerPhase(viewerUi, phase.id, "done");
    }
    appendViewerLog(viewerUi, message);
    showViewerOutputTab(viewerUi);
    viewerUi.codeUi.panelTitle.textContent = "Complete";
    viewerUi.retryBtn.classList.add("hidden");
  }
  card._lastSuccessMessage = message;
  card.classList.add("tool-creation-viewer-success");
  card.classList.remove("tool-card-pip-active");
  collapseToolCard(card, {
    summary: message,
    status: "Installed",
    statusClass: "success",
  });
}

function handleBuildSseEvent(json, viewerUi, card) {
  const activeCard = card || viewerUi?.card;
  if (json.ada_event === "tool_build_phase" && viewerUi) {
    updateViewerPhase(viewerUi, json.phase, json.status);
    if (
      activeCard &&
      (json.status === "error" ||
        json.phase === "pip_review" ||
        json.phase === "runtime_verify")
    ) {
      scrollCardRegion(activeCard, ".tool-card-actions, .pip-install-actions");
    }
    return false;
  }
  if (json.ada_event === "tool_build_log" && viewerUi) {
    appendViewerLog(viewerUi, json.message, json.level || "info");
    if (json.level === "error") {
      showViewerOutputTab(viewerUi);
      scrollCardRegion(activeCard, ".tool-card-actions");
    }
    return false;
  }
  if (json.ada_event === "tool_code_thinking_delta" && viewerUi?.codeUi) {
    appendToolThinkingDelta(viewerUi.codeUi, json.delta || "");
    return false;
  }
  if (json.ada_event === "tool_code_delta" && viewerUi?.codeUi) {
    appendToolCodeDelta(viewerUi.codeUi, json.delta || "");
    return false;
  }
  if (json.ada_event === "tool_code_ready" && viewerUi?.codeUi) {
    showToolCodeReady(viewerUi.codeUi, json);
    return false;
  }
  if (json.ada_event === "pip_install_pending" && viewerUi) {
    updateViewerPhase(viewerUi, "pip_review", "active");
    const pkgList = (json.packages || []).join(", ");
    appendViewerLog(
      viewerUi,
      `New pip packages require approval: ${pkgList}`,
      "warn",
    );
    showViewerOutputTab(viewerUi);
    return false;
  }
  if (json.ada_event === "process_step" && viewerUi) {
    const mapped = VIEWER_PHASES.find((p) => p.id === json.step_id);
    if (mapped) updateViewerPhase(viewerUi, json.step_id, json.status);
  }
  return true;
}

function showToolPlanCodePanel(codeUi) {
  codeUi.panel.classList.remove("hidden");
  codeUi.panelTitle.textContent = "Generating…";
  codeUi.tabs.classList.add("hidden");
  codeUi.thinkingBlock.classList.add("hidden");
  codeUi.thinkingContent.textContent = "";
  codeUi.thinkingSummary.textContent = "Thinking…";
  codeUi.thinkingBlock.open = true;
  codeUi.streamPre.classList.remove("hidden");
  codeUi.toolPre.classList.add("hidden");
  codeUi.testPre.classList.add("hidden");
  codeUi.outputPre.classList.add("hidden");
  codeUi.streamCode.textContent = "";
}

function appendToolThinkingDelta(codeUi, delta) {
  if (!delta) return;
  codeUi.thinkingBlock.classList.remove("hidden");
  codeUi.thinkingContent.textContent += delta;
  if (codeUi.streamCode.textContent) {
    codeUi.thinkingSummary.textContent = "Thinking";
    codeUi.thinkingBlock.open = false;
  }
  codeUi.body.scrollTop = codeUi.body.scrollHeight;
}

function appendToolCodeDelta(codeUi, delta) {
  if (codeUi.thinkingContent.textContent) {
    codeUi.thinkingSummary.textContent = "Thinking";
    codeUi.thinkingBlock.open = false;
  }
  codeUi.streamCode.textContent += delta;
  codeUi.body.scrollTop = codeUi.body.scrollHeight;
}

function showToolCodeReady(codeUi, { tool_code, test_code }) {
  codeUi.thinkingBlock.classList.add("hidden");
  codeUi.panelTitle.textContent = "Generated code";
  codeUi.tabs.classList.remove("hidden");
  codeUi.toolCode.textContent = tool_code;
  codeUi.testCodeEl.textContent = test_code;
  codeUi.toolTab.classList.add("active");
  codeUi.testTab.classList.remove("active");
  codeUi.outputTab.classList.remove("active");
  codeUi.showCodeTab(codeUi.toolTab);
  enhanceCodeBlocks(codeUi.panel);
}

function renderToolPlanCard({ plan_id, tool_name, plan, run_id, kind }) {
  hideWelcome();

  const isEdit = kind === "edit";
  const badgeText = isEdit ? "Tool edit proposal" : "Tool proposal";

  const card = document.createElement("article");
  card.className = "tool-plan-card";
  card.dataset.planId = plan_id;
  card.dataset.toolName = tool_name;
  if (run_id) card.dataset.runId = run_id;
  if (kind) card.dataset.planKind = kind;

  const header = document.createElement("div");
  header.className = "tool-plan-header";
  header.innerHTML = `
    <span class="tool-plan-badge${isEdit ? " tool-plan-badge-edit" : ""}">${escapeHtml(badgeText)}</span>
    <h3 class="tool-plan-title">${escapeHtml(tool_name)}</h3>
  `;

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "tool-plan-body-wrap";

  const body = document.createElement("div");
  body.className = "tool-plan-body";
  body.innerHTML = renderMarkdown(plan);
  enhanceCodeBlocks(body);
  bodyWrap.appendChild(body);

  const codeUi = createToolPlanCodePanel();

  const feedbackSection = document.createElement("div");
  feedbackSection.className = "tool-plan-feedback";

  const feedbackLabel = document.createElement("label");
  feedbackLabel.htmlFor = `plan-feedback-${plan_id}`;
  feedbackLabel.textContent = "Request changes";

  const feedbackInput = document.createElement("textarea");
  feedbackInput.id = `plan-feedback-${plan_id}`;
  feedbackInput.rows = 3;
  feedbackInput.placeholder =
    "Describe what to change in this plan — the model will revise it using your feedback.";

  feedbackSection.appendChild(feedbackLabel);
  feedbackSection.appendChild(feedbackInput);

  const actions = document.createElement("div");
  actions.className = "tool-plan-actions";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "btn-primary";
  approveBtn.textContent = "Approve & Build Tool";

  const reviseBtn = document.createElement("button");
  reviseBtn.type = "button";
  reviseBtn.className = "btn-secondary";
  reviseBtn.textContent = "Request changes";

  const discardBtn = document.createElement("button");
  discardBtn.type = "button";
  discardBtn.className = "btn-ghost";
  discardBtn.textContent = "Discard";

  const resultEl = document.createElement("div");
  resultEl.className = "tool-plan-result hidden";

  approveBtn.addEventListener("click", () =>
    handleToolApproval(card, plan_id, run_id, tool_name),
  );
  reviseBtn.addEventListener("click", () =>
    handleToolRevision(
      card,
      plan_id,
      run_id,
      approveBtn,
      reviseBtn,
      discardBtn,
      feedbackInput,
      resultEl,
    ),
  );
  discardBtn.addEventListener("click", () =>
    handleToolRejection(card, plan_id, run_id, approveBtn, reviseBtn, discardBtn, resultEl),
  );

  actions.appendChild(approveBtn);
  actions.appendChild(reviseBtn);
  actions.appendChild(discardBtn);

  card._codeUi = codeUi;

  ensureToolCardShell(card);
  const shell = getToolCardShell(card);
  shell.chrome.appendChild(header);
  shell.scroll.append(bodyWrap, codeUi.panel, feedbackSection);
  shell.actions.append(actions, resultEl);

  messagesEl.appendChild(card);
  focusActiveToolCard(card);
}

function renderPipInstallCard(buildCard, { pip_id, run_id, tool_name, packages, already_installed }) {
  buildCard.querySelector(".pip-install-card")?.remove();
  buildCard.classList.add("tool-card-pip-active");
  buildCard.classList.remove("pip-review-active");

  const shell = ensureToolCardShell(buildCard);

  const section = document.createElement("div");
  section.className = "pip-install-card";
  section.dataset.pipId = pip_id;

  const header = document.createElement("div");
  header.className = "pip-install-header";
  header.innerHTML = `
    <span class="pip-install-badge">Pip install approval</span>
    <h4 class="pip-install-title">${escapeHtml(tool_name || "Tool")}</h4>
  `;

  const body = document.createElement("div");
  body.className = "pip-install-body";
  const pkgItems = (packages || [])
    .map((pkg) => `<li><code>${escapeHtml(pkg)}</code></li>`)
    .join("");
  const installedNote =
    already_installed && already_installed.length
      ? `<p class="pip-install-note">Already in shared venv: ${escapeHtml(already_installed.join(", "))}</p>`
      : "";
  body.innerHTML = `
    <p>The tool build needs new Python packages in the shared tool runtime venv:</p>
    <ul class="pip-install-packages">${pkgItems}</ul>
    ${installedNote}
    <p class="pip-install-warning">Approve only packages you trust. They persist in the shared environment.</p>
  `;

  const actions = document.createElement("div");
  actions.className = "pip-install-actions";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "btn-primary";
  approveBtn.textContent = "Approve pip install";

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "btn-ghost";
  rejectBtn.textContent = "Reject";

  approveBtn.addEventListener("click", () =>
    runPipContinuation(buildCard, pip_id, run_id, approveBtn, rejectBtn),
  );
  rejectBtn.addEventListener("click", () =>
    handlePipRejection(buildCard, pip_id, run_id, approveBtn, rejectBtn),
  );

  actions.appendChild(approveBtn);
  actions.appendChild(rejectBtn);
  section.appendChild(header);
  section.appendChild(body);
  section.appendChild(actions);
  shell.attention.replaceChildren(section);

  focusActiveToolCard(buildCard, { collapseOthers: false });
  scrollCardRegion(buildCard, ".pip-install-actions");
}

async function consumeBuildStream(response, viewerUi, card, planId) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let buildResult = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = parseSseChunks(buffer, (payload) => {
      try {
        const json = JSON.parse(payload);
        if (handleAdaEvent(json)) {
          /* process panel */
        }
        if (json.ada_event === "pip_install_pending") {
          buildResult = { status: "pip_pending", ...json };
          renderPipInstallCard(card, json);
          return;
        }
        if (!handleBuildSseEvent(json, viewerUi, card)) return;

        if (json.ada_event === "tool_installed") {
          buildResult = { status: "success", ...json };
          scrollCardRegion(card, ".tool-card-actions");
        } else if (json.ada_event === "tool_build_failed") {
          buildResult = { status: "failed", ...json };
          scrollCardRegion(card, ".tool-card-actions");
        }
      } catch {
        // Ignore malformed chunks.
      }
    });
  }

  return buildResult;
}

async function runPipContinuation(card, pipId, runId, approveBtn, rejectBtn) {
  const viewerUi = card._viewerUi;
  const planId = card.dataset.planId || "";
  const effectiveRunId = runId || card.dataset.runId || "";
  const controller = bindRunAbortController(effectiveRunId);

  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  card.querySelector(".pip-install-card")?.classList.add("pip-install-busy");
  appendViewerLog(viewerUi, "Installing approved pip packages…");

  let buildResult = null;

  try {
    const response = await fetch("/api/approve_pip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pip_id: pipId, run_id: effectiveRunId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }

    buildResult = await consumeBuildStream(response, viewerUi, card, planId);
    card.querySelector(".pip-install-card")?.remove();
    card.classList.remove("tool-card-pip-active");
    card.classList.remove("pip-review-active");

    if (buildResult?.status === "success") {
      showViewerSuccess(card, viewerUi, buildResult.message);
      conversation.push({
        role: "assistant",
        content: `[System] ${buildResult.message}`,
      });
      await loadConfig();
      await refreshToolsPanel();
      setStatus("");
    } else if (buildResult?.status === "failed") {
      const reason = buildResult.reason || "Build failed after pip install.";
      appendViewerLog(viewerUi, reason, "error");
      if (buildResult.logs) appendViewerLog(viewerUi, buildResult.logs, "error");
      showViewerOutputTab(viewerUi);
      viewerUi.retryBtn.classList.remove("hidden");
      setToolPlanCardBusy(card, false);
      setStatus("Tool verification failed.", true);
      focusActiveToolCard(card, { collapseOthers: false });
      scrollCardRegion(card, ".tool-card-actions");
    } else if (buildResult?.status === "pip_pending") {
      setToolPlanCardBusy(card, false);
      setStatus("Additional pip packages require approval.");
    }
  } catch (error) {
    card.querySelector(".pip-install-card")?.classList.remove("pip-install-busy");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    if (error.name === "AbortError") {
      appendViewerLog(viewerUi, "Pip install stopped by user.", "warn");
      showViewerOutputTab(viewerUi);
      return;
    }
    appendViewerLog(viewerUi, error.message, "error");
    showViewerOutputTab(viewerUi);
    setStatus(`Pip approval failed: ${error.message}`, true);
  } finally {
    runAbortControllers.delete(effectiveRunId);
    if (abortController === controller) abortController = null;
  }
}

async function handlePipRejection(card, pipId, runId, approveBtn, rejectBtn) {
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  try {
    const response = await fetch("/api/reject_pip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pip_id: pipId, run_id: runId || card.dataset.runId || "" }),
    });
    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }
    card.querySelector(".pip-install-card")?.remove();
    card.classList.remove("tool-card-pip-active");
    card.classList.remove("pip-review-active");
    const viewerUi = card._viewerUi;
    if (viewerUi) {
      updateViewerPhase(viewerUi, "pip_review", "error");
      appendViewerLog(viewerUi, "Pip install rejected — build cancelled.", "error");
      showViewerOutputTab(viewerUi);
      viewerUi.retryBtn.classList.remove("hidden");
    }
    setToolPlanCardBusy(card, false);
    setStatus("Pip install rejected.");
    focusActiveToolCard(card, { collapseOthers: false });
    scrollCardRegion(card, ".tool-card-actions");
  } catch (error) {
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    setStatus(`Reject failed: ${error.message}`, true);
  }
}

async function runToolBuild(card, planId, runId) {
  const effectiveRunId = runId || card.dataset.runId || "";
  const toolName = card.dataset.toolName || card.querySelector(".tool-plan-title")?.textContent || "";
  const controller = bindRunAbortController(effectiveRunId);
  const viewerUi = enterToolCreationViewer(card, toolName);
  viewerUi.retryBtn.onclick = () => runToolBuild(card, planId, runId);

  setToolPlanCardBusy(card, true);
  viewerUi.retryBtn.classList.add("hidden");
  setStatus("");

  let buildResult = null;

  try {
    const response = await fetch("/api/approve_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: planId,
        run_id: effectiveRunId,
        tool_creator_model: getSecondModel(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }

    buildResult = await consumeBuildStream(response, viewerUi, card, planId);

    if (buildResult?.status === "success") {
      showViewerSuccess(card, viewerUi, buildResult.message);
      conversation.push({
        role: "assistant",
        content: `[System] ${buildResult.message}`,
      });
      await loadConfig();
      await refreshToolsPanel();
      setStatus("");
    } else if (buildResult?.status === "pip_pending") {
      setToolPlanCardBusy(card, false);
      setStatus("New pip packages require your approval.");
    } else if (buildResult?.status === "failed") {
      const reason = buildResult.reason || "Build failed.";
      const logs = buildResult.logs || "";
      appendViewerLog(viewerUi, reason, "error");
      if (logs) appendViewerLog(viewerUi, logs, "error");
      showViewerOutputTab(viewerUi);
      viewerUi.retryBtn.classList.remove("hidden");
      setToolPlanCardBusy(card, false);
      viewerUi.retryBtn.disabled = false;
      const isCodegen =
        /json|tool_code|parse|missing tool_code/i.test(reason) && !logs;
      setStatus(isCodegen ? "Code generation failed." : "Tool verification failed.", true);
      focusActiveToolCard(card, { collapseOthers: false });
      scrollCardRegion(card, ".tool-card-actions");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      appendViewerLog(viewerUi, "Build stopped by user.", "warn");
      showViewerOutputTab(viewerUi);
      setToolPlanCardBusy(card, false);
      viewerUi.retryBtn.classList.remove("hidden");
      scrollCardRegion(card, ".tool-card-actions");
      return;
    }
    appendViewerLog(viewerUi, error.message, "error");
    showViewerOutputTab(viewerUi);
    viewerUi.retryBtn.classList.remove("hidden");
    setToolPlanCardBusy(card, false);
    viewerUi.retryBtn.disabled = false;
    setStatus(`Approval failed: ${error.message}`, true);
    focusActiveToolCard(card, { collapseOthers: false });
    scrollCardRegion(card, ".tool-card-actions");
  } finally {
    runAbortControllers.delete(effectiveRunId);
    if (abortController === controller) abortController = null;
  }
}

async function handleToolApproval(card, planId, runId, toolName) {
  card.dataset.toolName = toolName || card.dataset.toolName || "";
  await runToolBuild(card, planId, runId);
}

async function handleToolRevision(
  card,
  planId,
  runId,
  approveBtn,
  reviseBtn,
  discardBtn,
  feedbackInput,
  resultEl,
) {
  const feedback = feedbackInput.value.trim();
  if (!feedback) {
    feedbackInput.focus();
    setStatus("Describe the changes you want before requesting a revision.", true);
    return;
  }

  const effectiveRunId = runId || card.dataset.runId || "";
  const controller = bindRunAbortController(effectiveRunId);

  setToolPlanCardBusy(card, true);
  reviseBtn.textContent = "Revising plan...";
  resultEl.classList.add("hidden");
  setStatus("");

  try {
    const response = await fetch("/api/revise_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: planId,
        run_id: effectiveRunId,
        feedback,
        tool_creator_model: getSecondModel(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let revisedPlan = null;
    let reviseFailed = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunks(buffer, (payload) => {
        try {
          const json = JSON.parse(payload);
          if (handleAdaEvent(json)) return;

          if (json.ada_event === "tool_plan_revised") {
            revisedPlan = json.plan;
          } else if (json.ada_event === "tool_plan_revise_failed") {
            reviseFailed = json.reason || "Plan revision failed.";
          }
        } catch {
          // Ignore malformed chunks.
        }
      });
    }

    if (revisedPlan) {
      updateToolPlanCardContent(card, revisedPlan);
      conversation.push({
        role: "assistant",
        content: `[System] Tool plan revised based on your feedback: "${feedback}"`,
      });
      setStatus("");
    } else {
      throw new Error(reviseFailed || "Plan revision failed.");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setToolPlanCardBusy(card, false);
      reviseBtn.textContent = "Request changes";
      return;
    }
    resultEl.classList.remove("hidden");
    resultEl.className = "tool-plan-result error";
    resultEl.textContent = error.message;
    setStatus(`Revision failed: ${error.message}`, true);
  } finally {
    setToolPlanCardBusy(card, false);
    reviseBtn.textContent = "Request changes";
    runAbortControllers.delete(effectiveRunId);
    if (abortController === controller) abortController = null;
  }
}

async function handleToolRejection(
  card,
  planId,
  runId,
  approveBtn,
  reviseBtn,
  discardBtn,
  resultEl,
) {
  setToolPlanCardBusy(card, true);

  try {
    const response = await fetch("/api/reject_tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: planId }),
    });
    if (!response.ok) {
      throw new Error(parseErrorMessage(await response.text()));
    }
    if (runId) {
      updateProcessStep(runId, "awaiting_approval", {
        label: "Plan discarded",
        status: "error",
      });
      skipRemainingBuildSteps(runId);
    }
    card.remove();
    setStatus("");
  } catch (error) {
    resultEl.classList.remove("hidden");
    resultEl.className = "tool-plan-result error";
    resultEl.textContent = error.message;
    setToolPlanCardBusy(card, false);
    setStatus(`Discard failed: ${error.message}`, true);
  }
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

  localStorage.setItem(CHAT_MODEL_STORAGE_KEY, chatModelSelect.value);

  abortController = new AbortController();
  const runId = startProcessRun(content);
  runAbortControllers.set(runId, abortController);
  setSendingState(true);
  setStatus("");

  conversation.push({ role: "user", content });
  createUserMessage(content);
  messageInput.value = "";
  resetTextareaHeight();

  const state = createAssistantMessage();
  let planReceived = false;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        tool_creator_model: getSecondModel(),
        messages: buildMessages(),
        run_id: runId,
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
          if (handleAdaEvent(json)) return;
          if (json.ada_event === "chat_error") {
            throw new Error(json.detail || "Chat failed.");
          }
          if (json.ada_event === "tool_plan_pending") {
            planReceived = true;
            registerBuildSteps(json.run_id || runId);
            renderToolPlanCard(json);
            return;
          }
          const delta = json.choices?.[0]?.delta || {};
          parseStreamDelta(delta, state);
        } catch {
          // Ignore malformed chunks.
        }
      });
    }

    if (planReceived) {
      state.row.remove();
      conversation.push({
        role: "assistant",
        content: "[System] A new tool plan is pending your approval.",
      });
      setStatus("");
    } else {
      finalizeAssistantMessage(state);
      if (state.assistantText) {
        conversation.push({ role: "assistant", content: state.assistantText });
      }
      setStatus("");
    }
  } catch (error) {
    if (activeRunId) {
      updateProcessStep(activeRunId, "lite_model", {
        label: "Request failed",
        status: "error",
        detail: error.message,
      });
    }
    if (error.name === "AbortError") {
      finalizeAssistantMessage(state);
      if (state.assistantText) {
        conversation.push({ role: "assistant", content: state.assistantText });
        setStatus("Generation stopped.");
      } else {
        state.row.remove();
        conversation.pop();
        setStatus("Generation stopped.");
      }
    } else {
      state.row.remove();
      conversation.pop();
      setStatus(`Chat failed: ${error.message}`, true);
    }
  } finally {
    runAbortControllers.delete(runId);
    abortController = null;
    setSendingState(false);
    scrollBottomBtn.classList.add("hidden");
    messageInput.focus();
  }
}

function stopGeneration() {
  if (activeRunId) {
    stopProcessRun(activeRunId);
    return;
  }
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

chatModelSelect.addEventListener("change", () => {
  if (chatModelSelect.value) {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, chatModelSelect.value);
  }
});

secondModelSelect.addEventListener("change", () => {
  if (secondModelSelect.value) {
    localStorage.setItem(SECOND_MODEL_STORAGE_KEY, secondModelSelect.value);
  }
});

messageInput.addEventListener("input", autoResizeTextarea);
systemInput.addEventListener("input", saveSystemInstructions);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!isSending) chatForm.requestSubmit();
  }
});

loadSystemInstructions();
loadModels();
refreshToolsPanel();
