import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfigStep from './ConfigStep';
import { SamplingConfig } from '../types';

const Harness = ({ onConfig }: { onConfig: (c: SamplingConfig) => void }) => {
  const [config, setConfig] = useState<SamplingConfig>({
    method: 'RiskAssessment', confidenceLevel: 90, tolerableMisstatement: 1000,
    expectedMisstatement: 0, clearlyTrivialThreshold: 0, riskFactor: 'Moderate',
    anomalyMethod: 'None', seed: 7
  } as SamplingConfig);
  onConfig(config);
  return <ConfigStep config={config} setConfig={setConfig} totalPopulationValue={100000}
                     lang="ua" licenseState={{ tier: 'pro' } as any} onLockedMethodClick={() => {}}
                     riskPreview={{ eligible: 1896, matched: 146, hits: { weekend: 9, holiday: 0, closing: 139 } }} />;
};

describe('sample size choice', () => {
  it('shows how many entries the criteria catch', () => {
    render(<Harness onConfig={() => {}} />);
    expect(screen.getByText(/146 із 1896/)).toBeTruthy();
  });

  it('starts at 25 when the auditor chooses to limit the sample', () => {
    let latest: any = null;
    render(<Harness onConfig={(c) => { latest = c; }} />);
    expect(latest.riskMaxByCriteria).toBeUndefined();      // unlimited by default
    fireEvent.click(screen.getByText('Обмежити вибірку до'));
    expect(latest.riskMaxByCriteria).toBe(25);
    fireEvent.click(screen.getByText(/Перевірити всі операції/));
    expect(latest.riskMaxByCriteria).toBe(0);
  });
});

describe('risk criteria checkboxes', () => {
  it('keeps every risk flag when several are changed in turn', () => {
    let latest: any = null;
    render(<Harness onConfig={(c) => { latest = c; }} />);
    fireEvent.click(screen.getByText('Включати вихідні'));
    fireEvent.click(screen.getByText('Включати свята'));
    // seed, closing days, random count, ...
    const nums = Array.from(document.querySelectorAll('input[type=number]')) as HTMLInputElement[];
    fireEvent.change(nums[1], { target: { value: '2' } });
    expect(latest.riskWeekend).toBe(false);
    expect(latest.riskHoliday).toBe(false);
    expect(latest.riskClosingDays).toBe(2);
  });

  it('unchecking weekends reaches the config', () => {
    let latest: SamplingConfig | null = null;
    render(<Harness onConfig={(c) => { latest = c; }} />);
    fireEvent.click(screen.getByText('Включати вихідні'));
    expect((latest as any).riskWeekend).toBe(false);
  });
});
