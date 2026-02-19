import type { NodeRegistry } from "./node-registry.js";
import { safeParseJson } from "./server-methods/nodes.helpers.js";
import { createNodeSubscriptionManager } from "./server-node-subscriptions.js";

export function createGatewayNodeRuntime(nodeRegistry: NodeRegistry) {
  const nodeSubscriptions = createNodeSubscriptionManager();
  const nodeSendEvent = (opts: { nodeId: string; event: string; payloadJSON?: string | null }) => {
    const payload = safeParseJson(opts.payloadJSON ?? null);
    nodeRegistry.sendEvent(opts.nodeId, opts.event, payload);
  };

  return {
    nodeSubscriptions,
    nodeSendToSession: (sessionKey: string, event: string, payload: unknown) =>
      nodeSubscriptions.sendToSession(sessionKey, event, payload, nodeSendEvent),
    nodeSendToAllSubscribed: (event: string, payload: unknown) =>
      nodeSubscriptions.sendToAllSubscribed(event, payload, nodeSendEvent),
    nodeSubscribe: nodeSubscriptions.subscribe,
    nodeUnsubscribe: nodeSubscriptions.unsubscribe,
    nodeUnsubscribeAll: nodeSubscriptions.unsubscribeAll,
  };
}
