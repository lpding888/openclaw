import type {
  ApiProviderHandlerArgs,
  ApiProviderHandlerResult,
} from "./auth-choice.apply.api-providers.types.js";
import { ensureAuthProfileStore, resolveAuthProfileOrder } from "../agents/auth-profiles.js";
import { resolveEnvApiKey } from "../agents/model-auth.js";
import {
  formatApiKeyPreview,
  normalizeApiKeyInput,
  validateApiKeyInput,
} from "./auth-choice.api-key.js";
import { applyDefaultModelChoice } from "./auth-choice.default-model.js";
import {
  applyAuthProfileConfig,
  applyCloudflareAiGatewayConfig,
  applyCloudflareAiGatewayProviderConfig,
  applyLitellmConfig,
  applyLitellmProviderConfig,
  applyMoonshotConfig,
  applyMoonshotConfigCn,
  applyMoonshotProviderConfig,
  applyMoonshotProviderConfigCn,
  applyVercelAiGatewayConfig,
  applyVercelAiGatewayProviderConfig,
  CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
  LITELLM_DEFAULT_MODEL_REF,
  MOONSHOT_DEFAULT_MODEL_REF,
  VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
  setCloudflareAiGatewayConfig,
  setLitellmApiKey,
  setVercelAiGatewayApiKey,
} from "./onboard-auth.js";

function unhandled(args: ApiProviderHandlerArgs): ApiProviderHandlerResult {
  return {
    handled: false,
    config: args.config,
    agentModelOverride: args.agentModelOverride,
  };
}

