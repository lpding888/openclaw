import os from "node:os";
import type { EmbeddedRunAttemptParams } from "./types.js";
import { resolveHeartbeatPrompt } from "../../../auto-reply/heartbeat.js";
import { resolveChannelCapabilities } from "../../../config/channel-capabilities.js";
import { getMachineDisplayName } from "../../../infra/machine-name.js";
import { isCronSessionKey, isSubagentSessionKey } from "../../../routing/session-key.js";
import { resolveSignalReactionLevel } from "../../../signal/reaction-level.js";
import { resolveTelegramInlineButtonsScope } from "../../../telegram/inline-buttons.js";
import { resolveTelegramReactionLevel } from "../../../telegram/reaction-level.js";
import { buildTtsSystemPromptHint } from "../../../tts/tts.js";
import { normalizeMessageChannel } from "../../../utils/message-channel.js";
import { isReasoningTagProvider } from "../../../utils/provider-utils.js";
import { resolveSessionAgentIds } from "../../agent-scope.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolHints,
} from "../../channel-tools.js";
import { resolveOpenClawDocsPath } from "../../docs-path.js";
import { resolveDefaultModelForAgent } from "../../model-selection.js";
import { resolveBootstrapMaxChars } from "../../pi-embedded-helpers.js";
import { resolveSandboxRuntimeStatus } from "../../sandbox/runtime-status.js";
import { detectRuntimeShell } from "../../shell-utils.js";
import { buildSystemPromptParams } from "../../system-prompt-params.js";
import { buildSystemPromptReport } from "../../system-prompt-report.js";
import { buildModelAliasLines } from "../model.js";
import { buildEmbeddedSandboxInfo } from "../sandbox-info.js";
import { createSystemPromptOverride, buildEmbeddedSystemPrompt } from "../system-prompt.js";

type BuildAttemptSystemPromptContextArgs = {
  params: EmbeddedRunAttemptParams;
  effectiveWorkspace: string;
  sandbox: Awaited<ReturnType<typeof import("../../sandbox.js").resolveSandboxContext>>;
  tools: Parameters<typeof buildEmbeddedSystemPrompt>[0]["tools"];
  contextFiles: Awaited<
    ReturnType<typeof import("../../bootstrap-files.js").resolveBootstrapContextForRun>
  >["contextFiles"];
  hookAdjustedBootstrapFiles: Awaited<
    ReturnType<typeof import("../../bootstrap-files.js").resolveBootstrapContextForRun>
  >["bootstrapFiles"];
  skillsPrompt: string;
  workspaceNotes?: string[];
};

export type AttemptSystemPromptContext = {
  sessionAgentId: string;
  systemPromptText: string;
  systemPromptReport: ReturnType<typeof buildSystemPromptReport>;
};

