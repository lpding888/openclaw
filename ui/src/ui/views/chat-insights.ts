import { html, nothing } from "lit";

import type { ChatFeedbackItem, ChatTimelineRunSummary } from "../types";

export type ChatInsightsProps = {
  activeRun: ChatTimelineRunSummary | null;
  activeAlerts: string[];
  timelineRunsServerSupported: boolean;
  feedbackServerSupported: boolean;
  feedbackItems: ChatFeedbackItem[];
  feedbackLoading: boolean;
  feedbackError: string | null;
};

function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function formatTime(ts?: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function renderChatInsights(props: ChatInsightsProps) {
  const limited = !(props.timelineRunsServerSupported && props.feedbackServerSupported);
  return html`
    <section class="chat-insights-panel">
      <header class="chat-insights-panel__header">
        <div class="chat-insights-panel__title">洞察</div>
        <div class="chat-insights-panel__sub">
          ${!limited
            ? "运行摘要与反馈持久化已启用"
            : "洞察能力受限（网关缺少部分方法）"}
        </div>
      </header>

      ${limited
        ? html`<div class="callout info chat-insights-panel__limited">当前网关不支持完整洞察接口，已自动降级到可用能力。</div>`
        : nothing}
      ${props.feedbackError ? html`<div class="callout danger">${props.feedbackError}</div>` : nothing}

      <div class="chat-insights-section">
        <div class="chat-insights-section__title">当前 Run</div>
        ${props.activeRun
          ? html`
              <div class="chat-insights-run">
                <div class="chat-insights-run__meta">
                  <span class="chat-insights-run__id">${props.activeRun.runId}</span>
                  <span class="chat-insights-run__status status-${props.activeRun.status}">
                    ${props.activeRun.status}
                  </span>
                </div>
                <div class="chat-insights-run__grid">
                  <span>首字节: ${formatDuration(props.activeRun.firstTokenMs)}</span>
                  <span>总耗时: ${formatDuration(props.activeRun.totalMs)}</span>
                  <span>工具: ${props.activeRun.toolCalls}</span>
                  <span>错误: ${props.activeRun.toolErrors}</span>
                  <span>输入: ${props.activeRun.inputTokens ?? "-"}</span>
                  <span>输出: ${props.activeRun.outputTokens ?? "-"}</span>
                  <span>开始: ${formatTime(props.activeRun.startedAt)}</span>
                  <span>结束: ${formatTime(props.activeRun.endedAt)}</span>
                </div>
                ${props.activeAlerts.length > 0
                  ? html`
                      <div class="chat-insights-run__alerts">
                        ${props.activeAlerts.map((item) => html`<span class="chat-insights-alert">${item}</span>`)}
                      </div>
                    `
                  : nothing}
              </div>
            `
          : html`<div class="muted">暂无运行摘要</div>`}
      </div>

      <div class="chat-insights-section">
        <div class="chat-insights-section__title">最近反馈</div>
        ${props.feedbackLoading ? html`<div class="muted">正在加载反馈…</div>` : nothing}
        ${!props.feedbackLoading && props.feedbackItems.length === 0
          ? html`<div class="muted">暂无反馈记录</div>`
          : nothing}
        ${props.feedbackItems.slice(0, 40).map((item) => {
          const ts = new Date(item.acceptedAt).toLocaleString();
          return html`
            <article class="chat-insights-feedback">
              <div class="chat-insights-feedback__head">
                <span class="rating-${item.rating}">${item.rating === "up" ? "好评" : "差评"}</span>
                <span class="chat-insights-feedback__run">${item.runId}</span>
                <span class="chat-insights-feedback__time">${ts}</span>
              </div>
              <div class="chat-insights-feedback__tags">
                ${item.tags.length > 0 ? item.tags.join(", ") : "无标签"}
              </div>
              ${item.comment ? html`<div class="chat-insights-feedback__comment">${item.comment}</div>` : nothing}
            </article>
          `;
        })}
      </div>
    </section>
  `;
}
