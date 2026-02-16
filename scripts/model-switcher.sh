#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (>=22.12.0)" >&2
  exit 1
fi

if ! node -e 'const [maj,min]=process.versions.node.split(".").map(Number);process.exit((maj>22|| (maj===22&&min>=12))?0:1)'; then
  echo "Node version must be >=22.12.0. Current: $(node -v)" >&2
  exit 1
fi

show_current_model() {
  local current
  current="$(node dist/entry.js models status --plain 2>/dev/null | tail -n 1 || true)"
  if [[ -z "${current}" ]]; then
    echo "当前模型：未配置"
  else
    echo "当前模型：${current}"
  fi
}

list_models_configured() {
  echo "已配置模型："
  node dist/entry.js models list --plain || true
}

list_models_all() {
  echo "全部模型（可能较多）："
  node dist/entry.js models list --all --plain || true
}

set_model() {
  read -r -p "输入模型 ID（例如 anthropic/claude-opus-4-5）: " model_id
  model_id="${model_id//[$'\r\n']}"
  if [[ -z "${model_id}" ]]; then
    echo "未输入模型 ID，已取消。"
    return 0
  fi
  node dist/entry.js models set "${model_id}"
  echo
  show_current_model
}

while true; do
  echo
  echo "模型管理器："
  echo "  1) 查看当前模型"
  echo "  2) 列出已配置模型"
  echo "  3) 列出全部模型"
  echo "  4) 设置默认模型"
  echo "  5) 退出"
  read -r -p "选择 1/2/3/4/5: " action
  case "${action}" in
    1) show_current_model ;;
    2) list_models_configured ;;
    3) list_models_all ;;
    4) set_model ;;
    5) exit 0 ;;
    *) echo "无效输入，请重试。" ;;
  esac
done
