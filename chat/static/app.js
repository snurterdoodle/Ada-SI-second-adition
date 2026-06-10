const modelSelect = document.getElementById("model-select");
const customModelInput = document.getElementById("custom-model");
const refreshModelsButton = document.getElementById("refresh-models");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const statusEl = document.getElementById("status");

let conversation = [];
let isSending = false;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function getSelectedModel() {
  const custom = customModelInput.value.trim();
  if (custom) return custom;
  return modelSelect.value;
}

function appendMessage(role, content) {
  const el = document.createElement("article");
  el.className = `message ${role}`;
  el.innerHTML = `<span class="role">${role}</span>${escapeHtml(content)}`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadModels() {
  modelSelect.disabled = true;
  setStatus("Loading models...");

  try {
    const response = await fetch("/api/models");
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    const models = (data.data || [])
      .map((item) => item.id)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    modelSelect.innerHTML = "";

    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No models found</option>';
      setStatus("No models available. Add API keys to .env and restart.", true);
      return;
    }

    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
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

  isSending = true;
  sendButton.disabled = true;
  messageInput.disabled = true;
  setStatus("Thinking...");

  conversation.push({ role: "user", content });
  appendMessage("user", content);
  messageInput.value = "";

  const assistantEl = appendMessage("assistant", "");
  let assistantText = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: conversation,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
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
          const delta = json.choices?.[0]?.delta?.content || "";
          if (!delta) return;
          assistantText += delta;
          assistantEl.innerHTML = `<span class="role">assistant</span>${escapeHtml(assistantText)}`;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } catch {
          // Ignore malformed chunks.
        }
      });
    }

    if (!assistantText) {
      assistantText = "(No response)";
      assistantEl.innerHTML = `<span class="role">assistant</span>${assistantText}`;
    }

    conversation.push({ role: "assistant", content: assistantText });
    setStatus("");
  } catch (error) {
    assistantEl.remove();
    conversation.pop();
    setStatus(`Chat failed: ${error.message}`, true);
  } finally {
    isSending = false;
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }
}

refreshModelsButton.addEventListener("click", loadModels);
chatForm.addEventListener("submit", sendMessage);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

loadModels();
