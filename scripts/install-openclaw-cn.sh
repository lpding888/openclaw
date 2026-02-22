#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${OPENCLAW_PACKAGE_NAME:-openclaw-cn}"
TARGET_VERSION="${OPENCLAW_VERSION:-latest}"
RUN_ONBOARD=1
RESTART_GATEWAY=0
APPLY_STABILITY_DEFAULTS=1

CLI_CANDIDATES=(
  "${OPENCLAW_CLI_PRIMARY:-openclaw-cn}"
  "openclaw"
  "clawdbot-cn"
  "clawdbot"
)

usage() {
  cat <<'EOF'
Usage: install-openclaw-cn.sh [options]

Options:
  --package <name>      npm package name (default: openclaw-cn)
  --version <ver>       npm version or dist-tag (default: latest)
  --no-onboard          Skip onboarding wizard
  --restart-gateway     Restart gateway after install/update
  --skip-stability-defaults
                         Skip applying anti-stall runtime defaults
  -h, --help            Show this help

Examples:
  # Install latest
  curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install-openclaw-cn.sh | bash

  # Update in place (skip wizard)
  curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install-openclaw-cn.sh | bash -s -- --no-onboard --restart-gateway
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package)
      PACKAGE_NAME="$2"
      shift 2
      ;;
    --version)
      TARGET_VERSION="$2"
      shift 2
      ;;
    --no-onboard)
      RUN_ONBOARD=0
      shift
      ;;
    --restart-gateway)
      RESTART_GATEWAY=1
      shift
      ;;
    --skip-stability-defaults)
      APPLY_STABILITY_DEFAULTS=0
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

need_bin() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: $name" >&2
    exit 1
  fi
}

ensure_node_version() {
  need_bin node
  node -e 'const [maj,min]=process.versions.node.split(".").map(Number);process.exit((maj>22||(maj===22&&min>=12))?0:1)' \
    || {
      echo "Node.js >= 22.12.0 is required. Current: $(node -v)" >&2
      exit 1
    }
}

detect_cli_command() {
  local prefix=""
  prefix="$(npm config get prefix 2>/dev/null || true)"
  local candidate
  for candidate in "${CLI_CANDIDATES[@]}"; do
    if [[ -n "$candidate" ]] && command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
    if [[ -n "$prefix" && -x "${prefix}/bin/${candidate}" ]]; then
      echo "${prefix}/bin/${candidate}"
      return 0
    fi
  done
  return 1
}

config_get() {
  local cli_cmd="$1"
  local path="$2"
  "${cli_cmd}" config get "${path}" 2>/dev/null | tr -d '\r' || true
}

config_set() {
  local cli_cmd="$1"
  local path="$2"
  local value="$3"
  "${cli_cmd}" config set "${path}" "${value}" >/dev/null 2>&1 || true
}

config_set_json() {
  local cli_cmd="$1"
  local path="$2"
  local value="$3"
  "${cli_cmd}" config set --json "${path}" "${value}" >/dev/null 2>&1 || true
}

apply_stability_defaults() {
  local cli_cmd="$1"
  local dm_scope=""
  local reset_by_type=""
  local compaction_mode=""

  dm_scope="$(config_get "${cli_cmd}" session.dmScope)"
  if [[ -z "${dm_scope}" || "${dm_scope}" == "main" || "${dm_scope}" == Config\ path\ not\ found:* ]]; then
    config_set "${cli_cmd}" session.dmScope per-channel-peer
  fi

  reset_by_type="$(config_get "${cli_cmd}" session.resetByType)"
  if [[ -z "${reset_by_type}" || "${reset_by_type}" == Config\ path\ not\ found:* ]]; then
    config_set_json "${cli_cmd}" session.resetByType \
      '{dm:{mode:"idle",idleMinutes:90},group:{mode:"idle",idleMinutes:720},thread:{mode:"idle",idleMinutes:240}}'
  fi

  compaction_mode="$(config_get "${cli_cmd}" agents.defaults.compaction.mode)"
  if [[ -z "${compaction_mode}" || "${compaction_mode}" == "safeguard" || "${compaction_mode}" == Config\ path\ not\ found:* ]]; then
    config_set "${cli_cmd}" agents.defaults.compaction.mode default
  fi
}

run_onboard() {
  local cli_cmd="$1"
  if [[ -t 0 && -t 1 ]]; then
    "${cli_cmd}" onboard --install-daemon
    return
  fi
  if [[ -r /dev/tty && -w /dev/tty ]]; then
    # Support `curl ... | bash` by binding interactive prompts to the terminal.
    "${cli_cmd}" onboard --install-daemon < /dev/tty > /dev/tty 2>&1
    return
  fi
  echo "Skipping onboarding: no interactive TTY available." >&2
  echo "Run manually: ${cli_cmd} onboard --install-daemon" >&2
}

main() {
  need_bin npm
  ensure_node_version

  local spec="${PACKAGE_NAME}@${TARGET_VERSION}"
  echo "==> Installing ${spec}"
  npm install -g --no-fund --no-audit "${spec}"

  local cli_cmd=""
  if cli_cmd="$(detect_cli_command)"; then
    echo "==> Installed CLI: ${cli_cmd}"
  else
    echo "Installed ${spec}, but CLI command is not in PATH yet." >&2
    echo "Open a new terminal and run the command manually." >&2
    exit 0
  fi

  if [[ "${APPLY_STABILITY_DEFAULTS}" -eq 1 ]]; then
    echo "==> Applying stability defaults"
    apply_stability_defaults "${cli_cmd}"
  fi

  if [[ "${RUN_ONBOARD}" -eq 1 ]]; then
    echo "==> Running onboarding wizard"
    run_onboard "${cli_cmd}"
  fi

  if [[ "${RESTART_GATEWAY}" -eq 1 ]]; then
    echo "==> Restarting gateway"
    "${cli_cmd}" gateway restart || true
  fi

  echo "==> Done"
}

main "$@"
