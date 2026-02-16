# openclaw-zh (vendored localization)

This directory contains a vendored Simplified Chinese localization pack and an internal
engine for applying it to a target OpenClaw repo.

## Scope

- This is an internal localization data/control path.
- It does **not** modify the main `openclaw` binary command routing.
- All operations are exposed by npm scripts and run only on explicit targets.

## Commands

From repo root:

- `pnpm zh:status -- --target=/abs/or/relative/repo`
- `pnpm zh:apply -- --target=/abs/or/relative/repo [--dry-run] [--verbose]`
- `pnpm zh:verify -- --target=/abs/or/relative/repo [--verbose]`
- `pnpm zh:restore -- --target=/abs/or/relative/repo`
- `pnpm zh:sync`
- `pnpm localization:validate -- --target=/abs/or/relative/repo`

Notes:

- `zh:verify` performs the same matching logic as apply, but never writes files.
- `zh:restore` only restores tracked files and only inside a git repository target.

## Sync source and audit

Sync metadata is written to:

- `localization/openclaw-zh/sync-source.json`

The file records:

- `sourceRepo`
- `sourceCommit`
- `syncedAt`
- `filterPolicyVersion`
- `removedLinksCount`

## Sanitization policy (no external promotion)

During `zh:sync`, imported translations are sanitized:

- remove external URLs in translation payloads
- remove promotion/affiliate/commercial guidance text
- remove known externalized panel payloads not used by the main localization flow
- enforce JSON key-path allowlist for engine-owned translation schema

Only UI/CLI translation-oriented content is retained.

## Safety constraints

- target paths are validated to stay inside the target repo root
- translation engine does not allow path traversal writes
- partial-safe modules (`dashboard/schema*.json`, `dashboard/config-form*.json`) warn on misses instead of hard-failing

## Workflow recommendation

1. `pnpm zh:sync`
2. `pnpm zh:verify -- --target=.`
3. `pnpm localization:validate -- --target=.`
4. run test subset (`pnpm vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts`)
