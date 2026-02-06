const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } = require("electron");
const { startStaticServer } = require("./static-server.cjs");

const PRODUCT_NAME = "OpenClaw CN";

function augmentPathEnv(env) {
  const home = app.getPath("home");
  const candidates = [
    path.join(home, "Library", "pnpm"),
    path.join(home, ".local", "share", "pnpm"),
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
  ];

  if (process.platform === "win32") {
    const appData =
      env.APPDATA && String(env.APPDATA).trim()
        ? String(env.APPDATA).trim()
        : path.join(home, "AppData", "Roaming");
    candidates.unshift(path.join(appData, "npm"));
  }

  const current = typeof env.PATH === "string" ? env.PATH : "";
  const parts = current.split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    if (parts.includes(candidate)) continue;
    parts.unshift(candidate);
  }

  return { ...env, PATH: parts.join(path.delimiter) };
}

function runCommand(command, args, { timeoutMs = 5 * 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: augmentPathEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const out = [];
    const err = [];
    const MAX_BYTES = 200_000;
    let settled = false;

    const pushLimited = (arr, chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const size = arr.reduce((sum, b) => sum + b.length, 0);
      if (size >= MAX_BYTES) return;
      arr.push(buf.slice(0, Math.max(0, MAX_BYTES - size)));
    };

    child.stdout.on("data", (chunk) => pushLimited(out, chunk));
    child.stderr.on("data", (chunk) => pushLimited(err, chunk));

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        killed,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        error: error ? String(error) : "Unknown error",
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        code,
        killed,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

async function runGatewayUninstall(win, opts = {}) {
  const includeWorkspace = Boolean(opts.includeWorkspace);
  const dryRun = Boolean(opts.dryRun);

  const command = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
  const args = [
    "uninstall",
    "--service",
    "--state",
    ...(includeWorkspace ? ["--workspace"] : []),
    "--yes",
    "--non-interactive",
    ...(dryRun ? ["--dry-run"] : []),
  ];

  const preview = `${command} ${args.join(" ")}`;
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Uninstall gateway",
    message: "This will uninstall the OpenClaw gateway service and remove local state/config.",
    detail:
      "If you only want to stop the gateway temporarily, use Restart instead.\n\nCommand:\n" +
      preview,
    buttons: ["Cancel", dryRun ? "Run dry-run" : "Uninstall"],
    defaultId: 1,
    cancelId: 0,
    checkboxLabel: "Also remove workspace dirs (if configured outside ~/.openclaw)",
    checkboxChecked: includeWorkspace,
    noLink: true,
  });

  if (response !== 1) {
    return { ok: false, cancelled: true };
  }

  // Apply the checkbox choice if the caller didn't explicitly set it.
  const effectiveWorkspace = opts.includeWorkspace === undefined ? checkboxChecked : includeWorkspace;
  const effectiveArgs = [
    "uninstall",
    "--service",
    "--state",
    ...(effectiveWorkspace ? ["--workspace"] : []),
    "--yes",
    "--non-interactive",
    ...(dryRun ? ["--dry-run"] : []),
  ];

  if (win && !win.isDestroyed()) {
    // Indeterminate progress bar while the CLI runs.
    win.setProgressBar(2);
  }

  const result = await runCommand(command, effectiveArgs);

  if (win && !win.isDestroyed()) {
    win.setProgressBar(-1);
  }

  if (!result.ok) {
    const hint =
      result.error && result.error.includes("ENOENT")
        ? "The 'openclaw' command was not found in PATH. Install OpenClaw CLI first (npm/pnpm), then try again."
        : "Uninstall failed. See output for details.";
    await dialog.showMessageBox(win, {
      type: "error",
      title: "Uninstall failed",
      message: hint,
      detail: [result.error, result.stderr, result.stdout].filter(Boolean).join("\n"),
      buttons: ["OK"],
      defaultId: 0,
      noLink: true,
    });
    return result;
  }

  await dialog.showMessageBox(win, {
    type: "info",
    title: "Uninstall complete",
    message: dryRun ? "Dry-run complete." : "Gateway uninstall complete.",
    detail: [result.stderr, result.stdout].filter(Boolean).join("\n"),
    buttons: ["OK"],
    defaultId: 0,
    noLink: true,
  });
  return result;
}

function resolveUiRoot() {
  // Packaged: extraResources -> <resources>/control-ui
  const packagedRoot = path.join(process.resourcesPath, "control-ui");
  if (fs.existsSync(path.join(packagedRoot, "index.html"))) {
    return packagedRoot;
  }

  // Dev: repoRoot/dist/control-ui
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(repoRoot, "dist", "control-ui");
}

