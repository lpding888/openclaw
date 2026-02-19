import type { CanvasHostServer } from "../canvas-host/server.js";
import type { PluginServicesHandle } from "../plugins/services.js";
import type { RuntimeEnv } from "../runtime.js";
import type { ControlUiRootState } from "./control-ui.js";
import type { startBrowserControlServerIfEnabled } from "./server-browser.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { getActiveEmbeddedRunCount } from "../agents/pi-embedded-runner/runs.js";
import { initSubagentRegistry } from "../agents/subagent-registry.js";
import { getTotalPendingReplies } from "../auto-reply/reply/dispatcher-registry.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { createDefaultDeps } from "../cli/deps.js";
import { isNixMode, loadConfig } from "../config/config.js";
import { isDiagnosticsEnabled } from "../infra/diagnostic-events.js";
import { logAcceptedEnvOption } from "../infra/env.js";
import { createExecApprovalForwarder } from "../infra/exec-approval-forwarder.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import { ensureOpenClawCliOnPath } from "../infra/path-env.js";
import { setGatewaySigusr1RestartPolicy, setPreRestartDeferralCheck } from "../infra/restart.js";
import { startDiagnosticHeartbeat } from "../logging/diagnostic.js";
import { createSubsystemLogger, runtimeForLogger } from "../logging/subsystem.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { getTotalQueueSize } from "../process/command-queue.js";
import { runOnboardingWizard } from "../wizard/onboarding.js";
import { createAuthRateLimiter, type AuthRateLimiter } from "./auth-rate-limit.js";
import { ExecApprovalManager } from "./exec-approval-manager.js";
import { NodeRegistry } from "./node-registry.js";
import { createChannelManager } from "./server-channels.js";
import { buildGatewayCronService } from "./server-cron.js";
import { setupGatewayDiscoveryAndSkillsRegistry } from "./server-discovery-setup.js";
import { applyGatewayLaneConcurrency } from "./server-lanes.js";
import { listGatewayMethods } from "./server-methods-list.js";
import { coreGatewayHandlers } from "./server-methods.js";
import { createExecApprovalHandlers } from "./server-methods/exec-approval.js";
import { hasConnectedMobileNode } from "./server-mobile-nodes.js";
import { loadGatewayModelCatalog } from "./server-model-catalog.js";
import { createGatewayNodeRuntime } from "./server-node-runtime.js";
import { loadGatewayPlugins } from "./server-plugins.js";
import { startGatewayPostStartupWithRuntimeState } from "./server-post-startup.js";
import { createGatewayServerRuntime } from "./server-runtime-close.js";
import { resolveGatewayRuntimeConfig } from "./server-runtime-config.js";
import { createGatewayRuntimeState } from "./server-runtime-state.js";
import { startGatewayRuntimeWatchers } from "./server-runtime-watchers.js";
import { resolveSessionKeyForRun } from "./server-session-key.js";
import { createGatewaySkillsRefreshController } from "./server-skills-refresh.js";
import {
  prepareGatewayStartupConfig,
  resolveGatewayControlUiRootState,
} from "./server-startup-config.js";
import { createWizardSessionTracker } from "./server-wizard-sessions.js";
import { attachGatewayWsBootstrap } from "./server-ws-bootstrap.js";
import {
  getHealthCache,
  getHealthVersion,
  getPresenceVersion,
  incrementPresenceVersion,
  refreshGatewayHealthSnapshot,
} from "./server/health-state.js";
import { loadGatewayTlsRuntime } from "./server/tls.js";

export { __resetModelCatalogCacheForTest } from "./server-model-catalog.js";

ensureOpenClawCliOnPath();

const log = createSubsystemLogger("gateway");
const logCanvas = log.child("canvas");
const logDiscovery = log.child("discovery");
const logTailscale = log.child("tailscale");
const logChannels = log.child("channels");
const logBrowser = log.child("browser");
const logHealth = log.child("health");
const logCron = log.child("cron");
const logReload = log.child("reload");
const logHooks = log.child("hooks");
const logPlugins = log.child("plugins");
const logWsControl = log.child("ws");
const gatewayRuntime = runtimeForLogger(log);
const canvasRuntime = runtimeForLogger(logCanvas);

export type GatewayServer = {
  close: (opts?: { reason?: string; restartExpectedMs?: number | null }) => Promise<void>;
};

