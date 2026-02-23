import { loadConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import {
  loadSessionCostSummary,
  type CostUsageSummary,
  type SessionDailyModelUsage,
  type SessionMessageCounts,
  type SessionModelUsage,
} from "../../infra/session-cost-usage.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { buildUsageAggregateTail } from "../../shared/usage-aggregates.js";
import type { SessionUsageEntry, SessionsUsageAggregates, SessionsUsageResult } from "./usage.js";

export type MergedUsageEntry = {
  key: string;
  sessionId: string;
  sessionFile: string;
  label?: string;
  updatedAt: number;
  storeEntry?: SessionEntry;
  firstUserMessage?: string;
};

const emptyTotals = (): CostUsageSummary["totals"] => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  totalCost: 0,
  inputCost: 0,
  outputCost: 0,
  cacheReadCost: 0,
  cacheWriteCost: 0,
  missingCostEntries: 0,
});

const mergeTotals = (target: CostUsageSummary["totals"], source: CostUsageSummary["totals"]) => {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.totalTokens += source.totalTokens;
  target.totalCost += source.totalCost;
  target.inputCost += source.inputCost;
  target.outputCost += source.outputCost;
  target.cacheReadCost += source.cacheReadCost;
  target.cacheWriteCost += source.cacheWriteCost;
  target.missingCostEntries += source.missingCostEntries;
};

const formatDateStr = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

