import type {
  ChatFeedbackDraft,
  ChatFeedbackItem,
  ChatFeedbackRating,
  ChatFeedbackTag,
  ChatTimelineEvent,
  ChatTimelineRunStatus,
  ChatTimelineRunSummary,
} from "../types.ts";

const CHAT_TIMELINE_RUNS_METHOD_UNKNOWN_RE =
  /unknown method:\s*chat\.timeline\.runs|invalid request:\s*unknown method:\s*chat\.timeline\.runs/i;
const CHAT_FEEDBACK_LIST_METHOD_UNKNOWN_RE =
  /unknown method:\s*chat\.feedback\.list|invalid request:\s*unknown method:\s*chat\.feedback\.list/i;
const CHAT_FEEDBACK_SUBMIT_METHOD_UNKNOWN_RE =
  /unknown method:\s*chat\.feedback\.submit|invalid request:\s*unknown method:\s*chat\.feedback\.submit/i;

export const CHAT_FEEDBACK_TAGS: ChatFeedbackTag[] = [
  "accuracy",
  "clarity",
  "latency",
  "tool",
  "reasoning",
  "format",
  "other",
];

export const CHAT_FEEDBACK_DEFAULT_DRAFT: ChatFeedbackDraft = {
  rating: null,
  tags: [],
  comment: "",
  applyScope: "agent",
  open: false,
};

type ChatObservabilityClient = {
  request(method: string, params?: unknown): Promise<unknown>;
};

type ChatObservabilityState = {
  client: ChatObservabilityClient | null;
  connected: boolean;
  sessionKey: string;
  chatRunId: string | null;
  chatMessage: string;
  chatTimelineEvents: ChatTimelineEvent[];
  chatTimelineRuns: ChatTimelineRunSummary[];
  chatTimelineRunsLoading: boolean;
  chatTimelineRunsError: string | null;
  chatTimelineRunsServerSupported: boolean;
  chatFeedbackItems: ChatFeedbackItem[];
  chatFeedbackLoading: boolean;
  chatFeedbackError: string | null;
  chatFeedbackServerSupported: boolean;
  chatFeedbackSubmitting: Record<string, boolean>;
  chatFeedbackSubmitErrors: Record<string, string | null>;
};

export type SubmitChatFeedbackParams = {
  sessionKey: string;
  runId: string;
  messageId: string;
  rating: ChatFeedbackRating;
  tags?: ChatFeedbackTag[];
  comment?: string;
  applyScope?: "agent";
  source?: "chat-ui";
};

function normalizeRunStatus(value: unknown): ChatTimelineRunStatus | null {
  if (value === "running" || value === "success" || value === "error" || value === "aborted") {
    return value;
  }
  return null;
}

function normalizeRunSummary(raw: unknown): ChatTimelineRunSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const sessionKey = typeof row.sessionKey === "string" ? row.sessionKey.trim() : "";
  const runId = typeof row.runId === "string" ? row.runId.trim() : "";
  const startedAt = typeof row.startedAt === "number" ? row.startedAt : NaN;
  const status = normalizeRunStatus(row.status);
  const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : NaN;
  if (
    !sessionKey ||
    !runId ||
    !status ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(updatedAt)
  ) {
    return null;
  }
  const asNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return {
    sessionKey,
    runId,
    startedAt,
    endedAt: asNumber(row.endedAt),
    status,
    totalMs: asNumber(row.totalMs),
    firstTokenMs: asNumber(row.firstTokenMs),
    toolCalls: Math.max(0, Math.floor(asNumber(row.toolCalls) ?? 0)),
    toolErrors: Math.max(0, Math.floor(asNumber(row.toolErrors) ?? 0)),
    assistantChars: Math.max(0, Math.floor(asNumber(row.assistantChars) ?? 0)),
    compactionCount: Math.max(0, Math.floor(asNumber(row.compactionCount) ?? 0)),
    truncatedEvents: Math.max(0, Math.floor(asNumber(row.truncatedEvents) ?? 0)),
    inputTokens: asNumber(row.inputTokens),
    outputTokens: asNumber(row.outputTokens),
    updatedAt,
  };
}

