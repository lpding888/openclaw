import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderModelCenter } from "./model-center.ts";

function baseProps() {
  return {
    connected: true,
    loading: false,
    compatMode: false,
    options: [
      {
        id: "anthropic/claude-main",
        name: "Claude Main",
        provider: "anthropic",
        label: "Claude Main (anthropic/claude-main)",
      },
      {
        id: "openai/gpt-fallback",
        name: "GPT Fallback",
        provider: "openai",
        label: "GPT Fallback (openai/gpt-fallback)",
      },
    ],
    current: "anthropic/claude-main",
    primary: "anthropic/claude-main",
    fallbacksText: "openai/gpt-fallback",
    query: "",
    allowCustom: false,
    saving: false,
    error: null,
    status: null,
    onPrimaryChange: vi.fn(),
    onFallbacksChange: vi.fn(),
    onQueryChange: vi.fn(),
    onAllowCustomChange: vi.fn(),
    onReload: vi.fn(),
    onReset: vi.fn(),
    onSave: vi.fn(),
  };
}

describe("model center view", () => {
  it("renders grouped provider options", () => {
    const container = document.createElement("div");
    render(renderModelCenter(baseProps()), container);

    const groups = Array.from(container.querySelectorAll("optgroup")).map((node) =>
      node.getAttribute("label"),
    );
    expect(groups).toEqual(["anthropic", "openai"]);
  });

  it("invokes onSave when save button clicked", () => {
    const container = document.createElement("div");
    const onSave = vi.fn();
    render(
      renderModelCenter({
        ...baseProps(),
        onSave,
      }),
      container,
    );

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存模型设置",
    );
    expect(saveButton).toBeTruthy();
    saveButton?.click();
    expect(onSave).toHaveBeenCalled();
  });

  it("shows compatibility callout in compat mode", () => {
    const container = document.createElement("div");
    render(
      renderModelCenter({
        ...baseProps(),
        compatMode: true,
      }),
      container,
    );

    expect(container.textContent).toContain("兼容模式");
  });
});
