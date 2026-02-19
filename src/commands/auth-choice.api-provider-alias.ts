const TOKEN_PROVIDER_TO_AUTH_CHOICE: Record<string, string> = {
  openrouter: "openrouter-api-key",
  litellm: "litellm-api-key",
  "vercel-ai-gateway": "ai-gateway-api-key",
  "cloudflare-ai-gateway": "cloudflare-ai-gateway-api-key",
  moonshot: "moonshot-api-key",
  "kimi-code": "kimi-code-api-key",
  "kimi-coding": "kimi-code-api-key",
  google: "gemini-api-key",
  zai: "zai-api-key",
  xiaomi: "xiaomi-api-key",
  synthetic: "synthetic-api-key",
  venice: "venice-api-key",
  together: "together-api-key",
  huggingface: "huggingface-api-key",
  opencode: "opencode-zen",
  qianfan: "qianfan-api-key",
};

export function resolveApiProviderAuthChoice(authChoice: string, tokenProvider?: string): string {
  if (!tokenProvider || authChoice !== "apiKey") {
    return authChoice;
  }
  if (tokenProvider === "anthropic" || tokenProvider === "openai") {
    return authChoice;
  }
  return TOKEN_PROVIDER_TO_AUTH_CHOICE[tokenProvider] ?? authChoice;
}
