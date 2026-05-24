import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';

function parseAmount(val: any): number {
    if (typeof val === 'number') return val;
    if (val === null || val === undefined) return 0;
    let str = String(val).replace(/[\s\u00A0\u202F$€£₴]/g, '').trim();
    if (!str) return 0;
    if (str.startsWith('(') && str.endsWith(')')) str = '-' + str.slice(1, -1);
    
    if (str.includes(',') && str.includes('.')) {
        const lastComma = str.lastIndexOf(',');
        const lastDot = str.lastIndexOf('.');
        if (lastComma > lastDot) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
        else return parseFloat(str.replace(/,/g, '')) || 0;
    }
    
    if (str.includes(',')) {
        const parts = str.split(',');
        if (parts.length > 2) return parseFloat(str.replace(/,/g, '')) || 0;
        if (parts[parts.length - 1].length === 3) return parseFloat(str.replace(/,/g, '')) || 0;
        return parseFloat(str.replace(/,/g, '.')) || 0;
    }
    
    if (str.includes('.')) {
        const parts = str.split('.');
        if (parts.length > 2) return parseFloat(str.replace(/\./g, '')) || 0;
        if (parts[parts.length - 1].length === 3) return parseFloat(str.replace(/\./g, '')) || 0;
        return parseFloat(str) || 0;
    }
    
    return parseFloat(str) || 0;
}

