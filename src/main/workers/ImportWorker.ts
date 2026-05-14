import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';

async function startTask() {
  const { filePath, config, dbPath, mode } = workerData;

  if (mode === 'preview') {
      try {
          if (filePath.endsWith('.csv')) {
              const text = fs.readFileSync(filePath, { encoding: 'utf-8', flag: 'r' });
              const lines = text.split('\n').filter(l => l.trim().length > 0).slice(0, 50);
              const data = lines.map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
              const headers = data.length > 0 ? data[0] : [];
              parentPort?.postMessage({ type: 'done', headers, data });
          } else if (filePath.endsWith('.xlsx')) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const ExcelJS = require('exceljs');
              const workbook = new ExcelJS.Workbook();
              await workbook.xlsx.readFile(filePath);
              const sheet = workbook.worksheets[0];
              const data: any[][] = [];
              let headers: string[] = [];
              
              sheet.eachRow((row, rowNumber) => {
                  if (rowNumber <= 50) {
                      const rowData = row.values as any[];
                      // exceljs 1-indexes the values array and the first element is empty
                      const cleanedRow = rowData.slice(1).map(v => typeof v === 'object' && v !== null && 'text' in v ? v.text : v);
                      if (rowNumber === 1) headers = cleanedRow.map(String);
                      data.push(cleanedRow);
                  }
              });
              parentPort?.postMessage({ type: 'done', headers, data });
          }
      } catch (err: any) {
          parentPort?.postMessage({ type: 'error', error: err.message });
      }
      return;
  }

  // mode === 'import'
  try {
    parentPort?.postMessage({ type: 'progress', pct: 10, stage: 'Opening file...' });
    
    // Convert mapping config
    const { activeIndices, startRow } = config;

    if (filePath.endsWith('.csv')) {
      parentPort?.postMessage({ type: 'progress', pct: 50, stage: 'Importing via DuckDB...' });
      
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const duckdb = require('duckdb');
      const db = new duckdb.Database(dbPath);
      const con = db.connect();
      
      // Load raw into temp, then insert into population mapped
      con.exec(`
        CREATE TEMPORARY TABLE temp_raw AS SELECT * FROM read_csv_auto('${filePath.replace(/\\/g, '/')}');
      `, (err: any) => {
         if (err) {
            db.close();
            parentPort?.postMessage({ type: 'error', error: err.message });
            return;
         }
         parentPort?.postMessage({ type: 'progress', pct: 75, stage: 'Mapping columns...' });
         
         con.all(`PRAGMA table_info('temp_raw')`, (infoErr: any, columns: any[]) => {
            if (infoErr) {
               db.close();
               parentPort?.postMessage({ type: 'error', error: infoErr.message });
               return;
            }
            const keys = columns.map(c => c.name);
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

            con.exec(insertQuery, (insertErr: any) => {
               if (insertErr) {
                   db.close();
                   parentPort?.postMessage({ type: 'error', error: insertErr.message });
                   return;
               }

               con.all('SELECT COUNT(*) as cnt FROM population', (countErr: any, rows: any[]) => {
                   db.close();
                   parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
                   parentPort?.postMessage({ type: 'done', rowCount: rows[0].cnt, columns: keys });
               });
            });
         });
      });

    } else if (filePath.endsWith('.xlsx')) {
       // eslint-disable-next-line @typescript-eslint/no-require-imports
       const ExcelJS = require('exceljs');
       const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
          worksheets: "emit",
          styles: "drop",
       });
       
       // eslint-disable-next-line @typescript-eslint/no-require-imports
       const duckdb = require('duckdb');
       const db = new duckdb.Database(dbPath);
       const con = db.connect();
       
       const stmt = con.prepare('INSERT INTO population (id, date, amount, bookValue, difference) VALUES (?, ?, ?, ?, ?)');
       
       let parseCount = 0;
       
       for await (const worksheet of workbook) {
           for await (const row of worksheet) {
               parseCount++;
               if (parseCount >= startRow) {
                   const rValues = row.values as any[];
                   // 1-indexed shift
                   const r = rValues.slice(1);
                   
                   const idv = r[activeIndices.id];
                   const dt = r[activeIndices.date];
                   const amtRaw = r[activeIndices.amount];
                   
                   const idVal = String(typeof idv === 'object' && idv !== null && 'text' in idv ? idv.text : (idv || ''));
                   const dateVal = String(typeof dt === 'object' && dt !== null && 'text' in dt ? dt.text : (dt || ''));
                   const amountVal = parseFloat(typeof amtRaw === 'object' && amtRaw !== null && 'text' in amtRaw ? amtRaw.text : amtRaw) || 0;
                   
                   stmt.run(idVal, dateVal, amountVal, amountVal, amountVal);
               }
               
               if (parseCount % 10000 === 0) {
                   parentPort?.postMessage({ type: 'progress', pct: Math.min(90, 10 + (parseCount / 10000)), stage: `Parsing ${parseCount} rows...` });
               }
           }
       }
       
       stmt.finalize();
       db.close();
       
       parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
       parentPort?.postMessage({ type: 'done', rowCount: (parseCount - startRow + 1), columns: [] });
    }
    
  } catch (err: any) {
    parentPort?.postMessage({ type: 'error', error: err.message });
  }
}

startTask();
