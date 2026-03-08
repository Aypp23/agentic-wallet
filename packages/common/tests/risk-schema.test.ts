import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  executionProofSchema,
  protocolRiskConfigSchema,
  strategyBacktestRequestSchema,
} from '../src/index.js';

describe('risk and strategy schemas', () => {
  it('validates protocol risk config', () => {
    const parsed = protocolRiskConfigSchema.safeParse({
      protocol: 'jupiter',
      version: '1.0.0',
      maxSlippageBps: 200,
      maxPoolConcentrationBps: 4000,
      allowedPools: [],
      allowedPrograms: [],
      oracleDeviationBps: 500,
      requireOracleForSwap: true,
      deltaVarianceBpsThreshold: 300,
      gaslessEligible: true,
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('validates execution proof hash lengths', () => {
    const parsed = executionProofSchema.safeParse({
      txId: randomUUID(),
      walletId: randomUUID(),
      intentHash: 'a'.repeat(64),
      policyHash: 'b'.repeat(64),
      simulationHash: 'c'.repeat(64),
      proofHash: 'd'.repeat(64),
      createdAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('validates strategy backtest request', () => {
    const parsed = strategyBacktestRequestSchema.safeParse({
      walletId: randomUUID(),
      name: 'mean-reversion',
      steps: [
        {
          type: 'swap',
          protocol: 'jupiter',
          intent: {},
          timestamp: new Date().toISOString(),
          simulatedPnlLamports: 1,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
