import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 8799;
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    AUTH_PASSWORD: "test-password",
    SESSION_SECRET: "test-secret-for-api-verification"
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

  const blocked = await fetch(`http://127.0.0.1:${port}/api/search?q=成绩`);
  assert.equal(blocked.status, 401);

  const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test-password" })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /fp_session=/);

  const search = await fetch(`http://127.0.0.1:${port}/api/search?q=成绩`, {
    headers: { cookie }
  });
  assert.equal(search.status, 200);
  const payload = await search.json();
  assert.ok(payload.total > 0);
  assert.ok(payload.results[0].question.includes("成绩") || payload.results[0].answer.includes("成绩"));

  console.log("api tests passed");
} finally {
  child.kill();
}
