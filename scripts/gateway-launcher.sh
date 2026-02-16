#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

PORT="${GATEWAY_PORT:-}"
if [[ -z "${PORT}" ]]; then
  PORT="18789"
fi
LOG_FILE="${GATEWAY_LAUNCH_LOG:-/tmp/openclaw-gateway.log}"
ACTION="${1:-menu}"

if [[ -n "${PNPM_HOME:-}" ]]; then
  export PATH="${PNPM_HOME}:${PATH}"
fi
export PATH="${HOME}/Library/pnpm:${HOME}/.local/share/pnpm:${PATH}"

declare -a PNPM_CMD

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required (>=22.12.0)" >&2
    exit 1
  fi
  if ! node -e 'const [maj,min]=process.versions.node.split(".").map(Number);process.exit((maj>22|| (maj===22&&min>=12))?0:1)'; then
    echo "Node version must be >=22.12.0. Current: $(node -v)" >&2
    exit 1
  fi
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=(pnpm)
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    echo "==> pnpm not found in PATH, trying corepack"
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10.23.0 --activate >/dev/null 2>&1 || true
    if corepack pnpm -v >/dev/null 2>&1; then
      PNPM_CMD=(corepack pnpm)
      return 0
    fi
  fi
  echo "pnpm is required (or install Node with corepack)" >&2
  exit 1
}

run_pnpm() {
  "${PNPM_CMD[@]}" "$@"
}

ensure_dependencies() {
  if [[ -d "${ROOT_DIR}/node_modules" ]]; then
    return 0
  fi
  ensure_pnpm
  echo "==> Installing dependencies"
  run_pnpm install
}

detect_configured_port() {
  if [[ -n "${GATEWAY_PORT:-}" ]]; then
    return 0
  fi
  local configured_port
  configured_port="$(node dist/entry.js config get gateway.port 2>/dev/null | tr -d '\r\n' || true)"
  if [[ "${configured_port}" =~ ^[0-9]+$ ]]; then
    PORT="${configured_port}"
  fi
}

gateway_url() {
  printf "http://127.0.0.1:%s/" "${PORT}"
}

is_gateway_running() {
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

probe_control_ui_status() {
  curl -s -o /dev/null -w "%{http_code}" "$(gateway_url)" || echo "000"
}

stop_listeners_on_port() {
  local pids
  pids="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
  if [[ -z "${pids// }" ]]; then
    return 0
  fi
  echo "==> Stopping existing listener(s) on :${PORT} (${pids})"
  # shellcheck disable=SC2086
  kill ${pids} >/dev/null 2>&1 || true
  sleep 1
  # shellcheck disable=SC2086
  kill -9 ${pids} >/dev/null 2>&1 || true
}

wait_gateway_ready() {
  for _ in {1..80}; do
    if is_gateway_running; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

read_gateway_token() {
  node dist/entry.js config get gateway.auth.token 2>/dev/null || true
}

start_gateway() {
  if is_gateway_running; then
    local status
    status="$(probe_control_ui_status)"
    if [[ "${status}" == "200" || "${status}" == "304" || "${status}" == "302" ]]; then
      echo "==> Gateway already running on :${PORT}"
      return 0
    fi
    echo "==> Existing listener on :${PORT} returned HTTP ${status}; restarting with local gateway"
    stop_listeners_on_port
  else
    echo "==> Starting gateway on :${PORT}"
  fi
  nohup node dist/entry.js gateway run \
    --bind loopback \
    --port "${PORT}" \
    --force \
    --allow-unconfigured >"${LOG_FILE}" 2>&1 &
  local pid=$!
  echo "==> Gateway PID: ${pid}"
  if ! wait_gateway_ready; then
    local existing_port
    existing_port="$(sed -nE 's/.*Port ([0-9]+) is already in use\..*/\1/p' "${LOG_FILE}" | tail -n 1)"
    if [[ "${existing_port}" =~ ^[0-9]+$ ]] && lsof -nP -iTCP:"${existing_port}" -sTCP:LISTEN >/dev/null 2>&1; then
      PORT="${existing_port}"
      local status
      status="$(probe_control_ui_status)"
      if [[ "${status}" == "404" || "${status}" == "000" ]]; then
        stop_listeners_on_port
        echo "==> Retrying with local gateway after stale listener cleanup"
        nohup node dist/entry.js gateway run \
          --bind loopback \
          --port "${PORT}" \
          --force \
          --allow-unconfigured >"${LOG_FILE}" 2>&1 &
        pid=$!
        echo "==> Gateway PID: ${pid}"
        if ! wait_gateway_ready; then
          echo "Gateway did not become ready. Log tail:" >&2
          tail -n 80 "${LOG_FILE}" >&2 || true
          exit 1
        fi
      else
        echo "==> Reusing existing gateway on :${PORT}"
        return 0
      fi
    else
      echo "Gateway did not become ready. Log tail:" >&2
      tail -n 80 "${LOG_FILE}" >&2 || true
      exit 1
    fi
  fi
  local final_status
  final_status="$(probe_control_ui_status)"
  if [[ "${final_status}" == "404" || "${final_status}" == "000" ]]; then
    echo "Gateway is running but Control UI still unavailable (HTTP ${final_status})." >&2
    echo "Log tail:" >&2
    tail -n 80 "${LOG_FILE}" >&2 || true
    exit 1
  fi
  echo "==> Gateway ready: $(gateway_url)"
}

open_console() {
  local base_url
  local token
  local open_url

  base_url="$(gateway_url)"
  token="$(read_gateway_token | tr -d '\r\n')"
  open_url="${base_url}"
  if [[ -n "${token}" ]]; then
    open_url="${base_url}?token=${token}"
  fi

  echo "==> Control UI: ${base_url}"
  if [[ -n "${token}" ]]; then
    echo "==> Gateway token: ${token}"
  fi

  if command -v open >/dev/null 2>&1; then
    open "${open_url}" >/dev/null 2>&1 || true
  fi
}

run_onboard() {
  echo "==> Starting onboarding wizard"
  node dist/entry.js onboard --install-daemon
}

run_model_manager() {
  echo "==> Starting model manager"
  bash "${ROOT_DIR}/scripts/model-switcher.sh"
}

pick_action() {
  if [[ "${ACTION}" != "menu" ]]; then
    return 0
  fi
  cat <<'EOF'
请选择：
  1) 启动网关并打开控制台
  2) 进入引导向导
  3) 启动网关并打开控制台，然后进入引导向导
  4) 模型管理（查看/切换模型）
EOF
  read -r -p "输入 1/2/3/4 (默认 1): " picked
  ACTION="${picked:-1}"
}

main() {
  ensure_node
  ensure_dependencies
  detect_configured_port
  pick_action

  case "${ACTION}" in
    1|start|console)
      start_gateway
      open_console
      ;;
    2|onboard)
      run_onboard
      ;;
    3|all)
      start_gateway
      open_console
      run_onboard
      ;;
    4|models)
      run_model_manager
      ;;
    *)
      echo "Unknown action: ${ACTION}" >&2
      exit 1
      ;;
  esac
}

main "$@"
