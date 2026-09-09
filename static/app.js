const NVIDIA_CONFIG = {
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  temperature: 1,
  topP: 0.95,
  maxTokens: 16384,
  reasoningBudget: 16384,
  enableThinking: true
};

let historyItems = [
  {
    id: 1,
    text: "Landing page for coffee shop",
    pinned: false
  },
  {
    id: 2,
    text: "React hooks explained simply",
    pinned: true
  },
  {
    id: 3,
    text: "Marketing email for SaaS launch",
    pinned: false
  },
  {
    id: 4,
    text: "SQL query optimization tips",
    pinned: false
  },
  {
    id: 5,
    text: "Midnight in Tokyo — poem",
    pinned: false
  },
  {
    id: 6,
    text: "Startup pitch deck outline",
    pinned: false
  }
];

let activeMenuId = null;
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

function renderHistory() {
  const historyList = $("historyList");

  historyList.innerHTML = "";

  const sortedHistory = [...historyItems].sort((a, b) => {
    return Number(b.pinned) - Number(a.pinned);
  });

  sortedHistory.forEach(item => {
    const historyItem = document.createElement("div");

    historyItem.className = "hist-item";

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
        ${escapeHTML(item.text)}
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
      showToast(`Opened: ${item.text}`);
      closeAllMenus();
    };

    historyList.appendChild(historyItem);
  });
}

renderHistory();

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
          history.text
        );

        if (newName && newName.trim()) {
          history.text = newName.trim();
          renderHistory();
          showToast("Chat renamed");
        }
      }

      if (action === "pin") {
        item.pinned = !item.pinned;
        renderHistory();

        showToast(
          item.pinned
            ? "Pinned to top"
            : "Unpinned"
        );
      }

      if (action === "delete") {
        historyItems = historyItems.filter(
          historyItem => historyItem.id !== item.id
        );

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

document.querySelectorAll(".card").forEach(card => {
  card.onclick = () => {
    input.value = card.dataset.card;

    input.dispatchEvent(
      new Event("input")
    );

    input.focus();
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
    stream: true,

    extra_body: {
      chat_template_kwargs: {
        enable_thinking: NVIDIA_CONFIG.enableThinking
      },

      reasoning_budget: NVIDIA_CONFIG.reasoningBudget
    }
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
    content: messageText
  });

  input.value = "";
  input.style.height = "auto";

  if (!currentChatTitle) {
    currentChatTitle =
      messageText.slice(0, 32) +
      (messageText.length > 32 ? "…" : "");

    historyItems.unshift({
      id: Date.now(),
      text: currentChatTitle,
      pinned: false
    });

    renderHistory();
  }

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
      content: assistantText
    });

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

  conversationMessages = [];

  isGenerating = false;

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

  currentChatTitle = null;

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

$("exportBtn").onclick = () => {
  const messages = [
    ...document.querySelectorAll(".msg")
  ];

  if (!messages.length) {
    showToast("Nothing to export yet");
    return;
  }

  const conversationText =
    messages
      .map(message => {
        const sender =
          message.classList.contains("ai")
            ? "NexaAI"
            : "You";

        const bubble =
          message.querySelector(".bubble");

        const text =
          bubble
            ? bubble.textContent
            : "";

        return `${sender}: ${text}`;
      })
      .join("\n\n");

  const file =
    new Blob(
      [conversationText],
      {
        type: "text/plain"
      }
    );

  const downloadUrl =
    URL.createObjectURL(file);

  const downloadLink =
    document.createElement("a");

  downloadLink.href =
    downloadUrl;

  downloadLink.download =
    "nexaai-chat.txt";

  document.body.appendChild(
    downloadLink
  );

  downloadLink.click();

  downloadLink.remove();

  URL.revokeObjectURL(
    downloadUrl
  );

  showToast("Chat exported ✦");
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