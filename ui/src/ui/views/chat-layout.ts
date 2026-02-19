import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { ChatTimelineDensity, ChatTimelineFilterState } from "../types.ts";
import type { MessageGroup } from "../types/chat-types.ts";
import type { ChatProps } from "./chat.ts";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
} from "../chat/grouped-render.ts";
import {
  copyRunTrace,
  detectRunAlerts,
  selectActiveRunSummary,
} from "../controllers/chat-observability.ts";
import { icons } from "../icons.ts";
import { renderChatInsights } from "./chat-insights.ts";
import { buildChatItems } from "./chat-items.ts";
import { renderChatTimeline } from "./chat-timeline.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";
import "../components/resizable-divider.ts";

export type AssistantIdentity = {
  name: string;
  avatar: string | null;
};

export type RenderChatSplitLayoutOptions = {
  assistantIdentity: AssistantIdentity;
  showReasoning: boolean;
  renderAssistantFeedback: (
    message: unknown,
    group: MessageGroup,
  ) => TemplateResult | typeof nothing;
};

export function renderChatSplitLayout(
  props: ChatProps,
  options: RenderChatSplitLayoutOptions,
): TemplateResult {
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

  const thread = html`
    <div class="chat-thread" role="log" aria-live="polite" @scroll=${props.onChatScroll}>
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
            return renderReadingIndicatorGroup(options.assistantIdentity);
          }

          if (item.kind === "stream") {
            return renderStreamingGroup(
              item.text,
              item.startedAt,
              props.onOpenSidebar,
              options.assistantIdentity,
            );
          }

          if (item.kind === "group") {
            return renderMessageGroup(item, {
              onOpenSidebar: props.onOpenSidebar,
              showReasoning: options.showReasoning,
              assistantName: options.assistantIdentity.name,
              assistantAvatar: options.assistantIdentity.avatar,
              renderAssistantFeedback: options.renderAssistantFeedback,
            });
          }

          return nothing;
        },
      )}
    </div>
  `;

  return html`
    <div class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}">
      <div class="chat-main" style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}">
        ${thread}
      </div>

      ${
        sidebarOpen
          ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
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
                  ${
                    canPinObservability
                      ? html`
                          <button
                            class="btn btn--sm chat-sidebar-pin ${isPinnedObservability ? "active" : ""}"
                            type="button"
                            @click=${() => {
                              if (!canPinObservability) {
                                return;
                              }
                              props.onObservabilityPinChange?.(
                                resolvedSidebarTab === "insights" ? "insights" : "timeline",
                              );
                            }}
                          >
                            ${isPinnedObservability ? "已设默认" : "设为默认"}
                          </button>
                        `
                      : nothing
                  }
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
                  ${
                    resolvedSidebarTab === "timeline"
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
                          onFollowChange: (next: boolean) => props.onTimelineFollowChange?.(next),
                          onFiltersChange: (next: ChatTimelineFilterState) =>
                            props.onTimelineFiltersChange?.(next),
                          onDensityChange: (next: ChatTimelineDensity) =>
                            props.onTimelineDensityChange?.(next),
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
                              if (!props.sidebarContent || !props.onOpenSidebar) {
                                return;
                              }
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
                          })
                  }
                </div>
              </div>
            `
          : html`
              <button
                class="btn chat-sidebar-reopen"
                type="button"
                @click=${() =>
                  props.onSidebarTabChange?.(isMobile ? "timeline" : props.observabilityPin)}
              >
                显示时间线
              </button>
            `
      }
    </div>
  `;
}
