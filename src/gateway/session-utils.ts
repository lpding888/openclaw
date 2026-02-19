import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { type OpenClawConfig, loadConfig } from "../config/config.js";
import {
  canonicalizeMainSessionAlias,
  loadSessionStore,
  resolveAgentMainSessionKey,
  resolveMainSessionKey,
  resolveStorePath,
  type SessionEntry,
} from "../config/sessions.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { listConfiguredAgentIds, listAgentsForGateway } from "./session-utils.agents.js";
import {
  classifySessionKey,
  deriveSessionTitle,
  getSessionDefaults,
  listSessionsFromStore,
  parseGroupKey,
  resolveSessionModelRef,
} from "./session-utils.list.js";

export {
  archiveFileOnDisk,
  archiveSessionTranscripts,
  capArrayByJsonBytes,
  readFirstUserMessageFromTranscript,
  readLastMessagePreviewFromTranscript,
  readSessionTitleFieldsFromTranscript,
  readSessionPreviewItemsFromTranscript,
  readSessionMessages,
  resolveSessionTranscriptCandidates,
} from "./session-utils.fs.js";

export {
  classifySessionKey,
  deriveSessionTitle,
  getSessionDefaults,
  listAgentsForGateway,
  listSessionsFromStore,
  parseGroupKey,
  resolveSessionModelRef,
};

export type {
  GatewayAgentRow,
  GatewaySessionRow,
  GatewaySessionsDefaults,
  SessionsListResult,
  SessionsPatchResult,
  SessionsPreviewEntry,
  SessionsPreviewResult,
} from "./session-utils.types.js";

export function loadSessionEntry(sessionKey: string) {
  const cfg = loadConfig();
  const sessionCfg = cfg.session;
  const canonicalKey = resolveSessionStoreKey({ cfg, sessionKey });
  const agentId = resolveSessionStoreAgentId(cfg, canonicalKey);
  const storePath = resolveStorePath(sessionCfg?.store, { agentId });
  const store = loadSessionStore(storePath);
  const match = findStoreMatch(store, canonicalKey, sessionKey.trim());
  const legacyKey = match?.key !== canonicalKey ? match?.key : undefined;
  return { cfg, storePath, store, entry: match?.entry, canonicalKey, legacyKey };
}

/**
 * Find a session entry by exact or case-insensitive key match.
 * Returns both the entry and the actual store key it was found under,
 * so callers can clean up legacy mixed-case keys when they differ from canonicalKey.
 */
function findStoreMatch(
  store: Record<string, SessionEntry>,
  ...candidates: string[]
): { entry: SessionEntry; key: string } | undefined {
  for (const candidate of candidates) {
    if (candidate && store[candidate]) {
      return { entry: store[candidate], key: candidate };
    }
  }

  const loweredSet = new Set(
    candidates.filter(Boolean).map((candidate) => candidate.toLowerCase()),
  );
  for (const key of Object.keys(store)) {
    if (loweredSet.has(key.toLowerCase())) {
      return { entry: store[key], key };
    }
  }

  return undefined;
}

/**
 * Find all on-disk store keys that match the given key case-insensitively.
 * Returns every key from the store whose lowercased form equals the target's lowercased form.
 */
export function findStoreKeysIgnoreCase(
  store: Record<string, unknown>,
  targetKey: string,
): string[] {
  const lowered = targetKey.toLowerCase();
  const matches: string[] = [];
  for (const key of Object.keys(store)) {
    if (key.toLowerCase() === lowered) {
      matches.push(key);
    }
  }
  return matches;
}

/**
 * Remove legacy key variants for one canonical session key.
 * Candidates can include aliases (for example, "agent:ops:main" when canonical is "agent:ops:work").
 */
export function pruneLegacyStoreKeys(params: {
  store: Record<string, unknown>;
  canonicalKey: string;
  candidates: Iterable<string>;
}) {
  const keysToDelete = new Set<string>();
  for (const candidate of params.candidates) {
    const trimmed = String(candidate ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed !== params.canonicalKey) {
      keysToDelete.add(trimmed);
    }
    for (const match of findStoreKeysIgnoreCase(params.store, trimmed)) {
      if (match !== params.canonicalKey) {
        keysToDelete.add(match);
      }
    }
  }
  for (const key of keysToDelete) {
    delete params.store[key];
  }
}

function isStorePathTemplate(store?: string): boolean {
  return typeof store === "string" && store.includes("{agentId}");
}

function canonicalizeSessionKeyForAgent(agentId: string, key: string): string {
  const lowered = key.toLowerCase();
  if (lowered === "global" || lowered === "unknown") {
    return lowered;
  }
  if (lowered.startsWith("agent:")) {
    return lowered;
  }
  return `agent:${normalizeAgentId(agentId)}:${lowered}`;
}

function resolveDefaultStoreAgentId(cfg: OpenClawConfig): string {
  return normalizeAgentId(resolveDefaultAgentId(cfg));
}

export function resolveSessionStoreKey(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
}): string {
  const raw = params.sessionKey.trim();
  if (!raw) {
    return raw;
  }

  const rawLower = raw.toLowerCase();
  if (rawLower === "global" || rawLower === "unknown") {
    return rawLower;
  }

  const parsed = parseAgentSessionKey(raw);
  if (parsed) {
    const agentId = normalizeAgentId(parsed.agentId);
    const lowered = raw.toLowerCase();
    const canonical = canonicalizeMainSessionAlias({
      cfg: params.cfg,
      agentId,
      sessionKey: lowered,
    });
    return canonical !== lowered ? canonical : lowered;
  }

  const lowered = raw.toLowerCase();
  const rawMainKey = (params.cfg.session?.mainKey ?? "main").trim().toLowerCase() || "main";
  if (lowered === "main" || lowered === rawMainKey) {
    return resolveMainSessionKey(params.cfg);
  }

  const agentId = resolveDefaultStoreAgentId(params.cfg);
  return canonicalizeSessionKeyForAgent(agentId, lowered);
}

