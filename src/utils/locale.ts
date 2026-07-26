// Date conventions follow the operating system's locale rather than an
// app setting: the user already told their OS how they write dates, and a
// second, separate switch only created a way for the two to disagree.

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/** The locale reported by the browser/OS, with a defined fallback. */
export function getSystemLocale(): string {
  try {
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (resolved) return resolved;
  } catch {
    // Fall through to the default below.
  }
  return 'uk-UA';
}

/**
 * Reads the field order out of Intl itself instead of keeping a country list.
 * Formats a date whose parts are unambiguous (2000-01-02) and looks at which
 * component the locale prints first.
 */
export function getDateOrder(locale: string = getSystemLocale()): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(2000, 0, 2));

    const order = parts.filter(p => p.type === 'year' || p.type === 'month' || p.type === 'day')
                       .map(p => p.type);
    if (order[0] === 'year') return 'ymd';
    if (order[0] === 'month') return 'mdy';
    return 'dmy';
  } catch {
    return 'dmy';
  }
}

/**
 * True when the locale writes the month before the day, which is the only
 * thing that makes '05/07/2025' ambiguous.
 */
export function isMonthFirstLocale(locale?: string): boolean {
  return getDateOrder(locale) === 'mdy';
}

/**
 * The Excel number format matching the locale, so exported dates read the same
 * way as dates on screen.
 */
export function getExcelDateFormat(locale: string = getSystemLocale()): string {
  switch (getDateOrder(locale)) {
    case 'mdy': return 'mm/dd/yyyy';
    case 'ymd': return 'yyyy-mm-dd';
    default: return 'dd.mm.yyyy';
  }
}

/** Formats an ISO date ('YYYY-MM-DD') the way the operating system would. */
export function formatIsoDate(iso: string, locale: string = getSystemLocale()): string {
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(y, m - 1, d)));
  } catch {
    return iso;
  }
}

/**
 * Formats a number the way the operating system writes numbers, always with
 * two decimals (money and audit figures are never shown truncated).
 */
export function formatNumber(val: number, locale: string = getSystemLocale()): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  } catch {
    return val.toFixed(2);
  }
}

/** A sample rendering, shown read-only in the settings dialog. */
export function getNumberExample(locale: string = getSystemLocale()): string {
  return formatNumber(1234.56, locale);
}

/** The decimal separator the locale uses, for pre-filling editable fields. */
export function getDecimalSeparator(locale: string = getSystemLocale()): string {
  try {
    const part = new Intl.NumberFormat(locale).formatToParts(1.1).find(p => p.type === 'decimal');
    return part ? part.value : '.';
  } catch {
    return '.';
  }
}
