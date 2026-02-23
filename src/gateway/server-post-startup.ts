import type { loadConfig } from "../config/config.js";
import { scheduleGatewayUpdateCheck } from "../infra/update-startup.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import type { startBrowserControlServerIfEnabled } from "./server-browser.js";
import { createGatewayConfigReloaderRuntime } from "./server-config-reloader-runtime.js";
import { logGatewayStartup } from "./server-startup-log.js";
import { startGatewaySidecars } from "./server-startup.js";
import { startGatewayTailscaleExposure } from "./server-tailscale.js";

type GatewayPostStartupLog = Parameters<typeof logGatewayStartup>[0]["log"] &
  Parameters<typeof scheduleGatewayUpdateCheck>[0]["log"] &
  Parameters<typeof startGatewaySidecars>[0]["log"];

export async function startGatewayPostStartup(params: {
  minimalTestGateway: boolean;
  startupLogParams: Parameters<typeof logGatewayStartup>[0];
  updateCheckParams: Parameters<typeof scheduleGatewayUpdateCheck>[0];
  tailscaleParams: Parameters<typeof startGatewayTailscaleExposure>[0];
  sidecarParams: Parameters<typeof startGatewaySidecars>[0];
  gatewayStartHookPort: number;
  gatewayLogger: { warn: (message: string) => void };
  configReloaderParams: Parameters<typeof createGatewayConfigReloaderRuntime>[0];
}) {
  const {
    minimalTestGateway,
    startupLogParams,
    updateCheckParams,
    tailscaleParams,
    sidecarParams,
    gatewayStartHookPort,
    gatewayLogger,
    configReloaderParams,
  } = params;

  logGatewayStartup(startupLogParams);
  if (!minimalTestGateway) {
    scheduleGatewayUpdateCheck(updateCheckParams);
  }

  const tailscaleCleanup = minimalTestGateway
    ? null
    : await startGatewayTailscaleExposure(tailscaleParams);

  let browserControl: Awaited<ReturnType<typeof startBrowserControlServerIfEnabled>> = null;
  let pluginServices: PluginServicesHandle | null = null;
  if (!minimalTestGateway) {
    ({ browserControl, pluginServices } = await startGatewaySidecars(sidecarParams));
  }

  // Run gateway_start plugin hook (fire-and-forget).
  if (!minimalTestGateway) {
    const hookRunner = getGlobalHookRunner();
    if (hookRunner?.hasHooks("gateway_start")) {
      void hookRunner
        .runGatewayStart({ port: gatewayStartHookPort }, { port: gatewayStartHookPort })
        .catch((err) => {
          gatewayLogger.warn(`gateway_start hook failed: ${String(err)}`);
        });
    }
  }

  const configReloader = createGatewayConfigReloaderRuntime(configReloaderParams);
  return { tailscaleCleanup, browserControl, pluginServices, configReloader };
}

export async function startGatewayPostStartupWithDefaults(params: {
  minimalTestGateway: boolean;
  cfgAtStart: ReturnType<typeof loadConfig>;
  bindHost: Parameters<typeof logGatewayStartup>[0]["bindHost"];
  httpBindHosts: Parameters<typeof logGatewayStartup>[0]["bindHosts"];
  port: number;
  tlsEnabled: Parameters<typeof logGatewayStartup>[0]["tlsEnabled"];
  isNixMode: Parameters<typeof logGatewayStartup>[0]["isNixMode"];
  tailscaleMode: Parameters<typeof startGatewayTailscaleExposure>[0]["tailscaleMode"];
  tailscaleResetOnExit: Parameters<typeof startGatewayTailscaleExposure>[0]["resetOnExit"];
  controlUiBasePath: Parameters<typeof startGatewayTailscaleExposure>[0]["controlUiBasePath"];
  logTailscale: Parameters<typeof startGatewayTailscaleExposure>[0]["logTailscale"];
  pluginRegistry: Parameters<typeof startGatewaySidecars>[0]["pluginRegistry"];
  defaultWorkspaceDir: Parameters<typeof startGatewaySidecars>[0]["defaultWorkspaceDir"];
  deps: Parameters<typeof startGatewaySidecars>[0]["deps"];
  startChannels: Parameters<typeof startGatewaySidecars>[0]["startChannels"];
  log: GatewayPostStartupLog;
  logHooks: Parameters<typeof startGatewaySidecars>[0]["logHooks"];
  logChannels: Parameters<typeof startGatewaySidecars>[0]["logChannels"];
  logBrowser: Parameters<typeof startGatewaySidecars>[0]["logBrowser"];
  reloadHandlersParams: Parameters<
    typeof createGatewayConfigReloaderRuntime
  >[0]["reloadHandlersParams"];
  logReload: Parameters<typeof createGatewayConfigReloaderRuntime>[0]["logReload"];
}) {
  return await startGatewayPostStartup({
    minimalTestGateway: params.minimalTestGateway,
    startupLogParams: {
      cfg: params.cfgAtStart,
      bindHost: params.bindHost,
      bindHosts: params.httpBindHosts,
      port: params.port,
      tlsEnabled: params.tlsEnabled,
      log: params.log,
      isNixMode: params.isNixMode,
    },
    updateCheckParams: { cfg: params.cfgAtStart, log: params.log, isNixMode: params.isNixMode },
    tailscaleParams: {
      tailscaleMode: params.tailscaleMode,
      resetOnExit: params.tailscaleResetOnExit,
      port: params.port,
      controlUiBasePath: params.controlUiBasePath,
      logTailscale: params.logTailscale,
    },
    sidecarParams: {
      cfg: params.cfgAtStart,
      pluginRegistry: params.pluginRegistry,
      defaultWorkspaceDir: params.defaultWorkspaceDir,
      deps: params.deps,
      startChannels: params.startChannels,
      log: params.log,
      logHooks: params.logHooks,
      logChannels: params.logChannels,
      logBrowser: params.logBrowser,
    },
    gatewayStartHookPort: params.port,
    gatewayLogger: params.log,
    configReloaderParams: {
      minimalTestGateway: params.minimalTestGateway,
      initialConfig: params.cfgAtStart,
      reloadHandlersParams: params.reloadHandlersParams,
      logReload: params.logReload,
    },
  });
}

