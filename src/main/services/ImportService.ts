import { DatabaseService } from './DatabaseService';
import { WorkerPool } from '../core/WorkerPool';
import * as os from 'os';
import * as path from 'path';

export class ImportService {
  constructor(private db: DatabaseService, private workerPool: WorkerPool) {}

  public async importFile(filePath: string, config: any): Promise<any> {
    console.log('ImportService starting worker for', filePath);
    
    // Provide a unique db path for this import session
    const dbPath = path.join(os.tmpdir(), `project_${Date.now()}.sqlite`);

    const result = await this.workerPool.runTask('ImportWorker.cjs', { 
      filePath, 
      config, 
      dbPath: dbPath, 
      mode: 'import'
    });
    
    return { ...result, dbPath };
  }

  public async previewFile(filePath: string): Promise<{ headers: string[], data: any[][] }> {
    console.log('ImportService starting preview worker for', filePath);
    return await this.workerPool.runTask('ImportWorker.cjs', { 
      filePath, 
      mode: 'preview'
    });
  }
}

