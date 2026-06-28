import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerIpcHandlers } from './ipcHandlers';
import { createBrowserStore, WindowManager } from './windowManager';

let mainWindow: BrowserWindow | null = null;
let windowManager: WindowManager | null = null;

configureAppIdentity();
bindProcessExceptionHandlers();

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'MultiMind Flow',
    icon: getWindowIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const store = await createBrowserStore();
  windowManager = new WindowManager(mainWindow, store);
  registerIpcHandlers(windowManager);

  mainWindow.on('resize', () => windowManager?.layout());
  mainWindow.on('close', () => {
    windowManager?.dispose();
  });
  mainWindow.on('closed', () => {
    windowManager?.dispose();
    windowManager = null;
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

app.on('before-quit', () => {
  windowManager?.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function configureAppIdentity(): void {
  preserveLegacyUserDataPath();
  app.setName('MultiMind Flow');

  if (process.platform !== 'darwin' || app.isPackaged) {
    return;
  }

  const dockIconPath = path.join(__dirname, '../../build/icon.png');
  const dockIcon = nativeImage.createFromPath(dockIconPath);
  if (!dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  }
}

function getWindowIconPath(): string | undefined {
  if (process.platform === 'darwin') {
    return undefined;
  }

  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../../build/icon.ico');
}

function preserveLegacyUserDataPath(): void {
  const legacyUserDataPath = path.join(app.getPath('appData'), 'MultiMind Browser');
  app.setPath('userData', legacyUserDataPath);
}

async function loadDevRenderer(window: BrowserWindow): Promise<void> {
  const screenshotMode = process.env.MULTIMIND_SCREENSHOT_MODE;
  const devServerUrl = `http://localhost:5173${
    screenshotMode ? `?screenshotMode=${encodeURIComponent(screenshotMode)}` : ''
  }`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (window.isDestroyed()) {
      return;
    }

    try {
      await window.loadURL(devServerUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (window.isDestroyed()) {
    return;
  }

  await window.loadURL(devServerUrl);
}

function scheduleDevCapture(window: BrowserWindow): void {
  const capturePath = process.env.MULTIMIND_CAPTURE_PATH;
  if (!capturePath || app.isPackaged) {
    return;
  }

  setTimeout(() => {
    if (window.isDestroyed()) {
      return;
    }

    void window.capturePage().then((image) => fs.writeFile(capturePath, image.toPNG())).catch((error) => {
      if (!isDestroyedObjectError(error)) {
        console.error('Failed to capture page:', error);
      }
    });
  }, 5000);
}

function bindProcessExceptionHandlers(): void {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
  });
}

function isDestroyedObjectError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Object has been destroyed');
}
