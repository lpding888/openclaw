import type { GatewayBrowserClient } from "../gateway";
import type { ConfigSnapshot } from "../types";
import { cloneConfigObject, serializeConfigForm } from "./config/form-utils";

export type ModelSwitcherOption = {
  id: string;
  name: string;
  provider: string;
  label: string;
};

type ModelsListResponse = {
  models?: Array<{
    id?: string;
    name?: string;
    provider?: string;
  }>;
};

type ModelSwitcherState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  applySessionKey: string;
  modelSwitcherLoading: boolean;
  modelSwitcherSaving: boolean;
  modelSwitcherCurrent: string | null;
  modelSwitcherSelected: string;
  modelSwitcherOptions: ModelSwitcherOption[];
  modelSwitcherError: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asObject(parent[key]);
  if (existing) return existing;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function readPrimaryModel(config: unknown): string | null {
  const root = asObject(config);
  if (!root) return null;
  const agents = asObject(root.agents);
  const defaults = asObject(agents?.defaults);
  const modelRaw = defaults?.model;
  if (typeof modelRaw === "string") {
    const trimmed = modelRaw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const modelObj = asObject(modelRaw);
  if (!modelObj) return null;
  const primary = modelObj.primary;
  if (typeof primary !== "string") return null;
  const trimmed = primary.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeModelOptions(payload: ModelsListResponse): ModelSwitcherOption[] {
  const raw = Array.isArray(payload.models) ? payload.models : [];
  const dedup = new Map<string, ModelSwitcherOption>();
  for (const entry of raw) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    const name = typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : id;
    const provider =
      typeof entry?.provider === "string" && entry.provider.trim() ? entry.provider.trim() : "unknown";
    dedup.set(id, {
      id,
      name,
      provider,
      label: `${name} (${id})`,
    });
  }
  return Array.from(dedup.values()).sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

function ensureCurrentModelOption(
  options: ModelSwitcherOption[],
  current: string | null,
): ModelSwitcherOption[] {
  if (!current) return options;
  if (options.some((entry) => entry.id === current)) return options;
  return [
    {
      id: current,
      name: "当前配置",
      provider: "custom",
      label: `当前配置 (${current})`,
    },
    ...options,
  ];
}

export async function loadModelSwitcher(state: ModelSwitcherState) {
  if (!state.client || !state.connected) return;
  if (state.modelSwitcherLoading) return;
  state.modelSwitcherLoading = true;
  state.modelSwitcherError = null;
  try {
    const [modelsRes, configRes] = await Promise.all([
      state.client.request("models.list", {}),
      state.client.request("config.get", {}),
    ]);
    const options = normalizeModelOptions(modelsRes as ModelsListResponse);
    const configSnapshot = configRes as ConfigSnapshot;
    const current = readPrimaryModel(configSnapshot.config ?? null);
    const optionsWithCurrent = ensureCurrentModelOption(options, current);

    state.modelSwitcherOptions = optionsWithCurrent;
    state.modelSwitcherCurrent = current;
    if (current) {
      state.modelSwitcherSelected = current;
    } else if (!state.modelSwitcherSelected && optionsWithCurrent.length > 0) {
      state.modelSwitcherSelected = optionsWithCurrent[0].id;
    }
  } catch (err) {
    state.modelSwitcherError = String(err);
  } finally {
    state.modelSwitcherLoading = false;
  }
}

export async function applyModelSwitcherSelection(state: ModelSwitcherState) {
  if (!state.client || !state.connected) return;
  const nextModel = state.modelSwitcherSelected.trim();
  if (!nextModel) {
    state.modelSwitcherError = "请选择模型后再应用。";
    return;
  }
  state.modelSwitcherSaving = true;
  state.modelSwitcherError = null;
  try {
    const snapshot = (await state.client.request("config.get", {})) as ConfigSnapshot;
    if (!snapshot.hash) {
      state.modelSwitcherError = "配置哈希缺失，请刷新后重试。";
      return;
    }
    const sourceConfig = asObject(snapshot.config);
    if (!sourceConfig) {
      state.modelSwitcherError = "当前配置不可写，请先修复配置后再切换模型。";
      return;
    }

    const root = cloneConfigObject(sourceConfig);
    const agents = ensureObject(root, "agents");
    const defaults = ensureObject(agents, "defaults");
    const modelRaw = defaults.model;
    if (typeof modelRaw === "string") {
      defaults.model = { primary: nextModel };
    } else {
      const modelObj = ensureObject(defaults, "model");
      modelObj.primary = nextModel;
    }

    const raw = serializeConfigForm(root);
    await state.client.request("config.apply", {
      raw,
      baseHash: snapshot.hash,
      sessionKey: state.applySessionKey,
    });
    state.modelSwitcherCurrent = nextModel;
  } catch (err) {
    state.modelSwitcherError = String(err);
  } finally {
    state.modelSwitcherSaving = false;
  }
}
