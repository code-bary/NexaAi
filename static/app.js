const NVIDIA_CONFIG = {
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  temperature: 1,
  topP: 0.95,
  maxTokens: 8192,
  reasoningBudget: 4096,
  enableThinking: true
};

const STORAGE_KEY = "nexaai.chat.history.v1";

function createChatId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeChatItem(item) {
  const messages = Array.isArray(item.messages)
    ? item.messages.map(message => ({
        role: message?.role === "assistant" ? "assistant" : "user",
        content: String(message?.content || ""),
        attachments: Array.isArray(message?.attachments)
          ? message.attachments.map(attachment => ({
              id: attachment?.id || createChatId(),
              name: attachment?.name || "attachment",
              type: attachment?.type || "application/octet-stream",
              size: Number(attachment?.size || 0),
              kind: attachment?.kind === "image" ? "image" : "file",
              data: attachment?.data || ""
            }))
          : [],
        createdAt: message?.createdAt || new Date().toISOString()
      }))
    : [];

  return {
    id: item?.id || createChatId(),
    title: item?.title || item?.text || "New chat",
    pinned: Boolean(item?.pinned),
    createdAt: item?.createdAt || new Date().toISOString(),
    updatedAt: item?.updatedAt || new Date().toISOString(),
    messages
  };
}

function loadStoredHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeChatItem);
  } catch (error) {
    console.warn("Unable to read saved chats:", error);
    return [];
  }
}

function saveHistoryToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(historyItems));
  } catch (error) {
    console.warn("Unable to save chats:", error);
  }
}

let historyItems = loadStoredHistory();
let activeMenuId = null;
let currentChatId = null;
let currentChatTitle = null;
let toastTimer;
let isGenerating = false;
let pendingAttachments = [];
let conversationMessages = [];
let activeRequestController = null;
let activeTypingMessage = null;
let activeResponseBubble = null;

const $ = id => document.getElementById(id);

const sidebar = $("sidebar");
const overlay = $("overlay");
const input = $("chatInput");
const sendBtn = $("sendBtn");
const fileInput = $("fileInput");
const chatInner = $("chatInner");
const chatScroll = $("chatScroll");
const histMenu = $("histMenu");
const modelMenu = $("modelMenu");
const attachmentBox = $("attachmentBox");
const bottomWrap = document.querySelector(".bottom-wrap");

function syncBottomInputPosition() {
  if (!bottomWrap || window.innerWidth > 768) {
    document.documentElement.style.setProperty("--keyboard-offset", "0px");
    bottomWrap && (bottomWrap.style.transform = "translateY(0)");
    return;
  }

  if (!window.visualViewport) {
    document.documentElement.style.setProperty("--keyboard-offset", "0px");
    bottomWrap.style.transform = "translateY(0)";
    return;
  }

  const viewportHeight = window.visualViewport.height;
  const keyboardOffset = Math.max(
    0,
    window.innerHeight - viewportHeight - (window.visualViewport.offsetTop || 0)
  );

  document.documentElement.style.setProperty(
    "--keyboard-offset",
    `${Math.max(0, keyboardOffset)}px`
  );

  if (keyboardOffset > 0) {
    bottomWrap.style.transform = `translateY(-${keyboardOffset}px)`;
    if (document.activeElement === input) {
      input.scrollIntoView({
        behavior: "smooth",
        block: "end"
      });
    }
    return;
  }

  bottomWrap.style.transform = "translateY(0)";
}

window.visualViewport?.addEventListener("resize", syncBottomInputPosition);
window.visualViewport?.addEventListener("scroll", syncBottomInputPosition);
window.addEventListener("resize", syncBottomInputPosition);

input.addEventListener("focus", () => {
  window.requestAnimationFrame(syncBottomInputPosition);
});

input.addEventListener("blur", () => {
  document.documentElement.style.setProperty("--keyboard-offset", "0px");
  bottomWrap && (bottomWrap.style.transform = "translateY(0)");
});

$("collapseBtn").onclick = event => {
  event.stopPropagation();

  if (window.innerWidth <= 768) {
    sidebar.classList.remove("mobile-open");
    overlay.classList.remove("show");
  } else {
    sidebar.classList.toggle("collapsed");
  }
};

document.querySelector(".logo").addEventListener("click", event => {
  if (window.innerWidth > 768 && sidebar.classList.contains("collapsed")) {
    event.preventDefault();
    sidebar.classList.remove("collapsed");
  }
});

sidebar.addEventListener("click", event => {
  if (window.innerWidth <= 768 || !sidebar.classList.contains("collapsed")) {
    return;
  }

  if (event.target.closest("#collapseBtn")) {
    return;
  }

  sidebar.classList.remove("collapsed");
});

$("hamburgerBtn").onclick = () => {
  sidebar.classList.add("mobile-open");
  overlay.classList.add("show");
};

overlay.onclick = () => {
  sidebar.classList.remove("mobile-open");
  overlay.classList.remove("show");
};

document.querySelectorAll(".feat-btn").forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".feat-btn").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");

    const featureName =
      button.dataset.feature.charAt(0).toUpperCase() +
      button.dataset.feature.slice(1);

    showToast(`Switched to ${featureName}`);
  };
});

$("newProjectLink").onclick = event => {
  event.preventDefault();
  startNewChat();
};

$("planLink").onclick = event => {
  event.preventDefault();
  showToast("Upgrade to Pro — $19/month ✦");
};

function deriveChatTitle(messages) {
  const firstUserMessage = messages.find(message => message.role === "user");

  if (!firstUserMessage?.content) {
    return "New chat";
  }

  const title = String(firstUserMessage.content).trim();

  return title.slice(0, 32) + (title.length > 32 ? "…" : "");
}

