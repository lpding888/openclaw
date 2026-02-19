import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { createSubsystemLogger } from "../../../logging/subsystem.js";
import type { GatewayAuthResult, ResolvedGatewayAuth } from "../../auth.js";
import type { GatewayRequestContext } from "../../server-methods/types.js";
import type { GatewayWsClient } from "../ws-types.js";
import { loadConfig } from "../../../config/config.js";
import {
  AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
  type AuthRateLimiter,
} from "../../auth-rate-limit.js";
import { authorizeGatewayConnect } from "../../auth.js";
import { checkBrowserOrigin } from "../../origin-check.js";
import { GATEWAY_CLIENT_IDS } from "../../protocol/client-info.js";
import {
  type ConnectParams,
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  PROTOCOL_VERSION,
  validateConnectParams,
  validateRequestFrame,
} from "../../protocol/index.js";
import { truncateCloseReason } from "../close-reason.js";
import { formatGatewayAuthFailureMessage, type AuthProvidedKind } from "./auth-messages.js";
import { finalizeConnectHandshake } from "./message-handler-connect-finalize.ts";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export async function handleConnectHandshake(params: {
  parsed: unknown;
  frameType?: string;
  frameMethod?: string;
  frameId?: string;
  socket: WebSocket;
  connId: string;
  remoteAddr?: string;
  forwardedFor?: string;
  requestHost?: string;
  requestOrigin?: string;
  requestUserAgent?: string;
  canvasHostUrl?: string;
  connectNonce: string;
  upgradeReq: IncomingMessage;
  resolvedAuth: ResolvedGatewayAuth;
  rateLimiter?: AuthRateLimiter;
  trustedProxies: string[];
  isLocalClient: boolean;
  reportedClientIp?: string;
  clientIp?: string;
  gatewayMethods: string[];
  events: string[];
  isWebchatConnect: (p: ConnectParams | null | undefined) => boolean;
  buildRequestContext: () => GatewayRequestContext;
  send: (obj: unknown) => void;
  close: (code?: number, reason?: string) => void;
  clearHandshakeTimer: () => void;
  setClient: (next: GatewayWsClient) => void;
  setHandshakeState: (state: "pending" | "connected" | "failed") => void;
  setCloseCause: (cause: string, meta?: Record<string, unknown>) => void;
  logGateway: SubsystemLogger;
  logHealth: SubsystemLogger;
  logWsControl: SubsystemLogger;
}) {
  const {
    parsed,
    frameType,
    frameMethod,
    frameId,
    socket,
    connId,
    remoteAddr,
    forwardedFor,
    requestHost,
    requestOrigin,
    requestUserAgent,
    canvasHostUrl,
    connectNonce,
    upgradeReq,
    resolvedAuth,
    rateLimiter,
    trustedProxies,
    isLocalClient,
    reportedClientIp,
    clientIp,
    gatewayMethods,
    events,
    isWebchatConnect,
    buildRequestContext,
    send,
    close,
    clearHandshakeTimer,
    setClient,
    setHandshakeState,
    setCloseCause,
    logGateway,
    logHealth,
    logWsControl,
  } = params;

  const configSnapshot = loadConfig();

  const isRequestFrame = validateRequestFrame(parsed);
  if (!isRequestFrame || parsed.method !== "connect" || !validateConnectParams(parsed.params)) {
    const handshakeError = isRequestFrame
      ? parsed.method === "connect"
        ? `invalid connect params: ${formatValidationErrors(validateConnectParams.errors)}`
        : "invalid handshake: first request must be connect"
      : "invalid request frame";
    setHandshakeState("failed");
    setCloseCause("invalid-handshake", {
      frameType,
      frameMethod,
      frameId,
      handshakeError,
    });
    if (isRequestFrame) {
      const req = parsed;
      send({
        type: "res",
        id: req.id,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, handshakeError),
      });
    } else {
      logWsControl.warn(
        `invalid handshake conn=${connId} remote=${remoteAddr ?? "?"} fwd=${forwardedFor ?? "n/a"} origin=${requestOrigin ?? "n/a"} host=${requestHost ?? "n/a"} ua=${requestUserAgent ?? "n/a"}`,
      );
    }
    const closeReason = truncateCloseReason(handshakeError || "invalid handshake");
    if (isRequestFrame) {
      queueMicrotask(() => close(1008, closeReason));
    } else {
      close(1008, closeReason);
    }
    return;
  }

  const frame = parsed;
  const connectParams = frame.params as ConnectParams;
  const clientLabel = connectParams.client.displayName ?? connectParams.client.id;

  const { minProtocol, maxProtocol } = connectParams;
  if (maxProtocol < PROTOCOL_VERSION || minProtocol > PROTOCOL_VERSION) {
    setHandshakeState("failed");
    logWsControl.warn(
      `protocol mismatch conn=${connId} remote=${remoteAddr ?? "?"} client=${clientLabel} ${connectParams.client.mode} v${connectParams.client.version}`,
    );
    setCloseCause("protocol-mismatch", {
      minProtocol,
      maxProtocol,
      expectedProtocol: PROTOCOL_VERSION,
      client: connectParams.client.id,
      clientDisplayName: connectParams.client.displayName,
      mode: connectParams.client.mode,
      version: connectParams.client.version,
    });
    send({
      type: "res",
      id: frame.id,
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "protocol mismatch", {
        details: { expectedProtocol: PROTOCOL_VERSION },
      }),
    });
    close(1002, "protocol mismatch");
    return;
  }

  const roleRaw = connectParams.role ?? "operator";
  const role = roleRaw === "operator" || roleRaw === "node" ? roleRaw : null;
  if (!role) {
    setHandshakeState("failed");
    setCloseCause("invalid-role", {
      role: roleRaw,
      client: connectParams.client.id,
      clientDisplayName: connectParams.client.displayName,
      mode: connectParams.client.mode,
      version: connectParams.client.version,
    });
    send({
      type: "res",
      id: frame.id,
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "invalid role"),
    });
    close(1008, "invalid role");
    return;
  }

  let scopes = Array.isArray(connectParams.scopes) ? connectParams.scopes : [];
  connectParams.role = role;
  connectParams.scopes = scopes;

  const isControlUi = connectParams.client.id === GATEWAY_CLIENT_IDS.CONTROL_UI;
  const isWebchat = isWebchatConnect(connectParams);
  if (isControlUi || isWebchat) {
    const originCheck = checkBrowserOrigin({
      requestHost,
      origin: requestOrigin,
      allowedOrigins: configSnapshot.gateway?.controlUi?.allowedOrigins,
    });
    if (!originCheck.ok) {
      const errorMessage =
        "origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)";
      setHandshakeState("failed");
      setCloseCause("origin-mismatch", {
        origin: requestOrigin ?? "n/a",
        host: requestHost ?? "n/a",
        reason: originCheck.reason,
        client: connectParams.client.id,
        clientDisplayName: connectParams.client.displayName,
        mode: connectParams.client.mode,
        version: connectParams.client.version,
      });
      send({
        type: "res",
        id: frame.id,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, errorMessage),
      });
      close(1008, truncateCloseReason(errorMessage));
      return;
    }
  }

  const deviceRaw = connectParams.device;
  const hasTokenAuth = Boolean(connectParams.auth?.token);
  const hasPasswordAuth = Boolean(connectParams.auth?.password);
  const hasSharedAuth = hasTokenAuth || hasPasswordAuth;
  const allowInsecureControlUi =
    isControlUi && configSnapshot.gateway?.controlUi?.allowInsecureAuth === true;
  const disableControlUiDeviceAuth =
    isControlUi && configSnapshot.gateway?.controlUi?.dangerouslyDisableDeviceAuth === true;
  const allowControlUiBypass = allowInsecureControlUi || disableControlUiDeviceAuth;
  const device = disableControlUiDeviceAuth ? null : deviceRaw;
  connectParams.device = device ?? undefined;

  const hasDeviceTokenCandidate = Boolean(connectParams.auth?.token && device);
  let authResult: GatewayAuthResult = await authorizeGatewayConnect({
    auth: resolvedAuth,
    connectAuth: connectParams.auth,
    req: upgradeReq,
    trustedProxies,
    rateLimiter: hasDeviceTokenCandidate ? undefined : rateLimiter,
    clientIp,
    rateLimitScope: AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
  });

  if (
    hasDeviceTokenCandidate &&
    authResult.ok &&
    rateLimiter &&
    (authResult.method === "token" || authResult.method === "password")
  ) {
    const sharedRateCheck = rateLimiter.check(clientIp, AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET);
    if (!sharedRateCheck.allowed) {
      authResult = {
        ok: false,
        reason: "rate_limited",
        rateLimited: true,
        retryAfterMs: sharedRateCheck.retryAfterMs,
      };
    } else {
      rateLimiter.reset(clientIp, AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET);
    }
  }

  let authOk = authResult.ok;
  let authMethod = authResult.method ?? (resolvedAuth.mode === "password" ? "password" : "token");
  const sharedAuthResult = hasSharedAuth
    ? await authorizeGatewayConnect({
        auth: { ...resolvedAuth, allowTailscale: false },
        connectAuth: connectParams.auth,
        req: upgradeReq,
        trustedProxies,
        rateLimitScope: AUTH_RATE_LIMIT_SCOPE_SHARED_SECRET,
      })
    : null;
  const sharedAuthOk =
    sharedAuthResult?.ok === true &&
    (sharedAuthResult.method === "token" || sharedAuthResult.method === "password");
  const rejectUnauthorized = (failedAuth: GatewayAuthResult) => {
    setHandshakeState("failed");
    logWsControl.warn(
      `unauthorized conn=${connId} remote=${remoteAddr ?? "?"} client=${clientLabel} ${connectParams.client.mode} v${connectParams.client.version} reason=${failedAuth.reason ?? "unknown"}`,
    );
    const authProvided: AuthProvidedKind = connectParams.auth?.token
      ? "token"
      : connectParams.auth?.password
        ? "password"
        : "none";
    const authMessage = formatGatewayAuthFailureMessage({
      authMode: resolvedAuth.mode,
      authProvided,
      reason: failedAuth.reason,
      client: connectParams.client,
    });
    setCloseCause("unauthorized", {
      authMode: resolvedAuth.mode,
      authProvided,
      authReason: failedAuth.reason,
      allowTailscale: resolvedAuth.allowTailscale,
      client: connectParams.client.id,
      clientDisplayName: connectParams.client.displayName,
      mode: connectParams.client.mode,
      version: connectParams.client.version,
    });
    send({
      type: "res",
      id: frame.id,
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, authMessage),
    });
    close(1008, truncateCloseReason(authMessage));
  };

  if (!device) {
    if (scopes.length > 0 && !allowControlUiBypass) {
      scopes = [];
      connectParams.scopes = scopes;
    }
    const canSkipDevice = sharedAuthOk;

    if (isControlUi && !allowControlUiBypass) {
      const errorMessage = "control ui requires HTTPS or localhost (secure context)";
      setHandshakeState("failed");
      setCloseCause("control-ui-insecure-auth", {
        client: connectParams.client.id,
        clientDisplayName: connectParams.client.displayName,
        mode: connectParams.client.mode,
        version: connectParams.client.version,
      });
      send({
        type: "res",
        id: frame.id,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, errorMessage),
      });
      close(1008, errorMessage);
      return;
    }

    if (!canSkipDevice) {
      if (!authOk && hasSharedAuth) {
        rejectUnauthorized(authResult);
        return;
      }
      setHandshakeState("failed");
      setCloseCause("device-required", {
        client: connectParams.client.id,
        clientDisplayName: connectParams.client.displayName,
        mode: connectParams.client.mode,
        version: connectParams.client.version,
      });
      send({
        type: "res",
        id: frame.id,
        ok: false,
        error: errorShape(ErrorCodes.NOT_PAIRED, "device identity required"),
      });
      close(1008, "device identity required");
      return;
    }
  }

  await finalizeConnectHandshake({
    frameId: frame.id,
    socket,
    connId,
    remoteAddr,
    connectNonce,
    connectParams,
    role,
    scopes,
    authOk,
    authMethod,
    authResult,
    rateLimiter,
    clientIp,
    isLocalClient,
    reportedClientIp,
    allowControlUiBypass,
    sharedAuthOk,
    isWebchatConnect,
    clientLabel,
    gatewayMethods,
    events,
    canvasHostUrl,
    buildRequestContext,
    send,
    close,
    clearHandshakeTimer,
    setClient,
    setHandshakeState,
    setCloseCause,
    rejectUnauthorized,
    logGateway,
    logHealth,
    logWsControl,
  });
}
