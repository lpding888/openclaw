import type { ClientToolDefinition } from "../agents/pi-embedded-runner/run/params.js";
import type { ImageContent } from "../commands/agent/types.js";
import type { GatewayHttpResponsesConfig } from "../config/types.gateway.js";
import type { CreateResponseBody } from "./open-responses.schema.js";
import {
  DEFAULT_INPUT_FILE_MAX_BYTES,
  DEFAULT_INPUT_FILE_MAX_CHARS,
  DEFAULT_INPUT_FILE_MIMES,
  DEFAULT_INPUT_IMAGE_MAX_BYTES,
  DEFAULT_INPUT_IMAGE_MIMES,
  DEFAULT_INPUT_MAX_REDIRECTS,
  DEFAULT_INPUT_PDF_MAX_PAGES,
  DEFAULT_INPUT_PDF_MAX_PIXELS,
  DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
  DEFAULT_INPUT_TIMEOUT_MS,
  extractFileContentFromSource,
  extractImageContentFromSource,
  normalizeMimeList,
  type InputFileLimits,
  type InputImageLimits,
  type InputImageSource,
} from "../media/input-files.js";

const DEFAULT_BODY_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_URL_PARTS = 8;

export type ResolvedResponsesLimits = {
  maxBodyBytes: number;
  maxUrlParts: number;
  files: InputFileLimits;
  images: InputImageLimits;
};

function normalizeHostnameAllowlist(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveResponsesLimits(
  config: GatewayHttpResponsesConfig | undefined,
): ResolvedResponsesLimits {
  const files = config?.files;
  const images = config?.images;
  return {
    maxBodyBytes: config?.maxBodyBytes ?? DEFAULT_BODY_BYTES,
    maxUrlParts:
      typeof config?.maxUrlParts === "number"
        ? Math.max(0, Math.floor(config.maxUrlParts))
        : DEFAULT_MAX_URL_PARTS,
    files: {
      allowUrl: files?.allowUrl ?? true,
      urlAllowlist: normalizeHostnameAllowlist(files?.urlAllowlist),
      allowedMimes: normalizeMimeList(files?.allowedMimes, DEFAULT_INPUT_FILE_MIMES),
      maxBytes: files?.maxBytes ?? DEFAULT_INPUT_FILE_MAX_BYTES,
      maxChars: files?.maxChars ?? DEFAULT_INPUT_FILE_MAX_CHARS,
      maxRedirects: files?.maxRedirects ?? DEFAULT_INPUT_MAX_REDIRECTS,
      timeoutMs: files?.timeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS,
      pdf: {
        maxPages: files?.pdf?.maxPages ?? DEFAULT_INPUT_PDF_MAX_PAGES,
        maxPixels: files?.pdf?.maxPixels ?? DEFAULT_INPUT_PDF_MAX_PIXELS,
        minTextChars: files?.pdf?.minTextChars ?? DEFAULT_INPUT_PDF_MIN_TEXT_CHARS,
      },
    },
    images: {
      allowUrl: images?.allowUrl ?? true,
      urlAllowlist: normalizeHostnameAllowlist(images?.urlAllowlist),
      allowedMimes: normalizeMimeList(images?.allowedMimes, DEFAULT_INPUT_IMAGE_MIMES),
      maxBytes: images?.maxBytes ?? DEFAULT_INPUT_IMAGE_MAX_BYTES,
      maxRedirects: images?.maxRedirects ?? DEFAULT_INPUT_MAX_REDIRECTS,
      timeoutMs: images?.timeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS,
    },
  };
}

export function extractClientTools(body: CreateResponseBody): ClientToolDefinition[] {
  return (body.tools ?? []) as ClientToolDefinition[];
}

export function applyToolChoice(params: {
  tools: ClientToolDefinition[];
  toolChoice: CreateResponseBody["tool_choice"];
}): { tools: ClientToolDefinition[]; extraSystemPrompt?: string } {
  const { tools, toolChoice } = params;
  if (!toolChoice) {
    return { tools };
  }

  if (toolChoice === "none") {
    return { tools: [] };
  }

  if (toolChoice === "required") {
    if (tools.length === 0) {
      throw new Error("tool_choice=required but no tools were provided");
    }
    return {
      tools,
      extraSystemPrompt: "You must call one of the available tools before responding.",
    };
  }

  if (typeof toolChoice === "object" && toolChoice.type === "function") {
    const targetName = toolChoice.function?.name?.trim();
    if (!targetName) {
      throw new Error("tool_choice.function.name is required");
    }
    const matched = tools.filter((tool) => tool.function?.name === targetName);
    if (matched.length === 0) {
      throw new Error(`tool_choice requested unknown tool: ${targetName}`);
    }
    return {
      tools: matched,
      extraSystemPrompt: `You must call the ${targetName} tool before responding.`,
    };
  }

  return { tools };
}

export async function extractInputArtifacts(params: {
  payload: CreateResponseBody;
  limits: ResolvedResponsesLimits;
}): Promise<{ images: ImageContent[]; fileContexts: string[] }> {
  const { payload, limits } = params;
  let images: ImageContent[] = [];
  const fileContexts: string[] = [];
  let urlParts = 0;

  const markUrlPart = () => {
    urlParts += 1;
    if (urlParts > limits.maxUrlParts) {
      throw new Error(
        `Too many URL-based input sources: ${urlParts} (limit: ${limits.maxUrlParts})`,
      );
    }
  };

  if (!Array.isArray(payload.input)) {
    return { images, fileContexts };
  }

  for (const item of payload.input) {
    if (item.type !== "message" || typeof item.content === "string") {
      continue;
    }
    for (const part of item.content) {
      if (part.type === "input_image") {
        const source = part.source as {
          type?: string;
          url?: string;
          data?: string;
          media_type?: string;
        };
        const sourceType =
          source.type === "base64" || source.type === "url" ? source.type : undefined;
        if (!sourceType) {
          throw new Error("input_image must have 'source.url' or 'source.data'");
        }
        if (sourceType === "url") {
          markUrlPart();
        }
        const imageSource: InputImageSource = {
          type: sourceType,
          url: source.url,
          data: source.data,
          mediaType: source.media_type,
        };
        const image = await extractImageContentFromSource(imageSource, limits.images);
        images.push(image);
        continue;
      }

      if (part.type === "input_file") {
        const source = part.source as {
          type?: string;
          url?: string;
          data?: string;
          media_type?: string;
          filename?: string;
        };
        const sourceType =
          source.type === "base64" || source.type === "url" ? source.type : undefined;
        if (!sourceType) {
          throw new Error("input_file must have 'source.url' or 'source.data'");
        }
        if (sourceType === "url") {
          markUrlPart();
        }
        const file = await extractFileContentFromSource({
          source: {
            type: sourceType,
            url: source.url,
            data: source.data,
            mediaType: source.media_type,
            filename: source.filename,
          },
          limits: limits.files,
        });
        if (file.text?.trim()) {
          fileContexts.push(`<file name="${file.filename}">\n${file.text}\n</file>`);
        } else if (file.images && file.images.length > 0) {
          fileContexts.push(
            `<file name="${file.filename}">[PDF content rendered to images]</file>`,
          );
        }
        if (file.images && file.images.length > 0) {
          images = images.concat(file.images);
        }
      }
    }
  }

  return { images, fileContexts };
}
