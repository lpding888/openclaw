import type { TemplateResult } from "lit";

import type { AppViewState } from "./app-view-state";
import type { Tab } from "./navigation";
import { renderChannels } from "./views/channels";
import { renderCron } from "./views/cron";
import { renderDebug } from "./views/debug";
import { renderInstances } from "./views/instances";
import { renderLogs } from "./views/logs";
import { renderOverview } from "./views/overview";
import { renderSessions } from "./views/sessions";
import { renderSkills } from "./views/skills";
import { loadChannels } from "./controllers/channels";
import { loadPresence } from "./controllers/presence";
import { deleteSession, loadSessions, patchSession } from "./controllers/sessions";
import { installSkill, loadSkills, saveSkillApiKey, updateSkillEdit, updateSkillEnabled } from "./controllers/skills";
import { applyGatewayAuthProfile, loadConfig, updateConfigFormValue } from "./controllers/config";
import { loadCronRuns, toggleCronJob, runCronJob, removeCronJob, addCronJob } from "./controllers/cron";
import { loadDebug, callDebugMethod } from "./controllers/debug";
import { loadLogs } from "./controllers/logs";
import { renderChatTab } from "./app-render-tab-chat";
import { renderConfigTab } from "./app-render-tab-config";
import { renderNodesTab } from "./app-render-tab-nodes";

export type RenderMainContentOptions = {
  presenceCount: number;
  sessionsCount: number | null;
  cronNext: number | null;
  chatDisabledReason: string | null;
  showThinking: boolean;
  chatFocus: boolean;
  chatAvatarUrl: string | null;
  serverAuthMode: "token" | "password" | null;
  serverAllowInsecureAuth: boolean | null;
};

type TabRenderer = (
  state: AppViewState,
  options: RenderMainContentOptions,
) => TemplateResult;

function renderOverviewTab(state: AppViewState, options: RenderMainContentOptions): TemplateResult {
  return renderOverview({
    connected: state.connected,
    hello: state.hello,
    settings: state.settings,
    password: state.password,
    serverAuthMode: options.serverAuthMode,
    serverAllowInsecureAuth: options.serverAllowInsecureAuth,
    authApplying: state.configApplying,
    lastError: state.lastError,
    presenceCount: options.presenceCount,
    sessionsCount: options.sessionsCount,
    cronEnabled: state.cronStatus?.enabled ?? null,
    cronNext: options.cronNext,
    lastChannelsRefresh: state.channelsLastSuccess,
    onSettingsChange: (next) => state.applySettings(next),
    onPasswordChange: (next) => (state.password = next),
    onSessionKeyChange: (next) => {
      state.sessionKey = next;
      state.chatMessage = "";
      state.resetToolStream();
      state.applySettings({
        ...state.settings,
        sessionKey: next,
        lastActiveSessionKey: next,
      });
      void state.loadAssistantIdentity();
    },
    onConnect: () => state.connect(),
    onRefresh: () => {
      void Promise.all([state.loadOverview(), loadConfig(state)]);
    },
    onApplyServerPasswordAuth: () =>
      applyGatewayAuthProfile(state, {
        mode: "password",
        password: state.password,
        allowInsecureControlUi: true,
      }),
    onApplyServerTokenAuth: () =>
      applyGatewayAuthProfile(state, {
        mode: "token",
        token: state.settings.token,
        allowInsecureControlUi: true,
      }),
  });
}

function renderChannelsTab(state: AppViewState): TemplateResult {
  return renderChannels({
    connected: state.connected,
    loading: state.channelsLoading,
    snapshot: state.channelsSnapshot,
    lastError: state.channelsError,
    lastSuccessAt: state.channelsLastSuccess,
    whatsappMessage: state.whatsappLoginMessage,
    whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
    whatsappConnected: state.whatsappLoginConnected,
    whatsappBusy: state.whatsappBusy,
    configSchema: state.configSchema,
    configSchemaLoading: state.configSchemaLoading,
    configForm: state.configForm,
    configUiHints: state.configUiHints,
    configSaving: state.configSaving,
    configFormDirty: state.configFormDirty,
    nostrProfileFormState: state.nostrProfileFormState,
    nostrProfileAccountId: state.nostrProfileAccountId,
    onRefresh: (probe) => loadChannels(state, probe),
    onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
    onWhatsAppWait: () => state.handleWhatsAppWait(),
    onWhatsAppLogout: () => state.handleWhatsAppLogout(),
    onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
    onConfigSave: () => state.handleChannelConfigSave(),
    onConfigReload: () => state.handleChannelConfigReload(),
    onNostrProfileEdit: (accountId, profile) =>
      state.handleNostrProfileEdit(accountId, profile),
    onNostrProfileCancel: () => state.handleNostrProfileCancel(),
    onNostrProfileFieldChange: (field, value) =>
      state.handleNostrProfileFieldChange(field, value),
    onNostrProfileSave: () => state.handleNostrProfileSave(),
    onNostrProfileImport: () => state.handleNostrProfileImport(),
    onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
  });
}

