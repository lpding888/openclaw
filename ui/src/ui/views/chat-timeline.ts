import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import type {
  ChatTimelineDensity,
  ChatTimelineEvent,
  ChatTimelineFilterState,
  ChatTimelineRunSummary,
} from "../types.ts";
import { detectRunAlerts } from "../controllers/chat-observability.ts";

export type ChatTimelineProps = {
  events: ChatTimelineEvent[];
  runs: ChatTimelineRunSummary[];
  loading: boolean;
  runsLoading: boolean;
  error: string | null;
  runsError: string | null;
  density: ChatTimelineDensity;
  follow: boolean;
  filters: ChatTimelineFilterState;
  onFollowChange: (next: boolean) => void;
  onFiltersChange: (next: ChatTimelineFilterState) => void;
  onDensityChange?: (next: ChatTimelineDensity) => void;
  onCopyTrace?: (runId: string) => Promise<boolean> | boolean;
};

const DEFAULT_STREAMS = ["lifecycle", "assistant", "tool", "compaction", "error"];

function normalizeStreamMap(filters: ChatTimelineFilterState, streams: string[]) {
  const map = { ...filters.streams };
  for (const stream of streams) {
    if (typeof map[stream] !== "boolean") {
      map[stream] = true;
    }
  }
  return map;
}

function isSameStreamMap(
  current: ChatTimelineFilterState["streams"],
  next: ChatTimelineFilterState["streams"],
) {
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (currentKeys.length !== nextKeys.length) {
    return false;
  }
  for (const key of nextKeys) {
    if (current[key] !== next[key]) {
      return false;
    }
  }
  return true;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "-";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

function filterEvents(events: ChatTimelineEvent[], filters: ChatTimelineFilterState) {
  const runIdQuery = filters.runId.trim().toLowerCase();
  return events.filter((entry) => {
    if (!filters.streams[entry.stream]) {
      return false;
    }
    if (!runIdQuery) {
      return true;
    }
    return entry.runId.toLowerCase().includes(runIdQuery);
  });
}

function groupByRun(events: ChatTimelineEvent[]) {
  const byRun = new Map<string, ChatTimelineEvent[]>();
  for (const entry of events) {
    const list = byRun.get(entry.runId);
    if (list) {
      list.push(entry);
    } else {
      byRun.set(entry.runId, [entry]);
    }
  }
  return byRun;
}

function runStatusClass(status: ChatTimelineRunSummary["status"]) {
  if (status === "success") {
    return "success";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "aborted") {
    return "aborted";
  }
  return "running";
}

function showTimelineToast(button: HTMLButtonElement, message: string, kind: "success" | "error") {
  const panel = button.closest(".chat-timeline-panel");
  if (!panel) {
    return;
  }
  let toast = panel.querySelector<HTMLDivElement>(".chat-timeline-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "chat-timeline-toast";
    panel.appendChild(toast);
  }
  toast.dataset.kind = kind;
  toast.textContent = message;
  toast.dataset.show = "1";
  window.setTimeout(() => {
    if (!toast) {
      return;
    }
    toast.dataset.show = "0";
  }, 1_400);
}

async function handleCopyTraceClick(
  event: Event,
  runId: string,
  onCopyTrace: ChatTimelineProps["onCopyTrace"],
) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget as HTMLButtonElement | null;
  if (!button) {
    return;
  }
  const originalLabel = button.dataset.label || button.textContent?.trim() || "复制 Trace";
  button.dataset.label = originalLabel;
  button.dataset.state = "copying";
  button.textContent = "复制中...";
  try {
    const copied = (await onCopyTrace?.(runId)) !== false;
    if (!copied) {
      throw new Error("copy failed");
    }
    button.dataset.state = "copied";
    button.textContent = "已复制";
    showTimelineToast(button, "Trace 已复制", "success");
  } catch {
    button.dataset.state = "error";
    button.textContent = "复制失败";
    showTimelineToast(button, "复制失败，请重试", "error");
  } finally {
    window.setTimeout(() => {
      button.dataset.state = "idle";
      button.textContent = originalLabel;
    }, 1_500);
  }
}

