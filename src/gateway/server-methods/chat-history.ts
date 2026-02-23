import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveThinkingDefault } from "../../agents/model-selection.js";
import { stripEnvelopeFromMessages } from "../chat-sanitize.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatHistoryParams,
} from "../protocol/index.js";
import { getMaxChatHistoryMessagesBytes } from "../server-constants.js";
import {
  capArrayByJsonBytes,
  loadSessionEntry,
  readSessionMessages,
  resolveSessionModelRef,
} from "../session-utils.js";
import type { GatewayRequestHandler } from "./types.js";

export const handleChatHistory: GatewayRequestHandler = async ({ params, respond, context }) => {
  if (!validateChatHistoryParams(params)) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
      ),
    );
    return;
  }
  const { sessionKey, limit } = params as {
    sessionKey: string;
    limit?: number;
  };
  const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
  const sessionId = entry?.sessionId;
  const rawMessages =
    sessionId && storePath ? readSessionMessages(sessionId, storePath, entry?.sessionFile) : [];
  const hardMax = 1000;
  const defaultLimit = 200;
  const requested = typeof limit === "number" ? limit : defaultLimit;
  const max = Math.min(hardMax, requested);
  const sliced = rawMessages.length > max ? rawMessages.slice(-max) : rawMessages;
  const sanitized = stripEnvelopeFromMessages(sliced);
  const capped = capArrayByJsonBytes(sanitized, getMaxChatHistoryMessagesBytes()).items;
  let thinkingLevel = entry?.thinkingLevel;
  if (!thinkingLevel) {
    const configured = cfg.agents?.defaults?.thinkingDefault;
    if (configured) {
      thinkingLevel = configured;
    } else {
      const sessionAgentId = resolveSessionAgentId({ sessionKey, config: cfg });
      const { provider, model } = resolveSessionModelRef(cfg, entry, sessionAgentId);
      const catalog = await context.loadGatewayModelCatalog();
      thinkingLevel = resolveThinkingDefault({
        cfg,
        provider,
        model,
        catalog,
      });
    }
  }
  const verboseLevel = entry?.verboseLevel ?? cfg.agents?.defaults?.verboseDefault;
  respond(true, {
    sessionKey,
    sessionId,
    messages: capped,
    thinkingLevel,
    verboseLevel,
  });
};
