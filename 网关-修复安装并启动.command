#!/usr/bin/env bash
set -euo pipefail
trap '' HUP

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

bash "$ROOT_DIR/scripts/网关-一键安装.sh" --no-frozen

echo
read -r -p "修复安装并启动完成，按回车关闭窗口..." _