function normalizeFeedbackTag(value: unknown): ChatFeedbackTag | null {
  if (
    value === "accuracy" ||
    value === "clarity" ||
    value === "latency" ||
    value === "tool" ||
    value === "reasoning" ||
    value === "format" ||
    value === "other"
  ) {
    return value;
  }
  return null;
}

function normalizeFeedbackItem(raw: unknown): ChatFeedbackItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const feedbackId = typeof row.feedbackId === "string" ? row.feedbackId.trim() : "";
  const sessionKey = typeof row.sessionKey === "string" ? row.sessionKey.trim() : "";
  const runId = typeof row.runId === "string" ? row.runId.trim() : "";
  const messageId = typeof row.messageId === "string" ? row.messageId.trim() : "";
  const rating = row.rating === "up" || row.rating === "down" ? row.rating : null;
  const applyScope = row.applyScope === "agent" ? "agent" : null;
  const source = row.source === "chat-ui" ? "chat-ui" : null;
  const acceptedAt = typeof row.acceptedAt === "number" ? row.acceptedAt : NaN;
  if (
    !feedbackId ||
    !sessionKey ||
    !runId ||
    !messageId ||
    !rating ||
    !applyScope ||
    !source ||
    !Number.isFinite(acceptedAt)
  ) {
    return null;
  }
  const tags = Array.isArray(row.tags)
    ? row.tags
        .map((item) => normalizeFeedbackTag(item))
        .filter((item): item is ChatFeedbackTag => Boolean(item))
    : [];
  const comment = typeof row.comment === "string" ? row.comment.trim() : "";
  return {
    feedbackId,
    sessionKey,
    runId,
    messageId,
    rating,
    tags,
    comment: comment || undefined,
    applyScope,
    source,
    acceptedAt,
  };
}

function runSummaryKey(entry: ChatTimelineRunSummary): string {
  return entry.runId;
}

