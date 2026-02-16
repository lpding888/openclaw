#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

export const URL_PATTERN = /https?:\/\/[\w.-]+(?:\/[\w\-./?%&=+#,:;~]*)?/gi;
export const BANNED_KEYWORDS = [
  "openclaw.qt.cool",
  "qingchencloud",
  "@qingchencloud/",
  "openclawchinesetranslation",
  "shengsuanyun.com/activity",
  "github.com/1186258278/openclawchinesetranslation",
  "ch_4bvi0bm2",
  "注册送",
  "返利",
  "七折",
  "优惠",
  "模力券",
  "合作伙伴",
  "推广",
  "汉化官网",
  "汉化发行版",
  "晴辰天下",
  "专属客服",
  "分销",
  "代理",
];

const ENGINE_JSON_PATH_ALLOWLIST = [
  /^\$schema$/,
  /^name$/,
  /^version$/,
  /^description$/,
  /^upstream\.repo$/,
  /^upstream\.url$/,
  /^modules$/,
  /^modules\.[a-z0-9-]+$/,
  /^modules\.[a-z0-9-]+\[\d+\]$/,
  /^file$/,
  /^replacements$/,
  /^replacements\..+$/,
  /^copyFiles$/,
  /^copyFiles\[\d+\]$/,
  /^copyFiles\[\d+\]\.source$/,
  /^copyFiles\[\d+\]\.target$/,
];

const isEngineJsonShape = (node) =>
  Boolean(
    node &&
      typeof node === "object" &&
      !Array.isArray(node) &&
      ("modules" in node || "replacements" in node || "copyFiles" in node || "file" in node),
  );

const isBannedText = (value) => {
  const lowered = String(value || "").toLowerCase();
  return BANNED_KEYWORDS.some((keyword) => lowered.includes(keyword));
};

const stripExternal = (value, stats) => {
  const before = String(value ?? "");
  let linkCount = 0;
  const afterUrl = before.replace(URL_PATTERN, () => {
    linkCount += 1;
    return "";
  });
  if (linkCount > 0) {
    stats.removedLinksCount += linkCount;
  }

  const compacted = afterUrl
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return compacted;
};

const isAllowedEnginePath = (pathKey) => ENGINE_JSON_PATH_ALLOWLIST.some((pattern) => pattern.test(pathKey));

const sanitizePathKey = (rawPath) => rawPath.replace(/^\./, "");

const pruneEngineJsonByPath = (node, stats, pathKey = "") => {
  if (Array.isArray(node)) {
    const kept = [];
    node.forEach((item, idx) => {
      const childPath = sanitizePathKey(`${pathKey}[${idx}]`);
      if (!isAllowedEnginePath(childPath)) {
        stats.removedPaths += 1;
        return;
      }
      const next = pruneEngineJsonByPath(item, stats, childPath);
      if (next !== undefined) {
        kept.push(next);
      }
    });
    return kept;
  }

  if (!node || typeof node !== "object") {
    return node;
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const childPath = sanitizePathKey(pathKey ? `${pathKey}.${key}` : key);
    if (!isAllowedEnginePath(childPath)) {
      stats.removedPaths += 1;
      continue;
    }
    const next = pruneEngineJsonByPath(value, stats, childPath);
    if (next !== undefined) {
      out[key] = next;
    }
  }
  return out;
};

const sanitizeJsonNode = (node, stats, ctx = { inReplacements: false }) => {
  if (typeof node === "string") {
    if (isBannedText(node)) {
      stats.removedStrings += 1;
      return "";
    }
    return stripExternal(node, stats);
  }
  if (Array.isArray(node)) {
    return node
      .map((item) => sanitizeJsonNode(item, stats, ctx))
      .filter((item) => item !== undefined && item !== null);
  }
  if (!node || typeof node !== "object") {
    return node;
  }

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const inReplacements = ctx.inReplacements || key === "replacements";

    if (inReplacements && !key.startsWith("__comment")) {
      const merged = `${key}\n${typeof value === "string" ? value : JSON.stringify(value)}`;
      if (isBannedText(merged)) {
        stats.removedEntries += 1;
        continue;
      }
    }

    const nextValue = sanitizeJsonNode(value, stats, { inReplacements });

    if (inReplacements && !key.startsWith("__comment") && typeof nextValue === "string" && nextValue.length === 0) {
      stats.removedEntries += 1;
      continue;
    }

    out[key] = nextValue;
  }
  return out;
};

const sanitizeTextFile = (content, stats) => {
  const lines = content.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    if (isBannedText(line)) {
      stats.removedLines += 1;
      continue;
    }
    const cleaned = stripExternal(line, stats);
    kept.push(cleaned);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
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

export const sanitizeOpenClawZh = async ({ rootDir, dryRun = false }) => {
  const translationsDir = path.join(rootDir, "translations");
  const files = await walkFiles(translationsDir);
  const stats = {
    filesScanned: files.length,
    filesChanged: 0,
    removedLinksCount: 0,
    removedEntries: 0,
    removedLines: 0,
    removedPaths: 0,
    removedStrings: 0,
  };

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const ext = path.extname(file).toLowerCase();
    let next = raw;

    if (ext === ".json") {
      const parsed = JSON.parse(raw);
      const restricted = isEngineJsonShape(parsed) ? pruneEngineJsonByPath(parsed, stats) : parsed;
      const cleaned = sanitizeJsonNode(restricted, stats);
      next = `${JSON.stringify(cleaned, null, 2)}\n`;
    } else {
      next = sanitizeTextFile(raw, stats);
      if (!next.endsWith("\n")) {
        next += "\n";
      }
    }

    if (next !== raw) {
      stats.filesChanged += 1;
      if (!dryRun) {
        await fs.writeFile(file, next, "utf8");
      }
    }
  }

  return stats;
};

const run = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const rootArg = args.find((a) => a.startsWith("--root="));
  const rootDir = rootArg
    ? path.resolve(rootArg.slice("--root=".length))
    : path.resolve(process.cwd(), "localization/openclaw-zh");

  const stats = await sanitizeOpenClawZh({ rootDir, dryRun });
  console.log(JSON.stringify({ rootDir, ...stats }, null, 2));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}
