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
      
      // Ensure indices are present, especially if loading old project that lacked them
      if (this.db) {
        try {
          this.db.run('CREATE INDEX IF NOT EXISTS idx_abs_amount ON population(ABS(amount));');
          this.db.run('CREATE INDEX IF NOT EXISTS idx_amount ON population(amount);');
        } catch (e) {
          console.error(`[DatabaseService] Could not create indices (might not be population table yet)`, e);
        }
      }
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
    
    const normalized = sql.trim().toUpperCase();
    if (
      normalized.startsWith('INSERT') ||
      normalized.startsWith('UPDATE') ||
      normalized.startsWith('DELETE') ||
      normalized.startsWith('CREATE') ||
      normalized.startsWith('DROP') ||
      normalized.startsWith('ALTER')
    ) {
      throw new Error(
        'query() cannot execute write operations. Use execute() instead.'
      );
    }

    // sql.js executes single queries. For prepared statements we use prepare
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: any[] = [];
    let count = 0;
    while (stmt.step()) {
      results.push(stmt.getAsObject());
      count++;
      if (count % 5000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    stmt.free();
    return results as T[];
  }

  public get MUS_and_Pareto_Helpers() {
    return {
      getMUSPickedRows: async (sql: string, params: any[], interval: number, sampleSize: number): Promise<number[]> => {
        if (!this.db) throw new Error('Database not initialized');
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        let runningTotal = 0;
        let nextHit = Math.random() * interval;
        const pickedRowIds: number[] = [];
        let count = 0;
        while (stmt.step()) {
           const row = stmt.get(); // [rowid, absAmt]
           const rowid = row[0] as number;
           const absAmt = row[1] as number;
           runningTotal += absAmt;
           while (runningTotal >= nextHit) { // while instead of if, in case interval is very small
               pickedRowIds.push(rowid);
               nextHit += interval;
               if (pickedRowIds.length >= sampleSize || pickedRowIds.length >= 5000) break;
           }
           count++;
           if (count % 5000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
           if (pickedRowIds.length >= sampleSize || pickedRowIds.length >= 5000) break;
        }
        stmt.free();
        return pickedRowIds;
      },
      getParetoPickedRows: async (sql: string, params: any[], targetValue: number): Promise<number[]> => {
        if (!this.db) throw new Error('Database not initialized');
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        let currentSum = 0;
        const pickedRowIds: number[] = [];
        let count = 0;
        while (stmt.step()) {
           const row = stmt.get(); // [rowid, absAmt]
           const rowid = row[0] as number;
           const absAmt = row[1] as number;
           
           if (currentSum >= targetValue) break;
           currentSum += absAmt;
           pickedRowIds.push(rowid);
           
           count++;
           if (count % 5000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
           
           if (pickedRowIds.length >= 5000) break;
        }
        stmt.free();
        return pickedRowIds;
      }
    };
  }

  public async execute(sql: string): Promise<void> {
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