function persistCurrentChatState() {
  if (!currentChatId) {
    currentChatId = createChatId();
  }

  const safeMessages = conversationMessages.map(message => ({
    ...message,
    createdAt: message.createdAt || new Date().toISOString()
  }));

  const nextTitle = currentChatTitle || deriveChatTitle(safeMessages);

  let activeChat = historyItems.find(chat => chat.id === currentChatId);

  if (!activeChat) {
    activeChat = {
      id: currentChatId,
      title: nextTitle,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: safeMessages
    };

    historyItems.unshift(activeChat);
  } else {
    activeChat.title = nextTitle;
    activeChat.messages = safeMessages;
    activeChat.updatedAt = new Date().toISOString();
  }

  currentChatTitle = nextTitle;

  saveHistoryToStorage();
  renderHistory();
}

function renderConversation() {
  chatInner.innerHTML = "";

  if (!conversationMessages.length) {
    chatInner.innerHTML = `
      <div class="empty-state" id="emptyState">
        <div class="orb"></div>

        <h1>
          Hello, I'm
          <span>NexaAI</span>
        </h1>

        <p>
          Your intelligent creative partner.
          Ask me anything — generate images,
          build presentations, or get help with code.
        </p>
      </div>
    `;
    return;
  }

  conversationMessages.forEach(message => {
    const sender = message.role === "assistant" ? "ai" : "user";
    const renderedMessage = addMessage(
      message.content,
      sender,
      Array.isArray(message.attachments) ? message.attachments : []
    );

    if (sender === "ai") {
      setupAIMessageActions(renderedMessage);
    }
  });

  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function renderHistory() {
  const historyList = $("historyList");

  historyList.innerHTML = "";

  const sortedHistory = [...historyItems].sort((a, b) => {
    if (Number(b.pinned) !== Number(a.pinned)) {
      return Number(b.pinned) - Number(a.pinned);
    }

    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  sortedHistory.forEach(item => {
    const historyItem = document.createElement("div");

    historyItem.className = "hist-item";

    if (currentChatId === item.id) {
      historyItem.classList.add("active");
    }

    historyItem.innerHTML = `
      ${
        item.pinned
          ? `
            <span class="hist-pin">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 3.94a2.5 2.5 0 0 1 3.54 0l.52.52a2.5 2.5 0 0 1 0 3.54L14 14.06l-3-3zM12 15.07l-5.5 5.5V21h.43l5.5-5.5z"/>
              </svg>
            </span>
          `
          : ""
      }

      <span class="hist-text">
        ${escapeHTML(item.title || "New chat")}
      </span>

      <button class="hist-dots" title="More">
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="currentColor"
        >
          <circle cx="12" cy="5" r="1.7"/>
          <circle cx="12" cy="12" r="1.7"/>
          <circle cx="12" cy="19" r="1.7"/>
        </svg>
      </button>
    `;

    const moreButton = historyItem.querySelector(".hist-dots");

    moreButton.onclick = event => {
      event.stopPropagation();
      openHistoryMenu(moreButton, item);
    };

    historyItem.onclick = () => {
      loadChatById(item.id);
    };

    historyList.appendChild(historyItem);
  });
}

function loadChatById(chatId) {
  const chat = historyItems.find(item => item.id === chatId);

  if (!chat) {
    return;
  }

  currentChatId = chat.id;
  currentChatTitle = chat.title || "New chat";
  conversationMessages = chat.messages.map(message => ({
    ...message,
    createdAt: message.createdAt || new Date().toISOString()
  }));

  renderConversation();
  renderHistory();
  closeAllMenus();
  showToast(`Opened: ${currentChatTitle}`);
}

function addNewChatButton() {
  const sidebar = $("sidebar");
  const existingButton = $("newChatBtn");

  if (existingButton) {
    return;
  }

  const button = document.createElement("button");

  button.id = "newChatBtn";
  button.className = "new-chat-btn";
  button.type = "button";
  button.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
    <span>New Chat</span>
  `;

  button.onclick = () => {
    startNewChat();
  };

  button.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin: 14px;
    padding: 12px 16px;
    border: 1px solid rgba(124, 58, 237, 0.45);
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(124, 58, 237, 0.08));
    color: #fff;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    transition: 0.25s;
    box-shadow: 0 10px 22px rgba(124, 58, 237, 0.18);
  `;

  button.onmouseover = () => {
    button.style.transform = "translateY(-1px)";
    button.style.boxShadow = "0 14px 28px rgba(124, 58, 237, 0.25)";
  };

  button.onmouseout = () => {
    button.style.transform = "none";
    button.style.boxShadow = "0 10px 22px rgba(124, 58, 237, 0.18)";
  };

  button.querySelector("svg").style.cssText = "width: 16px; height: 16px;";

  sidebar.appendChild(button);
}

renderHistory();
addNewChatButton();

function openHistoryMenu(anchor, item) {
  activeMenuId = item.id;

  histMenu.innerHTML = `
    <button class="drop-item" data-action="rename">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round">
        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>
      </svg>
      Rename
    </button>

    <button class="drop-item" data-action="pin">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 3.94a2.5 2.5 0 0 1 3.54 0l.52.52a2.5 2.5 0 0 1 0 3.54L14 14.06l-3-3z"/>
      </svg>
      ${item.pinned ? "Unpin" : "Pin"}
    </button>

    <button class="drop-item danger" data-action="delete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18"/>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      </svg>
      Delete
    </button>
  `;

  positionMenu(histMenu, anchor);

  histMenu.querySelectorAll(".drop-item").forEach(button => {
    button.onclick = () => {
      const action = button.dataset.action;

      if (action === "rename") {
        const history = historyItems.find(
          historyItem => historyItem.id === item.id
        );

        const newName = prompt(
          "Rename chat:",
          history?.title || history?.text || "New chat"
        );

        if (newName && newName.trim()) {
          if (history) {
            history.title = newName.trim();
            history.updatedAt = new Date().toISOString();
            saveHistoryToStorage();
          }

          if (currentChatId === item.id) {
            currentChatTitle = newName.trim();
          }

          renderHistory();
          showToast("Chat renamed");
        }
      }

      if (action === "pin") {
        const history = historyItems.find(
          historyItem => historyItem.id === item.id
        );

        if (history) {
          history.pinned = !history.pinned;
          history.updatedAt = new Date().toISOString();
          saveHistoryToStorage();
        }

        renderHistory();

        showToast(
          history?.pinned
            ? "Pinned to top"
            : "Unpinned"
        );
      }

      if (action === "delete") {
        historyItems = historyItems.filter(
          historyItem => historyItem.id !== item.id
        );

        if (currentChatId === item.id) {
          currentChatId = null;
          currentChatTitle = null;
          conversationMessages = [];
          renderConversation();
        }

        saveHistoryToStorage();
        renderHistory();
        showToast("Chat deleted");
      }

      closeAllMenus();
    };
  });
}

function positionMenu(menu, anchor) {
  closeAllMenus();

  menu.classList.add("open");

  const anchorRect = anchor.getBoundingClientRect();

  const topPosition = Math.min(
    anchorRect.bottom + 6,
    window.innerHeight - menu.offsetHeight - 10
  );

  const leftPosition = Math.min(
    anchorRect.left,
    window.innerWidth - menu.offsetWidth - 10
  );

  menu.style.top = `${topPosition}px`;
  menu.style.left = `${leftPosition}px`;
}

function closeAllMenus() {
  document.querySelectorAll(".drop-menu").forEach(menu => {
    menu.classList.remove("open");
  });

  activeMenuId = null;
}

document.addEventListener("click", event => {
  const clickedInsideMenu = event.target.closest(".drop-menu");
  const clickedHistoryDots = event.target.closest(".hist-dots");
  const clickedModelButton = event.target.closest(".model-btn");

  if (
    !clickedInsideMenu &&
    !clickedHistoryDots &&
    !clickedModelButton
  ) {
    closeAllMenus();
  }
});

$("modelBtn").onclick = event => {
  event.stopPropagation();

  if (modelMenu.classList.contains("open")) {
    closeAllMenus();
  } else {
    positionMenu(modelMenu, $("modelBtn"));
  }
};

modelMenu.querySelectorAll(".drop-item").forEach(button => {
  button.onclick = () => {
    $("modelName").textContent = button.dataset.model;
    closeAllMenus();
    showToast(`Model: ${button.dataset.model}`);
  };
});

function getSendButtonIconSvg(isStopMode = false) {
  if (isStopMode) {
    return `
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="5" y="5" width="14" height="14" rx="2"></rect>
      </svg>
    `;
  }

  return `
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  `;
}

function updateSendButtonState() {
  if (!sendBtn) {
    return;
  }

  const shouldStop = Boolean(isGenerating);

  sendBtn.disabled = !shouldStop && !input.value.trim() && pendingAttachments.length === 0;
  sendBtn.title = shouldStop ? "Stop" : "Send";
  sendBtn.setAttribute("aria-label", shouldStop ? "Stop" : "Send");
  sendBtn.classList.toggle("stop-mode", shouldStop);
  sendBtn.innerHTML = getSendButtonIconSvg(shouldStop);
}

input.addEventListener("input", () => {
  input.style.height = "auto";

  input.style.height = `${Math.min(
    input.scrollHeight,
    150
  )}px`;

  updateSendButtonState();
});

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (isGenerating) {
      stopGeneration();
      return;
    }
    sendMessage();
  }
});

