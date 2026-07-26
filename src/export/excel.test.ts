import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { exportToExcel } from './excel';

// Minimal DOM/Blob stubs so the browser-oriented exporter runs under vitest.
let captured: Buffer | null = null;
(globalThis as any).Blob = class { constructor(parts: any[]) { captured = Buffer.from(parts[0]); } } as any;
(globalThis as any).URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} } as any;
(globalThis as any).document = { createElement: () => ({ click: () => {}, set href(_v: any) {}, get href() { return ''; } }) } as any;

const settings = { region: 'ua', dateFormat: 'dd.mm.yyyy', numberSeparator: 'space_comma', language: 'ua', currency: 'UAH' };

const mkItem = (row: any[], amount: number) => ({
  id: row[0], amount, bookValue: amount, auditedValue: '', difference: amount, date: '2025-07-01', originalRow: row
});

const rows = [
  ['1.0', '800.0', '01.07.2025', 'Реалізація ТБ00-01/07-01', '361.0', '007123', '1 234,56', '2025-08-24T00:00:00.000Z'],
  ['2.0', '4514.4', '31.02.2025', '(100.50)', '1.234.567,89', '123456789012345678', '', '05/07/2025'],
];

const state = {
  results: {
    populationSize: 2, populationValue: 5314.4, trivialCount: 0, trivialValue: 0,
    areTrivialExcluded: false, sampleSize: 2, sampleValue: 5314.4, samplingInterval: 100,
    keyItems: [], samplingItems: rows.map((r, i) => mkItem(r, i === 0 ? 800 : 4514.4)),
    projectedMisstatement: 0, upperMisstatementBound: 0
  },
  sourceHeaders: ['№','Сума','Дата','Документ','Дебет','Код','Сума2','Дата2'],
  config: { method: 'Systematic', anomalyMethod: 'None', confidenceLevel: 95, tolerableMisstatement: 1000, expectedMisstatement: 0, clearlyTrivialThreshold: 0, riskFactor: 'Moderate', seed: 7 },
  settings, population: [], license: null
};

describe('export normalization', () => {
  it('writes dates and numbers as real Excel values', async () => {
    await exportToExcel(state, 'x.xlsx', false, 'ua');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(captured!);
    const sheet = wb.getWorksheet('Вибірка')!;
    const r1 = sheet.getRow(2);
    const r2 = sheet.getRow(3);
    const v = (r: any, c: number) => r.getCell(c).value;

    expect(v(r1,1)).toBe(1);                              // '1.0' -> number
    expect(v(r1,2)).toBe(800);
    expect(v(r1,3)).toBeInstanceOf(Date);                 // 01.07.2025
    expect((v(r1,3) as Date).getMonth()).toBe(6);         // July, day-first
    expect((v(r1,3) as Date).getDate()).toBe(1);
    expect(v(r1,4)).toBe('Реалізація ТБ00-01/07-01');     // text stays text
    expect(v(r1,5)).toBe(361);
    expect(v(r1,6)).toBe('007123');                       // leading zero preserved
    expect(v(r1,7)).toBe(1234.56);                        // space+comma
    expect(v(r1,8)).toBeInstanceOf(Date);                 // ISO w/ time

    expect(v(r2,3)).toBe('31.02.2025');                   // impossible date -> text
    expect(v(r2,4)).toBe(-100.5);                         // parentheses negative
    expect(v(r2,5)).toBe(1234567.89);                     // dot thousands, comma decimal
    expect(v(r2,6)).toBe('123456789012345678');           // 18 digits -> text
    expect(v(r2,8)).toBeInstanceOf(Date);
    expect((v(r2,8) as Date).getMonth()).toBe(6);         // 05/07 day-first -> July

    expect(r1.getCell(3).numFmt).toBe('dd.mm.yyyy');
    expect(r1.getCell(1).numFmt).toBe('#,##0');
    expect(r1.getCell(7).numFmt).toBe('#,##0.00');
  });
});
