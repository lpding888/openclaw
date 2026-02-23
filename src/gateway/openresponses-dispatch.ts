import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { ClientToolDefinition } from "../agents/pi-embedded-runner/run/params.js";
import { createDefaultDeps } from "../cli/deps.js";
import { agentCommand } from "../commands/agent.js";
import type { ImageContent } from "../commands/agent/types.js";
import { logWarn } from "../logger.js";
import { defaultRuntime } from "../runtime.js";
import { sendJson } from "./http-common.js";
import {
  createAssistantOutputItem,
  createResponseResource,
  extractUsageFromResult,
} from "./openresponses-mapper.js";

export async function runResponsesAgentCommand(params: {
  message: string;
  images: ImageContent[];
  clientTools: ClientToolDefinition[];
  extraSystemPrompt: string;
  streamParams: { maxTokens: number } | undefined;
  sessionKey: string;
  runId: string;
  deps: ReturnType<typeof createDefaultDeps>;
}) {
  return agentCommand(
    {
      message: params.message,
      images: params.images.length > 0 ? params.images : undefined,
      clientTools: params.clientTools.length > 0 ? params.clientTools : undefined,
      extraSystemPrompt: params.extraSystemPrompt || undefined,
      streamParams: params.streamParams ?? undefined,
      sessionKey: params.sessionKey,
      runId: params.runId,
      deliver: false,
      messageChannel: "webchat",
      bestEffortDeliver: false,
    },
    defaultRuntime,
    params.deps,
  );
}

export async function handleOpenResponsesNonStreaming(params: {
  res: ServerResponse;
  responseId: string;
  outputItemId: string;
  model: string;
  message: string;
  images: ImageContent[];
  clientTools: ClientToolDefinition[];
  extraSystemPrompt: string;
  streamParams: { maxTokens: number } | undefined;
  sessionKey: string;
  deps: ReturnType<typeof createDefaultDeps>;
}): Promise<void> {
  try {
    const result = await runResponsesAgentCommand({
      message: params.message,
      images: params.images,
      clientTools: params.clientTools,
      extraSystemPrompt: params.extraSystemPrompt,
      streamParams: params.streamParams,
      sessionKey: params.sessionKey,
      runId: params.responseId,
      deps: params.deps,
    });

    const payloads = (result as { payloads?: Array<{ text?: string }> } | null)?.payloads;
    const usage = extractUsageFromResult(result);
    const meta = (result as { meta?: unknown } | null)?.meta;
    const stopReason =
      meta && typeof meta === "object" ? (meta as { stopReason?: string }).stopReason : undefined;
    const pendingToolCalls =
      meta && typeof meta === "object"
        ? (meta as { pendingToolCalls?: Array<{ id: string; name: string; arguments: string }> })
            .pendingToolCalls
        : undefined;

    if (stopReason === "tool_calls" && pendingToolCalls && pendingToolCalls.length > 0) {
      const functionCall = pendingToolCalls[0];
      const functionCallItemId = `call_${randomUUID()}`;
      const response = createResponseResource({
        id: params.responseId,
        model: params.model,
        status: "incomplete",
        output: [
          {
            type: "function_call",
            id: functionCallItemId,
            call_id: functionCall.id,
            name: functionCall.name,
            arguments: functionCall.arguments,
          },
        ],
        usage,
      });
      sendJson(params.res, 200, response);
      return;
    }

    const content =
      Array.isArray(payloads) && payloads.length > 0
        ? payloads
            .map((p) => (typeof p.text === "string" ? p.text : ""))
            .filter(Boolean)
            .join("\n\n")
        : "No response from OpenClaw.";

    const response = createResponseResource({
      id: params.responseId,
      model: params.model,
      status: "completed",
      output: [
        createAssistantOutputItem({
          id: params.outputItemId,
          text: content,
          status: "completed",
        }),
      ],
      usage,
    });

    sendJson(params.res, 200, response);
  } catch (err) {
    logWarn(`openresponses: non-stream response failed: ${String(err)}`);
    const response = createResponseResource({
      id: params.responseId,
      model: params.model,
      status: "failed",
      output: [],
      error: { code: "api_error", message: "internal error" },
    });
    sendJson(params.res, 500, response);
  }
}
