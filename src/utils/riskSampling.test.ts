import { describe, it, expect } from 'vitest';
import { runSampling } from './samplingEngine';
import { getCalculationDetails } from '../components/resultsUtils';
import { SamplingConfig, TransactionItem } from '../types';
import { previewRiskMatches, riskCriteriaOptions } from './riskSelection';

// July 2025: 05/06, 12/13, 19/20, 26/27 are weekends; 30 and 31 are the last
// two days of the month; 26 and 27 are both (weekend and closing).
const population: TransactionItem[] = Array.from({ length: 31 }, (_, i) => ({
  id: String(i + 1),
  date: `2025-07-${String(i + 1).padStart(2, '0')}`,
  amount: 100,
  originalRow: []
})) as any;

const base = {
  method: 'RiskAssessment', confidenceLevel: 90, tolerableMisstatement: 0,
  expectedMisstatement: 0, clearlyTrivialThreshold: 0, riskFactor: 'Moderate',
  anomalyMethod: 'None', seed: 7, riskClosingDays: 2, riskRandomCount: 0,
  riskHoliday: false, holidays: []
} as unknown as SamplingConfig;

const byCriteria = (r: any) => r.samplingItems.filter((i: any) => String(i.selectionReason).startsWith('Risk')  && !String(i.selectionReason).startsWith('Random')).length;

describe('RiskAssessment criteria', () => {
  it('drops weekend matches when weekends are switched off', () => {
    const on = runSampling(population, { ...base, riskWeekend: true });
    const off = runSampling(population, { ...base, riskWeekend: false });

    expect(on.riskCriteriaHits).toEqual({ weekend: 8, holiday: 0, closing: 2 });
    expect(off.riskCriteriaHits).toEqual({ weekend: 0, holiday: 0, closing: 2 });
    expect(byCriteria(on)).toBe(8 + 2);   // 26,27 are weekends, 30,31 closing
    expect(byCriteria(off)).toBe(2);
  });

  it('describes only the criteria that were enabled', () => {
    const off = runSampling(population, { ...base, riskWeekend: false });
    const details = getCalculationDetails({ ...base, riskWeekend: false }, off, 'ua');

    expect(details.subst).not.toContain('вихідні дні');
    expect(details.subst).toContain('останні 2 дн. місяця — 2');

    const on = runSampling(population, { ...base, riskWeekend: true });
    expect(getCalculationDetails({ ...base, riskWeekend: true }, on, 'ua').subst).toContain('вихідні дні — 8');
  });
});

describe('capped criteria selection', () => {
  // 300 month-end entries against 9 weekend entries: the rare criterion must
  // survive the cap instead of being drowned out by the broad one.
  const many: TransactionItem[] = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, date: '2025-07-05', amount: 100, originalRow: [] })),
    ...Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, date: '2025-07-31', amount: 100, originalRow: [] }))
  ] as any;

  const capped = { ...base, riskWeekend: true, riskMaxByCriteria: 30, riskRandomAuto: false, riskRandomCount: 0 } as SamplingConfig;

  it('keeps the quota proportional and never starves a criterion', () => {
    const r = runSampling(many, capped);
    expect(r.riskMatchedTotal).toBe(309);
    expect(byCriteria(r)).toBe(30);
    expect(r.riskCriteriaSelected!.weekend).toBeGreaterThanOrEqual(1);
    expect(r.riskCriteriaSelected!.weekend + r.riskCriteriaSelected!.closing).toBe(30);
  });

  it('is reproducible from the seed and different for another seed', () => {
    const ids = (c: SamplingConfig) => runSampling(many, c).samplingItems.map(i => i.id).sort().join(',');
    expect(ids(capped)).toBe(ids({ ...capped }));
    expect(ids(capped)).not.toBe(ids({ ...capped, seed: 99 }));
  });

  it('takes everything when no cap is set', () => {
    const r = runSampling(many, { ...capped, riskMaxByCriteria: 0 });
    expect(byCriteria(r)).toBe(309);
  });

  it('names the criterion that selected each item', () => {
    const r = runSampling(many, { ...capped, riskMaxByCriteria: 0 });
    expect(r.samplingItems.some(i => i.selectionReason === 'Risk: weekend')).toBe(true);
    expect(r.samplingItems.some(i => i.selectionReason === 'Risk: closing')).toBe(true);
  });
});

describe('key items and the trivial cut', () => {
  const withAmounts: TransactionItem[] = [
    { id: 'big', date: '2025-07-05', amount: 90000, originalRow: [] },
    { id: 'small', date: '2025-07-05', amount: 50, originalRow: [] },
    { id: 'mid', date: '2025-07-05', amount: 5000, originalRow: [] }
  ] as any;

  const cfg = { ...base, riskWeekend: true, riskClosingDays: 0, clearlyTrivialThreshold: 100,
                riskRandomAuto: false, riskRandomCount: 0, tolerableMisstatement: 43585 } as SamplingConfig;

  it('never splits off key items, whatever materiality says', () => {
    const r = runSampling(withAmounts, cfg);
    expect(r.keyItems).toHaveLength(0);
    expect(r.samplingItems.map(i => i.id)).toContain('big');
  });

  it('always drops amounts below the clearly-trivial threshold', () => {
    const r = runSampling(withAmounts, cfg);
    expect(r.samplingItems.map(i => i.id)).not.toContain('small');
    expect(r.trivialCount).toBe(1);
  });
});

describe('settings preview', () => {
  const opts = riskCriteriaOptions({ ...base, riskWeekend: true } as any);

  it('predicts exactly what the run will match', () => {
    const preview = previewRiskMatches(population, opts, 0);
    const run = runSampling(population, { ...base, riskWeekend: true, riskMaxByCriteria: 0 });

    expect(preview.matched).toBe(run.riskMatchedTotal);
    expect(preview.hits).toEqual(run.riskCriteriaHits);
    expect(preview.eligible).toBe(31);
  });

  it('leaves out amounts the trivial threshold will drop', () => {
    const withSmall = [...population, { id: 'x', date: '2025-07-05', amount: 10, originalRow: [] }] as any;
    expect(previewRiskMatches(withSmall, opts, 100).eligible).toBe(31);
    expect(previewRiskMatches(withSmall, opts, 0).eligible).toBe(32);
  });
});
