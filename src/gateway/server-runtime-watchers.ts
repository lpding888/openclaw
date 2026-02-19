import { clearAgentRunContext, onAgentEvent } from "../infra/agent-events.js";
import { onHeartbeatEvent } from "../infra/heartbeat-events.js";
import { startHeartbeatRunner, type HeartbeatRunner } from "../infra/heartbeat-runner.js";
import { createAgentEventHandler } from "./server-chat.js";
import { startGatewayMaintenanceTimers } from "./server-maintenance.js";

type AgentEventParams = Omit<Parameters<typeof createAgentEventHandler>[0], "clearAgentRunContext">;

type GatewayLogger = {
  child: (name: string) => GatewayLogger;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type CronLogger = {
  error: (message: string) => void;
};

export async function startGatewayRuntimeWatchers(params: {
  minimalTestGateway: boolean;
  cfgAtStart: ReturnType<typeof import("../config/config.js").loadConfig>;
  cron: { start: () => Promise<void> };
  log: GatewayLogger;
  logCron: CronLogger;
  maintenanceParams: Parameters<typeof startGatewayMaintenanceTimers>[0];
  agentEventParams: AgentEventParams;
  broadcastHeartbeat: (evt: unknown) => void;
}) {
  const {
    minimalTestGateway,
    cfgAtStart,
    cron,
    log,
    logCron,
    maintenanceParams,
    agentEventParams,
    broadcastHeartbeat,
  } = params;

  const noopInterval = () => setInterval(() => {}, 1 << 30);
  let tickInterval = noopInterval();
  let healthInterval = noopInterval();
  let dedupeCleanup = noopInterval();
  if (!minimalTestGateway) {
    ({ tickInterval, healthInterval, dedupeCleanup } =
      startGatewayMaintenanceTimers(maintenanceParams));
  }

  const agentUnsub = minimalTestGateway
    ? null
    : onAgentEvent(
        createAgentEventHandler({
          ...agentEventParams,
          clearAgentRunContext,
        }),
      );

  const heartbeatUnsub = minimalTestGateway
    ? null
    : onHeartbeatEvent((evt) => {
        broadcastHeartbeat(evt);
      });

  const heartbeatRunner: HeartbeatRunner = minimalTestGateway
    ? {
        stop: () => {},
        updateConfig: () => {},
      }
    : startHeartbeatRunner({ cfg: cfgAtStart });

  if (!minimalTestGateway) {
    void cron.start().catch((err) => logCron.error(`failed to start: ${String(err)}`));
    void (async () => {
      const { recoverPendingDeliveries } = await import("../infra/outbound/delivery-queue.js");
      const { deliverOutboundPayloads } = await import("../infra/outbound/deliver.js");
      const logRecovery = log.child("delivery-recovery");
      await recoverPendingDeliveries({
        deliver: deliverOutboundPayloads,
        log: logRecovery,
        cfg: cfgAtStart,
      });
    })().catch((err) => log.error(`Delivery recovery failed: ${String(err)}`));
  }

  return {
    tickInterval,
    healthInterval,
    dedupeCleanup,
    agentUnsub,
    heartbeatUnsub,
    heartbeatRunner,
  };
}
