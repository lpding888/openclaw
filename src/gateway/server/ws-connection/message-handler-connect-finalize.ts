import type { WebSocket } from "ws";
import { loadConfig } from "../../../config/config.js";
import {
  deriveDeviceIdFromPublicKey,
  normalizeDevicePublicKeyBase64Url,
  verifyDeviceSignature,
} from "../../../infra/device-identity.js";
import {
  approveDevicePairing,
  ensureDeviceToken,
  getPairedDevice,
  requestDevicePairing,
  updatePairedDeviceMetadata,
  verifyDeviceToken,
} from "../../../infra/device-pairing.js";
import type { createSubsystemLogger } from "../../../logging/subsystem.js";
import { AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN, type AuthRateLimiter } from "../../auth-rate-limit.js";
import type { GatewayAuthResult } from "../../auth.js";
import { buildDeviceAuthPayload } from "../../device-auth.js";
import { resolveNodeCommandAllowlist } from "../../node-command-policy.js";
import { type ConnectParams, ErrorCodes, errorShape } from "../../protocol/index.js";
import type { GatewayRequestContext } from "../../server-methods/types.js";
import type { GatewayWsClient } from "../ws-types.js";
import { completeConnectedSession } from "./message-handler-connect-session.ts";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

const DEVICE_SIGNATURE_SKEW_MS = 10 * 60 * 1000;

