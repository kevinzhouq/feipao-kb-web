import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendAuditLine,
  buildComplaintSubmission,
  complaintTypes,
  createComplaintDraft,
  normalizeComplaint,
  validateComplaint,
  writeComplaintToFeishu
} from "./complaints.mjs";
import { searchKnowledgeBase } from "./search.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataPath = path.resolve(__dirname, process.env.KB_DATA_PATH || "./data/kb.json");
const complaintDataPath = path.resolve(__dirname, process.env.COMPLAINT_DATA_PATH || "./data/complaints.jsonl");
const password = process.env.AUTH_PASSWORD || "feipao-demo";
const complaintPassword = process.env.COMPLAINT_PASSWORD || password;
const sessionSecret = process.env.SESSION_SECRET || "dev-secret-change-me";
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const maxAge = 60 * 60 * 24 * 7;
const requestBodyLimitBytes = Number(process.env.REQUEST_BODY_LIMIT_BYTES || 1024 * 1024);

let kbCache;

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function makeSession() {
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const value = `feipao:${expires}`;
  return `${value}.${sign(value)}`;
}

function makeComplaintSession() {
  const expires = Math.floor(Date.now() / 1000) + maxAge;
  const value = `complaint:${expires}`;
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

function isComplaintAuthed(request) {
  const token = parseCookies(request.headers.cookie).fp_complaint_session;
  if (!token) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;
  const value = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  const expires = Number(value.split(":").at(-1));
  return value.startsWith("complaint:")
    && expires > Math.floor(Date.now() / 1000)
    && signature === sign(value);
}

function withStatus(error, status) {
  error.status = status;
  return error;
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > requestBodyLimitBytes) {
      throw withStatus(new Error("请求内容过大"), 413);
    }
    chunks.push(chunk);
  }
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

async function appendComplaintAudit(response, entry) {
  try {
    await appendAuditLine(complaintDataPath, entry);
    return true;
  } catch (error) {
    sendJson(response, 500, {
      error: "本地审计日志写入失败，请检查 COMPLAINT_DATA_PATH",
      detail: error.message
    });
    return false;
  }
}

async function sendHealth(response) {
  try {
    const raw = await fs.readFile(dataPath, "utf-8");
    JSON.parse(raw);
    sendJson(response, 200, {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      kb: { readable: true, path: dataPath },
      env: {
        feishuWriter: process.env.FEISHU_WRITER || "mock",
        feishuCliConfigured: Boolean(process.env.FEISHU_CLI_PATH),
        deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
        complaintDataPathConfigured: Boolean(process.env.COMPLAINT_DATA_PATH)
      }
    });
  } catch (error) {
    sendJson(response, 503, {
      ok: false,
      uptimeSeconds: Math.round(process.uptime()),
      kb: { readable: false, path: dataPath },
      error: error.message
    });
  }
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
    sendJson(response, 200, { authed: isAuthed(request), complaintAuthed: isComplaintAuthed(request) });
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

  if (request.method === "POST" && url.pathname === "/api/complaints/login") {
    const body = JSON.parse(await readBody(request) || "{}");
    if (body.password !== complaintPassword) {
      sendJson(response, 401, { error: "客诉模块密码不正确" });
      return;
    }
    sendJson(response, 200, { ok: true }, {
      "set-cookie": `fp_complaint_session=${makeComplaintSession()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    });
    return;
  }

  if (url.pathname === "/api/complaints/meta") {
    sendJson(response, 200, { types: complaintTypes, authed: isComplaintAuthed(request) });
    return;
  }

  if (url.pathname.startsWith("/api/complaints") && !isComplaintAuthed(request)) {
    sendJson(response, 401, { error: "请先通过客诉模块验证" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/complaints/draft") {
    const record = normalizeComplaint(JSON.parse(await readBody(request) || "{}"));
    const errors = validateComplaint(record);
    if (Object.keys(errors).length) {
      sendJson(response, 400, { error: "表单校验失败", errors });
      return;
    }
    const draft = await createComplaintDraft(record);
    sendJson(response, 200, { draft });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/complaints") {
    const body = JSON.parse(await readBody(request) || "{}");
    const record = normalizeComplaint(body.record || body);
    const errors = validateComplaint(record);
    if (Object.keys(errors).length) {
      sendJson(response, 400, { error: "表单校验失败", errors });
      return;
    }

    const submission = buildComplaintSubmission(record, body.draft || null);
    if (!await appendComplaintAudit(response, { event: "received", ...submission })) return;
    try {
      const writerResult = await writeComplaintToFeishu(submission);
      if (!await appendComplaintAudit(response, {
        event: "writer_result",
        id: submission.id,
        createdAt: new Date().toISOString(),
        writerResult
      })) return;
      sendJson(response, 200, { ok: true, complaint: submission, writerResult });
    } catch (error) {
      if (!await appendComplaintAudit(response, {
        event: "writer_failed",
        id: submission.id,
        createdAt: new Date().toISOString(),
        error: error.message
      })) return;
      sendJson(response, 502, { error: "飞书同步失败，记录已进入本地审计队列", complaint: submission });
    }
    return;
  }

  sendJson(response, 404, { error: "接口不存在" });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/healthz") {
      await sendHealth(response);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await sendStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || "服务异常" });
  }
});

server.listen(port, host, () => {
  console.log(`Feipao knowledge base running at http://${host}:${port}`);
  console.log(JSON.stringify({
    nodeVersion: process.version,
    host,
    port,
    kbDataPath: dataPath,
    complaintDataPath,
    feishuWriter: process.env.FEISHU_WRITER || "mock",
    feishuCliConfigured: Boolean(process.env.FEISHU_CLI_PATH),
    deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY)
  }));
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});
