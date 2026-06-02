import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const complaintTypes = [
  "照片问题",
  "视频问题",
  "优惠券/抽奖问题",
  "退款",
  "成绩/证书",
  "下载/保存问题",
  "其他"
];

const fieldLabels = {
  type: "类型",
  description: "问题描述",
  attachmentNote: "截图（如有）",
  bibNumber: "号牌信息",
  orderNo: "订单号（如需要退款）",
  owner: "处理对接人",
  progress: "处理进度",
  note: "备注"
};

function clean(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function normalizeComplaint(input = {}) {
  return {
    type: clean(input.type) || "其他",
    description: clean(input.description),
    attachmentNote: clean(input.attachmentNote),
    bibNumber: clean(input.bibNumber).toUpperCase(),
    orderNo: clean(input.orderNo),
    owner: clean(input.owner),
    progress: clean(input.progress) || "待处理",
    note: clean(input.note)
  };
}

export function validateComplaint(record) {
  const errors = {};
  if (!record.description) errors.description = "请填写问题描述";
  if (record.description.length > 1000) errors.description = "问题描述不能超过 1000 字";
  if (record.orderNo && record.orderNo.length > 200) errors.orderNo = "订单号内容过长";
  if (record.bibNumber && !/^[A-Z0-9\s,，-]{1,120}$/.test(record.bibNumber)) {
    errors.bibNumber = "号牌信息只支持字母、数字、空格和分隔符";
  }
  return errors;
}

export function maskSensitive(text) {
  return clean(text)
    .replace(/1[3-9]\d{9}/g, (phone) => `${phone.slice(0, 3)}****${phone.slice(-4)}`)
    .replace(/\b\d{18,}\b/g, (value) => `${value.slice(0, 6)}***${value.slice(-4)}`);
}

export function buildLocalDraft(record) {
  const text = `${record.description} ${record.note}`;
  const matchedType = complaintTypes.find((type) => text.includes(type.replace("/抽奖", "")));
  const phoneCount = (text.match(/1[3-9]\d{9}/g) || []).length;
  const refundHint = /退|退款|重复付款|买了两次/.test(text);
  return {
    suggestedType: record.type !== "其他" ? record.type : (matchedType || (refundHint ? "退款" : "其他")),
    summary: maskSensitive(record.description).slice(0, 120),
    sensitiveHints: [
      phoneCount ? `检测到 ${phoneCount} 个手机号，日志和展示需脱敏` : "",
      record.orderNo ? "包含订单号，提交前请确认是否必要" : "",
      record.bibNumber ? "包含号牌信息" : ""
    ].filter(Boolean),
    handlingSuggestion: refundHint ? "建议核对订单状态后再处理退款或补券" : "建议按类型分派给对应处理人"
  };
}

export async function createComplaintDraft(record, env = process.env) {
  if (!env.DEEPSEEK_API_KEY) {
    return { provider: "local", ...buildLocalDraft(record) };
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || "deepseek-chat",
      messages: [
        {
          role: "system",
          content: "你是客服客诉记录整理助手。只返回 JSON，字段为 suggestedType, summary, sensitiveHints, handlingSuggestion。不要执行任何外部操作。"
        },
        {
          role: "user",
          content: JSON.stringify(record, null, 2)
        }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw new Error(`DeepSeek 请求失败: ${response.status}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "{}";
  return { provider: "deepseek", ...JSON.parse(content) };
}

export function buildComplaintRow(record) {
  return [
    record.type,
    record.description,
    record.attachmentNote,
    record.bibNumber,
    record.orderNo,
    record.owner,
    record.progress,
    record.note
  ];
}

export function buildFeishuAppendArgs(record, env = process.env) {
  return [
    "sheets",
    "+append",
    "--url",
    env.FEISHU_TABLE_URL,
    "--range",
    env.FEISHU_SHEET_RANGE,
    "--values",
    JSON.stringify([buildComplaintRow(record)]),
    "--as",
    env.FEISHU_CLI_AS || "bot"
  ];
}

function runCli(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `CLI exited with ${code}`));
    });
  });
}

export async function writeComplaintToFeishu(record, env = process.env) {
  if ((env.FEISHU_WRITER || "mock") === "mock") {
    return { writer: "mock", externalId: `mock-${record.id}`, status: "skipped" };
  }

  if (!env.FEISHU_TABLE_URL || !env.FEISHU_SHEET_RANGE) {
    throw new Error("缺少 FEISHU_TABLE_URL 或 FEISHU_SHEET_RANGE");
  }

  const cli = env.FEISHU_CLI_PATH || "lark-cli";
  const rowJson = JSON.stringify(buildComplaintRow(record));
  const args = buildFeishuAppendArgs(record, env);

  const result = await runCli(cli, args);
  return {
    writer: "cli",
    externalId: crypto.createHash("sha256").update(result.stdout || rowJson).digest("hex").slice(0, 16),
    status: "written",
    stdout: result.stdout.slice(0, 1000)
  };
}

export async function appendAuditLine(filePath, entry) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(entry, null, 0)}\n`, "utf-8");
}

export function buildComplaintSubmission(input, draft = null) {
  const record = normalizeComplaint(input);
  const idBase = JSON.stringify(record);
  return {
    id: crypto.createHash("sha256").update(idBase).digest("hex").slice(0, 16),
    createdAt: new Date().toISOString(),
    ...record,
    draft,
    auditSummary: {
      description: maskSensitive(record.description).slice(0, 140),
      bibNumber: record.bibNumber,
      orderNo: record.orderNo ? `${record.orderNo.slice(0, 6)}***` : ""
    }
  };
}

export { fieldLabels };
