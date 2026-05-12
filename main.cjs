"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main/index.ts
var import_electron2 = require("electron");
var path3 = __toESM(require("path"), 1);

// src/main/core/AppOrchestrator.ts
var import_electron = require("electron");

// src/main/services/DatabaseService.ts
var duckdb = __toESM(require("duckdb"), 1);
var path = __toESM(require("path"), 1);
var DatabaseService = class {
  db = null;
  connection = null;
  async initialize(projectId, directory) {
    const dbPath = path.join(directory, `${projectId}.duckdb`);
    return new Promise((resolve, reject) => {
      this.db = new duckdb.Database(dbPath, (err) => {
        if (err) return reject(err);
        this.connection = this.db.connect();
        this.execute("PRAGMA memory_limit='1GB'");
        this.execute("PRAGMA threads=4");
        resolve();
      });
    });
  }
  async query(sql, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.connection) return reject(new Error("Database not initialized"));
      const stmt = this.connection.prepare(sql);
      stmt.all(...params, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
  }
  async execute(sql) {
    return new Promise((resolve, reject) => {
      if (!this.connection) return reject(new Error("Database not initialized"));
      this.connection.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else {
            this.db = null;
            this.connection = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
};

// src/main/services/ImportService.ts
var ImportService = class {
  constructor(db, workerPool) {
    this.db = db;
    this.workerPool = workerPool;
  }
  db;
  workerPool;
  async importFile(filePath, config) {
    console.log("ImportService starting worker for", filePath);
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS population (
        id VARCHAR,
        date VARCHAR,
        amount DOUBLE,
        bookValue DOUBLE,
        auditedValue DOUBLE,
        difference DOUBLE
      )
    `);
    const result = await this.workerPool.runTask("ImportWorker.js", {
      filePath,
      config,
      dbPath: "temp_project.duckdb"
      // Hardcoded for demo
    });
    return result;
  }
};

// src/main/services/SamplingService.ts
var SamplingService = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async runSampling(config) {
    console.log("SamplingService.runSampling stub called with", config.method);
    return { sampleSize: 0 };
  }
};

// src/main/services/ExportService.ts
var ExportService = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async exportProject(projectPath) {
  }
  async exportExcel(excelPath) {
  }
};

// src/main/core/WorkerPool.ts
var import_worker_threads = require("worker_threads");
var path2 = __toESM(require("path"), 1);
var WorkerPool = class {
  // Simple task queue for demonstration
  constructor(poolSize = 4) {
    this.poolSize = poolSize;
  }
  poolSize;
  workers = [];
  taskQueue = [];
  async runTask(workerFile, data) {
    return new Promise((resolve, reject) => {
      const workerPath = path2.join(__dirname, "..", "workers", workerFile);
      const worker = new import_worker_threads.Worker(workerPath, { workerData: data });
      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
};

// src/main/core/AppOrchestrator.ts
var AppOrchestrator = class {
  dbService;
  importService;
  samplingService;
  exportService;
  workerPool;
  constructor() {
    this.dbService = new DatabaseService();
    this.workerPool = new WorkerPool();
    this.importService = new ImportService(this.dbService, this.workerPool);
    this.samplingService = new SamplingService(this.dbService);
    this.exportService = new ExportService(this.dbService);
  }
  registerIpcHandlers() {
    import_electron.ipcMain.handle("import:start", async (event, filePath, config) => {
      console.log("IPC import:start received", filePath, config);
      return await this.importService.importFile(filePath, config);
    });
    import_electron.ipcMain.handle("query:getRows", async (event, table, limit, offset, filters) => {
      return await this.dbService.query(`SELECT * FROM ${table} LIMIT ? OFFSET ?`, [limit, offset]);
    });
    import_electron.ipcMain.handle("query:getAggregates", async (event, table) => {
      return { totalAmount: 0, rowCount: 0, minAmount: 0, maxAmount: 0 };
    });
    import_electron.ipcMain.handle("sampling:execute", async (event, config) => {
      console.log("IPC sampling:execute received", config);
      return await this.samplingService.runSampling(config);
    });
    import_electron.ipcMain.handle("export:project", async (event, projectPath) => {
      console.log("IPC export:project received", projectPath);
      await this.exportService.exportProject(projectPath);
    });
    import_electron.ipcMain.handle("export:excel", async (event, excelPath) => {
      console.log("IPC export:excel received", excelPath);
      await this.exportService.exportExcel(excelPath);
    });
  }
};

// src/main/index.ts
var orchestrator;
function createWindow() {
  const win = new import_electron2.BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path3.join(__dirname, "preload.cjs"),
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
    win.webContents.openDevTools();
  } else {
    win.loadFile(path3.join(__dirname, "dist", "index.html"));
  }
}
import_electron2.app.whenReady().then(createWindow);
import_electron2.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron2.app.quit();
  }
});
