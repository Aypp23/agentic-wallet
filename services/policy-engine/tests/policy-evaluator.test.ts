import { describe, expect, it } from 'vitest';
import type { Policy } from '@agentic-wallet/common';
import { PolicyEvaluator } from '../src/engine/policy-evaluator.js';

const basePolicy: Policy = {
  id: 'a1111111-1111-1111-1111-111111111111',
  walletId: 'b1111111-1111-1111-1111-111111111111',
  name: 'default',
  version: 1,
  active: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rules: [
    {
      type: 'spending_limit',
      maxLamportsPerTx: 1_000_000_000,
      requireApprovalAboveLamports: 500_000_000,
    },
  ],
};

describe('PolicyEvaluator', () => {
  it('denies when amount exceeds tx limit', () => {
    const evaluator = new PolicyEvaluator();
    const decision = evaluator.evaluate(
      {
        walletId: basePolicy.walletId,
        type: 'transfer_sol',
        protocol: 'system-program',
        amountLamports: 2_000_000_000,
        programIds: [],
      },
      [basePolicy],
    );

    expect(decision.decision).toBe('deny');
  });

  it('requires approval above threshold', () => {
    const evaluator = new PolicyEvaluator();
    const decision = evaluator.evaluate(
      {
        walletId: basePolicy.walletId,
        type: 'transfer_sol',
        protocol: 'system-program',
        amountLamports: 700_000_000,
        programIds: [],
      },
      [basePolicy],
    );

    expect(decision.decision).toBe('require_approval');
  });

  it('enforces protocol risk and portfolio rules', () => {
    const evaluator = new PolicyEvaluator();
    const policy: Policy = {
      ...basePolicy,
      rules: [
        {
          type: 'protocol_risk',
          protocol: 'jupiter',
          maxSlippageBps: 100,
          maxPoolConcentrationBps: 2000,
        },
        {
          type: 'portfolio_risk',
          maxExposureBpsPerToken: 3000,
        },
      ],
    };

    const decision = evaluator.evaluate(
      {
        walletId: basePolicy.walletId,
        type: 'swap',
        protocol: 'jupiter',
        slippageBps: 120,
        poolConcentrationBps: 2500,
        projectedTokenExposureBps: 5000,
        programIds: [],
      },
      [policy],
    );

    expect(decision.decision).toBe('deny');
  });
});
