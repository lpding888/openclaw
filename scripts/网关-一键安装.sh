#!/usr/bin/env bash
set -euo pipefail
trap '' HUP

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LOG_FILE="${GATEWAY_INSTALL_LOG:-/tmp/openclaw-one-click-install.log}"
SKIP_INSTALL=0
SKIP_BUILD=0
NO_LAUNCH=0
FORCE_NO_FROZEN=0

if [[ -n "${PNPM_HOME:-}" ]]; then
  export PATH="${PNPM_HOME}:${PATH}"
fi
export PATH="${HOME}/Library/pnpm:${HOME}/.local/share/pnpm:${PATH}"

declare -a PNPM_CMD

usage() {
  cat <<'USAGE'
Usage: bash scripts/网关-一键安装.sh [options]

Options:
  --skip-install      Skip dependency installation
  --skip-build        Skip pnpm build
  --no-launch         Skip gateway launch after install
  --no-frozen         Use non-frozen lockfile install directly
  -h, --help          Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --no-launch)
      NO_LAUNCH=1
      shift
      ;;
    --no-frozen)
      FORCE_NO_FROZEN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

log() {
  printf '%s\n' "$1"
}

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    log "node 未安装。请先安装 Node.js >= 22.12.0（推荐官网或 Homebrew）。"
    exit 1
  fi

  if ! node -e 'const [maj,min]=process.versions.node.split(".").map(Number);process.exit((maj>22|| (maj===22&&min>=12))?0:1)'; then
    log "Node 版本过低：$(node -v)。需要 >= 22.12.0"
    exit 1
  fi
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
    return 0
  fi

  if command -v corepack >/dev/null 2>&1; then
    log "==> pnpm 未在 PATH，尝试通过 corepack 激活"
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10.23.0 --activate >/dev/null 2>&1 || true

    if corepack pnpm -v >/dev/null 2>&1; then
      PNPM_CMD=(corepack pnpm)
      return 0
    fi
  fi

  log "pnpm 不可用。请先安装 pnpm（或安装带 corepack 的 Node.js）。"
  exit 1
}

run_pnpm() {
  "${PNPM_CMD[@]}" "$@"
}

install_deps() {
  if [[ "${SKIP_INSTALL}" -eq 1 ]]; then
    log "==> 跳过依赖安装"
    return 0
  fi

  if [[ "${FORCE_NO_FROZEN}" -eq 1 ]]; then
    log "==> 安装依赖（非冻结 lockfile）"
    run_pnpm install
    return 0
  fi

  log "==> 安装依赖（优先 frozen-lockfile）"
  if ! run_pnpm install --frozen-lockfile; then
    log "==> frozen-lockfile 失败，回退到普通安装"
    run_pnpm install
  fi
}

build_project() {
  if [[ "${SKIP_BUILD}" -eq 1 ]]; then
    log "==> 跳过构建"
    return 0
  fi

  log "==> 构建项目（pnpm build）"
  run_pnpm build
  log "==> 构建控制台前端（pnpm ui:build）"
  run_pnpm ui:build
}

launch_gateway() {
  if [[ "${NO_LAUNCH}" -eq 1 ]]; then
    log "==> 跳过启动"
    return 0
  fi

  log "==> 启动网关并打开控制台（强制切换到本地构建）"
  GATEWAY_FORCE_RESTART=1 bash "${ROOT_DIR}/scripts/gateway-launcher.sh" start
}

main() {
  {
    log "========================================"
    log "OpenClaw 一键安装与启动"
    log "项目目录: ${ROOT_DIR}"
    log "日志文件: ${LOG_FILE}"
    log "========================================"

    ensure_node
    ensure_pnpm

    log "==> Node: $(node -v)"
    log "==> pnpm: $(run_pnpm -v)"

    install_deps
    build_project
    launch_gateway

    log "========================================"
    log "完成：安装/构建/启动流程已结束"
    log "========================================"
  } 2>&1 | tee "${LOG_FILE}"
}

main "$@"
