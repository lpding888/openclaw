const KEY = "openclaw.control.settings.v1";
const LEGACY_KEY = "clawdbot.control.settings.v1";
const DEVICE_AUTH_KEY = "openclaw.device.auth.v1";
const LEGACY_DEVICE_AUTH_KEY = "clawdbot.device.auth.v1";
const DEVICE_IDENTITY_KEY = "openclaw-device-identity-v1";
const LEGACY_DEVICE_IDENTITY_KEY = "clawdbot-device-identity-v1";
const MAX_SETTINGS_JSON_CHARS = 200_000;

import { isSupportedLocale } from "../i18n/index.ts";
import type { ThemeMode } from "./theme.ts";
import type {
  ChatObservabilityPin,
  ChatTimelineDensity,
  UiMotionLevel,
  UiVisualPreset,
} from "./types.ts";

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

function normalizeGatewayUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
    } else if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
    }
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return fallback;
    }
    return parsed.toString();
  } catch {
    // Keep backward compatibility for host:port style values.
    if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) {
      return `ws://${trimmed}`;
    }
    return fallback;
  }
}

function shouldResetUiStateFromUrl(): boolean {
  if (typeof location === "undefined") {
    return false;
  }
  try {
    const params = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
    const raw = params.get("resetUi") ?? hash.get("resetUi");
    if (!raw) {
      return false;
    }
    const normalized = raw.trim().toLowerCase();
    return (
      normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
    );
  } catch {
    return false;
  }
}

function resetUiStorage() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(DEVICE_AUTH_KEY);
    localStorage.removeItem(LEGACY_DEVICE_AUTH_KEY);
    localStorage.removeItem(DEVICE_IDENTITY_KEY);
    localStorage.removeItem(LEGACY_DEVICE_IDENTITY_KEY);
  } catch {
    // best-effort
  }
}

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

  if (shouldResetUiStateFromUrl()) {
    resetUiStorage();
    return defaults;
  }

  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) {
      return defaults;
    }
    if (raw.length > MAX_SETTINGS_JSON_CHARS) {
      // Corrupted / oversized cache should not block control UI startup.
      resetUiStorage();
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      gatewayUrl: normalizeGatewayUrl(parsed.gatewayUrl, defaults.gatewayUrl),
      token: typeof parsed.token === "string" ? parsed.token : defaults.token,
      sessionKey:
        typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
          ? parsed.sessionKey.trim()
          : defaults.sessionKey,
      lastActiveSessionKey:
        typeof parsed.lastActiveSessionKey === "string" && parsed.lastActiveSessionKey.trim()
          ? parsed.lastActiveSessionKey.trim()
          : (typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()) ||
            defaults.lastActiveSessionKey,
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : defaults.theme,
      chatFocusMode:
        typeof parsed.chatFocusMode === "boolean" ? parsed.chatFocusMode : defaults.chatFocusMode,
      chatShowThinking:
        typeof parsed.chatShowThinking === "boolean"
          ? parsed.chatShowThinking
          : defaults.chatShowThinking,
      sendOnEnter:
        typeof parsed.sendOnEnter === "boolean" ? parsed.sendOnEnter : defaults.sendOnEnter,
      splitRatio:
        typeof parsed.splitRatio === "number" &&
        parsed.splitRatio >= 0.4 &&
        parsed.splitRatio <= 0.7
          ? parsed.splitRatio
          : defaults.splitRatio,
      navCollapsed:
        typeof parsed.navCollapsed === "boolean" ? parsed.navCollapsed : defaults.navCollapsed,
      navGroupsCollapsed:
        typeof parsed.navGroupsCollapsed === "object" && parsed.navGroupsCollapsed !== null
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
        parsed.chatTimelineDensity === "expanded" || parsed.chatTimelineDensity === "summary"
          ? parsed.chatTimelineDensity
          : defaults.chatTimelineDensity,
      chatObservabilityPin:
        parsed.chatObservabilityPin === "insights" || parsed.chatObservabilityPin === "timeline"
          ? parsed.chatObservabilityPin
          : defaults.chatObservabilityPin,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Privacy mode / storage quota should not break UI rendering.
  }
}
