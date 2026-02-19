import type { OpenClawConfig } from "../config/config.js";
import type { SessionsListParams } from "./protocol/index.js";
import type {
  GatewaySessionRow,
  GatewaySessionsDefaults,
  SessionsListResult,
} from "./session-utils.types.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { lookupContextTokens } from "../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import {
  resolveConfiguredModelRef,
  resolveDefaultModelForAgent,
} from "../agents/model-selection.js";
import {
  buildGroupDisplayName,
  resolveFreshSessionTotalTokens,
  type SessionEntry,
} from "../config/sessions.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { isCronRunSessionKey } from "../sessions/session-key-utils.js";
import { normalizeSessionDeliveryFields } from "../utils/delivery-context.js";
import { readSessionTitleFieldsFromTranscript } from "./session-utils.fs.js";

const DERIVED_TITLE_MAX_LEN = 60;

function formatSessionIdPrefix(sessionId: string, updatedAt?: number | null): string {
  const prefix = sessionId.slice(0, 8);
  if (updatedAt && updatedAt > 0) {
    const d = new Date(updatedAt);
    const date = d.toISOString().slice(0, 10);
    return `${prefix} (${date})`;
  }
  return prefix;
}

function truncateTitle(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  const cut = text.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) {
    return `${cut.slice(0, lastSpace)}…`;
  }
  return `${cut}…`;
}

export function deriveSessionTitle(
  entry: SessionEntry | undefined,
  firstUserMessage?: string | null,
): string | undefined {
  if (!entry) {
    return undefined;
  }

  if (entry.displayName?.trim()) {
    return entry.displayName.trim();
  }

  if (entry.subject?.trim()) {
    return entry.subject.trim();
  }

  if (firstUserMessage?.trim()) {
    const normalized = firstUserMessage.replace(/\s+/g, " ").trim();
    return truncateTitle(normalized, DERIVED_TITLE_MAX_LEN);
  }

  if (entry.sessionId) {
    return formatSessionIdPrefix(entry.sessionId, entry.updatedAt);
  }

  return undefined;
}

export function classifySessionKey(key: string, entry?: SessionEntry): GatewaySessionRow["kind"] {
  if (key === "global") {
    return "global";
  }
  if (key === "unknown") {
    return "unknown";
  }
  if (entry?.chatType === "group" || entry?.chatType === "channel") {
    return "group";
  }
  if (key.includes(":group:") || key.includes(":channel:")) {
    return "group";
  }
  return "direct";
}

export function parseGroupKey(
  key: string,
): { channel?: string; kind?: "group" | "channel"; id?: string } | null {
  const agentParsed = parseAgentSessionKey(key);
  const rawKey = agentParsed?.rest ?? key;
  const parts = rawKey.split(":").filter(Boolean);
  if (parts.length >= 3) {
    const [channel, kind, ...rest] = parts;
    if (kind === "group" || kind === "channel") {
      return { channel, kind, id: rest.join(":") };
    }
  }
  return null;
}

export function getSessionDefaults(cfg: OpenClawConfig): GatewaySessionsDefaults {
  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const contextTokens =
    cfg.agents?.defaults?.contextTokens ??
    lookupContextTokens(resolved.model) ??
    DEFAULT_CONTEXT_TOKENS;
  return {
    modelProvider: resolved.provider ?? null,
    model: resolved.model ?? null,
    contextTokens: contextTokens ?? null,
  };
}

export function resolveSessionModelRef(
  cfg: OpenClawConfig,
  entry?: SessionEntry,
  agentId?: string,
): { provider: string; model: string } {
  const resolved = agentId
    ? resolveDefaultModelForAgent({ cfg, agentId })
    : resolveConfiguredModelRef({
        cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      });
  let provider = resolved.provider;
  let model = resolved.model;
  const storedModelOverride = entry?.modelOverride?.trim();
  if (storedModelOverride) {
    provider = entry?.providerOverride?.trim() || provider;
    model = storedModelOverride;
  }
  return { provider, model };
}