export async function buildSessionsUsageResult(params: {
  entries: MergedUsageEntry[];
  includeContextWeight: boolean;
  config: ReturnType<typeof loadConfig>;
  startMs: number;
  endMs: number;
  now: number;
}): Promise<SessionsUsageResult> {
  const { entries, includeContextWeight, config, startMs, endMs, now } = params;

  const sessions: SessionUsageEntry[] = [];
  const aggregateTotals = emptyTotals();
  const aggregateMessages: SessionMessageCounts = {
    total: 0,
    user: 0,
    assistant: 0,
    toolCalls: 0,
    toolResults: 0,
    errors: 0,
  };
  const toolAggregateMap = new Map<string, number>();
  const byModelMap = new Map<string, SessionModelUsage>();
  const byProviderMap = new Map<string, SessionModelUsage>();
  const byAgentMap = new Map<string, CostUsageSummary["totals"]>();
  const byChannelMap = new Map<string, CostUsageSummary["totals"]>();
  const dailyAggregateMap = new Map<
    string,
    {
      date: string;
      tokens: number;
      cost: number;
      messages: number;
      toolCalls: number;
      errors: number;
    }
  >();
  const latencyTotals = {
    count: 0,
    sum: 0,
    min: Number.POSITIVE_INFINITY,
    max: 0,
    p95Max: 0,
  };
  const dailyLatencyMap = new Map<
    string,
    { date: string; count: number; sum: number; min: number; max: number; p95Max: number }
  >();
  const modelDailyMap = new Map<string, SessionDailyModelUsage>();

  for (const merged of entries) {
    const agentId = parseAgentSessionKey(merged.key)?.agentId;
    const usage = await loadSessionCostSummary({
      sessionId: merged.sessionId,
      sessionEntry: merged.storeEntry,
      sessionFile: merged.sessionFile,
      config,
      agentId,
      startMs,
      endMs,
    });

    if (usage) {
      aggregateTotals.input += usage.input;
      aggregateTotals.output += usage.output;
      aggregateTotals.cacheRead += usage.cacheRead;
      aggregateTotals.cacheWrite += usage.cacheWrite;
      aggregateTotals.totalTokens += usage.totalTokens;
      aggregateTotals.totalCost += usage.totalCost;
      aggregateTotals.inputCost += usage.inputCost;
      aggregateTotals.outputCost += usage.outputCost;
      aggregateTotals.cacheReadCost += usage.cacheReadCost;
      aggregateTotals.cacheWriteCost += usage.cacheWriteCost;
      aggregateTotals.missingCostEntries += usage.missingCostEntries;
    }

    const channel = merged.storeEntry?.channel ?? merged.storeEntry?.origin?.provider;
    const chatType = merged.storeEntry?.chatType ?? merged.storeEntry?.origin?.chatType;

    if (usage) {
      if (usage.messageCounts) {
        aggregateMessages.total += usage.messageCounts.total;
        aggregateMessages.user += usage.messageCounts.user;
        aggregateMessages.assistant += usage.messageCounts.assistant;
        aggregateMessages.toolCalls += usage.messageCounts.toolCalls;
        aggregateMessages.toolResults += usage.messageCounts.toolResults;
        aggregateMessages.errors += usage.messageCounts.errors;
      }

      if (usage.toolUsage) {
        for (const tool of usage.toolUsage.tools) {
          toolAggregateMap.set(tool.name, (toolAggregateMap.get(tool.name) ?? 0) + tool.count);
        }
      }

      if (usage.modelUsage) {
        for (const entry of usage.modelUsage) {
          const modelKey = `${entry.provider ?? "unknown"}::${entry.model ?? "unknown"}`;
          const modelExisting =
            byModelMap.get(modelKey) ??
            ({
              provider: entry.provider,
              model: entry.model,
              count: 0,
              totals: emptyTotals(),
            } as SessionModelUsage);
          modelExisting.count += entry.count;
          mergeTotals(modelExisting.totals, entry.totals);
          byModelMap.set(modelKey, modelExisting);

          const providerKey = entry.provider ?? "unknown";
          const providerExisting =
            byProviderMap.get(providerKey) ??
            ({
              provider: entry.provider,
              model: undefined,
              count: 0,
              totals: emptyTotals(),
            } as SessionModelUsage);
          providerExisting.count += entry.count;
          mergeTotals(providerExisting.totals, entry.totals);
          byProviderMap.set(providerKey, providerExisting);
        }
      }

      if (usage.latency) {
        const { count, avgMs, minMs, maxMs, p95Ms } = usage.latency;
        if (count > 0) {
          latencyTotals.count += count;
          latencyTotals.sum += avgMs * count;
          latencyTotals.min = Math.min(latencyTotals.min, minMs);
          latencyTotals.max = Math.max(latencyTotals.max, maxMs);
          latencyTotals.p95Max = Math.max(latencyTotals.p95Max, p95Ms);
        }
      }

      if (usage.dailyLatency) {
        for (const day of usage.dailyLatency) {
          const existing = dailyLatencyMap.get(day.date) ?? {
            date: day.date,
            count: 0,
            sum: 0,
            min: Number.POSITIVE_INFINITY,
            max: 0,
            p95Max: 0,
          };
          existing.count += day.count;
          existing.sum += day.avgMs * day.count;
          existing.min = Math.min(existing.min, day.minMs);
          existing.max = Math.max(existing.max, day.maxMs);
          existing.p95Max = Math.max(existing.p95Max, day.p95Ms);
          dailyLatencyMap.set(day.date, existing);
        }
      }

      if (usage.dailyModelUsage) {
        for (const entry of usage.dailyModelUsage) {
          const key = `${entry.date}::${entry.provider ?? "unknown"}::${entry.model ?? "unknown"}`;
          const existing =
            modelDailyMap.get(key) ??
            ({
              date: entry.date,
              provider: entry.provider,
              model: entry.model,
              tokens: 0,
              cost: 0,
              count: 0,
            } as SessionDailyModelUsage);
          existing.tokens += entry.tokens;
          existing.cost += entry.cost;
          existing.count += entry.count;
          modelDailyMap.set(key, existing);
        }
      }

      if (agentId) {
        const agentTotals = byAgentMap.get(agentId) ?? emptyTotals();
        mergeTotals(agentTotals, usage);
        byAgentMap.set(agentId, agentTotals);
      }

      if (channel) {
        const channelTotals = byChannelMap.get(channel) ?? emptyTotals();
        mergeTotals(channelTotals, usage);
        byChannelMap.set(channel, channelTotals);
      }

      if (usage.dailyBreakdown) {
        for (const day of usage.dailyBreakdown) {
          const daily = dailyAggregateMap.get(day.date) ?? {
            date: day.date,
            tokens: 0,
            cost: 0,
            messages: 0,
            toolCalls: 0,
            errors: 0,
          };
          daily.tokens += day.tokens;
          daily.cost += day.cost;
          dailyAggregateMap.set(day.date, daily);
        }
      }

      if (usage.dailyMessageCounts) {
        for (const day of usage.dailyMessageCounts) {
          const daily = dailyAggregateMap.get(day.date) ?? {
            date: day.date,
            tokens: 0,
            cost: 0,
            messages: 0,
            toolCalls: 0,
            errors: 0,
          };
          daily.messages += day.total;
          daily.toolCalls += day.toolCalls;
          daily.errors += day.errors;
          dailyAggregateMap.set(day.date, daily);
        }
      }
    }

    sessions.push({
      key: merged.key,
      label: merged.label,
      sessionId: merged.sessionId,
      updatedAt: merged.updatedAt,
      agentId,
      channel,
      chatType,
      origin: merged.storeEntry?.origin,
      modelOverride: merged.storeEntry?.modelOverride,
      providerOverride: merged.storeEntry?.providerOverride,
      modelProvider: merged.storeEntry?.modelProvider,
      model: merged.storeEntry?.model,
      usage,
      contextWeight: includeContextWeight
        ? (merged.storeEntry?.systemPromptReport ?? null)
        : undefined,
    });
  }

  const tail = buildUsageAggregateTail({
    byChannelMap: byChannelMap,
    latencyTotals,
    dailyLatencyMap,
    modelDailyMap,
    dailyMap: dailyAggregateMap,
  });

  const aggregates: SessionsUsageAggregates = {
    messages: aggregateMessages,
    tools: {
      totalCalls: Array.from(toolAggregateMap.values()).reduce((sum, count) => sum + count, 0),
      uniqueTools: toolAggregateMap.size,
      tools: Array.from(toolAggregateMap.entries())
        .map(([name, count]) => ({ name, count }))
        .toSorted((a, b) => b.count - a.count),
    },
    byModel: Array.from(byModelMap.values()).toSorted((a, b) => {
      const costDiff = b.totals.totalCost - a.totals.totalCost;
      if (costDiff !== 0) {
        return costDiff;
      }
      return b.totals.totalTokens - a.totals.totalTokens;
    }),
    byProvider: Array.from(byProviderMap.values()).toSorted((a, b) => {
      const costDiff = b.totals.totalCost - a.totals.totalCost;
      if (costDiff !== 0) {
        return costDiff;
      }
      return b.totals.totalTokens - a.totals.totalTokens;
    }),
    byAgent: Array.from(byAgentMap.entries())
      .map(([id, totals]) => ({ agentId: id, totals }))
      .toSorted((a, b) => b.totals.totalCost - a.totals.totalCost),
    ...tail,
  };

  return {
    updatedAt: now,
    startDate: formatDateStr(startMs),
    endDate: formatDateStr(endMs),
    sessions,
    totals: aggregateTotals,
    aggregates,
  };
}
