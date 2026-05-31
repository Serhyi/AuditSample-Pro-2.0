import { ipcMain, dialog, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { DatabaseService } from '../services/DatabaseService';
import { ImportService } from '../services/ImportService';
import { SamplingService } from '../services/SamplingService';
import { ExportService } from '../services/ExportService';
import { WorkerPool } from './WorkerPool';

export class AppOrchestrator {
  private dbService: DatabaseService;
  private importService: ImportService;
  private samplingService: SamplingService;
  private exportService: ExportService;
  private workerPool: WorkerPool;

  constructor() {
    this.dbService = new DatabaseService();
    this.workerPool = new WorkerPool();
    this.importService = new ImportService(this.dbService, this.workerPool);
    this.samplingService = new SamplingService(this.dbService);
    this.exportService = new ExportService(this.dbService, this.workerPool);
  }

  public registerIpcHandlers() {
    ipcMain.handle('import:start', async (event, filePath, config) => {
      console.log('IPC import:start received', filePath, config);
      const result = await this.importService.importFile(filePath, config, (pct, stage) => {
          event.sender.send('import:progress', pct, stage);
      });
      
      // Now initialize using the db path created by the worker
      await this.dbService.close();
      const directory = path.dirname(result.dbPath);
      const id = path.basename(result.dbPath, '.sqlite');
      await this.dbService.initialize(id, directory);
      
      return result;
    });

    ipcMain.handle('import:preview', async (event, filePath) => {
      return await this.importService.previewFile(filePath);
    });

    ipcMain.handle('import:detect-xlsx-project', async (_event, filePath) => {
      // Returns project payload if this xlsx is an exported AuditSample project, otherwise null
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

        const sampleSheet = workbook.getWorksheet('Вибірка') || workbook.getWorksheet('Sample');
        if (!sampleSheet) return null;

        const summarySheet = workbook.getWorksheet('Опис та результат') || workbook.getWorksheet('Description and Result');

        const getCellValue = (v: any): any => {
          if (v === null || v === undefined) return null;
          if (typeof v === 'object' && 'result' in v) return v.result;
          if (typeof v === 'object' && 'text' in v) return v.text;
          if (typeof v === 'object' && 'richText' in v) return v.richText.map((r: any) => r.text).join('');
          return v;
        };
        const parseAmount = (v: any): number => {
          if (v === null || v === undefined || v === '') return 0;
          const s = String(v).replace(/[^\d.,-]/g, '').replace(',', '.');
          return parseFloat(s) || 0;
        };

        // Extract summary info
        const extractSummaryInfo = (sheet: any) => {
          if (!sheet) return null;
          let populationSize = 0, populationValue = 0, projectedMisstatement = 0,
              upperMisstatementBound = 0, sampleSize = 0, trivialCount = 0,
              tolerableMisstatement = 0, confidenceLevel = 95, methodStr = 'MUS';
          let configJson: any = null;
          sheet.eachRow((row: any) => {
            const lbl = String(getCellValue(row.getCell(1).value) || '').trim();
            const val = getCellValue(row.getCell(2).value);
            if (lbl === '__AUDITSAMPLE_CONFIG__' && val) {
              try { configJson = JSON.parse(String(val)); } catch { configJson = null; }
            }
            if (lbl.includes('Метод')) methodStr = String(val || 'MUS');
            if (lbl.includes('Обсяг ген. сукупності') || lbl.includes('Population Size')) populationSize = parseInt(String(val || '0').replace(/\D/g, '')) || 0;
            if (lbl.includes('ГЕНЕРАЛЬНА СУКУПНІСТЬ') || lbl.includes('TOTAL POPULATION') || lbl.includes('Population Value') || lbl.includes('Сума (Сукупність)')) populationValue = parseAmount(val);
            if (lbl.includes('PM') || lbl.includes('Допустиме')) tolerableMisstatement = parseAmount(val);
            if (lbl.includes('Рівень впевненості') || lbl.includes('Confidence')) confidenceLevel = parseAmount(val);
            if (lbl.includes('ОБСЯГ ВИБІРКИ') || lbl.includes('SAMPLE SIZE')) sampleSize = parseInt(String(val || '0').replace(/\D/g, '')) || 0;
            if (lbl.includes('Кількість ВНС') || lbl.includes('CTT Items Count') || lbl.includes('Тривіальних') || lbl.includes('Trivial')) trivialCount = parseAmount(val);
            if (lbl.includes('Прогнозоване викривлення') || lbl.includes('Projected Misstatement')) projectedMisstatement = parseAmount(val);
            if (lbl.includes('Верхня межа викривлення') || lbl.includes('Upper Misstatement Bound') || lbl.includes('Максимальна помилка')) upperMisstatementBound = parseAmount(val);
          });
          return { populationSize, populationValue, projectedMisstatement, upperMisstatementBound,
                   sampleSize, trivialCount, tolerableMisstatement, confidenceLevel,
                   method: methodStr, config: configJson };
        };

        const extractSheet = (sheet: any) => {
          if (!sheet) return { items: [], headers: [] };
          const items: any[] = [];
          const sourceHeaders: string[] = [];
          const headerRow = sheet.getRow(1);
          let docCol = -1, audCol = -1, diffCol = -1, commentCol = -1;
          for (let c = 1; c <= sheet.columnCount; c++) {
            const v = String(getCellValue(headerRow.getCell(c).value) || '');
            if (v.includes('Облікова сума') || v.includes('Book Value')) docCol = c;
            if (v.includes('Аудиторська сума') || v.includes('Audit Value')) audCol = c;
            if (v.includes('Різниця') || v.includes('Difference')) diffCol = c;
            if (v.includes('Коментарі') || v.includes('Comments')) commentCol = c;
          }
          if (diffCol === -1) diffCol = audCol !== -1 ? audCol + 1 : -1;
          if (commentCol === -1) commentCol = audCol !== -1 ? audCol + 2 : -1;
          const baseN = docCol !== -1 ? docCol - 1 : Math.max(0, sheet.columnCount - 4);
          for (let c = 1; c <= baseN; c++) sourceHeaders.push(String(getCellValue(headerRow.getCell(c).value) || ''));
          for (let r = 2; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const originalRow = [];
            for (let c = 1; c <= baseN; c++) originalRow.push(getCellValue(row.getCell(c).value));
            const bookVal = docCol !== -1 ? parseAmount(getCellValue(row.getCell(docCol).value)) : 0;
            const auditValRaw = audCol !== -1 ? getCellValue(row.getCell(audCol).value) : null;
            const commentsVal = commentCol !== -1 ? String(getCellValue(row.getCell(commentCol).value) || '') : '';
            const auditVal = auditValRaw !== null && auditValRaw !== '' ? parseAmount(auditValRaw) : '';
            // Always recalculate: exported formula is BookValue-AuditValue, ExcelJS writes without cached result
            const diffVal = typeof auditVal === 'number'
              ? Math.round((bookVal - auditVal) * 100) / 100
              : 0;
            if (bookVal === 0 && originalRow.every(v => v === null || v === '')) continue;
            items.push({ id: `row-${r - 1}`, amount: bookVal, bookValue: bookVal,
                         originalRow, auditedValue: auditVal, difference: diffVal, comments: commentsVal });
          }
          return { items, headers: sourceHeaders };
        };

        const summaryData = extractSummaryInfo(summarySheet);
        const sampleData = extractSheet(sampleSheet);
        const keySheet = workbook.getWorksheet('Ключові') || workbook.getWorksheet('Key');
        const keyData = extractSheet(keySheet);
        const popSheet = workbook.getWorksheet('Генеральна сукупність') || workbook.getWorksheet('Population');
        const popData = extractSheet(popSheet);

        return {
          samplingItems: sampleData.items,
          keyItems: keyData.items,
          population: popData.items.map((i: any) => ({ ...i, amount: i.bookValue })),
          sourceHeaders: sampleData.headers.length > 0 ? sampleData.headers : (popData.headers || []),
          summaryData
        };
      } catch (e: any) {
        console.error('detect-xlsx-project error', e);
        return null;
      }
    });

    ipcMain.handle('import:project', async (event, filePath) => {
      console.log('IPC import:project received', filePath);
      
      try {
          // Verify it's an sqlite project file by reading audit_metadata
          const dbPath = filePath;
          const fb = fs.readFileSync(dbPath);
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const initSqlJs = require('sql.js');
          const SQL = await initSqlJs();
          const db = new SQL.Database(fb);
          
          const stateJson = await new Promise<any>((resolve, reject) => {
              try {
                  const stmt = db.prepare('SELECT data FROM audit_metadata');
                  if (stmt.step()) {
                      const row = stmt.getAsObject();
                      resolve(row.data);
                  } else {
                      reject(new Error('Empty audit_metadata'));
                  }
                  stmt.free();
              } catch {
                  reject(new Error('Invalid project file (no audit_metadata)'));
              }
          });
          
          db.close();
          
          // Replace current dbPath with imported file essentially by copying it over
          // Wait, the current dbPath is this.dbService.dbPath
          if (!this.dbService.dbPath) {
              await this.dbService.initialize('imported_project', os.tmpdir());
          }
          
          // close current DB
          await this.dbService.close();
          // copy the new file over
          fs.copyFileSync(filePath, this.dbService.dbPath!);
          // Re-open DB
          const directory = path.dirname(this.dbService.dbPath!);
          const id = path.basename(this.dbService.dbPath!, '.sqlite');
          await this.dbService.initialize(id, directory);
          
          const state = JSON.parse(stateJson);
          return state;
      } catch (e: any) {
          console.error(e);
          throw new Error('Failed to load project DB: ' + e.message);
      }
    });

    ipcMain.handle('query:getRows', async (event, table, limit, offset) => {
      return await this.dbService.query(`SELECT * FROM ${table} LIMIT ? OFFSET ?`, [limit, offset]);
    });

    ipcMain.handle('query:insertRows', async (event, table, rows) => {
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
      // very naive batch insert for restored projects
      const values = rows.map((r: any) => `('${r.id}', '${r.date}', ${r.amount}, ${r.bookValue || r.amount}, ${r.auditedValue !== undefined ? r.auditedValue : 'NULL'}, ${r.difference || 0})`).join(',');
      if (values.length > 0) {
        await this.dbService.execute(`INSERT INTO ${table} (id, date, amount, bookValue, auditedValue, difference) VALUES ${values}`);
      }
      return true;
    });

    ipcMain.handle('query:getAggregates', async (event, table) => {
      try {
        const result = await this.dbService.query<any>(`SELECT COUNT(*) as cnt, SUM(ABS(amount)) as val, MIN(amount) as min_amt, MAX(amount) as max_amt FROM ${table}`);
        const cnt = result[0]?.cnt || 0;
        const val = result[0]?.val || 0;
        const min_amt = result[0]?.min_amt || 0;
        const max_amt = result[0]?.max_amt || 0;
        return { totalAmount: val, rowCount: cnt, minAmount: min_amt, maxAmount: max_amt };
      } catch {
        return { totalAmount: 0, rowCount: 0, minAmount: 0, maxAmount: 0 };
      }
    });

    ipcMain.handle('sampling:execute', async (event, config) => {
      console.log('IPC sampling:execute received', config);
      return await this.samplingService.runSampling(config, (stage) => {
          event.sender.send('sampling:progress', stage);
      });
    });

    ipcMain.handle('export:project', async (event, state) => {
      console.log('IPC export:project received');
      const methodName = state?.config?.method || 'Sample';
      const dateStr = new Date().toLocaleDateString('uk-UA').replace(/\./g, '_');
      const defaultName = `Вибірка_${methodName}_${dateStr}.audsmpl`;
      
      const { canceled, filePath: projectPath } = await dialog.showSaveDialog({
         title: 'Зберегти проєкт',
         defaultPath: defaultName,
         filters: [{ name: 'Audit Sample Project', extensions: ['audsmpl'] }]
      });
      if (!canceled && projectPath) {
         await this.exportService.exportProject(projectPath, state);
      }
    });

    ipcMain.handle('license:loadFromDisk', async () => {
      // Search several candidate directories so the .asp file is found in
      // every distribution form:
      //  - PORTABLE_EXECUTABLE_DIR: folder of the portable .exe (electron-builder
      //    extracts the portable app to a temp dir, so app.getPath('exe') is wrong)
      //  - dir of the installed/unpacked exe (NSIS install, win-unpacked)
      //  - current working directory (fallback)
      //  - project root (dev)
      const candidates = [
        process.env.PORTABLE_EXECUTABLE_DIR,
        app.isPackaged ? path.dirname(app.getPath('exe')) : null,
        process.cwd(),
        app.isPackaged ? null : __dirname,
      ].filter((d): d is string => !!d);

      console.log('[license] candidates:', candidates, '| isPackaged:', app.isPackaged);

      for (const dir of candidates) {
        try {
          const files = fs.readdirSync(dir).filter(f => f.startsWith('license-ASP') && f.endsWith('.asp'));
          if (files.length === 0) continue;
          const content = fs.readFileSync(path.join(dir, files[0]), 'utf-8');
          console.log('[license] loaded:', files[0], 'from', dir);
          return content;
        } catch (e) {
          console.warn('[license] cannot read dir', dir, e);
        }
      }
      console.log('[license] no license-ASP*.asp file found');
      return null;
    });

    ipcMain.handle('export:excel', async (event, state) => {
      console.log('IPC export:excel received');
      const methodName = state?.config?.method || 'Sample';
      const dateStr = new Date().toLocaleDateString('uk-UA').replace(/\./g, '_');
      const defaultName = `Вибірка_${methodName}_${dateStr}.xlsx`;
      
      const { canceled, filePath: excelPath } = await dialog.showSaveDialog({
         title: 'Експорт в Excel',
         defaultPath: defaultName,
         filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      });
      if (!canceled && excelPath) {
         const dbPath = this.dbService.dbPath;
         if (dbPath) {
            await this.exportService.exportExcel(excelPath, dbPath, state.results);
         }
      }
    });
  }
}
