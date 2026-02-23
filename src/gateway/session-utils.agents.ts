import fs from "node:fs";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { type OpenClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import type { SessionScope } from "../config/sessions.js";
import { normalizeAgentId, normalizeMainKey } from "../routing/session-key.js";
import type { GatewayAgentRow } from "./session-utils.types.js";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const AVATAR_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

const AVATAR_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function resolveAvatarMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return AVATAR_MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function isWorkspaceRelativePath(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.startsWith("~")) {
    return false;
  }
  if (AVATAR_SCHEME_RE.test(value) && !WINDOWS_ABS_RE.test(value)) {
    return false;
  }
  return true;
}

function resolveIdentityAvatarUrl(
  cfg: OpenClawConfig,
  agentId: string,
  avatar: string | undefined,
): string | undefined {
  if (!avatar) {
    return undefined;
  }
  const trimmed = avatar.trim();
  if (!trimmed) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(trimmed) || AVATAR_HTTP_RE.test(trimmed)) {
    return trimmed;
  }
  if (!isWorkspaceRelativePath(trimmed)) {
    return undefined;
  }
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const workspaceRoot = path.resolve(workspaceDir);
  const resolved = path.resolve(workspaceRoot, trimmed);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > AVATAR_MAX_BYTES) {
      return undefined;
    }
    const buffer = fs.readFileSync(resolved);
    const mime = resolveAvatarMime(resolved);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function listExistingAgentIdsFromDisk(): string[] {
  const root = resolveStateDir();
  const agentsDir = path.join(root, "agents");
  try {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeAgentId(entry.name))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function listConfiguredAgentIds(cfg: OpenClawConfig): string[] {
  const agents = cfg.agents?.list ?? [];
  if (agents.length > 0) {
    const ids = new Set<string>();
    for (const entry of agents) {
      if (entry?.id) {
        ids.add(normalizeAgentId(entry.id));
      }
    }
    const defaultId = normalizeAgentId(resolveDefaultAgentId(cfg));
    ids.add(defaultId);
    const sorted = Array.from(ids).filter(Boolean);
    sorted.sort((a, b) => a.localeCompare(b));
    return sorted.includes(defaultId)
      ? [defaultId, ...sorted.filter((id) => id !== defaultId)]
      : sorted;
  }

  const ids = new Set<string>();
  const defaultId = normalizeAgentId(resolveDefaultAgentId(cfg));
  ids.add(defaultId);
  for (const id of listExistingAgentIdsFromDisk()) {
    ids.add(id);
  }
  const sorted = Array.from(ids).filter(Boolean);
  sorted.sort((a, b) => a.localeCompare(b));
  if (sorted.includes(defaultId)) {
    return [defaultId, ...sorted.filter((id) => id !== defaultId)];
  }
  return sorted;
}

export function listAgentsForGateway(cfg: OpenClawConfig): {
  defaultId: string;
  mainKey: string;
  scope: SessionScope;
  agents: GatewayAgentRow[];
} {
  const defaultId = normalizeAgentId(resolveDefaultAgentId(cfg));
  const mainKey = normalizeMainKey(cfg.session?.mainKey);
  const scope = cfg.session?.scope ?? "per-sender";
  const configuredById = new Map<
    string,
    { name?: string; identity?: GatewayAgentRow["identity"] }
  >();

  for (const entry of cfg.agents?.list ?? []) {
    if (!entry?.id) {
      continue;
    }
    const normalizedId = normalizeAgentId(entry.id);
    const identity = entry.identity
      ? {
          name: entry.identity.name?.trim() || undefined,
          theme: entry.identity.theme?.trim() || undefined,
          emoji: entry.identity.emoji?.trim() || undefined,
          avatar: entry.identity.avatar?.trim() || undefined,
          avatarUrl: resolveIdentityAvatarUrl(cfg, normalizedId, entry.identity.avatar?.trim()),
        }
      : undefined;
    configuredById.set(normalizedId, {
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined,
      identity,
    });
  }

  const explicitIds = new Set(
    (cfg.agents?.list ?? [])
      .map((entry) => (entry?.id ? normalizeAgentId(entry.id) : ""))
      .filter(Boolean),
  );
  const allowedIds = explicitIds.size > 0 ? new Set([...explicitIds, defaultId]) : null;
  let agentIds = listConfiguredAgentIds(cfg).filter((id) =>
    allowedIds ? allowedIds.has(id) : true,
  );
  if (mainKey && !agentIds.includes(mainKey) && (!allowedIds || allowedIds.has(mainKey))) {
    agentIds = [...agentIds, mainKey];
  }

  const agents = agentIds.map((id) => {
    const meta = configuredById.get(id);
    return {
      id,
      name: meta?.name,
      identity: meta?.identity,
    };
  });

  return { defaultId, mainKey, scope, agents };
}