export async function handleGatewayApiProviders(
  args: ApiProviderHandlerArgs,
): Promise<ApiProviderHandlerResult> {
  let nextConfig = args.config;
  let agentModelOverride = args.agentModelOverride;

  if (args.authChoice === "litellm-api-key") {
    const store = ensureAuthProfileStore(args.params.agentDir, { allowKeychainPrompt: false });
    const profileOrder = resolveAuthProfileOrder({ cfg: nextConfig, store, provider: "litellm" });
    const existingProfileId = profileOrder.find((profileId) => Boolean(store.profiles[profileId]));
    const existingCred = existingProfileId ? store.profiles[existingProfileId] : undefined;
    let profileId = "litellm:default";
    let hasCredential = false;

    if (existingProfileId && existingCred?.type === "api_key") {
      profileId = existingProfileId;
      hasCredential = true;
    }
    if (
      !hasCredential &&
      args.params.opts?.token &&
      args.params.opts?.tokenProvider === "litellm"
    ) {
      await setLitellmApiKey(normalizeApiKeyInput(args.params.opts.token), args.params.agentDir);
      hasCredential = true;
    }
    if (!hasCredential) {
      await args.params.prompter.note(
        "LiteLLM provides a unified API to 100+ LLM providers.\nGet your API key from your LiteLLM proxy or https://litellm.ai\nDefault proxy runs on http://localhost:4000",
        "LiteLLM",
      );
      const envKey = resolveEnvApiKey("litellm");
      if (envKey) {
        const useExisting = await args.params.prompter.confirm({
          message: `Use existing LITELLM_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
          initialValue: true,
        });
        if (useExisting) {
          await setLitellmApiKey(envKey.apiKey, args.params.agentDir);
          hasCredential = true;
        }
      }
      if (!hasCredential) {
        const key = await args.params.prompter.text({
          message: "Enter LiteLLM API key",
          validate: validateApiKeyInput,
        });
        await setLitellmApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
        hasCredential = true;
      }
    }
    if (hasCredential) {
      nextConfig = applyAuthProfileConfig(nextConfig, {
        profileId,
        provider: "litellm",
        mode: "api_key",
      });
    }

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: LITELLM_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyLitellmConfig,
      applyProviderConfig: applyLitellmProviderConfig,
      noteDefault: LITELLM_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "ai-gateway-api-key") {
    let hasCredential = false;

    if (
      !hasCredential &&
      args.params.opts?.token &&
      args.params.opts?.tokenProvider === "vercel-ai-gateway"
    ) {
      await setVercelAiGatewayApiKey(
        normalizeApiKeyInput(args.params.opts.token),
        args.params.agentDir,
      );
      hasCredential = true;
    }

    const envKey = resolveEnvApiKey("vercel-ai-gateway");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing AI_GATEWAY_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setVercelAiGatewayApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }

    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter Vercel AI Gateway API key",
        validate: validateApiKeyInput,
      });
      await setVercelAiGatewayApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "vercel-ai-gateway:default",
      provider: "vercel-ai-gateway",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyVercelAiGatewayConfig,
      applyProviderConfig: applyVercelAiGatewayProviderConfig,
      noteDefault: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "cloudflare-ai-gateway-api-key") {
    let hasCredential = false;
    let accountId = args.params.opts?.cloudflareAiGatewayAccountId?.trim() ?? "";
    let gatewayId = args.params.opts?.cloudflareAiGatewayGatewayId?.trim() ?? "";

    const ensureAccountGateway = async () => {
      if (!accountId) {
        const value = await args.params.prompter.text({
          message: "Enter Cloudflare Account ID",
          validate: (val) => (String(val ?? "").trim() ? undefined : "Account ID is required"),
        });
        accountId = String(value ?? "").trim();
      }
      if (!gatewayId) {
        const value = await args.params.prompter.text({
          message: "Enter Cloudflare AI Gateway ID",
          validate: (val) => (String(val ?? "").trim() ? undefined : "Gateway ID is required"),
        });
        gatewayId = String(value ?? "").trim();
      }
    };

    const optsApiKey = normalizeApiKeyInput(args.params.opts?.cloudflareAiGatewayApiKey ?? "");
    if (!hasCredential && accountId && gatewayId && optsApiKey) {
      await setCloudflareAiGatewayConfig(accountId, gatewayId, optsApiKey, args.params.agentDir);
      hasCredential = true;
    }

    const envKey = resolveEnvApiKey("cloudflare-ai-gateway");
    if (!hasCredential && envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing CLOUDFLARE_AI_GATEWAY_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await ensureAccountGateway();
        await setCloudflareAiGatewayConfig(
          accountId,
          gatewayId,
          normalizeApiKeyInput(envKey.apiKey),
          args.params.agentDir,
        );
        hasCredential = true;
      }
    }

    if (!hasCredential && optsApiKey) {
      await ensureAccountGateway();
      await setCloudflareAiGatewayConfig(accountId, gatewayId, optsApiKey, args.params.agentDir);
      hasCredential = true;
    }

    if (!hasCredential) {
      await ensureAccountGateway();
      const key = await args.params.prompter.text({
        message: "Enter Cloudflare AI Gateway API key",
        validate: validateApiKeyInput,
      });
      await setCloudflareAiGatewayConfig(
        accountId,
        gatewayId,
        normalizeApiKeyInput(String(key ?? "")),
        args.params.agentDir,
      );
      hasCredential = true;
    }

    if (hasCredential) {
      nextConfig = applyAuthProfileConfig(nextConfig, {
        profileId: "cloudflare-ai-gateway:default",
        provider: "cloudflare-ai-gateway",
        mode: "api_key",
      });
    }

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
      applyDefaultConfig: (cfg) =>
        applyCloudflareAiGatewayConfig(cfg, {
          accountId: accountId || args.params.opts?.cloudflareAiGatewayAccountId,
          gatewayId: gatewayId || args.params.opts?.cloudflareAiGatewayGatewayId,
        }),
      applyProviderConfig: (cfg) =>
        applyCloudflareAiGatewayProviderConfig(cfg, {
          accountId: accountId || args.params.opts?.cloudflareAiGatewayAccountId,
          gatewayId: gatewayId || args.params.opts?.cloudflareAiGatewayGatewayId,
        }),
      noteDefault: CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "moonshot-api-key") {
    await args.ensureMoonshotApiKeyCredential("Enter Moonshot API key");
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "moonshot:default",
      provider: "moonshot",
      mode: "api_key",
    });
    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: MOONSHOT_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyMoonshotConfig,
      applyProviderConfig: applyMoonshotProviderConfig,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "moonshot-api-key-cn") {
    await args.ensureMoonshotApiKeyCredential("Enter Moonshot API key (.cn)");
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "moonshot:default",
      provider: "moonshot",
      mode: "api_key",
    });
    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: MOONSHOT_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyMoonshotConfigCn,
      applyProviderConfig: applyMoonshotProviderConfigCn,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  return unhandled(args);
}
