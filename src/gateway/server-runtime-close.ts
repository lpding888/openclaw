import { stopDiagnosticHeartbeat } from "../logging/diagnostic.js";
import { runGlobalGatewayStopSafely } from "../plugins/hook-runner-global.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { createGatewayCloseHandler } from "./server-close.js";

export function createGatewayServerRuntime(params: {
  port: number;
  diagnosticsEnabled: boolean;
  log: { warn: (message: string) => void };
  authRateLimiter?: AuthRateLimiter;
  onBeforeClose: () => void;
  closeHandlerParams: Parameters<typeof createGatewayCloseHandler>[0];
}) {
  const { port, diagnosticsEnabled, log, authRateLimiter, onBeforeClose, closeHandlerParams } =
    params;
  const closeHandler = createGatewayCloseHandler(closeHandlerParams);

  return {
    close: async (opts?: { reason?: string; restartExpectedMs?: number | null }) => {
      // Run gateway_stop plugin hook before shutdown.
      await runGlobalGatewayStopSafely({
        event: { reason: opts?.reason ?? "gateway stopping" },
        ctx: { port },
        onError: (err) => log.warn(`gateway_stop hook failed: ${String(err)}`),
      });
      if (diagnosticsEnabled) {
        stopDiagnosticHeartbeat();
      }
      onBeforeClose();
      authRateLimiter?.dispose();
      await closeHandler(opts);
    },
  };
}
