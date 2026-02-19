import type { GatewayBrowserClient } from "../gateway.ts";
import type { NodeSnapshot } from "../types.ts";
import { normalizeNodeSnapshots } from "../node-snapshot.ts";

export type NodesState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  nodesLoading: boolean;
  nodes: NodeSnapshot[];
  lastError: string | null;
};

type NodesListResponse = {
  nodes?: unknown[];
};

export async function loadNodes(state: NodesState, opts?: { quiet?: boolean }) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.nodesLoading) {
    return;
  }
  state.nodesLoading = true;
  if (!opts?.quiet) {
    state.lastError = null;
  }
  try {
    const res = await state.client.request<NodesListResponse>("node.list", {});
    state.nodes = normalizeNodeSnapshots(res.nodes);
  } catch (err) {
    if (!opts?.quiet) {
      state.lastError = String(err);
    }
  } finally {
    state.nodesLoading = false;
  }
}
