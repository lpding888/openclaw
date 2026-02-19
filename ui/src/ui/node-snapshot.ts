import type { NodeSnapshot } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") {
    return undefined;
  }
  return value;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (entry == null) {
        return "";
      }
      return String(entry).trim();
    })
    .filter(Boolean);
  return list;
}

export function normalizeNodeSnapshot(entry: unknown): NodeSnapshot | null {
  const record = asRecord(entry);
  if (!record) {
    return null;
  }

  const node: NodeSnapshot = { ...record };
  const nodeId = asTrimmedString(record.nodeId);
  const displayName = asTrimmedString(record.displayName);
  const remoteIp = asTrimmedString(record.remoteIp);
  const version = asTrimmedString(record.version);
  const connected = asBoolean(record.connected);
  const paired = asBoolean(record.paired);
  const caps = asStringArray(record.caps);
  const commands = asStringArray(record.commands);

  if (nodeId) {
    node.nodeId = nodeId;
  }
  if (displayName) {
    node.displayName = displayName;
  }
  if (remoteIp) {
    node.remoteIp = remoteIp;
  }
  if (version) {
    node.version = version;
  }
  if (typeof connected === "boolean") {
    node.connected = connected;
  }
  if (typeof paired === "boolean") {
    node.paired = paired;
  }
  if (caps) {
    node.caps = caps;
  }
  if (commands) {
    node.commands = commands;
  }
  return node;
}

export function normalizeNodeSnapshots(value: unknown): NodeSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const list: NodeSnapshot[] = [];
  for (const entry of value) {
    const normalized = normalizeNodeSnapshot(entry);
    if (normalized) {
      list.push(normalized);
    }
  }
  return list;
}

export function nodeSupportsCommand(node: NodeSnapshot, command: string): boolean {
  return Array.isArray(node.commands) && node.commands.some((entry) => entry === command);
}

export function nodeLabel(node: NodeSnapshot): string {
  const nodeId = typeof node.nodeId === "string" ? node.nodeId : "";
  const displayName =
    typeof node.displayName === "string" && node.displayName.trim()
      ? node.displayName.trim()
      : nodeId || "未知";
  if (!nodeId || displayName === nodeId) {
    return displayName;
  }
  return `${displayName} · ${nodeId}`;
}