export async function buildAttemptSystemPromptContext(
  args: BuildAttemptSystemPromptContextArgs,
): Promise<AttemptSystemPromptContext> {
  const { params, effectiveWorkspace, sandbox, tools } = args;
  const machineName = await getMachineDisplayName();
  const runtimeChannel = normalizeMessageChannel(params.messageChannel ?? params.messageProvider);
  let runtimeCapabilities = runtimeChannel
    ? (resolveChannelCapabilities({
        cfg: params.config,
        channel: runtimeChannel,
        accountId: params.agentAccountId,
      }) ?? [])
    : undefined;

  if (runtimeChannel === "telegram" && params.config) {
    const inlineButtonsScope = resolveTelegramInlineButtonsScope({
      cfg: params.config,
      accountId: params.agentAccountId ?? undefined,
    });
    if (inlineButtonsScope !== "off") {
      if (!runtimeCapabilities) {
        runtimeCapabilities = [];
      }
      if (
        !runtimeCapabilities.some((cap) => String(cap).trim().toLowerCase() === "inlinebuttons")
      ) {
        runtimeCapabilities.push("inlineButtons");
      }
    }
  }

  const reactionGuidance =
    runtimeChannel && params.config
      ? (() => {
          if (runtimeChannel === "telegram") {
            const resolved = resolveTelegramReactionLevel({
              cfg: params.config,
              accountId: params.agentAccountId ?? undefined,
            });
            const level = resolved.agentReactionGuidance;
            return level ? { level, channel: "Telegram" } : undefined;
          }
          if (runtimeChannel === "signal") {
            const resolved = resolveSignalReactionLevel({
              cfg: params.config,
              accountId: params.agentAccountId ?? undefined,
            });
            const level = resolved.agentReactionGuidance;
            return level ? { level, channel: "Signal" } : undefined;
          }
          return undefined;
        })()
      : undefined;

  const { defaultAgentId, sessionAgentId } = resolveSessionAgentIds({
    sessionKey: params.sessionKey,
    config: params.config,
  });
  const sandboxInfo = buildEmbeddedSandboxInfo(sandbox, params.bashElevated);
  const reasoningTagHint = isReasoningTagProvider(params.provider);
  const channelActions = runtimeChannel
    ? listChannelSupportedActions({
        cfg: params.config,
        channel: runtimeChannel,
      })
    : undefined;
  const messageToolHints = runtimeChannel
    ? resolveChannelMessageToolHints({
        cfg: params.config,
        channel: runtimeChannel,
        accountId: params.agentAccountId,
      })
    : undefined;

  const defaultModelRef = resolveDefaultModelForAgent({
    cfg: params.config ?? {},
    agentId: sessionAgentId,
  });
  const defaultModelLabel = `${defaultModelRef.provider}/${defaultModelRef.model}`;

  const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
    config: params.config,
    agentId: sessionAgentId,
    workspaceDir: effectiveWorkspace,
    cwd: process.cwd(),
    runtime: {
      host: machineName,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version,
      model: `${params.provider}/${params.modelId}`,
      defaultModel: defaultModelLabel,
      shell: detectRuntimeShell(),
      channel: runtimeChannel,
      capabilities: runtimeCapabilities,
      channelActions,
    },
  });

  const isDefaultAgent = sessionAgentId === defaultAgentId;
  const promptMode =
    isSubagentSessionKey(params.sessionKey) || isCronSessionKey(params.sessionKey)
      ? "minimal"
      : "full";

  const docsPath = await resolveOpenClawDocsPath({
    workspaceDir: effectiveWorkspace,
    argv1: process.argv[1],
    cwd: process.cwd(),
    moduleUrl: import.meta.url,
  });
  const ttsHint = params.config ? buildTtsSystemPromptHint(params.config) : undefined;

  const appendPrompt = buildEmbeddedSystemPrompt({
    workspaceDir: effectiveWorkspace,
    defaultThinkLevel: params.thinkLevel,
    reasoningLevel: params.reasoningLevel ?? "off",
    extraSystemPrompt: params.extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    reasoningTagHint,
    heartbeatPrompt: isDefaultAgent
      ? resolveHeartbeatPrompt(params.config?.agents?.defaults?.heartbeat?.prompt)
      : undefined,
    skillsPrompt: args.skillsPrompt,
    docsPath: docsPath ?? undefined,
    ttsHint,
    workspaceNotes: args.workspaceNotes,
    reactionGuidance,
    promptMode,
    runtimeInfo,
    messageToolHints,
    sandboxInfo,
    tools,
    modelAliasLines: buildModelAliasLines(params.config),
    userTimezone,
    userTime,
    userTimeFormat,
    contextFiles: args.contextFiles,
    memoryCitationsMode: params.config?.memory?.citations,
  });

  const systemPromptReport = buildSystemPromptReport({
    source: "run",
    generatedAt: Date.now(),
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    model: params.modelId,
    workspaceDir: effectiveWorkspace,
    bootstrapMaxChars: resolveBootstrapMaxChars(params.config),
    sandbox: (() => {
      const runtime = resolveSandboxRuntimeStatus({
        cfg: params.config,
        sessionKey: params.sessionKey ?? params.sessionId,
      });
      return { mode: runtime.mode, sandboxed: runtime.sandboxed };
    })(),
    systemPrompt: appendPrompt,
    bootstrapFiles: args.hookAdjustedBootstrapFiles,
    injectedFiles: args.contextFiles,
    skillsPrompt: args.skillsPrompt,
    tools,
  });

  const systemPromptText = createSystemPromptOverride(appendPrompt)();

  return {
    sessionAgentId,
    systemPromptText,
    systemPromptReport,
  };
}
