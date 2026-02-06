import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelChoice } from "../types.ts";

export type ModelsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  modelsLoading: boolean;
  modelsError: string | null;
  modelsList: ModelChoice[];
};

function asModelListPayload(value: unknown): { models?: unknown } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as { models?: unknown };
}

export async function loadModels(state: ModelsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.modelsLoading) {
    return;
  }
  state.modelsLoading = true;
  state.modelsError = null;
  try {
    const res = await state.client.request("models.list", {});
    const payload = asModelListPayload(res);
    const listRaw = payload?.models;
    state.modelsList = Array.isArray(listRaw) ? (listRaw as ModelChoice[]) : [];
  } catch (err) {
    state.modelsError = String(err);
  } finally {
    state.modelsLoading = false;
  }
}