export async function startGatewayPostStartupWithRuntimeState(params: {
  minimalTestGateway: boolean;
  cfgAtStart: ReturnType<typeof loadConfig>;
  bindHost: Parameters<typeof logGatewayStartup>[0]["bindHost"];
  httpBindHosts: Parameters<typeof logGatewayStartup>[0]["bindHosts"];
  port: number;
  tlsEnabled: Parameters<typeof logGatewayStartup>[0]["tlsEnabled"];
  isNixMode: Parameters<typeof logGatewayStartup>[0]["isNixMode"];
  tailscaleMode: Parameters<typeof startGatewayTailscaleExposure>[0]["tailscaleMode"];
  tailscaleResetOnExit: Parameters<typeof startGatewayTailscaleExposure>[0]["resetOnExit"];
  controlUiBasePath: Parameters<typeof startGatewayTailscaleExposure>[0]["controlUiBasePath"];
  logTailscale: Parameters<typeof startGatewayTailscaleExposure>[0]["logTailscale"];
  pluginRegistry: Parameters<typeof startGatewaySidecars>[0]["pluginRegistry"];
  defaultWorkspaceDir: Parameters<typeof startGatewaySidecars>[0]["defaultWorkspaceDir"];
  deps: Parameters<typeof startGatewaySidecars>[0]["deps"];
  startChannels: Parameters<typeof startGatewaySidecars>[0]["startChannels"];
  log: GatewayPostStartupLog;
  logHooks: Parameters<typeof startGatewaySidecars>[0]["logHooks"];
  logChannels: Parameters<typeof startGatewaySidecars>[0]["logChannels"];
  logBrowser: Parameters<typeof startGatewaySidecars>[0]["logBrowser"];
  reloadLog: Parameters<typeof createGatewayConfigReloaderRuntime>[0]["logReload"];
  reloadStateGet: Parameters<
    typeof createGatewayConfigReloaderRuntime
  >[0]["reloadHandlersParams"]["getState"];
  reloadStateSet: Parameters<
    typeof createGatewayConfigReloaderRuntime
  >[0]["reloadHandlersParams"]["setState"];
  reloadBroadcast: Parameters<
    typeof createGatewayConfigReloaderRuntime
  >[0]["reloadHandlersParams"]["broadcast"];
  startChannel: Parameters<
    typeof createGatewayConfigReloaderRuntime
  >[0]["reloadHandlersParams"]["startChannel"];
  stopChannel: Parameters<
    typeof createGatewayConfigReloaderRuntime
  >[0]["reloadHandlersParams"]["stopChannel"];
  logCron: Parameters<
    typeof createGatewayConfigReloaderRuntime
  >[0]["reloadHandlersParams"]["logCron"];
}) {
  return await startGatewayPostStartupWithDefaults({
    minimalTestGateway: params.minimalTestGateway,
    cfgAtStart: params.cfgAtStart,
    bindHost: params.bindHost,
    httpBindHosts: params.httpBindHosts,
    port: params.port,
    tlsEnabled: params.tlsEnabled,
    isNixMode: params.isNixMode,
    tailscaleMode: params.tailscaleMode,
    tailscaleResetOnExit: params.tailscaleResetOnExit,
    controlUiBasePath: params.controlUiBasePath,
    logTailscale: params.logTailscale,
    pluginRegistry: params.pluginRegistry,
    defaultWorkspaceDir: params.defaultWorkspaceDir,
    deps: params.deps,
    startChannels: params.startChannels,
    log: params.log,
    logHooks: params.logHooks,
    logChannels: params.logChannels,
    logBrowser: params.logBrowser,
    reloadHandlersParams: {
      deps: params.deps,
      broadcast: params.reloadBroadcast,
      getState: params.reloadStateGet,
      setState: params.reloadStateSet,
      startChannel: params.startChannel,
      stopChannel: params.stopChannel,
      logHooks: params.logHooks,
      logBrowser: params.logBrowser,
      logChannels: params.logChannels,
      logCron: params.logCron,
      logReload: params.reloadLog,
    },
    logReload: params.reloadLog,
  });
}
