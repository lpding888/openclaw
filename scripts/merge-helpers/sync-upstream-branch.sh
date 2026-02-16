#!/usr/bin/env bash
# Non-interactive upstream sync helper.
#
# Local usage:
#   ./scripts/merge-helpers/sync-upstream-branch.sh \
#     --target-branch main \
#     --upstream-url https://github.com/openclaw/openclaw.git
#
# CI usage:
#   ./scripts/merge-helpers/sync-upstream-branch.sh --ci-mode

set -euo pipefail

TARGET_BRANCH="main"
UPSTREAM_BRANCH="main"
UPSTREAM_URL="https://github.com/openclaw/openclaw.git"
SYNC_BRANCH="automation/upstream-sync"
REMOTE="origin"
CI_MODE=0

usage() {
  cat <<'USAGE'
Usage: sync-upstream-branch.sh [options]

Options:
  --target-branch <name>   Target branch to sync into (default: main)
  --upstream-branch <name> Upstream branch to merge from (default: main)
  --upstream-url <url>     Upstream remote URL (default: https://github.com/openclaw/openclaw.git)
  --sync-branch <name>     Sync branch name (default: automation/upstream-sync)
  --remote <name>          Local writable remote (default: origin)
  --ci-mode                Never fail on merge conflict; emit outputs for CI
  -h, --help               Show this help
USAGE
}

emit_output() {
  local key="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-branch)
      TARGET_BRANCH="$2"
      shift 2
      ;;
    --upstream-branch)
      UPSTREAM_BRANCH="$2"
      shift 2
      ;;
    --upstream-url)
      UPSTREAM_URL="$2"
      shift 2
      ;;
    --sync-branch)
      SYNC_BRANCH="$2"
      shift 2
      ;;
    --remote)
      REMOTE="$2"
      shift 2
      ;;
    --ci-mode)
      CI_MODE=1
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

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not in a git repository" >&2
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  echo "Remote '$REMOTE' is not configured" >&2
  exit 1
fi

if git remote | grep -q '^upstream$'; then
  git remote set-url upstream "$UPSTREAM_URL"
else
  git remote add upstream "$UPSTREAM_URL"
fi

git fetch "$REMOTE" "$TARGET_BRANCH"
git fetch upstream "$UPSTREAM_BRANCH"

git checkout -B "$TARGET_BRANCH" "$REMOTE/$TARGET_BRANCH"
git checkout -B "$SYNC_BRANCH" "$TARGET_BRANCH"

before_sha="$(git rev-parse HEAD)"
merge_message="chore(sync): merge upstream/${UPSTREAM_BRANCH} into ${TARGET_BRANCH}"

set +e
merge_output="$(git merge --no-ff "upstream/$UPSTREAM_BRANCH" -m "$merge_message" 2>&1)"
merge_code=$?
set -e

echo "$merge_output"

if [[ $merge_code -ne 0 ]]; then
  if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    git merge --abort || true
  fi

  emit_output "changed" "false"
  emit_output "conflict" "true"
  emit_output "sync_branch" "$SYNC_BRANCH"
  emit_output "target_branch" "$TARGET_BRANCH"
  emit_output "upstream_ref" "upstream/$UPSTREAM_BRANCH"

  echo "Merge conflict detected while syncing upstream/$UPSTREAM_BRANCH -> $TARGET_BRANCH" >&2

  if [[ "$CI_MODE" -eq 1 ]]; then
    exit 0
  fi
  exit 2
fi

after_sha="$(git rev-parse HEAD)"
changed="false"
if [[ "$before_sha" != "$after_sha" ]]; then
  changed="true"
fi

emit_output "changed" "$changed"
emit_output "conflict" "false"
emit_output "sync_branch" "$SYNC_BRANCH"
emit_output "target_branch" "$TARGET_BRANCH"
emit_output "upstream_ref" "upstream/$UPSTREAM_BRANCH"

echo "changed=$changed"
echo "sync_branch=$SYNC_BRANCH"
echo "target_branch=$TARGET_BRANCH"
echo "upstream_ref=upstream/$UPSTREAM_BRANCH"
