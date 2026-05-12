import { ipcMain } from 'electron';
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
    this.exportService = new ExportService(this.dbService);
  }

  public registerIpcHandlers() {
    ipcMain.handle('import:start', async (event, filePath, config) => {
      console.log('IPC import:start received', filePath, config);
      return await this.importService.importFile(filePath, config);
    });

    ipcMain.handle('import:preview', async (event, filePath) => {
      return await this.importService.previewFile(filePath);
    });

    ipcMain.handle('query:getRows', async (event, table, limit, offset, filters) => {
      return await this.dbService.query(`SELECT * FROM ${table} LIMIT ? OFFSET ?`, [limit, offset]);
    });

    ipcMain.handle('query:insertRows', async (event, table, rows) => {
      await this.dbService.query(`DROP TABLE IF EXISTS ${table}`);
      await this.dbService.query(`
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
        await this.dbService.query(`INSERT INTO ${table} (id, date, amount, bookValue, auditedValue, difference) VALUES ${values}`);
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
      } catch (e) {
        return { totalAmount: 0, rowCount: 0, minAmount: 0, maxAmount: 0 };
      }
    });

    ipcMain.handle('sampling:execute', async (event, config) => {
      console.log('IPC sampling:execute received', config);
      return await this.samplingService.runSampling(config);
    });

    ipcMain.handle('export:project', async (event, projectPath) => {
      console.log('IPC export:project received', projectPath);
      await this.exportService.exportProject(projectPath);
    });

    ipcMain.handle('export:excel', async (event, excelPath) => {
      console.log('IPC export:excel received', excelPath);
      await this.exportService.exportExcel(excelPath);
    });
  }
}
