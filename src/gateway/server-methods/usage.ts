import fs from "node:fs";
import type { SessionEntry, SessionSystemPromptReport } from "../../config/sessions/types.js";
import type {
  CostUsageSummary,
  SessionCostSummary,
  SessionDailyLatency,
  SessionDailyModelUsage,
  SessionMessageCounts,
  SessionLatencyStats,
  SessionModelUsage,
  SessionToolUsage,
} from "../../infra/session-cost-usage.js";
import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig } from "../../config/config.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
} from "../../config/sessions/paths.js";
import { loadProviderUsageSummary } from "../../infra/provider-usage.js";
import { loadSessionUsageTimeSeries } from "../../infra/session-cost-usage.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSessionsUsageParams,
} from "../protocol/index.js";
import { loadCombinedSessionStoreForGateway } from "../session-utils.js";
import { buildSessionsUsageResult, type MergedUsageEntry } from "./usage-aggregate.js";
import {
  discoverAllSessionsForUsage,
  loadCostUsageSummaryCached,
  parseDateRange,
  resolveSessionUsageFileOrRespond,
  usageQueryTestExports,
} from "./usage-query.js";

// Exposed for unit tests (kept as a single export to avoid widening the public API surface).
export const __test = usageQueryTestExports;

export type SessionUsageEntry = {
  key: string;
  label?: string;
  sessionId?: string;
  updatedAt?: number;
  agentId?: string;
  channel?: string;
  chatType?: string;
  origin?: {
    label?: string;
    provider?: string;
    surface?: string;
    chatType?: string;
    from?: string;
    to?: string;
    accountId?: string;
    threadId?: string | number;
  };
  modelOverride?: string;
  providerOverride?: string;
  modelProvider?: string;
  model?: string;
  usage: SessionCostSummary | null;
  contextWeight?: SessionSystemPromptReport | null;
};

export type SessionsUsageAggregates = {
  messages: SessionMessageCounts;
  tools: SessionToolUsage;
  byModel: SessionModelUsage[];
  byProvider: SessionModelUsage[];
  byAgent: Array<{ agentId: string; totals: CostUsageSummary["totals"] }>;
  byChannel: Array<{ channel: string; totals: CostUsageSummary["totals"] }>;
  latency?: SessionLatencyStats;
  dailyLatency?: SessionDailyLatency[];
  modelDaily?: SessionDailyModelUsage[];
  daily: Array<{
    date: string;
    tokens: number;
    cost: number;
    messages: number;
    toolCalls: number;
    errors: number;
  }>;
};

export type SessionsUsageResult = {
  updatedAt: number;
  startDate: string;
  endDate: string;
  sessions: SessionUsageEntry[];
  totals: CostUsageSummary["totals"];
  aggregates: SessionsUsageAggregates;
};

