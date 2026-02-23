import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveSessionKey } from "./http-utils.js";
import type { StreamingEvent } from "./open-responses.schema.js";

export function writeSseEvent(res: ServerResponse, event: StreamingEvent) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function resolveOpenResponsesSessionKey(params: {
  req: IncomingMessage;
  agentId: string;
  user?: string | undefined;
}): string {
  return resolveSessionKey({ ...params, prefix: "openresponses" });
}
