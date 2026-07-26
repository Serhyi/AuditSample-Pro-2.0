import { describe, it, expect } from 'vitest';
import { normalizeCellValue, toIsoDate, parseNumericText, parseDateText } from './cellNormalization';

describe('normalizeCellValue (import stage)', () => {
  it('converts date text to ISO, day-first', () => {
    expect(normalizeCellValue('01.07.2025')).toBe('2025-07-01');
    expect(normalizeCellValue('2025-07-01')).toBe('2025-07-01');
    expect(normalizeCellValue('01.07.25')).toBe('2025-07-01');
    expect(normalizeCellValue('2025-08-24T00:00:00.000Z')).toBe('2025-08-24');
    expect(normalizeCellValue(new Date(2025, 6, 1))).toBe('2025-07-01');
  });

  it('honours the month-first setting', () => {
    expect(normalizeCellValue('05/07/2025', true)).toBe('2025-05-07');
    expect(normalizeCellValue('05/07/2025')).toBe('2025-07-05');
    // A first part above 12 can only be the day, whatever the setting.
    expect(normalizeCellValue('25/07/2025', true)).toBe('2025-07-25');
  });

  it('converts numeric text to numbers', () => {
    expect(normalizeCellValue('800.0')).toBe(800);
    expect(normalizeCellValue('1 234,56')).toBe(1234.56);
    expect(normalizeCellValue('1.234.567,89')).toBe(1234567.89);
    expect(normalizeCellValue('(100.50)')).toBe(-100.5);
    expect(normalizeCellValue('-42')).toBe(-42);
  });

  it('keeps identifiers and text intact', () => {
    expect(normalizeCellValue('007123')).toBe('007123');
    expect(normalizeCellValue('123456789012345678')).toBe('123456789012345678');
    expect(normalizeCellValue('ТБ00-01/07-01')).toBe('ТБ00-01/07-01');
    expect(normalizeCellValue('')).toBe('');
    expect(normalizeCellValue(null)).toBe('');
  });

  it('never turns an invalid date into a number', () => {
    // Without the guard the dots would be read as thousands separators.
    expect(normalizeCellValue('31.02.2025')).toBe('31.02.2025');
    expect(parseNumericText('31.02.2025')).toBe(31022025);
  });

  it('unwraps ExcelJS rich-text and formula cells', () => {
    expect(normalizeCellValue({ text: '01.07.2025' })).toBe('2025-07-01');
    expect(normalizeCellValue({ result: '800.5' })).toBe(800.5);
  });

  it('does not read a bare number as an Excel serial date', () => {
    // 45000 in a generic column is an amount; only the date column may treat
    // it as a serial date.
    expect(normalizeCellValue(45000)).toBe(45000);
    expect(normalizeCellValue('45000')).toBe(45000);
  });
});

describe('toIsoDate (date column)', () => {
  it('accepts Excel serial numbers and timestamps', () => {
    expect(toIsoDate(45839)).toBe('2025-07-01');
    expect(toIsoDate(Date.UTC(2025, 6, 1))).toBe('2025-07-01');
  });

  it('accepts the text formats the importer sees', () => {
    expect(toIsoDate('01.07.2025')).toBe('2025-07-01');
    expect(toIsoDate('2025-07-01')).toBe('2025-07-01');
    expect(toIsoDate(new Date(2025, 6, 1))).toBe('2025-07-01');
  });

  it('returns an empty string when the value is not a date', () => {
    expect(toIsoDate('не дата')).toBe('');
    expect(toIsoDate('31.02.2025')).toBe('');
    expect(toIsoDate('')).toBe('');
    expect(toIsoDate(null)).toBe('');
  });
});

describe('parseDateText', () => {
  it('rejects impossible calendar dates', () => {
    expect(parseDateText('31.02.2025')).toBeNull();
    expect(parseDateText('31.04.2025')).toBeNull();
    expect(parseDateText('29.02.2024')).toBe('2024-02-29'); // leap year
  });
});
