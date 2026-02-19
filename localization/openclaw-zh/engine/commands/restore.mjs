import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadAllTranslations, loadMainConfig, resolveTargetDir } from "../utils/i18n-engine.mjs";
import { log } from "../utils/logger.mjs";

const execFileAsync = promisify(execFile);

const getFlagValue = (args, prefix) => {
  const hit = args.find((arg) => arg.startsWith(prefix));
  if (!hit) {
    return "";
  }
  return hit.slice(prefix.length);
};

export const restoreCommand = async (args) => {
  const targetArg = getFlagValue(args, "--target=");
  const targetDir = await resolveTargetDir(targetArg);

  log.title("openclaw zh restore");
  log.info(`target=${targetDir}`);

  await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: targetDir });

  const cfg = await loadMainConfig();
  const items = await loadAllTranslations(cfg);
  const targetFiles = new Set();
  for (const item of items) {
    if (item.file) {
      targetFiles.add(item.file);
    }
    if (Array.isArray(item.copyFiles)) {
      for (const cp of item.copyFiles) {
        if (cp.target) {
          targetFiles.add(cp.target);
        }
      }
    }
  }

  const existing = [];
  for (const f of targetFiles) {
    const out = await execFileAsync("git", ["ls-files", "--error-unmatch", f], {
      cwd: targetDir,
    }).then(
      () => true,
      () => false,
    );
    if (out) {
      existing.push(f);
    }
  }

  if (existing.length === 0) {
    log.info("no tracked translation targets to restore");
    return;
  }

  await execFileAsync("git", ["checkout", "--", ...existing], { cwd: targetDir });
  log.success(`restored ${existing.length} tracked files`);
};
