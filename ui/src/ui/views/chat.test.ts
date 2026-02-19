import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    messages: [],
    toolMessages: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    sendOnEnter: true,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    sidebarOpen: true,
    sidebarTab: "timeline",
    sidebarContent: null,
    sidebarError: null,
    splitRatio: 0.6,
    timelineEvents: [],
    timelineRuns: [],
    timelineLoading: false,
    timelineRunsLoading: false,
    timelineError: null,
    timelineRunsError: null,
    timelineServerSupported: true,
    timelineRunsServerSupported: true,
    timelineDensity: "summary",
    observabilityPin: "timeline",
    timelineFollow: true,
    timelineFilters: { runId: "", streams: {} },
    feedbackItems: [],
    feedbackLoading: false,
    feedbackError: null,
    feedbackServerSupported: true,
    feedbackDrafts: {},
    feedbackSubmitting: {},
    feedbackSubmitErrors: {},
    currentRunId: null,
    assistantName: "Clawdbot",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    onOpenSidebar: () => undefined,
    onCloseSidebar: () => undefined,
    onSidebarTabChange: () => undefined,
    onSplitRatioChange: () => undefined,
    onTimelineFollowChange: () => undefined,
    onTimelineFiltersChange: () => undefined,
    onTimelineDensityChange: () => undefined,
    onObservabilityPinChange: () => undefined,
    onFeedbackDraftChange: () => undefined,
    onFeedbackSubmit: async () => undefined,
    ...overrides,
  };
}

describe("chat view", () => {
  it("renders compacting indicator as a badge", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: true,
            startedAt: Date.now(),
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--active");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Compacting context...");
  });

  it("renders completion indicator shortly after compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 900,
            completedAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--complete");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Context compacted");
    nowSpy.mockRestore();
  });

  it("hides stale compaction completion indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 0,
            completedAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator")).toBeNull();
    nowSpy.mockRestore();
  });

  it("shows a stop button when aborting is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          onAbort,
        }),
      ),
      container,
    );

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "停止",
    );
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("新会话");
  });

  it("shows a new session button when aborting is unavailable", () => {
    const container = document.createElement("div");
    const onNewSession = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: false,
          onNewSession,
        }),
      ),
      container,
    );

    const newSessionButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "新会话",
    );
    expect(newSessionButton).not.toBeUndefined();
    newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("停止");
  });

  it("renders insights tab and assistant feedback controls", () => {
    const container = document.createElement("div");
    const onFeedbackSubmit = vi.fn();
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              id: "msg-1",
              timestamp: 1_000,
              content: [{ type: "text", text: "你好" }],
            },
          ],
          timelineRuns: [
            {
              sessionKey: "main",
              runId: "run-1",
              startedAt: 900,
              status: "success",
              toolCalls: 0,
              toolErrors: 0,
              assistantChars: 2,
              compactionCount: 0,
              truncatedEvents: 0,
              updatedAt: 1_100,
            },
          ],
          onFeedbackSubmit,
        }),
      ),
      container,
    );
    expect(container.textContent).toContain("洞察");
    expect(container.textContent).toContain("作用范围: 当前 Agent 全局");
  });

  it("shows timeline density controls", () => {
    const container = document.createElement("div");
    render(renderChat(createProps()), container);
    expect(container.textContent).toContain("摘要");
    expect(container.textContent).toContain("全展开");
  });

  it("shows a single degraded observability hint in insights", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sidebarTab: "insights",
          timelineRunsServerSupported: false,
          feedbackServerSupported: true,
        }),
      ),
      container,
    );
    expect(container.textContent).toContain("洞察能力受限");
  });

  it("shows retry action when feedback submission fails", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              id: "msg-1",
              timestamp: 2_000,
              content: [{ type: "text", text: "结果" }],
            },
          ],
          timelineRuns: [
            {
              sessionKey: "main",
              runId: "run-1",
              startedAt: 1_500,
              status: "success",
              toolCalls: 0,
              toolErrors: 0,
              assistantChars: 2,
              compactionCount: 0,
              truncatedEvents: 0,
              updatedAt: 2_100,
            },
          ],
          feedbackDrafts: {
            "msg-1": {
              rating: "down",
              tags: ["accuracy"],
              comment: "",
              applyScope: "agent",
              open: true,
            },
          },
          feedbackSubmitErrors: {
            "run-1:msg-1": "network error",
          },
        }),
      ),
      container,
    );
    expect(container.textContent).toContain("重试提交");
  });
});
