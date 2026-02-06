const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openclawDesktop", {
  version: () => ipcRenderer.invoke("openclawDesktop.version"),
  openCommandCenter: () => ipcRenderer.invoke("openclawDesktop.openCommandCenter"),
  gatewayUninstall: (opts) => ipcRenderer.invoke("openclawDesktop.gatewayUninstall", opts ?? {}),
});
