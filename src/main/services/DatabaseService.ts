import * as duckdb from 'duckdb';
import * as path from 'path';

export class DatabaseService {
  private db: duckdb.Database | null = null;
  private connection: duckdb.Connection | null = null;
  public dbPath: string | null = null;

  public async initialize(projectId: string, directory: string): Promise<void> {
    this.dbPath = path.join(directory, `${projectId}.duckdb`);
    
    return new Promise((resolve, reject) => {
      this.db = new duckdb.Database(this.dbPath!, (err) => {
        if (err) return reject(err);
        
        this.connection = this.db!.connect();
        
        // Optimize for large datasets & concurrency
        this.execute("PRAGMA memory_limit='1GB'");
        this.execute("PRAGMA threads=4");
        
        resolve();
      });
    });
  }

  public async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.connection) return reject(new Error('Database not initialized'));
      
      const stmt = this.connection.prepare(sql);
      stmt.all(...params, (err, res) => {
        if (err) reject(err);
        else resolve(res as T[]);
      });
    });
  }

  public async execute(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connection) return reject(new Error('Database not initialized'));
      
      this.connection.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
           if (err) reject(err);
           else {
             this.db = null;
             this.connection = null;
             resolve();
           }
        });
      } else {
        resolve();
      }
    });
  }
}
