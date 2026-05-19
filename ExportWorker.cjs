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

// src/main/workers/ExportWorker.ts
var import_worker_threads = require("worker_threads");
var ExcelJS = __toESM(require("exceljs"), 1);
var fs = __toESM(require("fs"), 1);
async function runExport() {
  const { dbPath, excelPath, results } = import_worker_threads.workerData;
  import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 0, stage: "Starting export..." });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: excelPath,
    useStyles: true
  });
  try {
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs();
    const fb = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
    if (!fb) throw new Error("Database file missing");
    const db = new SQL.Database(fb);
    import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 10, stage: "Writing sumary..." });
    const summarySheet = workbook.addWorksheet("Summary");
    summarySheet.addRow(["Method", results.method]);
    summarySheet.addRow(["Sample Size", results.sampleSize]);
    summarySheet.addRow(["Projected Misstatement", results.projectedMisstatement]);
    summarySheet.addRow(["Upper Bound", results.upperMisstatementBound]);
    summarySheet.commit();
    import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 30, stage: "Exporting records..." });
    const dataSheet = workbook.addWorksheet("Data");
    dataSheet.addRow(["ID", "Date", "Amount", "Book Value", "Audited Value", "Difference"]);
    let count = 0;
    const stmt = db.prepare("SELECT * FROM population");
    while (stmt.step()) {
      const row = stmt.getAsObject();
      dataSheet.addRow([row.id, row.date, row.amount, row.bookValue, row.auditedValue, row.difference]).commit();
      count++;
      if (count % 1e4 === 0) {
        import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 30 + Math.min(60, Math.floor(count / 1e5 * 60)), stage: `Exporting rows... ${count}` });
      }
    }
    stmt.free();
    db.close();
    dataSheet.commit();
    await workbook.commit();
    import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 100, stage: "Complete" });
    import_worker_threads.parentPort?.postMessage({ type: "done" });
  } catch (error) {
    if (error instanceof Error) {
      import_worker_threads.parentPort?.postMessage({ type: "error", message: error.message });
    } else {
      import_worker_threads.parentPort?.postMessage({ type: "error", message: String(error) });
    }
  }
}
runExport();
