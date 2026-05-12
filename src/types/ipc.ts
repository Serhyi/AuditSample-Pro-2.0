import { SamplingConfig, TransactionItem } from './index';

export interface ImportConfig {
  hasHeader: boolean;
  delimiter?: string;
}

export interface ImportMeta {
  rowCount: number;
  columns: string[];
}

export interface DatasetStats {
  totalAmount: number;
  rowCount: number;
  minAmount: number;
  maxAmount: number;
}

export interface SamplingResultMeta {
  sampleSize: number;
  totalMisstatement?: number;
  projectedMisstatement?: number;
  upperErrorLimit?: number;
}

export interface IpcApi {
  import: {
    start: (filePath: string, config: any) => Promise<ImportMeta>;
    preview: (filePath: string) => Promise<{ headers: string[], data: any[][] }>;
  };
  query: {
    getRows: (table: string, limit: number, offset: number, filters?: any[]) => Promise<TransactionItem[]>;
    getAggregates: (table: string) => Promise<DatasetStats>;
    insertRows: (table: string, rows: TransactionItem[]) => Promise<boolean>;
  };
  sampling: {
    execute: (config: SamplingConfig) => Promise<SamplingResultMeta>;
  };
  export: {
    project: (path: string) => Promise<void>;
    excel: (path: string) => Promise<void>;
  };
  on: (channel: string, callback: (...args: any[]) => void) => () => void;
}

declare global {
  interface Window {
    api: IpcApi;
  }
}
