import { z } from "zod";
import { sensitive } from "./zod-schema.sensitive.js";

export const GatewaySchema = z
  .object({
    port: z.number().int().positive().optional(),
    mode: z.union([z.literal("local"), z.literal("remote")]).optional(),
    bind: z
      .union([
        z.literal("auto"),
        z.literal("lan"),
        z.literal("loopback"),
        z.literal("custom"),
        z.literal("tailnet"),
      ])
      .optional(),
    controlUi: z
      .object({
        enabled: z.boolean().optional(),
        basePath: z.string().optional(),
        root: z.string().optional(),
        allowedOrigins: z.array(z.string()).optional(),
        allowInsecureAuth: z.boolean().optional(),
        dangerouslyDisableDeviceAuth: z.boolean().optional(),
      })
      .strict()
      .optional(),
    auth: z
      .object({
        mode: z
          .union([z.literal("token"), z.literal("password"), z.literal("trusted-proxy")])
          .optional(),
        token: z.string().optional().register(sensitive),
        password: z.string().optional().register(sensitive),
        allowTailscale: z.boolean().optional(),
        rateLimit: z
          .object({
            maxAttempts: z.number().optional(),
            windowMs: z.number().optional(),
            lockoutMs: z.number().optional(),
            exemptLoopback: z.boolean().optional(),
          })
          .strict()
          .optional(),
        trustedProxy: z
          .object({
            userHeader: z.string().min(1, "userHeader is required for trusted-proxy mode"),
            requiredHeaders: z.array(z.string()).optional(),
            allowUsers: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    trustedProxies: z.array(z.string()).optional(),
    tools: z
      .object({
        deny: z.array(z.string()).optional(),
        allow: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    tailscale: z
      .object({
        mode: z.union([z.literal("off"), z.literal("serve"), z.literal("funnel")]).optional(),
        resetOnExit: z.boolean().optional(),
      })
      .strict()
      .optional(),
    remote: z
      .object({
        url: z.string().optional(),
        transport: z.union([z.literal("ssh"), z.literal("direct")]).optional(),
        token: z.string().optional().register(sensitive),
        password: z.string().optional().register(sensitive),
        tlsFingerprint: z.string().optional(),
        sshTarget: z.string().optional(),
        sshIdentity: z.string().optional(),
      })
      .strict()
      .optional(),
    reload: z
      .object({
        mode: z
          .union([z.literal("off"), z.literal("restart"), z.literal("hot"), z.literal("hybrid")])
          .optional(),
        debounceMs: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    tls: z
      .object({
        enabled: z.boolean().optional(),
        autoGenerate: z.boolean().optional(),
        certPath: z.string().optional(),
        keyPath: z.string().optional(),
        caPath: z.string().optional(),
      })
      .optional(),
    http: z
      .object({
        endpoints: z
          .object({
            chatCompletions: z
              .object({
                enabled: z.boolean().optional(),
              })
              .strict()
              .optional(),
            responses: z
              .object({
                enabled: z.boolean().optional(),
                maxBodyBytes: z.number().int().positive().optional(),
                maxUrlParts: z.number().int().nonnegative().optional(),
                files: z
                  .object({
                    allowUrl: z.boolean().optional(),
                    urlAllowlist: z.array(z.string()).optional(),
                    allowedMimes: z.array(z.string()).optional(),
                    maxBytes: z.number().int().positive().optional(),
                    maxChars: z.number().int().positive().optional(),
                    maxRedirects: z.number().int().nonnegative().optional(),
                    timeoutMs: z.number().int().positive().optional(),
                    pdf: z
                      .object({
                        maxPages: z.number().int().positive().optional(),
                        maxPixels: z.number().int().positive().optional(),
                        minTextChars: z.number().int().nonnegative().optional(),
                      })
                      .strict()
                      .optional(),
                  })
                  .strict()
                  .optional(),
                images: z
                  .object({
                    allowUrl: z.boolean().optional(),
                    urlAllowlist: z.array(z.string()).optional(),
                    allowedMimes: z.array(z.string()).optional(),
                    maxBytes: z.number().int().positive().optional(),
                    maxRedirects: z.number().int().nonnegative().optional(),
                    timeoutMs: z.number().int().positive().optional(),
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    nodes: z
      .object({
        browser: z
          .object({
            mode: z.union([z.literal("auto"), z.literal("manual"), z.literal("off")]).optional(),
            node: z.string().optional(),
          })
          .strict()
          .optional(),
        allowCommands: z.array(z.string()).optional(),
        denyCommands: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();
