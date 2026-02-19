import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { resolveEnvApiKey } from "../agents/model-auth.js";
import {
  formatApiKeyPreview,
  normalizeApiKeyInput,
  validateApiKeyInput,
} from "./auth-choice.api-key.js";
import { resolveApiProviderAuthChoice } from "./auth-choice.api-provider-alias.js";
import { createAuthChoiceAgentModelNoter } from "./auth-choice.apply-helpers.js";
import { handleAsiaApiProviders } from "./auth-choice.apply.api-providers.asia.js";
import { handleGatewayApiProviders } from "./auth-choice.apply.api-providers.gateways.js";
import { handleOpenModelApiProviders } from "./auth-choice.apply.api-providers.open-models.js";
import { applyAuthChoiceOpenRouter } from "./auth-choice.apply.openrouter.js";
import { setMoonshotApiKey } from "./onboard-auth.js";

export async function applyAuthChoiceApiProviders(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  let nextConfig = params.config;
  let agentModelOverride: string | undefined;
  const noteAgentModel = createAuthChoiceAgentModelNoter(params);

  const authChoice = resolveApiProviderAuthChoice(params.authChoice, params.opts?.tokenProvider);

  async function ensureMoonshotApiKeyCredential(promptMessage: string): Promise<void> {
    let hasCredential = false;

    if (!hasCredential && params.opts?.token && params.opts?.tokenProvider === "moonshot") {
      await setMoonshotApiKey(normalizeApiKeyInput(params.opts.token), params.agentDir);
      hasCredential = true;
    }

    const envKey = resolveEnvApiKey("moonshot");
    if (envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing MOONSHOT_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setMoonshotApiKey(envKey.apiKey, params.agentDir);
        hasCredential = true;
      }
    }

    if (!hasCredential) {
      const key = await params.prompter.text({
        message: promptMessage,
        validate: validateApiKeyInput,
      });
      await setMoonshotApiKey(normalizeApiKeyInput(String(key ?? "")), params.agentDir);
    }
  }

  if (authChoice === "openrouter-api-key") {
    return applyAuthChoiceOpenRouter(params);
  }

  const handlerArgs = {
    authChoice,
    config: nextConfig,
    agentModelOverride,
    params,
    noteAgentModel,
    ensureMoonshotApiKeyCredential,
  };

  for (const handler of [
    handleGatewayApiProviders,
    handleAsiaApiProviders,
    handleOpenModelApiProviders,
  ]) {
    const result = await handler(handlerArgs);
    if (result.handled) {
      nextConfig = result.config;
      agentModelOverride = result.agentModelOverride ?? agentModelOverride;
      return { config: nextConfig, agentModelOverride };
    }
  }

  return null;
}
