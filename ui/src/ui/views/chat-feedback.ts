import { html, nothing } from "lit";
import {
  CHAT_FEEDBACK_DEFAULT_DRAFT,
  CHAT_FEEDBACK_TAGS,
  buildCorrectionPrompt,
} from "../controllers/chat-observability.ts";
import type {
  ChatFeedbackDraft,
  ChatFeedbackItem,
  ChatFeedbackTag,
  ChatTimelineRunSummary,
} from "../types.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import type { ChatProps } from "./chat.ts";

function resolveMessageTimestamp(message: unknown): number | null {
  const m = message as Record<string, unknown>;
  if (typeof m.timestamp === "number" && Number.isFinite(m.timestamp)) {
    return m.timestamp;
  }
  return null;
}

function resolveMessageId(message: unknown, fallback: string): string {
  const m = message as Record<string, unknown>;
  const id = typeof m.id === "string" ? m.id.trim() : "";
  if (id) {
    return id;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId.trim() : "";
  if (messageId) {
    return messageId;
  }
  const ts = resolveMessageTimestamp(message);
  return ts ? `msg:${ts}` : fallback;
}

function resolveRunIdForMessage(message: unknown, runs: ChatTimelineRunSummary[]): string | null {
  const m = message as Record<string, unknown>;
  const runId = typeof m.runId === "string" ? m.runId.trim() : "";
  if (runId) {
    return runId;
  }
  if (runs.length === 0) {
    return null;
  }
  const ts = resolveMessageTimestamp(message);
  if (!ts) {
    return runs[0]?.runId ?? null;
  }
  const matched = runs.find((run) => {
    const start = run.startedAt - 5_000;
    const end = (run.endedAt ?? run.updatedAt) + 60_000;
    return ts >= start && ts <= end;
  });
  if (matched) {
    return matched.runId;
  }
  return runs[0]?.runId ?? null;
}

function withDraftDefaults(draft: ChatFeedbackDraft | undefined): ChatFeedbackDraft {
  if (!draft) {
    return { ...CHAT_FEEDBACK_DEFAULT_DRAFT };
  }
  return {
    ...CHAT_FEEDBACK_DEFAULT_DRAFT,
    ...draft,
    tags: Array.isArray(draft.tags) ? draft.tags : [],
  };
}

function hasTag(draft: ChatFeedbackDraft, tag: ChatFeedbackTag): boolean {
  return draft.tags.includes(tag);
}

export function renderAssistantFeedback(
  props: ChatProps,
  message: unknown,
  group: MessageGroup,
  feedbackByMessageId: Map<string, ChatFeedbackItem>,
) {
  if (!props.onFeedbackDraftChange || !props.onFeedbackSubmit) {
    return nothing;
  }
  const messageId = resolveMessageId(message, `${group.key}:last`);
  const runId = resolveRunIdForMessage(message, props.timelineRuns);
  const draft = withDraftDefaults(props.feedbackDrafts[messageId]);
  const submitted = feedbackByMessageId.get(messageId);
  const submitKey = runId ? `${runId}:${messageId}` : `unknown:${messageId}`;
  const submitting = props.feedbackSubmitting[submitKey];
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
        ${
          submitted
            ? html`
                <span class="chat-feedback__submitted">
                  已写入 Agent 偏好 ·
                  ${new Date(submitted.acceptedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              `
            : nothing
        }
      </div>

      ${
        draft.open
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
                ${
                  draft.rating === "down"
                    ? html`
                        <button
                          class="btn btn--sm"
                          type="button"
                          @click=${() => {
                            props.onDraftChange(buildCorrectionPrompt(draft));
                            queueMicrotask(() => {
                              const input = document.querySelector<HTMLTextAreaElement>(
                                ".chat-compose__field textarea",
                              );
                              if (!input) {
                                return;
                              }
                              input.focus();
                              const length = input.value.length;
                              input.setSelectionRange(length, length);
                            });
                          }}
                        >
                          生成下一句纠偏指令
                        </button>
                      `
                    : nothing
                }
                <div class="chat-feedback__actions">
                  <button
                    class="btn btn--sm primary"
                    type="button"
                    ?disabled=${!draft.rating || !runId || submitting}
                    @click=${() => {
                      if (!draft.rating || !runId) {
                        return;
                      }
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
                  ${
                    !runId
                      ? html`
                          <span class="muted">无法匹配 runId</span>
                        `
                      : nothing
                  }
                </div>
                ${
                  submitError
                    ? html`
                        <div class="callout danger">
                          提交失败：${submitError}
                          ${
                            draft.rating && runId
                              ? html`
                                  <button
                                    class="btn btn--sm"
                                    type="button"
                                    @click=${() => {
                                      if (!draft.rating) {
                                        return;
                                      }
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
                              : nothing
                          }
                        </div>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}
