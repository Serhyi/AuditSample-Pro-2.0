import { ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require('sql.js');

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

    ipcMain.handle('import:project', async (event, filePath) => {
      console.log('IPC import:project received', filePath);
      
      try {
          // Verify it's an sqlite project file by reading audit_metadata
          const dbPath = filePath;
          const fb = fs.readFileSync(dbPath);
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
      const { canceled, filePath: projectPath } = await dialog.showSaveDialog({
         title: 'Save Project',
         filters: [{ name: 'Audit Sample Project', extensions: ['audsmpl'] }]
      });
      if (!canceled && projectPath) {
         await this.exportService.exportProject(projectPath, state);
      }
    });

    ipcMain.handle('export:excel', async (event, state) => {
      console.log('IPC export:excel received');
      const { canceled, filePath: excelPath } = await dialog.showSaveDialog({
         title: 'Export to Excel',
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
