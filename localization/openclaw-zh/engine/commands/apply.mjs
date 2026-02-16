import {
  applyCopyFiles,
  applyTranslation,
  loadAllTranslations,
  loadMainConfig,
  printStats,
  resolveTargetDir,
} from "../utils/i18n-engine.mjs";
import { log } from "../utils/logger.mjs";

const getFlagValue = (args, prefix) => {
  const hit = args.find((arg) => arg.startsWith(prefix));
  if (!hit) {
    return "";
  }
  return hit.slice(prefix.length);
};

export const applyCommand = async (args) => {
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose") || args.includes("-v");
  const verify = args.includes("--verify");
  const targetArg = getFlagValue(args, "--target=");
  const targetDir = await resolveTargetDir(targetArg);

  log.title("openclaw zh apply");
  log.info(`target=${targetDir}`);
  log.info(`mode=${verify ? "verify" : dryRun ? "dry-run" : "apply"}`);

  const config = await loadMainConfig();
  const translations = await loadAllTranslations(config, verbose);

  const stats = [];
  for (const item of translations) {
    if (item.copyFiles) {
      stats.push(await applyCopyFiles(item, targetDir, { dryRun, verify, verbose }));
    } else if (item.replacements) {
      stats.push(await applyTranslation(item, targetDir, { dryRun, verify, verbose }));
    }
  }

  return printStats(stats, { dryRun, verify });
};
