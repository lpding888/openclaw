import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { ref } from "lit/directives/ref.js";
import type {
  ChatObservabilityPin,
  ChatFeedbackDraft,
  ChatFeedbackItem,
  ChatFeedbackTag,
  ChatTimelineDensity,
  ChatTimelineEvent,
  ChatTimelineFilterState,
  ChatTimelineRunSummary,
  SessionsListResult,
} from "../types";
import type { ChatAttachment, ChatQueueItem } from "../ui-types";
import type { ChatItem, MessageGroup } from "../types/chat-types";
import { icons } from "../icons";
import {
  normalizeMessage,
  normalizeRoleForGrouping,
} from "../chat/message-normalizer";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
} from "../chat/grouped-render.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import { icons } from "../icons.ts";
import { detectTextDirection } from "../text-direction.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";
import "../components/resizable-divider.ts";

export type CompactionIndicatorStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type ChatProps = {
  sessionKey: string;
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  showThinking: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  stream: string | null;
  streamStartedAt: number | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  queue: ChatQueueItem[];
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  // 发送键偏好：true=回车发送；false=Ctrl/⌘+回车发送
  sendOnEnter: boolean;
  error: string | null;
  sessions: SessionsListResult | null;
  // Focus mode
  focusMode: boolean;
  // Sidebar state
  sidebarOpen?: boolean;
  sidebarTab?: "timeline" | "tool" | "insights";
  sidebarContent?: string | null;
  sidebarError?: string | null;
  splitRatio?: number;
  timelineEvents: ChatTimelineEvent[];
  timelineRuns: ChatTimelineRunSummary[];
  timelineLoading: boolean;
  timelineRunsLoading: boolean;
  timelineError: string | null;
  timelineRunsError: string | null;
  timelineServerSupported: boolean;
  timelineRunsServerSupported: boolean;
  timelineDensity: ChatTimelineDensity;
  observabilityPin: ChatObservabilityPin;
  timelineFollow: boolean;
  timelineFilters: ChatTimelineFilterState;
  feedbackItems: ChatFeedbackItem[];
  feedbackLoading: boolean;
  feedbackError: string | null;
  feedbackServerSupported: boolean;
  feedbackDrafts: Record<string, ChatFeedbackDraft>;
  feedbackSubmitting: Record<string, boolean>;
  feedbackSubmitErrors: Record<string, string | null>;
  currentRunId: string | null;
  assistantName: string;
  assistantAvatar: string | null;
  // Image attachments
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  // Event handlers
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onNewSession: () => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onSidebarTabChange?: (tab: "timeline" | "tool" | "insights") => void;
  onSplitRatioChange?: (ratio: number) => void;
  onTimelineFollowChange?: (next: boolean) => void;
  onTimelineFiltersChange?: (next: ChatTimelineFilterState) => void;
  onTimelineDensityChange?: (next: ChatTimelineDensity) => void;
  onObservabilityPinChange?: (next: ChatObservabilityPin) => void;
  onFeedbackDraftChange?: (messageId: string, patch: Partial<ChatFeedbackDraft>) => void;
  onFeedbackSubmit?: (params: SubmitChatFeedbackParams) => Promise<void> | void;
  onChatScroll?: (event: Event) => void;
};

const COMPACTION_TOAST_DURATION_MS = 5000;

function renderCompactionIndicator(status: CompactionIndicatorStatus | null | undefined) {
  if (!status) return nothing;

  // Show "compacting..." while active
  if (status.active) {
    return html`
      <div class="compaction-indicator compaction-indicator--active" role="status" aria-live="polite">
        ${icons.loader} Compacting context...
      </div>
    `;
  }

  // Show "compaction complete" briefly after completion
  if (status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return html`
        <div class="compaction-indicator compaction-indicator--complete" role="status" aria-live="polite">
          ${icons.check} Context compacted
        </div>
      `;
    }
  }

  return nothing;
}

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function handlePaste(
  e: ClipboardEvent,
  props: ChatProps,
) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) return;

  const imageItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      imageItems.push(item);
    }
  }

  if (imageItems.length === 0) return;

  e.preventDefault();

  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) continue;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const newAttachment: ChatAttachment = {
        id: generateAttachmentId(),
        dataUrl,
        mimeType: file.type,
      };
      const current = props.attachments ?? [];
      props.onAttachmentsChange?.([...current, newAttachment]);
    };
    reader.readAsDataURL(file);
  }
}

