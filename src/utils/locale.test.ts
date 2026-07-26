import { describe, it, expect } from 'vitest';
import { getDateOrder, isMonthFirstLocale, getExcelDateFormat, formatIsoDate, getSystemLocale, formatNumber, getNumberExample } from './locale';

describe('getDateOrder', () => {
  it('reads the field order out of the locale', () => {
    expect(getDateOrder('uk-UA')).toBe('dmy');
    expect(getDateOrder('de-DE')).toBe('dmy');
    expect(getDateOrder('en-GB')).toBe('dmy');
    expect(getDateOrder('en-US')).toBe('mdy');
    expect(getDateOrder('ja-JP')).toBe('ymd');
    expect(getDateOrder('lt-LT')).toBe('ymd');
  });

  it('falls back to day-first for an unusable locale', () => {
    expect(getDateOrder('not-a-locale!!')).toBe('dmy');
  });
});

describe('isMonthFirstLocale', () => {
  it('is true only where the month is written first', () => {
    expect(isMonthFirstLocale('en-US')).toBe(true);
    expect(isMonthFirstLocale('uk-UA')).toBe(false);
    expect(isMonthFirstLocale('ja-JP')).toBe(false);
  });
});

describe('getExcelDateFormat', () => {
  it('matches the locale order', () => {
    expect(getExcelDateFormat('uk-UA')).toBe('dd.mm.yyyy');
    expect(getExcelDateFormat('en-US')).toBe('mm/dd/yyyy');
    expect(getExcelDateFormat('ja-JP')).toBe('yyyy-mm-dd');
  });
});

describe('formatIsoDate', () => {
  it('renders the stored ISO date the way the locale writes it', () => {
    expect(formatIsoDate('2025-09-30', 'uk-UA')).toBe('30.09.2025');
    expect(formatIsoDate('2025-09-30', 'en-US')).toBe('09/30/2025');
  });

  it('leaves anything that is not an ISO date alone', () => {
    expect(formatIsoDate('', 'uk-UA')).toBe('');
    expect(formatIsoDate('не дата', 'uk-UA')).toBe('не дата');
  });
});

describe('getSystemLocale', () => {
  it('always returns a usable locale tag', () => {
    expect(new Intl.DateTimeFormat(getSystemLocale())).toBeTruthy();
  });
});

describe('formatNumber', () => {
  const nbsp = (str: string) => str.replace(/[\s\u00A0\u202F]/g, ' ');

  it('uses the separators of the locale', () => {
    expect(nbsp(formatNumber(1234567.891, 'uk-UA'))).toBe('1 234 567,89');
    expect(formatNumber(1234567.891, 'en-US')).toBe('1,234,567.89');
    expect(formatNumber(1234567.891, 'de-DE')).toBe('1.234.567,89');
  });

  it('always shows two decimals and keeps the sign', () => {
    expect(formatNumber(5, 'en-US')).toBe('5.00');
    expect(formatNumber(-100.5, 'en-US')).toBe('-100.50');
  });

  it('falls back rather than throwing on a broken locale', () => {
    expect(formatNumber(12.5, 'not-a-locale!!')).toBe('12.50');
  });

  it('renders a sample for the settings dialog', () => {
    expect(getNumberExample('en-US')).toBe('1,234.56');
  });
});
