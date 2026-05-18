import { parentPort, workerData } from 'worker_threads';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';

async function runExport() {
  const { dbPath, excelPath, results } = workerData;
  parentPort?.postMessage({ type: 'progress', pct: 0, stage: 'Starting export...' });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: excelPath,
    useStyles: true,
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const fb = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
    if (!fb) throw new Error("Database file missing");
    const db = new SQL.Database(fb);

    parentPort?.postMessage({ type: 'progress', pct: 10, stage: 'Writing sumary...' });

    // Write Summary Sheet mapping results
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['Method', results.method]);
    summarySheet.addRow(['Sample Size', results.sampleSize]);
    summarySheet.addRow(['Projected Misstatement', results.projectedMisstatement]);
    summarySheet.addRow(['Upper Bound', results.upperMisstatementBound]);
    summarySheet.commit();

    // Stream results or population from DB
    parentPort?.postMessage({ type: 'progress', pct: 30, stage: 'Exporting records...' });
    
    const dataSheet = workbook.addWorksheet('Data');
    dataSheet.addRow(['ID', 'Date', 'Amount', 'Book Value', 'Audited Value', 'Difference']);

    let count = 0;
    
    const stmt = db.prepare('SELECT * FROM population');
    while (stmt.step()) {
        const row = stmt.getAsObject();
        dataSheet.addRow([row.id, row.date, row.amount, row.bookValue, row.auditedValue, row.difference]).commit();
        count++;
        if (count % 10000 === 0) {
            parentPort?.postMessage({ type: 'progress', pct: 30 + Math.min(60, Math.floor((count / 100000) * 60)), stage: `Exporting rows... ${count}` });
        }
    }
    stmt.free();
    db.close();

    dataSheet.commit();
    await workbook.commit();
    
    parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
    parentPort?.postMessage({ type: 'done' });
  } catch (error) {
    if (error instanceof Error) {
        parentPort?.postMessage({ type: 'error', message: error.message });
    } else {
        parentPort?.postMessage({ type: 'error', message: String(error) });
    }
  }
}

runExport();
