import type { GatewayBrowserClient, GatewayHelloOk } from "../gateway.ts";
import type { ConfigSnapshot } from "../types.ts";
import { cloneConfigObject, serializeConfigForm } from "./config/form-utils.ts";

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

type ModelsDefaultGetResponse = {
  primary?: string | null;
  fallbacks?: string[];
  configHash?: string;
  sourcePath?: string;
};

type ModelsDefaultSetResponse = {
  primary?: string;
  fallbacks?: string[];
  configHash?: string;
  sourcePath?: string;
};

type ModelDefaultsSnapshot = {
  primary: string | null;
  fallbacks: string[];
  configHash: string | null;
  sourcePath: string | null;
};

type ModelSwitcherState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello?: GatewayHelloOk | null;
  applySessionKey: string;
  modelSwitcherLoading: boolean;
  modelSwitcherSaving: boolean;
  modelSwitcherCurrent: string | null;
  modelSwitcherSelected: string;
  modelSwitcherOptions: ModelSwitcherOption[];
  modelSwitcherError: string | null;
  modelSwitcherStatus?: string | null;
  modelSwitcherCompatMode?: boolean;
  modelSwitcherConfigHash?: string | null;
  modelSwitcherFallbacks?: string[];
  modelCenterPrimary?: string;
  modelCenterFallbacksText?: string;
  modelCenterAllowCustom?: boolean;
  modelCenterSaving?: boolean;
  modelCenterError?: string | null;
  modelCenterStatus?: string | null;
  modelCenterQuery?: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = asObject(parent[key]);
  if (existing) {
    return existing;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function trimNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFallbacks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const dedup = new Set<string>();
  for (const entry of value) {
    const normalized = trimNonEmpty(entry);
    if (!normalized) {
      continue;
    }
    dedup.add(normalized);
  }
  return [...dedup];
}

function parseFallbackList(raw: string): string[] {
  const dedup = new Set<string>();
  for (const segment of raw.split(/[\n,]/g)) {
    const normalized = segment.trim();
    if (!normalized) {
      continue;
    }
    dedup.add(normalized);
  }
  return [...dedup];
}

function readDefaultsModelFromConfig(config: unknown): ModelDefaultsSnapshot {
  const root = asObject(config);
  const agents = asObject(root?.agents);
  const defaults = asObject(agents?.defaults);
  const modelRaw = defaults?.model;

  if (typeof modelRaw === "string") {
    return {
      primary: trimNonEmpty(modelRaw),
      fallbacks: [],
      configHash: null,
      sourcePath: null,
    };
  }

  const modelObj = asObject(modelRaw);
  if (!modelObj) {
    return {
      primary: null,
      fallbacks: [],
      configHash: null,
      sourcePath: null,
    };
  }

  return {
    primary: trimNonEmpty(modelObj.primary),
    fallbacks: normalizeFallbacks(modelObj.fallbacks),
    configHash: null,
    sourcePath: null,
  };
}

