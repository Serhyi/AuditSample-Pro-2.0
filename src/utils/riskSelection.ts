import { Mulberry32 } from '../statistics/prng';

// Shared risk-criteria selection logic, used by the in-memory engine and by the
// SQLite engine so both produce the same sample from the same seed.

export type RiskCriterion = 'holiday' | 'weekend' | 'closing';

export type RiskFlags = { weekend: boolean; holiday: boolean; closing: boolean };

export type RiskCounts = { weekend: number; holiday: number; closing: number };

// Rarest first: an item that is both a holiday and a month-end entry is counted
// under the criterion that says the most about it.
export const CRITERION_ORDER: RiskCriterion[] = ['holiday', 'weekend', 'closing'];

export const emptyCounts = (): RiskCounts => ({ weekend: 0, holiday: 0, closing: 0 });

/** The criterion an item is attributed to when it matches several. */
export function primaryCriterion(flags: RiskFlags): RiskCriterion | null {
  for (const c of CRITERION_ORDER) if (flags[c]) return c;
  return null;
}

/** Seeded partial Fisher-Yates: the first `count` elements of a shuffle. */
function pick<T>(items: T[], count: number, rng: Mulberry32): T[] {
  const copy = items.slice();
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i++) {
    const j = i + rng.nextInt(0, copy.length - i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Selects at most `cap` of the items that matched the risk criteria.
 *
 * The quota is split across criteria in proportion to how many items each one
 * matched, with at least one item per non-empty criterion, so a rare criterion
 * (nine weekend entries) is not drowned out by a broad one (282 month-end
 * entries). Within a criterion the pick is a seeded shuffle, which keeps the
 * result reproducible and, unlike a plain LIMIT, free of chronological bias.
 *
 * `cap <= 0` means no limit: everything that matched is selected.
 */
export function allocateRiskSample<T>(
  matched: T[],
  flagsOf: (item: T) => RiskFlags,
  cap: number,
  seed: number
): { picked: T[]; selected: RiskCounts } {
  const groups: Record<RiskCriterion, T[]> = { holiday: [], weekend: [], closing: [] };
  for (const item of matched) {
    const c = primaryCriterion(flagsOf(item));
    if (c) groups[c].push(item);
  }

  const countOf = (items: T[]) => items.length;
  const selected = emptyCounts();

  if (cap <= 0 || matched.length <= cap) {
    for (const c of CRITERION_ORDER) selected[c] = countOf(groups[c]);
    return { picked: matched.slice(), selected };
  }

  // Largest-remainder allocation, floored at one item per non-empty criterion.
  const total = matched.length;
  const quotas: Record<string, number> = {};
  const remainders: { c: RiskCriterion; rem: number }[] = [];
  let assigned = 0;
  for (const c of CRITERION_ORDER) {
    const size = groups[c].length;
    if (size === 0) { quotas[c] = 0; continue; }
    const exact = (size / total) * cap;
    const base = Math.max(1, Math.floor(exact));
    quotas[c] = Math.min(base, size);
    assigned += quotas[c];
    remainders.push({ c, rem: exact - Math.floor(exact) });
  }

  // Hand out or claw back the difference, biggest remainder first.
  remainders.sort((a, b) => b.rem - a.rem);
  let diff = cap - assigned;
  while (diff !== 0) {
    let moved = false;
    for (const { c } of remainders) {
      if (diff === 0) break;
      if (diff > 0 && quotas[c] < groups[c].length) { quotas[c]++; diff--; moved = true; }
      else if (diff < 0 && quotas[c] > 1) { quotas[c]--; diff++; moved = true; }
    }
    if (!moved) break; // every criterion is at its floor or ceiling
  }

  const rng = new Mulberry32(Math.floor(seed) || 0);
  const picked: T[] = [];
  for (const c of CRITERION_ORDER) {
    const chosen = pick(groups[c], quotas[c] || 0, rng);
    selected[c] = chosen.length;
    picked.push(...chosen);
  }
  return { picked, selected };
}

/** How many random control items to draw when the count is left on auto. */
export function autoRandomCount(nonRiskPoolSize: number): number {
  return Math.max(5, Math.round(nonRiskPoolSize * 0.01));
}

/** Machine-readable selection reason, e.g. 'Risk: holiday, weekend'. */
export function riskReasonLabel(flags: RiskFlags): string {
  const hit = CRITERION_ORDER.filter(c => flags[c]);
  return hit.length > 0 ? `Risk: ${hit.join(', ')}` : 'Risk Criteria';
}
