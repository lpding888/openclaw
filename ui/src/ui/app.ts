import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { EventLogEntry } from "./app-events.ts";
import type { AppViewState } from "./app-view-state.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { ModelSwitcherOption } from "./controllers/model-switcher.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { ResolvedTheme, ThemeMode } from "./theme.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChatFeedbackDraft,
  ChatFeedbackItem,
  ChatTimelineEvent,
  ConfigSnapshot,
  ConfigUiHints,
  CostUsageSummary,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionsUsageResult,
  SessionUsageTimeSeries,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  NostrProfile,
  NodeSnapshot,
  ChatTimelineRunSummary,
  ChatTimelineFilterState,
} from "./types.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";
import type { SessionLogEntry, SessionLogRole } from "./views/usage.ts";
import {
  handleChannelConfigReload as handleChannelConfigReloadInternal,
  handleChannelConfigSave as handleChannelConfigSaveInternal,
  handleNostrProfileCancel as handleNostrProfileCancelInternal,
  handleNostrProfileEdit as handleNostrProfileEditInternal,
  handleNostrProfileFieldChange as handleNostrProfileFieldChangeInternal,
  handleNostrProfileImport as handleNostrProfileImportInternal,
  handleNostrProfileSave as handleNostrProfileSaveInternal,
  handleNostrProfileToggleAdvanced as handleNostrProfileToggleAdvancedInternal,
  handleWhatsAppLogout as handleWhatsAppLogoutInternal,
  handleWhatsAppStart as handleWhatsAppStartInternal,
  handleWhatsAppWait as handleWhatsAppWaitInternal,
} from "./app-channels.ts";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
} from "./app-chat.ts";
import { DEFAULT_CRON_FORM, DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults.ts";
import type { EventLogEntry } from "./app-events.ts";
import { connectGateway as connectGatewayInternal } from "./app-gateway.ts";
import {
  acceptPendingGatewayUrl as acceptPendingGatewayUrlInternal,
  handleCloseSidebar as handleCloseSidebarInternal,
  handleExecApprovalDecision as handleExecApprovalDecisionInternal,
  handleOpenSidebar as handleOpenSidebarInternal,
  handleSetSidebarTab as handleSetSidebarTabInternal,
  handleSplitRatioChange as handleSplitRatioChangeInternal,
  rejectPendingGatewayUrl as rejectPendingGatewayUrlInternal,
  type ExecApprovalDecision,
} from "./app-interactions.ts";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle.ts";
import { renderApp } from "./app-render.ts";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.ts";
import {
  applySettings as applySettingsInternal,
  loadCron as loadCronInternal,
  loadOverview as loadOverviewInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  onPopState as onPopStateInternal,
} from "./app-settings.ts";
import {
  resetToolStream as resetToolStreamInternal,
  type CompactionStatus,
  type ToolStreamEntry,
} from "./app-tool-stream.ts";
import type { AppViewState } from "./app-view-state.ts";
import { normalizeAssistantIdentity } from "./assistant-identity.ts";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { SkillMessage } from "./controllers/skills.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import { loadSettings, type UiSettings } from "./storage.ts";
import type { ResolvedTheme, ThemeMode } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ConfigSnapshot,
  ConfigUiHints,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  LogEntry,
  LogLevel,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  NostrProfile,
} from "./types.ts";
import { type ChatAttachment, type ChatQueueItem, type CronFormState } from "./ui-types.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";

declare global {
  interface Window {
    __CLAWDBOT_CONTROL_UI_BASE_PATH__?: string;
    __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
  }
}

const bootAssistantIdentity = normalizeAssistantIdentity({});

