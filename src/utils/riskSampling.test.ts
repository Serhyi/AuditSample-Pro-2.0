import { describe, it, expect } from 'vitest';
import { runSampling } from './samplingEngine';
import { getCalculationDetails } from '../components/resultsUtils';
import { SamplingConfig, TransactionItem } from '../types';

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

const byCriteria = (r: any) => r.samplingItems.filter((i: any) => i.selectionReason === 'Risk Criteria').length;

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
