import type { OpenClawConfig } from "../config/config.js";
import type { ApplyAuthChoiceParams } from "./auth-choice.apply.js";

export type ApiProviderHandlerArgs = {
  authChoice: string;
  config: OpenClawConfig;
  agentModelOverride?: string;
  params: ApplyAuthChoiceParams;
  noteAgentModel: (model: string) => Promise<void>;
  ensureMoonshotApiKeyCredential: (promptMessage: string) => Promise<void>;
};

export type ApiProviderHandlerResult = {
  handled: boolean;
  config: OpenClawConfig;
  agentModelOverride?: string;
};
