import { html, nothing } from "lit";

import type { AppViewState } from "./app-view-state";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { TAB_GROUPS, subtitleForTab, titleForTab } from "./navigation";
import { icons } from "./icons";
import { renderExecApprovalPrompt } from "./views/exec-approval";
import { renderGatewayUrlConfirmPrompt } from "./views/gateway-url-confirm";
import {
  renderChatControls,
  renderTab,
  renderThemeToggle,
  renderTopbarModelSwitcher,
} from "./app-render.helpers";
import { renderMainContent } from "./app-render-content";

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId =
    parsed?.agentId ??
    state.agentsList?.defaultId ??
    "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) return undefined;
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) return candidate;
  return identity?.avatarUrl;
}

export function renderApp(state: AppViewState) {
  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : "与网关断开连接。";
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;

  const configRoot = (state.configForm ??
    state.configSnapshot?.config ??
    null) as Record<string, unknown> | null;
  const gatewayCfg =
    configRoot &&
    typeof configRoot.gateway === "object" &&
    configRoot.gateway &&
    !Array.isArray(configRoot.gateway)
      ? (configRoot.gateway as Record<string, unknown>)
      : null;
  const gatewayAuthCfg =
    gatewayCfg &&
    typeof gatewayCfg.auth === "object" &&
    gatewayCfg.auth &&
    !Array.isArray(gatewayCfg.auth)
      ? (gatewayCfg.auth as Record<string, unknown>)
      : null;
  const gatewayControlUiCfg =
    gatewayCfg &&
    typeof gatewayCfg.controlUi === "object" &&
    gatewayCfg.controlUi &&
    !Array.isArray(gatewayCfg.controlUi)
      ? (gatewayCfg.controlUi as Record<string, unknown>)
      : null;
  const serverAuthMode =
    gatewayAuthCfg?.mode === "token" || gatewayAuthCfg?.mode === "password"
      ? gatewayAuthCfg.mode
      : null;
  const serverAllowInsecureAuth =
    typeof gatewayControlUiCfg?.allowInsecureAuth === "boolean"
      ? gatewayControlUiCfg.allowInsecureAuth
      : null;

  return html`
    <div class="shell ${isChat ? "shell--chat" : ""} ${chatFocus ? "shell--chat-focus" : ""} ${state.settings.navCollapsed ? "shell--nav-collapsed" : ""} ${state.onboarding ? "shell--onboarding" : ""}">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="nav-collapse-toggle"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${state.settings.navCollapsed ? "展开侧边栏" : "折叠侧边栏"}"
            aria-label="${state.settings.navCollapsed ? "展开侧边栏" : "折叠侧边栏"}"
          >
            <span class="nav-collapse-toggle__icon">${icons.menu}</span>
          </button>
          <div class="brand">
            <div class="brand-logo">
              <img src="https://mintcdn.com/clawdhub/4rYvG-uuZrMK_URE/assets/pixel-lobster.svg?fit=max&auto=format&n=4rYvG-uuZrMK_URE&q=85&s=da2032e9eac3b5d9bfe7eb96ca6a8a26" alt="Clawdbot" />
            </div>
            <div class="brand-text">
              <div class="brand-title">CLAWDBOT</div>
              <div class="brand-sub">网关控制台</div>
            </div>
          </div>
        </div>
        <div class="topbar-status">
          <div class="pill">
            <span class="statusDot ${state.connected ? "ok" : ""}"></span>
            <span>健康状态</span>
            <span class="mono">${state.connected ? "正常" : "离线"}</span>
          </div>
          ${renderTopbarModelSwitcher(state)}
          ${renderThemeToggle(state)}
        </div>
      </header>
      <aside class="nav ${state.settings.navCollapsed ? "nav--collapsed" : ""}">
        ${TAB_GROUPS.map((group) => {
          const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
          const hasActiveTab = group.tabs.some((tab) => tab === state.tab);
          return html`
            <div class="nav-group ${isGroupCollapsed && !hasActiveTab ? "nav-group--collapsed" : ""}">
              <button
                class="nav-label"
                @click=${() => {
                  const next = { ...state.settings.navGroupsCollapsed };
                  next[group.label] = !isGroupCollapsed;
                  state.applySettings({
                    ...state.settings,
                    navGroupsCollapsed: next,
                  });
                }}
                aria-expanded=${!isGroupCollapsed}
              >
                <span class="nav-label__text">${group.label}</span>
                <span class="nav-label__chevron">${isGroupCollapsed ? "+" : "−"}</span>
              </button>
              <div class="nav-group__items">
                ${group.tabs.map((tab) => renderTab(state, tab))}
              </div>
            </div>
          `;
        })}
        <div class="nav-group nav-group--links">
          <div class="nav-label nav-label--static">
            <span class="nav-label__text">资源</span>
          </div>
          <div class="nav-group__items">
            <a
              class="nav-item nav-item--external"
              href="https://docs.clawd.bot"
              target="_blank"
              rel="noreferrer"
              title="文档（在新标签页中打开）"
            >
              <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
              <span class="nav-item__text">文档</span>
            </a>
          </div>
        </div>
      </aside>
      <main class="content ${isChat ? "content--chat" : ""}">
        <section class="content-header">
          <div>
            <div class="page-title">${titleForTab(state.tab)}</div>
            <div class="page-sub">${subtitleForTab(state.tab)}</div>
          </div>
          <div class="page-meta">
            ${state.lastError
              ? html`<div class="pill danger">${state.lastError}</div>`
              : nothing}
            ${isChat ? renderChatControls(state) : nothing}
          </div>
        </section>

        ${renderMainContent(state, {
          presenceCount,
          sessionsCount,
          cronNext,
          chatDisabledReason,
          showThinking,
          chatFocus,
          chatAvatarUrl,
          serverAuthMode,
          serverAllowInsecureAuth,
        })}
      </main>
      ${renderExecApprovalPrompt(state)}
      ${renderGatewayUrlConfirmPrompt(state)}
    </div>
  `;
}