export function listSessionsFromStore(params: {
  cfg: OpenClawConfig;
  storePath: string;
  store: Record<string, SessionEntry>;
  opts: SessionsListParams;
}): SessionsListResult {
  const { cfg, storePath, store, opts } = params;
  const now = Date.now();

  const includeGlobal = opts.includeGlobal === true;
  const includeUnknown = opts.includeUnknown === true;
  const includeDerivedTitles = opts.includeDerivedTitles === true;
  const includeLastMessage = opts.includeLastMessage === true;
  const spawnedBy = typeof opts.spawnedBy === "string" ? opts.spawnedBy : "";
  const label = typeof opts.label === "string" ? opts.label.trim() : "";
  const agentId = typeof opts.agentId === "string" ? normalizeAgentId(opts.agentId) : "";
  const search = typeof opts.search === "string" ? opts.search.trim().toLowerCase() : "";
  const activeMinutes =
    typeof opts.activeMinutes === "number" && Number.isFinite(opts.activeMinutes)
      ? Math.max(1, Math.floor(opts.activeMinutes))
      : undefined;

  let sessions = Object.entries(store)
    .filter(([key]) => {
      if (isCronRunSessionKey(key)) {
        return false;
      }
      if (!includeGlobal && key === "global") {
        return false;
      }
      if (!includeUnknown && key === "unknown") {
        return false;
      }
      if (agentId) {
        if (key === "global" || key === "unknown") {
          return false;
        }
        const parsed = parseAgentSessionKey(key);
        if (!parsed) {
          return false;
        }
        return normalizeAgentId(parsed.agentId) === agentId;
      }
      return true;
    })
    .filter(([key, entry]) => {
      if (!spawnedBy) {
        return true;
      }
      if (key === "unknown" || key === "global") {
        return false;
      }
      return entry?.spawnedBy === spawnedBy;
    })
    .filter(([, entry]) => {
      if (!label) {
        return true;
      }
      return entry?.label === label;
    })
    .map(([key, entry]) => {
      const updatedAt = entry?.updatedAt ?? null;
      const total = resolveFreshSessionTotalTokens(entry);
      const totalTokensFresh =
        typeof entry?.totalTokens === "number" ? entry?.totalTokensFresh !== false : false;
      const parsed = parseGroupKey(key);
      const channel = entry?.channel ?? parsed?.channel;
      const subject = entry?.subject;
      const groupChannel = entry?.groupChannel;
      const space = entry?.space;
      const id = parsed?.id;
      const origin = entry?.origin;
      const originLabel = origin?.label;
      const displayName =
        entry?.displayName ??
        (channel
          ? buildGroupDisplayName({
              provider: channel,
              subject,
              groupChannel,
              space,
              id,
              key,
            })
          : undefined) ??
        entry?.label ??
        originLabel;
      const deliveryFields = normalizeSessionDeliveryFields(entry);
      const parsedAgent = parseAgentSessionKey(key);
      const sessionAgentId = normalizeAgentId(parsedAgent?.agentId ?? resolveDefaultAgentId(cfg));
      const resolvedModel = resolveSessionModelRef(cfg, entry, sessionAgentId);
      const modelProvider = resolvedModel.provider ?? DEFAULT_PROVIDER;
      const model = resolvedModel.model ?? DEFAULT_MODEL;
      return {
        key,
        entry,
        kind: classifySessionKey(key, entry),
        label: entry?.label,
        displayName,
        channel,
        subject,
        groupChannel,
        space,
        chatType: entry?.chatType,
        origin,
        updatedAt,
        sessionId: entry?.sessionId,
        systemSent: entry?.systemSent,
        abortedLastRun: entry?.abortedLastRun,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        elevatedLevel: entry?.elevatedLevel,
        sendPolicy: entry?.sendPolicy,
        inputTokens: entry?.inputTokens,
        outputTokens: entry?.outputTokens,
        totalTokens: total,
        totalTokensFresh,
        responseUsage: entry?.responseUsage,
        modelProvider,
        model,
        contextTokens: entry?.contextTokens,
        deliveryContext: deliveryFields.deliveryContext,
        lastChannel: deliveryFields.lastChannel ?? entry?.lastChannel,
        lastTo: deliveryFields.lastTo ?? entry?.lastTo,
        lastAccountId: deliveryFields.lastAccountId ?? entry?.lastAccountId,
      };
    })
    .toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  if (search) {
    sessions = sessions.filter((session) => {
      const fields = [
        session.displayName,
        session.label,
        session.subject,
        session.sessionId,
        session.key,
      ];
      return fields.some(
        (field) => typeof field === "string" && field.toLowerCase().includes(search),
      );
    });
  }

  if (activeMinutes !== undefined) {
    const cutoff = now - activeMinutes * 60_000;
    sessions = sessions.filter((session) => (session.updatedAt ?? 0) >= cutoff);
  }

  if (typeof opts.limit === "number" && Number.isFinite(opts.limit)) {
    const limit = Math.max(1, Math.floor(opts.limit));
    sessions = sessions.slice(0, limit);
  }

  const finalSessions: GatewaySessionRow[] = sessions.map((session) => {
    const { entry, ...rest } = session;
    let derivedTitle: string | undefined;
    let lastMessagePreview: string | undefined;
    if (entry?.sessionId && (includeDerivedTitles || includeLastMessage)) {
      const parsed = parseAgentSessionKey(session.key);
      const derivedAgentId =
        parsed && parsed.agentId ? normalizeAgentId(parsed.agentId) : resolveDefaultAgentId(cfg);
      const fields = readSessionTitleFieldsFromTranscript(
        entry.sessionId,
        storePath,
        entry.sessionFile,
        derivedAgentId,
      );
      if (includeDerivedTitles) {
        derivedTitle = deriveSessionTitle(entry, fields.firstUserMessage);
      }
      if (includeLastMessage && fields.lastMessagePreview) {
        lastMessagePreview = fields.lastMessagePreview;
      }
    }
    return { ...rest, derivedTitle, lastMessagePreview } satisfies GatewaySessionRow;
  });

  return {
    ts: now,
    path: storePath,
    count: finalSessions.length,
    defaults: getSessionDefaults(cfg),
    sessions: finalSessions,
  };
}
