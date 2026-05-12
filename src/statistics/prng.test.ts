import { describe, it, expect } from 'vitest';
import { Mulberry32 } from './prng';

describe('Mulberry32', () => {
  it('should generate reproducible sequence with same seed', () => {
    const prng1 = new Mulberry32(12345);
    const prng2 = new Mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      expect(prng1.next()).toBe(prng2.next());
    }
  });

  it('should generate different sequences with different seeds', () => {
    const prng1 = new Mulberry32(12345);
    const prng2 = new Mulberry32(54321);
    expect(prng1.next()).not.toBe(prng2.next());
  });

  it('should generate numbers in [0, 1) range', () => {
    const prng = new Mulberry32(99999);
    for (let i = 0; i < 1000; i++) {
      const value = prng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('should shuffle array reproducibly', () => {
    const prng = new Mulberry32(77777);
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled1 = prng.shuffle(array);
    const prng2 = new Mulberry32(77777);
    const shuffled2 = prng2.shuffle(array);
    expect(shuffled1).toEqual(shuffled2);
  });

  it('should sample without replacement', () => {
    const prng = new Mulberry32(11111);
    const array = ['a', 'b', 'c', 'd', 'e'];
    const sample = prng.sample(array, 3);
    expect(sample).toHaveLength(3);
    expect(new Set(sample).size).toBe(3); // Унікальні елементи
  });
});
