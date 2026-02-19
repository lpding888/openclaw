import { CONFIG_PATH, readConfigFileSnapshot } from "../config/config.js";
import { startGatewayConfigReloader } from "./config-reload.js";
import { createGatewayReloadHandlers } from "./server-reload-handlers.js";

type ReloadLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export function createGatewayConfigReloaderRuntime(params: {
  minimalTestGateway: boolean;
  initialConfig: ReturnType<typeof import("../config/config.js").loadConfig>;
  reloadHandlersParams: Parameters<typeof createGatewayReloadHandlers>[0];
  logReload: ReloadLogger;
}) {
  const { minimalTestGateway, initialConfig, reloadHandlersParams, logReload } = params;
  if (minimalTestGateway) {
    return { stop: async () => {} };
  }

  const { applyHotReload, requestGatewayRestart } =
    createGatewayReloadHandlers(reloadHandlersParams);
  return startGatewayConfigReloader({
    initialConfig,
    readSnapshot: readConfigFileSnapshot,
    onHotReload: applyHotReload,
    onRestart: requestGatewayRestart,
    log: {
      info: (msg) => logReload.info(msg),
      warn: (msg) => logReload.warn(msg),
      error: (msg) => logReload.error(msg),
    },
    watchPath: CONFIG_PATH,
  });
}
