import { html, nothing } from "lit";
import type { ModelSwitcherOption } from "../controllers/model-switcher.ts";

type ModelCenterProps = {
  connected: boolean;
  loading: boolean;
  compatMode: boolean;
  options: ModelSwitcherOption[];
  current: string | null;
  primary: string;
  fallbacksText: string;
  query: string;
  allowCustom: boolean;
  saving: boolean;
  error: string | null;
  status: string | null;
  onPrimaryChange: (next: string) => void;
  onFallbacksChange: (next: string) => void;
  onQueryChange: (next: string) => void;
  onAllowCustomChange: (next: boolean) => void;
  onReload: () => void;
  onReset: () => void;
  onSave: () => void;
};

function groupOptionsByProvider(options: ModelSwitcherOption[]) {
  const grouped = new Map<string, ModelSwitcherOption[]>();
  for (const option of options) {
    const key = option.provider || "unknown";
    const list = grouped.get(key) ?? [];
    list.push(option);
    grouped.set(key, list);
  }
  return Array.from(grouped.entries()).toSorted(([a], [b]) => a.localeCompare(b));
}

export function renderModelCenter(props: ModelCenterProps) {
  const query = props.query.trim().toLowerCase();
  const filteredOptions = !query
    ? props.options
    : props.options.filter((entry) => {
        const haystack = `${entry.provider} ${entry.name} ${entry.id}`.toLowerCase();
        return haystack.includes(query);
      });

  const groupedOptions = groupOptionsByProvider(filteredOptions);

  return html`
    <section class="card">
      <div class="card-title">模型中心</div>
      <div class="card-sub">集中管理主模型与回退链路。</div>

      ${
        props.compatMode
          ? html`
              <div class="callout warn" style="margin-top: 12px">
                当前网关为兼容模式，保存会走旧配置应用链路。
              </div>
            `
          : nothing
      }

      <div class="form-grid" style="margin-top: 14px;">
        <label class="field">
          <span>搜索模型</span>
          <input
            .value=${props.query}
            placeholder="按 provider / 名称 / id 搜索"
            ?disabled=${props.loading || props.saving}
            @input=${(event: Event) => {
              props.onQueryChange((event.target as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="field">
          <span>当前主模型</span>
          <input .value=${props.current ?? "未设置"} disabled />
        </label>
      </div>

      <div class="form-grid" style="margin-top: 10px;">
        <label class="field">
          <span>主模型</span>
          <select
            .value=${props.primary}
            ?disabled=${!props.connected || props.loading || props.saving}
            @change=${(event: Event) => {
              props.onPrimaryChange((event.target as HTMLSelectElement).value);
            }}
          >
            <option value="">请选择主模型</option>
            ${groupedOptions.map(
              ([provider, entries]) => html`
                <optgroup label=${provider}>
                  ${entries.map((entry) => html`<option value=${entry.id}>${entry.label}</option> `)}
                </optgroup>
              `,
            )}
          </select>
        </label>

        <label class="field">
          <span>回退模型（逗号分隔）</span>
          <input
            .value=${props.fallbacksText}
            placeholder="provider/model, provider/model"
            ?disabled=${!props.connected || props.loading || props.saving}
            @input=${(event: Event) => {
              props.onFallbacksChange((event.target as HTMLInputElement).value);
            }}
          />
        </label>
      </div>

      <label class="field" style="margin-top: 10px;">
        <span>
          <input
            type="checkbox"
            .checked=${props.allowCustom}
            ?disabled=${!props.connected || props.loading || props.saving}
            @change=${(event: Event) => {
              props.onAllowCustomChange((event.target as HTMLInputElement).checked);
            }}
          />
          允许保存未出现在目录中的自定义模型 ID（高级）
        </span>
      </label>

      ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}
      ${props.status ? html`<div class="callout" style="margin-top: 12px;">${props.status}</div>` : nothing}

      <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 12px;">
        <button class="btn btn--sm" ?disabled=${props.loading || props.saving} @click=${props.onReload}>
          刷新
        </button>
        <button class="btn btn--sm" ?disabled=${props.loading || props.saving} @click=${props.onReset}>
          还原
        </button>
        <button
          class="btn btn--sm primary"
          ?disabled=${!props.connected || props.loading || props.saving || !props.primary}
          @click=${props.onSave}
        >
          ${props.saving ? "保存中..." : "保存模型设置"}
        </button>
      </div>
    </section>
  `;
}
