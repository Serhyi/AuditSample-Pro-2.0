import { parentPort, workerData } from 'worker_threads';
import * as ExcelJS from 'exceljs';
import * as duckdb from 'duckdb';

async function runExport() {
  const { dbPath, excelPath, results } = workerData;
  parentPort?.postMessage({ type: 'progress', pct: 0, stage: 'Starting export...' });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: excelPath,
    useStyles: true,
  });

  try {
    const db = new duckdb.Database(dbPath);
    const connection = db.connect();

    parentPort?.postMessage({ type: 'progress', pct: 10, stage: 'Writing sumary...' });

    // Write Summary Sheet mapping results
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['Method', results.method]);
    summarySheet.addRow(['Sample Size', results.sampleSize]);
    summarySheet.addRow(['Projected Misstatement', results.projectedMisstatement]);
    summarySheet.addRow(['Upper Bound', results.upperMisstatementBound]);
    summarySheet.commit();

    // Stream results or population from DB
    // To do this, we stream records from duckdb
    parentPort?.postMessage({ type: 'progress', pct: 30, stage: 'Exporting records...' });
    
    // (A real implementation would iterate using duckdb stream)
    const dataSheet = workbook.addWorksheet('Data');
    dataSheet.addRow(['ID', 'Date', 'Amount', 'Book Value', 'Audited Value', 'Difference']);

    // Use connection.each for row-by-row streaming to bypass memory limits
    let count = 0;
    
    connection.each("SELECT * FROM population", (err, row: any) => {
        if (err) throw err;
        dataSheet.addRow([row.id, row.date, row.amount, row.bookValue, row.auditedValue, row.difference]).commit();
        count++;
        if (count % 10000 === 0) {
            parentPort?.postMessage({ type: 'progress', pct: 30 + Math.min(60, Math.floor((count / 100000) * 60)), stage: `Exporting rows... ${count}` });
        }
    }, (err) => {
        if (err) throw err;
        dataSheet.commit();
        workbook.commit().then(() => {
            parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
            parentPort?.postMessage({ type: 'done' });
        });
    });

  } catch (error) {
    if (error instanceof Error) {
        parentPort?.postMessage({ type: 'error', message: error.message });
    } else {
        parentPort?.postMessage({ type: 'error', message: String(error) });
    }
  }
}

runExport();