sendBtn.onclick = () => {
  if (isGenerating) {
    stopGeneration();
    return;
  }

  sendMessage();
};

const newChatButtons = [
  document.getElementById("newChatTopBtn"),
  document.getElementById("newChatBtn")
].filter(Boolean);

newChatButtons.forEach(button => {
  button.onclick = () => {
    startNewChat();
  };
});

function removeEmptyState() {
  const emptyState = $("emptyState");

  if (emptyState) {
    emptyState.remove();
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/\"/g, "&quot;");
}

function renderInlineMarkdown(value) {
  let html = escapeHTML(value);

  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1<em>$2</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  return html;
}

function renderMarkdownBlocks(text) {
  const safeText = String(text ?? "").replace(/\r\n/g, "\n").trim();

  if (!safeText) {
    return "";
  }

  const blocks = safeText.split(/\n\s*\n/);

  return blocks
    .map(block => {
      const trimmed = block.trim();

      if (!trimmed) {
        return "";
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);

      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = headingMatch[2].trim();

        return `<h${level} class="markdown-heading">${renderInlineMarkdown(content)}</h${level}>`;
      }

      const listLines = trimmed
        .split(/\n/)
        .map(line => line.trim())
        .filter(Boolean);

      if (listLines.length && listLines.every(line => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))) {
        const ordered = listLines.every(line => /^\d+\.\s+/.test(line));
        const tag = ordered ? "ol" : "ul";
        const items = listLines
          .map(line => {
            const content = ordered
              ? line.replace(/^\d+\.\s+/, "")
              : line.replace(/^[-*+]\s+/, "");

            return `<li>${renderInlineMarkdown(content)}</li>`;
          })
          .join("");

        return `<${tag} class="markdown-list">${items}</${tag}>`;
      }

      return `<p class="markdown-paragraph">${renderInlineMarkdown(trimmed).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

function highlightCode(code, language) {
  let html = escapeHTML(code);
  const normalizedLanguage = String(language || "code").toLowerCase();

  html = html
    .replace(/(\/\*[\s\S]*?\*\/|\/\/.*$)/gm, '<span class="token comment">$1</span>')
    .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, '<span class="token string">$1</span>')
    .replace(/\b(true|false|null|undefined|const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|import|from|export|default|new|try|catch|await|async|typeof|in|of|extends|implements|interface|public|private|protected|package|def|print|len|None|True|False|elif|and|or|not|yield|pass|raise|finally|with|as|match|case|do|while|throw|super|this|document|window|console)\b/g, '<span class="token keyword">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token number">$1</span>')
    .replace(/(&(?:amp|lt|gt|quot|#039);)/g, '$1');

  if (normalizedLanguage.includes("html") || normalizedLanguage.includes("xml") || normalizedLanguage.includes("svg")) {
    html = html.replace(/(&lt;\/?[A-Za-z][^&]*?&gt;)/g, '<span class="token tag">$1</span>');
  }

  if (normalizedLanguage.includes("css") || normalizedLanguage.includes("scss") || normalizedLanguage.includes("less")) {
    html = html.replace(/([.#]?[A-Za-z_-][\w-]*)(\s*\{)/g, '<span class="token selector">$1</span>$2');
    html = html.replace(/(#[0-9a-fA-F]{3,8}|\b(?:auto|inherit|initial|none|block|flex|grid|absolute|relative|fixed|sticky|transparent|solid|dashed|pointer)\b)/g, '<span class="token value">$1</span>');
  }

  if (normalizedLanguage.includes("json") || normalizedLanguage.includes("yaml") || normalizedLanguage.includes("toml")) {
    html = html.replace(/("[^"]+")\s*:/g, '<span class="token key">$1</span> :');
  }

  if (normalizedLanguage.includes("sql")) {
    html = html.replace(/\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|VIEW|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|GROUP|BY|ORDER|LIMIT|HAVING|UNION|VALUES|COUNT|SUM|AVG|MIN|MAX)\b/gi, '<span class="token keyword">$1</span>');
  }

  return html;
}

function renderCodeBlock(rawBlock) {
  const match = rawBlock.match(/^```([^\n\r]*)\n([\s\S]*?)\n?```$/);

  if (!match) {
    return "";
  }

  const language = (match[1] || "code").trim() || "code";
  const code = match[2].replace(/\r\n/g, "\n");
  const highlighted = highlightCode(code, language);

  return `
    <div class="code-block-shell">
      <div class="code-block-header">
        <span class="code-language">${escapeHTML(language)}</span>
        <button
          type="button"
          class="code-copy-btn"
          data-copy-text="${escapeAttribute(code)}"
          aria-label="Copy code"
        >Copy</button>
      </div>
      <pre class="code-pre"><code class="language-${escapeAttribute(language)}">${highlighted}</code></pre>
    </div>
  `;
}

function parseWritingAttributes(attributeString) {
  const attributes = {};
  const regex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match;

  while ((match = regex.exec(attributeString))) {
    const key = match[1].toLowerCase();
    const value = match[2] || match[3] || match[4] || "";
    attributes[key] = value;
  }

  return attributes;
}

function getWritingLabel(variant) {
  const normalized = String(variant || "writing").trim().toLowerCase();
  const labels = {
    email: "Email",
    prompt: "Prompt",
    script: "Script",
    message: "Message",
    "social media post": "Social Post",
    "social-post": "Social Post",
    "social": "Social Post",
    letter: "Letter",
    application: "Application",
    notice: "Notice",
    bio: "Bio",
    article: "Article",
    report: "Report",
    "professional letter": "Professional Letter"
  };

  if (labels[normalized]) {
    return labels[normalized];
  }

  return normalized
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Writing";
}

function renderWritingBlock(rawBlock) {
  const match = rawBlock.match(/^:::writing\s*\{([\s\S]*?)\}\s*([\s\S]*?)\s*:::/);

  if (!match) {
    return "";
  }

  const attributes = parseWritingAttributes(match[1]);
  const variant = attributes.variant || "writing";
  const title = attributes.title || getWritingLabel(variant);
  const content = (match[2] || "").trim();

  return `
    <div class="writing-block-shell">
      <div class="writing-block-header">
        <div class="writing-block-label">
          <span class="writing-block-icon">✎</span>
          <span>${escapeHTML(getWritingLabel(variant))}</span>
        </div>
        <button
          type="button"
          class="writing-copy-btn"
          data-copy-text="${escapeAttribute(content)}"
          aria-label="Copy writing"
        >Copy</button>
      </div>
      <div class="writing-block-title">${escapeHTML(title)}</div>
      <div class="writing-block-body">${renderMarkdownContent(content)}</div>
    </div>
  `;
}

function renderMarkdownContent(rawText) {
  const source = String(rawText ?? "").replace(/\r\n/g, "\n");

  if (!source.trim()) {
    return "";
  }

  const tokenRegex = /```[\s\S]*?```|:::writing\s*\{[^}]*\}[\s\S]*?:::/g;
  const output = [];
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(source)) !== null) {
    const token = match[0];

    if (match.index > lastIndex) {
      const plainText = source.slice(lastIndex, match.index);

      if (plainText.trim()) {
        output.push(renderMarkdownBlocks(plainText));
      }
    }

    if (token.startsWith("```")) {
      output.push(renderCodeBlock(token));
    } else if (token.startsWith(":::writing")) {
      output.push(renderWritingBlock(token));
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < source.length) {
    const trailingText = source.slice(lastIndex);

    if (trailingText.trim()) {
      output.push(renderMarkdownBlocks(trailingText));
    }
  }

  const html = output.join("");

  if (html) {
    return html;
  }

  return `<p class="markdown-paragraph">${renderInlineMarkdown(source.trim())}</p>`;
}

