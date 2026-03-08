import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildExecutionProof } from '../src/security/execution-proof.js';

describe('execution proof', () => {
  it('produces deterministic hashes for same payload', () => {
    const input = {
      txId: randomUUID(),
      walletId: randomUUID(),
      intent: { destination: 'abc', lamports: 1 },
      policyDecision: { decision: 'allow' },
      simulation: { ok: true, logs: [] as string[] },
      signature: 'sig',
    };

    const a = buildExecutionProof(input);
    const b = buildExecutionProof(input);

    expect(a.intentHash).toBe(b.intentHash);
    expect(a.policyHash).toBe(b.policyHash);
    expect(a.simulationHash).toBe(b.simulationHash);
    expect(a.proofHash).toBe(b.proofHash);
  });
});
