import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { AppOrchestrator } from './core/AppOrchestrator';

let orchestrator: AppOrchestrator;
let splash: BrowserWindow | null;
let mainWindowStarted = false;

function createWindow() {
  splash = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    show: false, // показуємо тільки коли вміст готовий, щоб не блимало порожнє вікно
    backgroundColor: '#ffffff', // непрозорий фон малюється миттєво (без композитора)
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splash.loadFile(path.join(__dirname, 'splash.html'));

  // Показуємо splash одразу, щойно його HTML готовий до показу.
  splash.once('ready-to-show', () => {
    splash?.show();
  });

  // Важку роботу (створення головного вікна, завантаження великого бандла та
  // ініціалізація сервісів) відкладаємо до того, як splash реально намалюється.
  // Інакше головний потік був би зайнятий завантаженням бандла, і splash
  // з'являвся б пізно та на дуже короткий час.
  splash.webContents.once('did-finish-load', () => {
    setupMainWindow();
  });

  // Запобіжник: якщо splash чомусь не завантажився, усе одно стартуємо.
  setTimeout(() => setupMainWindow(), 1500);
}

function setupMainWindow() {
  if (mainWindowStarted) return;
  mainWindowStarted = true;

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // Don't show the main window immediately
    backgroundColor: '#f8fafc', // уникаємо білого спалаху при показі
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

  // Показуємо головне вікно і закриваємо splash, коли вміст готовий.
  win.once('ready-to-show', () => {
    try {
      win.maximize(); // Optional: open in max mode
      win.show();
    } catch (e) {
      console.error('Failed to maximize or show window', e);
    }
    if (splash) {
      splash.close();
      splash = null;
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
