import { DatabaseService } from './DatabaseService';
import { WorkerPool } from '../core/WorkerPool';

export class ImportService {
  constructor(private db: DatabaseService, private workerPool: WorkerPool) {}

  public async importFile(filePath: string, config: any): Promise<any> {
    console.log('ImportService starting worker for', filePath);
    
    await this.db.execute(`DROP TABLE IF EXISTS population`);
    await this.db.execute(`
      CREATE TABLE population (
        id VARCHAR,
        date VARCHAR,
        amount DOUBLE,
        bookValue DOUBLE,
        auditedValue DOUBLE,
        difference DOUBLE
      )
    `);

    const result = await this.workerPool.runTask('ImportWorker.js', { 
      filePath, 
      config, 
      dbPath: 'temp_project.duckdb',
      mode: 'import'
    });
    
    return result;
  }

  public async previewFile(filePath: string): Promise<{ headers: string[], data: any[][] }> {
    console.log('ImportService starting preview worker for', filePath);
    return await this.workerPool.runTask('ImportWorker.js', { 
      filePath, 
      mode: 'preview'
    });
  }
}

