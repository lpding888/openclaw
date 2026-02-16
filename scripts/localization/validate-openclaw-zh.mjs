#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { URL_PATTERN, BANNED_KEYWORDS } from "./sanitize-openclaw-zh.mjs";

const LOCALIZATION_ROOT = path.resolve(process.cwd(), "localization/openclaw-zh");
const TRANSLATIONS_ROOT = path.join(LOCALIZATION_ROOT, "translations");
const DEFAULT_MIN_HIT_RATE = 0.03;
const PARTIAL_SAFE_FILES = [
  /^dashboard\/schema(?:-core)?\.json$/,
  /^dashboard\/config-form-(?:node|render|shared)\.json$/,
];
const OPTIONAL_TARGET_FILES = new Set(["dashboard/channels-feishu.json"]);

const hasUnsafeText = (text) => {
  const lower = String(text || "").toLowerCase();
  if (URL_PATTERN.test(lower)) {
    URL_PATTERN.lastIndex = 0;
    return true;
  }
  URL_PATTERN.lastIndex = 0;
  return BANNED_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const hasUnsafeJsonValues = (node) => {
  if (typeof node === "string") {
    return hasUnsafeText(node);
  }
  if (Array.isArray(node)) {
    return node.some((item) => hasUnsafeJsonValues(item));
  }
  if (!node || typeof node !== "object") {
    return false;
  }
  return Object.values(node).some((value) => hasUnsafeJsonValues(value));
};

const walkFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => a.startsWith("--target="));
  const thresholdArg = args.find((a) => a.startsWith("--min-hit-rate="));
  return {
    targetDir: targetArg ? path.resolve(targetArg.slice("--target=".length)) : process.cwd(),
    minHitRate: thresholdArg ? Number(thresholdArg.slice("--min-hit-rate=".length)) : DEFAULT_MIN_HIT_RATE,
  };
};

const isPartialSafe = (configFile) => PARTIAL_SAFE_FILES.some((re) => re.test(configFile));

const main = async () => {
  const { targetDir, minHitRate } = parseArgs();
  const cfg = JSON.parse(await fs.readFile(path.join(TRANSLATIONS_ROOT, "config.json"), "utf8"));
  const allFiles = [];
  for (const files of Object.values(cfg.modules || {})) {
    for (const f of files || []) {
      allFiles.push(f);
    }
  }

  const errors = [];
  const warnings = [];

  for (const rel of allFiles) {
    const full = path.join(TRANSLATIONS_ROOT, rel);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isFile()) {
      errors.push(`missing translation file: ${rel}`);
      continue;
    }

    const text = await fs.readFile(full, "utf8");
    if (!rel.endsWith(".json")) {
      if (hasUnsafeText(text)) {
        errors.push(`unsafe external content detected: ${rel}`);
      }
      continue;
    }

    const parsed = JSON.parse(text);
    if (hasUnsafeJsonValues(parsed)) {
      errors.push(`unsafe external content detected: ${rel}`);
    }

    if (parsed.file && parsed.replacements) {
      const targetFile = path.resolve(path.join(targetDir, parsed.file));
      if (!targetFile.startsWith(`${path.resolve(targetDir)}${path.sep}`) && targetFile !== path.resolve(targetDir)) {
        errors.push(`target escape in ${rel}: ${parsed.file}`);
        continue;
      }

      const targetContent = await fs.readFile(targetFile, "utf8").catch(() => null);
      if (targetContent == null) {
        const msg = `target file missing for ${rel}: ${parsed.file}`;
        if (OPTIONAL_TARGET_FILES.has(rel)) {
          warnings.push(msg);
        } else {
          errors.push(msg);
        }
        continue;
      }

      const keys = Object.keys(parsed.replacements).filter((k) => !k.startsWith("__comment"));
      if (keys.length === 0) {
        continue;
      }

      let hits = 0;
      for (const key of keys) {
        const translated = parsed.replacements[key];
        if (targetContent.includes(key) || targetContent.includes(translated)) {
          hits += 1;
        }
      }
      const rate = hits / keys.length;
      if (rate < minHitRate) {
        const msg = `low hit-rate ${rate.toFixed(3)} in ${rel} (hits=${hits}/${keys.length})`;
        if (isPartialSafe(rel)) {
          warnings.push(msg);
        } else {
          errors.push(msg);
        }
      }
    }
  }

  const diskFiles = await walkFiles(TRANSLATIONS_ROOT);
  console.log(
    JSON.stringify(
      {
        targetDir,
        translationFilesReferenced: allFiles.length,
        translationFilesOnDisk: diskFiles.length,
        warnings,
        errors,
      },
      null,
      2,
    ),
  );

  if (errors.length > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
