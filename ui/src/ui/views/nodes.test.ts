import { render } from "lit";
import { describe, expect, it, vi } from "vitest";

import { renderNodes, type NodesProps } from "./nodes";

function createProps(overrides: Partial<NodesProps> = {}): NodesProps {
  return {
    loading: false,
    nodes: [],
    devicesLoading: false,
    devicesError: null,
    devicesList: { pending: [], paired: [] },
    configForm: null,
    configLoading: false,
    configSaving: false,
    configDirty: false,
    configFormMode: "form",
    execApprovalsLoading: false,
    execApprovalsSaving: false,
    execApprovalsDirty: false,
    execApprovalsSnapshot: null,
    execApprovalsForm: null,
    execApprovalsSelectedAgent: null,
    execApprovalsTarget: "gateway",
    execApprovalsTargetNodeId: null,
    onRefresh: () => undefined,
    onDevicesRefresh: () => undefined,
    onDeviceApprove: () => undefined,
    onDeviceReject: () => undefined,
    onDeviceRotate: () => undefined,
    onDeviceRevoke: () => undefined,
    onLoadConfig: () => undefined,
    onLoadExecApprovals: () => undefined,
    onBindDefault: () => undefined,
    onBindAgent: () => undefined,
    onSaveBindings: () => undefined,
    onExecApprovalsTargetChange: () => undefined,
    onExecApprovalsSelectAgent: () => undefined,
    onExecApprovalsPatch: () => undefined,
    onExecApprovalsRemove: () => undefined,
    onSaveExecApprovals: () => undefined,
    ...overrides,
  };
}

describe("nodes view", () => {
  it("approves pending pairing requests", () => {
    const container = document.createElement("div");
    const onDeviceApprove = vi.fn();
    render(
      renderNodes(
        createProps({
          devicesList: {
            pending: [
              {
                requestId: "req-1",
                deviceId: "device-1",
                role: "desktop",
                ts: 0,
              },
            ],
            paired: [],
          },
          onDeviceApprove,
        }),
      ),
      container,
    );

    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "批准",
    );
    expect(approveButton).not.toBeUndefined();
    approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onDeviceApprove).toHaveBeenCalledWith("req-1");
  });

  it("switches exec approvals target to node", () => {
    const container = document.createElement("div");
    const onExecApprovalsTargetChange = vi.fn();
    render(
      renderNodes(
        createProps({
          nodes: [
            {
              nodeId: "node-1",
              displayName: "Node A",
              commands: ["system.execApprovals.get"],
            },
          ],
          onExecApprovalsTargetChange,
        }),
      ),
      container,
    );

    const hostSelect = Array.from(container.querySelectorAll("select")).find((select) => {
      const values = Array.from(select.options).map((option) => option.value);
      return values.includes("gateway") && values.includes("node");
    });
    expect(hostSelect).not.toBeUndefined();
    if (!hostSelect) return;
    hostSelect.value = "node";
    hostSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onExecApprovalsTargetChange).toHaveBeenCalledWith("node", "node-1");
  });
});
