const KEY = "openclaw.control.settings.v1";

import type { ThemeMode } from "./theme.ts";

declare global {
  interface Window {
    __OPENCLAW_DESKTOP_DEFAULT_GATEWAY_URL__?: string;
    __OPENCLAW_DESKTOP_DEFAULT_GATEWAY_TOKEN__?: string;
  }
}

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
};

export function loadSettings(): UiSettings {
  const defaultUrl = (() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  })();

  const desktopDefaultGatewayUrl =
    typeof window.__OPENCLAW_DESKTOP_DEFAULT_GATEWAY_URL__ === "string" &&
    window.__OPENCLAW_DESKTOP_DEFAULT_GATEWAY_URL__.trim()
      ? window.__OPENCLAW_DESKTOP_DEFAULT_GATEWAY_URL__.trim()
      : null;
  const desktopDefaultToken =
    typeof window.__OPENCLAW_DESKTOP_DEFAULT_GATEWAY_TOKEN__ === "string" &&
    window.__OPENCLAW_DESKTOP_DEFAULT_GATEWAY_TOKEN__.trim()
      ? window.__OPENCLAW_DESKTOP_DEFAULT_GATEWAY_TOKEN__.trim()
      : null;

  const defaults: UiSettings = {
    gatewayUrl: desktopDefaultGatewayUrl ?? defaultUrl,
    token: desktopDefaultToken ?? "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    const parsedGatewayUrl =
      typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
        ? parsed.gatewayUrl.trim()
        : null;
    const parsedToken = typeof parsed.token === "string" ? parsed.token : null;

    // Desktop: if the user never customized the gateway URL (still pointing at the UI host),
    // auto-point to the local gateway so first-run is "just works".
    const shouldAutoOverrideGatewayUrl =
      !!desktopDefaultGatewayUrl && (!parsedGatewayUrl || parsedGatewayUrl === defaultUrl);

    return {
      gatewayUrl: shouldAutoOverrideGatewayUrl
        ? desktopDefaultGatewayUrl
        : (parsedGatewayUrl ?? defaults.gatewayUrl),
      token: parsedToken ?? defaults.token,
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
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  localStorage.setItem(KEY, JSON.stringify(next));
}
