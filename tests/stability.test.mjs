import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const port = 8802;
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "feipao-stability-"));
const auditPath = path.join(tmpDir, "complaints.jsonl");
const hangingCli = path.join(tmpDir, process.platform === "win32" ? "hang-cli.cmd" : "hang-cli.sh");

if (process.platform === "win32") {
  await fs.writeFile(hangingCli, "@echo off\r\nping -n 30 127.0.0.1 > nul\r\n", "utf-8");
} else {
  await fs.writeFile(hangingCli, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
}

const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    AUTH_PASSWORD: "test-password",
    COMPLAINT_PASSWORD: "complaint-password",
    SESSION_SECRET: "test-secret-for-stability-verification",
    COMPLAINT_DATA_PATH: auditPath,
    FEISHU_WRITER: "cli",
    FEISHU_CLI_PATH: hangingCli,
    FEISHU_TABLE_URL: "https://example.feishu.cn/sheets/token?sheet=abc",
    FEISHU_SHEET_RANGE: "abc!A:I",
    FEISHU_CLI_TIMEOUT_MS: "300",
    REQUEST_BODY_LIMIT_BYTES: "200"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

async function waitForServer() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("server did not become ready");
}

try {
  await waitForServer();

  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  const healthPayload = await health.json();
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.kb.readable, true);
  assert.ok(healthPayload.uptimeSeconds >= 0);

  const oversized = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "x".repeat(1000) })
  });
  assert.equal(oversized.status, 413);

  const mainLogin = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test-password" })
  });
  assert.equal(mainLogin.status, 200);
  const mainCookie = mainLogin.headers.get("set-cookie");

  const complaintLogin = await fetch(`http://127.0.0.1:${port}/api/complaints/login`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: mainCookie },
    body: JSON.stringify({ password: "complaint-password" })
  });
  assert.equal(complaintLogin.status, 200);
  const cookie = `${mainCookie}; ${complaintLogin.headers.get("set-cookie")}`;

  const submit = await fetch(`http://127.0.0.1:${port}/api/complaints`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ description: "CLI 超时稳定性测试" })
  });
  assert.equal(submit.status, 502);
  const failedPayload = await submit.json();
  assert.match(failedPayload.error, /飞书同步失败/);

  const stillHealthy = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(stillHealthy.status, 200);

  console.log("stability tests passed");
} finally {
  child.kill();
}
