import { describe, it, expect } from 'vitest';
import { getDateOrder, isMonthFirstLocale, getExcelDateFormat, formatIsoDate, getSystemLocale } from './locale';

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
