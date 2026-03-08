import { describe, expect, it } from 'vitest';
import { Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import {
  applyAdaptiveExecutionConfig,
  buildAdaptiveExecutionConfig,
} from '../src/solana/execution-tuner.js';

describe('execution-tuner', () => {
  it('builds bounded adaptive config from recent priority fees', () => {
    const config = buildAdaptiveExecutionConfig({
      type: 'swap',
      instructionCount: 3,
      recentPriorityFees: [0, 500, 1200, 5000, 10000],
      minPriorityFeeMicroLamports: 1000,
      maxPriorityFeeMicroLamports: 15000,
      percentile: 80,
      multiplierBps: 12000,
    });

    expect(config.computeUnitLimit).toBeGreaterThan(300_000);
    expect(config.priorityFeeMicroLamports).toBeGreaterThanOrEqual(1_000);
    expect(config.priorityFeeMicroLamports).toBeLessThanOrEqual(15_000);
  });

  it('prepends compute-budget instructions and keeps business instructions', () => {
    const payer = new PublicKey('11111111111111111111111111111111');
    const recipient = new PublicKey('SysvarRent111111111111111111111111111111111');
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: recipient,
        lamports: 1,
      }),
    );

    applyAdaptiveExecutionConfig(tx, {
      computeUnitLimit: 250_000,
      priorityFeeMicroLamports: 5_000,
    });

    expect(tx.instructions.length).toBe(3);
    const computeProgramId = 'ComputeBudget111111111111111111111111111111';
    expect(tx.instructions[0]?.programId.toBase58()).toBe(computeProgramId);
    expect(tx.instructions[1]?.programId.toBase58()).toBe(computeProgramId);
    expect(tx.instructions[2]?.programId.equals(SystemProgram.programId)).toBe(true);
  });
});
