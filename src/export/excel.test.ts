import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { exportToExcel } from './excel';
import { getExcelDateFormat } from '../utils/locale';

// Minimal DOM/Blob stubs so the browser-oriented exporter runs under vitest.
let captured: Buffer | null = null;
(globalThis as any).Blob = class { constructor(parts: any[]) { captured = Buffer.from(parts[0]); } } as any;
(globalThis as any).URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} } as any;
(globalThis as any).document = { createElement: () => ({ click: () => {}, set href(_v: any) {}, get href() { return ''; } }) } as any;

const settings = { language: 'ua', currency: 'UAH', holidays: [] };

const mkItem = (row: any[], amount: number) => ({
  id: row[0], amount, bookValue: amount, auditedValue: '', difference: amount, date: '2025-07-01', originalRow: row
});

// Cells arrive normalized from import (dates as ISO, numbers as numbers); the
// raw-text cases cover files imported before normalization existed. Ambiguous
// text like '05/07/2025' is deliberately absent: it is resolved by the OS
// locale, which would make the expectations machine-dependent.
const rows = [
  ['1.0', '800.0', '2025-07-01', 'Реалізація ТБ00-01/07-01', '361.0', '007123', '1 234,56', '2025-08-24T00:00:00.000Z'],
  ['2.0', '4514.4', '31.02.2025', '(100.50)', '1.234.567,89', '123456789012345678', '', '25/07/2025'],
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
    await exportToExcel(state, 'x.xlsx', 'ua');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(captured!);
    const sheet = wb.getWorksheet('Вибірка')!;
    const r1 = sheet.getRow(2);
    const r2 = sheet.getRow(3);
    const v = (r: any, c: number) => r.getCell(c).value;

    expect(v(r1,1)).toBe(1);                              // '1.0' -> number
    expect(v(r1,2)).toBe(800);
    expect(v(r1,3)).toBeInstanceOf(Date);                 // ISO from import
    expect((v(r1,3) as Date).getMonth()).toBe(6);         // July
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
    // A first part above 12 is unambiguously the day in any locale.
    expect((v(r2,8) as Date).getMonth()).toBe(6);
    expect((v(r2,8) as Date).getDate()).toBe(25);

    // The date format follows the OS locale, not a setting.
    expect(r1.getCell(3).numFmt).toBe(getExcelDateFormat());
    expect(r1.getCell(1).numFmt).toBe('#,##0');
    expect(r1.getCell(7).numFmt).toBe('#,##0.00');
  });
});

describe('single export', () => {
  it('has the sample sheets, no population sheet, and the hidden snapshot sheet', async () => {
    await exportToExcel(state, 'x.xlsx', 'ua');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(captured!);
    const names = wb.worksheets.map(w => w.name);

    expect(names).toContain('Вибірка');
    expect(names).toContain('Опис та результат');
    expect(names).not.toContain('Генеральна сукупність');

    const meta = wb.getWorksheet('__AuditSampleData')!;
    expect(meta.state).toBe('veryHidden');
    // The snapshots must survive so the returned file re-imports losslessly.
    const labels = [meta.getRow(1).getCell(1).value, meta.getRow(2).getCell(1).value];
    expect(labels).toEqual(['__AUDITSAMPLE_CONFIG__', '__AUDITSAMPLE_RESULTS__']);
    expect(JSON.parse(String(meta.getRow(2).getCell(2).value)).samplingInterval).toBe(100);

    // No service rows leak onto the visible summary sheet.
    const summary = wb.getWorksheet('Опис та результат')!;
    const firstCol: string[] = [];
    summary.eachRow(r => firstCol.push(String(r.getCell(1).value ?? '')));
    expect(firstCol.some(l => l.startsWith('__AUDITSAMPLE'))).toBe(false);
  });

  it('reserves a highlighted first row for the population file link', async () => {
    await exportToExcel(state, 'x.xlsx', 'ua');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(captured!);
    const row = wb.getWorksheet('Опис та результат')!.getRow(1);

    expect(String(row.getCell(1).value)).toBe('Файл генеральної сукупності:');
    expect((row.getCell(1).fill as any).fgColor.argb).toBe('FFFFF3B0');
    expect((row.getCell(2).fill as any).fgColor.argb).toBe('FFFFF3B0');
  });
});
