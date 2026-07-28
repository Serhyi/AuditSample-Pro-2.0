import { describe, it, expect } from 'vitest';
import { FREE_METHODS } from './MethodSelector';

describe('free tier methods', () => {
  it('includes risk assessment', () => {
    expect(FREE_METHODS).toContain('RiskAssessment');
  });

  it('keeps the value-based methods behind a licence', () => {
    // These need materiality and confidence levels, which is the paid feature.
    for (const paid of ['MUS', 'CVS', 'Cluster', 'Attribute', 'Random']) {
      expect(FREE_METHODS).not.toContain(paid);
    }
  });
});
