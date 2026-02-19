import type { OpenClawConfig } from "../config/config.js";
import type { HealthSummary } from "./health.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import {
  type HeartbeatSummary,
  resolveHeartbeatSummaryForAgent,
} from "../infra/heartbeat-runner.js";
import { normalizeAgentId } from "../routing/session-key.js";

export const resolveHeartbeatSummary = (cfg: OpenClawConfig, agentId: string): HeartbeatSummary =>
  resolveHeartbeatSummaryForAgent(cfg, agentId);

export function resolveAgentOrder(cfg: OpenClawConfig) {
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const entries = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const seen = new Set<string>();
  const ordered: Array<{ id: string; name?: string }> = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      continue;
    }
    const id = normalizeAgentId(entry.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push({ id, name: typeof entry.name === "string" ? entry.name : undefined });
  }

  if (!seen.has(defaultAgentId)) {
    ordered.unshift({ id: defaultAgentId });
  }

  if (ordered.length === 0) {
    ordered.push({ id: defaultAgentId });
  }

  return { defaultAgentId, ordered };
}

export function buildSessionSummary(
  cfg: OpenClawConfig,
  agentId: string,
): HealthSummary["sessions"] {
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const sessions = Object.entries(store)
    .filter(([key]) => key !== "global" && key !== "unknown")
    .map(([key, entry]) => ({ key, updatedAt: entry?.updatedAt ?? 0 }))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const recent = sessions.slice(0, 5).map((s) => ({
    key: s.key,
    updatedAt: s.updatedAt || null,
    age: s.updatedAt ? Date.now() - s.updatedAt : null,
  }));

  return {
    path: storePath,
    count: sessions.length,
    recent,
  };
}
