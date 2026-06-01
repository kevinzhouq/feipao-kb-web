# 飞跑知识库 Web

手机微信端适合访问的内部知识库查询工具。第一版只读取 `知识库/客服知识库.xlsx` 的 `知识库` 工作表，不索引 `2026吉林` 客诉记录表。

## 本地运行

```powershell
cd D:\文档\ai\codex\飞跑\feipao-kb-web
python scripts/build_kb.py
$env:AUTH_PASSWORD="你的访问密码"
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
- `SESSION_SECRET`：会话签名密钥
- `PORT`：由平台提供时无需手动设置
- `KB_DATA_PATH`：默认 `./data/kb.json`

部署流程建议：

1. 本地运行 `python scripts/build_kb.py` 生成 `data/kb.json`。
2. 本地验证搜索和手机视口。
3. 初始化 Git 仓库并推送到 GitHub。
4. 云平台连接 GitHub 仓库部署。
5. 后续更新 Excel 后重新生成 `data/kb.json`，提交并触发部署。

## GitHub 同步阶段

第一次同步建议放在本地功能验证通过后、云端部署前。这样 GitHub 上的第一版就是可运行版本，云平台也能直接连接仓库自动部署。

## 第二阶段：客诉记录与飞书同步

`客服知识库.xlsx` 的 `2026吉林` 工作表属于客诉记录，不进入第一版查询端。第二阶段建议做独立的客服记录后台：

- 独立登录或更严格的账号权限。
- 表单字段映射到在线飞书表格：问题描述、截图、号牌信息、订单号、处理对接人、处理进度、备注等。
- 服务端调用飞书 CLI 或飞书开放接口写入在线表格。
- 写入前需要确认飞书表格 token、字段映射、凭证保存方式、失败重试和审计记录。
