import type { ExplorerField } from "../lib/schema-spike.ts";
import { resolveExplorerField } from "../lib/schema-spike.ts";

export type WizardStep = {
  id: string;
  label: string;
  description: string;
  fields: string[];
};

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: "gateway",
    label: "网关",
    description: "核心网关网络与认证配置。",
    fields: [
      "gateway.port",
      "gateway.mode",
      "gateway.bind",
      "gateway.auth.mode",
      "gateway.auth.token",
      "gateway.auth.password",
    ],
  },
  {
    id: "channels",
    label: "渠道",
    description: "常用渠道凭证与私聊策略。",
    fields: [
      "channels.whatsapp.dmPolicy",
      "channels.telegram.botToken",
      "channels.telegram.dmPolicy",
      "channels.discord.token",
      "channels.discord.dm.policy",
      "channels.slack.botToken",
      "channels.slack.dm.policy",
      "channels.signal.account",
      "channels.signal.dmPolicy",
    ],
  },
  {
    id: "agents",
    label: "智能体",
    description: "默认模型与工作区行为。",
    fields: [
      "agents.defaults.model.primary",
      "agents.defaults.model.fallbacks",
      "agents.defaults.workspace",
      "agents.defaults.repoRoot",
      "agents.defaults.humanDelay.mode",
    ],
  },
  {
    id: "models",
    label: "模型",
    description: "认证配置与模型列表数据。",
    fields: ["agents.defaults.models", "auth.profiles", "auth.order"],
  },
  {
    id: "messages",
    label: "消息",
    description: "回复行为与确认策略默认值。",
    fields: [
      "messages.ackReaction",
      "messages.ackReactionScope",
      "messages.inbound.debounceMs",
      "channels.telegram.streamMode",
    ],
  },
  {
    id: "session",
    label: "会话",
    description: "私聊作用域与智能体互调行为。",
    fields: ["session.dmScope", "session.identityLinks", "session.agentToAgent.maxPingPongTurns"],
  },
  {
    id: "tools",
    label: "工具",
    description: "Web 与执行工具默认设置。",
    fields: [
      "tools.profile",
      "tools.web.search.enabled",
      "tools.web.search.provider",
      "tools.web.search.apiKey",
      "tools.web.fetch.enabled",
      "tools.exec.applyPatch.enabled",
    ],
  },
];

export function wizardStepFields(step: WizardStep): ExplorerField[] {
  return step.fields
    .map((path) => resolveExplorerField(path))
    .filter((field): field is ExplorerField => field !== null);
}

export function wizardStepByIndex(index: number): WizardStep {
  const clamped = Math.max(0, Math.min(index, WIZARD_STEPS.length - 1));
  return WIZARD_STEPS[clamped] ?? WIZARD_STEPS[0] ?? {
    id: "empty",
    label: "空",
    description: "未配置引导步骤。",
    fields: [],
  };
}
