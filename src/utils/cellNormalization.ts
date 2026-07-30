import { isMonthFirstLocale } from './locale';

// Single source of truth for turning raw spreadsheet/CSV cells into clean
// typed values. Used by both importers (web worker and desktop worker) so the
// data is normalized once, on import, and by the exporter so older files
// imported before this existed are still written out correctly.
//
// Storage contract for normalized cells:
//   - numbers stay numbers
//   - dates become ISO 'YYYY-MM-DD' strings (JSON has no date type, and the
//     rows are persisted as JSON in the desktop SQLite database)
//   - everything else stays text

const makeIso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates that JS would otherwise roll over (31.02 -> 03.03).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** True for text shaped like a date, even if the date itself is invalid. */
export const looksLikeDate = (str: string): boolean =>
  /^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}/.test(str);

/**
 * Parses date text into 'YYYY-MM-DD'. Ambiguous input like '05/07/2025' is
 * read the way the operating system's locale writes dates; pass `monthFirst`
 * explicitly to override (the desktop worker gets it from the renderer, whose
 * locale is the authoritative one).
 */
export function parseDateText(str: string, monthFirst = isMonthFirstLocale()): string | null {
  const s = str.trim();

  // ISO, optionally with a time part (JSON.stringify of a Date yields this).
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ][\d:.]+Z?)?$/);
  if (iso) return makeIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const full = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[T ][\d:.]+Z?)?$/);
  if (full) {
    const a = Number(full[1]);
    const b = Number(full[2]);
    const y = Number(full[3]);
    if (monthFirst && a <= 12) return makeIso(y, a, b);
    // A first part above 12 can only be the day, whatever the setting.
    return makeIso(y, b, a);
  }

  const short = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
  if (short) {
    const y = 2000 + Number(short[3]);
    return monthFirst
      ? makeIso(y, Number(short[1]), Number(short[2]))
      : makeIso(y, Number(short[2]), Number(short[1]));
  }

  return null;
}

/**
 * Parses numeric text (space/comma/dot grouping, parentheses negatives).
 * Returns null for anything that must stay text, including identifiers that
 * Number() would corrupt.
 */
export function parseNumericText(str: string): number | null {
  let s = str.trim();
  if (s === '') return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // \s plus the non-breaking / narrow / figure spaces used for digit grouping.
  s = s.replace(/[\s\u00A0\u202F\u2007$€£₴]/g, '');
  if (!/^[+-]?\d[\d.,]*$/.test(s)) return null;

  const sign = s.startsWith('-') ? -1 : 1;
  const digits = s.replace(/^[+-]/, '');

  // Identifiers must stay text: a leading zero ("007123") and codes longer
  // than 15 significant digits (IBAN, tax number) would be corrupted.
  if (/^0\d/.test(digits)) return null;
  if (digits.replace(/[.,]/g, '').length > 15) return null;

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // The rightmost separator is the decimal one, the other groups thousands.
    normalized = lastComma > lastDot
      ? digits.replace(/\./g, '').replace(',', '.')
      : digits.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = digits.split(',');
    // "1,234" / "1,234,567" is grouping; "1,5" is a decimal comma.
    normalized = (parts.length > 2 || parts[parts.length - 1].length === 3)
      ? digits.replace(/,/g, '')
      : digits.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = digits.split('.');
    normalized = parts.length > 2 ? digits.replace(/\./g, '') : digits;
  } else {
    normalized = digits;
  }

  const num = Number(normalized);
  if (!isFinite(num)) return null;
  const signed = sign * num;
  return negative ? -Math.abs(signed) : signed;
}

/**
 * The calendar day a Date stands for, whichever zone it was built in.
 *
 * A date-only cell is midnight somewhere: spreadsheet readers produce UTC
 * midnight, while a Date built from local parts is midnight local time. Taking
 * UTC parts breaks the second case west of Greenwich, local parts break the
 * first east of it, so the zone is chosen by which one lands on midnight.
 */
export function dateToIso(date: Date): string {
  const isUtcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  const [y, m, d] = isUtcMidnight
    ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    : [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Converts the value of the designated date column to 'YYYY-MM-DD'.
 * Unlike normalizeCellValue this also accepts bare numbers as Excel serial
 * dates — safe only because the column is known to hold dates.
 */
export function toIsoDate(raw: any, monthFirst = isMonthFirstLocale()): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (raw instanceof Date) return dateToIso(raw);
  if (typeof raw === 'object' && 'text' in raw) return toIsoDate((raw as any).text, monthFirst);
  if (typeof raw === 'object' && 'result' in raw) return toIsoDate((raw as any).result, monthFirst);

  const str = String(raw).trim();
  if (str === '') return '';

  if (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(str)) {
    const numVal = Number(str);
    // Excel serial date (1927-08-01 .. 2099-12-31)
    if (numVal > 10000 && numVal < 73050) {
      const date = new Date((numVal - 25569) * 86400 * 1000);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
    // Unix timestamp in milliseconds
    if (numVal > 1000000000000) {
      const date = new Date(numVal);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    }
  }

  return parseDateText(str, monthFirst) || '';
}

/**
 * Normalizes one arbitrary source cell for storage in `originalRow`.
 * Bare numbers are never reinterpreted as dates here: in a generic column
 * 45000 is an amount, not an Excel serial date.
 */
export function normalizeCellValue(raw: any, monthFirst = isMonthFirstLocale()): any {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return toIsoDate(raw, monthFirst);
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw;
  // ExcelJS rich text / formula cells
  if (typeof raw === 'object') {
    if ('result' in raw) return normalizeCellValue((raw as any).result, monthFirst);
    if ('text' in raw) return normalizeCellValue((raw as any).text, monthFirst);
    return String(raw);
  }

  const str = String(raw).trim();
  if (str === '') return '';

  const asDate = parseDateText(str, monthFirst);
  if (asDate) return asDate;

  // A date-shaped string that failed validation (31.02.2025) must stay text:
  // the number parser would read the dots as thousands separators and turn it
  // into 31022025.
  if (looksLikeDate(str)) return str;

  const asNumber = parseNumericText(str);
  return asNumber !== null ? asNumber : str;
}
