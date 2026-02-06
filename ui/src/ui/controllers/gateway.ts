import type { GatewayBrowserClient } from "../gateway.ts";

export type GatewayRestartState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  lastError: string | null;
};

export async function restartGateway(
  state: GatewayRestartState,
  opts?: { delayMs?: number; reason?: string; note?: string; sessionKey?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.lastError = null;
  try {
    await state.client.request("gateway.restart", {
      delayMs: opts?.delayMs,
      reason: opts?.reason,
      note: opts?.note,
      sessionKey: opts?.sessionKey,
    });
  } catch (err) {
    state.lastError = String(err);
  }
}
