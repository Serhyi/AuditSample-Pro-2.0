import { DatabaseService } from './DatabaseService';

export class ExportService {
  constructor(private db: DatabaseService) {}

  public async exportProject(projectPath: string): Promise<void> {
    // Phase 5 implementation
  }

  public async exportExcel(excelPath: string): Promise<void> {
    // Phase 5 implementation
  }
}