function renderInstancesTab(state: AppViewState): TemplateResult {
  return renderInstances({
    loading: state.presenceLoading,
    entries: state.presenceEntries,
    lastError: state.presenceError,
    statusMessage: state.presenceStatus,
    onRefresh: () => loadPresence(state),
  });
}

function renderSessionsTab(state: AppViewState): TemplateResult {
  return renderSessions({
    loading: state.sessionsLoading,
    result: state.sessionsResult,
    error: state.sessionsError,
    activeMinutes: state.sessionsFilterActive,
    limit: state.sessionsFilterLimit,
    includeGlobal: state.sessionsIncludeGlobal,
    includeUnknown: state.sessionsIncludeUnknown,
    basePath: state.basePath,
    onFiltersChange: (next) => {
      state.sessionsFilterActive = next.activeMinutes;
      state.sessionsFilterLimit = next.limit;
      state.sessionsIncludeGlobal = next.includeGlobal;
      state.sessionsIncludeUnknown = next.includeUnknown;
    },
    onRefresh: () => loadSessions(state),
    onPatch: (key, patch) => patchSession(state, key, patch),
    onDelete: (key) => deleteSession(state, key),
  });
}

function renderCronTab(state: AppViewState): TemplateResult {
  return renderCron({
    loading: state.cronLoading,
    status: state.cronStatus,
    jobs: state.cronJobs,
    error: state.cronError,
    busy: state.cronBusy,
    form: state.cronForm,
    channels: state.channelsSnapshot?.channelMeta?.length
      ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
      : state.channelsSnapshot?.channelOrder ?? [],
    channelLabels: state.channelsSnapshot?.channelLabels ?? {},
    channelMeta: state.channelsSnapshot?.channelMeta ?? [],
    runsJobId: state.cronRunsJobId,
    runs: state.cronRuns,
    onFormChange: (patch) => (state.cronForm = { ...state.cronForm, ...patch }),
    onRefresh: () => state.loadCron(),
    onAdd: () => addCronJob(state),
    onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
    onRun: (job) => runCronJob(state, job),
    onRemove: (job) => removeCronJob(state, job),
    onLoadRuns: (jobId) => loadCronRuns(state, jobId),
  });
}

function renderSkillsTab(state: AppViewState): TemplateResult {
  return renderSkills({
    loading: state.skillsLoading,
    report: state.skillsReport,
    error: state.skillsError,
    filter: state.skillsFilter,
    edits: state.skillEdits,
    messages: state.skillMessages,
    busyKey: state.skillsBusyKey,
    onFilterChange: (next) => (state.skillsFilter = next),
    onRefresh: () => loadSkills(state, { clearMessages: true }),
    onToggle: (key, enabled) => updateSkillEnabled(state, key, enabled),
    onEdit: (key, value) => updateSkillEdit(state, key, value),
    onSaveKey: (key) => saveSkillApiKey(state, key),
    onInstall: (skillKey, name, installId) => installSkill(state, skillKey, name, installId),
  });
}

function renderDebugTab(state: AppViewState): TemplateResult {
  return renderDebug({
    loading: state.debugLoading,
    status: state.debugStatus,
    health: state.debugHealth,
    models: state.debugModels,
    heartbeat: state.debugHeartbeat,
    eventLog: state.eventLog,
    callMethod: state.debugCallMethod,
    callParams: state.debugCallParams,
    callResult: state.debugCallResult,
    callError: state.debugCallError,
    onCallMethodChange: (next) => (state.debugCallMethod = next),
    onCallParamsChange: (next) => (state.debugCallParams = next),
    onRefresh: () => loadDebug(state),
    onCall: () => callDebugMethod(state),
  });
}

function renderLogsTab(state: AppViewState): TemplateResult {
  return renderLogs({
    loading: state.logsLoading,
    error: state.logsError,
    file: state.logsFile,
    entries: state.logsEntries,
    filterText: state.logsFilterText,
    levelFilters: state.logsLevelFilters,
    autoFollow: state.logsAutoFollow,
    truncated: state.logsTruncated,
    onFilterTextChange: (next) => (state.logsFilterText = next),
    onLevelToggle: (level, enabled) => {
      state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
    },
    onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
    onRefresh: () => loadLogs(state, { reset: true }),
    onExport: (lines, label) => state.exportLogs(lines, label),
    onScroll: (event) => state.handleLogsScroll(event),
  });
}

// Single dispatch table for tab rendering to avoid long conditional chains.
const TAB_RENDERERS: Record<Tab, TabRenderer> = {
  overview: renderOverviewTab,
  channels: (state) => renderChannelsTab(state),
  instances: (state) => renderInstancesTab(state),
  sessions: (state) => renderSessionsTab(state),
  cron: (state) => renderCronTab(state),
  skills: (state) => renderSkillsTab(state),
  nodes: (state) => renderNodesTab(state),
  chat: renderChatTab,
  config: (state) => renderConfigTab(state),
  debug: (state) => renderDebugTab(state),
  logs: (state) => renderLogsTab(state),
};

export function renderMainContent(state: AppViewState, options: RenderMainContentOptions) {
  return TAB_RENDERERS[state.tab](state, options);
}
