import { describe, expect, it, vi } from "vitest";
import {
  applyModelSwitcherSelection,
  loadModelSwitcher,
  resetModelCenterSelection,
  saveModelCenterSelection,
} from "./model-switcher.ts";

type RequestMock = ReturnType<typeof vi.fn>;
type ModelSwitcherState = Parameters<typeof applyModelSwitcherSelection>[0];

function createState(request?: RequestMock): ModelSwitcherState {
  return {
    client: request
      ? ({ request } as unknown as ModelSwitcherState["client"])
      : (null as ModelSwitcherState["client"]),
    connected: true,
    hello: {
      features: {
        methods: ["models.list", "models.default.get", "models.default.set"],
      },
    } as ModelSwitcherState["hello"],
    applySessionKey: "main",
    modelSwitcherLoading: false,
    modelSwitcherSaving: false,
    modelSwitcherCurrent: "openai/gpt-old",
    modelSwitcherSelected: "openai/gpt-old",
    modelSwitcherOptions: [
      {
        id: "openai/gpt-old",
        name: "Old",
        provider: "openai",
        label: "Old (openai/gpt-old)",
      },
      {
        id: "openai/gpt-new",
        name: "New",
        provider: "openai",
        label: "New (openai/gpt-new)",
      },
    ],
    modelSwitcherError: null,
    modelSwitcherStatus: null,
    modelSwitcherCompatMode: false,
    modelSwitcherConfigHash: "hash-old",
    modelSwitcherFallbacks: ["openai/gpt-fallback"],
    modelCenterPrimary: "openai/gpt-old",
    modelCenterFallbacksText: "openai/gpt-fallback",
    modelCenterAllowCustom: false,
    modelCenterSaving: false,
    modelCenterError: null,
    modelCenterStatus: null,
    modelCenterQuery: "",
  };
}

describe("model switcher quick mode", () => {
  it("applies selected model immediately via models.default.set", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.default.set") {
        return {
          ok: true,
          primary: "openai/gpt-new",
          fallbacks: ["openai/gpt-fallback"],
          configHash: "hash-new",
          sourcePath: "/tmp/config.json",
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);

    await applyModelSwitcherSelection(state, "openai/gpt-new");

    expect(request).toHaveBeenCalledWith("models.default.set", {
      primary: "openai/gpt-new",
      baseHash: "hash-old",
    });
    expect(state.modelSwitcherCurrent).toBe("openai/gpt-new");
    expect(state.modelSwitcherSelected).toBe("openai/gpt-new");
    expect(state.modelSwitcherConfigHash).toBe("hash-new");
    expect(state.modelSwitcherError).toBeNull();
  });

  it("rolls back optimistic state when save fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("save failed");
    });
    const state = createState(request);

    await applyModelSwitcherSelection(state, "openai/gpt-new");

    expect(state.modelSwitcherCurrent).toBe("openai/gpt-old");
    expect(state.modelSwitcherSelected).toBe("openai/gpt-old");
    expect(state.modelSwitcherError).toContain("save failed");
  });

  it("uses legacy config.apply in compatibility mode", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "config.get") {
        return {
          hash: "legacy-hash",
          path: "/tmp/openclaw.json",
          config: {
            agents: {
              defaults: {
                model: {
                  primary: "openai/gpt-old",
                  fallbacks: ["openai/gpt-fallback"],
                },
              },
            },
          },
        };
      }
      if (method === "config.apply") {
        return { ok: true, params };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    state.modelSwitcherCompatMode = true;

    await applyModelSwitcherSelection(state, "openai/gpt-new");

    expect(request).toHaveBeenCalledWith(
      "config.apply",
      expect.objectContaining({
        baseHash: "legacy-hash",
        sessionKey: "main",
      }),
    );
    expect(state.modelSwitcherCurrent).toBe("openai/gpt-new");
  });

  it("does nothing when disconnected", async () => {
    const request = vi.fn();
    const state = createState(request);
    state.connected = false;

    await applyModelSwitcherSelection(state, "openai/gpt-new");

    expect(request).not.toHaveBeenCalled();
  });
});

describe("model switcher load and model center", () => {
  it("loads defaults and marks compatibility mode on old gateway", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") {
        return {
          models: [
            { id: "openai/gpt-old", name: "Old", provider: "openai" },
            { id: "openai/gpt-new", name: "New", provider: "openai" },
          ],
        };
      }
      if (method === "config.get") {
        return {
          hash: "legacy-hash",
          config: {
            agents: {
              defaults: {
                model: {
                  primary: "openai/gpt-old",
                  fallbacks: ["openai/gpt-fallback"],
                },
              },
            },
          },
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);
    state.hello = { features: { methods: ["models.list"] } } as ModelSwitcherState["hello"];

    await loadModelSwitcher(state);

    expect(state.modelSwitcherCompatMode).toBe(true);
    expect(state.modelSwitcherCurrent).toBe("openai/gpt-old");
    expect(state.modelSwitcherFallbacks).toEqual(["openai/gpt-fallback"]);
    expect(state.modelCenterPrimary).toBe("openai/gpt-old");
  });

  it("saves model center with custom model when allowCustom=true", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "models.default.set") {
        return {
          ok: true,
          primary: params?.primary,
          fallbacks: params?.fallbacks ?? [],
          configHash: "hash-model-center",
          sourcePath: "/tmp/openclaw.json",
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const state = createState(request);
    state.modelCenterPrimary = "custom/provider-model";
    state.modelCenterFallbacksText = "openai/gpt-fallback, openai/gpt-fallback-2";
    state.modelCenterAllowCustom = true;

    await saveModelCenterSelection(state);

    expect(request).toHaveBeenCalledWith("models.default.set", {
      primary: "custom/provider-model",
      baseHash: "hash-old",
      fallbacks: ["openai/gpt-fallback", "openai/gpt-fallback-2"],
      allowUnknown: true,
    });
    expect(state.modelCenterError).toBeNull();
    expect(state.modelSwitcherCurrent).toBe("custom/provider-model");
  });

  it("resetModelCenterSelection restores current defaults", () => {
    const state = createState();
    state.modelSwitcherCurrent = "openai/gpt-current";
    state.modelSwitcherFallbacks = ["openai/gpt-fallback-a", "openai/gpt-fallback-b"];
    state.modelCenterPrimary = "custom/other";
    state.modelCenterFallbacksText = "x,y";
    state.modelCenterError = "error";

    resetModelCenterSelection(state);

    expect(state.modelCenterPrimary).toBe("openai/gpt-current");
    expect(state.modelCenterFallbacksText).toBe("openai/gpt-fallback-a, openai/gpt-fallback-b");
    expect(state.modelCenterError).toBeNull();
  });
});
