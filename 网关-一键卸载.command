#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

bash "$ROOT_DIR/scripts/网关-一键卸载.sh"

echo
read -r -p "卸载流程结束，按回车关闭窗口..." _
