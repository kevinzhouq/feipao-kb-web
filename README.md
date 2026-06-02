# 飞跑知识库 Web

手机微信端适合访问的内部知识库查询工具。第一版只读取 `知识库/客服知识库.xlsx` 的 `知识库` 工作表，不索引 `2026吉林` 客诉记录表。

## 本地运行

```powershell
cd D:\文档\ai\codex\飞跑\feipao-kb-web
python scripts/build_kb.py
$env:AUTH_PASSWORD="你的访问密码"
$env:COMPLAINT_PASSWORD="客诉模块二次密码"
$env:SESSION_SECRET="一段足够长的随机字符串"
$env:HOST="0.0.0.0"
node server.mjs
```

浏览器访问 `http://localhost:8787`。手机微信测试时，云端部署前可临时用局域网地址或内网穿透。

本机快速预览也可以运行：

```powershell
.\start-preview.ps1
```

## 云端部署建议

优先用支持 Node.js 的轻量云服务，例如 Render、Railway、Fly.io、腾讯云轻量应用服务器或阿里云 ECS。部署时设置环境变量：

- `AUTH_PASSWORD`：内部访问密码
- `COMPLAINT_PASSWORD`：客诉记录模块二次访问密码
- `SESSION_SECRET`：会话签名密钥
- `PORT`：由平台提供时无需手动设置
- `KB_DATA_PATH`：默认 `./data/kb.json`
- `COMPLAINT_DATA_PATH`：默认 `./data/complaints.jsonl`
- `FEISHU_WRITER`：默认 `mock`，配置为 `cli` 后调用飞书 CLI
- `FEISHU_CLI_PATH`：默认 `lark-cli`
- `FEISHU_TABLE_URL`：飞书在线表格 URL
- `FEISHU_SHEET_RANGE`：追加范围，例如 `TLSUzz!A:I`
- `FEISHU_CLI_AS`：默认 `bot`
- `DEEPSEEK_API_KEY`：可选，未配置时使用本地规则生成整理建议

部署流程建议：

1. 本地运行 `python scripts/build_kb.py` 生成 `data/kb.json`。
2. 本地验证搜索和手机视口。
3. 初始化 Git 仓库并推送到 GitHub。
4. 云平台连接 GitHub 仓库部署。
5. 后续更新 Excel 后重新生成 `data/kb.json`，提交并触发部署。

## GitHub 同步阶段

第一次同步建议放在本地功能验证通过后、云端部署前。这样 GitHub 上的第一版就是可运行版本，云平台也能直接连接仓库自动部署。

## 第二阶段：客诉记录与飞书同步

`客服知识库.xlsx` 的 `2026吉林` 工作表属于客诉记录，不进入普通查询端。当前版本已加入独立的客诉记录后台：

- 进入知识库后，切换到 `客诉记录` Tab。
- 客诉模块需要 `COMPLAINT_PASSWORD` 二次验证。
- 表单字段映射到在线飞书表格：类型、问题描述、截图、号牌信息、订单号、处理对接人、处理进度、备注。
- `AI整理` 可调用 DeepSeek 生成分类、摘要、敏感信息提示和处理建议；未配置 DeepSeek 时使用本地规则。
- `提交到飞书` 由后端统一校验、审计并调用写入适配器。

### 飞书 CLI 写入

默认 `FEISHU_WRITER=mock`，提交只写入本地审计队列，适合开发和预览。

切换为飞书 CLI：

```powershell
$env:FEISHU_WRITER="cli"
$env:FEISHU_CLI_PATH="lark-cli"
$env:FEISHU_TABLE_URL="https://fqj52sgnffz.feishu.cn/sheets/XsNjsml2ahOWS7t0IuwcjKuSndf?sheet=TLSUzz"
$env:FEISHU_SHEET_RANGE="TLSUzz!A:I"
$env:FEISHU_CLI_AS="bot"
```

飞书 CLI 需要先按官方流程安装并登录：

```powershell
npx @larksuite/cli@latest install
lark-cli config init --new
lark-cli auth login --recommend
lark-cli auth status
```

DeepSeek 只做辅助整理，不直接执行飞书写入。飞书凭证和 CLI 登录状态只应保存在服务端或部署环境。
