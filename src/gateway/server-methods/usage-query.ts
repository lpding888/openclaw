import type { SessionEntry } from "../../config/sessions/types.js";
import type { RespondFn } from "./types.js";
import { loadConfig } from "../../config/config.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
} from "../../config/sessions/paths.js";
import {
  discoverAllSessions,
  loadCostUsageSummary,
  type CostUsageSummary,
  type DiscoveredSession,
} from "../../infra/session-cost-usage.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { listAgentsForGateway, loadSessionEntry } from "../session-utils.js";

const COST_USAGE_CACHE_TTL_MS = 30_000;

type DateRange = { startMs: number; endMs: number };

type CostUsageCacheEntry = {
  summary?: CostUsageSummary;
  updatedAt?: number;
  inFlight?: Promise<CostUsageSummary>;
};

const costUsageCache = new Map<string, CostUsageCacheEntry>();

export function resolveSessionUsageFileOrRespond(
  key: string,
  respond: RespondFn,
): {
  config: ReturnType<typeof loadConfig>;
  entry: SessionEntry | undefined;
  agentId: string | undefined;
  sessionId: string;
  sessionFile: string;
} | null {
  const config = loadConfig();
  const { entry, storePath } = loadSessionEntry(key);

  const parsed = parseAgentSessionKey(key);
  const agentId = parsed?.agentId;
  const rawSessionId = parsed?.rest ?? key;
  const sessionId = entry?.sessionId ?? rawSessionId;
  let sessionFile: string;
  try {
    const pathOpts = resolveSessionFilePathOptions({ storePath, agentId });
    sessionFile = resolveSessionFilePath(sessionId, entry, pathOpts);
  } catch {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `Invalid session key: ${key}`),
    );
    return null;
  }

  return { config, entry, agentId, sessionId, sessionFile };
}

export const parseDateToMs = (raw: unknown): number | undefined => {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const [, year, month, day] = match;
  const ms = Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day));
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return ms;
};

export const parseDays = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return undefined;
};

export const parseDateRange = (params: {
  startDate?: unknown;
  endDate?: unknown;
  days?: unknown;
}): DateRange => {
  const now = new Date();
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayEndMs = todayStartMs + 24 * 60 * 60 * 1000 - 1;

  const startMs = parseDateToMs(params.startDate);
  const endMs = parseDateToMs(params.endDate);

  if (startMs !== undefined && endMs !== undefined) {
    return { startMs, endMs: endMs + 24 * 60 * 60 * 1000 - 1 };
  }

  const days = parseDays(params.days);
  if (days !== undefined) {
    const clampedDays = Math.max(1, days);
    const start = todayStartMs - (clampedDays - 1) * 24 * 60 * 60 * 1000;
    return { startMs: start, endMs: todayEndMs };
  }

  const defaultStartMs = todayStartMs - 29 * 24 * 60 * 60 * 1000;
  return { startMs: defaultStartMs, endMs: todayEndMs };
};

type DiscoveredSessionWithAgent = DiscoveredSession & { agentId: string };

export async function discoverAllSessionsForUsage(params: {
  config: ReturnType<typeof loadConfig>;
  startMs: number;
  endMs: number;
}): Promise<DiscoveredSessionWithAgent[]> {
  const agents = listAgentsForGateway(params.config).agents;
  const results = await Promise.all(
    agents.map(async (agent) => {
      const sessions = await discoverAllSessions({
        agentId: agent.id,
        startMs: params.startMs,
        endMs: params.endMs,
      });
      return sessions.map((session) => ({ ...session, agentId: agent.id }));
    }),
  );
  return results.flat().toSorted((a, b) => b.mtime - a.mtime);
}

export async function loadCostUsageSummaryCached(params: {
  startMs: number;
  endMs: number;
  config: ReturnType<typeof loadConfig>;
}): Promise<CostUsageSummary> {
  const cacheKey = `${params.startMs}-${params.endMs}`;
  const now = Date.now();
  const cached = costUsageCache.get(cacheKey);
  if (cached?.summary && cached.updatedAt && now - cached.updatedAt < COST_USAGE_CACHE_TTL_MS) {
    return cached.summary;
  }

  if (cached?.inFlight) {
    if (cached.summary) {
      return cached.summary;
    }
    return await cached.inFlight;
  }

  const entry: CostUsageCacheEntry = cached ?? {};
  const inFlight = loadCostUsageSummary({
    startMs: params.startMs,
    endMs: params.endMs,
    config: params.config,
  })
    .then((summary) => {
      costUsageCache.set(cacheKey, { summary, updatedAt: Date.now() });
      return summary;
    })
    .catch((err) => {
      if (entry.summary) {
        return entry.summary;
      }
      throw err;
    })
    .finally(() => {
      const current = costUsageCache.get(cacheKey);
      if (current?.inFlight === inFlight) {
        current.inFlight = undefined;
        costUsageCache.set(cacheKey, current);
      }
    });

  entry.inFlight = inFlight;
  costUsageCache.set(cacheKey, entry);

  if (entry.summary) {
    return entry.summary;
  }
  return await inFlight;
}

export const usageQueryTestExports = {
  parseDateToMs,
  parseDays,
  parseDateRange,
  discoverAllSessionsForUsage,
  loadCostUsageSummaryCached,
  costUsageCache,
};