export type GatewayServerOptions = {
  /**
   * Bind address policy for the Gateway WebSocket/HTTP server.
   * - loopback: 127.0.0.1
   * - lan: 0.0.0.0
   * - tailnet: bind only to the Tailscale IPv4 address (100.64.0.0/10)
   * - auto: prefer loopback, else LAN
   */
  bind?: import("../config/config.js").GatewayBindMode;
  /**
   * Advanced override for the bind host, bypassing bind resolution.
   * Prefer `bind` unless you really need a specific address.
   */
  host?: string;
  /**
   * If false, do not serve the browser Control UI.
   * Default: config `gateway.controlUi.enabled` (or true when absent).
   */
  controlUiEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/chat/completions`.
   * Default: config `gateway.http.endpoints.chatCompletions.enabled` (or false when absent).
   */
  openAiChatCompletionsEnabled?: boolean;
  /**
   * If false, do not serve `POST /v1/responses` (OpenResponses API).
   * Default: config `gateway.http.endpoints.responses.enabled` (or false when absent).
   */
  openResponsesEnabled?: boolean;
  /**
   * Override gateway auth configuration (merges with config).
   */
  auth?: import("../config/config.js").GatewayAuthConfig;
  /**
   * Override gateway Tailscale exposure configuration (merges with config).
   */
  tailscale?: import("../config/config.js").GatewayTailscaleConfig;
  /**
   * Test-only: allow canvas host startup even when NODE_ENV/VITEST would disable it.
   */
  allowCanvasHostInTests?: boolean;
  /**
   * Test-only: override the onboarding wizard runner.
   */
  wizardRunner?: (
    opts: import("../commands/onboard-types.js").OnboardOptions,
    runtime: import("../runtime.js").RuntimeEnv,
    prompter: import("../wizard/prompts.js").WizardPrompter,
  ) => Promise<void>;
};

export async function startGatewayServer(
  port = 18789,
  opts: GatewayServerOptions = {},
): Promise<GatewayServer> {
  const minimalTestGateway =
    process.env.VITEST === "1" && process.env.OPENCLAW_TEST_MINIMAL_GATEWAY === "1";

  // Ensure all default port derivations (browser/canvas) see the actual runtime port.
  process.env.OPENCLAW_GATEWAY_PORT = String(port);
  logAcceptedEnvOption({
    key: "OPENCLAW_RAW_STREAM",
    description: "raw stream logging enabled",
  });
  logAcceptedEnvOption({
    key: "OPENCLAW_RAW_STREAM_PATH",
    description: "raw stream log path override",
  });

  const cfgAtStart = await prepareGatewayStartupConfig(log);
  const diagnosticsEnabled = isDiagnosticsEnabled(cfgAtStart);
  if (diagnosticsEnabled) {
    startDiagnosticHeartbeat();
  }
  setGatewaySigusr1RestartPolicy({ allowExternal: cfgAtStart.commands?.restart === true });
  setPreRestartDeferralCheck(
    () => getTotalQueueSize() + getTotalPendingReplies() + getActiveEmbeddedRunCount(),
  );
  initSubagentRegistry();
  const defaultAgentId = resolveDefaultAgentId(cfgAtStart);
  const defaultWorkspaceDir = resolveAgentWorkspaceDir(cfgAtStart, defaultAgentId);
  const baseMethods = listGatewayMethods();
  const emptyPluginRegistry = createEmptyPluginRegistry();
  const { pluginRegistry, gatewayMethods: baseGatewayMethods } = minimalTestGateway
    ? { pluginRegistry: emptyPluginRegistry, gatewayMethods: baseMethods }
    : loadGatewayPlugins({
        cfg: cfgAtStart,
        workspaceDir: defaultWorkspaceDir,
        log,
        coreGatewayHandlers,
        baseMethods,
      });
  const channelLogs = Object.fromEntries(
    listChannelPlugins().map((plugin) => [plugin.id, logChannels.child(plugin.id)]),
  ) as Record<ChannelId, ReturnType<typeof createSubsystemLogger>>;
  const channelRuntimeEnvs = Object.fromEntries(
    Object.entries(channelLogs).map(([id, logger]) => [id, runtimeForLogger(logger)]),
  ) as Record<ChannelId, RuntimeEnv>;
  const channelMethods = listChannelPlugins().flatMap((plugin) => plugin.gatewayMethods ?? []);
  const gatewayMethods = Array.from(new Set([...baseGatewayMethods, ...channelMethods]));
  let pluginServices: PluginServicesHandle | null = null;
  const runtimeConfig = await resolveGatewayRuntimeConfig({
    cfg: cfgAtStart,
    port,
    bind: opts.bind,
    host: opts.host,
    controlUiEnabled: opts.controlUiEnabled,
    openAiChatCompletionsEnabled: opts.openAiChatCompletionsEnabled,
    openResponsesEnabled: opts.openResponsesEnabled,
    auth: opts.auth,
    tailscale: opts.tailscale,
  });
  const {
    bindHost,
    controlUiEnabled,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    controlUiBasePath,
    controlUiRoot: controlUiRootOverride,
    resolvedAuth,
    tailscaleConfig,
    tailscaleMode,
  } = runtimeConfig;
  let hooksConfig = runtimeConfig.hooksConfig;
  const canvasHostEnabled = runtimeConfig.canvasHostEnabled;

  // Create auth rate limiter only when explicitly configured.
  const rateLimitConfig = cfgAtStart.gateway?.auth?.rateLimit;
  const authRateLimiter: AuthRateLimiter | undefined = rateLimitConfig
    ? createAuthRateLimiter(rateLimitConfig)
    : undefined;

  const controlUiRootState: ControlUiRootState | undefined = await resolveGatewayControlUiRootState(
    {
      controlUiRootOverride,
      controlUiEnabled,
      gatewayRuntime,
      log,
    },
  );

  const wizardRunner = opts.wizardRunner ?? runOnboardingWizard;
  const { wizardSessions, findRunningWizard, purgeWizardSession } = createWizardSessionTracker();

  const deps = createDefaultDeps();
  let canvasHostServer: CanvasHostServer | null = null;
  const gatewayTls = await loadGatewayTlsRuntime(cfgAtStart.gateway?.tls, log.child("tls"));
  if (cfgAtStart.gateway?.tls?.enabled && !gatewayTls.enabled) {
    throw new Error(gatewayTls.error ?? "gateway tls: failed to enable");
  }
  const {
    canvasHost,
    httpServer,
    httpServers,
    httpBindHosts,
    wss,
    clients,
    broadcast,
    broadcastToConnIds,
    agentRunSeq,
    dedupe,
    chatRunState,
    chatRunBuffers,
    chatDeltaSentAt,
    addChatRun,
    removeChatRun,
    chatAbortControllers,
    toolEventRecipients,
  } = await createGatewayRuntimeState({
    cfg: cfgAtStart,
    bindHost,
    port,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot: controlUiRootState,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    resolvedAuth,
    rateLimiter: authRateLimiter,
    gatewayTls,
    hooksConfig: () => hooksConfig,
    pluginRegistry,
    deps,
    canvasRuntime,
    canvasHostEnabled,
    allowCanvasHostInTests: opts.allowCanvasHostInTests,
    logCanvas,
    log,
    logHooks,
    logPlugins,
  });
  let bonjourStop: (() => Promise<void>) | null = null;
  const nodeRegistry = new NodeRegistry();
  const nodePresenceTimers = new Map<string, ReturnType<typeof setInterval>>();
  const {
    nodeSendToSession,
    nodeSendToAllSubscribed,
    nodeSubscribe,
    nodeUnsubscribe,
    nodeUnsubscribeAll,
  } = createGatewayNodeRuntime(nodeRegistry);
  const broadcastVoiceWakeChanged = (triggers: string[]) =>
    broadcast("voicewake.changed", { triggers }, { dropIfSlow: true });
  const hasMobileNodeConnected = () => hasConnectedMobileNode(nodeRegistry);
  applyGatewayLaneConcurrency(cfgAtStart);

  let cronState = buildGatewayCronService({
    cfg: cfgAtStart,
    deps,
    broadcast,
  });
  let { cron, storePath: cronStorePath } = cronState;

  const channelManager = createChannelManager({
    loadConfig,
    channelLogs,
    channelRuntimeEnvs,
  });
  const { getRuntimeSnapshot, startChannels, startChannel, stopChannel, markChannelLoggedOut } =
    channelManager;

  const machineDisplayName = minimalTestGateway ? "" : await getMachineDisplayName();
  ({ bonjourStop } = await setupGatewayDiscoveryAndSkillsRegistry({
    minimalTestGateway,
    nodeRegistry,
    machineDisplayName,
    port,
    tlsFingerprintSha256: gatewayTls.enabled ? gatewayTls.fingerprintSha256 : undefined,
    wideAreaDiscoveryEnabled: cfgAtStart.discovery?.wideArea?.enabled === true,
    wideAreaDiscoveryDomain: cfgAtStart.discovery?.wideArea?.domain,
    tailscaleMode,
    mdnsMode: cfgAtStart.discovery?.mdns?.mode,
    logDiscovery,
  }));

  const skillsRefreshController = createGatewaySkillsRefreshController({
    minimalTestGateway,
    delayMs: 30_000,
  });

  let { tickInterval, healthInterval, dedupeCleanup, agentUnsub, heartbeatUnsub, heartbeatRunner } =
    await startGatewayRuntimeWatchers({
      minimalTestGateway,
      cfgAtStart,
      cron,
      log,
      logCron,
      maintenanceParams: {
        broadcast,
        nodeSendToAllSubscribed,
        getPresenceVersion,
        getHealthVersion,
        refreshGatewayHealthSnapshot,
        logHealth,
        dedupe,
        chatAbortControllers,
        chatRunState,
        chatRunBuffers,
        chatDeltaSentAt,
        removeChatRun,
        agentRunSeq,
        nodeSendToSession,
      },
      agentEventParams: {
        broadcast,
        broadcastToConnIds,
        nodeSendToSession,
        agentRunSeq,
        chatRunState,
        resolveSessionKeyForRun,
        toolEventRecipients,
      },
      broadcastHeartbeat: (evt) => {
        broadcast("heartbeat", evt, { dropIfSlow: true });
      },
    });

  const execApprovalManager = new ExecApprovalManager();
  const execApprovalForwarder = createExecApprovalForwarder();
  const execApprovalHandlers = createExecApprovalHandlers(execApprovalManager, {
    forwarder: execApprovalForwarder,
  });

  attachGatewayWsBootstrap({
    wss,
    clients,
    port,
    bindHost: bindHost ?? undefined,
    canvasHostEnabled: Boolean(canvasHost),
    canvasHostServerPort: (canvasHostServer as CanvasHostServer | null)?.port,
    resolvedAuth,
    authRateLimiter,
    gatewayMethods,
    logGateway: log,
    logHealth,
    logWsControl,
    pluginGatewayHandlers: pluginRegistry.gatewayHandlers,
    execApprovalHandlers,
    broadcast,
    deps,
    cron,
    cronStorePath,
    execApprovalManager,
    loadGatewayModelCatalog,
    getHealthCache,
    refreshHealthSnapshot: refreshGatewayHealthSnapshot,
    incrementPresenceVersion,
    getHealthVersion,
    broadcastToConnIds,
    nodeSendToSession,
    nodeSendToAllSubscribed,
    nodeSubscribe,
    nodeUnsubscribe,
    nodeUnsubscribeAll,
    hasConnectedMobileNode: hasMobileNodeConnected,
    nodeRegistry,
    agentRunSeq,
    chatAbortControllers,
    chatAbortedRuns: chatRunState.abortedRuns,
    chatRunBuffers: chatRunState.buffers,
    chatDeltaSentAt: chatRunState.deltaSentAt,
    addChatRun,
    removeChatRun,
    registerToolEventRecipient: toolEventRecipients.add,
    dedupe,
    wizardSessions,
    findRunningWizard,
    purgeWizardSession,
    getRuntimeSnapshot,
    startChannel,
    stopChannel,
    markChannelLoggedOut,
    wizardRunner,
    broadcastVoiceWakeChanged,
  });
  let browserControl: Awaited<ReturnType<typeof startBrowserControlServerIfEnabled>> = null;
  const {
    tailscaleCleanup,
    browserControl: nextBrowserControl,
    pluginServices: nextPluginServices,
    configReloader,
  } = await startGatewayPostStartupWithRuntimeState({
    minimalTestGateway,
    cfgAtStart,
    bindHost,
    httpBindHosts,
    port,
    tlsEnabled: gatewayTls.enabled,
    isNixMode,
    tailscaleMode,
    tailscaleResetOnExit: tailscaleConfig.resetOnExit,
    controlUiBasePath,
    logTailscale,
    pluginRegistry,
    defaultWorkspaceDir,
    deps,
    startChannels,
    log,
    logHooks,
    logChannels,
    logBrowser,
    reloadLog: logReload,
    reloadStateGet: () => ({
      hooksConfig,
      heartbeatRunner,
      cronState,
      browserControl,
    }),
    reloadStateSet: (nextState) => {
      hooksConfig = nextState.hooksConfig;
      heartbeatRunner = nextState.heartbeatRunner;
      cronState = nextState.cronState;
      cron = cronState.cron;
      cronStorePath = cronState.storePath;
      browserControl = nextState.browserControl;
    },
    reloadBroadcast: broadcast,
    startChannel,
    stopChannel,
    logCron,
  });
  browserControl = nextBrowserControl;
  pluginServices = nextPluginServices;

  return createGatewayServerRuntime({
    port,
    diagnosticsEnabled,
    log,
    authRateLimiter,
    onBeforeClose: () => skillsRefreshController.dispose(),
    closeHandlerParams: {
      bonjourStop,
      tailscaleCleanup,
      canvasHost,
      canvasHostServer,
      stopChannel,
      pluginServices,
      cron,
      heartbeatRunner,
      nodePresenceTimers,
      broadcast,
      tickInterval,
      healthInterval,
      dedupeCleanup,
      agentUnsub,
      heartbeatUnsub,
      chatRunState,
      clients,
      configReloader,
      browserControl,
      wss,
      httpServer,
      httpServers,
    },
  });
}
