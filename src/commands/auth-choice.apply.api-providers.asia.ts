import type {
  ApiProviderHandlerArgs,
  ApiProviderHandlerResult,
} from "./auth-choice.apply.api-providers.types.js";
import { resolveEnvApiKey } from "../agents/model-auth.js";
import {
  formatApiKeyPreview,
  normalizeApiKeyInput,
  validateApiKeyInput,
} from "./auth-choice.api-key.js";
import { applyDefaultModelChoice } from "./auth-choice.default-model.js";
import {
  applyGoogleGeminiModelDefault,
  GOOGLE_GEMINI_DEFAULT_MODEL,
} from "./google-gemini-model-default.js";
import {
  applyAuthProfileConfig,
  applyQianfanConfig,
  applyQianfanProviderConfig,
  applyKimiCodeConfig,
  applyKimiCodeProviderConfig,
  applyXiaomiConfig,
  applyXiaomiProviderConfig,
  applyZaiConfig,
  applyZaiProviderConfig,
  KIMI_CODING_MODEL_REF,
  QIANFAN_DEFAULT_MODEL_REF,
  XIAOMI_DEFAULT_MODEL_REF,
  setQianfanApiKey,
  setGeminiApiKey,
  setKimiCodingApiKey,
  setXiaomiApiKey,
  setZaiApiKey,
  ZAI_DEFAULT_MODEL_REF,
} from "./onboard-auth.js";
import { detectZaiEndpoint } from "./zai-endpoint-detect.js";

function unhandled(args: ApiProviderHandlerArgs): ApiProviderHandlerResult {
  return {
    handled: false,
    config: args.config,
    agentModelOverride: args.agentModelOverride,
  };
}