export function mergeChatTimelineRuns(
  current: ChatTimelineRunSummary[],
  incoming: ChatTimelineRunSummary[],
): ChatTimelineRunSummary[] {
  const byRun = new Map<string, ChatTimelineRunSummary>();
  for (const item of current) {
    byRun.set(runSummaryKey(item), item);
  }
  for (const item of incoming) {
    const key = runSummaryKey(item);
    const prev = byRun.get(key);
    if (!prev || item.updatedAt >= prev.updatedAt) {
      byRun.set(key, item);
    }
  }
  const merged = Array.from(byRun.values());
  merged.sort((a, b) => {
    if (a.startedAt !== b.startedAt) {
      return b.startedAt - a.startedAt;
    }
    if (a.updatedAt !== b.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return b.runId.localeCompare(a.runId);
  });
  return merged;
}

export function deriveTimelineRunsFromEvents(
  events: ChatTimelineEvent[],
): ChatTimelineRunSummary[] {
  const byRun = new Map<string, ChatTimelineRunSummary>();
  const sorted = [...events].toSorted((a, b) => {
    if (a.ts !== b.ts) {
      return a.ts - b.ts;
    }
    if (a.seq !== b.seq) {
      return a.seq - b.seq;
    }
    return a.runId.localeCompare(b.runId);
  });

  for (const evt of sorted) {
    const prev = byRun.get(evt.runId);
    const startedAt = prev?.startedAt ?? evt.ts;
    const next: ChatTimelineRunSummary = {
      sessionKey: evt.sessionKey,
      runId: evt.runId,
      startedAt,
      endedAt: prev?.endedAt,
      status: prev?.status ?? "running",
      totalMs: prev?.totalMs,
      firstTokenMs: prev?.firstTokenMs,
      toolCalls: prev?.toolCalls ?? 0,
      toolErrors: prev?.toolErrors ?? 0,
      assistantChars: prev?.assistantChars ?? 0,
      compactionCount: prev?.compactionCount ?? 0,
      truncatedEvents: prev?.truncatedEvents ?? 0,
      inputTokens: prev?.inputTokens,
      outputTokens: prev?.outputTokens,
      updatedAt: evt.ts,
    };

    const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
    if (evt.stream === "assistant") {
      const text = typeof evt.data.text === "string" ? evt.data.text : "";
      if (text) {
        next.assistantChars += text.length;
        if (typeof next.firstTokenMs !== "number") {
          next.firstTokenMs = Math.max(0, evt.ts - startedAt);
        }
      }
    } else if (evt.stream === "tool") {
      if (phase === "start") {
        next.toolCalls += 1;
      }
      if (phase === "error" || evt.data.isError === true) {
        next.toolErrors += 1;
      }
    } else if (evt.stream === "compaction") {
      next.compactionCount += 1;
    } else if (evt.stream === "error") {
      next.toolErrors += 1;
      next.status = "error";
    } else if (evt.stream === "lifecycle") {
      if (phase === "start") {
        next.status = "running";
      } else if (phase === "end") {
        next.endedAt = evt.ts;
        next.totalMs = Math.max(0, evt.ts - startedAt);
        next.status = next.status === "error" ? "error" : "success";
        const usage =
          evt.data.usage && typeof evt.data.usage === "object"
            ? (evt.data.usage as Record<string, unknown>)
            : null;
        if (usage) {
          const input = typeof usage.input === "number" ? usage.input : usage.inputTokens;
          const output = typeof usage.output === "number" ? usage.output : usage.outputTokens;
          if (typeof input === "number" && Number.isFinite(input)) {
            next.inputTokens = Math.max(0, input);
          }
          if (typeof output === "number" && Number.isFinite(output)) {
            next.outputTokens = Math.max(0, output);
          }
        }
      } else if (phase === "error") {
        next.endedAt = evt.ts;
        next.totalMs = Math.max(0, evt.ts - startedAt);
        next.status = "error";
      } else if (phase === "aborted") {
        next.endedAt = evt.ts;
        next.totalMs = Math.max(0, evt.ts - startedAt);
        next.status = "aborted";
      }
    }

    if (evt.truncated || evt.data.truncated === true) {
      next.truncatedEvents += 1;
    }
    byRun.set(evt.runId, next);
  }

  return mergeChatTimelineRuns([], Array.from(byRun.values()));
}

function feedbackKey(item: ChatFeedbackItem): string {
  return item.feedbackId;
}

function mergeFeedbackItems(
  current: ChatFeedbackItem[],
  incoming: ChatFeedbackItem[],
): ChatFeedbackItem[] {
  const known = new Set(current.map((item) => feedbackKey(item)));
  const next = [...current];
  for (const item of incoming) {
    if (known.has(feedbackKey(item))) {
      continue;
    }
    next.push(item);
    known.add(feedbackKey(item));
  }
  next.sort((a, b) => b.acceptedAt - a.acceptedAt);
  return next;
}

export async function loadChatTimelineRuns(
  state: ChatObservabilityState,
  opts?: { limit?: number; quiet?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!opts?.quiet) {
    state.chatTimelineRunsLoading = true;
    state.chatTimelineRunsError = null;
  }
  try {
    const res = (await state.client.request("chat.timeline.runs", {
      sessionKey: state.sessionKey,
      limit: opts?.limit ?? 100,
    })) as { runs?: unknown[] };
    const runs = (Array.isArray(res.runs) ? res.runs : [])
      .map(normalizeRunSummary)
      .filter((item): item is ChatTimelineRunSummary => Boolean(item))
      .filter((item) => item.sessionKey === state.sessionKey);
    state.chatTimelineRunsServerSupported = true;
    state.chatTimelineRuns = runs;
    state.chatTimelineRunsError = null;
  } catch (err) {
    const message = String(err);
    if (CHAT_TIMELINE_RUNS_METHOD_UNKNOWN_RE.test(message)) {
      state.chatTimelineRunsServerSupported = false;
      state.chatTimelineRuns = deriveTimelineRunsFromEvents(
        state.chatTimelineEvents.filter((item) => item.sessionKey === state.sessionKey),
      );
      state.chatTimelineRunsError = null;
      return;
    }
    state.chatTimelineRunsError = message;
  } finally {
    state.chatTimelineRunsLoading = false;
  }
}

export function appendChatTimelineRunSummary(
  state: Pick<
    ChatObservabilityState,
    "sessionKey" | "chatTimelineRuns" | "chatTimelineRunsServerSupported"
  >,
  payload?: unknown,
) {
  if (!payload) {
    return;
  }
  const normalized = normalizeRunSummary(payload);
  if (!normalized) {
    return;
  }
  if (normalized.sessionKey !== state.sessionKey) {
    return;
  }
  state.chatTimelineRunsServerSupported = true;
  state.chatTimelineRuns = mergeChatTimelineRuns(state.chatTimelineRuns, [normalized]);
}

export function syncFallbackRunSummaries(
  state: Pick<
    ChatObservabilityState,
    "chatTimelineRunsServerSupported" | "chatTimelineEvents" | "chatTimelineRuns" | "sessionKey"
  >,
) {
  if (state.chatTimelineRunsServerSupported) {
    return;
  }
  const events = state.chatTimelineEvents.filter((item) => item.sessionKey === state.sessionKey);
  state.chatTimelineRuns = deriveTimelineRunsFromEvents(events);
}

export async function loadChatFeedbackList(
  state: ChatObservabilityState,
  opts?: { limit?: number; runId?: string; quiet?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (!opts?.quiet) {
    state.chatFeedbackLoading = true;
    state.chatFeedbackError = null;
  }
  try {
    const res = (await state.client.request("chat.feedback.list", {
      sessionKey: state.sessionKey,
      limit: opts?.limit ?? 200,
      ...(opts?.runId ? { runId: opts.runId } : {}),
    })) as { items?: unknown[] };
    const items = (Array.isArray(res.items) ? res.items : [])
      .map(normalizeFeedbackItem)
      .filter((item): item is ChatFeedbackItem => Boolean(item))
      .filter((item) => item.sessionKey === state.sessionKey);
    state.chatFeedbackServerSupported = true;
    state.chatFeedbackItems = items;
    state.chatFeedbackError = null;
  } catch (err) {
    const message = String(err);
    if (CHAT_FEEDBACK_LIST_METHOD_UNKNOWN_RE.test(message)) {
      state.chatFeedbackServerSupported = false;
      state.chatFeedbackError = null;
      state.chatFeedbackItems = [];
      return;
    }
    state.chatFeedbackError = message;
  } finally {
    state.chatFeedbackLoading = false;
  }
}

export async function submitChatFeedback(
  state: ChatObservabilityState,
  params: SubmitChatFeedbackParams,
) {
  const key = `${params.runId}:${params.messageId}`;
  state.chatFeedbackSubmitting = {
    ...state.chatFeedbackSubmitting,
    [key]: true,
  };
  state.chatFeedbackSubmitErrors = {
    ...state.chatFeedbackSubmitErrors,
    [key]: null,
  };

  try {
    if (!state.client || !state.connected) {
      throw new Error("gateway disconnected");
    }
    const res = (await state.client.request("chat.feedback.submit", {
      sessionKey: params.sessionKey,
      runId: params.runId,
      messageId: params.messageId,
      rating: params.rating,
      tags: params.tags ?? [],
      comment: params.comment,
      applyScope: params.applyScope ?? "agent",
      source: params.source ?? "chat-ui",
    })) as { ok?: boolean; feedbackId?: unknown; acceptedAt?: unknown };
    if (
      res.ok !== true ||
      typeof res.feedbackId !== "string" ||
      typeof res.acceptedAt !== "number"
    ) {
      throw new Error("feedback submit failed");
    }
    const item: ChatFeedbackItem = {
      feedbackId: res.feedbackId,
      sessionKey: params.sessionKey,
      runId: params.runId,
      messageId: params.messageId,
      rating: params.rating,
      tags: params.tags ?? [],
      comment: params.comment?.trim() ? params.comment.trim() : undefined,
      applyScope: params.applyScope ?? "agent",
      source: params.source ?? "chat-ui",
      acceptedAt: res.acceptedAt,
    };
    state.chatFeedbackServerSupported = true;
    state.chatFeedbackItems = mergeFeedbackItems(state.chatFeedbackItems, [item]);
    state.chatFeedbackSubmitErrors = {
      ...state.chatFeedbackSubmitErrors,
      [key]: null,
    };
    return { ok: true as const, item };
  } catch (err) {
    const message = String(err);
    if (CHAT_FEEDBACK_SUBMIT_METHOD_UNKNOWN_RE.test(message)) {
      state.chatFeedbackServerSupported = false;
    }
    state.chatFeedbackSubmitErrors = {
      ...state.chatFeedbackSubmitErrors,
      [key]: message,
    };
    return { ok: false as const, error: message };
  } finally {
    state.chatFeedbackSubmitting = {
      ...state.chatFeedbackSubmitting,
      [key]: false,
    };
  }
}

export function selectActiveRunSummary(
  runs: ChatTimelineRunSummary[],
  currentRunId?: string | null,
): ChatTimelineRunSummary | null {
  if (currentRunId) {
    const hit = runs.find((item) => item.runId === currentRunId);
    if (hit) {
      return hit;
    }
  }
  if (runs.length === 0) {
    return null;
  }
  return runs[0] ?? null;
}

export function detectRunAlerts(
  run: ChatTimelineRunSummary,
  events: ChatTimelineEvent[],
): string[] {
  const alerts: string[] = [];
  if (typeof run.firstTokenMs === "number" && run.firstTokenMs > 10_000) {
    alerts.push("首字节过慢");
  }
  if (run.toolErrors > 0) {
    alerts.push("工具报错");
  }
  if (run.truncatedEvents > 0) {
    alerts.push("事件截断");
  }
  if (run.status === "error") {
    const hasTimeout = events.some((entry) => {
      const message =
        typeof entry.data.error === "string"
          ? entry.data.error
          : typeof entry.data.message === "string"
            ? entry.data.message
            : "";
      return /timeout|timed out|超时/i.test(message);
    });
    if (hasTimeout) {
      alerts.push("run 超时");
    }
  }
  return alerts;
}

function pickTraceEvents(events: ChatTimelineEvent[], runId: string): ChatTimelineEvent[] {
  return events
    .filter((item) => item.runId === runId)
    .filter((item) => {
      if (item.stream === "error" || item.stream === "compaction") {
        return true;
      }
      if (item.stream === "lifecycle") {
        return true;
      }
      if (item.stream === "tool") {
        const phase = typeof item.data.phase === "string" ? item.data.phase : "";
        return phase === "start" || phase === "result" || phase === "error";
      }
      return false;
    });
}

export function buildRunTraceText(
  runId: string,
  runs: ChatTimelineRunSummary[],
  events: ChatTimelineEvent[],
): string {
  const summary = runs.find((item) => item.runId === runId);
  const trace = {
    runId,
    summary: summary ?? null,
    events: pickTraceEvents(events, runId),
  };
  return JSON.stringify(trace, null, 2);
}

export async function copyRunTrace(
  runId: string,
  runs: ChatTimelineRunSummary[],
  events: ChatTimelineEvent[],
) {
  const text = buildRunTraceText(runId, runs, events);
  let copied = false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    // ignore clipboard failures, caller can still use returned text
  }
  return { text, copied };
}

export function buildCorrectionPrompt(draft: ChatFeedbackDraft): string {
  const tags = draft.tags.length > 0 ? `问题标签: ${draft.tags.join(", ")}。` : "";
  const note = draft.comment.trim() ? `补充说明: ${draft.comment.trim()}` : "";
  const details = [tags, note].filter(Boolean).join(" ");
  return `请根据我的反馈重答上一题，先简短指出你将如何修正，再给出更准确的答案。${details}`;
}
