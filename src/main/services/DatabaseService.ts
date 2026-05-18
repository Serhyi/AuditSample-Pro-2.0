import * as fs from 'fs';

export class DatabaseService {
  private db: any = null;
  public dbPath: string | null = null;
  private SQL: any = null;

  public async initialize(projectId: string, directory: string): Promise<void> {
    try {
      this.dbPath = `${directory}/${projectId}.sqlite`;
      console.log(`[DatabaseService] Initializing dbPath: ${this.dbPath}`);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const initSqlJs = require('sql.js');
      console.log(`[DatabaseService] requiring sql.js ...`);
      this.SQL = await initSqlJs();
      console.log(`[DatabaseService] initSqlJs() awaited successfully`);
      if (fs.existsSync(this.dbPath)) {
        console.log(`[DatabaseService] db file exists, loading from fs: ${this.dbPath}`);
        const fb = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fb);
      } else {
        console.log(`[DatabaseService] db file does NOT exist, creating new db`);
        this.db = new this.SQL.Database();
      }
      console.log(`[DatabaseService] initialized correctly. db object exists? ` + !!this.db);
    } catch (err: any) {
      console.error(`[DatabaseService] Error during initialization!`, err);
      throw err;
    }
  }

  public isInitialized(): boolean {
    const isInit = this.db !== null && this.db !== undefined;
    console.log(`[DatabaseService] isInitialized called -> ${isInit}`);
    return isInit;
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
