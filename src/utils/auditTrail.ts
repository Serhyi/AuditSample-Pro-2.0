import { AuditTrailEntry, SamplingMethodType } from '@types';

export class AuditTrail {
  private entries: AuditTrailEntry[] = [];

  log(
    action: string,
    method: SamplingMethodType,
    parameters: Record<string, unknown>,
    result: unknown,
    userId?: string
  ): void {
    const entry: AuditTrailEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      action,
      method,
      parameters: this.sanitizeParams(parameters),
      result,
      userId
    };

    this.entries.push(entry);

    // Для Electron: збереження у файл
    if ((window as any).electronAPI?.saveAuditLog) {
      (window as any).electronAPI.saveAuditLog(entry);
    }
  }

  getEntries(): AuditTrailEntry[] {
    return [...this.entries];
  }

  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  private generateId(): string {
    return `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    // Видалення чутливих даних
    const sanitized = { ...params };
    delete sanitized['password'];
    delete sanitized['token'];
    delete sanitized['apiKey'];
    return sanitized;
  }
}