export const usageHandlers: GatewayRequestHandlers = {
  "usage.status": async ({ respond }) => {
    const summary = await loadProviderUsageSummary();
    respond(true, summary, undefined);
  },
  "usage.cost": async ({ respond, params }) => {
    const config = loadConfig();
    const { startMs, endMs } = parseDateRange({
      startDate: params?.startDate,
      endDate: params?.endDate,
      days: params?.days,
    });
    const summary = await loadCostUsageSummaryCached({ startMs, endMs, config });
    respond(true, summary, undefined);
  },
  "sessions.usage": async ({ respond, params }) => {
    if (!validateSessionsUsageParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.usage params: ${formatValidationErrors(validateSessionsUsageParams.errors)}`,
        ),
      );
      return;
    }

    const p = params;
    const config = loadConfig();
    const { startMs, endMs } = parseDateRange({
      startDate: p.startDate,
      endDate: p.endDate,
    });
    const limit = typeof p.limit === "number" && Number.isFinite(p.limit) ? p.limit : 50;
    const includeContextWeight = p.includeContextWeight ?? false;
    const specificKey = typeof p.key === "string" ? p.key.trim() : null;

    // Load session store for named sessions
    const { storePath, store } = loadCombinedSessionStoreForGateway(config);
    const now = Date.now();

    // Merge discovered sessions with store entries
    const mergedEntries: MergedUsageEntry[] = [];

    // Optimization: If a specific key is requested, skip full directory scan
    if (specificKey) {
      const parsed = parseAgentSessionKey(specificKey);
      const agentIdFromKey = parsed?.agentId;
      const keyRest = parsed?.rest ?? specificKey;

      // Prefer the store entry when available, even if the caller provides a discovered key
      // (`agent:<id>:<sessionId>`) for a session that now has a canonical store key.
      const storeBySessionId = new Map<string, { key: string; entry: SessionEntry }>();
      for (const [key, entry] of Object.entries(store)) {
        if (entry?.sessionId) {
          storeBySessionId.set(entry.sessionId, { key, entry });
        }
      }

      const storeMatch = store[specificKey]
        ? { key: specificKey, entry: store[specificKey] }
        : null;
      const storeByIdMatch = storeBySessionId.get(keyRest) ?? null;
      const resolvedStoreKey = storeMatch?.key ?? storeByIdMatch?.key ?? specificKey;
      const storeEntry = storeMatch?.entry ?? storeByIdMatch?.entry;
      const sessionId = storeEntry?.sessionId ?? keyRest;

      // Resolve the session file path
      let sessionFile: string;
      try {
        const pathOpts = resolveSessionFilePathOptions({
          storePath: storePath !== "(multiple)" ? storePath : undefined,
          agentId: agentIdFromKey,
        });
        sessionFile = resolveSessionFilePath(sessionId, storeEntry, pathOpts);
      } catch {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Invalid session reference: ${specificKey}`),
        );
        return;
      }

      try {
        const stats = fs.statSync(sessionFile);
        if (stats.isFile()) {
          mergedEntries.push({
            key: resolvedStoreKey,
            sessionId,
            sessionFile,
            label: storeEntry?.label,
            updatedAt: storeEntry?.updatedAt ?? stats.mtimeMs,
            storeEntry,
          });
        }
      } catch {
        // File doesn't exist - no results for this key
      }
    } else {
      // Full discovery for list view
      const discoveredSessions = await discoverAllSessionsForUsage({
        config,
        startMs,
        endMs,
      });

      // Build a map of sessionId -> store entry for quick lookup
      const storeBySessionId = new Map<string, { key: string; entry: SessionEntry }>();
      for (const [key, entry] of Object.entries(store)) {
        if (entry?.sessionId) {
          storeBySessionId.set(entry.sessionId, { key, entry });
        }
      }

      for (const discovered of discoveredSessions) {
        const storeMatch = storeBySessionId.get(discovered.sessionId);
        if (storeMatch) {
          // Named session from store
          mergedEntries.push({
            key: storeMatch.key,
            sessionId: discovered.sessionId,
            sessionFile: discovered.sessionFile,
            label: storeMatch.entry.label,
            updatedAt: storeMatch.entry.updatedAt ?? discovered.mtime,
            storeEntry: storeMatch.entry,
          });
        } else {
          // Unnamed session - use session ID as key, no label
          mergedEntries.push({
            // Keep agentId in the key so the dashboard can attribute sessions and later fetch logs.
            key: `agent:${discovered.agentId}:${discovered.sessionId}`,
            sessionId: discovered.sessionId,
            sessionFile: discovered.sessionFile,
            label: undefined, // No label for unnamed sessions
            updatedAt: discovered.mtime,
          });
        }
      }
    }

    // Sort by most recent first
    mergedEntries.sort((a, b) => b.updatedAt - a.updatedAt);

    // Apply limit
    const limitedEntries = mergedEntries.slice(0, limit);

    const result = await buildSessionsUsageResult({
      entries: limitedEntries,
      includeContextWeight,
      config,
      startMs,
      endMs,
      now,
    });
    respond(true, result, undefined);
  },
  "sessions.usage.timeseries": async ({ respond, params }) => {
    const key = typeof params?.key === "string" ? params.key.trim() : null;
    if (!key) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "key is required for timeseries"),
      );
      return;
    }

    const resolved = resolveSessionUsageFileOrRespond(key, respond);
    if (!resolved) {
      return;
    }
    const { config, entry, agentId, sessionId, sessionFile } = resolved;

    const timeseries = await loadSessionUsageTimeSeries({
      sessionId,
      sessionEntry: entry,
      sessionFile,
      config,
      agentId,
      maxPoints: 200,
    });

    if (!timeseries) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `No transcript found for session: ${key}`),
      );
      return;
    }

    respond(true, timeseries, undefined);
  },
  "sessions.usage.logs": async ({ respond, params }) => {
    const key = typeof params?.key === "string" ? params.key.trim() : null;
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key is required for logs"));
      return;
    }

    const limit =
      typeof params?.limit === "number" && Number.isFinite(params.limit)
        ? Math.min(params.limit, 1000)
        : 200;

    const resolved = resolveSessionUsageFileOrRespond(key, respond);
    if (!resolved) {
      return;
    }
    const { config, entry, agentId, sessionId, sessionFile } = resolved;

    const { loadSessionLogs } = await import("../../infra/session-cost-usage.js");
    const logs = await loadSessionLogs({
      sessionId,
      sessionEntry: entry,
      sessionFile,
      config,
      agentId,
      limit,
    });

    respond(true, { logs: logs ?? [] }, undefined);
  },
};
