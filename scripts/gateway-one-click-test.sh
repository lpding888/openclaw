#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

HOOK_TIMEOUT_MS="${HOOK_TIMEOUT_MS:-60000}"
TEST_TIMEOUT_MS="${TEST_TIMEOUT_MS:-60000}"
SKIP_INSTALL=0
RUN_ALL=0

# Make pnpm discoverable in non-interactive shells (e.g. macOS .command launch).
if [[ -n "${PNPM_HOME:-}" ]]; then
  export PATH="${PNPM_HOME}:${PATH}"
fi
export PATH="${HOME}/Library/pnpm:${HOME}/.local/share/pnpm:${PATH}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --all)
      RUN_ALL=1
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash scripts/gateway-one-click-test.sh [--all] [--skip-install]

Options:
  --all          Run all gateway e2e suites in src/gateway/*.e2e.test.ts
  --skip-install Skip "pnpm install"

Env:
  HOOK_TIMEOUT_MS  Vitest hook timeout in ms (default: 60000)
  TEST_TIMEOUT_MS  Vitest test timeout in ms (default: 60000)
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (>=22.12.0)" >&2
  exit 1
fi

declare -a PNPM_CMD
if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  echo "==> pnpm not found in PATH, trying corepack"
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.23.0 --activate >/dev/null 2>&1 || true
  if corepack pnpm -v >/dev/null 2>&1; then
    PNPM_CMD=(corepack pnpm)
  else
    echo "pnpm is required (or corepack must be available)" >&2
    exit 1
  fi
else
  echo "pnpm is required (or install Node with corepack)" >&2
  exit 1
fi

run_pnpm() {
  "${PNPM_CMD[@]}" "$@"
}

if ! node -e 'const [maj,min]=process.versions.node.split(".").map(Number);process.exit((maj>22|| (maj===22&&min>=12))?0:1)'; then
  echo "Node version must be >=22.12.0. Current: $(node -v)" >&2
  exit 1
fi

if [[ "${SKIP_INSTALL}" -ne 1 ]]; then
  echo "==> Installing dependencies"
  run_pnpm install
fi

declare -a suites
if [[ "${RUN_ALL}" -eq 1 ]]; then
  mapfile -t suites < <(find src/gateway -maxdepth 1 -name "*.e2e.test.ts" | LC_ALL=C sort)
else
  suites=(
    "src/gateway/server.auth.e2e.test.ts"
    "src/gateway/server.context.integrity.e2e.test.ts"
    "src/gateway/server.overload.e2e.test.ts"
    "src/gateway/server.node.invoke.lifecycle.e2e.test.ts"
    "src/gateway/server.node.invoke.recovery.e2e.test.ts"
  )
fi

echo "==> Running ${#suites[@]} gateway e2e suite(s)"
for suite in "${suites[@]}"; do
  echo "==> ${suite}"
  run_pnpm vitest run --config vitest.e2e.config.ts "${suite}" \
    --hookTimeout "${HOOK_TIMEOUT_MS}" \
    --testTimeout "${TEST_TIMEOUT_MS}"
done

echo "==> Gateway one-click tests passed"
