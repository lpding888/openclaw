import { html } from "lit";
import { nodeLabel } from "../node-snapshot.ts";
import type { NodeSnapshot } from "../types.ts";
import { renderBindingsSection } from "./nodes.bindings.ts";
import { renderDevicesSection } from "./nodes.devices.ts";
import { renderExecApprovalsSection } from "./nodes.exec-approvals.ts";
import type { NodesProps } from "./nodes.types.ts";

export type { NodesProps } from "./nodes.types.ts";

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
        ${
          props.nodes.length === 0
            ? html`
                <div class="muted">未找到节点。</div>
              `
            : props.nodes.map((node) => renderNode(node))
        }
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
  const remoteIp = typeof node.remoteIp === "string" ? node.remoteIp : "";
  const version = typeof node.version === "string" ? node.version : "";

  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">${title}</div>
        <div class="list-sub">
          ${node.nodeId ?? ""}
          ${remoteIp ? ` · ${remoteIp}` : ""}
          ${version ? ` · ${version}` : ""}
        </div>
        <div class="chip-row" style="margin-top: 6px;">
          <span class="chip">${paired ? "已配对" : "未配对"}</span>
          <span class="chip ${connected ? "chip-ok" : "chip-warn"}">
            ${connected ? "已连接" : "离线"}
          </span>
          ${caps.slice(0, 12).map((cap) => html`<span class="chip">${cap}</span>`)}
          ${commands.slice(0, 8).map((command) => html`<span class="chip">${command}</span>`)}
        </div>
      </div>
    </div>
  `;
}
