import { SamplingParams } from '@types';

export class ValidationError extends Error {
  constructor(message: string, public field: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Валідація параметрів вибірки
 */
export function validateSamplingParams(params: SamplingParams): void {
  // Перевірка сукупності
  if (!Array.isArray(params.population)) {
    throw new ValidationError('Population must be an array', 'population');
  }

  if (params.population.length === 0) {
    throw new ValidationError('Population cannot be empty', 'population');
  }

  // Перевірка кожного елемента
  params.population.forEach((item, index) => {
    if (!item.id) {
      throw new ValidationError(`Item ${index} missing id`, `population[${index}].id`);
    }
    if (typeof item.bookValue !== 'number' || isNaN(item.bookValue)) {
      throw new ValidationError(`Item ${index} has invalid bookValue`, `population[${index}].bookValue`);
    }
    if (item.bookValue < 0) {
      throw new ValidationError(`Item ${index} has negative bookValue (not allowed for MUS)`, `population[${index}].bookValue`);
    }
  });

  // Перевірка PM
  if (typeof params.tolerableMisstatement !== 'number' || params.tolerableMisstatement <= 0) {
    throw new ValidationError('Tolerable misstatement must be positive number', 'tolerableMisstatement');
  }

  // Перевірка рівня довіри
  if (typeof params.confidenceLevel !== 'number') {
    throw new ValidationError('Confidence level must be a number', 'confidenceLevel');
  }
  if (params.confidenceLevel <= 0.5 || params.confidenceLevel >= 1) {
    throw new ValidationError('Confidence level must be between 0.5 and 1', 'confidenceLevel');
  }

  // Перевірка expectedError
  if (params.expectedError !== undefined) {
    if (params.expectedError < 0) {
      throw new ValidationError('Expected error cannot be negative', 'expectedError');
    }
    if (params.expectedError > params.tolerableMisstatement) {
      throw new ValidationError('Expected error cannot exceed tolerable misstatement', 'expectedError');
    }
  }

  // Перевірка seed
  if (params.seed !== undefined && (!Number.isInteger(params.seed) || params.seed < 0)) {
    throw new ValidationError('Seed must be a non-negative integer', 'seed');
  }
}

/**
 * Валідація для CVS (допускає від'ємні значення)
 */
export function validateCVSParams(params: SamplingParams): void {
  validateSamplingParams(params);
  // CVS допускає від'ємні bookValue, тому перевіряємо лише на NaN
  params.population.forEach((item, index) => {
    if (isNaN(item.bookValue)) {
      throw new ValidationError(`Item ${index} has invalid bookValue`, `population[${index}].bookValue`);
    }
  });
}
