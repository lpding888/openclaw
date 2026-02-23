/**
 * OpenResponses HTTP Handler
 *
 * Implements the OpenResponses `/v1/responses` endpoint for OpenClaw Gateway.
 *
 * @see https://www.open-responses.com/
 */

import { randomUUID } from "node:crypto";
import { createDefaultDeps } from "../cli/deps.js";
import type { ImageContent } from "../commands/agent/types.js";
import type { GatewayHttpResponsesConfig } from "../config/types.gateway.js";
import { emitAgentEvent, onAgentEvent } from "../infra/agent-events.js";
import { logWarn } from "../logger.js";
import { resolveAssistantStreamDeltaText } from "./agent-event-assistant-text.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { sendJson, setSseHeaders, writeDone } from "./http-common.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import { resolveAgentIdForRequest } from "./http-utils.js";
import {
  CreateResponseBodySchema,
  type CreateResponseBody,
  type ResponseResource,
  type Usage,
} from "./open-responses.schema.js";
import {
  handleOpenResponsesNonStreaming,
  runResponsesAgentCommand,
} from "./openresponses-dispatch.js";
import {
  buildAgentPrompt,
  createAssistantOutputItem,
  createEmptyUsage,
  createResponseResource,
  extractUsageFromResult,
} from "./openresponses-mapper.js";
import {
  applyToolChoice,
  extractClientTools,
  extractInputArtifacts,
  resolveResponsesLimits,
} from "./openresponses-route.js";
import { resolveOpenResponsesSessionKey, writeSseEvent } from "./openresponses-utils.js";

export { buildAgentPrompt } from "./openresponses-mapper.js";

type OpenResponsesHttpOptions = {
  auth: ResolvedGatewayAuth;
  maxBodyBytes?: number;
  config?: GatewayHttpResponsesConfig;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  rateLimiter?: AuthRateLimiter;
};

