import { describe, expect, it } from 'vitest';
import { hashString, mulberry32, normal } from './random.ts';
import { mean, std } from './stats.ts';

describe('random', () => {
  it('is reproducible for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('produces roughly standard normal samples', () => {
    const random = mulberry32(7);
    const samples = Array.from({ length: 20000 }, () => normal(random));
    expect(mean(samples)).toBeCloseTo(0, 1);
    expect(std(samples)).toBeCloseTo(1, 1);
  });

  it('hashes strings deterministically', () => {
    expect(hashString('TCS.NS:2026-09-11')).toBe(hashString('TCS.NS:2026-09-11'));
    expect(hashString('TCS.NS:2026-09-11')).not.toBe(hashString('TCS.NS:2026-09-10'));
  });
});