function resolveOnboardingMode(): boolean {
  if (!window.location.search) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("onboarding");
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

@customElement("openclaw-app")
export class OpenClawApp extends LitElement {
  private i18nController = new I18nController(this);
  @state() settings: UiSettings = loadSettings();
  constructor() {
    super();
    if (isSupportedLocale(this.settings.locale)) {
      void i18n.setLocale(this.settings.locale);
    }
  }
  @state() password = "";
  @state() tab: Tab = "chat";
  @state() onboarding = resolveOnboardingMode();
  @state() connected = false;
  @state() theme: ThemeMode = this.settings.theme ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() eventLog: EventLogEntry[] = [];
  private eventLogBuffer: EventLogEntry[] = [];
  private toolStreamSyncTimer: number | null = null;
  private sidebarCloseTimer: number | null = null;

  @state() assistantName = bootAssistantIdentity.name;
  @state() assistantAvatar = bootAssistantIdentity.avatar;
  @state() assistantAgentId = bootAssistantIdentity.agentId ?? null;

  // Security: Pending gateway URL from URL params, requires user confirmation.
  // See CVE: GHSA-g8p2-7wf7-98mq
  @state() pendingGatewayUrl: string | null = null;

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatToolMessages: unknown[] = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatRunId: string | null = null;
  @state() compactionStatus: CompactionStatus | null = null;
  @state() fallbackStatus: FallbackStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];
  @state() chatTimelineEvents: ChatTimelineEvent[] = [];
  @state() chatTimelineLoading = false;
  @state() chatTimelineError: string | null = null;
  @state() chatTimelineServerSupported = true;
  @state() chatTimelineRuns: ChatTimelineRunSummary[] = [];
  @state() chatTimelineRunsLoading = false;
  @state() chatTimelineRunsError: string | null = null;
  @state() chatTimelineRunsServerSupported = true;
  @state() chatFeedbackItems: ChatFeedbackItem[] = [];
  @state() chatFeedbackLoading = false;
  @state() chatFeedbackError: string | null = null;
  @state() chatFeedbackServerSupported = true;
  @state() chatFeedbackDrafts: Record<string, ChatFeedbackDraft> = {};
  @state() chatFeedbackSubmitting: Record<string, boolean> = {};
  @state() chatFeedbackSubmitErrors: Record<string, string | null> = {};
  @state() chatManualRefreshInFlight = false;
  @state() chatNewMessagesBelow = false;
  // Sidebar state for tool output viewing
  @state() sidebarOpen = true;
  @state() sidebarTab: "timeline" | "tool" | "insights" = this.settings.chatObservabilityPin;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() splitRatio = this.settings.splitRatio;
  @state() chatTimelineFollow = true;
  @state() chatTimelineFilters: ChatTimelineFilterState = {
    runId: "",
    streams: {},
  };

  @state() nodesLoading = false;
  @state() nodes: NodeSnapshot[] = [];
  @state() devicesLoading = false;
  @state() devicesError: string | null = null;
  @state() devicesList: DevicePairingList | null = null;
  @state() execApprovalsLoading = false;
  @state() execApprovalsSaving = false;
  @state() execApprovalsDirty = false;
  @state() execApprovalsSnapshot: ExecApprovalsSnapshot | null = null;
  @state() execApprovalsForm: ExecApprovalsFile | null = null;
  @state() execApprovalsSelectedAgent: string | null = null;
  @state() execApprovalsTarget: "gateway" | "node" = "gateway";
  @state() execApprovalsTargetNodeId: string | null = null;
  @state() execApprovalQueue: ExecApprovalRequest[] = [];
  @state() execApprovalBusy = false;
  @state() execApprovalError: string | null = null;

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configRawOriginal = "";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configApplying = false;
  @state() updateRunning = false;
  @state() applySessionKey = this.settings.lastActiveSessionKey;
  @state() configSnapshot: ConfigSnapshot | null = null;
  @state() configSchema: unknown = null;
  @state() configSchemaVersion: string | null = null;
  @state() configSchemaLoading = false;
  @state() configUiHints: ConfigUiHints = {};
  @state() configForm: Record<string, unknown> | null = null;
  @state() configFormOriginal: Record<string, unknown> | null = null;
  @state() configFormDirty = false;
  @state() configFormMode: "form" | "raw" = "form";
  @state() configSearchQuery = "";
  @state() configActiveSection: string | null = null;
  @state() configActiveSubsection: string | null = null;
  @state() modelSwitcherLoading = false;
  @state() modelSwitcherSaving = false;
  @state() modelSwitcherCurrent: string | null = null;
  @state() modelSwitcherSelected = "";
  @state() modelSwitcherOptions: ModelSwitcherOption[] = [];
  @state() modelSwitcherError: string | null = null;
  @state() modelSwitcherStatus: string | null = null;
  @state() modelSwitcherCompatMode = false;
  @state() modelSwitcherConfigHash: string | null = null;
  @state() modelSwitcherFallbacks: string[] = [];
  @state() modelCenterPrimary = "";
  @state() modelCenterFallbacksText = "";
  @state() modelCenterAllowCustom = false;
  @state() modelCenterSaving = false;
  @state() modelCenterError: string | null = null;
  @state() modelCenterStatus: string | null = null;
  @state() modelCenterQuery = "";

  @state() channelsLoading = false;
  @state() channelsSnapshot: ChannelsStatusSnapshot | null = null;
  @state() channelsError: string | null = null;
  @state() channelsLastSuccess: number | null = null;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappBusy = false;
  @state() nostrProfileFormState: NostrProfileFormState | null = null;
  @state() nostrProfileAccountId: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() agentsLoading = false;
  @state() agentsList: AgentsListResult | null = null;
  @state() agentsError: string | null = null;
  @state() agentsSelectedId: string | null = null;
  @state() agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron" =
    "overview";
  @state() agentFilesLoading = false;
  @state() agentFilesError: string | null = null;
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() agentFileContents: Record<string, string> = {};
  @state() agentFileDrafts: Record<string, string> = {};
  @state() agentFileActive: string | null = null;
  @state() agentFileSaving = false;
  @state() agentIdentityLoading = false;
  @state() agentIdentityError: string | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentSkillsLoading = false;
  @state() agentSkillsError: string | null = null;
  @state() agentSkillsReport: SkillStatusReport | null = null;
  @state() agentSkillsAgentId: string | null = null;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;

  @state() usageLoading = false;
  @state() usageResult: SessionsUsageResult | null = null;
  @state() usageCostSummary: CostUsageSummary | null = null;
  @state() usageError: string | null = null;
  @state() usageStartDate = "";
  @state() usageEndDate = "";
  @state() usageSelectedSessions: string[] = [];
  @state() usageSelectedDays: string[] = [];
  @state() usageSelectedHours: number[] = [];
  @state() usageChartMode: "tokens" | "cost" = "tokens";
  @state() usageDailyChartMode: "total" | "by-type" = "total";
  @state() usageTimeSeriesMode: "cumulative" | "per-turn" = "cumulative";
  @state() usageTimeSeriesBreakdownMode: "total" | "by-type" = "total";
  @state() usageTimeSeries: SessionUsageTimeSeries | null = null;
  @state() usageTimeSeriesLoading = false;
  @state() usageSessionLogs: SessionLogEntry[] | null = null;
  @state() usageSessionLogsLoading = false;
  @state() usageSessionLogsExpanded = false;
  @state() usageQuery = "";
  @state() usageQueryDraft = "";
  @state() usageQueryDebounceTimer: number | null = null;
  @state() usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors" = "tokens";
  @state() usageSessionSortDir: "asc" | "desc" = "desc";
  @state() usageRecentSessions: string[] = [];
  @state() usageTimeZone: "local" | "utc" = "local";
  @state() usageContextExpanded = false;
  @state() usageHeaderPinned = false;
  @state() usageSessionsTab: "all" | "recent" = "all";
  @state() usageVisibleColumns: string[] = [];
  @state() usageLogFilterRoles: SessionLogRole[] = [];
  @state() usageLogFilterTools: string[] = [];
  @state() usageLogFilterHasTools = false;
  @state() usageLogFilterQuery = "";

  @state() cronLoading = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronStatus: CronStatus | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronRunsJobId: string | null = null;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronBusy = false;

  @state() updateAvailable: import("./types.js").UpdateAvailable | null = null;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;
  @state() skillMessages: Record<string, SkillMessage> = {};

  @state() debugLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSnapshot | null = null;
  @state() debugModels: unknown[] = [];
  @state() debugHeartbeat: unknown = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  @state() logsLoading = false;
  @state() logsError: string | null = null;
  @state() logsFile: string | null = null;
  @state() logsEntries: LogEntry[] = [];
  @state() logsFilterText = "";
  @state() logsLevelFilters: Record<LogLevel, boolean> = {
    ...DEFAULT_LOG_LEVEL_FILTERS,
  };
  @state() logsAutoFollow = true;
  @state() logsTruncated = false;
  @state() logsCursor: number | null = null;
  @state() logsLastFetchAt: number | null = null;
  @state() logsLimit = 500;
  @state() logsMaxBytes = 250_000;
  @state() logsAtBottom = true;
  refreshSessionsAfterChat = new Set<string>();

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  private nodesPollInterval: number | null = null;
  private logsPollInterval: number | null = null;
  private debugPollInterval: number | null = null;
  private logsScrollFrame: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  basePath = "";
  private popStateHandler = () =>
    onPopStateInternal(this as unknown as Parameters<typeof onPopStateInternal>[0]);
  private themeMedia: MediaQueryList | null = null;
  private themeMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;
  private topbarObserver: ResizeObserver | null = null;

  private call<TArgs extends unknown[], TResult, THost>(
    fn: (host: THost, ...args: TArgs) => TResult,
    ...args: TArgs
  ): TResult {
    return fn(this as unknown as THost, ...args);
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    try {
      handleConnected(this as unknown as Parameters<typeof handleConnected>[0]);
    } catch (err) {
      console.error("[control-ui] startup failed:", err);
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  protected firstUpdated() {
    handleFirstUpdated(this as unknown as Parameters<typeof handleFirstUpdated>[0]);
  }

  disconnectedCallback() {
    handleDisconnected(this as unknown as Parameters<typeof handleDisconnected>[0]);
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    handleUpdated(this as unknown as Parameters<typeof handleUpdated>[0], changed);
  }

  connect() {
    this.call(connectGatewayInternal);
  }

  handleChatScroll(event: Event) {
    this.call(handleChatScrollInternal, event);
  }

  handleLogsScroll(event: Event) {
    this.call(handleLogsScrollInternal, event);
  }

  exportLogs(lines: string[], label: string) {
    exportLogsInternal(lines, label);
  }

  resetToolStream() {
    this.call(resetToolStreamInternal);
  }

  resetChatScroll() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
  }

  scrollToBottom(opts?: { smooth?: boolean }) {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
    scheduleChatScrollInternal(
      this as unknown as Parameters<typeof scheduleChatScrollInternal>[0],
      true,
      Boolean(opts?.smooth),
    );
  }

  async loadAssistantIdentity() {
    await this.call(loadAssistantIdentityInternal);
  }

  applySettings(next: UiSettings) {
    this.call(applySettingsInternal, next);
  }

  setTab(next: Tab) {
    this.call(setTabInternal, next);
  }

  setTheme(next: ThemeMode, context?: Parameters<typeof setThemeInternal>[2]) {
    this.call(setThemeInternal, next, context);
  }

  async loadOverview() {
    await this.call(loadOverviewInternal);
  }

  async loadCron() {
    await this.call(loadCronInternal);
  }

  async handleAbortChat() {
    await this.call(handleAbortChatInternal);
  }

  removeQueuedMessage(id: string) {
    this.call(removeQueuedMessageInternal, id);
  }

  async handleSendChat(
    messageOverride?: string,
    opts?: Parameters<typeof handleSendChatInternal>[2],
  ) {
    await this.call(handleSendChatInternal, messageOverride, opts);
  }

  async handleWhatsAppStart(force: boolean) {
    await this.call(handleWhatsAppStartInternal, force);
  }

  async handleWhatsAppWait() {
    await this.call(handleWhatsAppWaitInternal);
  }

  async handleWhatsAppLogout() {
    await this.call(handleWhatsAppLogoutInternal);
  }

  async handleChannelConfigSave() {
    await this.call(handleChannelConfigSaveInternal);
  }

  async handleChannelConfigReload() {
    await this.call(handleChannelConfigReloadInternal);
  }

  handleNostrProfileEdit(accountId: string, profile: NostrProfile | null) {
    this.call(handleNostrProfileEditInternal, accountId, profile);
  }

  handleNostrProfileCancel() {
    this.call(handleNostrProfileCancelInternal);
  }

  handleNostrProfileFieldChange(field: keyof NostrProfile, value: string) {
    this.call(handleNostrProfileFieldChangeInternal, field, value);
  }

  async handleNostrProfileSave() {
    await this.call(handleNostrProfileSaveInternal);
  }

  async handleNostrProfileImport() {
    await this.call(handleNostrProfileImportInternal);
  }

  handleNostrProfileToggleAdvanced() {
    this.call(handleNostrProfileToggleAdvancedInternal);
  }

  async handleExecApprovalDecision(decision: ExecApprovalDecision) {
    await this.call(handleExecApprovalDecisionInternal, decision);
  }

  handleOpenSidebar(content: string) {
    this.call(handleOpenSidebarInternal, content);
  }

  handleCloseSidebar() {
    this.call(handleCloseSidebarInternal);
  }

  handleSetSidebarTab(tab: "timeline" | "tool" | "insights") {
    this.call(handleSetSidebarTabInternal, tab);
  }

  handleSplitRatioChange(ratio: number) {
    this.call(handleSplitRatioChangeInternal, ratio);
  }

  acceptPendingGatewayUrl() {
    this.call(acceptPendingGatewayUrlInternal);
  }

  rejectPendingGatewayUrl() {
    this.call(rejectPendingGatewayUrlInternal);
  }

  handleGatewayUrlConfirm() {
    this.call(acceptPendingGatewayUrlInternal);
  }

  handleGatewayUrlCancel() {
    this.call(rejectPendingGatewayUrlInternal);
  }

  render() {
    return renderApp(this as unknown as AppViewState);
  }
}

export class ClawdbotApp extends OpenClawApp {}

if (!customElements.get("clawdbot-app")) {
  customElements.define("clawdbot-app", ClawdbotApp);
}
