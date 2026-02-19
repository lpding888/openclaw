import { html, type TemplateResult } from "lit";
import type { AppViewState } from "./app-view-state.ts";
import {
  applyConfig,
  loadConfig,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
} from "./controllers/config.ts";
import {
  loadModelSwitcher,
  resetModelCenterSelection,
  saveModelCenterSelection,
} from "./controllers/model-switcher.ts";
import { renderConfig } from "./views/config.ts";
import { renderModelCenter } from "./views/model-center.ts";

export function renderConfigTab(state: AppViewState): TemplateResult {
  return html`
    ${renderModelCenter({
      connected: state.connected,
      loading: state.modelSwitcherLoading,
      compatMode: state.modelSwitcherCompatMode,
      options: state.modelSwitcherOptions,
      current: state.modelSwitcherCurrent,
      primary: state.modelCenterPrimary,
      fallbacksText: state.modelCenterFallbacksText,
      query: state.modelCenterQuery,
      allowCustom: state.modelCenterAllowCustom,
      saving: state.modelCenterSaving,
      error: state.modelCenterError,
      status: state.modelCenterStatus,
      onPrimaryChange: (next) => (state.modelCenterPrimary = next),
      onFallbacksChange: (next) => (state.modelCenterFallbacksText = next),
      onQueryChange: (next) => (state.modelCenterQuery = next),
      onAllowCustomChange: (next) => (state.modelCenterAllowCustom = next),
      onReload: () => {
        void loadModelSwitcher(state);
      },
      onReset: () => resetModelCenterSelection(state),
      onSave: () => {
        void saveModelCenterSelection(state);
      },
    })}
    ${renderConfig({
      raw: state.configRaw,
      originalRaw: state.configRawOriginal,
      valid: state.configValid,
      issues: state.configIssues,
      loading: state.configLoading,
      saving: state.configSaving,
      applying: state.configApplying,
      updating: state.updateRunning,
      connected: state.connected,
      schema: state.configSchema,
      schemaLoading: state.configSchemaLoading,
      uiHints: state.configUiHints,
      formMode: state.configFormMode,
      formValue: state.configForm,
      originalValue: state.configFormOriginal,
      searchQuery: state.configSearchQuery,
      activeSection: state.configActiveSection,
      activeSubsection: state.configActiveSubsection,
      onRawChange: (next) => {
        state.configRaw = next;
      },
      onFormModeChange: (mode) => (state.configFormMode = mode),
      onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
      onSearchChange: (query) => (state.configSearchQuery = query),
      onSectionChange: (section) => {
        state.configActiveSection = section;
        state.configActiveSubsection = null;
      },
      onSubsectionChange: (section) => (state.configActiveSubsection = section),
      onReload: () => loadConfig(state),
      onSave: () => saveConfig(state),
      onApply: () => applyConfig(state),
      onUpdate: () => runUpdate(state),
    })}
  `;
}
