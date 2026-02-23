import os from "node:os";
import type { WebSocket } from "ws";
import { loadConfig } from "../../../config/config.js";
import type { DeviceAuthToken } from "../../../infra/device-pairing.js";
import { updatePairedNodeMetadata } from "../../../infra/node-pairing.js";
import { recordRemoteNodeInfo, refreshRemoteNodeBins } from "../../../infra/skills-remote.js";
import { upsertPresence } from "../../../infra/system-presence.js";
import { loadVoiceWakeConfig } from "../../../infra/voicewake.js";
import type { createSubsystemLogger } from "../../../logging/subsystem.js";
import { GATEWAY_CLIENT_IDS } from "../../protocol/client-info.js";
import { type ConnectParams, PROTOCOL_VERSION } from "../../protocol/index.js";
import { MAX_BUFFERED_BYTES, MAX_PAYLOAD_BYTES, TICK_INTERVAL_MS } from "../../server-constants.js";
import type { GatewayRequestContext } from "../../server-methods/types.js";
import { formatError } from "../../server-utils.js";
import { formatForLog, logWs } from "../../ws-log.js";
import {
  buildGatewaySnapshot,
  getHealthCache,
  getHealthVersion,
  incrementPresenceVersion,
  refreshGatewayHealthSnapshot,
} from "../health-state.js";
import type { GatewayWsClient } from "../ws-types.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export function completeConnectedSession(params: {
  frameId: string;
  socket: WebSocket;
  connId: string;
  connectParams: ConnectParams;
  role: "operator" | "node";
  authMethod: string;
  deviceToken: DeviceAuthToken | null;
  remoteAddr?: string;
  reportedClientIp?: string;
  isLocalClient: boolean;
  isWebchatConnect: (p: ConnectParams | null | undefined) => boolean;
  clientLabel: string;
  gatewayMethods: string[];
  events: string[];
  canvasHostUrl?: string;
  buildRequestContext: () => GatewayRequestContext;
  send: (obj: unknown) => void;
  clearHandshakeTimer: () => void;
  setClient: (next: GatewayWsClient) => void;
  setHandshakeState: (state: "pending" | "connected" | "failed") => void;
  logGateway: SubsystemLogger;
  logHealth: SubsystemLogger;
  logWsControl: SubsystemLogger;
}) {
  const {
    frameId,
    socket,
    connId,
    connectParams,
    role,
    authMethod,
    deviceToken,
    remoteAddr,
    reportedClientIp,
    isLocalClient,
    isWebchatConnect,
    clientLabel,
    gatewayMethods,
    events,
    canvasHostUrl,
    buildRequestContext,
    send,
    clearHandshakeTimer,
    setClient,
    setHandshakeState,
    logGateway,
    logHealth,
    logWsControl,
  } = params;

  const shouldTrackPresence = connectParams.client.id !== GATEWAY_CLIENT_IDS.CLI;
  const clientId = connectParams.client.id;
  const instanceId = connectParams.client.instanceId;
  const presenceKey = shouldTrackPresence
    ? (connectParams.device?.id ?? instanceId ?? connId)
    : undefined;

  logWs("in", "connect", {
    connId,
    client: connectParams.client.id,
    clientDisplayName: connectParams.client.displayName,
    version: connectParams.client.version,
    mode: connectParams.client.mode,
    clientId,
    platform: connectParams.client.platform,
    auth: authMethod,
  });

  if (isWebchatConnect(connectParams)) {
    logWsControl.info(
      `webchat connected conn=${connId} remote=${remoteAddr ?? "?"} client=${clientLabel} ${connectParams.client.mode} v${connectParams.client.version}`,
    );
  }

  if (presenceKey) {
    upsertPresence(presenceKey, {
      host: connectParams.client.displayName ?? connectParams.client.id ?? os.hostname(),
      ip: isLocalClient ? undefined : reportedClientIp,
      version: connectParams.client.version,
      platform: connectParams.client.platform,
      deviceFamily: connectParams.client.deviceFamily,
      modelIdentifier: connectParams.client.modelIdentifier,
      mode: connectParams.client.mode,
      deviceId: connectParams.device?.id,
      roles: [role],
      scopes: connectParams.scopes ?? [],
      instanceId: connectParams.device?.id ?? instanceId,
      reason: "connect",
    });
    incrementPresenceVersion();
  }

  const snapshot = buildGatewaySnapshot();
  const cachedHealth = getHealthCache();
  if (cachedHealth) {
    snapshot.health = cachedHealth;
    snapshot.stateVersion.health = getHealthVersion();
  }
  const helloOk = {
    type: "hello-ok",
    protocol: PROTOCOL_VERSION,
    server: {
      version: process.env.OPENCLAW_VERSION ?? process.env.npm_package_version ?? "dev",
      commit: process.env.GIT_COMMIT,
      host: os.hostname(),
      connId,
    },
    features: { methods: gatewayMethods, events },
    snapshot,
    canvasHostUrl,
    auth: deviceToken
      ? {
          deviceToken: deviceToken.token,
          role: deviceToken.role,
          scopes: deviceToken.scopes,
          issuedAtMs: deviceToken.rotatedAtMs ?? deviceToken.createdAtMs,
        }
      : undefined,
    policy: {
      maxPayload: MAX_PAYLOAD_BYTES,
      maxBufferedBytes: MAX_BUFFERED_BYTES,
      tickIntervalMs: TICK_INTERVAL_MS,
    },
  };

  clearHandshakeTimer();
  const nextClient: GatewayWsClient = {
    socket,
    connect: connectParams,
    connId,
    presenceKey,
    clientIp: reportedClientIp,
  };
  setClient(nextClient);
  setHandshakeState("connected");
  if (role === "node") {
    const context = buildRequestContext();
    const nodeSession = context.nodeRegistry.register(nextClient, {
      remoteIp: reportedClientIp,
    });
    const instanceIdRaw = connectParams.client.instanceId;
    const nodeInstanceId = typeof instanceIdRaw === "string" ? instanceIdRaw.trim() : "";
    const nodeIdsForPairing = new Set<string>([nodeSession.nodeId]);
    if (nodeInstanceId) {
      nodeIdsForPairing.add(nodeInstanceId);
    }
    for (const nodeId of nodeIdsForPairing) {
      void updatePairedNodeMetadata(nodeId, {
        lastConnectedAtMs: nodeSession.connectedAtMs,
      }).catch((err) =>
        logGateway.warn(`failed to record last connect for ${nodeId}: ${formatForLog(err)}`),
      );
    }
    recordRemoteNodeInfo({
      nodeId: nodeSession.nodeId,
      displayName: nodeSession.displayName,
      platform: nodeSession.platform,
      deviceFamily: nodeSession.deviceFamily,
      commands: nodeSession.commands,
      remoteIp: nodeSession.remoteIp,
    });
    void refreshRemoteNodeBins({
      nodeId: nodeSession.nodeId,
      platform: nodeSession.platform,
      deviceFamily: nodeSession.deviceFamily,
      commands: nodeSession.commands,
      cfg: loadConfig(),
    }).catch((err) =>
      logGateway.warn(`remote bin probe failed for ${nodeSession.nodeId}: ${formatForLog(err)}`),
    );
    void loadVoiceWakeConfig()
      .then((cfg) => {
        context.nodeRegistry.sendEvent(nodeSession.nodeId, "voicewake.changed", {
          triggers: cfg.triggers,
        });
      })
      .catch((err) =>
        logGateway.warn(
          `voicewake snapshot failed for ${nodeSession.nodeId}: ${formatForLog(err)}`,
        ),
      );
  }

  logWs("out", "hello-ok", {
    connId,
    methods: gatewayMethods.length,
    events: events.length,
    presence: snapshot.presence.length,
    stateVersion: snapshot.stateVersion.presence,
  });

  send({ type: "res", id: frameId, ok: true, payload: helloOk });
  void refreshGatewayHealthSnapshot({ probe: true }).catch((err) =>
    logHealth.error(`post-connect health refresh failed: ${formatError(err)}`),
  );
}
