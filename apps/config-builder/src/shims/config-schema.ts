import { z } from "zod";

export type ConfigUiHint = {
  label?: string;
  help?: string;
  tags?: string[];
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
  group?: string;
  order?: number;
};

export type ConfigUiHints = Record<string, ConfigUiHint>;

const DmPolicySchema = z.enum(["owner", "everyone", "none"]).optional();

const ToolPolicySchema = z
  .object({
    profile: z.string().optional(),
    allow: z.array(z.string()).optional(),
    alsoAllow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    web: z
      .object({
        search: z
          .object({
            enabled: z.boolean().optional(),
            provider: z.string().optional(),
            apiKey: z.string().optional(),
          })
          .strict()
          .optional(),
        fetch: z
          .object({
            enabled: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    exec: z
      .object({
        applyPatch: z
          .object({
            enabled: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

const AgentSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    tools: ToolPolicySchema,
  })
  .strict();

export const OpenClawSchema = z
  .object({
    gateway: z
      .object({
        port: z.number().int().optional(),
        mode: z.enum(["local", "remote"]).optional(),
        bind: z.string().optional(),
        auth: z
          .object({
            mode: z.enum(["token", "password"]).optional(),
            token: z.string().optional(),
            password: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    channels: z
      .object({
        whatsapp: z
          .object({
            dmPolicy: DmPolicySchema,
          })
          .strict()
          .optional(),
        telegram: z
          .object({
            botToken: z.string().optional(),
            dmPolicy: DmPolicySchema,
            streamMode: z.enum(["replace", "status_final", "append"]).optional(),
          })
          .strict()
          .optional(),
        discord: z
          .object({
            token: z.string().optional(),
            dm: z
              .object({
                policy: DmPolicySchema,
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        slack: z
          .object({
            botToken: z.string().optional(),
            dm: z
              .object({
                policy: DmPolicySchema,
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        signal: z
          .object({
            account: z.string().optional(),
            dmPolicy: DmPolicySchema,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    update: z
      .object({
        channel: z.enum(["stable", "beta", "dev"]).optional(),
      })
      .strict()
      .optional(),
    tools: ToolPolicySchema,
    diagnostics: z
      .object({
        otel: z
          .object({
            headers: z.record(z.string(), z.string()).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    browser: z
      .object({
        snapshotDefaults: z
          .object({
            mode: z.enum(["efficient"]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    agents: z
      .object({
        defaults: z
          .object({
            model: z
              .object({
                primary: z.string().optional(),
                fallbacks: z.array(z.string()).optional(),
              })
              .strict()
              .optional(),
            workspace: z.string().optional(),
            repoRoot: z.string().optional(),
            humanDelay: z
              .object({
                mode: z.enum(["off", "fixed", "random"]).optional(),
              })
              .strict()
              .optional(),
            models: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
        list: z.array(AgentSchema).optional(),
      })
      .strict()
      .optional(),
    auth: z
      .object({
        profiles: z
          .record(
            z.string(),
            z
              .object({
                apiKey: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
        order: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    messages: z
      .object({
        ackReaction: z.string().optional(),
        ackReactionScope: z.string().optional(),
        inbound: z
          .object({
            debounceMs: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    session: z
      .object({
        dmScope: z.string().optional(),
        identityLinks: z.record(z.string(), z.string()).optional(),
        agentToAgent: z
          .object({
            maxPingPongTurns: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const UI_HINTS: ConfigUiHints = {
  gateway: { label: "网关", group: "核心", order: 10 },
  "gateway.port": {
    label: "端口",
    help: "网关监听端口。",
  },
  "gateway.auth.token": {
    label: "认证令牌",
    help: "供仪表盘客户端连接使用的令牌。",
    sensitive: true,
  },
  channels: { label: "渠道", group: "核心", order: 20 },
  "channels.telegram.botToken": {
    label: "Telegram 机器人令牌",
    help: "从 BotFather 获取的机器人令牌。",
    sensitive: true,
  },
  update: { label: "更新", group: "核心", order: 30 },
  "update.channel": {
    label: "发布通道",
    help: "选择 stable、beta 或 dev 更新通道。",
  },
  tools: { label: "工具", group: "安全", order: 40 },
  "tools.alsoAllow": {
    label: "额外允许",
    help: "附加到生效 allow 列表的额外工具。",
  },
  "tools.web.fetch.firecrawl.enabled": {
    label: "Firecrawl",
    help: "仅用于提示的路径，故意不在 schema 中声明。",
  },
  diagnostics: { label: "诊断", group: "可观测性", order: 50 },
  "diagnostics.otel.headers": {
    label: "OTel 请求头",
    help: "附加到遥测上报请求中的额外请求头。",
  },
  browser: { label: "浏览器", group: "运行时", order: 60 },
  "browser.snapshotDefaults.mode": {
    label: "快照模式",
    help: "浏览器快照默认采集模式。",
  },
  agents: { label: "智能体", group: "智能体", order: 70 },
  auth: { label: "认证", group: "模型", order: 80 },
  messages: { label: "消息", group: "消息", order: 90 },
  session: { label: "会话", group: "会话", order: 100 },
  "agents.list.*.model": {
    label: "智能体模型",
    help: "每个智能体条目的默认模型。",
  },
};

export type ConfigSchema = ReturnType<typeof OpenClawSchema.toJSONSchema>;

export type ConfigSchemaResponse = {
  schema: ConfigSchema;
  uiHints: ConfigUiHints;
  version: string;
  generatedAt: string;
};

export function buildConfigSchema(): ConfigSchemaResponse {
  return {
    schema: OpenClawSchema.toJSONSchema({
      target: "draft-07",
      unrepresentable: "any",
    }),
    uiHints: { ...UI_HINTS },
    version: "2026.2.22-2",
    generatedAt: "2026-02-23T00:00:00.000Z",
  };
}
