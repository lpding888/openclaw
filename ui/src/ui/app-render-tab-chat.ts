import type { TemplateResult } from "lit";
import type { RenderMainContentOptions } from "./app-render-content.ts";
import type { AppViewState } from "./app-view-state.ts";
import { refreshChatAvatar } from "./app-chat.ts";
import {
  CHAT_FEEDBACK_DEFAULT_DRAFT,
  loadChatFeedbackList,
  loadChatTimelineRuns,
  submitChatFeedback,
  type SubmitChatFeedbackParams,
} from "./controllers/chat-observability.ts";
import { loadChatTimeline } from "./controllers/chat-timeline.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import { renderChat } from "./views/chat.ts";

export function renderChatTab(
  state: AppViewState,
  options: RenderMainContentOptions,
): TemplateResult {
  return renderChat({
    sessionKey: state.sessionKey,
    onSessionKeyChange: (next) => {
      state.sessionKey = next;
      state.chatMessage = "";
      state.chatAttachments = [];
      state.chatStream = null;
      state.chatStreamStartedAt = null;
      state.chatRunId = null;
      state.chatQueue = [];
      state.chatTimelineEvents = [];
      state.chatTimelineError = null;
      state.chatTimelineFollow = true;
      state.chatTimelineFilters = { runId: "", streams: {} };
      state.chatTimelineRuns = [];
      state.chatTimelineRunsError = null;
      state.chatFeedbackItems = [];
      state.chatFeedbackError = null;
      state.chatFeedbackDrafts = {};
      state.chatFeedbackSubmitting = {};
      state.chatFeedbackSubmitErrors = {};
      state.sidebarOpen = true;
      state.sidebarTab = state.settings.chatObservabilityPin;
      state.resetToolStream();
      state.resetChatScroll();
      state.applySettings({
        ...state.settings,
        sessionKey: next,
        lastActiveSessionKey: next,
      });
      void state.loadAssistantIdentity();
      void loadChatHistory(state);
      void loadChatTimeline(state);
      void loadChatTimelineRuns(state);
      void loadChatFeedbackList(state);
      void refreshChatAvatar(state);
    },
    thinkingLevel: state.chatThinkingLevel,
    showThinking: options.showThinking,
    loading: state.chatLoading,
    sending: state.chatSending,
    compactionStatus: state.compactionStatus,
    assistantAvatarUrl: options.chatAvatarUrl,
    messages: state.chatMessages,
    toolMessages: state.chatToolMessages,
    stream: state.chatStream,
    streamStartedAt: state.chatStreamStartedAt,
    draft: state.chatMessage,
    queue: state.chatQueue,
    timelineEvents: state.chatTimelineEvents,
    timelineLoading: state.chatTimelineLoading,
    timelineError: state.chatTimelineError,
    timelineServerSupported: state.chatTimelineServerSupported,
    timelineFollow: state.chatTimelineFollow,
    timelineFilters: state.chatTimelineFilters,
    timelineRuns: state.chatTimelineRuns,
    timelineRunsLoading: state.chatTimelineRunsLoading,
    timelineRunsError: state.chatTimelineRunsError,
    timelineRunsServerSupported: state.chatTimelineRunsServerSupported,
    timelineDensity: state.settings.chatTimelineDensity,
    observabilityPin: state.settings.chatObservabilityPin,
    feedbackItems: state.chatFeedbackItems,
    feedbackLoading: state.chatFeedbackLoading,
    feedbackError: state.chatFeedbackError,
    feedbackServerSupported: state.chatFeedbackServerSupported,
    feedbackDrafts: state.chatFeedbackDrafts,
    feedbackSubmitting: state.chatFeedbackSubmitting,
    feedbackSubmitErrors: state.chatFeedbackSubmitErrors,
    currentRunId: state.chatRunId,
    connected: state.connected,
    canSend: state.connected,
    disabledReason: options.chatDisabledReason,
    sendOnEnter: state.settings.sendOnEnter,
    error: state.lastError,
    sessions: state.sessionsResult,
    focusMode: options.chatFocus,
    onRefresh: () => {
      state.resetToolStream();
      return Promise.all([
        loadChatHistory(state),
        loadChatTimeline(state),
        loadChatTimelineRuns(state),
        loadChatFeedbackList(state),
        refreshChatAvatar(state),
      ]);
    },
    onToggleFocusMode: () => {
      if (state.onboarding) {
        return;
      }
      state.applySettings({
        ...state.settings,
        chatFocusMode: !state.settings.chatFocusMode,
      });
    },
    onChatScroll: (event) => state.handleChatScroll(event),
    onDraftChange: (next) => (state.chatMessage = next),
    attachments: state.chatAttachments,
    onAttachmentsChange: (next) => (state.chatAttachments = next),
    onSend: () => state.handleSendChat(),
    canAbort: Boolean(state.chatRunId),
    onAbort: () => void state.handleAbortChat(),
    onQueueRemove: (id) => state.removeQueuedMessage(id),
    onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
    sidebarOpen: state.sidebarOpen,
    sidebarTab: state.sidebarTab,
    sidebarContent: state.sidebarContent,
    sidebarError: state.sidebarError,
    splitRatio: state.splitRatio,
    onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
    onCloseSidebar: () => state.handleCloseSidebar(),
    onSidebarTabChange: (tab: "timeline" | "tool" | "insights") => state.handleSetSidebarTab(tab),
    onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
    onTimelineFollowChange: (next) => (state.chatTimelineFollow = next),
    onTimelineFiltersChange: (next) => (state.chatTimelineFilters = next),
    onTimelineDensityChange: (next) => {
      if (state.settings.chatTimelineDensity === next) {
        return;
      }
      state.applySettings({
        ...state.settings,
        chatTimelineDensity: next,
      });
    },
    onObservabilityPinChange: (next) => {
      if (state.settings.chatObservabilityPin === next) {
        return;
      }
      state.applySettings({
        ...state.settings,
        chatObservabilityPin: next,
      });
    },
    onFeedbackDraftChange: (messageId, patch) => {
      const prev = state.chatFeedbackDrafts[messageId] ?? CHAT_FEEDBACK_DEFAULT_DRAFT;
      state.chatFeedbackDrafts = {
        ...state.chatFeedbackDrafts,
        [messageId]: {
          ...prev,
          ...patch,
        },
      };
    },
    onFeedbackSubmit: async (params: SubmitChatFeedbackParams) => {
      const key = `${params.runId}:${params.messageId}`;
      const result = await submitChatFeedback(state, params);
      if (result.ok) {
        state.chatFeedbackDrafts = {
          ...state.chatFeedbackDrafts,
          [params.messageId]: {
            ...CHAT_FEEDBACK_DEFAULT_DRAFT,
            rating: params.rating,
            tags: params.tags ?? [],
            comment: params.comment?.trim() ?? "",
            open: false,
          },
        };
      } else {
        state.chatFeedbackSubmitErrors = {
          ...state.chatFeedbackSubmitErrors,
          [key]: result.error,
        };
      }
    },
    assistantName: state.assistantName,
    assistantAvatar: state.assistantAvatar,
  });
}
