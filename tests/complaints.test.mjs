import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  buildFeishuAppendArgs,
  buildLocalDraft,
  normalizeComplaint,
  validateComplaint
} from "../complaints.mjs";

const normalized = normalizeComplaint({
  description: "C33578 13704499190 输错号码了，申请补发一张券",
  bibNumber: "c33578"
});
assert.equal(normalized.bibNumber, "C33578");
assert.deepEqual(validateComplaint(normalized), {});
assert.equal(validateComplaint(normalizeComplaint({})).description, "请填写问题描述");
assert.match(buildLocalDraft(normalized).sensitiveHints.join(","), /手机号/);
const feishuArgs = buildFeishuAppendArgs(normalized, {
  FEISHU_TABLE_URL: "https://fqj52sgnffz.feishu.cn/sheets/XsNjsml2ahOWS7t0IuwcjKuSndf?sheet=TLSUzz",
  FEISHU_SHEET_RANGE: "TLSUzz!A:I",
  FEISHU_CLI_AS: "bot"
});
assert.deepEqual(feishuArgs.slice(0, 6), [
  "sheets",
  "+append",
  "--url",
  "https://fqj52sgnffz.feishu.cn/sheets/XsNjsml2ahOWS7t0IuwcjKuSndf?sheet=TLSUzz",
  "--range",
  "TLSUzz!A:I"
]);

const port = 8801;
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "feipao-complaints-"));
const auditPath = path.join(tmpDir, "complaints.jsonl");
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    AUTH_PASSWORD: "test-password",
    COMPLAINT_PASSWORD: "complaint-password",
    SESSION_SECRET: "test-secret-for-complaint-verification",
    COMPLAINT_DATA_PATH: auditPath,
    FEISHU_WRITER: "mock"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

async function waitForServer() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/me`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("server did not become ready");
}

try {
  await waitForServer();

  const blocked = await fetch(`http://127.0.0.1:${port}/api/complaints/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(normalized)
  });
  assert.equal(blocked.status, 401);

  const mainLogin = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test-password" })
  });
  assert.equal(mainLogin.status, 200);
  const mainCookie = mainLogin.headers.get("set-cookie");

  const login = await fetch(`http://127.0.0.1:${port}/api/complaints/login`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: mainCookie },
    body: JSON.stringify({ password: "complaint-password" })
  });
  assert.equal(login.status, 200);
  const cookie = `${mainCookie}; ${login.headers.get("set-cookie")}`;

  const draft = await fetch(`http://127.0.0.1:${port}/api/complaints/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(normalized)
  });
  assert.equal(draft.status, 200);
  const draftPayload = await draft.json();
  assert.equal(draftPayload.draft.provider, "local");

  const submit = await fetch(`http://127.0.0.1:${port}/api/complaints`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ record: normalized, draft: draftPayload.draft })
  });
  assert.equal(submit.status, 200);
  const submitPayload = await submit.json();
  assert.equal(submitPayload.writerResult.writer, "mock");

  const audit = await fs.readFile(auditPath, "utf-8");
  assert.match(audit, /received/);
  assert.match(audit, /writer_result/);

  console.log("complaints tests passed");
} finally {
  child.kill();
}
