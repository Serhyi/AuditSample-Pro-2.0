import { describe, it, expect } from 'vitest';
import { DEFAULT_HOLIDAYS, isValidHoliday, sanitizeHolidays, splitHolidays, isHoliday } from './holidays';

describe('isValidHoliday', () => {
  it('accepts both supported shapes', () => {
    expect(isValidHoliday('12-25')).toBe(true);
    expect(isValidHoliday('2025-04-20')).toBe(true);
    expect(isValidHoliday('02-29')).toBe(true); // leap day, recurring
  });

  it('rejects malformed or impossible entries', () => {
    expect(isValidHoliday('25-12')).toBe(false);  // month 25
    expect(isValidHoliday('02-31')).toBe(false);
    expect(isValidHoliday('1-1')).toBe(false);
    expect(isValidHoliday('25.12')).toBe(false);
    expect(isValidHoliday('')).toBe(false);
  });
});

describe('sanitizeHolidays', () => {
  it('drops invalid entries and duplicates', () => {
    expect(sanitizeHolidays(['12-25', '12-25', 'junk', '13-01', '2025-01-07']))
      .toEqual(['12-25', '2025-01-07']);
  });

  it('blocks anything that could reach SQL as a literal', () => {
    // The desktop engine inlines these into a SQL IN(...) list.
    expect(sanitizeHolidays(["01-01'); DROP TABLE population;--"])).toEqual([]);
    expect(sanitizeHolidays('not-an-array')).toEqual([]);
    expect(sanitizeHolidays(undefined)).toEqual([]);
  });
});

describe('splitHolidays', () => {
  it('separates recurring from single dates', () => {
    expect(splitHolidays(['12-25', '2025-04-20', '01-01']))
      .toEqual({ recurring: ['12-25', '01-01'], specific: ['2025-04-20'] });
  });
});

describe('isHoliday', () => {
  const list = ['12-25', '2025-04-20'];

  it('matches recurring entries in any year', () => {
    expect(isHoliday('2024-12-25', list)).toBe(true);
    expect(isHoliday('2031-12-25', list)).toBe(true);
  });

  it('matches a single date only in its own year', () => {
    expect(isHoliday('2025-04-20', list)).toBe(true);
    expect(isHoliday('2026-04-20', list)).toBe(false);
  });

  it('returns false for ordinary days', () => {
    expect(isHoliday('2025-07-01', list)).toBe(false);
    expect(isHoliday('', list)).toBe(false);
  });
});

describe('DEFAULT_HOLIDAYS', () => {
  it('is a valid list', () => {
    expect(sanitizeHolidays(DEFAULT_HOLIDAYS).length).toBe(DEFAULT_HOLIDAYS.length);
  });
});
