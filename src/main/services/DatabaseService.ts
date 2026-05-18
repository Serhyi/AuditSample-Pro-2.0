import * as fs from 'fs';

export class DatabaseService {
  private db: any = null;
  public dbPath: string | null = null;
  private SQL: any = null;

  public async initialize(projectId: string, directory: string): Promise<void> {
    this.dbPath = `${directory}/${projectId}.sqlite`;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require('sql.js');
    this.SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const fb = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(fb);
    } else {
      this.db = new this.SQL.Database();
    }
  }

  public isInitialized(): boolean {
    return this.db !== null && this.db !== undefined;
  }

  public async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    // sql.js executes single queries. For prepared statements we use prepare
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results as T[];
  }

  public async execute(sql: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (sql.trim().toUpperCase() === 'CHECKPOINT') {
      if (this.dbPath) {
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
      }
      return;
    }
    this.db.run(sql);
  }

  public async close(): Promise<void> {
    if (this.db) {
      if (this.dbPath) {
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
      }
      this.db.close();
      this.db = null;
    }
  }
}
