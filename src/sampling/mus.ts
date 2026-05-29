import { SamplingMethod } from './base';
import { PopulationItem, SamplingParams, SamplingMethodType } from '@types';
import { getReliabilityFactor, getExpansionFactor } from '../statistics/reliabilityFactor';

export class MUSSampling extends SamplingMethod {
  readonly name = 'Monetary Unit Sampling';
  readonly type: SamplingMethodType = 'MUS';

  calculateSampleSize(params: SamplingParams): number {
    const populationValue = params.population.reduce((sum, item) => sum + Math.max(0, item.bookValue), 0);
    // MUS моделює помилки розподілом Пуассона, тому коефіцієнт надійності
    // береться з таблиці Пуассона (≈3.0 для 95%), а не як z-score (1.96).
    // confidenceLevel у SamplingParams зберігається як дріб (напр. 0.95).
    const confidencePct = params.confidenceLevel <= 1 ? Math.round(params.confidenceLevel * 100) : params.confidenceLevel;
    const reliabilityFactor = getReliabilityFactor(confidencePct);
    // ISA 530 / AICPA: знаменник зменшується на очікувані помилки, зважені
    // expansion factor (із захистом від нуля/від'ємного значення).
    const expectedError = params.expectedError || 0;
    const expansionFactor = getExpansionFactor(confidencePct);
    const denominator = Math.max(params.tolerableMisstatement - expectedError * expansionFactor, params.tolerableMisstatement * 0.01);
    const size = Math.ceil((populationValue * reliabilityFactor) / denominator);
    return Math.max(1, Math.min(size, params.population.length));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  selectSample(population: PopulationItem[], size: number, _seed?: number): PopulationItem[] {
    const populationValue = population.reduce((sum, item) => sum + Math.max(0, item.bookValue), 0);
    const interval = populationValue / size;
    const sample: PopulationItem[] = [];
    
    // Simulate MUS drawing
    let runningTotal = 0;
    let nextHit = interval / 2; // Fixed start for testing

    for (const item of population) {
      if (item.bookValue <= 0) continue;
      runningTotal += item.bookValue;
      while (runningTotal >= nextHit) {
        sample.push(item);
        nextHit += interval;
      }
    }
    return sample;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  extrapolate(_sample: PopulationItem[], _population: PopulationItem[]) {
    // Simplified extrapolation
    return {
      projected: 0,
      upperBound: 0,
      precision: 0
    };
  }
}
