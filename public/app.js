const loginView = document.querySelector("#loginView");
const searchView = document.querySelector("#searchView");
const loginForm = document.querySelector("#loginForm");
const passwordInput = document.querySelector("#passwordInput");
const loginError = document.querySelector("#loginError");
const logoutButton = document.querySelector("#logoutButton");
const searchInput = document.querySelector("#searchInput");
const categoryRow = document.querySelector("#categoryRow");
const resultMeta = document.querySelector("#resultMeta");
const results = document.querySelector("#results");
const emptyState = document.querySelector("#emptyState");
const toast = document.querySelector("#toast");
const modeTabs = document.querySelectorAll("[data-mode]");
const knowledgeMode = document.querySelector("#knowledgeMode");
const complaintMode = document.querySelector("#complaintMode");
const complaintLock = document.querySelector("#complaintLock");
const complaintForm = document.querySelector("#complaintForm");
const complaintLoginForm = document.querySelector("#complaintLoginForm");
const complaintPasswordInput = document.querySelector("#complaintPasswordInput");
const complaintLoginError = document.querySelector("#complaintLoginError");
const complaintType = document.querySelector("#complaintType");
const draftButton = document.querySelector("#draftButton");
const draftPanel = document.querySelector("#draftPanel");
const complaintStatus = document.querySelector("#complaintStatus");

let currentCategory = "全部";
let categories = ["全部"];
let searchTimer;
let currentDraft = null;

function showAuthed(authed) {
  loginView.hidden = authed;
  searchView.hidden = !authed;
  if (authed) {
    searchInput.focus();
    runSearch();
  } else {
    passwordInput.focus();
  }
}

function showComplaintAuthed(authed) {
  complaintLock.hidden = authed;
  complaintForm.hidden = !authed;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok) {
    const detail = body.detail ? `：${body.detail}` : "";
    throw new Error(`${body.error || "请求失败"}${detail}`);
  }
  return body;
}

function renderCategories(nextCategories) {
  categories = ["全部", ...nextCategories.filter((item) => item !== "全部")];
  categoryRow.innerHTML = categories.map((category) => (
    `<button class="category-chip ${category === currentCategory ? "active" : ""}" type="button" data-category="${category}">${category}</button>`
  )).join("");
}

function setMode(mode) {
  modeTabs.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  knowledgeMode.hidden = mode !== "knowledge";
  complaintMode.hidden = mode !== "complaints";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function renderResults(items) {
  results.innerHTML = items.map((item) => `
    <article class="result-card">
      <div class="card-head">
        <span class="type-label">${escapeHtml(item.type)}</span>
        <button class="copy-button" type="button" data-copy="${escapeHtml(item.answer)}">复制答复</button>
      </div>
      <h2 class="question">${escapeHtml(item.question)}</h2>
      <p class="answer">${escapeHtml(item.answer)}</p>
      ${item.followUp ? `<p class="follow-up">后续处理：${escapeHtml(item.followUp)}</p>` : ""}
      ${item.note ? `<p class="note">备注：${escapeHtml(item.note)}</p>` : ""}
    </article>
  `).join("");
  emptyState.hidden = items.length > 0;
}

function collectComplaintForm() {
  return {
    type: complaintType.value,
    description: document.querySelector("#complaintDescription").value,
    attachmentNote: document.querySelector("#complaintAttachment").value,
    bibNumber: document.querySelector("#complaintBib").value,
    orderNo: document.querySelector("#complaintOrder").value,
    owner: document.querySelector("#complaintOwner").value,
    progress: document.querySelector("#complaintProgress").value,
    note: document.querySelector("#complaintNote").value
  };
}

function renderDraft(draft) {
  currentDraft = draft;
  draftPanel.hidden = false;
  draftPanel.innerHTML = `
    <h3>AI整理建议</h3>
    <p><strong>建议类型：</strong>${escapeHtml(draft.suggestedType || "")}</p>
    <p><strong>摘要：</strong>${escapeHtml(draft.summary || "")}</p>
    <p><strong>处理建议：</strong>${escapeHtml(draft.handlingSuggestion || "")}</p>
    ${(draft.sensitiveHints || []).length ? `<p><strong>敏感提示：</strong>${escapeHtml(draft.sensitiveHints.join("；"))}</p>` : ""}
  `;
  if (draft.suggestedType) complaintType.value = draft.suggestedType;
}

async function loadComplaintMeta() {
  const meta = await api("/api/complaints/meta");
  complaintType.innerHTML = (meta.types || ["其他"]).map((type) => (
    `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`
  )).join("");
  showComplaintAuthed(Boolean(meta.authed));
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("复制失败，请长按答复文本手动复制");
}

async function runSearch() {
  const q = searchInput.value.trim();
  const params = new URLSearchParams({ q, category: currentCategory });
  try {
    const data = await api(`/api/search?${params}`);
    renderCategories(data.categories || []);
    renderResults(data.results || []);
    resultMeta.textContent = q || currentCategory !== "全部"
      ? `找到 ${data.total} 条结果`
      : "显示全部标准问答";
  } catch (error) {
    if (error.message.includes("请先")) showAuthed(false);
    else resultMeta.textContent = error.message;
  }
}

function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 180);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: passwordInput.value })
    });
    passwordInput.value = "";
    showAuthed(true);
  } catch (error) {
    loginError.textContent = error.message;
  }
});

modeTabs.forEach((button) => {
  button.addEventListener("click", () => {
    setMode(button.dataset.mode);
    if (button.dataset.mode === "complaints") loadComplaintMeta().catch((error) => {
      complaintStatus.textContent = error.message;
    });
  });
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showAuthed(false);
});

complaintLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  complaintLoginError.textContent = "";
  try {
    await api("/api/complaints/login", {
      method: "POST",
      body: JSON.stringify({ password: complaintPasswordInput.value })
    });
    complaintPasswordInput.value = "";
    showComplaintAuthed(true);
  } catch (error) {
    complaintLoginError.textContent = error.message;
  }
});

draftButton.addEventListener("click", async () => {
  complaintStatus.textContent = "正在整理...";
  try {
    const data = await api("/api/complaints/draft", {
      method: "POST",
      body: JSON.stringify(collectComplaintForm())
    });
    renderDraft(data.draft);
    complaintStatus.textContent = "已生成整理建议，请确认后提交。";
  } catch (error) {
    complaintStatus.textContent = error.message;
  }
});

complaintForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  complaintStatus.textContent = "正在提交...";
  try {
    const data = await api("/api/complaints", {
      method: "POST",
      body: JSON.stringify({ record: collectComplaintForm(), draft: currentDraft })
    });
    complaintStatus.textContent = data.writerResult?.writer === "mock"
      ? "已进入本地审计队列；当前为 mock 写入模式。"
      : "已提交到飞书。";
    complaintForm.reset();
    draftPanel.hidden = true;
    currentDraft = null;
  } catch (error) {
    complaintStatus.textContent = error.message;
  }
});

searchInput.addEventListener("input", debounceSearch);

categoryRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  currentCategory = button.dataset.category;
  renderCategories(categories);
  runSearch();
});

results.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  try {
    await copyText(button.dataset.copy);
    toast.textContent = "已复制";
  } catch (error) {
    toast.textContent = error.message;
  } finally {
    toast.hidden = false;
    setTimeout(() => {
      toast.hidden = true;
    }, 1400);
  }
});

api("/api/me")
  .then((data) => {
    showAuthed(data.authed);
    showComplaintAuthed(Boolean(data.complaintAuthed));
  })
  .catch(() => showAuthed(false));