async function startTask() {
  const { filePath, config, dbPath, mode } = workerData;

  if (mode === 'preview') {
      try {
        if (filePath.endsWith('.csv')) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Papa = require('papaparse');
            
            const fd = fs.openSync(filePath, 'r');
            const buf = Buffer.alloc(4096);
            const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
            fs.closeSync(fd);
            
            let isUtf8 = true;
            try {
                new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, bytesRead));
            } catch {
                isUtf8 = false;
            }

            const sampleText = isUtf8 
                ? buf.toString('utf8', 0, bytesRead)
                : new TextDecoder('windows-1251').decode(buf.subarray(0, bytesRead));
            
            let detectedDelimiter = "";
            const lines = sampleText.split('\n');
            const firstLine = lines[0] || "";
            
            const headerSemi = (firstLine.match(/;/g) || []).length;
            const headerComma = (firstLine.match(/,/g) || []).length;
            const headerTab = (firstLine.match(/\t/g) || []).length;
            
            if (headerSemi > headerComma && headerSemi > headerTab) detectedDelimiter = ';';
            else if (headerTab > headerComma && headerTab > headerSemi) detectedDelimiter = '\t';
            else if (headerComma > headerSemi && headerComma > headerTab) detectedDelimiter = ',';
            else {
                const firstLines = lines.slice(0, 5).join('\n');
                const semiCount = (firstLines.match(/;/g) || []).length;
                const commaCount = (firstLines.match(/,/g) || []).length;
                const tabCount = (firstLines.match(/\t/g) || []).length;
                if (semiCount > commaCount && semiCount > tabCount) detectedDelimiter = ';';
                else if (tabCount > commaCount && tabCount > semiCount) detectedDelimiter = '\t';
                else if (commaCount > semiCount && commaCount > tabCount) detectedDelimiter = ',';
            }

            const results = Papa.parse(sampleText, {
                skipEmptyLines: true,
                ...(detectedDelimiter ? { delimiter: detectedDelimiter } : {})
            });

            const rawData = results.data;
            const data: any[][] = [];
            for (let i = 0; i < rawData.length; i++) {
                if (i > 50) break;
                const row = rawData[i] as any[];
                while (row.length > 0 && (row[row.length - 1] === null || row[row.length - 1] === undefined || String(row[row.length - 1]).trim() === '')) {
                    row.pop();
                }
                data.push(row);
            }

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
      parentPort?.postMessage({ type: 'progress', pct: 50, stage: 'Importing...' });
      
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
            difference DOUBLE,
            originalRow TEXT
          );
        `);
      } catch (createErr: any) {
          parentPort?.postMessage({ type: 'error', error: createErr.message });
          return;
      }
      
      parentPort?.postMessage({ type: 'progress', pct: 75, stage: 'Loading JSON/CSV...' });
      
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Papa = require('papaparse');
      
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);

        let isUtf8 = true;
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, bytesRead));
        } catch {
            isUtf8 = false;
        }

        const sampleText = isUtf8 
            ? buf.toString('utf8', 0, bytesRead)
            : new TextDecoder('windows-1251').decode(buf.subarray(0, bytesRead));
              
        let detectedDelimiter = "";
        const lines = sampleText.split('\n');
        const firstLine = lines[0] || "";
        
        const headerSemi = (firstLine.match(/;/g) || []).length;
        const headerComma = (firstLine.match(/,/g) || []).length;
        const headerTab = (firstLine.match(/\t/g) || []).length;
        
        if (headerSemi > headerComma && headerSemi > headerTab) detectedDelimiter = ';';
        else if (headerTab > headerComma && headerTab > headerSemi) detectedDelimiter = '\t';
        else if (headerComma > headerSemi && headerComma > headerTab) detectedDelimiter = ',';
        else {
            const firstLines = lines.slice(0, 5).join('\n');
            const semiCount = (firstLines.match(/;/g) || []).length;
            const commaCount = (firstLines.match(/,/g) || []).length;
            const tabCount = (firstLines.match(/\t/g) || []).length;
            if (semiCount > commaCount && semiCount > tabCount) detectedDelimiter = ';';
            else if (tabCount > commaCount && tabCount > semiCount) detectedDelimiter = '\t';
            else if (commaCount > semiCount && commaCount > tabCount) detectedDelimiter = ',';
        }

        let fileStream;
        if (!isUtf8) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const iconv = require('iconv-lite');
            fileStream = fs.createReadStream(filePath).pipe(iconv.decodeStream('win1251'));
        } else {
            fileStream = fs.createReadStream(filePath, 'utf-8');
        }
      
      const stmt = db.prepare('INSERT INTO population (id, date, amount, bookValue, difference, originalRow) VALUES (?, ?, ?, ?, ?, ?)');
      db.run('BEGIN TRANSACTION;');
      
      let inserted = 0;
      let keys: string[] = [];

      await new Promise<void>((resolve, reject) => {
          let rowCount = 0;
          Papa.parse(fileStream, {
              header: false,
              skipEmptyLines: true,
              ...(detectedDelimiter ? { delimiter: detectedDelimiter } : {}),
              chunk: function(results: any) {
                  for (let i = 0; i < results.data.length; i++) {
                      rowCount++;
                      if (rowCount === Math.max(1, startRow - 1)) {
                          keys = results.data[i].map(String);
                      }

                      if (rowCount >= startRow) {
                          const row = results.data[i];
                          const idv = row[activeIndices.id] !== undefined ? row[activeIndices.id] : "";
                          const dtv = row[activeIndices.date] !== undefined ? row[activeIndices.date] : "";
                          const amtRaw = row[activeIndices.amount] !== undefined ? row[activeIndices.amount] : 0;
                          
                          const amountVal = parseAmount(amtRaw);
                          const rowArray = Array.isArray(row) ? row.map(String) : [];
                          
                          stmt.run([String(idv), String(dtv), amountVal, amountVal, amountVal, JSON.stringify(rowArray)]);
                          inserted++;
                          
                          if (inserted % 50000 === 0) {
                              db.run('COMMIT; BEGIN TRANSACTION;');
                          }
                          
                          if (inserted % 10000 === 0) {
                              parentPort?.postMessage({ type: 'progress', pct: Math.min(90, 75 + (inserted / 1000000 * 15)), stage: `Parsing ${inserted} rows...` });
                          }
                      }
                  }
              },
              complete: function() {
                  resolve();
              },
              error: function(err: any) {
                  reject(err);
              }
          });
      });
      
      db.run('COMMIT;');
      stmt.free();
      
      parentPort?.postMessage({ type: 'progress', pct: 95, stage: 'Creating indices (1/2)...' });
      db.run('CREATE INDEX IF NOT EXISTS idx_abs_amount ON population(ABS(amount));');
      parentPort?.postMessage({ type: 'progress', pct: 98, stage: 'Creating indices (2/2)...' });
      db.run('CREATE INDEX IF NOT EXISTS idx_amount ON population(amount);');
      
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
      db.close();

      parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
      parentPort?.postMessage({ type: 'done', rowCount: inserted, columns: keys });

    } else if (filePath.endsWith('.xlsx')) {
       // eslint-disable-next-line @typescript-eslint/no-require-imports
       const ExcelJS = require('exceljs');
       
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
           difference DOUBLE,
           originalRow TEXT
         );
       `);
       
       const stmt = db.prepare('INSERT INTO population (id, date, amount, bookValue, difference, originalRow) VALUES (?, ?, ?, ?, ?, ?)');
       
       db.run('BEGIN TRANSACTION;');
       let parseCount = 0;
       
       const workbook = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
          worksheets: "emit",
          styles: "drop",
       });

       for await (const worksheet of workbook) {
           for await (const row of worksheet) {
               parseCount++;
               if (parseCount >= startRow) {
                   const rValues = row.values as any[];
                   const r = rValues.slice(1);
                   
                   const idv = r[activeIndices.id];
                   const dt = r[activeIndices.date];
                   const amtRaw = r[activeIndices.amount];
                   
                   const idVal = String(typeof idv === 'object' && idv !== null && 'text' in idv ? idv.text : (idv || ''));
                   const dateVal = String(typeof dt === 'object' && dt !== null && 'text' in dt ? dt.text : (dt || ''));
                   const amountVal = parseAmount(typeof amtRaw === 'object' && amtRaw !== null && 'text' in amtRaw ? amtRaw.text : (typeof amtRaw === 'object' && amtRaw !== null && 'result' in amtRaw ? amtRaw.result : amtRaw));
                   
                   const cleanRowArray = r.map((v: any) => typeof v === 'object' && v !== null && 'result' in v ? v.result : (typeof v === 'object' && v !== null && 'text' in v ? v.text : v));
                   
                   stmt.run([idVal, dateVal, amountVal, amountVal, amountVal, JSON.stringify(cleanRowArray)]);
               }
               if (parseCount % 50000 === 0) db.run('COMMIT; BEGIN TRANSACTION;');
               if (parseCount % 10000 === 0) parentPort?.postMessage({ type: 'progress', pct: Math.min(90, 10 + (parseCount / 10000)), stage: `Parsing ${parseCount} rows...` });
           }
           break; // only first worksheet
       }
       
       db.run('COMMIT;');
       stmt.free();
       
       parentPort?.postMessage({ type: 'progress', pct: 95, stage: 'Creating indices (1/2)...' });
       db.run('CREATE INDEX IF NOT EXISTS idx_abs_amount ON population(ABS(amount));');
       parentPort?.postMessage({ type: 'progress', pct: 98, stage: 'Creating indices (2/2)...' });
       db.run('CREATE INDEX IF NOT EXISTS idx_amount ON population(amount);');
       
       const data = db.export();
       fs.writeFileSync(dbPath, Buffer.from(data));
       db.close();
       
       parentPort?.postMessage({ type: 'progress', pct: 100, stage: 'Complete' });
       parentPort?.postMessage({ type: 'done', rowCount: Math.max(0, parseCount - startRow + 1), columns: [] });
    }
    
  } catch (err: any) {
    parentPort?.postMessage({ type: 'error', error: err.message });
  }
}

startTask();
