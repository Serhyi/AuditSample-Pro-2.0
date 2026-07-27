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
                     lang="ua" licenseState={{ tier: 'pro' } as any} onLockedMethodClick={() => {}} />;
};

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
