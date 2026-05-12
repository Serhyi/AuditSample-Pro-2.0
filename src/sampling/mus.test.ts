import { describe, it, expect } from 'vitest';
import { MUSSampling } from './mus';
import { PopulationItem } from '@types';

describe('MUS Sampling', () => {
  const createPopulation = (count: number, value: number): PopulationItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      bookValue: value
    }));

  it('should calculate correct sample size', () => {
    const mus = new MUSSampling();
    const population = createPopulation(100, 1000);

    const size = mus.calculateSampleSize({
      population,
      tolerableMisstatement: 5000,
      confidenceLevel: 0.95
    });

    // n = (100000 * 1.96) / 5000 ≈ 39
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(100);
  });

  it('should select items with probability proportional to size', () => {
    const mus = new MUSSampling();
    const population = [
      { id: 'small', bookValue: 100 },
      { id: 'medium', bookValue: 1000 },
      { id: 'large', bookValue: 10000 }
    ];

    const sample = mus.selectSample(population, 100, 12345);

    // Великі елементи мають вищу ймовірність
    const largeCount = sample.filter(s => s.id === 'large').length;
    const smallCount = sample.filter(s => s.id === 'small').length;

    expect(largeCount).toBeGreaterThan(smallCount);
  });
});
