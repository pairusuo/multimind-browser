import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerIpcHandlers } from './ipcHandlers';
import { createBrowserStore, WindowManager } from './windowManager';

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'MultiMind Browser',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const store = await createBrowserStore();
  const windowManager = new WindowManager(mainWindow, store);
  registerIpcHandlers(windowManager);

  mainWindow.on('resize', () => windowManager.layout());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!app.isPackaged) {
    await loadDevRenderer(mainWindow);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  windowManager.createInitialView();
  scheduleDevCapture(mainWindow);
}

app.whenReady().then(() => {
  void createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function loadDevRenderer(window: BrowserWindow): Promise<void> {
  const screenshotMode = process.env.MULTIMIND_SCREENSHOT_MODE;
  const devServerUrl = `http://localhost:5173${
    screenshotMode ? `?screenshotMode=${encodeURIComponent(screenshotMode)}` : ''
  }`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await window.loadURL(devServerUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  await window.loadURL(devServerUrl);
}

function scheduleDevCapture(window: BrowserWindow): void {
  const capturePath = process.env.MULTIMIND_CAPTURE_PATH;
  if (!capturePath || app.isPackaged) {
    return;
  }

  setTimeout(() => {
    void window.capturePage().then((image) => fs.writeFile(capturePath, image.toPNG()));
  }, 5000);
}
