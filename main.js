'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { loadConfig, saveConfig } = require('./src/config-store');

let mainWindow;
let currentConfig;
let lastData = null;
let refreshTimer = null;
let scanning = false;

function logErrorToFile(err) {
  try {
    const logPath = path.join(app.getPath('userData'), 'erro.log');
    const linha = '[' + new Date().toISOString() + '] ' + (err && err.stack ? err.stack : String(err)) + '\n';
    fs.appendFileSync(logPath, linha, 'utf8');
    return logPath;
  } catch (e) {
    return null;
  }
}

process.on('uncaughtException', (err) => {
  const logPath = logErrorToFile(err);
  try {
    dialog.showErrorBox('Painel Fiscal - erro inesperado',
      String(err && err.message ? err.message : err) + (logPath ? ('\n\nDetalhes salvos em:\n' + logPath) : ''));
  } catch (e) { /* nada mais a fazer */ }
});
process.on('unhandledRejection', (err) => {
  logErrorToFile(err);
});

function getUserDataDir() {
  return app.getPath('userData');
}

function cacheFilePath() {
  return path.join(getUserDataDir(), 'cache.json');
}

function loadCachedData() {
  try {
    return JSON.parse(fs.readFileSync(cacheFilePath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveCachedData(data) {
  try {
    fs.writeFileSync(cacheFilePath(), JSON.stringify(data), 'utf8');
  } catch (e) {
    // cache e so uma otimizacao de abertura rapida; falha aqui nao e critica
  }
}

function runScan() {
  if (scanning) return;
  scanning = true;
  if (mainWindow) mainWindow.webContents.send('dashboard-scanning', true);

  const worker = new Worker(path.join(__dirname, 'src', 'scan-worker.js'), {
    workerData: { config: currentConfig },
  });

  worker.on('message', (result) => {
    lastData = result;
    saveCachedData(result);
    scanning = false;
    if (mainWindow) {
      mainWindow.webContents.send('dashboard-scanning', false);
      mainWindow.webContents.send('dashboard-updated', result);
    }
  });

  worker.on('error', (err) => {
    scanning = false;
    if (mainWindow) {
      mainWindow.webContents.send('dashboard-scanning', false);
      mainWindow.webContents.send('dashboard-error', String((err && err.message) || err));
    }
  });
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  const minutes = Math.max(1, Number(currentConfig.refreshMinutes) || 5);
  refreshTimer = setInterval(runScan, minutes * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#0b0f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  currentConfig = loadConfig(getUserDataDir());
  lastData = loadCachedData();
  createWindow();
  scheduleRefresh();
  runScan(); // varredura inicial em segundo plano (a tela ja abre com o cache, se existir)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  logErrorToFile(err);
  try { dialog.showErrorBox('Painel Fiscal - falha ao iniciar', String(err && err.message ? err.message : err)); } catch (e) { /* nada mais a fazer */ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-config', () => currentConfig);

ipcMain.handle('save-config', (event, newConfig) => {
  currentConfig = Object.assign({}, currentConfig, newConfig, {
    paths: Object.assign({}, currentConfig.paths, newConfig.paths || {}),
  });
  saveConfig(getUserDataDir(), currentConfig);
  scheduleRefresh();
  return currentConfig;
});

ipcMain.handle('get-dashboard-data', () => lastData);

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-margem-data', (event, { from, to }) => {
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, 'src', 'margem-worker.js'), {
      workerData: { config: currentConfig, from, to },
    });
    worker.on('message', (result) => resolve(result));
    worker.on('error', (err) => resolve({ error: String((err && err.message) || err) }));
  });
});

ipcMain.handle('refresh-now', () => {
  runScan();
  return true;
});
