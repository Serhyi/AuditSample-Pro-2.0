/**
 * Mulberry32 - швидкий генератор псевдовипадкових чисел
 * Гарантує відтворюваність при однаковому seed
 */
export class Mulberry32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0; // Перетворення на unsigned 32-bit
  }

  /**
   * Генерація наступного числа [0, 1)
   */
  next(): number {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Генерація цілого числа в діапазоні [min, max)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /**
   * Перемішування масиву (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Вибір випадкових елементів без повторень
   */
  sample<T>(array: T[], count: number): T[] {
    if (count > array.length) {
      throw new Error('Sample count cannot exceed population size');
    }
    const shuffled = this.shuffle(array);
    return shuffled.slice(0, count);
  }
}