function renderAttachmentPreview(props: ChatProps) {
  const attachments = props.attachments ?? [];
  if (attachments.length === 0) return nothing;

  return html`
    <div class="chat-attachments">
      ${attachments.map(
        (att) => html`
          <div class="chat-attachment">
            <img
              src=${att.dataUrl}
              alt="附件预览"
              class="chat-attachment__img"
            />
            <button
              class="chat-attachment__remove"
              type="button"
              aria-label="移除附件"
              @click=${() => {
                const next = (props.attachments ?? []).filter(
                  (a) => a.id !== att.id,
                );
                props.onAttachmentsChange?.(next);
              }}
            >
              ${icons.x}
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function resolveMessageTimestamp(message: unknown): number | null {
  const m = message as Record<string, unknown>;
  if (typeof m.timestamp === "number" && Number.isFinite(m.timestamp)) return m.timestamp;
  return null;
}

function resolveMessageId(message: unknown, fallback: string): string {
  const m = message as Record<string, unknown>;
  const id = typeof m.id === "string" ? m.id.trim() : "";
  if (id) return id;
  const messageId = typeof m.messageId === "string" ? m.messageId.trim() : "";
  if (messageId) return messageId;
  const ts = resolveMessageTimestamp(message);
  return ts ? `msg:${ts}` : fallback;
}

function resolveRunIdForMessage(message: unknown, runs: ChatTimelineRunSummary[]): string | null {
  const m = message as Record<string, unknown>;
  const runId = typeof m.runId === "string" ? m.runId.trim() : "";
  if (runId) return runId;
  if (runs.length === 0) return null;
  const ts = resolveMessageTimestamp(message);
  if (!ts) return runs[0]?.runId ?? null;
  const matched = runs.find((run) => {
    const start = run.startedAt - 5_000;
    const end = (run.endedAt ?? run.updatedAt) + 60_000;
    return ts >= start && ts <= end;
  });
  if (matched) return matched.runId;
  return runs[0]?.runId ?? null;
}

function withDraftDefaults(draft: ChatFeedbackDraft | undefined): ChatFeedbackDraft {
  if (!draft) return { ...CHAT_FEEDBACK_DEFAULT_DRAFT };
  return {
    ...CHAT_FEEDBACK_DEFAULT_DRAFT,
    ...draft,
    tags: Array.isArray(draft.tags) ? draft.tags : [],
  };
}

function hasTag(draft: ChatFeedbackDraft, tag: ChatFeedbackTag): boolean {
  return draft.tags.includes(tag);
}

export function renderChat(props: ChatProps) {
  const canCompose = props.connected;
  const isBusy = props.sending || props.stream !== null;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const activeSession = props.sessions?.sessions?.find(
    (row) => row.key === props.sessionKey,
  );
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar: props.assistantAvatar ?? props.assistantAvatarUrl ?? null,
  };

  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const composePlaceholder = props.connected
    ? hasAttachments
      ? "添加消息或粘贴更多图片..."
      : props.sendOnEnter
        ? "消息（回车发送，Shift+回车换行，可粘贴图片）"
        : "消息（回车换行，Ctrl/⌘+回车发送，可粘贴图片）"
    : "连接到网关以开始聊天…";

  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = props.sidebarOpen !== false;
  const sidebarTab = props.sidebarTab ?? "timeline";
  const isMobile =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 768px)").matches;
  const resolvedSidebarTab = isMobile ? "timeline" : sidebarTab;
  const canPinObservability =
    resolvedSidebarTab === "timeline" || resolvedSidebarTab === "insights";
  const isPinnedObservability =
    canPinObservability && props.observabilityPin === resolvedSidebarTab;
  const activeRun = selectActiveRunSummary(props.timelineRuns, props.currentRunId);
  const activeRunEvents = activeRun
    ? props.timelineEvents.filter((item) => item.runId === activeRun.runId)
    : [];
  const activeAlerts = activeRun ? detectRunAlerts(activeRun, activeRunEvents) : [];
  const feedbackByMessageId = new Map<string, ChatFeedbackItem>(
    props.feedbackItems
      .filter((item) => item.sessionKey === props.sessionKey)
      .map((item) => [item.messageId, item]),
  );

  const renderAssistantFeedback = (message: unknown, group: MessageGroup) => {
    if (!props.onFeedbackDraftChange || !props.onFeedbackSubmit) return nothing;
    const messageId = resolveMessageId(message, `${group.key}:last`);
    const runId = resolveRunIdForMessage(message, props.timelineRuns);
    const draft = withDraftDefaults(props.feedbackDrafts[messageId]);
    const submitted = feedbackByMessageId.get(messageId);
    const submitKey = runId ? `${runId}:${messageId}` : `unknown:${messageId}`;
    const submitting = props.feedbackSubmitting[submitKey] === true;
    const submitError = props.feedbackSubmitErrors[submitKey] ?? null;

    return html`
      <div
        class="chat-feedback ${submitted ? "is-submitted" : ""} ${submitError ? "is-error" : ""}"
        aria-live="polite"
      >
        <div class="chat-feedback__row">
          <button
            class="chat-feedback__btn ${draft.rating === "up" ? "active" : ""}"
            type="button"
            @click=${() =>
              props.onFeedbackDraftChange?.(messageId, {
                rating: draft.rating === "up" ? null : "up",
                open: true,
              })}
          >
            👍
          </button>
          <button
            class="chat-feedback__btn ${draft.rating === "down" ? "active" : ""}"
            type="button"
            @click=${() =>
              props.onFeedbackDraftChange?.(messageId, {
                rating: draft.rating === "down" ? null : "down",
                open: true,
              })}
          >
            👎
          </button>
          <button
            class="btn btn--sm"
            type="button"
            @click=${() => props.onFeedbackDraftChange?.(messageId, { open: !draft.open })}
          >
            ${draft.open ? "收起" : "标签"}
          </button>
          <span class="chat-feedback__scope">作用范围: 当前 Agent 全局</span>
          ${submitted
            ? html`
                <span class="chat-feedback__submitted">
                  已写入 Agent 偏好 ·
                  ${new Date(submitted.acceptedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              `
            : nothing}
        </div>

        ${draft.open
          ? html`
              <div class="chat-feedback__panel">
                <div class="chat-feedback__tags">
                  ${CHAT_FEEDBACK_TAGS.map((tag) => {
                    const active = hasTag(draft, tag);
                    return html`
                      <button
                        class="chat-feedback__tag ${active ? "active" : ""}"
                        type="button"
                        @click=${() => {
                          const tags = active
                            ? draft.tags.filter((item) => item !== tag)
                            : [...draft.tags, tag];
                          props.onFeedbackDraftChange?.(messageId, { tags, open: true });
                        }}
                      >
                        ${tag}
                      </button>
                    `;
                  })}
                </div>
                <label class="field">
                  <span>补充说明</span>
                  <textarea
                    rows="2"
                    .value=${draft.comment}
                    @input=${(event: Event) =>
                      props.onFeedbackDraftChange?.(messageId, {
                        comment: (event.target as HTMLTextAreaElement).value,
                        open: true,
                      })}
                    placeholder="可选：描述问题或预期答案"
                  ></textarea>
                </label>
                ${draft.rating === "down"
                  ? html`
                      <button
                        class="btn btn--sm"
                        type="button"
                        @click=${() => {
                          props.onDraftChange(buildCorrectionPrompt(draft));
                          queueMicrotask(() => {
                            const input = document.querySelector(
                              ".chat-compose__field textarea",
                            ) as HTMLTextAreaElement | null;
                            if (!input) return;
                            input.focus();
                            const length = input.value.length;
                            input.setSelectionRange(length, length);
                          });
                        }}
                      >
                        生成下一句纠偏指令
                      </button>
                    `
                  : nothing}
                <div class="chat-feedback__actions">
                  <button
                    class="btn btn--sm primary"
                    type="button"
                    ?disabled=${!draft.rating || !runId || submitting}
                    @click=${() => {
                      if (!draft.rating || !runId) return;
                      void props.onFeedbackSubmit?.({
                        sessionKey: props.sessionKey,
                        runId,
                        messageId,
                        rating: draft.rating,
                        tags: draft.tags,
                        comment: draft.comment.trim() || undefined,
                        applyScope: "agent",
                        source: "chat-ui",
                      });
                    }}
                  >
                    ${submitting ? "提交中..." : "提交反馈"}
                  </button>
                  ${!runId ? html`<span class="muted">无法匹配 runId</span>` : nothing}
                </div>
                ${submitError
                  ? html`
                      <div class="callout danger">
                        提交失败：${submitError}
                        ${draft.rating && runId
                          ? html`
                              <button
                                class="btn btn--sm"
                                type="button"
                                @click=${() => {
                                  if (!draft.rating) return;
                                  void props.onFeedbackSubmit?.({
                                    sessionKey: props.sessionKey,
                                    runId,
                                    messageId,
                                    rating: draft.rating,
                                    tags: draft.tags,
                                    comment: draft.comment.trim() || undefined,
                                    applyScope: "agent",
                                    source: "chat-ui",
                                  });
                                }}
                              >
                                重试提交
                              </button>
                            `
                          : nothing}
                      </div>
                    `
                  : nothing}
              </div>
            `
          : nothing}
      </div>
    `;
  };

  const thread = html`
    <div
      class="chat-thread"
      role="log"
      aria-live="polite"
      @scroll=${props.onChatScroll}
    >
      ${
        props.loading
          ? html`
              <div class="muted">Loading chat…</div>
            `
          : nothing
      }
      ${repeat(
        buildChatItems(props),
        (item) => item.key,
        (item) => {
          if (item.kind === "divider") {
            return html`
              <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
                <span class="chat-divider__line"></span>
                <span class="chat-divider__label">${item.label}</span>
                <span class="chat-divider__line"></span>
              </div>
            `;
          }

          if (item.kind === "reading-indicator") {
            return renderReadingIndicatorGroup(assistantIdentity);
          }

        if (item.kind === "stream") {
          return renderStreamingGroup(
            item.text,
            item.startedAt,
            props.onOpenSidebar,
            assistantIdentity,
          );
        }

        if (item.kind === "group") {
          return renderMessageGroup(item, {
            onOpenSidebar: props.onOpenSidebar,
            showReasoning,
            assistantName: props.assistantName,
            assistantAvatar: assistantIdentity.avatar,
            renderAssistantFeedback,
          });
        }

        return nothing;
      })}
    </div>
  `;

  return html`
    <section class="card chat">
      ${props.disabledReason
        ? html`<div class="callout">${props.disabledReason}</div>`
        : nothing}

      ${props.error
        ? html`<div class="callout danger">${props.error}</div>`
        : nothing}

      ${
        props.focusMode
          ? html`
            <button
              class="chat-focus-exit"
              type="button"
              @click=${props.onToggleFocusMode}
              aria-label="退出专注模式"
              title="退出专注模式"
            >
              ${icons.x}
            </button>
          `
        : nothing}

      <div
        class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}"
      >
        <div
          class="chat-main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>

        ${sidebarOpen
          ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) =>
                  props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <div class="chat-sidebar">
                <div class="chat-sidebar-tabs">
                  <button
                    class="chat-sidebar-tab ${resolvedSidebarTab === "timeline" ? "active" : ""}"
                    @click=${() => props.onSidebarTabChange?.("timeline")}
                  >
                    时间线
                  </button>
                  <button
                    class="chat-sidebar-tab ${resolvedSidebarTab === "tool" ? "active" : ""}"
                    @click=${() => props.onSidebarTabChange?.("tool")}
                  >
                    工具输出
                  </button>
                  <button
                    class="chat-sidebar-tab ${resolvedSidebarTab === "insights" ? "active" : ""}"
                    @click=${() => props.onSidebarTabChange?.("insights")}
                  >
                    洞察
                  </button>
                  ${canPinObservability
                    ? html`
                        <button
                          class="btn btn--sm chat-sidebar-pin ${isPinnedObservability ? "active" : ""}"
                          type="button"
                          @click=${() => {
                            if (!canPinObservability) return;
                            props.onObservabilityPinChange?.(
                              resolvedSidebarTab === "insights" ? "insights" : "timeline",
                            );
                          }}
                        >
                          ${isPinnedObservability ? "已设默认" : "设为默认"}
                        </button>
                      `
                    : nothing}
                  <button
                    class="btn btn--sm chat-sidebar-close"
                    type="button"
                    @click=${() => props.onCloseSidebar?.()}
                    title="收起右侧面板"
                  >
                    ${icons.x}
                  </button>
                </div>
                <div class="chat-sidebar-body">
                  ${resolvedSidebarTab === "timeline"
                    ? renderChatTimeline({
                        events: props.timelineEvents,
                        runs: props.timelineRuns,
                        loading: props.timelineLoading,
                        runsLoading: props.timelineRunsLoading,
                        error: props.timelineError,
                        runsError: props.timelineRunsError,
                        density: props.timelineDensity,
                        follow: props.timelineFollow,
                        filters: props.timelineFilters,
                        onFollowChange: (next) => props.onTimelineFollowChange?.(next),
                        onFiltersChange: (next) => props.onTimelineFiltersChange?.(next),
                        onDensityChange: (next) => props.onTimelineDensityChange?.(next),
                        onCopyTrace: async (runId) => {
                          const result = await copyRunTrace(
                            runId,
                            props.timelineRuns,
                            props.timelineEvents,
                          );
                          return result.copied;
                        },
                      })
                    : resolvedSidebarTab === "tool"
                      ? renderMarkdownSidebar({
                          content: props.sidebarContent ?? null,
                          error: props.sidebarError ?? null,
                          onClose: () => props.onCloseSidebar?.(),
                          onViewRawText: () => {
                            if (!props.sidebarContent || !props.onOpenSidebar) return;
                            props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                          },
                          embedded: true,
                        })
                      : renderChatInsights({
                          activeRun,
                          activeAlerts,
                          timelineRunsServerSupported: props.timelineRunsServerSupported,
                          feedbackServerSupported: props.feedbackServerSupported,
                          feedbackItems: props.feedbackItems,
                          feedbackLoading: props.feedbackLoading,
                          feedbackError: props.feedbackError,
                        })}
                </div>
              </div>
            `
          : html`
              <button
                class="btn chat-sidebar-reopen"
                type="button"
                @click=${() =>
                  props.onSidebarTabChange?.(
                    isMobile ? "timeline" : props.observabilityPin,
                  )}
              >
                显示时间线
              </button>
            `}
      </div>

      ${props.queue.length
        ? html`
            <div class="chat-queue" role="status" aria-live="polite">
              <div class="chat-queue__title">队列（${props.queue.length}）</div>
              <div class="chat-queue__list">
                ${props.queue.map(
                  (item) => html`
                    <div class="chat-queue__item">
                      <div class="chat-queue__text">
                        ${item.text ||
                        (item.attachments?.length
                          ? `图片（${item.attachments.length}）`
                          : "")}
                      </div>
                      <button
                        class="btn chat-queue__remove"
                        type="button"
                        aria-label="移除队列消息"
                        @click=${() => props.onQueueRemove(item.id)}
                      >
                        ${icons.x}
                      </button>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
          : nothing
      }

      ${renderCompactionIndicator(props.compactionStatus)}

      ${
        props.showNewMessages
          ? html`
            <button
              class="btn chat-new-messages"
              type="button"
              @click=${props.onScrollToBottom}
            >
              New messages ${icons.arrowDown}
            </button>
          `
          : nothing
      }

      <div class="chat-compose">
        ${renderAttachmentPreview(props)}
        <div class="chat-compose__row">
          <label class="field chat-compose__field">
            <span>消息</span>
            <textarea
              ${ref((el: Element | undefined | null) => {
                const ta = el as HTMLTextAreaElement | null;
                if (!ta) return;
                // 自动高度：最多占屏幕高度的 50%，上限 320px
                const autosize = () => {
                  const max = Math.min(Math.round(window.innerHeight * 0.5), 320);
                  ta.style.height = "auto";
                  ta.style.height = Math.min(ta.scrollHeight, max) + "px";
                };
                queueMicrotask(autosize);
                ta.addEventListener("input", autosize);
              })}
              .value=${props.draft}
              dir=${detectTextDirection(props.draft)}
              ?disabled=${!props.connected}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key !== "Enter") return;
                if (e.isComposing || e.keyCode === 229) return;
                if (props.sendOnEnter) {
                  // 回车发送；Shift+回车换行
                  if (e.shiftKey) return;
                  if (!props.connected) return;
                  e.preventDefault();
                  if (canCompose) props.onSend();
                } else {
                  // 回车换行；Ctrl/⌘+回车发送
                  const metaOrCtrl = e.metaKey || e.ctrlKey;
                  if (!metaOrCtrl) return; // 普通回车 = 换行
                  if (!props.connected) return;
                  e.preventDefault();
                  if (canCompose) props.onSend();
                }
              }}
              @input=${(e: Event) =>
                props.onDraftChange((e.target as HTMLTextAreaElement).value)}
              @paste=${(e: ClipboardEvent) => handlePaste(e, props)}
              placeholder=${composePlaceholder}
            ></textarea>
          </label>
          <div class="chat-compose__actions">
            <button
              class="btn"
              ?disabled=${!props.connected || (!canAbort && props.sending)}
              @click=${canAbort ? props.onAbort : props.onNewSession}
            >
              ${canAbort ? "停止" : "新会话"}
            </button>
            <button
              class="btn primary"
              ?disabled=${!props.connected}
              @click=${props.onSend}
            >
              ${isBusy ? "队列" : "发送"}<kbd class="btn-kbd">↵</kbd>
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

const CHAT_HISTORY_RENDER_LIMIT = 200;

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const timestamp = normalized.timestamp || Date.now();

    if (!currentGroup || currentGroup.role !== role) {
      if (currentGroup) result.push(currentGroup);
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) result.push(currentGroup);
  return result;
}

function buildChatItems(props: ChatProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `显示最后 ${CHAT_HISTORY_RENDER_LIMIT} 条消息（隐藏 ${historyStart} 条）。`,
        timestamp: Date.now(),
      },
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!props.showThinking && normalized.role.toLowerCase() === "toolresult") {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
  }
  if (props.showThinking) {
    for (let i = 0; i < tools.length; i++) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  return groupMessages(items);
}

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) return `tool:${toolCallId}`;
  const id = typeof m.id === "string" ? m.id : "";
  if (id) return `msg:${id}`;
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) return `msg:${messageId}`;
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) return `msg:${role}:${timestamp}:${index}`;
  return `msg:${role}:${index}`;
}