export async function handleAsiaApiProviders(
  args: ApiProviderHandlerArgs,
): Promise<ApiProviderHandlerResult> {
  let nextConfig = args.config;
  let agentModelOverride = args.agentModelOverride;

  if (args.authChoice === "kimi-code-api-key") {
    let hasCredential = false;
    const tokenProvider = args.params.opts?.tokenProvider?.trim().toLowerCase();
    if (
      !hasCredential &&
      args.params.opts?.token &&
      (tokenProvider === "kimi-code" || tokenProvider === "kimi-coding")
    ) {
      await setKimiCodingApiKey(normalizeApiKeyInput(args.params.opts.token), args.params.agentDir);
      hasCredential = true;
    }

    if (!hasCredential) {
      await args.params.prompter.note(
        [
          "Kimi Coding uses a dedicated endpoint and API key.",
          "Get your API key at: https://www.kimi.com/code/en",
        ].join("\n"),
        "Kimi Coding",
      );
    }

    const envKey = resolveEnvApiKey("kimi-coding");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing KIMI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setKimiCodingApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter Kimi Coding API key",
        validate: validateApiKeyInput,
      });
      await setKimiCodingApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "kimi-coding:default",
      provider: "kimi-coding",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: KIMI_CODING_MODEL_REF,
      applyDefaultConfig: applyKimiCodeConfig,
      applyProviderConfig: applyKimiCodeProviderConfig,
      noteDefault: KIMI_CODING_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "gemini-api-key") {
    let hasCredential = false;

    if (!hasCredential && args.params.opts?.token && args.params.opts?.tokenProvider === "google") {
      await setGeminiApiKey(normalizeApiKeyInput(args.params.opts.token), args.params.agentDir);
      hasCredential = true;
    }

    const envKey = resolveEnvApiKey("google");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing GEMINI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setGeminiApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter Gemini API key",
        validate: validateApiKeyInput,
      });
      await setGeminiApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "google:default",
      provider: "google",
      mode: "api_key",
    });

    if (args.params.setDefaultModel) {
      const applied = applyGoogleGeminiModelDefault(nextConfig);
      nextConfig = applied.next;
      if (applied.changed) {
        await args.params.prompter.note(
          `Default model set to ${GOOGLE_GEMINI_DEFAULT_MODEL}`,
          "Model configured",
        );
      }
    } else {
      agentModelOverride = GOOGLE_GEMINI_DEFAULT_MODEL;
      await args.noteAgentModel(GOOGLE_GEMINI_DEFAULT_MODEL);
    }

    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (
    args.authChoice === "zai-api-key" ||
    args.authChoice === "zai-coding-global" ||
    args.authChoice === "zai-coding-cn" ||
    args.authChoice === "zai-global" ||
    args.authChoice === "zai-cn"
  ) {
    let endpoint: "global" | "cn" | "coding-global" | "coding-cn" | undefined;
    if (args.authChoice === "zai-coding-global") {
      endpoint = "coding-global";
    } else if (args.authChoice === "zai-coding-cn") {
      endpoint = "coding-cn";
    } else if (args.authChoice === "zai-global") {
      endpoint = "global";
    } else if (args.authChoice === "zai-cn") {
      endpoint = "cn";
    }

    let hasCredential = false;
    let apiKey = "";

    if (!hasCredential && args.params.opts?.token && args.params.opts?.tokenProvider === "zai") {
      apiKey = normalizeApiKeyInput(args.params.opts.token);
      await setZaiApiKey(apiKey, args.params.agentDir);
      hasCredential = true;
    }

    const envKey = resolveEnvApiKey("zai");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing ZAI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        apiKey = envKey.apiKey;
        await setZaiApiKey(apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter Z.AI API key",
        validate: validateApiKeyInput,
      });
      apiKey = normalizeApiKeyInput(String(key ?? ""));
      await setZaiApiKey(apiKey, args.params.agentDir);
    }

    let modelIdOverride: string | undefined;
    if (!endpoint) {
      const detected = await detectZaiEndpoint({ apiKey });
      if (detected) {
        endpoint = detected.endpoint;
        modelIdOverride = detected.modelId;
        await args.params.prompter.note(detected.note, "Z.AI endpoint");
      } else {
        endpoint = await args.params.prompter.select({
          message: "Select Z.AI endpoint",
          options: [
            {
              value: "coding-global",
              label: "Coding-Plan-Global",
              hint: "GLM Coding Plan Global (api.z.ai)",
            },
            {
              value: "coding-cn",
              label: "Coding-Plan-CN",
              hint: "GLM Coding Plan CN (open.bigmodel.cn)",
            },
            {
              value: "global",
              label: "Global",
              hint: "Z.AI Global (api.z.ai)",
            },
            {
              value: "cn",
              label: "CN",
              hint: "Z.AI CN (open.bigmodel.cn)",
            },
          ],
          initialValue: "global",
        });
      }
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "zai:default",
      provider: "zai",
      mode: "api_key",
    });

    const defaultModel = modelIdOverride ? `zai/${modelIdOverride}` : ZAI_DEFAULT_MODEL_REF;
    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel,
      applyDefaultConfig: (config) =>
        applyZaiConfig(config, {
          endpoint,
          ...(modelIdOverride ? { modelId: modelIdOverride } : {}),
        }),
      applyProviderConfig: (config) =>
        applyZaiProviderConfig(config, {
          endpoint,
          ...(modelIdOverride ? { modelId: modelIdOverride } : {}),
        }),
      noteDefault: defaultModel,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "xiaomi-api-key") {
    let hasCredential = false;

    if (!hasCredential && args.params.opts?.token && args.params.opts?.tokenProvider === "xiaomi") {
      await setXiaomiApiKey(normalizeApiKeyInput(args.params.opts.token), args.params.agentDir);
      hasCredential = true;
    }

    const envKey = resolveEnvApiKey("xiaomi");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing XIAOMI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setXiaomiApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter Xiaomi API key",
        validate: validateApiKeyInput,
      });
      await setXiaomiApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "xiaomi:default",
      provider: "xiaomi",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: XIAOMI_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyXiaomiConfig,
      applyProviderConfig: applyXiaomiProviderConfig,
      noteDefault: XIAOMI_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  if (args.authChoice === "qianfan-api-key") {
    let hasCredential = false;
    if (
      !hasCredential &&
      args.params.opts?.token &&
      args.params.opts?.tokenProvider === "qianfan"
    ) {
      setQianfanApiKey(normalizeApiKeyInput(args.params.opts.token), args.params.agentDir);
      hasCredential = true;
    }

    if (!hasCredential) {
      await args.params.prompter.note(
        [
          "Get your API key at: https://console.bce.baidu.com/qianfan/ais/console/apiKey",
          "API key format: bce-v3/ALTAK-...",
        ].join("\n"),
        "QIANFAN",
      );
    }

    const envKey = resolveEnvApiKey("qianfan");
    if (envKey) {
      const useExisting = await args.params.prompter.confirm({
        message: `Use existing QIANFAN_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        setQianfanApiKey(envKey.apiKey, args.params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await args.params.prompter.text({
        message: "Enter QIANFAN API key",
        validate: validateApiKeyInput,
      });
      setQianfanApiKey(normalizeApiKeyInput(String(key ?? "")), args.params.agentDir);
    }

    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "qianfan:default",
      provider: "qianfan",
      mode: "api_key",
    });

    const applied = await applyDefaultModelChoice({
      config: nextConfig,
      setDefaultModel: args.params.setDefaultModel,
      defaultModel: QIANFAN_DEFAULT_MODEL_REF,
      applyDefaultConfig: applyQianfanConfig,
      applyProviderConfig: applyQianfanProviderConfig,
      noteDefault: QIANFAN_DEFAULT_MODEL_REF,
      noteAgentModel: args.noteAgentModel,
      prompter: args.params.prompter,
    });
    nextConfig = applied.config;
    agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    return { handled: true, config: nextConfig, agentModelOverride };
  }

  return unhandled(args);
}
