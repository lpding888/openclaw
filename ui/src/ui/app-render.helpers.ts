import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";

import type { AppViewState } from "./app-view-state";
import { iconForTab, pathForTab, titleForTab, type Tab } from "./navigation";
import { icons } from "./icons";
import { loadChatHistory } from "./controllers/chat";
import { loadChatTimeline } from "./controllers/chat-timeline";
import { loadChatFeedbackList, loadChatTimelineRuns } from "./controllers/chat-observability";
import { applyModelSwitcherSelection, loadModelSwitcher } from "./controllers/model-switcher";
import { syncUrlWithSessionKey } from "./app-settings";
import type { SessionsListResult } from "./types";
import type { ThemeMode } from "./theme";
import type { ThemeTransitionContext } from "./theme-transition";

export function renderTab(state: AppViewState, tab: Tab) {
  const href = pathForTab(tab, state.basePath);
  return html`
    <a
      href=${href}
      class="nav-item ${state.tab === tab ? "active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__text">${titleForTab(tab)}</span>
    </a>
  `;
}

export function renderChatControls(state: AppViewState) {
  const sessionOptions = resolveSessionOptions(state.sessionKey, state.sessionsResult);
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  // Refresh icon
  const refreshIcon = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>`;
  const focusIcon = html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h3"></path><path d="M20 7V4h-3"></path><path d="M4 17v3h3"></path><path d="M20 17v3h-3"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  return html`
    <div class="chat-controls">
      <label class="field chat-controls__session">
        <select
          .value=${state.sessionKey}
          ?disabled=${!state.connected}
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            state.sessionKey = next;
            state.chatMessage = "";
            state.chatStream = null;
            state.chatStreamStartedAt = null;
            state.chatRunId = null;
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
            syncUrlWithSessionKey(state, next, true);
            void loadChatHistory(state);
            void loadChatTimeline(state);
            void loadChatTimelineRuns(state);
            void loadChatFeedbackList(state);
          }}
        >
          ${repeat(
            sessionOptions,
            (entry) => entry.key,
            (entry) =>
              html`<option value=${entry.key}>
                ${entry.displayName ?? entry.key}
              </option>`,
          )}
        </select>
      </label>
      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${() => {
          state.resetToolStream();
          void Promise.all([
            loadChatHistory(state),
            loadChatTimeline(state),
            loadChatTimelineRuns(state),
            loadChatFeedbackList(state),
          ]);
        }}
        title="刷新聊天记录"
      >
        ${refreshIcon}
      </button>
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) return;
          state.applySettings({
            ...state.settings,
            chatShowThinking: !state.settings.chatShowThinking,
          });
        }}
        aria-pressed=${showThinking}
        title=${disableThinkingToggle
          ? "在引导期间禁用"
          : "切换助手思考/工作输出"}
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon btn--icon-labeled ${state.sidebarOpen ? "active" : ""}"
        @click=${() => {
          if (state.sidebarOpen) {
            state.handleCloseSidebar();
            return;
          }
          state.handleSetSidebarTab("timeline");
        }}
        aria-pressed=${state.sidebarOpen}
        title=${state.sidebarOpen ? "隐藏右侧面板" : "显示右侧面板"}
      >
        ${icons.barChart}
        <span>实时过程</span>
      </button>
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) return;
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${disableFocusToggle
          ? "在引导期间禁用"
          : "切换焦点模式（隐藏侧边栏和页面头部）"}
      >
        ${focusIcon}
      </button>
      <label class="field chat-controls__session" title="发送键偏好">
        <select
          .value=${state.settings.sendOnEnter ? "enter" : "ctrl"}
          @change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            state.applySettings({
              ...state.settings,
              sendOnEnter: v === "enter",
            });
          }}
        >
          <option value="enter">回车发送</option>
          <option value="ctrl">Ctrl/⌘+回车发送</option>
        </select>
      </label>
      <label class="field chat-controls__session" title="视觉预设">
        <select
          .value=${state.settings.uiVisualPreset}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            state.applySettings({
              ...state.settings,
              uiVisualPreset: value === "neo-v1" ? "neo-v1" : "neo-v2",
            });
          }}
        >
          <option value="neo-v2">拟物 V2</option>
          <option value="neo-v1">拟物 V1</option>
        </select>
      </label>
      <label class="field chat-controls__session" title="动效强度">
        <select
          .value=${state.settings.uiMotionLevel}
          @change=${(e: Event) => {
            const value = (e.target as HTMLSelectElement).value;
            state.applySettings({
              ...state.settings,
              uiMotionLevel: value === "reduced" ? "reduced" : "full",
            });
          }}
        >
          <option value="full">动效完整</option>
          <option value="reduced">动效简化</option>
        </select>
      </label>
    </div>
  `;
}

function resolveSessionOptions(sessionKey: string, sessions: SessionsListResult | null) {
  const seen = new Set<string>();
  const options: Array<{ key: string; displayName?: string }> = [];

  const resolvedCurrent = sessions?.sessions?.find((s) => s.key === sessionKey);

  // Add current session key first
  seen.add(sessionKey);
  options.push({ key: sessionKey, displayName: resolvedCurrent?.displayName });

  // Add sessions from the result
  if (sessions?.sessions) {
    for (const s of sessions.sessions) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        options.push({ key: s.key, displayName: s.displayName });
      }
    }
  }

  return options;
}

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

export function renderThemeToggle(state: AppViewState) {
  const index = Math.max(0, THEME_ORDER.indexOf(state.theme));
  const applyTheme = (next: ThemeMode) => (event: MouseEvent) => {
    const element = event.currentTarget as HTMLElement;
    const context: ThemeTransitionContext = { element };
    if (event.clientX || event.clientY) {
      context.pointerClientX = event.clientX;
      context.pointerClientY = event.clientY;
    }
    state.setTheme(next, context);
  };

  return html`
    <div class="theme-toggle" style="--theme-index: ${index};">
      <div class="theme-toggle__track" role="group" aria-label="主题">
        <span class="theme-toggle__indicator"></span>
        <button
          class="theme-toggle__button ${state.theme === "system" ? "active" : ""}"
          @click=${applyTheme("system")}
          aria-pressed=${state.theme === "system"}
          aria-label="系统主题"
          title="系统"
        >
          ${renderMonitorIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "light" ? "active" : ""}"
          @click=${applyTheme("light")}
          aria-pressed=${state.theme === "light"}
          aria-label="浅色主题"
          title="浅色"
        >
          ${renderSunIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "dark" ? "active" : ""}"
          @click=${applyTheme("dark")}
          aria-pressed=${state.theme === "dark"}
          aria-label="深色主题"
          title="深色"
        >
          ${renderMoonIcon()}
        </button>
      </div>
    </div>
  `;
}

export function renderTopbarModelSwitcher(state: AppViewState) {
  const disabled = !state.connected || state.modelSwitcherLoading || state.modelSwitcherSaving;
  const hasOptions = state.modelSwitcherOptions.length > 0;
  const selected = state.modelSwitcherSelected;
  const showApply =
    Boolean(selected) &&
    !state.modelSwitcherSaving &&
    selected !== (state.modelSwitcherCurrent ?? "");
  const hint = state.modelSwitcherSaving
    ? "应用中..."
    : state.modelSwitcherLoading
      ? "加载中..."
      : state.modelSwitcherCurrent
        ? `当前：${state.modelSwitcherCurrent}`
        : "未设置";

  return html`
    <div class="topbar-model" title="快速切换默认模型">
      <span class="topbar-model__label">模型</span>
      <select
        class="topbar-model__select"
        .value=${selected}
        ?disabled=${disabled || !hasOptions}
        @change=${(event: Event) => {
          state.modelSwitcherSelected = (event.target as HTMLSelectElement).value;
        }}
      >
        ${hasOptions
          ? state.modelSwitcherOptions.map(
              (entry) => html`<option value=${entry.id}>${entry.label}</option>`,
            )
          : html`<option value="">暂无可用模型</option>`}
      </select>
      <button
        class="btn btn--sm"
        ?disabled=${state.modelSwitcherLoading || state.modelSwitcherSaving || !state.connected}
        @click=${() => {
          void loadModelSwitcher(state);
        }}
      >
        刷新
      </button>
      <button
        class="btn btn--sm primary"
        ?disabled=${!showApply}
        @click=${() => {
          void applyModelSwitcherSelection(state);
        }}
      >
        应用
      </button>
      <span class="topbar-model__hint">${hint}</span>
      ${state.modelSwitcherError
        ? html`<span class="topbar-model__error" title=${state.modelSwitcherError}>!</span>`
        : nothing}
    </div>
  `;
}

function renderSunIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path>
      <path d="M12 20v2"></path>
      <path d="m4.93 4.93 1.41 1.41"></path>
      <path d="m17.66 17.66 1.41 1.41"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="m6.34 17.66-1.41 1.41"></path>
      <path d="m19.07 4.93-1.41 1.41"></path>
    </svg>
  `;
}

function renderMoonIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      ></path>
    </svg>
  `;
}

function renderMonitorIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <line x1="8" x2="16" y1="21" y2="21"></line>
      <line x1="12" x2="12" y1="17" y2="21"></line>
    </svg>
  `;
}
