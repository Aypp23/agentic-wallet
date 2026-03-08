import { describe, expect, it } from 'vitest';
import { evaluateDeltaGuard, expectedLamportsDelta } from '../src/safety/delta-guard.js';

describe('delta guard', () => {
  it('computes expected transfer delta', () => {
    expect(expectedLamportsDelta('transfer_sol', { lamports: 1000 })).toBe(-1000);
  });

  it('flags high variance', () => {
    const result = evaluateDeltaGuard(-1000, -2000, 1000);
    expect(result.ok).toBe(false);
    expect(result.varianceBps).toBeGreaterThan(1000);
  });
});
