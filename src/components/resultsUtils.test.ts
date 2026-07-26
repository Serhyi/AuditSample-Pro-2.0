import { describe, it, expect } from 'vitest';
import { getCalculationDetails } from './resultsUtils';
import { SamplingConfig, SamplingResult, GlobalSettings } from '../types';

const settings: GlobalSettings = {
  numberSeparator: 'space_comma', language: 'ua', currency: 'UAH', holidays: []
};

const mkResult = (over: Partial<SamplingResult> = {}): SamplingResult => ({
  populationSize: 100, populationValue: 100000, trivialCount: 0, trivialValue: 0,
  areTrivialExcluded: false, sampleSize: 0, sampleValue: 0, samplingInterval: 0,
  keyItems: [], samplingItems: [], projectedMisstatement: 0, upperMisstatementBound: 0,
  ...over
} as SamplingResult);

describe('getCalculationDetails: RiskAssessment', () => {
  const config = {
    method: 'RiskAssessment', anomalyMethod: 'None', confidenceLevel: 95,
    // Left over from another method — must not surface in this card.
    tolerableMisstatement: 43585, riskFactor: 'Moderate',
    expectedMisstatement: 0, clearlyTrivialThreshold: 0,
    seed: 7, riskClosingDays: 5, riskWeekend: true, riskHoliday: false, riskRandomCount: 5
  } as unknown as SamplingConfig;

  const results = mkResult({
    samplingItems: [
      { selectionReason: 'Risk Criteria' }, { selectionReason: 'Risk Criteria' },
      { selectionReason: 'Random (Risk)' }
    ] as any
  });

  it('reports only parameters the method actually uses', () => {
    const { vars } = getCalculationDetails(config, results, settings, 'ua');
    const keys = Object.keys(vars);

    // Neither is configurable for RiskAssessment, so neither may be reported.
    expect(keys.some(k => k.includes('Суттєвість'))).toBe(false);
    expect(keys.some(k => k.includes('Оцінка ризику'))).toBe(false);
    expect(Object.values(vars)).not.toContain('Moderate');

    expect(vars['Операції у вихідні:']).toBe('так');
    expect(vars['Операції у свята:']).toBe('ні');
    expect(vars['Днів закриття періоду:']).toBe(5);
    expect(vars['Зерно генератора (Seed):']).toBe(7);
    expect(vars['Відібрано за критеріями ризику:']).toBe(2);
    expect(vars['Додано випадкових (контроль):']).toBe('1 / 5');
    expect(vars['Кількість відібраних елементів (n):']).toBe(3);
  });

  it('spells out the enabled criteria and how the sample adds up', () => {
    const { subst } = getCalculationDetails(config, results, settings, 'ua');
    expect(subst).toContain('вихідні дні');
    expect(subst).toContain('останні 5 дн. місяця');
    expect(subst).not.toContain('святкові дні'); // disabled in this config
    expect(subst).toContain('n = 2 (за критеріями) + 1 (випадкові) = 3');
  });

  it('says so when every criterion is switched off', () => {
    const off = { ...config, riskWeekend: false, riskHoliday: false, riskClosingDays: 0 } as SamplingConfig;
    const { subst } = getCalculationDetails(off, mkResult(), settings, 'ua');
    expect(subst).toContain('критерії вимкнено');
  });
});