function resolveSessionStoreAgentId(cfg: OpenClawConfig, canonicalKey: string): string {
  if (canonicalKey === "global" || canonicalKey === "unknown") {
    return resolveDefaultStoreAgentId(cfg);
  }
  const parsed = parseAgentSessionKey(canonicalKey);
  if (parsed?.agentId) {
    return normalizeAgentId(parsed.agentId);
  }
  return resolveDefaultStoreAgentId(cfg);
}

export function canonicalizeSpawnedByForAgent(
  cfg: OpenClawConfig,
  agentId: string,
  spawnedBy?: string,
): string | undefined {
  const raw = spawnedBy?.trim();
  if (!raw) {
    return undefined;
  }
  const lower = raw.toLowerCase();
  if (lower === "global" || lower === "unknown") {
    return lower;
  }
  const normalized = raw.toLowerCase().startsWith("agent:")
    ? raw.toLowerCase()
    : `agent:${normalizeAgentId(agentId)}:${lower}`;
  const parsed = parseAgentSessionKey(normalized);
  const resolvedAgent = parsed?.agentId ? normalizeAgentId(parsed.agentId) : agentId;
  return canonicalizeMainSessionAlias({ cfg, agentId: resolvedAgent, sessionKey: normalized });
}

export function resolveGatewaySessionStoreTarget(params: {
  cfg: OpenClawConfig;
  key: string;
  scanLegacyKeys?: boolean;
  store?: Record<string, SessionEntry>;
}): {
  agentId: string;
  storePath: string;
  canonicalKey: string;
  storeKeys: string[];
} {
  const key = params.key.trim();
  const canonicalKey = resolveSessionStoreKey({ cfg: params.cfg, sessionKey: key });
  const agentId = resolveSessionStoreAgentId(params.cfg, canonicalKey);
  const storeConfig = params.cfg.session?.store;
  const storePath = resolveStorePath(storeConfig, { agentId });

  if (canonicalKey === "global" || canonicalKey === "unknown") {
    const storeKeys = key && key !== canonicalKey ? [canonicalKey, key] : [key];
    return { agentId, storePath, canonicalKey, storeKeys };
  }

  const storeKeys = new Set<string>();
  storeKeys.add(canonicalKey);
  if (key && key !== canonicalKey) {
    storeKeys.add(key);
  }

  if (params.scanLegacyKeys !== false) {
    const scanTargets = new Set(storeKeys);
    const agentMainKey = resolveAgentMainSessionKey({ cfg: params.cfg, agentId });
    if (canonicalKey === agentMainKey) {
      scanTargets.add(`agent:${agentId}:main`);
    }

    const store = params.store ?? loadSessionStore(storePath);
    for (const seed of scanTargets) {
      for (const legacyKey of findStoreKeysIgnoreCase(store, seed)) {
        storeKeys.add(legacyKey);
      }
    }
  }

  return {
    agentId,
    storePath,
    canonicalKey,
    storeKeys: Array.from(storeKeys),
  };
}

function mergeSessionEntryIntoCombined(params: {
  cfg: OpenClawConfig;
  combined: Record<string, SessionEntry>;
  entry: SessionEntry;
  agentId: string;
  canonicalKey: string;
}) {
  const { cfg, combined, entry, agentId, canonicalKey } = params;
  const existing = combined[canonicalKey];

  if (existing && (existing.updatedAt ?? 0) > (entry.updatedAt ?? 0)) {
    combined[canonicalKey] = {
      ...entry,
      ...existing,
      spawnedBy: canonicalizeSpawnedByForAgent(cfg, agentId, existing.spawnedBy ?? entry.spawnedBy),
    };
    return;
  }

  combined[canonicalKey] = {
    ...existing,
    ...entry,
    spawnedBy: canonicalizeSpawnedByForAgent(cfg, agentId, entry.spawnedBy ?? existing?.spawnedBy),
  };
}

export function loadCombinedSessionStoreForGateway(cfg: OpenClawConfig): {
  storePath: string;
  store: Record<string, SessionEntry>;
} {
  const storeConfig = cfg.session?.store;
  if (storeConfig && !isStorePathTemplate(storeConfig)) {
    const storePath = resolveStorePath(storeConfig);
    const defaultAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
    const store = loadSessionStore(storePath);
    const combined: Record<string, SessionEntry> = {};
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = canonicalizeSessionKeyForAgent(defaultAgentId, key);
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId: defaultAgentId,
        canonicalKey,
      });
    }
    return { storePath, store: combined };
  }

  const combined: Record<string, SessionEntry> = {};
  for (const agentId of listConfiguredAgentIds(cfg)) {
    const storePath = resolveStorePath(storeConfig, { agentId });
    const store = loadSessionStore(storePath);
    for (const [key, entry] of Object.entries(store)) {
      const canonicalKey = canonicalizeSessionKeyForAgent(agentId, key);
      mergeSessionEntryIntoCombined({
        cfg,
        combined,
        entry,
        agentId,
        canonicalKey,
      });
    }
  }

  const storePath =
    typeof storeConfig === "string" && storeConfig.trim() ? storeConfig.trim() : "(multiple)";
  return { storePath, store: combined };
}