export function renderChatTimeline(props: ChatTimelineProps) {
  const availableStreams = Array.from(
    new Set([...DEFAULT_STREAMS, ...props.events.map((entry) => entry.stream)]),
  );
  const streamMap = normalizeStreamMap(props.filters, availableStreams);
  const streamMapChanged = !isSameStreamMap(props.filters.streams, streamMap);
  const normalizedFilters: ChatTimelineFilterState = streamMapChanged
    ? {
        ...props.filters,
        streams: streamMap,
      }
    : props.filters;
  if (streamMapChanged) {
    queueMicrotask(() => props.onFiltersChange(normalizedFilters));
  }

  const filteredEvents = filterEvents(props.events, normalizedFilters);
  const eventsByRun = groupByRun(filteredEvents);
  const runs = normalizedFilters.runId.trim()
    ? props.runs.filter((run) =>
        run.runId.toLowerCase().includes(normalizedFilters.runId.trim().toLowerCase()),
      )
    : props.runs;

  return html`
    <section class="chat-timeline-panel">
      <header class="chat-timeline-panel__header">
        <div>
          <div class="chat-timeline-panel__title">AI 处理时间线</div>
          <div class="chat-timeline-panel__sub">按 run 分组，默认摘要模式，支持快速切到全量明细</div>
        </div>
        <button
          class="btn btn--sm ${props.follow ? "active" : ""}"
          type="button"
          @click=${() => props.onFollowChange(!props.follow)}
        >
          ${props.follow ? "自动跟随中" : "暂停跟随"}
        </button>
      </header>

      <div class="chat-timeline-panel__controls">
        <label class="field">
          <span>Run</span>
          <input
            .value=${normalizedFilters.runId}
            @input=${(event: Event) =>
              props.onFiltersChange({
                ...normalizedFilters,
                runId: (event.target as HTMLInputElement).value,
              })}
            placeholder="按 runId 过滤"
          />
        </label>
        <div class="chat-timeline-streams">
          ${availableStreams.map(
            (stream) => html`
              <button
                class="chat-timeline-stream ${normalizedFilters.streams[stream] ? "active" : ""}"
                @click=${() =>
                  props.onFiltersChange({
                    ...normalizedFilters,
                    streams: {
                      ...normalizedFilters.streams,
                      [stream]: !normalizedFilters.streams[stream],
                    },
                  })}
              >
                ${stream}
              </button>
            `,
          )}
        </div>
        <div class="chat-timeline-density">
          <button
            class="chat-timeline-density__btn ${props.density === "summary" ? "active" : ""}"
            type="button"
            @click=${() => props.onDensityChange?.("summary")}
          >
            摘要
          </button>
          <button
            class="chat-timeline-density__btn ${props.density === "expanded" ? "active" : ""}"
            type="button"
            @click=${() => props.onDensityChange?.("expanded")}
          >
            全展开
          </button>
        </div>
      </div>

      ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
      ${props.runsError ? html`<div class="callout danger">${props.runsError}</div>` : nothing}
      ${
        !props.follow
          ? html`
            <div class="callout info chat-timeline-panel__paused">
              自动跟随已暂停，滚动到最底或点击
              <button class="btn btn--sm" type="button" @click=${() => props.onFollowChange(true)}>
                回到实时
              </button>
            </div>
          `
          : nothing
      }

      <div
        class="chat-timeline-list"
        ${ref((el: Element | undefined | null) => {
          const list = el as HTMLDivElement | null;
          if (!list) {
            return;
          }
          if (props.density === "expanded") {
            queueMicrotask(() => {
              for (const details of list.querySelectorAll("details")) {
                details.open = true;
              }
            });
          }
          if (!props.follow) {
            return;
          }
          queueMicrotask(() => {
            list.scrollTop = list.scrollHeight;
          });
        })}
        @scroll=${(event: Event) => {
          const target = event.currentTarget as HTMLDivElement;
          const remain = target.scrollHeight - target.scrollTop - target.clientHeight;
          const nearBottom = remain < 16;
          if (nearBottom !== props.follow) {
            props.onFollowChange(nearBottom);
          }
        }}
      >
        ${
          props.loading || props.runsLoading
            ? html`
                <div class="muted">正在加载时间线…</div>
              `
            : nothing
        }
        ${
          runs.length === 0 && !props.loading && !props.runsLoading
            ? html`
                <div class="muted">暂无时间线事件</div>
              `
            : nothing
        }
        ${runs.map((run) => {
          const runEvents = eventsByRun.get(run.runId) ?? [];
          const alerts = detectRunAlerts(run, runEvents);
          const statusClass = runStatusClass(run.status);
          return html`
            <details class="chat-timeline-run chat-timeline-run--${statusClass}">
              <summary class="chat-timeline-run__summary">
                <div class="chat-timeline-run__identity">
                  <span class="chat-timeline-run__id">${run.runId}</span>
                  <span class="chat-timeline-run__status">${run.status}</span>
                </div>
                <div class="chat-timeline-run__meta">
                  <span>首字节 ${formatDuration(run.firstTokenMs)}</span>
                  <span>总耗时 ${formatDuration(run.totalMs)}</span>
                  <span>工具 ${run.toolCalls}</span>
                  <span>错误 ${run.toolErrors}</span>
                </div>
              </summary>
              <div class="chat-timeline-run__body">
                <div class="chat-timeline-run__stats">
                  <span>Started: ${formatTime(run.startedAt)}</span>
                  <span>Ended: ${run.endedAt ? formatTime(run.endedAt) : "-"}</span>
                  <span>Input: ${run.inputTokens ?? "-"}</span>
                  <span>Output: ${run.outputTokens ?? "-"}</span>
                  <span>Compaction: ${run.compactionCount}</span>
                  <span>Truncated: ${run.truncatedEvents}</span>
                </div>
                ${
                  alerts.length > 0
                    ? html`<div class="chat-timeline-run__alerts">
                      ${alerts.map((item) => html`<span class="chat-timeline-alert">${item}</span>`)}
                    </div>`
                    : nothing
                }
                <div class="chat-timeline-run__actions">
                  <button
                    class="btn btn--sm"
                    type="button"
                    @click=${(event: Event) =>
                      handleCopyTraceClick(event, run.runId, props.onCopyTrace)}
                  >
                    复制 Trace
                  </button>
                </div>
                <div class="chat-timeline-run__events">
                  ${
                    runEvents.length === 0
                      ? html`
                          <div class="muted">该 run 暂无事件明细</div>
                        `
                      : runEvents.map((entry) => {
                          const phase =
                            typeof entry.data.phase === "string" ? entry.data.phase : "";
                          return html`
                          <details class="chat-timeline-event">
                            <summary class="chat-timeline-event__summary">
                              <span class="chat-timeline-event__time">${formatTime(entry.ts)}</span>
                              <span class="chat-timeline-event__stream">${entry.stream}</span>
                              <span class="chat-timeline-event__phase">${phase || "-"}</span>
                              <span class="chat-timeline-event__seq">#${entry.seq}</span>
                              ${
                                entry.truncated
                                  ? html`
                                      <span class="chat-timeline-event__trunc">truncated</span>
                                    `
                                  : nothing
                              }
                            </summary>
                            <pre class="chat-timeline-event__data">${JSON.stringify(entry.data, null, 2)}</pre>
                          </details>
                        `;
                        })
                  }
                </div>
              </div>
            </details>
          `;
        })}
      </div>
    </section>
  `;
}
