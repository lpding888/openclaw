import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import type {
  ChatObservabilityPin,
  ChatFeedbackDraft,
  ChatFeedbackItem,
  ChatTimelineDensity,
  ChatTimelineEvent,
  ChatTimelineFilterState,
  ChatTimelineRunSummary,
  SessionsListResult,
} from "../types.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-types.ts";
import {
  CHAT_FEEDBACK_DEFAULT_DRAFT,
  type SubmitChatFeedbackParams,
} from "../controllers/chat-observability.ts";
import { icons } from "../icons.ts";
import { detectTextDirection } from "../text-direction.ts";
import { handleChatPaste, renderAttachmentPreview } from "./chat-attachments.ts";
import { renderCompactionIndicator } from "./chat-compaction.ts";
import { renderAssistantFeedback } from "./chat-feedback.ts";
import { renderChatSplitLayout } from "./chat-layout.ts";

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
  sendOnEnter: boolean;
  error: string | null;
  sessions: SessionsListResult | null;
  focusMode: boolean;
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
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
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
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
};

export function renderChat(props: ChatProps) {
  const canCompose = props.connected;
  const isBusy = props.sending || props.stream !== null;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
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

  const feedbackByMessageId = new Map<string, ChatFeedbackItem>(
    props.feedbackItems
      .filter((item) => item.sessionKey === props.sessionKey)
      .map((item) => [item.messageId, item]),
  );

  const renderAssistantFeedbackForGroup = (message: unknown, group: MessageGroup) =>
    renderAssistantFeedback(props, message, group, feedbackByMessageId);

  return html`
    <section class="card chat">
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}

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
          : nothing
      }

      ${renderChatSplitLayout(props, {
        assistantIdentity,
        showReasoning,
        renderAssistantFeedback: renderAssistantFeedbackForGroup,
      })}

      ${
        props.queue.length
          ? html`
              <div class="chat-queue" role="status" aria-live="polite">
                <div class="chat-queue__title">队列（${props.queue.length}）</div>
                <div class="chat-queue__list">
                  ${props.queue.map(
                    (item) => html`
                      <div class="chat-queue__item">
                        <div class="chat-queue__text">
                          ${
                            item.text ||
                            (item.attachments?.length ? `图片（${item.attachments.length}）` : "")
                          }
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
              <button class="btn chat-new-messages" type="button" @click=${props.onScrollToBottom}>
                New messages ↓
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
                if (!ta) {
                  return;
                }
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
                if (e.key !== "Enter") {
                  return;
                }
                if (e.isComposing || e.keyCode === 229) {
                  return;
                }
                if (props.sendOnEnter) {
                  if (e.shiftKey) {
                    return;
                  }
                  if (!props.connected) {
                    return;
                  }
                  e.preventDefault();
                  if (canCompose) {
                    props.onSend();
                  }
                } else {
                  const metaOrCtrl = e.metaKey || e.ctrlKey;
                  if (!metaOrCtrl) {
                    return;
                  }
                  if (!props.connected) {
                    return;
                  }
                  e.preventDefault();
                  if (canCompose) {
                    props.onSend();
                  }
                }
              }}
              @input=${(e: Event) => props.onDraftChange((e.target as HTMLTextAreaElement).value)}
              @paste=${(e: ClipboardEvent) => handleChatPaste(e, props)}
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
            <button class="btn primary" ?disabled=${!props.connected} @click=${props.onSend}>
              ${isBusy ? "队列" : "发送"}<kbd class="btn-kbd">↵</kbd>
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

export { CHAT_FEEDBACK_DEFAULT_DRAFT };
