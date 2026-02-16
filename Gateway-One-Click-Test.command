#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

bash "$ROOT_DIR/scripts/gateway-one-click-test.sh"

echo
read -r -p "测试结束，按回车关闭窗口..." _
