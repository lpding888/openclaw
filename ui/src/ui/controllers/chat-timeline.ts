import type { ChatTimelineEvent } from "../types";
import { deriveTimelineRunsFromEvents } from "./chat-observability";

export const CHAT_TIMELINE_DEFAULT_LIMIT = 500;

const CHAT_TIMELINE_METHOD_UNKNOWN_RE =
  /unknown method:\s*chat\.timeline|invalid request:\s*unknown method:\s*chat\.timeline/i;

type ChatTimelineClient = {
  request(method: string, params?: unknown): Promise<unknown>;
};

type ChatTimelineState = {
  client: ChatTimelineClient | null;
  connected: boolean;
  sessionKey: string;
  chatTimelineEvents: ChatTimelineEvent[];
  chatTimelineLoading: boolean;
  chatTimelineError: string | null;
  chatTimelineServerSupported: boolean;
  chatTimelineRunsServerSupported?: boolean;
  chatTimelineRuns?: import("../types").ChatTimelineRunSummary[];
};

type ChatTimelinePayload = {
  sessionKey?: unknown;
  runId?: unknown;
  seq?: unknown;
  ts?: unknown;
  stream?: unknown;
  data?: unknown;
  truncated?: unknown;
};

function normalizeTimelineEvent(raw: unknown): ChatTimelineEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey.trim() : "";
  const runId = typeof event.runId === "string" ? event.runId.trim() : "";
  const stream = typeof event.stream === "string" ? event.stream.trim() : "";
  const seq = typeof event.seq === "number" ? event.seq : NaN;
  const ts = typeof event.ts === "number" ? event.ts : NaN;
  if (!sessionKey || !runId || !stream || !Number.isFinite(seq) || !Number.isFinite(ts)) {
    return null;
  }
  const data =
    event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? (event.data as Record<string, unknown>)
      : {};
  return {
    sessionKey,
    runId,
    seq,
    ts,
    stream,
    data,
    truncated: event.truncated === true ? true : undefined,
  };
}

function timelineKey(entry: ChatTimelineEvent): string {
  return `${entry.runId}:${entry.seq}:${entry.stream}`;
}

function mergeTimelineEvents(
  current: ChatTimelineEvent[],
  incoming: ChatTimelineEvent[],
): ChatTimelineEvent[] {
  const merged = [...current];
  const known = new Set(current.map((entry) => timelineKey(entry)));
  for (const entry of incoming) {
    const key = timelineKey(entry);
    if (known.has(key)) continue;
    merged.push(entry);
    known.add(key);
  }
  merged.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.seq !== b.seq) return a.seq - b.seq;
    if (a.runId !== b.runId) return a.runId.localeCompare(b.runId);
    return a.stream.localeCompare(b.stream);
  });
  return merged;
}

export async function loadChatTimeline(
  state: ChatTimelineState,
  opts?: { limit?: number; quiet?: boolean },
) {
  if (!state.client || !state.connected) return;
  if (!opts?.quiet) {
    state.chatTimelineLoading = true;
    state.chatTimelineError = null;
  }
  try {
    const res = (await state.client.request("chat.timeline", {
      sessionKey: state.sessionKey,
      limit: opts?.limit ?? CHAT_TIMELINE_DEFAULT_LIMIT,
    })) as { events?: unknown[] };
    const events = (Array.isArray(res.events) ? res.events : [])
      .map(normalizeTimelineEvent)
      .filter((entry): entry is ChatTimelineEvent => Boolean(entry))
      .filter((entry) => entry.sessionKey === state.sessionKey);
    state.chatTimelineServerSupported = true;
    state.chatTimelineEvents = events;
    if (state.chatTimelineRunsServerSupported === false && Array.isArray(state.chatTimelineRuns)) {
      state.chatTimelineRuns = deriveTimelineRunsFromEvents(events);
    }
    state.chatTimelineError = null;
  } catch (err) {
    const message = String(err);
    if (CHAT_TIMELINE_METHOD_UNKNOWN_RE.test(message)) {
      state.chatTimelineServerSupported = false;
      state.chatTimelineError = null;
      return;
    }
    state.chatTimelineError = message;
  } finally {
    state.chatTimelineLoading = false;
  }
}

export function appendChatTimelineEvent(
  state: ChatTimelineState,
  payload?: ChatTimelinePayload,
) {
  if (!payload) return;
  const normalized = normalizeTimelineEvent(payload);
  if (!normalized) return;
  if (normalized.sessionKey !== state.sessionKey) return;
  state.chatTimelineEvents = mergeTimelineEvents(state.chatTimelineEvents, [normalized]);
  if (state.chatTimelineRunsServerSupported === false && Array.isArray(state.chatTimelineRuns)) {
    state.chatTimelineRuns = deriveTimelineRunsFromEvents(state.chatTimelineEvents);
  }
}
