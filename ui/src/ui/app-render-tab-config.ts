import type { TemplateResult } from "lit";
import type { AppViewState } from "./app-view-state.ts";
import {
  applyConfig,
  loadConfig,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
} from "./controllers/config.ts";
import { renderConfig } from "./views/config.ts";

export function renderConfigTab(state: AppViewState): TemplateResult {
  return renderConfig({
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
  });
}