function bindMessageCopyButtons(container) {
  container.querySelectorAll(".code-copy-btn, .writing-copy-btn").forEach(button => {
    button.onclick = async () => {
      const text = button.dataset.copyText || "";

      if (!text.trim()) {
        showToast("Nothing to copy");
        return;
      }

      const originalText = button.textContent;

      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove("copied");
        }, 1200);
      } catch (error) {
        const temp = document.createElement("textarea");

        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();
        button.textContent = "Copied";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove("copied");
        }, 1200);
      }
    };
  });
}

function formatAttachmentSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function renderAttachmentMarkup(attachment) {
  if (attachment.kind === "image") {
    return `
      <div class="attachment-inline attachment-inline-image">
        <img class="attachment-thumb" src="${attachment.data}" alt="${escapeHTML(attachment.name)}" />
      </div>
    `;
  }

  return `
    <div class="attachment-inline attachment-inline-file">
      <span class="attachment-file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6" />
          <path d="M9 17h6" />
        </svg>
      </span>
      <span class="attachment-name">${escapeHTML(attachment.name)}</span>
    </div>
  `;
}

function addMessage(text, sender, attachments = []) {
  removeEmptyState();

  const message = document.createElement("div");

  message.className = `msg ${sender}`;

  if (sender === "ai") {
    message.innerHTML = `
      <div class="ai-response-content">
        <div class="bubble"></div>

        <div class="ai-message-actions">
          <button
            class="ai-action-btn response-copy"
            title="Copy"
            aria-label="Copy"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>

          <button
            class="ai-action-btn response-like"
            title="Like"
            aria-label="Like"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M7 10v12"></path>
              <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3l4.5-6a1.5 1.5 0 0 1 3.5 1.88Z"></path>
            </svg>
          </button>

          <button
            class="ai-action-btn response-dislike"
            title="Dislike"
            aria-label="Dislike"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M17 14V2"></path>
              <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4.5 6a1.5 1.5 0 0 1-3.5-1.88Z"></path>
            </svg>
          </button>

          <button
            class="ai-action-btn response-speak"
            title="Read aloud"
            aria-label="Read aloud"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 5 6 9H2v6h4l5 4z"></path>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  } else {
    message.innerHTML = `
      <div class="user-message-stack">
        <div class="user-message-attachments"></div>
        <div class="bubble"><div class="user-message-content"></div></div>
      </div>
    `;
  }

  const bubble = message.querySelector(".bubble");

  if (sender === "ai") {
    bubble.dataset.rawText = String(text ?? "");
    bubble.innerHTML = renderMarkdownContent(text);
  } else {
    const userAttachments = message.querySelector(".user-message-attachments");
    const userContent = bubble.querySelector(".user-message-content");

    if (attachments.length) {
      const attachmentMarkup = attachments
        .map(attachment => renderAttachmentMarkup(attachment))
        .join("");

      userAttachments.insertAdjacentHTML("beforeend", attachmentMarkup);
    }

    if (text) {
      const textNode = document.createElement("div");
      textNode.className = "user-message-text";
      textNode.textContent = text;
      userContent.appendChild(textNode);
    }
  }

  if (sender === "ai") {
    setupAIMessageActions(message);
  }

  chatInner.appendChild(message);

  chatScroll.scrollTop = chatScroll.scrollHeight;

  return message;
}

function setupAIMessageActions(message) {
  const bubble = message.querySelector(".bubble");
  const copyBtn = message.querySelector(".response-copy");
  const likeBtn = message.querySelector(".response-like");
  const dislikeBtn = message.querySelector(".response-dislike");
  const speakBtn = message.querySelector(".response-speak");

  bindMessageCopyButtons(message);

  copyBtn.onclick = async () => {
    const text = bubble.dataset.rawText?.trim() || bubble.textContent.trim();

    if (!text) {
      showToast("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      copyBtn.classList.add("active");
      copyBtn.title = "Copied";
      setTimeout(() => {
        copyBtn.classList.remove("active");
        copyBtn.title = "Copy";
      }, 1200);
      showToast("Copied to clipboard");
    } catch (error) {
      const temp = document.createElement("textarea");

      temp.value = text;
      document.body.appendChild(temp);
      temp.select();

      document.execCommand("copy");

      temp.remove();
      copyBtn.classList.add("active");
      copyBtn.title = "Copied";
      setTimeout(() => {
        copyBtn.classList.remove("active");
        copyBtn.title = "Copy";
      }, 1200);
      showToast("Copied to clipboard");
    }
  };

  likeBtn.onclick = () => {
    likeBtn.classList.toggle("active");
    dislikeBtn.classList.remove("active");

    showToast(
      likeBtn.classList.contains("active")
        ? "Thanks for the feedback"
        : "Like removed"
    );
  };

  dislikeBtn.onclick = () => {
    dislikeBtn.classList.toggle("active");
    likeBtn.classList.remove("active");

    showToast(
      dislikeBtn.classList.contains("active")
        ? "Thanks for the feedback"
        : "Dislike removed"
    );
  };

  speakBtn.onclick = () => {
    if (!("speechSynthesis" in window)) {
      showToast("Text-to-speech is not supported");
      return;
    }

    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();

      document.querySelectorAll(".response-speak").forEach(button => {
        button.classList.remove("active");
      });

      return;
    }

    const text = bubble.textContent.trim();

    if (!text) return;

    const speech = new SpeechSynthesisUtterance(text);

    speech.onend = () => {
      speakBtn.classList.remove("active");
    };

    speech.onerror = () => {
      speakBtn.classList.remove("active");
    };

    document.querySelectorAll(".response-speak").forEach(button => {
      button.classList.remove("active");
    });

    speakBtn.classList.add("active");

    speechSynthesis.speak(speech);
  };
}

function normalizeImageDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") {
    return "";
  }

  const trimmed = dataUrl.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  const rawBase64 = trimmed.replace(/^data:.*;base64,/, "");

  if (!rawBase64 || rawBase64 === trimmed) {
    return trimmed;
  }

  const mimeType = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.test(trimmed)
    ? trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)[1]
    : "image/jpeg";

  return `data:${mimeType};base64,${rawBase64}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Unable to read file"));
      reader.readAsDataURL(file);
      return;
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      try {
        const maxDimension = 1536;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);

        const mimeType = file.type && file.type.includes("png") ? "image/png" : "image/jpeg";
        const quality = mimeType === "image/png" ? 0.92 : 0.82;

        const dataUrl = canvas.toDataURL(mimeType, quality);
        URL.revokeObjectURL(objectUrl);
        resolve(dataUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to read image"));
    };

    image.src = objectUrl;
  });
}

