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
var path5 = __toESM(require("path"), 1);

// src/main/core/AppOrchestrator.ts
var import_electron = require("electron");
var path4 = __toESM(require("path"), 1);
var fs3 = __toESM(require("fs"), 1);
var os2 = __toESM(require("os"), 1);

// src/main/services/DatabaseService.ts
var fs = __toESM(require("fs"), 1);
var DatabaseService = class {
  db = null;
  dbPath = null;
  SQL = null;
  async initialize(projectId, directory) {
    try {
      this.dbPath = `${directory}/${projectId}.sqlite`;
      console.log(`[DatabaseService] Initializing dbPath: ${this.dbPath}`);
      const initSqlJs2 = require("sql.js");
      console.log(`[DatabaseService] requiring sql.js ...`);
      this.SQL = await initSqlJs2();
      console.log(`[DatabaseService] initSqlJs() awaited successfully`);
      if (fs.existsSync(this.dbPath)) {
        console.log(`[DatabaseService] db file exists, loading from fs: ${this.dbPath}`);
        const fb = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fb);
      } else {
        console.log(`[DatabaseService] db file does NOT exist, creating new db`);
        this.db = new this.SQL.Database();
      }
      console.log(`[DatabaseService] initialized correctly. db object exists? ` + !!this.db);
    } catch (err) {
      console.error(`[DatabaseService] Error during initialization!`, err);
      throw err;
    }
  }
  isInitialized() {
    const isInit = this.db !== null && this.db !== void 0;
    console.log(`[DatabaseService] isInitialized called -> ${isInit}`);
    return isInit;
  }
  async query(sql, params = []) {
    if (!this.db) throw new Error("Database not initialized");
    const normalized = sql.trim().toUpperCase();
    if (normalized.startsWith("INSERT") || normalized.startsWith("UPDATE") || normalized.startsWith("DELETE") || normalized.startsWith("CREATE") || normalized.startsWith("DROP") || normalized.startsWith("ALTER")) {
      throw new Error(
        "query() cannot execute write operations. Use execute() instead."
      );
    }
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
  get MUS_and_Pareto_Helpers() {
    return {
      getMUSPickedRows: (sql, params, interval, sampleSize) => {
        if (!this.db) throw new Error("Database not initialized");
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        let runningTotal = 0;
        let nextHit = Math.random() * interval;
        const pickedRowIds = [];
        while (stmt.step()) {
          const row = stmt.get();
          const rowid = row[0];
          const absAmt = row[1];
          runningTotal += absAmt;
          while (runningTotal >= nextHit) {
            pickedRowIds.push(rowid);
            nextHit += interval;
            if (pickedRowIds.length >= sampleSize || pickedRowIds.length >= 5e3) break;
          }
          if (pickedRowIds.length >= sampleSize || pickedRowIds.length >= 5e3) break;
        }
        stmt.free();
        return pickedRowIds;
      },
      getParetoPickedRows: (sql, params, targetValue) => {
        if (!this.db) throw new Error("Database not initialized");
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        let currentSum = 0;
        const pickedRowIds = [];
        while (stmt.step()) {
          const row = stmt.get();
          const rowid = row[0];
          const absAmt = row[1];
          if (currentSum >= targetValue) break;
          currentSum += absAmt;
          pickedRowIds.push(rowid);
          if (pickedRowIds.length >= 5e3) break;
        }
        stmt.free();
        return pickedRowIds;
      }
    };
  }
  async execute(sql) {
    if (sql.trim().toUpperCase() === "CHECKPOINT") {
      if (this.dbPath) {
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
      }
      return;
    }
    this.db.run(sql);
  }
  async close() {
    if (this.db) {
      if (this.dbPath) {
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
      }
      this.db.close();
      this.db = null;
    }
  }
};

// src/main/services/ImportService.ts
var os = __toESM(require("os"), 1);
var path = __toESM(require("path"), 1);
var ImportService = class {
  constructor(db, workerPool) {
    this.db = db;
    this.workerPool = workerPool;
  }
  db;
  workerPool;
  async importFile(filePath, config, onProgress) {
    console.log("ImportService starting worker for", filePath);
    const dbPath = path.join(os.tmpdir(), `project_${Date.now()}.sqlite`);
    const result = await this.workerPool.runTask(path.join("dist", "workers", "ImportWorker.cjs"), {
      filePath,
      config,
      dbPath,
      mode: "import"
    }, onProgress);
    return { ...result, dbPath };
  }
  async previewFile(filePath) {
    console.log("ImportService starting preview worker for", filePath);
    return await this.workerPool.runTask(path.join("dist", "workers", "ImportWorker.cjs"), {
      filePath,
      mode: "preview"
    });
  }
};

