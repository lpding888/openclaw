const KEY = "clawdbot.control.settings.v1";

import type { ThemeMode } from "./theme";
import type {
  ChatObservabilityPin,
  ChatTimelineDensity,
  UiMotionLevel,
  UiVisualPreset,
} from "./types";

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  // 发送键偏好：true=回车发送（Shift+回车换行）；false=回车换行（Ctrl/⌘+回车发送）
  sendOnEnter: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
  uiVisualPreset: UiVisualPreset;
  uiMotionLevel: UiMotionLevel;
  chatTimelineDensity: ChatTimelineDensity;
  chatObservabilityPin: ChatObservabilityPin;
};

export function loadSettings(): UiSettings {
  const defaultUrl = (() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  })();

  const defaults: UiSettings = {
    gatewayUrl: defaultUrl,
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    sendOnEnter: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
    uiVisualPreset: "neo-v2",
    uiMotionLevel: "full",
    chatTimelineDensity: "summary",
    chatObservabilityPin: "timeline",
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      gatewayUrl:
        typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
          ? parsed.gatewayUrl.trim()
          : defaults.gatewayUrl,
      token: typeof parsed.token === "string" ? parsed.token : defaults.token,
      sessionKey:
        typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
          ? parsed.sessionKey.trim()
          : defaults.sessionKey,
      lastActiveSessionKey:
        typeof parsed.lastActiveSessionKey === "string" &&
        parsed.lastActiveSessionKey.trim()
          ? parsed.lastActiveSessionKey.trim()
          : (typeof parsed.sessionKey === "string" &&
              parsed.sessionKey.trim()) ||
            defaults.lastActiveSessionKey,
      theme:
        parsed.theme === "light" ||
        parsed.theme === "dark" ||
        parsed.theme === "system"
          ? parsed.theme
          : defaults.theme,
      chatFocusMode:
        typeof parsed.chatFocusMode === "boolean"
          ? parsed.chatFocusMode
          : defaults.chatFocusMode,
      chatShowThinking:
        typeof parsed.chatShowThinking === "boolean"
          ? parsed.chatShowThinking
          : defaults.chatShowThinking,
      sendOnEnter:
        typeof (parsed as Partial<UiSettings>).sendOnEnter === "boolean"
          ? (parsed as Partial<UiSettings>).sendOnEnter as boolean
          : defaults.sendOnEnter,
      splitRatio:
        typeof parsed.splitRatio === "number" &&
        parsed.splitRatio >= 0.4 &&
        parsed.splitRatio <= 0.7
          ? parsed.splitRatio
          : defaults.splitRatio,
      navCollapsed:
        typeof parsed.navCollapsed === "boolean"
          ? parsed.navCollapsed
          : defaults.navCollapsed,
      navGroupsCollapsed:
        typeof parsed.navGroupsCollapsed === "object" &&
        parsed.navGroupsCollapsed !== null
          ? parsed.navGroupsCollapsed
          : defaults.navGroupsCollapsed,
      uiVisualPreset:
        parsed.uiVisualPreset === "neo-v1" || parsed.uiVisualPreset === "neo-v2"
          ? parsed.uiVisualPreset
          : defaults.uiVisualPreset,
      uiMotionLevel:
        parsed.uiMotionLevel === "reduced" || parsed.uiMotionLevel === "full"
          ? parsed.uiMotionLevel
          : defaults.uiMotionLevel,
      chatTimelineDensity:
        parsed.chatTimelineDensity === "expanded" ||
        parsed.chatTimelineDensity === "summary"
          ? parsed.chatTimelineDensity
          : defaults.chatTimelineDensity,
      chatObservabilityPin:
        parsed.chatObservabilityPin === "insights" ||
        parsed.chatObservabilityPin === "timeline"
          ? parsed.chatObservabilityPin
          : defaults.chatObservabilityPin,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  localStorage.setItem(KEY, JSON.stringify(next));
}
