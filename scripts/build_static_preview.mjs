import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data = JSON.parse(fs.readFileSync(path.join(root, "data", "kb.json"), "utf-8"));
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf-8");

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>飞跑知识库静态预览</title>
    <style>${styles}</style>
  </head>
  <body>
    <main class="app-shell">
      <section class="login-view" id="loginView">
        <div class="brand-mark">飞</div>
        <h1>飞跑知识库</h1>
        <p>内部客服查询工具</p>
        <form id="loginForm" class="login-form">
          <input id="passwordInput" type="password" autocomplete="current-password" placeholder="输入访问密码">
          <button type="submit">进入查询</button>
        </form>
        <p class="error-text" id="loginError" role="alert"></p>
      </section>

      <section class="search-view" id="searchView" hidden>
        <header class="topbar">
          <div>
            <strong>飞跑知识库</strong>
            <span>静态预览，不连接云端</span>
          </div>
          <button class="ghost-button" id="logoutButton" type="button">退出</button>
        </header>
        <div class="search-panel">
          <label class="search-box">
            <span>搜索</span>
            <input id="searchInput" type="search" placeholder="输入问题关键词，如 下载、成绩、照片">
          </label>
          <div class="category-row" id="categoryRow"></div>
        </div>
        <div class="result-meta" id="resultMeta">输入关键词开始查询</div>
        <div class="results" id="results"></div>
        <div class="empty-state" id="emptyState" hidden>没有匹配结果，换个关键词试试。</div>
      </section>
    </main>
    <div class="toast" id="toast" hidden>已复制</div>
    <script>
      const KB_DATA = ${JSON.stringify(data)};
      const PASSWORD = "feipao-demo";
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
      let timer;

      function normalize(value) {
        return String(value || "").toLowerCase().replace(/\\s+/g, " ").trim();
      }

      function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "\\"": "&quot;",
          "'": "&#39;"
        }[char]));
      }

      function scoreRecord(record, terms) {
        const fields = [[record.question, 8], [record.answer, 5], [record.type, 3], [record.followUp, 2], [record.note, 1]];
        let score = 0;
        for (const term of terms) {
          for (const [value, weight] of fields) {
            const text = normalize(value);
            if (text === term) score += weight * 4;
            else if (text.includes(term)) score += weight;
          }
        }
        return score;
      }

      function searchKnowledgeBase() {
        const terms = normalize(searchInput.value).split(/[ ,，。；;、]+/).filter(Boolean);
        const selected = currentCategory === "全部" ? "" : currentCategory;
        return KB_DATA.records
          .map((record) => {
            if (selected && record.type !== selected) return null;
            const score = terms.length ? scoreRecord(record, terms) : 1;
            return score > 0 ? { ...record, score } : null;
          })
          .filter(Boolean)
          .sort((left, right) => right.score - left.score || left.question.localeCompare(right.question, "zh-Hans-CN"))
          .slice(0, 30);
      }

      function renderCategories() {
        categories = ["全部", ...KB_DATA.categories.filter((item) => item !== "全部")];
        categoryRow.innerHTML = categories.map((category) => (
          '<button class="category-chip ' + (category === currentCategory ? "active" : "") + '" type="button" data-category="' + escapeHtml(category) + '">' + escapeHtml(category) + '</button>'
        )).join("");
      }

      function renderResults(items) {
        results.innerHTML = items.map((item) => (
          '<article class="result-card">' +
          '<div class="card-head"><span class="type-label">' + escapeHtml(item.type) + '</span><button class="copy-button" type="button" data-copy="' + escapeHtml(item.answer) + '">复制答复</button></div>' +
          '<h2 class="question">' + escapeHtml(item.question) + '</h2>' +
          '<p class="answer">' + escapeHtml(item.answer) + '</p>' +
          (item.followUp ? '<p class="follow-up">后续处理：' + escapeHtml(item.followUp) + '</p>' : "") +
          (item.note ? '<p class="note">备注：' + escapeHtml(item.note) + '</p>' : "") +
          '</article>'
        )).join("");
        emptyState.hidden = items.length > 0;
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

      function runSearch() {
        const items = searchKnowledgeBase();
        renderCategories();
        renderResults(items);
        resultMeta.textContent = searchInput.value.trim() || currentCategory !== "全部" ? "找到 " + items.length + " 条结果" : "显示全部标准问答";
      }

      loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (passwordInput.value !== PASSWORD) {
          loginError.textContent = "密码不正确";
          return;
        }
        loginView.hidden = true;
        searchView.hidden = false;
        runSearch();
      });

      logoutButton.addEventListener("click", () => {
        searchView.hidden = true;
        loginView.hidden = false;
        passwordInput.value = "";
      });

      searchInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(runSearch, 120);
      });

      categoryRow.addEventListener("click", (event) => {
        const button = event.target.closest("[data-category]");
        if (!button) return;
        currentCategory = button.dataset.category;
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
          setTimeout(() => { toast.hidden = true; }, 1400);
        }
      });
    </script>
  </body>
</html>
`;

fs.writeFileSync(path.join(root, "preview-static.html"), html, "utf-8");
console.log(path.join(root, "preview-static.html"));
