$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = "C:\Users\33066\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

$env:AUTH_PASSWORD = "feipao-demo"
$env:SESSION_SECRET = "local-preview-secret-change-before-deploy"
$env:PORT = "8787"
$env:HOST = "0.0.0.0"

Set-Location -LiteralPath $root
& $node server.mjs
