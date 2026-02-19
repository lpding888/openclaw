import type { createAgentSession } from "@mariozechner/pi-coding-agent";
import type { getGlobalHookRunner } from "../../../plugins/hook-runner-global.js";
import type { createAnthropicPayloadLogger } from "../../anthropic-payload-log.js";
import type { createCacheTrace } from "../../cache-trace.js";
import type { resolveSandboxContext } from "../../sandbox.js";
import type { guardSessionManager } from "../../session-tool-result-guard-wrapper.js";
import type { resolveTranscriptPolicy } from "../../transcript-policy.js";
import type { EmbeddedRunAttemptParams, EmbeddedRunAttemptResult } from "./types.js";

export type ActiveSession = NonNullable<Awaited<ReturnType<typeof createAgentSession>>["session"]>;
export type GuardedSessionManager = ReturnType<typeof guardSessionManager>;
export type TranscriptPolicy = ReturnType<typeof resolveTranscriptPolicy>;
export type SandboxContext = Awaited<ReturnType<typeof resolveSandboxContext>>;
export type CacheTrace = ReturnType<typeof createCacheTrace>;
export type AnthropicPayloadLogger = ReturnType<typeof createAnthropicPayloadLogger>;
export type HookRunner = ReturnType<typeof getGlobalHookRunner>;

export type ExecuteAttemptRunLoopArgs = {
  params: EmbeddedRunAttemptParams;
  activeSession: ActiveSession;
  sessionManager: GuardedSessionManager;
  transcriptPolicy: TranscriptPolicy;
  runAbortController: AbortController;
  hookRunner: HookRunner;
  hookAgentId: string;
  effectiveWorkspace: string;
  sandbox: SandboxContext;
  systemPromptText: string;
  cacheTrace: CacheTrace;
  anthropicPayloadLogger: AnthropicPayloadLogger;
};

export type ExecuteAttemptRunLoopResult = Pick<
  EmbeddedRunAttemptResult,
  | "aborted"
  | "timedOut"
  | "timedOutDuringCompaction"
  | "promptError"
  | "sessionIdUsed"
  | "messagesSnapshot"
  | "assistantTexts"
  | "toolMetas"
  | "lastAssistant"
  | "lastToolError"
  | "didSendViaMessagingTool"
  | "messagingToolSentTexts"
  | "messagingToolSentTargets"
  | "attemptUsage"
  | "compactionCount"
>;
