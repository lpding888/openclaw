import { describe, expect, it, vi } from "vitest";
import type { ChatFeedbackItem, ChatTimelineEvent, ChatTimelineRunSummary } from "../types.ts";
import {
  buildCorrectionPrompt,
  deriveTimelineRunsFromEvents,
  detectRunAlerts,
  loadChatFeedbackList,
  loadChatTimelineRuns,
  mergeChatTimelineRuns,
  submitChatFeedback,
  type SubmitChatFeedbackParams,
} from "./chat-observability.ts";

type ObservabilityState = {
  client: { request: (method: string, params?: unknown) => Promise<unknown> } | null;
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

function createState(overrides: Partial<ObservabilityState> = {}): ObservabilityState {
  return {
    client: null,
    connected: true,
    sessionKey: "main",
    chatRunId: null,
    chatMessage: "",
    chatTimelineEvents: [],
    chatTimelineRuns: [],
    chatTimelineRunsLoading: false,
    chatTimelineRunsError: null,
    chatTimelineRunsServerSupported: true,
    chatFeedbackItems: [],
    chatFeedbackLoading: false,
    chatFeedbackError: null,
    chatFeedbackServerSupported: true,
    chatFeedbackSubmitting: {},
    chatFeedbackSubmitErrors: {},
    ...overrides,
  };
}

describe("chat observability controller", () => {
  it("merges run summaries by latest updatedAt", () => {
    const current: ChatTimelineRunSummary[] = [
      {
        sessionKey: "main",
        runId: "run-1",
        startedAt: 100,
        status: "running",
        toolCalls: 0,
        toolErrors: 0,
        assistantChars: 10,
        compactionCount: 0,
        truncatedEvents: 0,
        updatedAt: 120,
      },
    ];
    const incoming: ChatTimelineRunSummary[] = [
      {
        sessionKey: "main",
        runId: "run-1",
        startedAt: 100,
        endedAt: 160,
        totalMs: 60,
        status: "success",
        toolCalls: 1,
        toolErrors: 0,
        assistantChars: 18,
        compactionCount: 0,
        truncatedEvents: 0,
        updatedAt: 160,
      },
    ];
    const merged = mergeChatTimelineRuns(current, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("success");
    expect(merged[0]?.totalMs).toBe(60);
  });

  it("derives run summaries from timeline events", () => {
    const events: ChatTimelineEvent[] = [
      {
        sessionKey: "main",
        runId: "run-1",
        seq: 1,
        ts: 1000,
        stream: "lifecycle",
        data: { phase: "start" },
      },
      {
        sessionKey: "main",
        runId: "run-1",
        seq: 2,
        ts: 1200,
        stream: "assistant",
        data: { text: "hello" },
      },
      {
        sessionKey: "main",
        runId: "run-1",
        seq: 3,
        ts: 1500,
        stream: "lifecycle",
        data: { phase: "end", usage: { input: 10, output: 20 } },
      },
    ];
    const runs = deriveTimelineRunsFromEvents(events);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("success");
    expect(runs[0]?.assistantChars).toBe(5);
    expect(runs[0]?.firstTokenMs).toBe(200);
    expect(runs[0]?.totalMs).toBe(500);
  });

  it("loads chat.timeline.runs from server", async () => {
    const request = vi.fn(async () => ({
      runs: [
        {
          sessionKey: "main",
          runId: "run-1",
          startedAt: 100,
          status: "running",
          toolCalls: 0,
          toolErrors: 0,
          assistantChars: 0,
          compactionCount: 0,
          truncatedEvents: 0,
          updatedAt: 100,
        },
      ],
    }));
    const state = createState({ client: { request } });
    await loadChatTimelineRuns(state);
    expect(request).toHaveBeenCalledWith("chat.timeline.runs", {
      sessionKey: "main",
      limit: 100,
    });
    expect(state.chatTimelineRuns).toHaveLength(1);
    expect(state.chatTimelineRunsServerSupported).toBe(true);
  });

  it("falls back to derived runs when chat.timeline.runs is unsupported", async () => {
    const request = vi.fn(async () => {
      throw new Error("invalid request: unknown method: chat.timeline.runs");
    });
    const state = createState({
      client: { request },
      chatTimelineEvents: [
        {
          sessionKey: "main",
          runId: "run-1",
          seq: 1,
          ts: 1000,
          stream: "lifecycle",
          data: { phase: "start" },
        },
      ],
    });
    await loadChatTimelineRuns(state);
    expect(state.chatTimelineRunsServerSupported).toBe(false);
    expect(state.chatTimelineRuns).toHaveLength(1);
  });

  it("loads feedback list from server", async () => {
    const request = vi.fn(async () => ({
      items: [
        {
          feedbackId: "fb-1",
          sessionKey: "main",
          runId: "run-1",
          messageId: "msg-1",
          rating: "up",
          tags: ["clarity"],
          applyScope: "agent",
          source: "chat-ui",
          acceptedAt: 1000,
        },
      ],
    }));
    const state = createState({ client: { request } });
    await loadChatFeedbackList(state);
    expect(state.chatFeedbackItems).toHaveLength(1);
    expect(state.chatFeedbackServerSupported).toBe(true);
  });

  it("submits feedback and appends result", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      feedbackId: "fb-1",
      acceptedAt: 2000,
    }));
    const state = createState({ client: { request } });
    const payload: SubmitChatFeedbackParams = {
      sessionKey: "main",
      runId: "run-1",
      messageId: "msg-1",
      rating: "down",
      tags: ["accuracy"],
      comment: "答案有误",
      applyScope: "agent",
      source: "chat-ui",
    };
    const res = await submitChatFeedback(state, payload);
    expect(res.ok).toBe(true);
    expect(state.chatFeedbackItems).toHaveLength(1);
    expect(state.chatFeedbackItems[0]?.rating).toBe("down");
  });

  it("marks unsupported when chat.feedback.submit is unavailable", async () => {
    const request = vi.fn(async () => {
      throw new Error("unknown method: chat.feedback.submit");
    });
    const state = createState({ client: { request } });
    const res = await submitChatFeedback(state, {
      sessionKey: "main",
      runId: "run-1",
      messageId: "msg-1",
      rating: "up",
    });
    expect(res.ok).toBe(false);
    expect(state.chatFeedbackServerSupported).toBe(false);
  });

  it("detects run alert rules and builds correction prompt", () => {
    const run: ChatTimelineRunSummary = {
      sessionKey: "main",
      runId: "run-1",
      startedAt: 1000,
      status: "error",
      firstTokenMs: 12_000,
      toolCalls: 1,
      toolErrors: 1,
      assistantChars: 0,
      compactionCount: 0,
      truncatedEvents: 1,
      updatedAt: 2000,
    };
    const alerts = detectRunAlerts(run, [
      {
        sessionKey: "main",
        runId: "run-1",
        seq: 3,
        ts: 2000,
        stream: "lifecycle",
        data: { phase: "error", error: "timeout after 30s" },
      },
    ]);
    expect(alerts).toContain("首字节过慢");
    expect(alerts).toContain("工具报错");
    expect(alerts).toContain("run 超时");
    expect(alerts).toContain("事件截断");

    const prompt = buildCorrectionPrompt({
      rating: "down",
      tags: ["accuracy", "clarity"],
      comment: "请补充出处",
      applyScope: "agent",
      open: true,
    });
    expect(prompt).toContain("accuracy");
    expect(prompt).toContain("请补充出处");
  });
});
