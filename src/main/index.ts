import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { AppOrchestrator } from './core/AppOrchestrator';

let orchestrator: AppOrchestrator;
let splash: BrowserWindow | null;

function createWindow() {
  splash = new BrowserWindow({
    width: 600,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splash.loadFile(path.join(__dirname, 'splash.html'));

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // Don't show the main window immediately
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  });

  orchestrator = new AppOrchestrator();
  orchestrator.registerIpcHandlers();

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    // win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // Show main window and close splash screen when ready
  win.once('ready-to-show', () => {
    setTimeout(() => {
      if (splash) {
        splash.close();
        splash = null;
      }
      win.maximize(); // Optional: open in max mode
      win.show();
    }, 1500);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
