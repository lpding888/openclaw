import fs from "node:fs/promises";
import path from "node:path";
import { loadMainConfig, resolveTargetDir, ROOT_DIR } from "../utils/i18n-engine.mjs";
import { log } from "../utils/logger.mjs";

const getFlagValue = (args, prefix) => {
  const hit = args.find((arg) => arg.startsWith(prefix));
  if (!hit) {
    return "";
  }
  return hit.slice(prefix.length);
};

export const statusCommand = async (args) => {
  const targetArg = getFlagValue(args, "--target=");
  const targetDir = targetArg ? await resolveTargetDir(targetArg) : process.cwd();
  const config = await loadMainConfig();

  let moduleCount = 0;
  let fileCount = 0;
  for (const files of Object.values(config.modules || {})) {
    moduleCount += 1;
    fileCount += Array.isArray(files) ? files.length : 0;
  }

  log.title("openclaw zh status");
  log.info(`engineRoot=${ROOT_DIR}`);
  log.info(`target=${targetDir}`);
  log.info(`moduleCount=${moduleCount}`);
  log.info(`translationFiles=${fileCount}`);

  const syncMetaPath = path.join(ROOT_DIR, "sync-source.json");
  const syncMeta = await fs.readFile(syncMetaPath, "utf8").then((s) => JSON.parse(s)).catch(() => null);
  if (syncMeta) {
    log.info(`sourceRepo=${syncMeta.sourceRepo}`);
    log.info(`sourceCommit=${syncMeta.sourceCommit}`);
    log.info(`syncedAt=${syncMeta.syncedAt}`);
    log.info(`removedLinksCount=${syncMeta.removedLinksCount}`);
  } else {
    log.warn("sync-source.json not found");
  }
};
