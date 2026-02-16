import { html } from "lit";

import { nodeLabel } from "../node-snapshot";
import type { NodeSnapshot } from "../types";
import type { NodesProps } from "./nodes.types";
import { renderBindingsSection } from "./nodes.bindings";
import { renderDevicesSection } from "./nodes.devices";
import { renderExecApprovalsSection } from "./nodes.exec-approvals";

export type { NodesProps } from "./nodes.types";

export function renderNodes(props: NodesProps) {
  return html`
    ${renderExecApprovalsSection(props)}
    ${renderBindingsSection(props)}
    ${renderDevicesSection(props)}
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">节点</div>
          <div class="card-sub">配对设备和实时链接。</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "加载中…" : "刷新"}
        </button>
      </div>
      <div class="list" style="margin-top: 16px;">
        ${props.nodes.length === 0
          ? html`<div class="muted">未找到节点。</div>`
          : props.nodes.map((node) => renderNode(node))}
      </div>
    </section>
  `;
}

function renderNode(node: NodeSnapshot) {
  const connected = Boolean(node.connected);
  const paired = Boolean(node.paired);
  const title = nodeLabel(node);
  const caps = Array.isArray(node.caps) ? node.caps : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${title}</div>
        <div class="list-sub">
          ${node.nodeId ?? ""}
          ${node.remoteIp ? ` · ${node.remoteIp}` : ""}
          ${node.version ? ` · ${node.version}` : ""}
        </div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${paired ? "已配对" : "未配对"}</span>
          <span class="chip ${connected ? "chip-ok" : "chip-warn"}">
            ${connected ? "已连接" : "离线"}
          </span>
          ${caps.slice(0, 12).map((cap) => html`<span class="chip">${String(cap)}</span>`)}
          ${commands
            .slice(0, 8)
            .map((command) => html`<span class="chip">${String(command)}</span>`)}
        </div>
      </div>
    </div>
  `;
}
