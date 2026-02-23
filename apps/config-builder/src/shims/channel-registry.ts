// Browser-safe channel registry shim for config-builder schema imports.
export const CHAT_CHANNEL_ORDER = [
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
] as const;

export const CHANNEL_IDS = [...CHAT_CHANNEL_ORDER] as const;
