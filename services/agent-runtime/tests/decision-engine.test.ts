import { describe, expect, it } from 'vitest';
import { agentSchema, type Agent } from '../../../packages/common/src/schemas/agent.js';
import {
  createDecisionState,
  decideAutonomousAction,
  markDecisionExecuted,
} from '../src/decision/engine.js';

const makeAgent = (overrides: Partial<Agent> = {}): Agent =>
  agentSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'autonomy-test-agent',
    walletId: '22222222-2222-4222-8222-222222222222',
    status: 'running',
    executionMode: 'autonomous',
    allowedIntents: ['transfer_sol', 'query_balance'],
    createdAt: '2026-03-04T00:00:00.000Z',
    updatedAt: '2026-03-04T00:00:00.000Z',
    autonomy: {
      enabled: true,
      mode: 'execute',
      cadenceSeconds: 1,
      maxActionsPerHour: 100,
      steps: [],
      rules: [],
    },
    ...overrides,
  });

describe('decision engine', () => {
  it('triggers rule-based execution when conditions match', () => {
    const agent = makeAgent({
      autonomy: {
        enabled: true,
        mode: 'execute',
        cadenceSeconds: 1,
        maxActionsPerHour: 100,
        steps: [],
        rules: [
          {
            id: 'low-liquidity-check',
            when: [{ metric: 'balance_lamports', op: 'lt', value: 1_000_000 }],
            then: {
              type: 'query_balance',
              protocol: 'system-program',
              intent: { note: 'probe-{{tick}}' },
            },
            cooldownSeconds: 1,
          },
        ],
      },
    });

    const state = createDecisionState();
    const candidate = decideAutonomousAction(
      agent,
      {
        tick: 7,
        walletId: agent.walletId,
        knownWallets: ['A', 'B'],
        balanceLamports: 500_000,
      },
      state,
      1_000,
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.source).toBe('rule');
    expect(candidate?.request.type).toBe('query_balance');
    expect(candidate?.request.intent.note).toBe('probe-7');
  });

  it('runs autonomous steps in round-robin order with cadence tracking', () => {
    const agent = makeAgent({
      autonomy: {
        enabled: true,
        mode: 'execute',
        cadenceSeconds: 1,
        maxActionsPerHour: 100,
        steps: [
          {
            id: 's1',
            type: 'query_balance',
            protocol: 'system-program',
            intent: { marker: 'first' },
            cooldownSeconds: 1,
          },
          {
            id: 's2',
            type: 'transfer_sol',
            protocol: 'system-program',
            intent: { destination: '{{knownWallet0}}', lamports: 1000 },
            cooldownSeconds: 1,
          },
        ],
        rules: [],
      },
    });

    const state = createDecisionState();
    const context = {
      tick: 1,
      walletId: agent.walletId,
      knownWallets: ['dest-wallet'],
      balanceLamports: 10_000_000,
    };

    const first = decideAutonomousAction(agent, context, state, 1_000);
    expect(first?.source).toBe('step');
    expect(first?.sourceId).toBe('s1');
    if (!first) {
      throw new Error('first decision unexpectedly null');
    }
    markDecisionExecuted(state, first, 1_000);

    const second = decideAutonomousAction(agent, { ...context, tick: 2 }, state, 2_500);
    expect(second?.source).toBe('step');
    expect(second?.sourceId).toBe('s2');
    expect(second?.request.intent.destination).toBe('dest-wallet');
  });
});
