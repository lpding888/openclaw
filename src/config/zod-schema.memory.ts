import { z } from "zod";
import { SessionSendPolicySchema } from "./zod-schema.session.js";

const MemoryQmdPathSchema = z
  .object({
    path: z.string(),
    name: z.string().optional(),
    pattern: z.string().optional(),
  })
  .strict();

const MemoryQmdSessionSchema = z
  .object({
    enabled: z.boolean().optional(),
    exportDir: z.string().optional(),
    retentionDays: z.number().int().nonnegative().optional(),
  })
  .strict();

const MemoryQmdUpdateSchema = z
  .object({
    interval: z.string().optional(),
    debounceMs: z.number().int().nonnegative().optional(),
    onBoot: z.boolean().optional(),
    waitForBootSync: z.boolean().optional(),
    embedInterval: z.string().optional(),
    commandTimeoutMs: z.number().int().nonnegative().optional(),
    updateTimeoutMs: z.number().int().nonnegative().optional(),
    embedTimeoutMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const MemoryQmdLimitsSchema = z
  .object({
    maxResults: z.number().int().positive().optional(),
    maxSnippetChars: z.number().int().positive().optional(),
    maxInjectedChars: z.number().int().positive().optional(),
    timeoutMs: z.number().int().nonnegative().optional(),
  })
  .strict();

const MemoryQmdSchema = z
  .object({
    command: z.string().optional(),
    searchMode: z.union([z.literal("query"), z.literal("search"), z.literal("vsearch")]).optional(),
    includeDefaultMemory: z.boolean().optional(),
    paths: z.array(MemoryQmdPathSchema).optional(),
    sessions: MemoryQmdSessionSchema.optional(),
    update: MemoryQmdUpdateSchema.optional(),
    limits: MemoryQmdLimitsSchema.optional(),
    scope: SessionSendPolicySchema.optional(),
  })
  .strict();

export const MemorySchema = z
  .object({
    backend: z.union([z.literal("builtin"), z.literal("qmd")]).optional(),
    citations: z.union([z.literal("auto"), z.literal("on"), z.literal("off")]).optional(),
    qmd: MemoryQmdSchema.optional(),
  })
  .strict()
  .optional();
