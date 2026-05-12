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

// src/main/workers/ImportWorker.ts
var import_worker_threads = require("worker_threads");
var fs = __toESM(require("fs"), 1);
async function startTask() {
  const { filePath, config, dbPath, mode } = import_worker_threads.workerData;
  if (mode === "preview") {
    try {
      if (filePath.endsWith(".csv")) {
        const text = fs.readFileSync(filePath, { encoding: "utf-8", flag: "r" });
        const lines = text.split("\n").filter((l) => l.trim().length > 0).slice(0, 50);
        const data = lines.map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
        const headers = data.length > 0 ? data[0] : [];
        import_worker_threads.parentPort?.postMessage({ type: "done", headers, data });
      } else if (filePath.endsWith(".xlsx")) {
        const ExcelJS = require("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const sheet = workbook.worksheets[0];
        const data = [];
        let headers = [];
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber <= 50) {
            const rowData = row.values;
            const cleanedRow = rowData.slice(1).map((v) => typeof v === "object" && v !== null && "text" in v ? v.text : v);
            if (rowNumber === 1) headers = cleanedRow.map(String);
            data.push(cleanedRow);
          }
        });
        import_worker_threads.parentPort?.postMessage({ type: "done", headers, data });
      }
    } catch (err) {
      import_worker_threads.parentPort?.postMessage({ type: "error", error: err.message });
    }
    return;
  }
  try {
    import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 10, stage: "Opening file..." });
    const { activeIndices, startRow } = config;
    const idIdx = activeIndices.id + 1;
    if (filePath.endsWith(".csv")) {
      import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 50, stage: "Importing via DuckDB..." });
      const duckdb = require("duckdb");
      const db = new duckdb.Database(dbPath);
      const con = db.connect();
      con.exec(`
        CREATE TEMPORARY TABLE temp_raw AS SELECT * FROM read_csv_auto('${filePath.replace(/\\/g, "/")}');
      `, (err) => {
        if (err) {
          db.close();
          import_worker_threads.parentPort?.postMessage({ type: "error", error: err.message });
          return;
        }
        import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 75, stage: "Mapping columns..." });
        con.all(`PRAGMA table_info('temp_raw')`, (infoErr, columns) => {
          if (infoErr) {
            db.close();
            import_worker_threads.parentPort?.postMessage({ type: "error", error: infoErr.message });
            return;
          }
          const keys = columns.map((c) => c.name);
          const idKey = keys[activeIndices.id] ? `"${keys[activeIndices.id]}"` : "NULL::VARCHAR";
          const dateKey = keys[activeIndices.date] ? `"${keys[activeIndices.date]}"` : "NULL::VARCHAR";
          const amtKey = keys[activeIndices.amount] ? `"${keys[activeIndices.amount]}"` : "0::DOUBLE";
          const insertQuery = `
              INSERT INTO population (id, date, amount, bookValue, difference)
              SELECT 
                CAST(${idKey} AS VARCHAR), 
                CAST(${dateKey} AS VARCHAR), 
                TRY_CAST(${amtKey} AS DOUBLE), 
                TRY_CAST(${amtKey} AS DOUBLE), 
                TRY_CAST(${amtKey} AS DOUBLE)
              FROM temp_raw
              OFFSET ${startRow - 1}
            `;
          con.exec(insertQuery, (insertErr) => {
            if (insertErr) {
              db.close();
              import_worker_threads.parentPort?.postMessage({ type: "error", error: insertErr.message });
              return;
            }
            con.all("SELECT COUNT(*) as cnt FROM population", (countErr, rows) => {
              db.close();
              import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 100, stage: "Complete" });
              import_worker_threads.parentPort?.postMessage({ type: "done", rowCount: rows[0].cnt, columns: keys });
            });
          });
        });
      });
    } else if (filePath.endsWith(".xlsx")) {
      const ExcelJS = require("exceljs");
      const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
        worksheets: "emit",
        styles: "drop"
      });
      const duckdb = require("duckdb");
      const db = new duckdb.Database(dbPath);
      const con = db.connect();
      const stmt = con.prepare("INSERT INTO population (id, date, amount, bookValue, difference) VALUES (?, ?, ?, ?, ?)");
      let parseCount = 0;
      for await (const worksheet of workbook) {
        for await (const row of worksheet) {
          parseCount++;
          if (parseCount >= startRow) {
            const rValues = row.values;
            const r = rValues.slice(1);
            const idv = r[activeIndices.id];
            const dt = r[activeIndices.date];
            const amtRaw = r[activeIndices.amount];
            const idVal = String(typeof idv === "object" && idv !== null && "text" in idv ? idv.text : idv || "");
            const dateVal = String(typeof dt === "object" && dt !== null && "text" in dt ? dt.text : dt || "");
            const amountVal = parseFloat(typeof amtRaw === "object" && amtRaw !== null && "text" in amtRaw ? amtRaw.text : amtRaw) || 0;
            stmt.run(idVal, dateVal, amountVal, amountVal, amountVal);
          }
          if (parseCount % 1e4 === 0) {
            import_worker_threads.parentPort?.postMessage({ type: "progress", pct: Math.min(90, 10 + parseCount / 1e4), stage: `Parsing ${parseCount} rows...` });
          }
        }
      }
      stmt.finalize();
      db.close();
      import_worker_threads.parentPort?.postMessage({ type: "progress", pct: 100, stage: "Complete" });
      import_worker_threads.parentPort?.postMessage({ type: "done", rowCount: parseCount - startRow + 1, columns: [] });
    }
  } catch (err) {
    import_worker_threads.parentPort?.postMessage({ type: "error", error: err.message });
  }
}
startTask();