// src/main/services/SamplingService.ts
var SamplingService = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async getRandomSample(whereClause, params, limitCount) {
    const query = `SELECT * FROM population WHERE ${whereClause} ORDER BY random() LIMIT ?`;
    return this.db.query(query, [...params, limitCount]);
  }
  async runSampling(config) {
    if (!this.db || !this.db.isInitialized()) {
      throw new Error("Database not initialized. Please import population data or load a project first.");
    }
    console.log("SamplingService executing SQL-based sampling via SQLite...", config.method);
    const popAgg = await this.db.query(`SELECT COUNT(*) as cnt, SUM(ABS(amount)) as val FROM population`);
    const popSize = popAgg[0]?.cnt || 0;
    const popValue = popAgg[0]?.val || 0;
    if (popSize === 0) {
      throw new Error("Population cannot be empty");
    }
    const tm = Number(config.tolerableMisstatement) || 0;
    const ctt = Number(config.clearlyTrivialThreshold) || 0;
    let trivialCount = 0;
    let trivialValue = 0;
    let trivialItems = [];
    if (ctt > 0) {
      const trivAgg = await this.db.query(`SELECT COUNT(*) as cnt, SUM(amount) as val FROM population WHERE ABS(amount) < ?`, [ctt]);
      trivialCount = trivAgg[0]?.cnt || 0;
      trivialValue = trivAgg[0]?.val || 0;
      const items = await this.db.query(`SELECT * FROM population WHERE ABS(amount) < ? LIMIT 10`, [ctt]);
      trivialItems = items.map((i) => ({
        ...i,
        originalRow: typeof i.originalRow === "string" ? JSON.parse(i.originalRow) : i.originalRow || []
      }));
    }
    let keyItems = [];
    if (tm > 0) {
      keyItems = await this.db.query(`SELECT * FROM population WHERE ABS(amount) >= ?`, [tm]);
      keyItems = keyItems.map((item) => ({
        ...item,
        originalRow: item.originalRow ? JSON.parse(item.originalRow) : [],
        bookValue: item.amount,
        auditedValue: "",
        difference: item.amount,
        tainting: 1,
        isKeyItem: true
      }));
    }
    const keyItemsValue = keyItems.reduce((acc, curr) => acc + Math.abs(curr.amount), 0);
    const remPopValue = popValue - keyItemsValue - Math.abs(trivialValue);
    let rf = 3;
    if (config.confidenceLevel === 70) rf = 1.2;
    else if (config.confidenceLevel === 80) rf = 1.61;
    else if (config.confidenceLevel === 90) rf = 2.31;
    else if (config.confidenceLevel === 95) rf = 3;
    else if (config.confidenceLevel === 99) rf = 4.61;
    let sampleItems = [];
    if (config.method === "RiskAssessment") {
      const closingDays = config.riskClosingDays ?? 5;
      const includeWeekend = config.riskWeekend !== false;
      const includeHoliday = config.riskHoliday !== false;
      const riskQueryConds = [];
      if (includeWeekend) {
        riskQueryConds.push(`CAST(strftime('%w', date) AS INTEGER) IN (0, 6)`);
      }
      if (includeHoliday) {
        riskQueryConds.push(`strftime('%m-%d', date) IN ('01-01', '03-08', '05-01', '05-08', '05-09', '06-28', '08-24', '10-01', '12-25')`);
      }
      if (closingDays > 0) {
        riskQueryConds.push(`(julianday(date(date, 'start of month', '+1 month', '-1 day')) - julianday(date)) <= ${closingDays}`);
      }
      const riskWhereStr = riskQueryConds.length > 0 ? `(${riskQueryConds.join(" OR ")})` : "FALSE";
      const riskMatchedQuery = `
          SELECT * FROM population 
          WHERE ABS(amount) < ? AND ABS(amount) >= ? AND ${riskWhereStr}
          LIMIT 5000
        `;
      const riskMatched = await this.db.query(riskMatchedQuery, [tm > 0 ? tm : 999999999999, ctt]);
      for (const item of riskMatched) {
        sampleItems.push({
          ...item,
          bookValue: item.amount,
          auditedValue: "",
          difference: item.amount,
          tainting: 1,
          isSampled: true,
          selectionReason: "Risk Criteria"
        });
      }
      const randomCount = config.riskRandomCount ?? 5;
      const riskUnmatchedWhere = `ABS(amount) < ? AND ABS(amount) >= ? AND NOT ${riskWhereStr}`;
      const randomMatched = await this.getRandomSample(riskUnmatchedWhere, [tm > 0 ? tm : 999999999999, ctt], randomCount);
      for (const item of randomMatched) {
        sampleItems.push({
          ...item,
          bookValue: item.amount,
          auditedValue: "",
          difference: item.amount,
          tainting: 1,
          isSampled: true,
          selectionReason: "Random (Risk)"
        });
      }
    } else if (config.method === "Pareto") {
      const targetPercent = (config.paretoCoverage || 80) / 100;
      const targetValue = remPopValue * targetPercent;
      const paretoItemsQuery = `SELECT rowid, ABS(amount) as absAmt FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY ABS(amount) DESC`;
      const pickedRowIds = this.db.MUS_and_Pareto_Helpers.getParetoPickedRows(paretoItemsQuery, [tm > 0 ? tm : 999999999999, ctt], targetValue);
      if (pickedRowIds.length > 0) {
        const results = [];
        const chunkSize = 500;
        for (let i = 0; i < pickedRowIds.length; i += chunkSize) {
          const chunk = pickedRowIds.slice(i, i + chunkSize);
          const chunkResults = await this.db.query(`SELECT * FROM population WHERE rowid IN (${chunk.join(",")})`);
          results.push(...chunkResults);
        }
        sampleItems = results.map((item) => ({
          ...item,
          bookValue: item.amount,
          auditedValue: "",
          difference: item.amount,
          tainting: 1,
          isSampled: true,
          selectionReason: "Pareto (Top 80%)"
        }));
      }
    } else if (config.method === "Percentile") {
      const percent = config.percentileCount || 5;
      const limitCount = Math.max(1, Math.ceil(popSize * percent / 100));
      const topQuery = `SELECT * FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY amount DESC LIMIT ?`;
      const bottomQuery = `SELECT * FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY amount ASC LIMIT ?`;
      const topItems = await this.db.query(topQuery, [tm > 0 ? tm : 999999999999, ctt, limitCount]);
      const bottomItems = await this.db.query(bottomQuery, [tm > 0 ? tm : 999999999999, ctt, limitCount]);
      const combined = [...topItems, ...bottomItems];
      const uniqueSet = /* @__PURE__ */ new Set();
      for (const item of combined) {
        if (!uniqueSet.has(item.id)) {
          uniqueSet.add(item.id);
          sampleItems.push({
            ...item,
            bookValue: item.amount,
            auditedValue: "",
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: "Percentile Tail"
          });
        }
      }
    } else if (config.method === "Benford") {
      const benfordCount = config.benfordSampleSize || 50;
      const whereCond = `ABS(amount) < ? AND ABS(amount) >= ?`;
      const items = await this.getRandomSample(whereCond, [tm > 0 ? tm : 999999999999, ctt], benfordCount);
      sampleItems = items.map((item) => ({
        ...item,
        bookValue: item.amount,
        auditedValue: "",
        difference: item.amount,
        tainting: 1,
        isSampled: true,
        selectionReason: "Benford Review"
      }));
    } else if (config.method === "Grubbs") {
      const grubbsItems = await this.db.query(`SELECT * FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY ABS(amount) DESC LIMIT 15`, [tm > 0 ? tm : 999999999999, ctt]);
      sampleItems = grubbsItems.map((item) => ({
        ...item,
        bookValue: item.amount,
        auditedValue: "",
        difference: item.amount,
        tainting: 1,
        isSampled: true,
        selectionReason: "Grubbs Outlier"
      }));
    } else {
      let sampleSize = 10;
      let isMUS = false;
      if (config.method === "MUS") {
        isMUS = true;
        const pm = config.tolerableMisstatement || 1;
        sampleSize = Math.ceil(remPopValue * rf / Math.max(pm, 0.01));
      } else if (config.method === "FixedRandom") {
        sampleSize = config.fixedSampleSize || 10;
      } else if (config.method === "StopOrGo") {
        sampleSize = (config.stopOrGoInitialSize || 25) + (config.stopOrGoExpansionSize || 25);
      } else if (config.method === "Attribute") {
        sampleSize = 25;
      } else {
        sampleSize = config.fixedSampleSize || 25;
      }
      const remPopSize = popSize - keyItems.length - trivialCount;
      if (sampleSize > remPopSize) sampleSize = remPopSize;
      if (sampleSize > 5e3) sampleSize = 5e3;
      if (isMUS) {
        const pm = config.tolerableMisstatement || 1;
        const interval2 = Math.max(pm / rf, 1);
        const musQuery = `SELECT rowid, ABS(amount) as absAmt FROM population WHERE ABS(amount) < ? AND ABS(amount) >= ? ORDER BY rowid`;
        const pickedRowIds = this.db.MUS_and_Pareto_Helpers.getMUSPickedRows(musQuery, [tm > 0 ? tm : 999999999999, ctt], interval2, sampleSize);
        if (pickedRowIds.length > 0) {
          const results = [];
          const chunkSize = 500;
          for (let i = 0; i < pickedRowIds.length; i += chunkSize) {
            const chunk = pickedRowIds.slice(i, i + chunkSize);
            const chunkResults = await this.db.query(`SELECT * FROM population WHERE rowid IN (${chunk.join(",")})`);
            results.push(...chunkResults);
          }
          sampleItems = results.map((item, idx) => ({
            ...item,
            bookValue: item.amount,
            auditedValue: "",
            difference: item.amount,
            tainting: 1,
            isSampled: true,
            selectionReason: "MUS Hit"
          }));
        }
      } else {
        const whereStr = `ABS(amount) < ? AND ABS(amount) >= ?`;
        const rawSampleItems = await this.getRandomSample(whereStr, [tm > 0 ? tm : 999999999999, ctt], sampleSize);
        sampleItems = rawSampleItems.map((item, idx) => ({
          ...item,
          bookValue: item.amount,
          auditedValue: "",
          difference: item.amount,
          tainting: 1,
          isSampled: true,
          selectionReason: config.method === "StopOrGo" ? idx < (config.stopOrGoInitialSize || 25) ? "Stage 1" : "Stage 2" : "Sampled"
        }));
      }
    }
    sampleItems = sampleItems.map((item) => ({
      ...item,
      originalRow: typeof item.originalRow === "string" ? JSON.parse(item.originalRow) : item.originalRow || []
    }));
    const interval = sampleItems.length > 0 ? remPopValue / sampleItems.length : 1;
    const preResult = {
      populationSize: popSize,
      populationValue: popValue,
      trivialCount,
      trivialValue,
      areTrivialExcluded: true,
      sampleSize: sampleItems.length,
      sampleValue: sampleItems.reduce((acc, curr) => acc + curr.bookValue, 0),
      samplingInterval: interval,
      keyItems,
      samplingItems: sampleItems,
      excludedItems: trivialItems,
      projectedMisstatement: 0,
      upperMisstatementBound: 0
    };
    return this.calculateExtrapolation(preResult, config, rf);
  }
  calculateExtrapolation(results, config, rf) {
    let pm = 0;
    const keyMisstatements = (results.keyItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
    const sampleProjected = (results.samplingItems || []).reduce((acc, item) => {
      const diff = item.difference || 0;
      const tainting = item.bookValue !== 0 ? diff / item.bookValue : 0;
      return acc + tainting * results.samplingInterval;
    }, 0);
    pm = keyMisstatements + sampleProjected;
    let ub = results.samplingInterval * rf + pm;
    if (config.method === "Attribute") {
      const errors = (results.samplingItems || []).filter((item) => Math.abs(item.difference || 0) > 1e-3).length;
      const total = (results.samplingItems || []).length || 1;
      pm = errors / total * 100;
      ub = (errors + rf) / total * 100;
    } else if (["RiskAssessment", "FixedRandom", "Pareto", "Percentile", "Grubbs", "Benford", "StopOrGo"].includes(config.method)) {
      pm = keyMisstatements + (results.samplingItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
      ub = pm;
    } else if (["Random", "CVS", "Cluster"].includes(config.method)) {
      const sampleErrors = (results.samplingItems || []).reduce((acc, item) => acc + (item.difference || 0), 0);
      const n = results.samplingItems?.length || 1;
      const N_rem = results.populationSize - (results.keyItems?.length || 0) - (results.trivialCount || 0);
      const meanDiff = sampleErrors / n;
      pm = keyMisstatements + meanDiff * N_rem;
      let variance = (results.samplingItems || []).reduce((acc, item) => acc + Math.pow((item.difference || 0) - meanDiff, 2), 0);
      if (n > 1) {
        variance = variance / (n - 1);
      }
      const stdErr = N_rem * Math.sqrt(variance) / Math.sqrt(n);
      const zScore = config.confidenceLevel === 70 ? 1.04 : config.confidenceLevel === 80 ? 1.28 : config.confidenceLevel === 90 ? 1.64 : config.confidenceLevel === 95 ? 1.96 : config.confidenceLevel === 99 ? 2.58 : 1.96;
      ub = pm + Math.abs(zScore * stdErr);
    }
    results.projectedMisstatement = pm;
    results.upperMisstatementBound = ub;
    return results;
  }
};

// src/main/services/ExportService.ts
var path2 = __toESM(require("path"), 1);
var fs2 = __toESM(require("fs"), 1);
var ExportService = class {
  constructor(db, workerPool) {
    this.db = db;
    this.workerPool = workerPool;
  }
  db;
  workerPool;
  async exportProject(projectPath, state) {
    console.log("Project export to ", projectPath);
    if (!this.db.dbPath) {
      throw new Error("No active database to export");
    }
    const stateJson = JSON.stringify(state).replace(/'/g, "''");
    await this.db.execute(`DROP TABLE IF EXISTS audit_metadata`);
    await this.db.execute(`CREATE TABLE audit_metadata (data VARCHAR)`);
    await this.db.execute(`INSERT INTO audit_metadata VALUES ('${stateJson}')`);
    await this.db.execute(`CHECKPOINT`);
    fs2.copyFileSync(this.db.dbPath, projectPath);
  }
  async exportExcel(excelPath, dbPath, results) {
    return new Promise((resolve, reject) => {
      this.workerPool.runTask(path2.join("dist", "workers", "ExportWorker.cjs"), {
        excelPath,
        dbPath,
        results
      }).then(() => resolve()).catch((e) => reject(e));
    });
  }
};

// src/main/core/WorkerPool.ts
var import_worker_threads = require("worker_threads");
var path3 = __toESM(require("path"), 1);
var WorkerPool = class {
  // Simple task queue for demonstration
  constructor(poolSize = 4) {
    this.poolSize = poolSize;
  }
  poolSize;
  workers = [];
  taskQueue = [];
  async runTask(workerFile, data, onProgress) {
    return new Promise((resolve, reject) => {
      const workerPath = path3.join(__dirname, workerFile);
      const worker = new import_worker_threads.Worker(workerPath, { workerData: data });
      worker.on("message", (msg) => {
        if (msg.type === "done") resolve(msg);
        else if (msg.type === "error") reject(new Error(msg.error));
        else if (msg.type === "progress") {
          console.log(`Worker Progress: ${msg.pct}% - ${msg.stage}`);
          if (onProgress) onProgress(msg.pct, msg.stage);
        }
      });
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
var initSqlJs = require("sql.js");
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
    this.exportService = new ExportService(this.dbService, this.workerPool);
  }
  registerIpcHandlers() {
    import_electron.ipcMain.handle("import:start", async (event, filePath, config) => {
      console.log("IPC import:start received", filePath, config);
      const result = await this.importService.importFile(filePath, config, (pct, stage) => {
        event.sender.send("import:progress", pct, stage);
      });
      await this.dbService.close();
      const directory = path4.dirname(result.dbPath);
      const id = path4.basename(result.dbPath, ".sqlite");
      await this.dbService.initialize(id, directory);
      return result;
    });
    import_electron.ipcMain.handle("import:preview", async (event, filePath) => {
      return await this.importService.previewFile(filePath);
    });
    import_electron.ipcMain.handle("import:project", async (event, filePath) => {
      console.log("IPC import:project received", filePath);
      try {
        const dbPath = filePath;
        const fb = fs3.readFileSync(dbPath);
        const SQL = await initSqlJs();
        const db = new SQL.Database(fb);
        const stateJson = await new Promise((resolve, reject) => {
          try {
            const stmt = db.prepare("SELECT data FROM audit_metadata");
            if (stmt.step()) {
              const row = stmt.getAsObject();
              resolve(row.data);
            } else {
              reject(new Error("Empty audit_metadata"));
            }
            stmt.free();
          } catch {
            reject(new Error("Invalid project file (no audit_metadata)"));
          }
        });
        db.close();
        if (!this.dbService.dbPath) {
          await this.dbService.initialize("imported_project", os2.tmpdir());
        }
        await this.dbService.close();
        fs3.copyFileSync(filePath, this.dbService.dbPath);
        const directory = path4.dirname(this.dbService.dbPath);
        const id = path4.basename(this.dbService.dbPath, ".sqlite");
        await this.dbService.initialize(id, directory);
        const state = JSON.parse(stateJson);
        return state;
      } catch (e) {
        console.error(e);
        throw new Error("Failed to load project DB: " + e.message);
      }
    });
    import_electron.ipcMain.handle("query:getRows", async (event, table, limit, offset) => {
      return await this.dbService.query(`SELECT * FROM ${table} LIMIT ? OFFSET ?`, [limit, offset]);
    });
    import_electron.ipcMain.handle("query:insertRows", async (event, table, rows) => {
      await this.dbService.execute(`DROP TABLE IF EXISTS ${table}`);
      await this.dbService.execute(`
        CREATE TABLE ${table} (
          id VARCHAR,
          date VARCHAR,
          amount DOUBLE,
          bookValue DOUBLE,
          auditedValue DOUBLE,
          difference DOUBLE
        )
      `);
      const values = rows.map((r) => `('${r.id}', '${r.date}', ${r.amount}, ${r.bookValue || r.amount}, ${r.auditedValue !== void 0 ? r.auditedValue : "NULL"}, ${r.difference || 0})`).join(",");
      if (values.length > 0) {
        await this.dbService.execute(`INSERT INTO ${table} (id, date, amount, bookValue, auditedValue, difference) VALUES ${values}`);
      }
      return true;
    });
    import_electron.ipcMain.handle("query:getAggregates", async (event, table) => {
      try {
        const result = await this.dbService.query(`SELECT COUNT(*) as cnt, SUM(ABS(amount)) as val, MIN(amount) as min_amt, MAX(amount) as max_amt FROM ${table}`);
        const cnt = result[0]?.cnt || 0;
        const val = result[0]?.val || 0;
        const min_amt = result[0]?.min_amt || 0;
        const max_amt = result[0]?.max_amt || 0;
        return { totalAmount: val, rowCount: cnt, minAmount: min_amt, maxAmount: max_amt };
      } catch {
        return { totalAmount: 0, rowCount: 0, minAmount: 0, maxAmount: 0 };
      }
    });
    import_electron.ipcMain.handle("sampling:execute", async (event, config) => {
      console.log("IPC sampling:execute received", config);
      return await this.samplingService.runSampling(config);
    });
    import_electron.ipcMain.handle("export:project", async (event, state) => {
      console.log("IPC export:project received");
      const { canceled, filePath: projectPath } = await import_electron.dialog.showSaveDialog({
        title: "Save Project",
        filters: [{ name: "Audit Sample Project", extensions: ["audsmpl"] }]
      });
      if (!canceled && projectPath) {
        await this.exportService.exportProject(projectPath, state);
      }
    });
    import_electron.ipcMain.handle("export:excel", async (event, state) => {
      console.log("IPC export:excel received");
      const { canceled, filePath: excelPath } = await import_electron.dialog.showSaveDialog({
        title: "Export to Excel",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }]
      });
      if (!canceled && excelPath) {
        const dbPath = this.dbService.dbPath;
        if (dbPath) {
          await this.exportService.exportExcel(excelPath, dbPath, state.results);
        }
      }
    });
  }
};

// src/main/index.ts
var orchestrator;
var splash;
function createWindow() {
  splash = new import_electron2.BrowserWindow({
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
  splash.loadFile(path5.join(__dirname, "splash.html"));
  const win = new import_electron2.BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    // Don't show the main window immediately
    webPreferences: {
      preload: path5.join(__dirname, "preload.cjs"),
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
  } else {
    win.loadFile(path5.join(__dirname, "dist", "index.html"));
  }
  win.once("ready-to-show", () => {
    setTimeout(() => {
      if (splash) {
        splash.close();
        splash = null;
      }
      try {
        win.maximize();
        win.show();
      } catch (e) {
        console.error("Failed to maximize or show window", e);
      }
    }, 50);
  });
}
import_electron2.app.whenReady().then(createWindow);
import_electron2.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    import_electron2.app.quit();
  }
});
