import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import {
  connectOk,
  installGatewayTestHooks,
  onceMessage,
  piSdkMock,
  rpcReq,
  startServerWithClient,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: WebSocket;
let port = 0;

beforeAll(async () => {
  const started = await startServerWithClient(undefined, { controlUiEnabled: true });
  server = started.server;
  ws = started.ws;
  port = started.port;
  await connectOk(ws);
});

afterAll(async () => {
  ws.close();
  await server.close();
});

describe("gateway models.default", () => {
  test("models.default.get returns current defaults", async () => {
    piSdkMock.enabled = true;
    piSdkMock.models = [{ id: "openai/gpt-test-a", name: "GPT Test A", provider: "openai" }];

    const res = await rpcReq<{
      primary: string | null;
      fallbacks: string[];
      configHash: string;
      sourcePath: string;
    }>(ws, "models.default.get", {});

    expect(res.ok).toBe(true);
    expect(typeof res.payload?.configHash).toBe("string");
    expect(Array.isArray(res.payload?.fallbacks)).toBe(true);
    expect(typeof res.payload?.sourcePath).toBe("string");
  });

  test("models.default.set updates primary + fallbacks and emits event", async () => {
    piSdkMock.enabled = true;
    piSdkMock.models = [
      { id: "anthropic/claude-test-main", name: "Claude Test", provider: "anthropic" },
      { id: "openai/gpt-test-fallback", name: "GPT Fallback", provider: "openai" },
    ];

    const before = await rpcReq<{
      configHash: string;
    }>(ws, "models.default.get", {});
    expect(before.ok).toBe(true);

    const eventP = onceMessage<{ type: "event"; event: string; payload?: unknown }>(
      ws,
      (o) => o.type === "event" && o.event === "models.default.changed",
    );

    const setRes = await rpcReq<{
      ok: true;
      primary: string;
      fallbacks: string[];
      configHash: string;
    }>(ws, "models.default.set", {
      primary: "anthropic/claude-test-main",
      fallbacks: ["openai/gpt-test-fallback"],
      baseHash: before.payload?.configHash,
    });

    expect(setRes.ok).toBe(true);
    expect(setRes.payload?.primary).toBe("anthropic/claude-test-main");
    expect(setRes.payload?.fallbacks).toEqual(["openai/gpt-test-fallback"]);

    const changed = await eventP;
    expect(changed.event).toBe("models.default.changed");
    expect((changed.payload as { primary?: string } | undefined)?.primary).toBe(
      "anthropic/claude-test-main",
    );

    const after = await rpcReq<{
      primary: string | null;
      fallbacks: string[];
      configHash: string;
    }>(ws, "models.default.get", {});
    expect(after.ok).toBe(true);
    expect(after.payload?.primary).toBe("anthropic/claude-test-main");
    expect(after.payload?.fallbacks).toEqual(["openai/gpt-test-fallback"]);
    expect(after.payload?.configHash).not.toBe(before.payload?.configHash);
  });

  test("models.default.set rejects unknown model in strict mode", async () => {
    piSdkMock.enabled = true;
    piSdkMock.models = [{ id: "openai/gpt-known", name: "Known", provider: "openai" }];

    const before = await rpcReq<{ configHash: string }>(ws, "models.default.get", {});
    expect(before.ok).toBe(true);

    const res = await rpcReq(ws, "models.default.set", {
      primary: "custom/provider-model",
      baseHash: before.payload?.configHash,
    });

    expect(res.ok).toBe(false);
    expect(res.error?.message ?? "").toContain("unknown model id");
  });

  test("models.default.set accepts unknown model when allowUnknown=true", async () => {
    piSdkMock.enabled = true;
    piSdkMock.models = [{ id: "openai/gpt-known", name: "Known", provider: "openai" }];

    const before = await rpcReq<{ configHash: string }>(ws, "models.default.get", {});
    expect(before.ok).toBe(true);

    const res = await rpcReq<{ ok: true; primary: string; fallbacks: string[] }>(
      ws,
      "models.default.set",
      {
        primary: "custom/provider-model",
        baseHash: before.payload?.configHash,
        allowUnknown: true,
      },
    );

    expect(res.ok).toBe(true);
    expect(res.payload?.primary).toBe("custom/provider-model");
  });

  test("models.default.set enforces baseHash", async () => {
    piSdkMock.enabled = true;
    piSdkMock.models = [{ id: "openai/gpt-known", name: "Known", provider: "openai" }];

    const res = await rpcReq(ws, "models.default.set", {
      primary: "openai/gpt-known",
      baseHash: "stale-hash",
    });

    expect(res.ok).toBe(false);
    expect(res.error?.message ?? "").toContain("config changed since last load");
  });

  test("models.default.set does not trigger restart path", async () => {
    piSdkMock.enabled = true;
    piSdkMock.models = [{ id: "openai/gpt-known", name: "Known", provider: "openai" }];

    const before = await rpcReq<{ configHash: string }>(ws, "models.default.get", {});
    expect(before.ok).toBe(true);

    const setRes = await rpcReq(ws, "models.default.set", {
      primary: "openai/gpt-known",
      baseHash: before.payload?.configHash,
      allowUnknown: true,
    });
    expect(setRes.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 800));

    const health = await rpcReq(ws, "health", {});
    expect(health.ok).toBe(true);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  test("scope: operator.read can get but cannot set", async () => {
    const readWs = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => readWs.once("open", resolve));
    await connectOk(readWs, { scopes: ["operator.read"] });

    const getRes = await rpcReq(readWs, "models.default.get", {});
    expect(getRes.ok).toBe(true);

    const setRes = await rpcReq(readWs, "models.default.set", {
      primary: "openai/gpt-read-only",
      baseHash: "hash",
      allowUnknown: true,
    });
    expect(setRes.ok).toBe(false);
    expect(setRes.error?.message ?? "").toContain("missing scope: operator.admin");

    readWs.close();
  });
});
