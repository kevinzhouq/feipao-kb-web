import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchKnowledgeBase } from "./search.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataPath = path.resolve(__dirname, process.env.KB_DATA_PATH || "./data/kb.json");
const password = process.env.AUTH_PASSWORD || "feipao-demo";
const sessionSecret = process.env.SESSION_SECRET || "dev-secret-change-me";
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const maxAge = 60 * 60 * 24 * 7;

let kbCache;

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function makeSession() {
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const value = `feipao:${expires}`;
  return `${value}.${sign(value)}`;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((part) => part.trim().split("=")).filter((parts) => parts.length === 2)
  );
}

function isAuthed(request) {
  const token = parseCookies(request.headers.cookie).fp_session;
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;
  const value = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const expires = Number(value.split(":").at(-1));
  return expires > Math.floor(Date.now() / 1000) && signature === sign(value);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function loadKb() {
  if (!kbCache) {
    const raw = await fs.readFile(dataPath, "utf-8");
    kbCache = JSON.parse(raw);
  }
  return kbCache;
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

async function sendStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(publicDir, `.${safePath}`);
  if (!target.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(target);
    const ext = path.extname(target);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    response.writeHead(200, { "content-type": type });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = JSON.parse(await readBody(request) || "{}");
    if (body.password !== password) {
      sendJson(response, 401, { error: "密码不正确" });
      return;
    }
    sendJson(response, 200, { ok: true }, {
      "set-cookie": `fp_session=${makeSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    sendJson(response, 200, { ok: true }, {
      "set-cookie": "fp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    });
    return;
  }

  if (url.pathname === "/api/me") {
    sendJson(response, 200, { authed: isAuthed(request) });
    return;
  }

  if (!isAuthed(request)) {
    sendJson(response, 401, { error: "请先输入访问密码" });
    return;
  }

  if (url.pathname === "/api/search") {
    const payload = await loadKb();
    const results = searchKnowledgeBase(payload, {
      query: url.searchParams.get("q") || "",
      category: url.searchParams.get("category") || "全部"
    });
    sendJson(response, 200, {
      query: url.searchParams.get("q") || "",
      categories: payload.categories || [],
      total: results.length,
      results
    });
    return;
  }

  sendJson(response, 404, { error: "接口不存在" });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await sendStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "服务异常" });
  }
});

server.listen(port, host, () => {
  console.log(`Feipao knowledge base running at http://${host}:${port}`);
});
