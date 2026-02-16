import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "../..");
export const TRANSLATIONS_DIR = path.join(ROOT_DIR, "translations");

const PARTIAL_SAFE_CONFIG_FILES = [
  /^dashboard\/schema(?:-core)?\.json$/,
  /^dashboard\/config-form-(?:node|render|shared)\.json$/,
];

export const isPartialSafeFile = (configFile = "") =>
  PARTIAL_SAFE_CONFIG_FILES.some((pattern) => pattern.test(configFile));

const assertPathWithin = (baseDir, candidatePath, label) => {
  const normalizedBase = path.resolve(baseDir);
  const normalizedPath = path.resolve(candidatePath);
  if (normalizedPath === normalizedBase) {
    return normalizedPath;
  }
  if (!normalizedPath.startsWith(`${normalizedBase}${path.sep}`)) {
    throw new Error(`${label} escapes base directory: ${candidatePath}`);
  }
  return normalizedPath;
};

export const resolveTargetDir = async (targetArg) => {
  if (!targetArg) {
    throw new Error("Missing required --target=/absolute/or/relative/path");
  }
  const targetDir = path.resolve(targetArg);
  const stat = await fs.stat(targetDir).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Target directory does not exist: ${targetDir}`);
  }
  const pkgPath = path.join(targetDir, "package.json");
  const pkgStat = await fs.stat(pkgPath).catch(() => null);
  if (!pkgStat || !pkgStat.isFile()) {
    throw new Error(`Target directory does not look like a repo root: ${targetDir}`);
  }
  return targetDir;
};

export const loadMainConfig = async () => {
  const configPath = path.join(TRANSLATIONS_DIR, "config.json");
  const content = await fs.readFile(configPath, "utf8");
  return JSON.parse(content);
};

export const loadAllTranslations = async (mainConfig, verbose = false) => {
  const translations = [];
  for (const [category, files] of Object.entries(mainConfig.modules || {})) {
    for (const configFile of files) {
      const fullPath = path.join(TRANSLATIONS_DIR, configFile);
      try {
        const raw = await fs.readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw);
        translations.push({
          ...parsed,
          category,
          configFile,
        });
        if (verbose) {
          log.dim(`loaded ${configFile}`);
        }
      } catch (error) {
        log.warn(`failed to load ${configFile}: ${error.message}`);
      }
    }
  }
  return translations;
};

export const applyCopyFiles = async (copyConfig, targetDir, options = {}) => {
  const { dryRun = false, verify = false, verbose = false } = options;
  const items = Array.isArray(copyConfig.copyFiles) ? copyConfig.copyFiles : [];
  const stats = {
    file: copyConfig.configFile || copyConfig.description || "copyFiles",
    configFile: copyConfig.configFile || "",
    description: copyConfig.description || "",
    total: items.length,
    applied: 0,
    skipped: 0,
    notFound: 0,
    warnings: 0,
  };

  for (const item of items) {
    const sourcePath = assertPathWithin(
      TRANSLATIONS_DIR,
      path.join(TRANSLATIONS_DIR, item.source),
      "source",
    );
    const targetPath = assertPathWithin(targetDir, path.join(targetDir, item.target), "target");

    const sourceContent = await fs.readFile(sourcePath, "utf8").catch(() => null);
    if (sourceContent == null) {
      stats.notFound += 1;
      continue;
    }

    const existingContent = await fs.readFile(targetPath, "utf8").catch(() => null);
    if (existingContent === sourceContent) {
      stats.skipped += 1;
      continue;
    }

    if (!dryRun && !verify) {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, sourceContent, "utf8");
    }

    if (verbose) {
      log.dim(`copy ${item.source} -> ${item.target}`);
    }
    stats.applied += 1;
  }

  return stats;
};

export const applyTranslation = async (translation, targetDir, options = {}) => {
  const { dryRun = false, verify = false, verbose = false } = options;
  const replacements =
    translation.replacements && typeof translation.replacements === "object"
      ? translation.replacements
      : {};
  const targetPath = assertPathWithin(
    targetDir,
    path.join(targetDir, translation.file || ""),
    "translation target",
  );

  const stats = {
    file: translation.file || translation.configFile || "unknown",
    configFile: translation.configFile || "",
    description: translation.description || "",
    total: Object.keys(replacements).filter((k) => !k.startsWith("__comment")).length,
    applied: 0,
    skipped: 0,
    notFound: 0,
    warnings: 0,
  };

  const originalContent = await fs.readFile(targetPath, "utf8").catch(() => null);
  if (originalContent == null) {
    stats.notFound = stats.total;
    return stats;
  }

  let nextContent = originalContent;
  for (const [from, to] of Object.entries(replacements)) {
    if (from.startsWith("__comment")) {
      continue;
    }
    if (nextContent.includes(to)) {
      stats.skipped += 1;
      continue;
    }
    if (nextContent.includes(from)) {
      nextContent = nextContent.replaceAll(from, to);
      stats.applied += 1;
      continue;
    }
    stats.notFound += 1;
    if (verbose) {
      log.dim(`not found ${translation.configFile}: ${from.slice(0, 70)}`);
    }
  }

  if (stats.notFound > 0 && isPartialSafeFile(translation.configFile)) {
    stats.warnings += 1;
    if (verbose) {
      log.warn(`partial-safe misses in ${translation.configFile}: ${stats.notFound}`);
    }
  }

  if (!dryRun && !verify && stats.applied > 0) {
    await fs.writeFile(targetPath, nextContent, "utf8");
  }

  return stats;
};

export const printStats = (allStats, options = {}) => {
  const { dryRun = false, verify = false } = options;
  let applied = 0;
  let skipped = 0;
  let notFound = 0;
  let warnings = 0;

  for (const s of allStats) {
    applied += s.applied;
    skipped += s.skipped;
    notFound += s.notFound;
    warnings += s.warnings || 0;
  }

  log.title("zh translation summary");
  console.log(`applied=${applied} skipped=${skipped} notFound=${notFound} warnings=${warnings}`);
  if (dryRun) {
    log.info("dry-run mode: no files changed");
  }
  if (verify) {
    log.info("verify mode: no files changed");
  }

  return { applied, skipped, notFound, warnings };
};
