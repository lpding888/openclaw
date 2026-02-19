import type { ChannelAccountHealthSummary, HealthSummary } from "./health.js";
import { getChannelPlugin } from "../channels/plugins/index.js";

export const formatDurationParts = (ms: number): string => {
  if (!Number.isFinite(ms)) {
    return "unknown";
  }
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }
  const units: Array<{ label: string; size: number }> = [
    { label: "w", size: 7 * 24 * 60 * 60 * 1000 },
    { label: "d", size: 24 * 60 * 60 * 1000 },
    { label: "h", size: 60 * 60 * 1000 },
    { label: "m", size: 60 * 1000 },
    { label: "s", size: 1000 },
  ];
  let remaining = Math.max(0, Math.floor(ms));
  const parts: string[] = [];
  for (const unit of units) {
    const value = Math.floor(remaining / unit.size);
    if (value > 0) {
      parts.push(`${value}${unit.label}`);
      remaining -= value * unit.size;
    }
  }
  if (parts.length === 0) {
    return "0s";
  }
  return parts.join(" ");
};

export const isAccountEnabled = (account: unknown): boolean => {
  if (!account || typeof account !== "object") {
    return true;
  }
  const enabled = (account as { enabled?: boolean }).enabled;
  return enabled !== false;
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const formatProbeLine = (probe: unknown, opts: { botUsernames?: string[] } = {}): string | null => {
  const record = asRecord(probe);
  if (!record) {
    return null;
  }
  const ok = typeof record.ok === "boolean" ? record.ok : undefined;
  if (ok === undefined) {
    return null;
  }
  const elapsedMs = typeof record.elapsedMs === "number" ? record.elapsedMs : null;
  const status = typeof record.status === "number" ? record.status : null;
  const error = typeof record.error === "string" ? record.error : null;
  const bot = asRecord(record.bot);
  const botUsername = bot && typeof bot.username === "string" ? bot.username : null;
  const webhook = asRecord(record.webhook);
  const webhookUrl = webhook && typeof webhook.url === "string" ? webhook.url : null;

  const usernames = new Set<string>();
  if (botUsername) {
    usernames.add(botUsername);
  }
  for (const extra of opts.botUsernames ?? []) {
    if (extra) {
      usernames.add(extra);
    }
  }

  if (ok) {
    let label = "ok";
    if (usernames.size > 0) {
      label += ` (@${Array.from(usernames).join(", @")})`;
    }
    if (elapsedMs != null) {
      label += ` (${elapsedMs}ms)`;
    }
    if (webhookUrl) {
      label += ` - webhook ${webhookUrl}`;
    }
    return label;
  }

  let label = `failed (${status ?? "unknown"})`;
  if (error) {
    label += ` - ${error}`;
  }
  return label;
};

const formatAccountProbeTiming = (summary: ChannelAccountHealthSummary): string | null => {
  const probe = asRecord(summary.probe);
  if (!probe) {
    return null;
  }
  const elapsedMs = typeof probe.elapsedMs === "number" ? Math.round(probe.elapsedMs) : null;
  const ok = typeof probe.ok === "boolean" ? probe.ok : null;
  if (elapsedMs == null && ok !== true) {
    return null;
  }

  const accountId = summary.accountId || "default";
  const botRecord = asRecord(probe.bot);
  const botUsername =
    botRecord && typeof botRecord.username === "string" ? botRecord.username : null;
  const handle = botUsername ? `@${botUsername}` : accountId;
  const timing = elapsedMs != null ? `${elapsedMs}ms` : "ok";

  return `${handle}:${accountId}:${timing}`;
};

const isProbeFailure = (summary: ChannelAccountHealthSummary): boolean => {
  const probe = asRecord(summary.probe);
  if (!probe) {
    return false;
  }
  const ok = typeof probe.ok === "boolean" ? probe.ok : null;
  return ok === false;
};

export const formatHealthChannelLines = (
  summary: HealthSummary,
  opts: {
    accountMode?: "default" | "all";
    accountIdsByChannel?: Record<string, string[] | undefined>;
  } = {},
): string[] => {
  const channels = summary.channels ?? {};
  const channelOrder =
    summary.channelOrder?.length > 0 ? summary.channelOrder : Object.keys(channels);
  const accountMode = opts.accountMode ?? "default";

  const lines: string[] = [];
  for (const channelId of channelOrder) {
    const channelSummary = channels[channelId];
    if (!channelSummary) {
      continue;
    }
    const plugin = getChannelPlugin(channelId as never);
    const label = summary.channelLabels?.[channelId] ?? plugin?.meta.label ?? channelId;
    const accountSummaries = channelSummary.accounts ?? {};
    const accountIds = opts.accountIdsByChannel?.[channelId];
    const filteredSummaries =
      accountIds && accountIds.length > 0
        ? accountIds
            .map((accountId) => accountSummaries[accountId])
            .filter((entry): entry is ChannelAccountHealthSummary => Boolean(entry))
        : undefined;
    const listSummaries =
      accountMode === "all"
        ? Object.values(accountSummaries)
        : (filteredSummaries ?? (channelSummary.accounts ? Object.values(accountSummaries) : []));
    const baseSummary =
      filteredSummaries && filteredSummaries.length > 0 ? filteredSummaries[0] : channelSummary;
    const botUsernames = listSummaries
      .map((account) => {
        const probeRecord = asRecord(account.probe);
        const bot = probeRecord ? asRecord(probeRecord.bot) : null;
        return bot && typeof bot.username === "string" ? bot.username : null;
      })
      .filter((value): value is string => Boolean(value));
    const linked = typeof baseSummary.linked === "boolean" ? baseSummary.linked : null;
    if (linked !== null) {
      if (linked) {
        const authAgeMs = typeof baseSummary.authAgeMs === "number" ? baseSummary.authAgeMs : null;
        const authLabel = authAgeMs != null ? ` (auth age ${Math.round(authAgeMs / 60000)}m)` : "";
        lines.push(`${label}: linked${authLabel}`);
      } else {
        lines.push(`${label}: not linked`);
      }
      continue;
    }

    const configured = typeof baseSummary.configured === "boolean" ? baseSummary.configured : null;
    if (configured === false) {
      lines.push(`${label}: not configured`);
      continue;
    }

    const accountTimings =
      accountMode === "all"
        ? listSummaries
            .map((account) => formatAccountProbeTiming(account))
            .filter((value): value is string => Boolean(value))
        : [];
    const failedSummary = listSummaries.find((entry) => isProbeFailure(entry));
    if (failedSummary) {
      const failureLine = formatProbeLine(failedSummary.probe, { botUsernames });
      if (failureLine) {
        lines.push(`${label}: ${failureLine}`);
        continue;
      }
    }

    if (accountTimings.length > 0) {
      lines.push(`${label}: ok (${accountTimings.join(", ")})`);
      continue;
    }

    const probeLine = formatProbeLine(baseSummary.probe, { botUsernames });
    if (probeLine) {
      lines.push(`${label}: ${probeLine}`);
      continue;
    }

    if (configured === true) {
      lines.push(`${label}: configured`);
      continue;
    }
    lines.push(`${label}: unknown`);
  }
  return lines;
};
