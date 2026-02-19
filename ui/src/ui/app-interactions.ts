import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { GatewayBrowserClient } from "./gateway.ts";
import type { UiSettings } from "./storage.ts";

export type ExecApprovalDecision = "allow-once" | "allow-always" | "deny";

type ExecApprovalHost = {
  execApprovalQueue: ExecApprovalRequest[];
  client: GatewayBrowserClient | null;
  execApprovalBusy: boolean;
  execApprovalError: string | null;
};

export async function handleExecApprovalDecision(
  host: ExecApprovalHost,
  decision: ExecApprovalDecision,
) {
  const active = host.execApprovalQueue[0];
  if (!active || !host.client || host.execApprovalBusy) {
    return;
  }
  host.execApprovalBusy = true;
  host.execApprovalError = null;
  try {
    await host.client.request("exec.approval.resolve", {
      id: active.id,
      decision,
    });
    host.execApprovalQueue = host.execApprovalQueue.filter((entry) => entry.id !== active.id);
  } catch (err) {
    host.execApprovalError = `Exec approval failed: ${String(err)}`;
  } finally {
    host.execApprovalBusy = false;
  }
}

type SidebarHost = {
  sidebarCloseTimer: number | null;
  sidebarContent: string | null;
  sidebarError: string | null;
  sidebarOpen: boolean;
  sidebarTab: "timeline" | "tool" | "insights";
};

export function handleOpenSidebar(host: SidebarHost, content: string) {
  if (host.sidebarCloseTimer != null) {
    window.clearTimeout(host.sidebarCloseTimer);
    host.sidebarCloseTimer = null;
  }
  host.sidebarContent = content;
  host.sidebarError = null;
  host.sidebarOpen = true;
  host.sidebarTab = "tool";
}

export function handleCloseSidebar(host: SidebarHost) {
  host.sidebarOpen = false;
  if (host.sidebarCloseTimer != null) {
    window.clearTimeout(host.sidebarCloseTimer);
  }
  host.sidebarCloseTimer = window.setTimeout(() => {
    if (host.sidebarOpen) {
      return;
    }
    host.sidebarContent = null;
    host.sidebarError = null;
    host.sidebarCloseTimer = null;
  }, 200);
}

export function handleSetSidebarTab(host: SidebarHost, tab: "timeline" | "tool" | "insights") {
  host.sidebarTab = tab;
  host.sidebarOpen = true;
  if (tab === "timeline" && host.sidebarCloseTimer != null) {
    window.clearTimeout(host.sidebarCloseTimer);
    host.sidebarCloseTimer = null;
  }
}

type SplitRatioHost = {
  splitRatio: number;
  settings: UiSettings;
  applySettings: (next: UiSettings) => void;
};

export function handleSplitRatioChange(host: SplitRatioHost, ratio: number) {
  const newRatio = Math.max(0.4, Math.min(0.7, ratio));
  host.splitRatio = newRatio;
  host.applySettings({ ...host.settings, splitRatio: newRatio });
}

type PendingGatewayUrlHost = {
  pendingGatewayUrl: string | null;
  settings: UiSettings;
  applySettings: (next: UiSettings) => void;
  connect: () => void;
};

export function acceptPendingGatewayUrl(host: PendingGatewayUrlHost) {
  const pending = host.pendingGatewayUrl;
  if (!pending) {
    return;
  }
  host.pendingGatewayUrl = null;
  host.applySettings({ ...host.settings, gatewayUrl: pending });
  host.connect();
}

export function rejectPendingGatewayUrl(host: PendingGatewayUrlHost) {
  host.pendingGatewayUrl = null;
}
