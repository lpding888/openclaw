import type { TemplateResult } from "lit";
import type { AppViewState } from "./app-view-state.ts";
import {
  loadConfig,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { renderNodes } from "./views/nodes.ts";

export function renderNodesTab(state: AppViewState): TemplateResult {
  return renderNodes({
    loading: state.nodesLoading,
    nodes: state.nodes,
    devicesLoading: state.devicesLoading,
    devicesError: state.devicesError,
    devicesList: state.devicesList,
    configForm:
      state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null),
    configLoading: state.configLoading,
    configSaving: state.configSaving,
    configDirty: state.configFormDirty,
    configFormMode: state.configFormMode,
    execApprovalsLoading: state.execApprovalsLoading,
    execApprovalsSaving: state.execApprovalsSaving,
    execApprovalsDirty: state.execApprovalsDirty,
    execApprovalsSnapshot: state.execApprovalsSnapshot,
    execApprovalsForm: state.execApprovalsForm,
    execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
    execApprovalsTarget: state.execApprovalsTarget,
    execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
    onRefresh: () => loadNodes(state),
    onDevicesRefresh: () => loadDevices(state),
    onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
    onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
    onDeviceRotate: (deviceId, role, scopes) =>
      rotateDeviceToken(state, { deviceId, role, scopes }),
    onDeviceRevoke: (deviceId, role) => revokeDeviceToken(state, { deviceId, role }),
    onLoadConfig: () => loadConfig(state),
    onLoadExecApprovals: () => {
      const target =
        state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
          ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
          : { kind: "gateway" as const };
      return loadExecApprovals(state, target);
    },
    onBindDefault: (nodeId) => {
      if (nodeId) {
        updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
      } else {
        removeConfigFormValue(state, ["tools", "exec", "node"]);
      }
    },
    onBindAgent: (agentIndex, nodeId) => {
      const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
      if (nodeId) {
        updateConfigFormValue(state, basePath, nodeId);
      } else {
        removeConfigFormValue(state, basePath);
      }
    },
    onSaveBindings: () => saveConfig(state),
    onExecApprovalsTargetChange: (kind, nodeId) => {
      state.execApprovalsTarget = kind;
      state.execApprovalsTargetNodeId = nodeId;
      state.execApprovalsSnapshot = null;
      state.execApprovalsForm = null;
      state.execApprovalsDirty = false;
      state.execApprovalsSelectedAgent = null;
    },
    onExecApprovalsSelectAgent: (agentId) => {
      state.execApprovalsSelectedAgent = agentId;
    },
    onExecApprovalsPatch: (path, value) => updateExecApprovalsFormValue(state, path, value),
    onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
    onSaveExecApprovals: () => {
      const target =
        state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
          ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
          : { kind: "gateway" as const };
      return saveExecApprovals(state, target);
    },
  });
}