function createMainWindow(opts) {
  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1020,
    minHeight: 640,
    title: PRODUCT_NAME,
    backgroundColor: "#12141a",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.once("ready-to-show", () => win.show());

  // Handle external links safely.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      // Allow our local UI server only; open other URLs externally.
      if (opts && opts.allowedOrigin && parsed.origin === opts.allowedOrigin) {
        return;
      }
      event.preventDefault();
      void shell.openExternal(url);
    } catch {
      // ignore
    }
  });

  return win;
}

function buildAppMenu(win) {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
          },
        ]
      : []),
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        {
          label: "Command Center",
          accelerator: "CommandOrControl+K",
          click: () => {
            if (!win) return;
            win.focus();
            // UI has its own Ctrl/Cmd+K listener; this is just a safe fallback.
            void win.webContents.executeJavaScript(
              "window.dispatchEvent(new CustomEvent('openclawDesktop:openCommandCenter'))",
            );
          },
        },
        { type: "separator" },
        { role: "minimize" },
        ...(isMac ? [{ role: "close" }] : [{ role: "close" }]),
      ],
    },
    {
      label: "Gateway",
      submenu: [
        {
          label: "Command Center",
          click: () => {
            if (!win) return;
            win.show();
            win.focus();
            void win.webContents.executeJavaScript(
              "window.dispatchEvent(new CustomEvent('openclawDesktop:openCommandCenter'))",
            );
          },
        },
        {
          label: "Uninstall…",
          click: () => {
            if (!win) return;
            void runGatewayUninstall(win, {});
          },
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Docs (zh-CN)",
          click: () => void shell.openExternal("https://docs.openclaw.ai/zh-CN/index"),
        },
        {
          label: "ClawHub",
          click: () => void shell.openExternal("https://clawhub.com"),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray(win) {
  // Use a safe fallback icon if not found; tray is optional.
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const fallbackPng = path.join(repoRoot, "assets", "chrome-extension", "icons", "icon32.png");
  const trayIcon = fs.existsSync(fallbackPng) ? fallbackPng : undefined;
  if (!trayIcon) {
    return null;
  }
  const tray = new Tray(trayIcon);
  tray.setToolTip(PRODUCT_NAME);
  const menu = Menu.buildFromTemplate([
    {
      label: "Open",
      click: () => {
        win.show();
        win.focus();
      },
    },
    { type: "separator" },
    {
      label: "Command Center",
      click: () => {
        win.show();
        win.focus();
        void win.webContents.executeJavaScript(
          "window.dispatchEvent(new CustomEvent('openclawDesktop:openCommandCenter'))",
        );
      },
    },
    {
      label: "Uninstall gateway…",
      click: () => {
        win.show();
        win.focus();
        void runGatewayUninstall(win, {});
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    win.show();
    win.focus();
  });
  return tray;
}

async function main() {
  app.setName(PRODUCT_NAME);

  const uiUrlOverride = process.env.OPENCLAW_CN_UI_URL;
  let server = null;
  let origin = null;
  let startUrl = null;

  if (uiUrlOverride && uiUrlOverride.trim()) {
    startUrl = uiUrlOverride.trim().replace(/\/$/, "");
    origin = new URL(startUrl).origin;
  } else {
    const uiRoot = resolveUiRoot();
    server = await startStaticServer(uiRoot, { host: "127.0.0.1", port: 0 });
    startUrl = server.url;
    origin = server.url;
  }

  const win = createMainWindow({ allowedOrigin: origin });
  buildAppMenu(win);
  createTray(win);

  ipcMain.handle("openclawDesktop.version", () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));

  ipcMain.handle("openclawDesktop.openCommandCenter", async () => {
    if (!win || win.isDestroyed()) return { ok: false };
    win.show();
    win.focus();
    await win.webContents.executeJavaScript(
      "window.dispatchEvent(new CustomEvent('openclawDesktop:openCommandCenter'))",
    );
    return { ok: true };
  });

  ipcMain.handle("openclawDesktop.gatewayUninstall", async (_event, opts) => {
    return await runGatewayUninstall(win, opts && typeof opts === "object" ? opts : {});
  });

  // Note: Control UI uses History API; our local server supports SPA fallback.
  await win.loadURL(`${startUrl}/`);
}

app.whenReady().then(() => {
  void main();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
