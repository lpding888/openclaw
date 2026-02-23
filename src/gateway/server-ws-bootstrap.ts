import type { WebSocketServer } from "ws";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { GATEWAY_EVENTS } from "./server-methods-list.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./server-methods/types.js";
import { attachGatewayWsHandlers } from "./server-ws-runtime.js";
import type { GatewayWsClient } from "./server/ws-types.js";

export function attachGatewayWsBootstrap(params: {
  wss: WebSocketServer;
  clients: Set<GatewayWsClient>;
  port: number;
  bindHost?: string;
  canvasHostEnabled: boolean;
  canvasHostServerPort?: number;
  resolvedAuth: ResolvedGatewayAuth;
  authRateLimiter?: AuthRateLimiter;
  gatewayMethods: string[];
  logGateway: ReturnType<typeof createSubsystemLogger>;
  logHealth: ReturnType<typeof createSubsystemLogger>;
  logWsControl: ReturnType<typeof createSubsystemLogger>;
  pluginGatewayHandlers: GatewayRequestHandlers;
  execApprovalHandlers: GatewayRequestHandlers;
  deps: GatewayRequestContext["deps"];
  cron: GatewayRequestContext["cron"];
  cronStorePath: GatewayRequestContext["cronStorePath"];
  execApprovalManager: GatewayRequestContext["execApprovalManager"];
  loadGatewayModelCatalog: GatewayRequestContext["loadGatewayModelCatalog"];
  getHealthCache: GatewayRequestContext["getHealthCache"];
  refreshHealthSnapshot: GatewayRequestContext["refreshHealthSnapshot"];
  incrementPresenceVersion: GatewayRequestContext["incrementPresenceVersion"];
  getHealthVersion: GatewayRequestContext["getHealthVersion"];
  broadcast: GatewayRequestContext["broadcast"];
  broadcastToConnIds: GatewayRequestContext["broadcastToConnIds"];
  nodeSendToSession: GatewayRequestContext["nodeSendToSession"];
  nodeSendToAllSubscribed: GatewayRequestContext["nodeSendToAllSubscribed"];
  nodeSubscribe: GatewayRequestContext["nodeSubscribe"];
  nodeUnsubscribe: GatewayRequestContext["nodeUnsubscribe"];
  nodeUnsubscribeAll: GatewayRequestContext["nodeUnsubscribeAll"];
  hasConnectedMobileNode: GatewayRequestContext["hasConnectedMobileNode"];
  nodeRegistry: GatewayRequestContext["nodeRegistry"];
  agentRunSeq: GatewayRequestContext["agentRunSeq"];
  chatAbortControllers: GatewayRequestContext["chatAbortControllers"];
  chatAbortedRuns: GatewayRequestContext["chatAbortedRuns"];
  chatRunBuffers: GatewayRequestContext["chatRunBuffers"];
  chatDeltaSentAt: GatewayRequestContext["chatDeltaSentAt"];
  addChatRun: GatewayRequestContext["addChatRun"];
  removeChatRun: GatewayRequestContext["removeChatRun"];
  registerToolEventRecipient: GatewayRequestContext["registerToolEventRecipient"];
  dedupe: GatewayRequestContext["dedupe"];
  wizardSessions: GatewayRequestContext["wizardSessions"];
  findRunningWizard: GatewayRequestContext["findRunningWizard"];
  purgeWizardSession: GatewayRequestContext["purgeWizardSession"];
  getRuntimeSnapshot: GatewayRequestContext["getRuntimeSnapshot"];
  startChannel: GatewayRequestContext["startChannel"];
  stopChannel: GatewayRequestContext["stopChannel"];
  markChannelLoggedOut: GatewayRequestContext["markChannelLoggedOut"];
  wizardRunner: GatewayRequestContext["wizardRunner"];
  broadcastVoiceWakeChanged: GatewayRequestContext["broadcastVoiceWakeChanged"];
}) {
  const context: GatewayRequestContext = {
    deps: params.deps,
    cron: params.cron,
    cronStorePath: params.cronStorePath,
    execApprovalManager: params.execApprovalManager,
    loadGatewayModelCatalog: params.loadGatewayModelCatalog,
    getHealthCache: params.getHealthCache,
    refreshHealthSnapshot: params.refreshHealthSnapshot,
    logHealth: params.logHealth,
    logGateway: params.logGateway,
    incrementPresenceVersion: params.incrementPresenceVersion,
    getHealthVersion: params.getHealthVersion,
    broadcast: params.broadcast,
    broadcastToConnIds: params.broadcastToConnIds,
    nodeSendToSession: params.nodeSendToSession,
    nodeSendToAllSubscribed: params.nodeSendToAllSubscribed,
    nodeSubscribe: params.nodeSubscribe,
    nodeUnsubscribe: params.nodeUnsubscribe,
    nodeUnsubscribeAll: params.nodeUnsubscribeAll,
    hasConnectedMobileNode: params.hasConnectedMobileNode,
    nodeRegistry: params.nodeRegistry,
    agentRunSeq: params.agentRunSeq,
    chatAbortControllers: params.chatAbortControllers,
    chatAbortedRuns: params.chatAbortedRuns,
    chatRunBuffers: params.chatRunBuffers,
    chatDeltaSentAt: params.chatDeltaSentAt,
    addChatRun: params.addChatRun,
    removeChatRun: params.removeChatRun,
    registerToolEventRecipient: params.registerToolEventRecipient,
    dedupe: params.dedupe,
    wizardSessions: params.wizardSessions,
    findRunningWizard: params.findRunningWizard,
    purgeWizardSession: params.purgeWizardSession,
    getRuntimeSnapshot: params.getRuntimeSnapshot,
    startChannel: params.startChannel,
    stopChannel: params.stopChannel,
    markChannelLoggedOut: params.markChannelLoggedOut,
    wizardRunner: params.wizardRunner,
    broadcastVoiceWakeChanged: params.broadcastVoiceWakeChanged,
  };

  attachGatewayWsHandlers({
    wss: params.wss,
    clients: params.clients,
    port: params.port,
    gatewayHost: params.bindHost,
    canvasHostEnabled: params.canvasHostEnabled,
    canvasHostServerPort: params.canvasHostServerPort,
    resolvedAuth: params.resolvedAuth,
    rateLimiter: params.authRateLimiter,
    gatewayMethods: params.gatewayMethods,
    events: GATEWAY_EVENTS,
    logGateway: params.logGateway,
    logHealth: params.logHealth,
    logWsControl: params.logWsControl,
    extraHandlers: {
      ...params.pluginGatewayHandlers,
      ...params.execApprovalHandlers,
    },
    broadcast: params.broadcast,
    context,
  });
}
