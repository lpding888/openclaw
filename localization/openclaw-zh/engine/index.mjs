#!/usr/bin/env node
import { applyCommand } from "./commands/apply.mjs";
import { restoreCommand } from "./commands/restore.mjs";
import { statusCommand } from "./commands/status.mjs";
import { log } from "./utils/logger.mjs";

const printHelp = () => {
  console.log(`openclaw zh engine\n\nusage:\n  node localization/openclaw-zh/engine/index.mjs <command> [options]\n\ncommands:\n  status [--target=/path]\n  apply --target=/path [--dry-run] [--verbose]\n  verify --target=/path [--verbose]\n  restore --target=/path\n`);
};

const run = async () => {
  const args = process.argv.slice(2);
  const command = args[0];
  const tail = args.slice(1);

  switch (command) {
    case "status":
      await statusCommand(tail);
      return;
    case "apply":
      await applyCommand(tail);
      return;
    case "verify":
      await applyCommand(["--verify", ...tail]);
      return;
    case "restore":
      await restoreCommand(tail);
      return;
    case "help":
    case "-h":
    case "--help":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

run().catch((error) => {
  log.error(error.message || String(error));
  process.exit(1);
});
