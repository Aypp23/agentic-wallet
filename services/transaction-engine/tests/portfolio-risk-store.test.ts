import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PortfolioRiskStore } from '../src/risk/portfolio-risk-store.js';

describe('PortfolioRiskStore', () => {
  it('requires approval when token exposure exceeds configured threshold', () => {
    const store = new PortfolioRiskStore();
    const walletId = randomUUID();
    store.upsertControls({
      walletId,
      maxExposureBpsPerToken: 1000,
    });

    const result = store.evaluateProjected(walletId, 'jupiter', 'SOL', 2_000_000, 10_000_000);
    expect(result.decision).toBe('require_approval');
  });
});
