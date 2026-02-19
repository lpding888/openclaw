import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  ExecuteAttemptRunLoopArgs,
  ExecuteAttemptRunLoopResult,
} from "./attempt-run-loop.types.js";
import { MAX_IMAGE_BYTES } from "../../../media/constants.js";
import { isTimeoutError } from "../../failover-error.js";
import { subscribeEmbeddedPiSession } from "../../pi-embedded-subscribe.js";
import { isRunnerAbortError } from "../abort.js";
import { appendCacheTtlTimestamp, isCacheTtlEligibleProvider } from "../cache-ttl.js";
import { sanitizeAntigravityThinkingBlocks } from "../google.js";
import { log } from "../logger.js";
import {
  clearActiveEmbeddedRun,
  type EmbeddedPiQueueHandle,
  setActiveEmbeddedRun,
} from "../runs.js";
import { describeUnknownError } from "../utils.js";
import { injectHistoryImagesIntoMessages, summarizeSessionContext } from "./attempt-input.js";
import {
  selectCompactionTimeoutSnapshot,
  shouldFlagCompactionTimeout,
} from "./compaction-timeout.js";
import { detectAndLoadPromptImages } from "./images.js";

export async function executeAttemptRunLoop(
  args: ExecuteAttemptRunLoopArgs,
): Promise<ExecuteAttemptRunLoopResult> {
  const {
    params,
    activeSession,
    sessionManager,
    transcriptPolicy,
    runAbortController,
    hookRunner,
    hookAgentId,
    effectiveWorkspace,
    sandbox,
    systemPromptText,
    cacheTrace,
    anthropicPayloadLogger,
  } = args;

  let aborted = Boolean(params.abortSignal?.aborted);
  let timedOut = false;
  let timedOutDuringCompaction = false;
  const getAbortReason = (signal: AbortSignal): unknown =>
    "reason" in signal ? (signal as { reason?: unknown }).reason : undefined;
  const makeTimeoutAbortReason = (): Error => {
    const err = new Error("request timed out");
    err.name = "TimeoutError";
    return err;
  };
  const makeAbortError = (signal: AbortSignal): Error => {
    const reason = getAbortReason(signal);
    const err = reason ? new Error("aborted", { cause: reason }) : new Error("aborted");
    err.name = "AbortError";
    return err;
  };
  const abortRun = (isTimeout = false, reason?: unknown) => {
    aborted = true;
    if (isTimeout) {
      timedOut = true;
    }
    if (isTimeout) {
      runAbortController.abort(reason ?? makeTimeoutAbortReason());
    } else {
      runAbortController.abort(reason);
    }
    void activeSession.abort();
  };
  const abortable = <T>(promise: Promise<T>): Promise<T> => {
    const signal = runAbortController.signal;
    if (signal.aborted) {
      return Promise.reject(makeAbortError(signal));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(makeAbortError(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (err) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
  };

  const subscription = subscribeEmbeddedPiSession({
    session: activeSession,
    runId: params.runId,
    hookRunner: hookRunner ?? undefined,
    verboseLevel: params.verboseLevel,
    reasoningMode: params.reasoningLevel ?? "off",
    toolResultFormat: params.toolResultFormat,
    shouldEmitToolResult: params.shouldEmitToolResult,
    shouldEmitToolOutput: params.shouldEmitToolOutput,
    onToolResult: params.onToolResult,
    onReasoningStream: params.onReasoningStream,
    onBlockReply: params.onBlockReply,
    onBlockReplyFlush: params.onBlockReplyFlush,
    blockReplyBreak: params.blockReplyBreak,
    blockReplyChunking: params.blockReplyChunking,
    onPartialReply: params.onPartialReply,
    onAssistantMessageStart: params.onAssistantMessageStart,
    onAgentEvent: params.onAgentEvent,
    enforceFinalTag: params.enforceFinalTag,
    config: params.config,
    sessionKey: params.sessionKey ?? params.sessionId,
  });

  const {
    assistantTexts,
    toolMetas,
    unsubscribe,
    waitForCompactionRetry,
    getMessagingToolSentTexts,
    getMessagingToolSentTargets,
    didSendViaMessagingTool,
    getLastToolError,
    getUsageTotals,
    getCompactionCount,
  } = subscription;

  const queueHandle: EmbeddedPiQueueHandle = {
    queueMessage: async (text: string) => {
      await activeSession.steer(text);
    },
    isStreaming: () => activeSession.isStreaming,
    isCompacting: () => subscription.isCompacting(),
    abort: abortRun,
  };
  setActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);

  let abortWarnTimer: NodeJS.Timeout | undefined;
  const isProbeSession = params.sessionId?.startsWith("probe-") ?? false;
  const abortTimer = setTimeout(
    () => {
      if (!isProbeSession) {
        log.warn(
          `embedded run timeout: runId=${params.runId} sessionId=${params.sessionId} timeoutMs=${params.timeoutMs}`,
        );
      }
      if (
        shouldFlagCompactionTimeout({
          isTimeout: true,
          isCompactionPendingOrRetrying: subscription.isCompacting(),
          isCompactionInFlight: activeSession.isCompacting,
        })
      ) {
        timedOutDuringCompaction = true;
      }
      abortRun(true);
      if (!abortWarnTimer) {
        abortWarnTimer = setTimeout(() => {
          if (!activeSession.isStreaming) {
            return;
          }
          if (!isProbeSession) {
            log.warn(
              `embedded run abort still streaming: runId=${params.runId} sessionId=${params.sessionId}`,
            );
          }
        }, 10_000);
      }
    },
    Math.max(1, params.timeoutMs),
  );

  let messagesSnapshot: AgentMessage[] = [];
  let sessionIdUsed = activeSession.sessionId;
  const onAbort = () => {
    const reason = params.abortSignal ? getAbortReason(params.abortSignal) : undefined;
    const timeout = reason ? isTimeoutError(reason) : false;
    if (
      shouldFlagCompactionTimeout({
        isTimeout: timeout,
        isCompactionPendingOrRetrying: subscription.isCompacting(),
        isCompactionInFlight: activeSession.isCompacting,
      })
    ) {
      timedOutDuringCompaction = true;
    }
    abortRun(timeout, reason);
  };
  if (params.abortSignal) {
    if (params.abortSignal.aborted) {
      onAbort();
    } else {
      params.abortSignal.addEventListener("abort", onAbort, {
        once: true,
      });
    }
  }

  let promptError: unknown = null;
  const hookContext = {
    agentId: hookAgentId,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    workspaceDir: params.workspaceDir,
    messageProvider: params.messageProvider ?? undefined,
  };
  try {
    const promptStartedAt = Date.now();

    // Run before_agent_start hooks to allow plugins to inject context
    let effectivePrompt = params.prompt;
    if (hookRunner?.hasHooks("before_agent_start")) {
      try {
        const hookResult = await hookRunner.runBeforeAgentStart(
          {
            prompt: params.prompt,
            messages: activeSession.messages,
          },
          hookContext,
        );
        if (hookResult?.prependContext) {
          effectivePrompt = `${hookResult.prependContext}\n\n${params.prompt}`;
          log.debug(
            `hooks: prepended context to prompt (${hookResult.prependContext.length} chars)`,
          );
        }
      } catch (hookErr) {
        log.warn(`before_agent_start hook failed: ${String(hookErr)}`);
      }
    }

    log.debug(`embedded run prompt start: runId=${params.runId} sessionId=${params.sessionId}`);
    cacheTrace?.recordStage("prompt:before", {
      prompt: effectivePrompt,
      messages: activeSession.messages,
    });

    // Repair orphaned trailing user messages so new prompts don't violate role ordering.
    const leafEntry = sessionManager.getLeafEntry();
    if (leafEntry?.type === "message" && leafEntry.message.role === "user") {
      if (leafEntry.parentId) {
        sessionManager.branch(leafEntry.parentId);
      } else {
        sessionManager.resetLeaf();
      }
      const sessionContext = sessionManager.buildSessionContext();
      const sanitizedOrphan = transcriptPolicy.normalizeAntigravityThinkingBlocks
        ? sanitizeAntigravityThinkingBlocks(sessionContext.messages)
        : sessionContext.messages;
      activeSession.agent.replaceMessages(sanitizedOrphan);
      log.warn(
        `Removed orphaned user message to prevent consecutive user turns. ` +
          `runId=${params.runId} sessionId=${params.sessionId}`,
      );
    }

    try {
      const imageResult = await detectAndLoadPromptImages({
        prompt: effectivePrompt,
        workspaceDir: effectiveWorkspace,
        model: params.model,
        existingImages: params.images,
        historyMessages: activeSession.messages,
        maxBytes: MAX_IMAGE_BYTES,
        sandbox:
          sandbox?.enabled && sandbox?.fsBridge
            ? { root: sandbox.workspaceDir, bridge: sandbox.fsBridge }
            : undefined,
      });

      const didMutate = injectHistoryImagesIntoMessages(
        activeSession.messages,
        imageResult.historyImagesByIndex,
      );
      if (didMutate) {
        activeSession.agent.replaceMessages(activeSession.messages);
      }

      cacheTrace?.recordStage("prompt:images", {
        prompt: effectivePrompt,
        messages: activeSession.messages,
        note: `images: prompt=${imageResult.images.length} history=${imageResult.historyImagesByIndex.size}`,
      });

      if (log.isEnabled("debug")) {
        const msgCount = activeSession.messages.length;
        const systemLen = systemPromptText?.length ?? 0;
        const promptLen = effectivePrompt.length;
        const sessionSummary = summarizeSessionContext(activeSession.messages);
        log.debug(
          `[context-diag] pre-prompt: sessionKey=${params.sessionKey ?? params.sessionId} ` +
            `messages=${msgCount} roleCounts=${sessionSummary.roleCounts} ` +
            `historyTextChars=${sessionSummary.totalTextChars} ` +
            `maxMessageTextChars=${sessionSummary.maxMessageTextChars} ` +
            `historyImageBlocks=${sessionSummary.totalImageBlocks} ` +
            `systemPromptChars=${systemLen} promptChars=${promptLen} ` +
            `promptImages=${imageResult.images.length} ` +
            `historyImageMessages=${imageResult.historyImagesByIndex.size} ` +
            `provider=${params.provider}/${params.modelId} sessionFile=${params.sessionFile}`,
        );
      }

      if (hookRunner?.hasHooks("llm_input")) {
        hookRunner
          .runLlmInput(
            {
              runId: params.runId,
              sessionId: params.sessionId,
              provider: params.provider,
              model: params.modelId,
              systemPrompt: systemPromptText,
              prompt: effectivePrompt,
              historyMessages: activeSession.messages,
              imagesCount: imageResult.images.length,
            },
            hookContext,
          )
          .catch((err) => {
            log.warn(`llm_input hook failed: ${String(err)}`);
          });
      }

      if (imageResult.images.length > 0) {
        await abortable(activeSession.prompt(effectivePrompt, { images: imageResult.images }));
      } else {
        await abortable(activeSession.prompt(effectivePrompt));
      }
    } catch (err) {
      promptError = err;
    } finally {
      log.debug(
        `embedded run prompt end: runId=${params.runId} sessionId=${params.sessionId} durationMs=${Date.now() - promptStartedAt}`,
      );
    }

    const wasCompactingBefore = activeSession.isCompacting;
    const snapshot = activeSession.messages.slice();
    const wasCompactingAfter = activeSession.isCompacting;
    const preCompactionSnapshot = wasCompactingBefore || wasCompactingAfter ? null : snapshot;
    const preCompactionSessionId = activeSession.sessionId;

    try {
      await abortable(waitForCompactionRetry());
    } catch (err) {
      if (isRunnerAbortError(err)) {
        if (!promptError) {
          promptError = err;
        }
        if (!isProbeSession) {
          log.debug(`compaction wait aborted: runId=${params.runId} sessionId=${params.sessionId}`);
        }
      } else {
        throw err;
      }
    }

    if (!timedOutDuringCompaction) {
      const shouldTrackCacheTtl =
        params.config?.agents?.defaults?.contextPruning?.mode === "cache-ttl" &&
        isCacheTtlEligibleProvider(params.provider, params.modelId);
      if (shouldTrackCacheTtl) {
        appendCacheTtlTimestamp(sessionManager, {
          timestamp: Date.now(),
          provider: params.provider,
          modelId: params.modelId,
        });
      }
    }

    const snapshotSelection = selectCompactionTimeoutSnapshot({
      timedOutDuringCompaction,
      preCompactionSnapshot,
      preCompactionSessionId,
      currentSnapshot: activeSession.messages.slice(),
      currentSessionId: activeSession.sessionId,
    });
    if (timedOutDuringCompaction) {
      if (!isProbeSession) {
        log.warn(
          `using ${snapshotSelection.source} snapshot: timed out during compaction runId=${params.runId} sessionId=${params.sessionId}`,
        );
      }
    }
    messagesSnapshot = snapshotSelection.messagesSnapshot;
    sessionIdUsed = snapshotSelection.sessionIdUsed;
    cacheTrace?.recordStage("session:after", {
      messages: messagesSnapshot,
      note: timedOutDuringCompaction
        ? "compaction timeout"
        : promptError
          ? "prompt error"
          : undefined,
    });
    anthropicPayloadLogger?.recordUsage(messagesSnapshot, promptError);

    if (hookRunner?.hasHooks("agent_end")) {
      hookRunner
        .runAgentEnd(
          {
            messages: messagesSnapshot,
            success: !aborted && !promptError,
            error: promptError ? describeUnknownError(promptError) : undefined,
            durationMs: Date.now() - promptStartedAt,
          },
          hookContext,
        )
        .catch((err) => {
          log.warn(`agent_end hook failed: ${err}`);
        });
    }
  } finally {
    clearTimeout(abortTimer);
    if (abortWarnTimer) {
      clearTimeout(abortWarnTimer);
    }
    if (!isProbeSession && (aborted || timedOut) && !timedOutDuringCompaction) {
      log.debug(
        `run cleanup: runId=${params.runId} sessionId=${params.sessionId} aborted=${aborted} timedOut=${timedOut}`,
      );
    }
    try {
      unsubscribe();
    } catch (err) {
      log.error(
        `CRITICAL: unsubscribe failed, possible resource leak: runId=${params.runId} ${String(err)}`,
      );
    }
    clearActiveEmbeddedRun(params.sessionId, queueHandle, params.sessionKey);
    params.abortSignal?.removeEventListener?.("abort", onAbort);
  }

  const lastAssistant = messagesSnapshot
    .slice()
    .toReversed()
    .find((m) => m.role === "assistant");

  const toolMetasNormalized = toolMetas
    .filter(
      (entry): entry is { toolName: string; meta?: string } =>
        typeof entry.toolName === "string" && entry.toolName.trim().length > 0,
    )
    .map((entry) => ({ toolName: entry.toolName, meta: entry.meta }));

  if (hookRunner?.hasHooks("llm_output")) {
    hookRunner
      .runLlmOutput(
        {
          runId: params.runId,
          sessionId: params.sessionId,
          provider: params.provider,
          model: params.modelId,
          assistantTexts,
          lastAssistant,
          usage: getUsageTotals(),
        },
        hookContext,
      )
      .catch((err) => {
        log.warn(`llm_output hook failed: ${String(err)}`);
      });
  }

  return {
    aborted,
    timedOut,
    timedOutDuringCompaction,
    promptError,
    sessionIdUsed,
    messagesSnapshot,
    assistantTexts,
    toolMetas: toolMetasNormalized,
    lastAssistant,
    lastToolError: getLastToolError?.(),
    didSendViaMessagingTool: didSendViaMessagingTool(),
    messagingToolSentTexts: getMessagingToolSentTexts(),
    messagingToolSentTargets: getMessagingToolSentTargets(),
    attemptUsage: getUsageTotals(),
    compactionCount: getCompactionCount(),
  };
}
