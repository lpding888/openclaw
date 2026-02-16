import { html, nothing } from "lit";
import type { SignalStatus } from "../types.ts";
import type { ChannelsProps } from "./channels.types.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { renderChannelConfigSection } from "./channels.config.ts";

export function renderSignalCard(params: {
  props: ChannelsProps;
  signal?: SignalStatus | null;
  accountCountLabel: unknown;
}) {
  const { props, signal, accountCountLabel } = params;

  return html`
    <div class="card">
      <div class="card-title">Signal</div>
      <div class="card-sub">signal-cli 状态和频道配置。</div>
      ${accountCountLabel}

      <div class="status-list" style="margin-top: 16px;">
        <div>
          <span class="label">已配置</span>
          <span>${signal?.configured ? "是" : "否"}</span>
        </div>
        <div>
          <span class="label">运行中</span>
          <span>${signal?.running ? "是" : "否"}</span>
        </div>
        <div>
          <span class="label">基础URL</span>
          <span>${signal?.baseUrl ?? "无"}</span>
        </div>
        <div>
          <span class="label">Last start</span>
          <span>${signal?.lastStartAt ? formatRelativeTimestamp(signal.lastStartAt) : "n/a"}</span>
        </div>
        <div>
          <span class="label">Last probe</span>
          <span>${signal?.lastProbeAt ? formatRelativeTimestamp(signal.lastProbeAt) : "n/a"}</span>
        </div>
      </div>

      ${signal?.lastError
        ? html`<div class="callout danger" style="margin-top: 12px;">
            ${signal.lastError}
          </div>`
        : nothing}

      ${signal?.probe
        ? html`<div class="callout" style="margin-top: 12px;">
            探测 ${signal.probe.ok ? "成功" : "失败"} ·
            ${signal.probe.status ?? ""} ${signal.probe.error ?? ""}
          </div>`
        : nothing}

      ${renderChannelConfigSection({ channelId: "signal", props })}

      <div class="row" style="margin-top: 12px;">
        <button class="btn" @click=${() => props.onRefresh(true)}>
          探测
        </button>
      </div>
    </div>
  `;
}
