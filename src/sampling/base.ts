import { PopulationItem, SamplingParams, SamplingResult, SamplingMethodType } from '@types';

/**
 * Абстрактний клас для всіх методів аудиторської вибірки
 * Реалізує шаблон Template Method
 */
export abstract class SamplingMethod {
  abstract readonly name: string;
  abstract readonly type: SamplingMethodType;

  /**
   * Розрахунок розміру вибірки
   */
  abstract calculateSampleSize(params: SamplingParams): number;

  /**
   * Відбір зразків з генеральної сукупності
   */
  abstract selectSample(
    population: PopulationItem[],
    size: number,
    seed?: number
  ): PopulationItem[];

  /**
   * Екстраполяція результатів на всю сукупність
   */
  abstract extrapolate(
    sample: PopulationItem[],
    population: PopulationItem[]
  ): { projected: number; upperBound: number; precision: number };

  /**
   * Повний цикл вибірки (Template Method)
   */
  execute(params: SamplingParams): SamplingResult {
    this.validateParams(params);

    const seed = params.seed ?? this.generateSeed();
    const size = this.calculateSampleSize(params);
    const sample = this.selectSample(params.population, size, seed);
    const extrapolation = this.extrapolate(sample, params.population);

    return {
      sample,
      keyItems: this.extractKeyItems(params.population, params.tolerableMisstatement),
      trivialItems: this.extractTrivialItems(params.population, params.tolerableMisstatement),
      projectedMisstatement: extrapolation.projected,
      upperMisstatementBound: extrapolation.upperBound,
      precision: extrapolation.precision,
      method: this.type,
      seed,
      timestamp: new Date()
    } as unknown as SamplingResult; // We cast this because the 'legacy' SamplingResult is merged and structurally different.
  }

  protected validateParams(params: SamplingParams): void {
    if (!params.population || params.population.length === 0) {
      throw new Error('Population cannot be empty');
    }
    if (params.tolerableMisstatement <= 0) {
      throw new Error('Tolerable misstatement must be positive');
    }
    if (params.confidenceLevel <= 0 || params.confidenceLevel >= 1) {
      throw new Error('Confidence level must be between 0 and 1');
    }
  }

  protected extractKeyItems(
    population: PopulationItem[],
    threshold: number
  ): PopulationItem[] {
    return population.filter(item => item.bookValue >= threshold);
  }

  protected extractTrivialItems(
    population: PopulationItem[],
    threshold: number
  ): PopulationItem[] {
    return population.filter(item => item.bookValue < threshold);
  }

  private generateSeed(): number {
    return Math.floor(Math.random() * 2 ** 32);
  }
}
