import { DatabaseService } from './DatabaseService';
import { WorkerPool } from '../core/WorkerPool';
import * as path from 'path';
import * as fs from 'fs';

export class ExportService {
  constructor(private db: DatabaseService, private workerPool: WorkerPool) {}

  public async exportProject(projectPath: string, state: any): Promise<void> {
    console.log('Project export to ', projectPath);
    if (!this.db.dbPath) {
        throw new Error('No active database to export');
    }
    
    // Save state inside DuckDB as a metadata table
    const stateJson = JSON.stringify(state).replace(/'/g, "''");
    await this.db.execute(`DROP TABLE IF EXISTS audit_metadata`);
    await this.db.execute(`CREATE TABLE audit_metadata (data VARCHAR)`);
    await this.db.execute(`INSERT INTO audit_metadata VALUES ('${stateJson}')`);
    
    // Close the DB temporarily to copy the file safely? 
    // Actually DuckDB supports EXPORT DATABASE, but simple file copy might work 
    // if we checkpoint or if the connection is idle.
    await this.db.execute(`CHECKPOINT`);
    
    // Copy the .duckdb file to the projectPath
    fs.copyFileSync(this.db.dbPath, projectPath);
  }

  public async exportExcel(excelPath: string, dbPath: string, results: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.workerPool.runWorker(path.join(__dirname, '../workers/ExportWorker.js'), {
        excelPath,
        dbPath,
        results
      })
      .then(() => resolve())
      .catch((e) => reject(e));
    });
  }
}
