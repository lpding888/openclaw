#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

LOG_FILE="${GATEWAY_UNINSTALL_LOG:-/tmp/openclaw-one-click-uninstall.log}"
PURGE_STATE=0
DELETE_REPO=0
ASSUME_YES=0

if [[ -n "${PNPM_HOME:-}" ]]; then
  export PATH="${PNPM_HOME}:${PATH}"
fi
export PATH="${HOME}/Library/pnpm:${HOME}/.local/share/pnpm:${PATH}"

log() {
  printf '%s\n' "$1"
}

usage() {
  cat <<'USAGE'
Usage: bash scripts/网关-一键卸载.sh [options]

Options:
  --purge-state    Also remove user data dirs (~/.openclaw etc.)
  --delete-repo    Also delete current repo directory at the end
  --yes            Non-interactive mode (dangerous)
  -h, --help       Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-state)
      PURGE_STATE=1
      shift
      ;;
    --delete-repo)
      DELETE_REPO=1
      shift
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

confirm_plan() {
  if [[ "${ASSUME_YES}" -eq 1 ]]; then
    return 0
  fi

  cat <<'MENU'
请选择卸载级别：
  1) 标准卸载（推荐）：停网关 + 清理本仓依赖/构建缓存
  2) 彻底卸载：标准卸载 + 删除 ~/.openclaw 等用户数据
  3) 取消
MENU
  read -r -p "输入 1/2/3 (默认 1): " choice
  choice="${choice:-1}"
  case "${choice}" in
    1)
      PURGE_STATE=0
      ;;
    2)
      PURGE_STATE=1
      ;;
    3)
      log "已取消。"
      exit 0
      ;;
    *)
      log "无效选择，已取消。"
      exit 1
      ;;
  esac

  log ""
  log "将执行："
  log "- 停止网关进程与监听端口"
  log "- 卸载网关服务（如果已安装）"
  log "- 删除本仓 node_modules/dist/.turbo"
  if [[ "${PURGE_STATE}" -eq 1 ]]; then
    log "- 删除用户数据目录（~/.openclaw 及历史目录）"
  fi
  if [[ "${DELETE_REPO}" -eq 1 ]]; then
    log "- 删除当前仓库目录（高风险）"
  fi

  read -r -p "确认继续？输入 YES 继续: " ack
  if [[ "${ack}" != "YES" ]]; then
    log "未确认，已取消。"
    exit 0
  fi
}

stop_gateway_ports() {
  local ports=(18789 18788)
  for port in "${ports[@]}"; do
    local pids
    pids="$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
    if [[ -n "${pids// }" ]]; then
      log "==> 停止端口 :${port} 监听进程: ${pids}"
      # shellcheck disable=SC2086
      kill ${pids} >/dev/null 2>&1 || true
      sleep 1
      # shellcheck disable=SC2086
      kill -9 ${pids} >/dev/null 2>&1 || true
    fi
  done
}

run_cli_uninstall() {
  local args=(uninstall --service --yes --non-interactive)
  if [[ "${PURGE_STATE}" -eq 1 ]]; then
    args=(uninstall --all --yes --non-interactive)
  fi

  if [[ -f "${ROOT_DIR}/dist/entry.js" ]]; then
    log "==> 通过 dist CLI 执行卸载: ${args[*]}"
    node "${ROOT_DIR}/dist/entry.js" "${args[@]}" || true
    return 0
  fi

  if [[ -d "${ROOT_DIR}/node_modules" ]]; then
    log "==> 通过源码 CLI 执行卸载: ${args[*]}"
    node "${ROOT_DIR}/scripts/run-node.mjs" "${args[@]}" || true
    return 0
  fi

  log "==> 未找到可用 CLI 运行环境，跳过 CLI 卸载步骤（将执行手动清理）"
}

cleanup_launch_agents() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi

  local labels=("ai.openclaw.mac" "ai.openclaw.gateway")
  for label in "${labels[@]}"; do
    log "==> 清理 launchctl: ${label}"
    launchctl bootout "gui/${UID}/${label}" >/dev/null 2>&1 || true
    launchctl remove "${label}" >/dev/null 2>&1 || true
    rm -f "${HOME}/Library/LaunchAgents/${label}.plist" || true
  done
}

cleanup_repo_artifacts() {
  log "==> 清理仓库产物"
  rm -rf "${ROOT_DIR}/node_modules" || true
  rm -rf "${ROOT_DIR}/dist" || true
  rm -rf "${ROOT_DIR}/.turbo" || true
  rm -rf "${ROOT_DIR}/.cache" || true
  rm -f "${ROOT_DIR}/npm-debug.log" || true
  rm -f "${ROOT_DIR}/pnpm-debug.log" || true
}

cleanup_user_state() {
  if [[ "${PURGE_STATE}" -ne 1 ]]; then
    return 0
  fi

  log "==> 彻底清理用户状态目录"
  rm -rf "${HOME}/.openclaw" || true
  rm -rf "${HOME}/.clawdbot" || true
  rm -rf "${HOME}/.moldbot" || true
  rm -rf "${HOME}/.moltbot" || true
  rm -f "${HOME}/.openclawrc" || true

  if [[ "$(uname -s)" == "Darwin" ]]; then
    rm -rf "/Applications/OpenClaw.app" || true
  fi
}

cleanup_logs() {
  rm -f "/tmp/openclaw-gateway.log" || true
  rm -f "/tmp/openclaw-one-click-install.log" || true
}

delete_repo_if_needed() {
  if [[ "${DELETE_REPO}" -ne 1 ]]; then
    return 0
  fi

  local parent_dir
  parent_dir="$(dirname "${ROOT_DIR}")"
  local repo_name
  repo_name="$(basename "${ROOT_DIR}")"

  log "==> 删除仓库目录: ${ROOT_DIR}"
  cd "${parent_dir}"
  rm -rf "${ROOT_DIR}"
  log "==> 已删除 ${repo_name}"
}

main() {
  {
    log "========================================"
    log "OpenClaw 一键卸载"
    log "仓库目录: ${ROOT_DIR}"
    log "日志文件: ${LOG_FILE}"
    log "========================================"

    confirm_plan
    stop_gateway_ports
    run_cli_uninstall
    cleanup_launch_agents
    cleanup_repo_artifacts
    cleanup_user_state
    cleanup_logs
    delete_repo_if_needed

    log "========================================"
    log "卸载完成"
    if [[ "${PURGE_STATE}" -eq 0 ]]; then
      log "提示：你的 ~/.openclaw 用户数据已保留。"
    else
      log "提示：用户数据已一并清理。"
    fi
    log "========================================"
  } 2>&1 | tee "${LOG_FILE}"
}

main "$@"