function normalizeModelOptions(payload: ModelsListResponse): ModelSwitcherOption[] {
  const raw = Array.isArray(payload.models) ? payload.models : [];
  const dedup = new Map<string, ModelSwitcherOption>();
  for (const entry of raw) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) {
      continue;
    }
    const name = typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : id;
    const provider =
      typeof entry?.provider === "string" && entry.provider.trim()
        ? entry.provider.trim()
        : "unknown";
    dedup.set(id, {
      id,
      name,
      provider,
      label: `${name} (${id})`,
    });
  }
  return Array.from(dedup.values()).toSorted(
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
  if (!current) {
    return options;
  }
  if (options.some((entry) => entry.id === current)) {
    return options;
  }
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

function supportsModelsDefaultRpc(state: ModelSwitcherState): boolean {
  const methods = state.hello?.features?.methods;
  if (!Array.isArray(methods)) {
    return false;
  }
  return methods.includes("models.default.get") && methods.includes("models.default.set");
}

function normalizeDefaultsFromRpc(payload: ModelsDefaultGetResponse): ModelDefaultsSnapshot {
  return {
    primary: trimNonEmpty(payload.primary),
    fallbacks: normalizeFallbacks(payload.fallbacks),
    configHash: trimNonEmpty(payload.configHash),
    sourcePath: trimNonEmpty(payload.sourcePath),
  };
}

function applyModelDefaultsToState(state: ModelSwitcherState, defaults: ModelDefaultsSnapshot) {
  state.modelSwitcherCurrent = defaults.primary;
  state.modelSwitcherConfigHash = defaults.configHash;
  state.modelSwitcherFallbacks = defaults.fallbacks;
  state.modelCenterPrimary = defaults.primary ?? "";
  state.modelCenterFallbacksText = defaults.fallbacks.join(", ");
}

async function loadDefaultsViaLegacyConfig(
  state: ModelSwitcherState,
): Promise<ModelDefaultsSnapshot> {
  const snapshot = await state.client!.request<ConfigSnapshot>("config.get", {});
  const parsed = readDefaultsModelFromConfig(snapshot.config ?? null);
  return {
    ...parsed,
    configHash: trimNonEmpty(snapshot.hash),
    sourcePath: trimNonEmpty(snapshot.path),
  };
}

async function loadDefaultsFromGateway(state: ModelSwitcherState): Promise<{
  defaults: ModelDefaultsSnapshot;
  compatMode: boolean;
}> {
  if (!supportsModelsDefaultRpc(state)) {
    return {
      defaults: await loadDefaultsViaLegacyConfig(state),
      compatMode: true,
    };
  }
  try {
    const payload = await state.client!.request<ModelsDefaultGetResponse>("models.default.get", {});
    return {
      defaults: normalizeDefaultsFromRpc(payload),
      compatMode: false,
    };
  } catch (err) {
    if (String(err).includes("unknown method")) {
      return {
        defaults: await loadDefaultsViaLegacyConfig(state),
        compatMode: true,
      };
    }
    throw err;
  }
}

async function applyModelViaLegacyConfig(
  state: ModelSwitcherState,
  primary: string,
  fallbacks: string[] | null,
): Promise<ModelDefaultsSnapshot> {
  const snapshot = await state.client!.request<ConfigSnapshot>("config.get", {});
  if (!snapshot.hash) {
    throw new Error("配置哈希缺失，请刷新后重试。");
  }
  const sourceConfig = asObject(snapshot.config);
  if (!sourceConfig) {
    throw new Error("当前配置不可写，请先修复配置后再切换模型。");
  }

  const root = cloneConfigObject(sourceConfig);
  const agents = ensureObject(root, "agents");
  const defaults = ensureObject(agents, "defaults");

  const parsed = readDefaultsModelFromConfig(snapshot.config ?? null);
  const nextFallbacks = fallbacks ?? parsed.fallbacks;
  defaults.model = {
    primary,
    ...(nextFallbacks.length > 0 ? { fallbacks: nextFallbacks } : {}),
  };

  const raw = serializeConfigForm(root);
  await state.client!.request("config.apply", {
    raw,
    baseHash: snapshot.hash,
    sessionKey: state.applySessionKey,
  });

  return {
    primary,
    fallbacks: nextFallbacks,
    configHash: snapshot.hash,
    sourcePath: trimNonEmpty(snapshot.path),
  };
}

function ensureHashForSet(state: ModelSwitcherState): string {
  const hash = trimNonEmpty(state.modelSwitcherConfigHash);
  if (!hash) {
    throw new Error("配置哈希缺失，请刷新后重试。");
  }
  return hash;
}

function toErrorMessage(err: unknown): string {
  if (typeof err === "string") {
    const text = err.trim();
    return text || "未知错误";
  }
  if (err instanceof Error) {
    const text = err.message.trim();
    return text || "未知错误";
  }
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return "未知错误";
}

function applySetResult(
  state: ModelSwitcherState,
  primary: string,
  result: ModelsDefaultSetResponse,
  fallbackWhenMissing: string[],
) {
  const fallbacks = normalizeFallbacks(result.fallbacks);
  const resolvedFallbacks =
    fallbacks.length > 0 || fallbackWhenMissing.length === 0 ? fallbacks : fallbackWhenMissing;

  const defaults: ModelDefaultsSnapshot = {
    primary,
    fallbacks: resolvedFallbacks,
    configHash: trimNonEmpty(result.configHash),
    sourcePath: trimNonEmpty(result.sourcePath),
  };
  applyModelDefaultsToState(state, defaults);
  state.modelSwitcherOptions = ensureCurrentModelOption(state.modelSwitcherOptions, primary);
}

export async function loadModelSwitcher(state: ModelSwitcherState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.modelSwitcherLoading) {
    return;
  }
  state.modelSwitcherLoading = true;
  state.modelSwitcherError = null;
  try {
    const [modelsRes, defaultsRes] = await Promise.all([
      state.client.request<ModelsListResponse>("models.list", {}),
      loadDefaultsFromGateway(state),
    ]);

    const options = normalizeModelOptions(modelsRes);
    const defaults = defaultsRes.defaults;

    state.modelSwitcherCompatMode = defaultsRes.compatMode;
    state.modelSwitcherStatus = defaultsRes.compatMode
      ? "兼容模式：当前网关不支持快速模型接口"
      : null;

    applyModelDefaultsToState(state, defaults);

    const optionsWithCurrent = ensureCurrentModelOption(options, defaults.primary);
    state.modelSwitcherOptions = optionsWithCurrent;

    if (defaults.primary) {
      state.modelSwitcherSelected = defaults.primary;
    } else if (!state.modelSwitcherSelected && optionsWithCurrent.length > 0) {
      state.modelSwitcherSelected = optionsWithCurrent[0].id;
    }
  } catch (err) {
    state.modelSwitcherError = toErrorMessage(err);
  } finally {
    state.modelSwitcherLoading = false;
  }
}

