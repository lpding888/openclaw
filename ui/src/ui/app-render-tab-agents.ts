import type { TemplateResult } from "lit";
import type { AppViewState } from "./app-view-state.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import { loadAgents } from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import {
  loadConfig,
  removeConfigFormValue,
  saveConfig,
  updateConfigFormValue,
} from "./controllers/config.ts";
import { renderAgents } from "./views/agents.ts";

function resolveAgentList(configValue: Record<string, unknown> | null): unknown[] | null {
  const list = (configValue as { agents?: { list?: unknown[] } } | null)?.agents?.list;
  return Array.isArray(list) ? list : null;
}

function resolveAgentIndex(list: unknown[] | null, agentId: string): number {
  if (!list) {
    return -1;
  }
  return list.findIndex(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "id" in entry &&
      (entry as { id?: string }).id === agentId,
  );
}

export function renderAgentsTab(state: AppViewState): TemplateResult {
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const resolvedAgentId =
    state.agentsSelectedId?.trim() ||
    state.agentsList?.defaultId ||
    state.agentsList?.agents?.[0]?.id ||
    null;

  return renderAgents({
    loading: state.agentsLoading,
    error: state.agentsError,
    agentsList: state.agentsList,
    selectedAgentId: resolvedAgentId,
    activePanel: state.agentsPanel,
    configForm: configValue,
    configLoading: state.configLoading,
    configSaving: state.configSaving,
    configDirty: state.configFormDirty,
    channelsLoading: state.channelsLoading,
    channelsError: state.channelsError,
    channelsSnapshot: state.channelsSnapshot,
    channelsLastSuccess: state.channelsLastSuccess,
    cronLoading: state.cronLoading,
    cronStatus: state.cronStatus,
    cronJobs: state.cronJobs,
    cronError: state.cronError,
    agentFilesLoading: state.agentFilesLoading,
    agentFilesError: state.agentFilesError,
    agentFilesList: state.agentFilesList,
    agentFileActive: state.agentFileActive,
    agentFileContents: state.agentFileContents,
    agentFileDrafts: state.agentFileDrafts,
    agentFileSaving: state.agentFileSaving,
    agentIdentityLoading: state.agentIdentityLoading,
    agentIdentityError: state.agentIdentityError,
    agentIdentityById: state.agentIdentityById,
    agentSkillsLoading: state.agentSkillsLoading,
    agentSkillsReport: state.agentSkillsReport,
    agentSkillsError: state.agentSkillsError,
    agentSkillsAgentId: state.agentSkillsAgentId,
    skillsFilter: state.skillsFilter,
    onRefresh: async () => {
      await loadAgents(state);
      const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
      if (agentIds.length > 0) {
        void loadAgentIdentities(state, agentIds);
      }
    },
    onSelectAgent: (agentId) => {
      if (state.agentsSelectedId === agentId) {
        return;
      }
      state.agentsSelectedId = agentId;
      state.agentFilesList = null;
      state.agentFilesError = null;
      state.agentFilesLoading = false;
      state.agentFileActive = null;
      state.agentFileContents = {};
      state.agentFileDrafts = {};
      state.agentSkillsReport = null;
      state.agentSkillsError = null;
      state.agentSkillsAgentId = null;
      void loadAgentIdentity(state, agentId);
      if (state.agentsPanel === "files") {
        void loadAgentFiles(state, agentId);
      }
      if (state.agentsPanel === "skills") {
        void loadAgentSkills(state, agentId);
      }
    },
    onSelectPanel: (panel) => {
      state.agentsPanel = panel;
      if (panel === "files" && resolvedAgentId) {
        if (state.agentFilesList?.agentId !== resolvedAgentId) {
          state.agentFilesList = null;
          state.agentFilesError = null;
          state.agentFileActive = null;
          state.agentFileContents = {};
          state.agentFileDrafts = {};
          void loadAgentFiles(state, resolvedAgentId);
        }
      }
      if (panel === "skills" && resolvedAgentId) {
        void loadAgentSkills(state, resolvedAgentId);
      }
      if (panel === "channels") {
        void loadChannels(state, false);
      }
      if (panel === "cron") {
        void state.loadCron();
      }
    },
    onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
    onSelectFile: (name) => {
      state.agentFileActive = name;
      if (!resolvedAgentId) {
        return;
      }
      void loadAgentFileContent(state, resolvedAgentId, name);
    },
    onFileDraftChange: (name, content) => {
      state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
    },
    onFileReset: (name) => {
      const base = state.agentFileContents[name] ?? "";
      state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
    },
    onFileSave: (name) => {
      if (!resolvedAgentId) {
        return;
      }
      const content = state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
      void saveAgentFile(state, resolvedAgentId, name, content);
    },
    onToolsProfileChange: (agentId, profile, clearAllow) => {
      const list = resolveAgentList(configValue);
      const index = resolveAgentIndex(list, agentId);
      if (index < 0) {
        return;
      }
      const basePath = ["agents", "list", index, "tools"];
      if (profile) {
        updateConfigFormValue(state, [...basePath, "profile"], profile);
      } else {
        removeConfigFormValue(state, [...basePath, "profile"]);
      }
      if (clearAllow) {
        removeConfigFormValue(state, [...basePath, "allow"]);
      }
    },
    onToolsOverridesChange: (agentId, alsoAllow, deny) => {
      const list = resolveAgentList(configValue);
      const index = resolveAgentIndex(list, agentId);
      if (index < 0) {
        return;
      }
      const basePath = ["agents", "list", index, "tools"];
      if (alsoAllow.length > 0) {
        updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
      } else {
        removeConfigFormValue(state, [...basePath, "alsoAllow"]);
      }
      if (deny.length > 0) {
        updateConfigFormValue(state, [...basePath, "deny"], deny);
      } else {
        removeConfigFormValue(state, [...basePath, "deny"]);
      }
    },
    onConfigReload: () => loadConfig(state),
    onConfigSave: () => saveConfig(state),
    onChannelsRefresh: () => loadChannels(state, false),
    onCronRefresh: () => state.loadCron(),
    onSkillsFilterChange: (next) => (state.skillsFilter = next),
    onSkillsRefresh: () => {
      if (resolvedAgentId) {
        void loadAgentSkills(state, resolvedAgentId);
      }
    },
    onAgentSkillToggle: (agentId, skillName, enabled) => {
      const list = resolveAgentList(configValue);
      const index = resolveAgentIndex(list, agentId);
      if (index < 0) {
        return;
      }
      const entry = list?.[index] as { skills?: unknown };
      const normalizedSkill = skillName.trim();
      if (!normalizedSkill) {
        return;
      }
      const allSkills =
        state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ?? [];
      const existing = Array.isArray(entry.skills)
        ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
        : undefined;
      const base = existing ?? allSkills;
      const next = new Set(base);
      if (enabled) {
        next.add(normalizedSkill);
      } else {
        next.delete(normalizedSkill);
      }
      updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
    },
    onAgentSkillsClear: (agentId) => {
      const list = resolveAgentList(configValue);
      const index = resolveAgentIndex(list, agentId);
      if (index < 0) {
        return;
      }
      removeConfigFormValue(state, ["agents", "list", index, "skills"]);
    },
    onAgentSkillsDisableAll: (agentId) => {
      const list = resolveAgentList(configValue);
      const index = resolveAgentIndex(list, agentId);
      if (index < 0) {
        return;
      }
      updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
    },
    onModelChange: (agentId, modelId) => {
      const list = resolveAgentList(configValue);
      const index = resolveAgentIndex(list, agentId);
      if (index < 0) {
        return;
      }
      const basePath = ["agents", "list", index, "model"];
      if (!modelId) {
        removeConfigFormValue(state, basePath);
        return;
      }
      const entry = (list?.[index] ?? {}) as { model?: unknown };
      const existing = entry?.model;
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
        const next = {
          primary: modelId,
          ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
        };
        updateConfigFormValue(state, basePath, next);
      } else {
        updateConfigFormValue(state, basePath, modelId);
      }
    },
    onModelFallbacksChange: (agentId, fallbacks) => {
      const list = resolveAgentList(configValue);
      const index = resolveAgentIndex(list, agentId);
      if (index < 0) {
        return;
      }
      const basePath = ["agents", "list", index, "model"];
      const entry = (list?.[index] ?? {}) as { model?: unknown };
      const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
      const existing = entry.model;
      const resolvePrimary = () => {
        if (typeof existing === "string") {
          return existing.trim() || null;
        }
        if (existing && typeof existing === "object" && !Array.isArray(existing)) {
          const primary = (existing as { primary?: unknown }).primary;
          if (typeof primary === "string") {
            const trimmed = primary.trim();
            return trimmed || null;
          }
        }
        return null;
      };
      const primary = resolvePrimary();
      if (normalized.length === 0) {
        if (primary) {
          updateConfigFormValue(state, basePath, primary);
        } else {
          removeConfigFormValue(state, basePath);
        }
        return;
      }
      const next = primary ? { primary, fallbacks: normalized } : { fallbacks: normalized };
      updateConfigFormValue(state, basePath, next);
    },
  });
}