function createMultimodalMessageContent(message) {
  const parts = [];
  const messageText = typeof message.content === "string" ? message.content.trim() : "";

  if (messageText) {
    parts.push({
      type: "text",
      text: messageText
    });
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  attachments.forEach(attachment => {
    if (attachment?.kind === "image" && attachment?.data) {
      const normalizedImageUrl = normalizeImageDataUrl(attachment.data);

      if (normalizedImageUrl) {
        parts.push({
          type: "image_url",
          image_url: {
            url: normalizedImageUrl
          }
        });
      }
      return;
    }

    if (attachment?.name) {
      const attachmentNote = `Document attached: ${attachment.name}`;
      parts.push({
        type: "text",
        text: attachmentNote
      });
    }
  });

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1 && parts[0].type === "text") {
    return parts[0].text;
  }

  return parts;
}

function createNvidiaRequestBody() {
  const shouldUseVisionModel = conversationMessages.some(message =>
    Array.isArray(message.attachments) &&
    message.attachments.some(attachment => attachment?.kind === "image")
  );

  return {
    model: shouldUseVisionModel
      ? "meta/llama-3.2-90b-vision-instruct"
      : NVIDIA_CONFIG.model,
    messages: conversationMessages.map(message => ({
      role: message.role,
      content: createMultimodalMessageContent(message)
    })),
    temperature: NVIDIA_CONFIG.temperature,
    top_p: NVIDIA_CONFIG.topP,
    max_tokens: NVIDIA_CONFIG.maxTokens,
    stream: true
  };
}

