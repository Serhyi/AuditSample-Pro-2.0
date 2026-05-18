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
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();
      const fb = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
      const db = fb ? new SQL.Database(fb) : new SQL.Database();
      
      parentPort?.postMessage({ type: 'progress', pct: 60, stage: 'Creating schema...' });
      
      try {
        db.run(`
          DROP TABLE IF EXISTS population;
          CREATE TABLE population (
            id VARCHAR,
            date VARCHAR,
            amount DOUBLE,
            bookValue DOUBLE,
            auditedValue DOUBLE,
            difference DOUBLE
          );
        `);
      } catch (createErr: any) {
          parentPort?.postMessage({ type: 'error', error: createErr.message });
          return;
      }
      
      parentPort?.postMessage({ type: 'progress', pct: 75, stage: 'Loading JSON/CSV...' });
      
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Papa = require('papaparse');
      const fileText = fs.readFileSync(filePath, 'utf-8');
      
      const parsed = Papa.parse(fileText, {
          header: true,
          skipEmptyLines: true
      });
      
      const rows = parsed.data;
      const keys = parsed.meta.fields || [];
      const idKey = keys[activeIndices.id] || null;
      const dateKey = keys[activeIndices.date] || null;
      const amtKey = keys[activeIndices.amount] || null;

      const stmt = db.prepare('INSERT INTO population (id, date, amount, bookValue, difference) VALUES (?, ?, ?, ?, ?)');
      
      let inserted = 0;
      for (let i = startRow - 1; i < rows.length; i++) {
         const row = rows[i];
         const idv = idKey ? row[idKey] : "";
         const dtv = dateKey ? row[dateKey] : "";
         const amtRaw = amtKey ? row[amtKey] : 0;
         
         const amountVal = parseFloat(amtRaw) || 0;
         
         stmt.run([idv, dtv, amountVal, amountVal, amountVal]);
         inserted++;
         
         if (inserted % 10000 === 0) {
             parentPort?.postMessage({ type: 'progress', pct: Math.min(90, 75 + (inserted / rows.length * 15)), stage: `Parsing ${inserted} rows...` });
         }
      }
      
      stmt.free();
      
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
      db.close();

      parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
      parentPort?.postMessage({ type: 'done', rowCount: inserted, columns: keys });

    } else if (filePath.endsWith('.xlsx')) {
       // eslint-disable-next-line @typescript-eslint/no-require-imports
       const ExcelJS = require('exceljs');
       const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
          worksheets: "emit",
          styles: "drop",
       });
       
       // eslint-disable-next-line @typescript-eslint/no-require-imports
       const initSqlJs = require('sql.js');
       const SQL = await initSqlJs();
       const fb = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
       const db = fb ? new SQL.Database(fb) : new SQL.Database();
       
       db.run(`
         DROP TABLE IF EXISTS population;
         CREATE TABLE population (
           id VARCHAR,
           date VARCHAR,
           amount DOUBLE,
           bookValue DOUBLE,
           auditedValue DOUBLE,
           difference DOUBLE
         );
       `);
       
       const stmt = db.prepare('INSERT INTO population (id, date, amount, bookValue, difference) VALUES (?, ?, ?, ?, ?)');
       
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
                   
                   stmt.run([idVal, dateVal, amountVal, amountVal, amountVal]);
               }
               
               if (parseCount % 10000 === 0) {
                   parentPort?.postMessage({ type: 'progress', pct: Math.min(90, 10 + (parseCount / 10000)), stage: `Parsing ${parseCount} rows...` });
               }
           }
       }
       
       stmt.free();
       const data = db.export();
       fs.writeFileSync(dbPath, Buffer.from(data));
       db.close();
       
       parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
       parentPort?.postMessage({ type: 'done', rowCount: (parseCount - startRow + 1), columns: [] });
    }
    
  } catch (err: any) {
    parentPort?.postMessage({ type: 'error', error: err.message });
  }
}

startTask();
