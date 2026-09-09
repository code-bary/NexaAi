const NVIDIA_CONFIG = {
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  temperature: 1,
  topP: 0.95,
  maxTokens: 16384,
  reasoningBudget: 16384,
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
let conversationMessages = [];

const $ = id => document.getElementById(id);

const sidebar = $("sidebar");
const overlay = $("overlay");
const input = $("chatInput");
const sendBtn = $("sendBtn");
const chatInner = $("chatInner");
const chatScroll = $("chatScroll");
const histMenu = $("histMenu");
const modelMenu = $("modelMenu");

$("collapseBtn").onclick = () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove("mobile-open");
    overlay.classList.remove("show");
  } else {
    sidebar.classList.toggle("collapsed");
  }
};

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
    const renderedMessage = addMessage(message.content, sender);

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

input.addEventListener("input", () => {
  input.style.height = "auto";

  input.style.height = `${Math.min(
    input.scrollHeight,
    150
  )}px`;

  sendBtn.disabled =
    !input.value.trim() ||
    isGenerating;
});

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

sendBtn.onclick = sendMessage;

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

function addMessage(text, sender) {
  removeEmptyState();

  const message = document.createElement("div");

  message.className = `msg ${sender}`;

  if (sender === "ai") {
    message.innerHTML = `
      <div class="avatar ai">
        N
      </div>

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
      <div class="avatar user">
        You
      </div>

      <div class="bubble"></div>
    `;
  }

  const bubble = message.querySelector(".bubble");

  bubble.textContent = text;

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

  copyBtn.onclick = async () => {
    const text = bubble.textContent.trim();

    if (!text) {
      showToast("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch (error) {
      const temp = document.createElement("textarea");

      temp.value = text;
      document.body.appendChild(temp);
      temp.select();

      document.execCommand("copy");

      temp.remove();

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

function createNvidiaRequestBody() {
  return {
    model: NVIDIA_CONFIG.model,
    messages: conversationMessages,
    temperature: NVIDIA_CONFIG.temperature,
    top_p: NVIDIA_CONFIG.topP,
    max_tokens: NVIDIA_CONFIG.maxTokens,
    stream: true
  };
}

async function sendMessage() {
  const messageText = input.value.trim();

  if (!messageText) {
    return;
  }

  if (isGenerating) {
    return;
  }

  isGenerating = true;
  sendBtn.disabled = true;

  addMessage(messageText, "user");

  conversationMessages.push({
    role: "user",
    content: messageText,
    createdAt: new Date().toISOString()
  });

  input.value = "";
  input.style.height = "auto";

  if (!currentChatId) {
    currentChatTitle =
      messageText.slice(0, 32) +
      (messageText.length > 32 ? "…" : "");
  }

  persistCurrentChatState();

  const typingMessage = addMessage("", "ai");

  const bubble = typingMessage.querySelector(".bubble");

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

    bubble.textContent = "";

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
          "string"
        ) {
          assistantText +=
            delta.content;

          bubble.textContent =
            assistantText;

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
              "string"
            ) {
              assistantText +=
                delta.content;

              bubble.textContent =
                assistantText;
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

      bubble.textContent =
        assistantText;
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
    console.error(
      "NexaAI API Error:",
      error
    );

    const errorMessage =
      getReadableAPIError(error);

    bubble.textContent =
      errorMessage;

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

    sendBtn.disabled =
      !input.value.trim();
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

  isGenerating = false;

  renderConversation();

  input.value = "";
  input.style.height = "auto";

  sendBtn.disabled = true;

  closeAllMenus();

  showToast("New chat started");
}

$("attachBtn").onclick = () => {
  $("fileInput").click();
};

$("fileInput").onchange = event => {
  const selectedFiles =
    event.target.files;

  if (selectedFiles.length) {
    showToast(
      `${selectedFiles.length} file(s) attached ✦`
    );
  }
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

function escapeHTML(value) {
  const div =
    document.createElement("div");

  div.textContent =
    value;

  return div.innerHTML;
}

sendBtn.disabled =
  !input.value.trim();

window.addEventListener(
  "beforeunload",
  () => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }
  }
);