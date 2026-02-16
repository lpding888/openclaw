# openclaw-zh sync and filtering runbook

This runbook describes how to sync Chinese translation resources from the external source
repo while keeping this repository clean, auditable, and rollback-safe.

## Goals

- Sync translation resources as data (not codebase history merge).
- Remove external links and commercial/promotion payloads.
- Keep engine/application behavior compatible with existing OpenClaw CLI/RPC.

## Commands

Run from repository root:

```bash
pnpm zh:sync
pnpm zh:verify -- --target=.
pnpm localization:validate -- --target=.
```

Optional:

```bash
pnpm zh:apply -- --target=. --dry-run
pnpm zh:apply -- --target=.
pnpm zh:restore -- --target=.
```

## What `zh:sync` does

1. Clone external source repo (default configured in script).
2. Replace local `localization/openclaw-zh/translations/` snapshot.
3. Re-apply local-only file retention (`dashboard/channels-feishu.json`).
4. Sanitize imported payloads:
   - strip URLs
   - strip promotion/commercial/vendor-inducing strings
   - drop non-core panel payloads
   - apply JSON key-path allowlist for engine schema
5. Generate `localization/openclaw-zh/sync-source.json` for audit.

## Validation gates

`pnpm localization:validate -- --target=.` checks:

- all configured translation files exist
- no URL/promotion leftovers in configured translation payloads
- target path does not escape repository root
- replacement hit-rate is above threshold (partial-safe modules only warn)

CI blocks merge when validation errors are present.

## Rollback

- Revert localization changes via git (`git restore`/`git checkout`) as normal.
- Or revert applied target files:

```bash
pnpm zh:restore -- --target=.
```

## Notes

- External source is treated as translation data source only.
- No external commercial links should be present in final translation payloads.
- Keep `sync-source.json` updated on every sync for traceability.