export async function finalizeConnectHandshake(params: {
  frameId: string;
  socket: WebSocket;
  connId: string;
  remoteAddr?: string;
  connectNonce: string;
  connectParams: ConnectParams;
  role: "operator" | "node";
  scopes: string[];
  authOk: boolean;
  authMethod: string;
  authResult: GatewayAuthResult;
  rateLimiter?: AuthRateLimiter;
  clientIp?: string;
  isLocalClient: boolean;
  reportedClientIp?: string;
  allowControlUiBypass: boolean;
  sharedAuthOk: boolean;
  isWebchatConnect: (p: ConnectParams | null | undefined) => boolean;
  clientLabel: string;
  gatewayMethods: string[];
  events: string[];
  canvasHostUrl?: string;
  buildRequestContext: () => GatewayRequestContext;
  send: (obj: unknown) => void;
  close: (code?: number, reason?: string) => void;
  clearHandshakeTimer: () => void;
  setClient: (next: GatewayWsClient) => void;
  setHandshakeState: (state: "pending" | "connected" | "failed") => void;
  setCloseCause: (cause: string, meta?: Record<string, unknown>) => void;
  rejectUnauthorized: (failedAuth: GatewayAuthResult) => void;
  logGateway: SubsystemLogger;
  logHealth: SubsystemLogger;
  logWsControl: SubsystemLogger;
}) {
  const {
    frameId,
    socket,
    connId,
    remoteAddr,
    connectNonce,
    connectParams,
    role,
    scopes,
    authOk: initialAuthOk,
    authMethod: initialAuthMethod,
    authResult: initialAuthResult,
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
  } = params;

  const device = connectParams.device ?? null;
  let devicePublicKey: string | null = null;
  let authOk = initialAuthOk;
  let authMethod = initialAuthMethod;
  let authResult = initialAuthResult;

  if (device) {
    const derivedId = deriveDeviceIdFromPublicKey(device.publicKey);
    if (!derivedId || derivedId !== device.id) {
      setHandshakeState("failed");
      setCloseCause("device-auth-invalid", {
        reason: "device-id-mismatch",
        client: connectParams.client.id,
        deviceId: device.id,
      });
      send({
        type: "res",
        id: frameId,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "device identity mismatch"),
      });
      close(1008, "device identity mismatch");
      return;
    }
    const signedAt = device.signedAt;
    if (
      typeof signedAt !== "number" ||
      Math.abs(Date.now() - signedAt) > DEVICE_SIGNATURE_SKEW_MS
    ) {
      setHandshakeState("failed");
      setCloseCause("device-auth-invalid", {
        reason: "device-signature-stale",
        client: connectParams.client.id,
        deviceId: device.id,
      });
      send({
        type: "res",
        id: frameId,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "device signature expired"),
      });
      close(1008, "device signature expired");
      return;
    }
    const nonceRequired = !isLocalClient;
    const providedNonce = typeof device.nonce === "string" ? device.nonce.trim() : "";
    if (nonceRequired && !providedNonce) {
      setHandshakeState("failed");
      setCloseCause("device-auth-invalid", {
        reason: "device-nonce-missing",
        client: connectParams.client.id,
        deviceId: device.id,
      });
      send({
        type: "res",
        id: frameId,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "device nonce required"),
      });
      close(1008, "device nonce required");
      return;
    }
    if (providedNonce && providedNonce !== connectNonce) {
      setHandshakeState("failed");
      setCloseCause("device-auth-invalid", {
        reason: "device-nonce-mismatch",
        client: connectParams.client.id,
        deviceId: device.id,
      });
      send({
        type: "res",
        id: frameId,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "device nonce mismatch"),
      });
      close(1008, "device nonce mismatch");
      return;
    }
    const payload = buildDeviceAuthPayload({
      deviceId: device.id,
      clientId: connectParams.client.id,
      clientMode: connectParams.client.mode,
      role,
      scopes,
      signedAtMs: signedAt,
      token: connectParams.auth?.token ?? null,
      nonce: providedNonce || undefined,
      version: providedNonce ? "v2" : "v1",
    });
    const rejectDeviceSignatureInvalid = () => {
      setHandshakeState("failed");
      setCloseCause("device-auth-invalid", {
        reason: "device-signature",
        client: connectParams.client.id,
        deviceId: device.id,
      });
      send({
        type: "res",
        id: frameId,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "device signature invalid"),
      });
      close(1008, "device signature invalid");
    };
    const signatureOk = verifyDeviceSignature(device.publicKey, payload, device.signature);
    const allowLegacy = !nonceRequired && !providedNonce;
    if (!signatureOk && allowLegacy) {
      const legacyPayload = buildDeviceAuthPayload({
        deviceId: device.id,
        clientId: connectParams.client.id,
        clientMode: connectParams.client.mode,
        role,
        scopes,
        signedAtMs: signedAt,
        token: connectParams.auth?.token ?? null,
        version: "v1",
      });
      if (!verifyDeviceSignature(device.publicKey, legacyPayload, device.signature)) {
        rejectDeviceSignatureInvalid();
        return;
      }
    } else if (!signatureOk) {
      rejectDeviceSignatureInvalid();
      return;
    }
    devicePublicKey = normalizeDevicePublicKeyBase64Url(device.publicKey);
    if (!devicePublicKey) {
      setHandshakeState("failed");
      setCloseCause("device-auth-invalid", {
        reason: "device-public-key",
        client: connectParams.client.id,
        deviceId: device.id,
      });
      send({
        type: "res",
        id: frameId,
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "device public key invalid"),
      });
      close(1008, "device public key invalid");
      return;
    }
  }

  if (!authOk && connectParams.auth?.token && device) {
    if (rateLimiter) {
      const deviceRateCheck = rateLimiter.check(clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
      if (!deviceRateCheck.allowed) {
        authResult = {
          ok: false,
          reason: "rate_limited",
          rateLimited: true,
          retryAfterMs: deviceRateCheck.retryAfterMs,
        };
      }
    }
    if (!authResult.rateLimited) {
      const tokenCheck = await verifyDeviceToken({
        deviceId: device.id,
        token: connectParams.auth.token,
        role,
        scopes,
      });
      if (tokenCheck.ok) {
        authOk = true;
        authMethod = "device-token";
        rateLimiter?.reset(clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
      } else {
        authResult = { ok: false, reason: "device_token_mismatch" };
        rateLimiter?.recordFailure(clientIp, AUTH_RATE_LIMIT_SCOPE_DEVICE_TOKEN);
      }
    }
  }
  if (!authOk) {
    rejectUnauthorized(authResult);
    return;
  }

  const skipPairing = allowControlUiBypass && sharedAuthOk;
  if (device && devicePublicKey && !skipPairing) {
    const requirePairing = async (reason: string) => {
      const pairing = await requestDevicePairing({
        deviceId: device.id,
        publicKey: devicePublicKey,
        displayName: connectParams.client.displayName,
        platform: connectParams.client.platform,
        clientId: connectParams.client.id,
        clientMode: connectParams.client.mode,
        role,
        scopes,
        remoteIp: reportedClientIp,
        silent: isLocalClient,
      });
      const context = buildRequestContext();
      if (pairing.request.silent === true) {
        const approved = await approveDevicePairing(pairing.request.requestId);
        if (approved) {
          logGateway.info(
            `device pairing auto-approved device=${approved.device.deviceId} role=${approved.device.role ?? "unknown"}`,
          );
          context.broadcast(
            "device.pair.resolved",
            {
              requestId: pairing.request.requestId,
              deviceId: approved.device.deviceId,
              decision: "approved",
              ts: Date.now(),
            },
            { dropIfSlow: true },
          );
        }
      } else if (pairing.created) {
        context.broadcast("device.pair.requested", pairing.request, { dropIfSlow: true });
      }
      if (pairing.request.silent !== true) {
        setHandshakeState("failed");
        setCloseCause("pairing-required", {
          deviceId: device.id,
          requestId: pairing.request.requestId,
          reason,
        });
        send({
          type: "res",
          id: frameId,
          ok: false,
          error: errorShape(ErrorCodes.NOT_PAIRED, "pairing required", {
            details: { requestId: pairing.request.requestId },
          }),
        });
        close(1008, "pairing required");
        return false;
      }
      return true;
    };

    const paired = await getPairedDevice(device.id);
    const isPaired = paired?.publicKey === devicePublicKey;
    if (!isPaired) {
      const ok = await requirePairing("not-paired");
      if (!ok) {
        return;
      }
    } else {
      const allowedRoles = new Set(
        Array.isArray(paired.roles) ? paired.roles : paired.role ? [paired.role] : [],
      );
      if (allowedRoles.size === 0 || !allowedRoles.has(role)) {
        const ok = await requirePairing("role-upgrade");
        if (!ok) {
          return;
        }
      }

      const pairedScopes = Array.isArray(paired.scopes) ? paired.scopes : [];
      if (scopes.length > 0) {
        if (pairedScopes.length === 0) {
          const ok = await requirePairing("scope-upgrade");
          if (!ok) {
            return;
          }
        } else {
          const allowedScopes = new Set(pairedScopes);
          const missingScope = scopes.find((scope) => !allowedScopes.has(scope));
          if (missingScope) {
            const ok = await requirePairing("scope-upgrade");
            if (!ok) {
              return;
            }
          }
        }
      }

      await updatePairedDeviceMetadata(device.id, {
        displayName: connectParams.client.displayName,
        platform: connectParams.client.platform,
        clientId: connectParams.client.id,
        clientMode: connectParams.client.mode,
        role,
        scopes,
        remoteIp: reportedClientIp,
      });
    }
  }

  const deviceToken = device
    ? await ensureDeviceToken({ deviceId: device.id, role, scopes })
    : null;

  if (role === "node") {
    const cfg = loadConfig();
    const allowlist = resolveNodeCommandAllowlist(cfg, {
      platform: connectParams.client.platform,
      deviceFamily: connectParams.client.deviceFamily,
    });
    const declared = Array.isArray(connectParams.commands) ? connectParams.commands : [];
    const filtered = declared
      .map((cmd) => cmd.trim())
      .filter((cmd) => cmd.length > 0 && allowlist.has(cmd));
    connectParams.commands = filtered;
  }

  completeConnectedSession({
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
  });
}
