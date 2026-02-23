import { resolveEnvApiKey } from "../agents/model-auth.js";
import {
  formatApiKeyPreview,
  normalizeApiKeyInput,
  validateApiKeyInput,
} from "./auth-choice.api-key.js";
import type {
  ApiProviderHandlerArgs,
  ApiProviderHandlerResult,
} from "./auth-choice.apply.api-providers.types.js";
import { applyAuthChoiceHuggingface } from "./auth-choice.apply.huggingface.js";
import { applyDefaultModelChoice } from "./auth-choice.default-model.js";
import {
  applyAuthProfileConfig,
  applyOpencodeZenConfig,
  applyOpencodeZenProviderConfig,
  applySyntheticConfig,
  applySyntheticProviderConfig,
  applyTogetherConfig,
  applyTogetherProviderConfig,
  applyVeniceConfig,
  applyVeniceProviderConfig,
  setOpencodeZenApiKey,
  setSyntheticApiKey,
  setTogetherApiKey,
  setVeniceApiKey,
  SYNTHETIC_DEFAULT_MODEL_REF,
  TOGETHER_DEFAULT_MODEL_REF,
  VENICE_DEFAULT_MODEL_REF,
} from "./onboard-auth.js";
import { OPENCODE_ZEN_DEFAULT_MODEL } from "./opencode-zen-model-default.js";

function unhandled(args: ApiProviderHandlerArgs): ApiProviderHandlerResult {
  return {
    handled: false,
    config: args.config,
    agentModelOverride: args.agentModelOverride,
  };
}

export async function handleOpenModelApiProviders(
  args: ApiProviderHandlerArgs,
): Promise<ApiProviderHandlerResult> {
  let nextConfig = args.config;
  let agentModelOverride = args.agentModelOverride;

  if (args.authChoice === "synthetic-api-key") {
    if (args.params.opts?.token && args.params.opts?.tokenProvider === "synthetic") {
      await setSyntheticApiKey(String(args.params.opts.token ?? "").trim(), args.params.agentDir);
    } else {
      const key = await args.params.prompter.text({
        message: "Enter Synthetic API key",
        validate: (value) => (value?.trim() ? undefined : "Required"),
      });
      await setSyntheticApiKey(String(key ?? "").trim(), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "synthetic:default",
      provider: "synthetic",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: SYNTHETIC_DEFAULT_MODEL_REF,
      applyDefaultConfig: applySyntheticConfig,
      applyProviderConfig: applySyntheticProviderConfig,
      noteDefault: SYNTHETIC_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "venice-api-key") {
    let hasCredential = false;

    if (!hasCredential && args.params.opts?.token && args.params.opts?.tokenProvider === "venice") {
      await setVeniceApiKey(normalizeApiKeyInput(args.params.opts.token), args.params.agentDir);
      hasCredential = true;
    }

    if (!hasCredential) {
      await args.params.prompter.note(
        [
          "Venice AI provides privacy-focused inference with uncensored models.",
          "Get your API key at: https://venice.ai/settings/api",
          "Supports 'private' (fully private) and 'anonymized' (proxy) modes.",
        ].join("\n"),
        "Venice AI",
      );
    }

    const envKey = resolveEnvApiKey("venice");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing VENICE_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setVeniceApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter Venice AI API key",
        validate: validateApiKeyInput,
      });
      await setVeniceApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "venice:default",
      provider: "venice",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: VENICE_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyVeniceConfig,
      applyProviderConfig: applyVeniceProviderConfig,
      noteDefault: VENICE_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "opencode-zen") {
    let hasCredential = false;
    if (
      !hasCredential &&
      args.params.opts?.token &&
      args.params.opts?.tokenProvider === "opencode"
    ) {
      await setOpencodeZenApiKey(
        normalizeApiKeyInput(args.params.opts.token),
        args.params.agentDir,
      );
      hasCredential = true;
    }

    if (!hasCredential) {
      await args.params.prompter.note(
        [
          "OpenCode Zen provides access to Claude, GPT, Gemini, and more models.",
          "Get your API key at: https://opencode.ai/auth",
          "OpenCode Zen bills per request. Check your OpenCode dashboard for details.",
        ].join("\n"),
        "OpenCode Zen",
      );
    }

    const envKey = resolveEnvApiKey("opencode");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing OPENCODE_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setOpencodeZenApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter OpenCode Zen API key",
        validate: validateApiKeyInput,
      });
      await setOpencodeZenApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "opencode:default",
      provider: "opencode",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: OPENCODE_ZEN_DEFAULT_MODEL,
      applyDefaultConfig: applyOpencodeZenConfig,
      applyProviderConfig: applyOpencodeZenProviderConfig,
      noteDefault: OPENCODE_ZEN_DEFAULT_MODEL,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "together-api-key") {
    let hasCredential = false;

    if (
      !hasCredential &&
      args.params.opts?.token &&
      args.params.opts?.tokenProvider === "together"
    ) {
      await setTogetherApiKey(normalizeApiKeyInput(args.params.opts.token), args.params.agentDir);
      hasCredential = true;
    }

    if (!hasCredential) {
      await args.params.prompter.note(
        [
          "Together AI provides access to leading open-source models including Llama, DeepSeek, Qwen, and more.",
          "Get your API key at: https://api.together.xyz/settings/api-keys",
        ].join("\n"),
        "Together AI",
      );
    }

    const envKey = resolveEnvApiKey("together");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing TOGETHER_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setTogetherApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter Together AI API key",
        validate: validateApiKeyInput,
      });
      await setTogetherApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "together:default",
      provider: "together",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: TOGETHER_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyTogetherConfig,
      applyProviderConfig: applyTogetherProviderConfig,
      noteDefault: TOGETHER_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "huggingface-api-key") {
    const result = await applyAuthChoiceHuggingface({
      ...args.params,
      authChoice: args.authChoice,
      config: nextConfig,
    });
    return {
      handled: true,
      config: result?.config ?? nextConfig,
      agentModelOverride: result?.agentModelOverride ?? agentModelOverride,
    };
  }

  return unhandled(args);
}