export async function applyModelSwitcherSelection(state: ModelSwitcherState, nextModel?: string) {
  if (!state.client || !state.connected) {
    return;
  }

  const targetModel = (nextModel ?? state.modelSwitcherSelected).trim();
  if (!targetModel) {
    state.modelSwitcherError = "请选择模型后再切换。";
    return;
  }

  const previousCurrent = state.modelSwitcherCurrent;
  const previousSelected = state.modelSwitcherSelected;

  if (previousCurrent === targetModel) {
    state.modelSwitcherSelected = targetModel;
    return;
  }

  state.modelSwitcherSaving = true;
  state.modelSwitcherError = null;
  state.modelSwitcherStatus = "保存中...";
  state.modelSwitcherSelected = targetModel;
  state.modelSwitcherCurrent = targetModel;

  try {
    if (state.modelSwitcherCompatMode) {
      const defaults = await applyModelViaLegacyConfig(state, targetModel, null);
      applyModelDefaultsToState(state, defaults);
    } else {
      const baseHash = ensureHashForSet(state);
      const result = await state.client.request<ModelsDefaultSetResponse>("models.default.set", {
        primary: targetModel,
        baseHash,
      });
      applySetResult(state, targetModel, result, state.modelSwitcherFallbacks ?? []);
    }
    state.modelSwitcherStatus = `已切换为 ${targetModel}`;
    state.modelCenterStatus = `已切换为 ${targetModel}`;
    state.modelCenterError = null;
  } catch (err) {
    state.modelSwitcherCurrent = previousCurrent;
    state.modelSwitcherSelected = previousSelected;
    state.modelSwitcherStatus = null;
    state.modelSwitcherError = toErrorMessage(err);
  } finally {
    state.modelSwitcherSaving = false;
  }
}

export function resetModelCenterSelection(state: ModelSwitcherState) {
  state.modelCenterPrimary = state.modelSwitcherCurrent ?? "";
  state.modelCenterFallbacksText = (state.modelSwitcherFallbacks ?? []).join(", ");
  state.modelCenterError = null;
  state.modelCenterStatus = null;
}

export async function saveModelCenterSelection(state: ModelSwitcherState) {
  if (!state.client || !state.connected) {
    return;
  }

  const primary = (state.modelCenterPrimary ?? "").trim();
  if (!primary) {
    state.modelCenterError = "主模型不能为空。";
    return;
  }

  const fallbacks = parseFallbackList(state.modelCenterFallbacksText ?? "");

  state.modelCenterSaving = true;
  state.modelCenterError = null;
  state.modelCenterStatus = "保存中...";

  try {
    if (state.modelSwitcherCompatMode) {
      const defaults = await applyModelViaLegacyConfig(state, primary, fallbacks);
      applyModelDefaultsToState(state, defaults);
    } else {
      const baseHash = ensureHashForSet(state);
      const result = await state.client.request<ModelsDefaultSetResponse>("models.default.set", {
        primary,
        baseHash,
        fallbacks,
        allowUnknown: state.modelCenterAllowCustom === true,
      });
      applySetResult(state, primary, result, fallbacks);
    }

    state.modelSwitcherStatus = `已切换为 ${primary}`;
    state.modelSwitcherSelected = primary;
    state.modelCenterStatus = `保存成功：${primary}`;
    state.modelSwitcherError = null;
  } catch (err) {
    state.modelCenterStatus = null;
    state.modelCenterError = toErrorMessage(err);
  } finally {
    state.modelCenterSaving = false;
  }
}
