import type { GatewayRequestHandler } from "./types.js";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatInjectParams,
} from "../protocol/index.js";
import { loadSessionEntry } from "../session-utils.js";
import { appendAssistantTranscriptMessage } from "./chat-session.js";

export const handleChatInject: GatewayRequestHandler = async ({ params, respond, context }) => {
  if (!validateChatInjectParams(params)) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `invalid chat.inject params: ${formatValidationErrors(validateChatInjectParams.errors)}`,
      ),
    );
    return;
  }
  const p = params as {
    sessionKey: string;
    message: string;
    label?: string;
  };

  const rawSessionKey = p.sessionKey;
  const { cfg, storePath, entry } = loadSessionEntry(rawSessionKey);
  const sessionId = entry?.sessionId;
  if (!sessionId || !storePath) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "session not found"));
    return;
  }

  const appended = appendAssistantTranscriptMessage({
    message: p.message,
    label: p.label,
    sessionId,
    storePath,
    sessionFile: entry?.sessionFile,
    agentId: resolveSessionAgentId({ sessionKey: rawSessionKey, config: cfg }),
    createIfMissing: false,
  });
  if (!appended.ok || !appended.messageId || !appended.message) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.UNAVAILABLE,
        `failed to write transcript: ${appended.error ?? "unknown error"}`,
      ),
    );
    return;
  }

  const chatPayload = {
    runId: `inject-${appended.messageId}`,
    sessionKey: rawSessionKey,
    seq: 0,
    state: "final" as const,
    message: appended.message,
  };
  context.broadcast("chat", chatPayload);
  context.nodeSendToSession(rawSessionKey, "chat", chatPayload);

  respond(true, { ok: true, messageId: appended.messageId });
};
