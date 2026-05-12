import { Worker } from 'worker_threads';
import * as path from 'path';

export class WorkerPool {
  private workers: Worker[] = [];
  private taskQueue: any[] = []; // Simple task queue for demonstration

  constructor(private poolSize: number = 4) {
    // Basic pool init
  }

  public async runTask(workerFile: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // Assuming compiled worker lives in dist/workers or just next to main
      // However currently we run from main.cjs which has bundled everything?
      // Since it's esbuild bundled, we can't easily spawn another file unless we also bundle workers.
      // Wait, let's fix path for local development format
      
      const workerPath = path.join(__dirname, workerFile); 
      
      const worker = new Worker(workerPath, { workerData: data });

      worker.on('message', (msg) => {
        if (msg.type === 'done') resolve(msg);
        else if (msg.type === 'error') reject(new Error(msg.error));
        else if (msg.type === 'progress') {
           // Can pipe to IPC later
           console.log(`Worker Progress: ${msg.pct}% - ${msg.stage}`);
        }
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
}
