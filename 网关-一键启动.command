#!/usr/bin/env bash
set -euo pipefail
trap '' HUP

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

bash "$ROOT_DIR/scripts/gateway-launcher.sh" start

echo
read -r -p "网关已启动，按回车关闭窗口..." _
