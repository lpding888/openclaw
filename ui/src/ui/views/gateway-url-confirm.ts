import { html, nothing } from "lit";

import type { AppViewState } from "../app-view-state";

/**
 * Security confirmation modal for gateway URL changes from URL parameters.
 * This prevents 1-click RCE attacks where a malicious link could redirect
 * the user to an attacker-controlled gateway and steal auth tokens.
 * See CVE: GHSA-g8p2-7wf7-98mq
 */
export function renderGatewayUrlConfirmPrompt(state: AppViewState) {
  const pendingUrl = state.pendingGatewayUrl;
  if (!pendingUrl) return nothing;

  const currentUrl = state.settings.gatewayUrl || window.location.origin;

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-live="polite" aria-modal="true">
      <div class="exec-approval-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">⚠️ 网关地址变更请求</div>
            <div class="exec-approval-sub">请仔细核实此请求</div>
          </div>
        </div>
        <div class="exec-approval-meta">
          <div class="exec-approval-meta-row">
            <span>当前地址</span>
            <span class="mono">${currentUrl}</span>
          </div>
          <div class="exec-approval-meta-row">
            <span>请求地址</span>
            <span class="mono" style="color: var(--warning)">${pendingUrl}</span>
          </div>
        </div>
        <div style="margin: 1rem 0; padding: 0.75rem; background: var(--danger-bg, rgba(239, 68, 68, 0.1)); border-radius: 0.5rem; font-size: 0.875rem;">
          <strong>安全警告：</strong>此请求来自 URL 参数。如果您不确定来源，请拒绝此请求。
          连接到恶意网关可能导致您的认证信息泄露。
        </div>
        <div class="exec-approval-actions">
          <button
            class="btn danger"
            @click=${() => state.rejectPendingGatewayUrl()}
          >
            拒绝
          </button>
          <button
            class="btn primary"
            @click=${() => state.acceptPendingGatewayUrl()}
          >
            确认连接
          </button>
        </div>
      </div>
    </div>
  `;
}
