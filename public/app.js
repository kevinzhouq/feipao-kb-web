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

let currentCategory = "全部";
let categories = ["全部"];
let searchTimer;

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

function renderCategories(nextCategories) {
  categories = ["全部", ...nextCategories.filter((item) => item !== "全部")];
  categoryRow.innerHTML = categories.map((category) => (
    `<button class="category-chip ${category === currentCategory ? "active" : ""}" type="button" data-category="${category}">${category}</button>`
  )).join("");
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

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showAuthed(false);
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
  await navigator.clipboard.writeText(button.dataset.copy);
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 1200);
});

api("/api/me")
  .then((data) => showAuthed(data.authed))
  .catch(() => showAuthed(false));
