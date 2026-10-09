'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  verificarPastaDados: (pasta, caminhos) => ipcRenderer.invoke('verificar-pasta-dados', { pasta, caminhos }),
  getDashboardData: () => ipcRenderer.invoke('get-dashboard-data'),
  refreshNow: () => ipcRenderer.invoke('refresh-now'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getMargemData: (from, to) => ipcRenderer.invoke('get-margem-data', { from, to }),
  onDashboardUpdated: (cb) => ipcRenderer.on('dashboard-updated', (_event, data) => cb(data)),
  onDashboardScanning: (cb) => ipcRenderer.on('dashboard-scanning', (_event, isScanning) => cb(isScanning)),
  onDashboardError: (cb) => ipcRenderer.on('dashboard-error', (_event, msg) => cb(msg)),
  installUpdateNow: () => ipcRenderer.invoke('install-update-now'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_event, version) => cb(version)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_event, version) => cb(version)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_event, pct) => cb(pct)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_event, version) => cb(version)),
});
