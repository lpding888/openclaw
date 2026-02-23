import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { buildAllowedModelSet } from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsDefaultGetParams,
  validateModelsDefaultSetParams,
  validateModelsListParams,
} from "../protocol/index.js";
import { resolveBaseHashParam } from "./base-hash.js";
import { assertValidParams } from "./validation.js";

type ConfigRoot = Record<string, unknown>;

function asObject(value: unknown): ConfigRoot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ConfigRoot;
}

function ensureObject(parent: ConfigRoot, key: string): ConfigRoot {
  const existing = asObject(parent[key]);
  if (existing) {
    return existing;
  }
  const next: ConfigRoot = {};
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

function parseDefaultsModel(config: unknown): { primary: string | null; fallbacks: string[] } {
  const root = asObject(config);
  const agents = asObject(root?.agents);
  const defaults = asObject(agents?.defaults);
  const modelRaw = defaults?.model;

  if (typeof modelRaw === "string") {
    const primary = trimNonEmpty(modelRaw);
    return { primary, fallbacks: [] };
  }

  const modelObj = asObject(modelRaw);
  if (!modelObj) {
    return { primary: null, fallbacks: [] };
  }

  const primary = trimNonEmpty(modelObj.primary);
  const fallbacksRaw = Array.isArray(modelObj.fallbacks) ? modelObj.fallbacks : [];
  const fallbacks = fallbacksRaw
    .map((entry) => trimNonEmpty(entry))
    .filter((entry): entry is string => Boolean(entry));
  return { primary, fallbacks };
}

function resolveBaseHashOrRespond(params: unknown, respond: RespondFn): string | null {
  const baseHash = resolveBaseHashParam(params);
  if (!baseHash) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash required; re-run models.default.get and retry",
      ),
    );
    return null;
  }
  return baseHash;
}

function assertBaseHashMatches(params: {
  baseHash: string;
  snapshot: Awaited<ReturnType<typeof readConfigFileSnapshot>>;
  respond: RespondFn;
}): boolean {
  const snapshotHash = resolveConfigSnapshotHash(params.snapshot);
  if (!snapshotHash) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config base hash unavailable; re-run models.default.get and retry",
      ),
    );
    return false;
  }
  if (params.baseHash !== snapshotHash) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        "config changed since last load; re-run models.default.get and retry",
      ),
    );
    return false;
  }
  return true;
}

export const modelsHandlers: GatewayRequestHandlers = {
  "models.default.get": async ({ params, respond }) => {
    if (!assertValidParams(params, validateModelsDefaultGetParams, "models.default.get", respond)) {
      return;
    }
    try {
      const snapshot = await readConfigFileSnapshot();
      const parsed = parseDefaultsModel(snapshot.config);
      const hash = resolveConfigSnapshotHash(snapshot);
      if (!hash) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "config base hash unavailable; re-run models.default.get and retry",
          ),
        );
        return;
      }
      respond(
        true,
        {
          primary: parsed.primary,
          fallbacks: parsed.fallbacks,
          configHash: hash,
          sourcePath: CONFIG_PATH,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.default.set": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateModelsDefaultSetParams, "models.default.set", respond)) {
      return;
    }

    const primary = trimNonEmpty((params as { primary?: unknown }).primary);
    if (!primary) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "primary model is required"),
      );
      return;
    }

    const baseHash = resolveBaseHashOrRespond(params, respond);
    if (!baseHash) {
      return;
    }

    const allowUnknown = (params as { allowUnknown?: unknown }).allowUnknown === true;
    const suppliedFallbacks = Array.isArray((params as { fallbacks?: unknown }).fallbacks)
      ? (params as { fallbacks: unknown[] }).fallbacks
          .map((entry) => trimNonEmpty(entry))
          .filter((entry): entry is string => Boolean(entry))
      : null;

    try {
      const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
      if (!assertBaseHashMatches({ baseHash, snapshot, respond })) {
        return;
      }

      const catalog = await context.loadGatewayModelCatalog();
      const knownModelIds = new Set(catalog.map((entry) => entry.id));
      if (!allowUnknown && !knownModelIds.has(primary)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown model id: ${primary}`),
        );
        return;
      }
      if (!allowUnknown && suppliedFallbacks) {
        const unknownFallback = suppliedFallbacks.find((entry) => !knownModelIds.has(entry));
        if (unknownFallback) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, `unknown fallback model id: ${unknownFallback}`),
          );
          return;
        }
      }

      const root = structuredClone(asObject(snapshot.config) ?? {});
      const agents = ensureObject(root, "agents");
      const defaults = ensureObject(agents, "defaults");

      const currentDefaults = parseDefaultsModel(snapshot.config);
      const nextFallbacks = suppliedFallbacks ?? currentDefaults.fallbacks;
      defaults.model = {
        primary,
        ...(nextFallbacks.length > 0 ? { fallbacks: nextFallbacks } : {}),
      };

      await writeConfigFile(root, writeOptions);
      const updatedSnapshot = await readConfigFileSnapshot();
      const configHash = resolveConfigSnapshotHash(updatedSnapshot) ?? baseHash;

      context.broadcast(
        "models.default.changed",
        {
          primary,
          fallbacks: nextFallbacks,
          updatedAt: Date.now(),
        },
        { dropIfSlow: true },
      );

      respond(
        true,
        {
          ok: true,
          primary,
          fallbacks: nextFallbacks,
          configHash,
          sourcePath: CONFIG_PATH,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const models = allowedCatalog.length > 0 ? allowedCatalog : catalog;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
