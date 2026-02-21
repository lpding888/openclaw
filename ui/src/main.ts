import "./styles.css";

function toErrorMessage(input: unknown): string {
  if (input instanceof Error) {
    return input.stack ?? input.message;
  }
  return String(input);
}

function showFatalOverlay(message: string) {
  if (typeof document === "undefined") {
    return;
  }
  const id = "openclaw-control-ui-fatal";
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement("pre");
    node.id = id;
    node.style.position = "fixed";
    node.style.inset = "16px";
    node.style.margin = "0";
    node.style.padding = "14px";
    node.style.borderRadius = "10px";
    node.style.overflow = "auto";
    node.style.whiteSpace = "pre-wrap";
    node.style.font = "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace";
    node.style.background = "#1f1111";
    node.style.color = "#ffd8d8";
    node.style.border = "1px solid #dc6a6a";
    node.style.zIndex = "2147483647";
    document.body?.appendChild(node);
  }
  node.textContent = `Control UI 启动失败\n\n${message}\n\n` + "请把这段截图发给维护者。";
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    showFatalOverlay(toErrorMessage(event.error ?? event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    showFatalOverlay(toErrorMessage(event.reason));
  });
}

void import("./ui/app.ts").catch((err) => {
  showFatalOverlay(toErrorMessage(err));
});
