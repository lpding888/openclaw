#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${OPENCLAW_PACKAGE_NAME:-openclaw-cn}"
TARGET_VERSION="${OPENCLAW_VERSION:-latest}"
RUN_ONBOARD=1
RESTART_GATEWAY=0

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
  -h, --help            Show this help

Examples:
  # Install latest
  curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install-openclaw-cn.sh | bash

  # Update in place (skip wizard)
  curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install-openclaw-cn.sh | bash -s -- --no-onboard --restart-gateway
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

  if [[ "${RUN_ONBOARD}" -eq 1 ]]; then
    echo "==> Running onboarding wizard"
    "${cli_cmd}" onboard --install-daemon
  fi

  if [[ "${RESTART_GATEWAY}" -eq 1 ]]; then
    echo "==> Restarting gateway"
    "${cli_cmd}" gateway restart || true
  fi

  echo "==> Done"
}

main "$@"
