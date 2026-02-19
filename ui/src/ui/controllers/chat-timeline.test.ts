import { describe, expect, it, vi } from "vitest";
import type { ChatTimelineEvent } from "../types.ts";
import { appendChatTimelineEvent, loadChatTimeline } from "./chat-timeline.ts";

type TimelineState = {
  client: { request: (method: string, params: unknown) => Promise<unknown> } | null;
  connected: boolean;
  sessionKey: string;
  chatTimelineEvents: ChatTimelineEvent[];
  chatTimelineLoading: boolean;
  chatTimelineError: string | null;
  chatTimelineServerSupported: boolean;
};

function createState(overrides: Partial<TimelineState> = {}): TimelineState {
  return {
    client: null,
    connected: true,
    sessionKey: "main",
    chatTimelineEvents: [],
    chatTimelineLoading: false,
    chatTimelineError: null,
    chatTimelineServerSupported: true,
    ...overrides,
  };
}

describe("chat timeline controller", () => {
  it("deduplicates realtime timeline events by runId:seq:stream", () => {
    const state = createState();
    appendChatTimelineEvent(state, {
      sessionKey: "main",
      runId: "run-1",
      seq: 1,
      ts: 100,
      stream: "lifecycle",
      data: { phase: "start" },
    });
    appendChatTimelineEvent(state, {
      sessionKey: "main",
      runId: "run-1",
      seq: 1,
      ts: 100,
      stream: "lifecycle",
      data: { phase: "start" },
    });
    expect(state.chatTimelineEvents).toHaveLength(1);
  });

  it("loads history timeline from server", async () => {
    const request = vi.fn(async () => ({
      events: [
        {
          sessionKey: "main",
          runId: "run-1",
          seq: 1,
          ts: 100,
          stream: "assistant",
          data: { text: "Hello" },
        },
      ],
    }));
    const state = createState({
      client: { request },
    });

    await loadChatTimeline(state);

    expect(request).toHaveBeenCalledWith("chat.timeline", {
      sessionKey: "main",
      limit: 500,
    });
    expect(state.chatTimelineEvents).toHaveLength(1);
    expect(state.chatTimelineError).toBeNull();
    expect(state.chatTimelineServerSupported).toBe(true);
  });

  it("falls back when server does not support chat.timeline", async () => {
    const request = vi.fn(async () => {
      throw new Error("invalid request: unknown method: chat.timeline");
    });
    const state = createState({
      client: { request },
    });

    await loadChatTimeline(state);

    expect(state.chatTimelineServerSupported).toBe(false);
    expect(state.chatTimelineError).toBeNull();
  });
});