function renderAttachmentBox() {
  if (!attachmentBox) {
    return;
  }

  attachmentBox.innerHTML = "";

  if (!pendingAttachments.length) {
    attachmentBox.classList.remove("visible");
    attachmentBox.style.display = "none";
    return;
  }

  const visibleAttachments = pendingAttachments.slice(0, 5);
  attachmentBox.classList.add("visible");
  attachmentBox.style.display = "flex";

  visibleAttachments.forEach((attachment, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";

    if (attachment.kind === "image") {
      item.classList.add("attachment-image-item");
      item.innerHTML = `
        <img class="attachment-thumb" src="${attachment.data}" alt="${escapeHTML(attachment.name)}" />
      `;
    } else {
      item.classList.add("attachment-file-item");
      item.innerHTML = `
        <div class="attachment-file-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
            <path d="M14 2v6h6" />
            <path d="M9 13h6" />
            <path d="M9 17h6" />
          </svg>
        </div>
        <div class="attachment-meta">
          <span class="attachment-name">${escapeHTML(attachment.name)}</span>
        </div>
      `;
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attachment-remove";
    removeBtn.title = "Remove attachment";
    removeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    `;
    removeBtn.onclick = () => {
      pendingAttachments.splice(index, 1);
      renderAttachmentBox();
    };

    item.appendChild(removeBtn);
    attachmentBox.appendChild(item);
  });
}

function removeAttachment(index) {
  pendingAttachments.splice(index, 1);
  renderAttachmentBox();
}

function addPendingAttachment(file) {
  if (pendingAttachments.length >= 5) {
    showToast("You can attach up to 5 files at a time.");
    return;
  }

  const isImage = file.type.startsWith("image/");

  readFileAsDataUrl(file)
    .then(data => {
      pendingAttachments.push({
        id: createChatId(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size || 0,
        kind: isImage ? "image" : "file",
        data
      });

      renderAttachmentBox();
    })
    .catch(() => {
      showToast("Unable to attach this file");
    });
}

function stopGeneration() {
  if (!isGenerating) {
    return;
  }

  if (activeRequestController) {
    activeRequestController.abort();
  }

  if (activeResponseBubble) {
    const currentText = String(activeResponseBubble.dataset.rawText || activeResponseBubble.textContent || "").trim();

    if (currentText) {
      activeResponseBubble.dataset.rawText = currentText;
      activeResponseBubble.innerHTML = renderMarkdownContent(currentText);
    } else {
      activeResponseBubble.dataset.rawText = "Response stopped.";
      activeResponseBubble.innerHTML = renderMarkdownContent("Response stopped.");
    }
  }

  isGenerating = false;
  activeRequestController = null;
  activeTypingMessage = null;
  activeResponseBubble = null;
  updateSendButtonState();
}

async function sendMessage() {
  const messageText = input.value.trim();
  const attachmentsToSend = pendingAttachments.map(attachment => ({
    id: attachment.id,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
    data: attachment.data
  }));

  if (!messageText && !attachmentsToSend.length) {
    return;
  }

  if (isGenerating) {
    return;
  }

  isGenerating = true;
  activeRequestController = new AbortController();
  updateSendButtonState();

  addMessage(messageText, "user", attachmentsToSend);

  conversationMessages.push({
    role: "user",
    content: messageText,
    attachments: attachmentsToSend,
    createdAt: new Date().toISOString()
  });

  pendingAttachments = [];
  renderAttachmentBox();
  input.value = "";
  input.style.height = "auto";

  if (!currentChatId) {
    const titleSource = messageText || (attachmentsToSend[0]?.name || "New chat");
    currentChatTitle =
      titleSource.slice(0, 32) +
      (titleSource.length > 32 ? "…" : "");
  }

  persistCurrentChatState();

  const typingMessage = addMessage("", "ai");

  const bubble = typingMessage.querySelector(".bubble");
  activeTypingMessage = typingMessage;
  activeResponseBubble = bubble;

  bubble.innerHTML = `
    <span class="typing">
      <i></i>
      <i></i>
      <i></i>
    </span>
  `;

  chatScroll.scrollTop = chatScroll.scrollHeight;

  let assistantText = "";
  let reasoningText = "";
  let hasStartedStreamingResponse = false;

  try {
    /*
     * IMPORTANT:
     * The browser now talks only to our Express backend.
     *
     * API key is NOT present here.
     */

    const response = await fetch(
      "/api/chat",
      {
        method: "POST",
        signal: activeRequestController?.signal,

        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },

        body: JSON.stringify(
          createNvidiaRequestBody()
        )
      }
    );

    if (!response.ok) {
      let errorMessage =
        `NVIDIA API Error: ${response.status}`;

      try {
        const errorData = await response.json();

        if (errorData?.error?.message) {
          errorMessage =
            errorData.error.message;
        } else if (errorData?.message) {
          errorMessage =
            errorData.message;
        }
      } catch (error) {
        try {
          const text = await response.text();

          if (text) {
            errorMessage = text;
          }
        } catch (_) {}
      }

      throw new Error(errorMessage);
    }

    if (!response.body) {
      throw new Error(
        "Streaming is not supported by this browser."
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder("utf-8");

    let buffer = "";

    while (true) {
      const { value, done } =
        await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(
        value,
        {
          stream: true
        }
      );

      const lines =
        buffer.split("\n");

      buffer =
        lines.pop() || "";

      for (const rawLine of lines) {
        const line =
          rawLine.trim();

        if (
          !line ||
          !line.startsWith("data:")
        ) {
          continue;
        }

        const data =
          line.slice(5).trim();

        if (data === "[DONE]") {
          continue;
        }

        let chunk;

        try {
          chunk =
            JSON.parse(data);
        } catch (error) {
          continue;
        }

        const choice =
          chunk?.choices?.[0];

        if (!choice) {
          continue;
        }

        const delta =
          choice.delta;

        if (!delta) {
          continue;
        }

        if (
          typeof delta.reasoning_content ===
          "string"
        ) {
          reasoningText +=
            delta.reasoning_content;
        }

        if (
          typeof delta.content ===
            "string" &&
          delta.content.length > 0
        ) {
          if (!hasStartedStreamingResponse) {
            hasStartedStreamingResponse = true;
            bubble.innerHTML = "";

            const actions = typingMessage.querySelector(".ai-message-actions");
            if (actions) actions.classList.remove("hidden");
          }

          assistantText +=
            delta.content;

          bubble.dataset.rawText =
            assistantText;
          bubble.innerHTML =
            renderMarkdownContent(assistantText);

          chatScroll.scrollTop =
            chatScroll.scrollHeight;
        }
      }
    }

    if (buffer.trim()) {
      const remaining =
        buffer.trim();

      if (
        remaining.startsWith("data:")
      ) {
        const data =
          remaining.slice(5).trim();

        if (
          data &&
          data !== "[DONE]"
        ) {
          try {
            const chunk =
              JSON.parse(data);

            const delta =
              chunk?.choices?.[0]?.delta;

            if (
              typeof delta?.content ===
                "string" &&
              delta.content.length > 0
            ) {
              if (!hasStartedStreamingResponse) {
                hasStartedStreamingResponse = true;
              }

              assistantText +=
                delta.content;

              bubble.dataset.rawText =
                assistantText;
              bubble.innerHTML =
                renderMarkdownContent(assistantText);
            }

            if (
              typeof delta?.reasoning_content ===
              "string"
            ) {
              reasoningText +=
                delta.reasoning_content;
            }
          } catch (error) {}
        }
      }
    }

    if (!assistantText.trim()) {
      assistantText =
        "I couldn't generate a response. Please try again.";

      bubble.dataset.rawText =
        assistantText;
      bubble.innerHTML =
        renderMarkdownContent(assistantText);
    }

    conversationMessages.push({
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString()
    });

    persistCurrentChatState();

    setupAIMessageActions(
      typingMessage
    );

    chatScroll.scrollTop =
      chatScroll.scrollHeight;

  } catch (error) {
    if (error?.name === "AbortError" || activeRequestController?.signal.aborted) {
      const stoppedText = String(bubble.dataset.rawText || assistantText || "").trim();

      bubble.dataset.rawText = stoppedText || "Response stopped.";
      bubble.innerHTML = renderMarkdownContent(stoppedText || "Response stopped.");

      if (conversationMessages.length && conversationMessages[conversationMessages.length - 1]?.role === "assistant") {
        conversationMessages.pop();
      }

      persistCurrentChatState();
      setupAIMessageActions(typingMessage);
      return;
    }

    console.error(
      "NexaAI API Error:",
      error
    );

    const errorMessage =
      getReadableAPIError(error);

    bubble.dataset.rawText =
      errorMessage;
    bubble.innerHTML =
      renderMarkdownContent(errorMessage);

    /*
     * Remove the latest user message
     * after a failed request.
     */

    if (
      conversationMessages.length &&
      conversationMessages[
        conversationMessages.length - 1
      ].role === "user"
    ) {
      conversationMessages.pop();
    }

    persistCurrentChatState();

    setupAIMessageActions(
      typingMessage
    );

  } finally {
    isGenerating = false;
    activeRequestController = null;
    activeTypingMessage = null;
    activeResponseBubble = null;
    updateSendButtonState();
  }
}

function getReadableAPIError(error) {
  const message =
    error?.message || "";

  if (
    message.includes("401") ||
    message.toLowerCase().includes("unauthorized")
  ) {
    return (
      "NexaAI couldn't authenticate with NVIDIA. " +
      "Please check your NVIDIA API key."
    );
  }

  if (
    message.includes("403") ||
    message.toLowerCase().includes("forbidden")
  ) {
    return (
      "NVIDIA rejected this request. " +
      "Please check your API key permissions."
    );
  }

  if (
    message.includes("429") ||
    message.toLowerCase().includes("rate")
  ) {
    return (
      "NVIDIA API rate limit reached. " +
      "Please wait a moment and try again."
    );
  }

  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503")
  ) {
    return (
      "NVIDIA's service is temporarily unavailable. " +
      "Please try again shortly."
    );
  }

  if (
    message.toLowerCase().includes("failed to fetch")
  ) {
    return (
      "Could not connect to NexaAI backend. " +
      "Make sure the Node.js server is running."
    );
  }

  return (
    `Sorry, something went wrong: ${
      message || "Unknown error"
    }`
  );
}

function startNewChat() {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }

  if (
    recognition &&
    isListening
  ) {
    try {
      recognition.stop();
    } catch (error) {}
  }

  currentChatId = null;
  currentChatTitle = null;
  conversationMessages = [];
  pendingAttachments = [];

  isGenerating = false;
  activeRequestController = null;
  activeTypingMessage = null;
  activeResponseBubble = null;

  renderConversation();
  renderAttachmentBox();

  input.value = "";
  input.style.height = "auto";

  updateSendButtonState();

  closeAllMenus();

  showToast("New chat started");
}

$("attachBtn").onclick = () => {
  fileInput.click();
};

fileInput.onchange = event => {
  const selectedFiles = Array.from(event.target.files || []);

  if (!selectedFiles.length) {
    return;
  }

  const remainingSlots = Math.max(0, 5 - pendingAttachments.length);

  if (remainingSlots === 0) {
    showToast("You can attach up to 5 files at a time.");
    fileInput.value = "";
    return;
  }

  const filesToAttach = selectedFiles.slice(0, remainingSlots);

  if (selectedFiles.length > filesToAttach.length) {
    showToast("You can attach up to 5 files at a time.");
  }

  filesToAttach.forEach(file => addPendingAttachment(file));
  fileInput.value = "";
};

$("settingsBtn").onclick = () => {
  showToast(
    "Settings — theme, model & memory preferences"
  );
};

$("optionsBtn").onclick = () => {
  showToast(
    "Options — temperature, format & language"
  );
};

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

let recognition = null;
let isListening = false;
let speechBaseText = "";

if (SpeechRecognition) {
  recognition =
    new SpeechRecognition();

  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListening = true;

    speechBaseText =
      input.value.trim();

    $("micBtn").classList.add(
      "speaking"
    );

    $("micBtn").title =
      "Stop voice input";
  };

  recognition.onresult = event => {
    let transcript = "";

    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {
      transcript +=
        event.results[i][0].transcript;
    }

    const separator =
      speechBaseText &&
      transcript
        ? " "
        : "";

    input.value =
      speechBaseText +
      separator +
      transcript;

    input.dispatchEvent(
      new Event("input")
    );
  };

  recognition.onend = () => {
    isListening = false;

    $("micBtn").classList.remove(
      "speaking"
    );

    $("micBtn").title =
      "Voice input";
  };

  recognition.onerror = event => {
    isListening = false;

    $("micBtn").classList.remove(
      "speaking"
    );

    $("micBtn").title =
      "Voice input";

    if (event.error === "not-allowed") {
      showToast(
        "Microphone permission was denied"
      );
    } else if (event.error !== "aborted") {
      showToast("Voice input error");
    }
  };
}

$("micBtn").onclick = () => {
  if (!recognition) {
    showToast(
      "Speech-to-text is not supported in this browser"
    );

    return;
  }

  if (isListening) {
    recognition.stop();
    return;
  }

  speechBaseText =
    input.value.trim();

  try {
    recognition.start();
  } catch (error) {
    console.warn(
      "Speech recognition:",
      error
    );
  }
};


function showToast(message) {
  const toast = $("toast");

  toast.textContent =
    message;

  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer =
    setTimeout(
      () => {
        toast.classList.remove("show");
      },
      2200
    );
}

updateSendButtonState();

window.addEventListener(
  "beforeunload",
  () => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
  }
);