export async function handleOpenResponsesHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OpenResponsesHttpOptions,
): Promise<boolean> {
  const limits = resolveResponsesLimits(opts.config);
  const maxBodyBytes =
    opts.maxBodyBytes ??
    (opts.config?.maxBodyBytes
      ? limits.maxBodyBytes
      : Math.max(limits.maxBodyBytes, limits.files.maxBytes * 2, limits.images.maxBytes * 2));
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/v1/responses",
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
    maxBodyBytes,
  });
  if (handled === false) {
    return false;
  }
  if (!handled) {
    return true;
  }

  // Validate request body with Zod
  const parseResult = CreateResponseBodySchema.safeParse(handled.body);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    const message = issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid request body";
    sendJson(res, 400, {
      error: { message, type: "invalid_request_error" },
    });
    return true;
  }

  const payload: CreateResponseBody = parseResult.data;
  const stream = Boolean(payload.stream);
  const model = payload.model;
  const user = payload.user;

  // Extract images + files from input (Phase 2)
  let images: ImageContent[] = [];
  let fileContexts: string[] = [];
  try {
    const artifacts = await extractInputArtifacts({ payload, limits });
    images = artifacts.images;
    fileContexts = artifacts.fileContexts;
  } catch (err) {
    logWarn(`openresponses: request parsing failed: ${String(err)}`);
    sendJson(res, 400, {
      error: { message: "invalid request", type: "invalid_request_error" },
    });
    return true;
  }

  const clientTools = extractClientTools(payload);
  let toolChoicePrompt: string | undefined;
  let resolvedClientTools = clientTools;
  try {
    const toolChoiceResult = applyToolChoice({
      tools: clientTools,
      toolChoice: payload.tool_choice,
    });
    resolvedClientTools = toolChoiceResult.tools;
    toolChoicePrompt = toolChoiceResult.extraSystemPrompt;
  } catch (err) {
    logWarn(`openresponses: tool configuration failed: ${String(err)}`);
    sendJson(res, 400, {
      error: { message: "invalid tool configuration", type: "invalid_request_error" },
    });
    return true;
  }
  const agentId = resolveAgentIdForRequest({ req, model });
  const sessionKey = resolveOpenResponsesSessionKey({ req, agentId, user });

  // Build prompt from input
  const prompt = buildAgentPrompt(payload.input);

  const fileContext = fileContexts.length > 0 ? fileContexts.join("\n\n") : undefined;
  const toolChoiceContext = toolChoicePrompt?.trim();

  // Handle instructions + file context as extra system prompt
  const extraSystemPrompt = [
    payload.instructions,
    prompt.extraSystemPrompt,
    toolChoiceContext,
    fileContext,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!prompt.message) {
    sendJson(res, 400, {
      error: {
        message: "Missing user message in `input`.",
        type: "invalid_request_error",
      },
    });
    return true;
  }

  const responseId = `resp_${randomUUID()}`;
  const outputItemId = `msg_${randomUUID()}`;
  const deps = createDefaultDeps();
  const streamParams =
    typeof payload.max_output_tokens === "number"
      ? { maxTokens: payload.max_output_tokens }
      : undefined;

  if (!stream) {
    await handleOpenResponsesNonStreaming({
      res,
      responseId,
      outputItemId,
      model,
      message: prompt.message,
      images,
      clientTools: resolvedClientTools,
      extraSystemPrompt,
      streamParams,
      sessionKey,
      deps,
    });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Streaming mode
  // ─────────────────────────────────────────────────────────────────────────

  setSseHeaders(res);

  let accumulatedText = "";
  let sawAssistantDelta = false;
  let closed = false;
  let unsubscribe = () => {};
  let finalUsage: Usage | undefined;
  let finalizeRequested: { status: ResponseResource["status"]; text: string } | null = null;

  const maybeFinalize = () => {
    if (closed) {
      return;
    }
    if (!finalizeRequested) {
      return;
    }
    if (!finalUsage) {
      return;
    }
    const usage = finalUsage;

    closed = true;
    unsubscribe();

    writeSseEvent(res, {
      type: "response.output_text.done",
      item_id: outputItemId,
      output_index: 0,
      content_index: 0,
      text: finalizeRequested.text,
    });

    writeSseEvent(res, {
      type: "response.content_part.done",
      item_id: outputItemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: finalizeRequested.text },
    });

    const completedItem = createAssistantOutputItem({
      id: outputItemId,
      text: finalizeRequested.text,
      status: "completed",
    });

    writeSseEvent(res, {
      type: "response.output_item.done",
      output_index: 0,
      item: completedItem,
    });

    const finalResponse = createResponseResource({
      id: responseId,
      model,
      status: finalizeRequested.status,
      output: [completedItem],
      usage,
    });

    writeSseEvent(res, { type: "response.completed", response: finalResponse });
    writeDone(res);
    res.end();
  };

  const requestFinalize = (status: ResponseResource["status"], text: string) => {
    if (finalizeRequested) {
      return;
    }
    finalizeRequested = { status, text };
    maybeFinalize();
  };

  // Send initial events
  const initialResponse = createResponseResource({
    id: responseId,
    model,
    status: "in_progress",
    output: [],
  });

  writeSseEvent(res, { type: "response.created", response: initialResponse });
  writeSseEvent(res, { type: "response.in_progress", response: initialResponse });

  // Add output item
  const outputItem = createAssistantOutputItem({
    id: outputItemId,
    text: "",
    status: "in_progress",
  });

  writeSseEvent(res, {
    type: "response.output_item.added",
    output_index: 0,
    item: outputItem,
  });

  // Add content part
  writeSseEvent(res, {
    type: "response.content_part.added",
    item_id: outputItemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "" },
  });

  unsubscribe = onAgentEvent((evt) => {
    if (evt.runId !== responseId) {
      return;
    }
    if (closed) {
      return;
    }

    if (evt.stream === "assistant") {
      const content = resolveAssistantStreamDeltaText(evt);
      if (!content) {
        return;
      }

      sawAssistantDelta = true;
      accumulatedText += content;

      writeSseEvent(res, {
        type: "response.output_text.delta",
        item_id: outputItemId,
        output_index: 0,
        content_index: 0,
        delta: content,
      });
      return;
    }

    if (evt.stream === "lifecycle") {
      const phase = evt.data?.phase;
      if (phase === "end" || phase === "error") {
        const finalText = accumulatedText || "No response from OpenClaw.";
        const finalStatus = phase === "error" ? "failed" : "completed";
        requestFinalize(finalStatus, finalText);
      }
    }
  });

  req.on("close", () => {
    closed = true;
    unsubscribe();
  });

  void (async () => {
    try {
      const result = await runResponsesAgentCommand({
        message: prompt.message,
        images,
        clientTools: resolvedClientTools,
        extraSystemPrompt,
        streamParams,
        sessionKey,
        runId: responseId,
        deps,
      });

      finalUsage = extractUsageFromResult(result);
      maybeFinalize();

      if (closed) {
        return;
      }

      // Fallback: if no streaming deltas were received, send the full response
      if (!sawAssistantDelta) {
        const resultAny = result as { payloads?: Array<{ text?: string }>; meta?: unknown };
        const payloads = resultAny.payloads;
        const meta = resultAny.meta;
        const stopReason =
          meta && typeof meta === "object"
            ? (meta as { stopReason?: string }).stopReason
            : undefined;
        const pendingToolCalls =
          meta && typeof meta === "object"
            ? (
                meta as {
                  pendingToolCalls?: Array<{ id: string; name: string; arguments: string }>;
                }
              ).pendingToolCalls
            : undefined;

        // If agent called a client tool, emit function_call instead of text
        if (stopReason === "tool_calls" && pendingToolCalls && pendingToolCalls.length > 0) {
          const functionCall = pendingToolCalls[0];
          const usage = finalUsage ?? createEmptyUsage();

          writeSseEvent(res, {
            type: "response.output_text.done",
            item_id: outputItemId,
            output_index: 0,
            content_index: 0,
            text: "",
          });
          writeSseEvent(res, {
            type: "response.content_part.done",
            item_id: outputItemId,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "" },
          });

          const completedItem = createAssistantOutputItem({
            id: outputItemId,
            text: "",
            status: "completed",
          });
          writeSseEvent(res, {
            type: "response.output_item.done",
            output_index: 0,
            item: completedItem,
          });

          const functionCallItemId = `call_${randomUUID()}`;
          const functionCallItem = {
            type: "function_call" as const,
            id: functionCallItemId,
            call_id: functionCall.id,
            name: functionCall.name,
            arguments: functionCall.arguments,
          };
          writeSseEvent(res, {
            type: "response.output_item.added",
            output_index: 1,
            item: functionCallItem,
          });
          writeSseEvent(res, {
            type: "response.output_item.done",
            output_index: 1,
            item: { ...functionCallItem, status: "completed" as const },
          });

          const incompleteResponse = createResponseResource({
            id: responseId,
            model,
            status: "incomplete",
            output: [completedItem, functionCallItem],
            usage,
          });
          closed = true;
          unsubscribe();
          writeSseEvent(res, { type: "response.completed", response: incompleteResponse });
          writeDone(res);
          res.end();
          return;
        }

        const content =
          Array.isArray(payloads) && payloads.length > 0
            ? payloads
                .map((p) => (typeof p.text === "string" ? p.text : ""))
                .filter(Boolean)
                .join("\n\n")
            : "No response from OpenClaw.";

        accumulatedText = content;
        sawAssistantDelta = true;

        writeSseEvent(res, {
          type: "response.output_text.delta",
          item_id: outputItemId,
          output_index: 0,
          content_index: 0,
          delta: content,
        });
      }
    } catch (err) {
      logWarn(`openresponses: streaming response failed: ${String(err)}`);
      if (closed) {
        return;
      }

      finalUsage = finalUsage ?? createEmptyUsage();
      const errorResponse = createResponseResource({
        id: responseId,
        model,
        status: "failed",
        output: [],
        error: { code: "api_error", message: "internal error" },
        usage: finalUsage,
      });

      writeSseEvent(res, { type: "response.failed", response: errorResponse });
      emitAgentEvent({
        runId: responseId,
        stream: "lifecycle",
        data: { phase: "error" },
      });
    } finally {
      if (!closed) {
        // Emit lifecycle end to trigger completion
        emitAgentEvent({
          runId: responseId,
          stream: "lifecycle",
          data: { phase: "end" },
        });
      }
    }
  })();

  return true;
}
