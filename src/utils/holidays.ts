// Holiday list used by the RiskAssessment method to flag entries booked on
// non-working days. Configurable in the global settings so the app is not tied
// to one country's calendar.
//
// An entry is either:
//   'MM-DD'      - recurring every year (e.g. '12-25')
//   'YYYY-MM-DD' - a single date (e.g. '2025-04-20' for a movable feast)

export const DEFAULT_HOLIDAYS: string[] = [
  '01-01', // Новий рік
  '03-08', // Міжнародний жіночий день
  '05-01', // День праці
  '05-08', // День пам'яті та перемоги
  '05-09', // День перемоги
  '06-28', // День Конституції
  '08-24', // День Незалежності
  '10-01', // День захисників і захисниць
  '12-25'  // Різдво
];

const RECURRING = /^\d{2}-\d{2}$/;
const SPECIFIC = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed entry with a real month and day. */
export function isValidHoliday(entry: string): boolean {
  const s = entry.trim();
  if (!RECURRING.test(s) && !SPECIFIC.test(s)) return false;
  const parts = s.split('-');
  const [m, d] = parts.length === 3 ? [Number(parts[1]), Number(parts[2])] : [Number(parts[0]), Number(parts[1])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // 29 February is allowed as a recurring entry; only impossible days are rejected.
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= maxDay;
}

/**
 * Keeps only valid entries and drops duplicates. Every consumer must run the
 * stored list through this: entries reach SQL as literals in the desktop
 * engine, so unvalidated text must never get that far.
 */
export function sanitizeHolidays(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  for (const raw of list) {
    const s = String(raw).trim();
    if (isValidHoliday(s)) seen.add(s);
  }
  return Array.from(seen).sort();
}

/** Splits a sanitized list into the two shapes the engines match against. */
export function splitHolidays(list: string[]): { recurring: string[]; specific: string[] } {
  return {
    recurring: list.filter(h => RECURRING.test(h)),
    specific: list.filter(h => SPECIFIC.test(h))
  };
}

/** True when the ISO date ('YYYY-MM-DD') falls on a holiday from the list. */
export function isHoliday(isoDate: string, list: string[]): boolean {
  if (isoDate.length < 10) return false;
  return list.includes(isoDate.slice(5, 10)) || list.includes(isoDate.slice(0, 10));
}
