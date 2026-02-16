#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeOpenClawZh } from "./sanitize-openclaw-zh.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = "https://github.com/1186258278/OpenClawChineseTranslation";
const LOCALIZATION_ROOT = path.resolve(process.cwd(), "localization/openclaw-zh");
const TRANSLATIONS_ROOT = path.join(LOCALIZATION_ROOT, "translations");
const FILTER_POLICY_VERSION = "2026-02-16.v1";

const LOCAL_ONLY_FILES = ["dashboard/channels-feishu.json"];
const DROP_PATHS = ["panel"];

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const copyFileIfExists = async (from, to) => {
  const data = await fs.readFile(from).catch(() => null);
  if (data == null) {
    return false;
  }
  await ensureDir(path.dirname(to));
  await fs.writeFile(to, data);
  return true;
};

const normalizeConfig = async () => {
  const configPath = path.join(TRANSLATIONS_ROOT, "config.json");
  const cfg = JSON.parse(await fs.readFile(configPath, "utf8"));

  const dashboard = Array.isArray(cfg.modules?.dashboard) ? cfg.modules.dashboard : [];
  if (!dashboard.includes("dashboard/channels-feishu.json")) {
    dashboard.push("dashboard/channels-feishu.json");
    cfg.modules.dashboard = dashboard;
  }

  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
};

const dropUnusedContent = async () => {
  for (const rel of DROP_PATHS) {
    await fs.rm(path.join(TRANSLATIONS_ROOT, rel), { recursive: true, force: true });
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const repoArg = args.find((a) => a.startsWith("--repo="));
  const sourceRepo = repoArg ? repoArg.slice("--repo=".length) : DEFAULT_REPO;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-zh-sync-"));
  try {
    await execFileAsync("git", ["clone", "--depth=1", sourceRepo, tempDir]);
    const { stdout: commitRaw } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: tempDir });
    const sourceCommit = commitRaw.trim();

    const sourceTranslations = path.join(tempDir, "translations");
    await fs.stat(sourceTranslations);

    const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-zh-backup-"));
    for (const rel of LOCAL_ONLY_FILES) {
      await copyFileIfExists(path.join(TRANSLATIONS_ROOT, rel), path.join(backupRoot, rel));
    }

    await fs.rm(TRANSLATIONS_ROOT, { recursive: true, force: true });
    await fs.cp(sourceTranslations, TRANSLATIONS_ROOT, { recursive: true, force: true });
    await dropUnusedContent();

    for (const rel of LOCAL_ONLY_FILES) {
      await copyFileIfExists(path.join(backupRoot, rel), path.join(TRANSLATIONS_ROOT, rel));
    }

    const sanitizeStats = await sanitizeOpenClawZh({ rootDir: LOCALIZATION_ROOT });
    await normalizeConfig();

    const syncMeta = {
      sourceRepo,
      sourceCommit,
      syncedAt: new Date().toISOString(),
      filterPolicyVersion: FILTER_POLICY_VERSION,
      removedLinksCount: sanitizeStats.removedLinksCount,
      removedEntries: sanitizeStats.removedEntries,
      removedPaths: sanitizeStats.removedPaths,
    };
    await fs.writeFile(
      path.join(LOCALIZATION_ROOT, "sync-source.json"),
      `${JSON.stringify(syncMeta, null, 2)}\n`,
      "utf8",
    );

    console.log(JSON.stringify({ syncMeta, sanitizeStats }, null, 2));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
