import { DatabaseService } from './DatabaseService';
import * as fs from 'fs';

export class ExportService {
  constructor(private db: DatabaseService) {}

  public async exportProject(projectPath: string, state: any): Promise<void> {
    console.log('Project export to ', projectPath);
    if (!this.db.dbPath) {
        throw new Error('No active database to export');
    }
    
    // Save state inside the SQLite DB using a parameterized statement.
    await this.db.execute(`DROP TABLE IF EXISTS audit_metadata`);
    await this.db.execute(`CREATE TABLE audit_metadata (data VARCHAR)`);
    await this.db.execute(`INSERT INTO audit_metadata VALUES (?)`, [JSON.stringify(state)]);
    
    // Close the DB temporarily to copy the file safely? 
    // Actually DuckDB supports EXPORT DATABASE, but simple file copy might work 
    // if we checkpoint or if the connection is idle.
    await this.db.execute(`CHECKPOINT`);
    
    // Copy the .sqlite file to the projectPath
    fs.copyFileSync(this.db.dbPath, projectPath);
  }
}
