import { describe, expect, it } from 'vitest';
import { TransactionStore } from '../src/store/transaction-store.js';
import type { TransactionRecord } from '../src/types.js';

const makeTx = (overrides: Partial<TransactionRecord> = {}): TransactionRecord => ({
  id: overrides.id ?? 'tx-1',
  walletId: overrides.walletId ?? 'wallet-1',
  type: overrides.type ?? 'transfer_sol',
  protocol: overrides.protocol ?? 'system-program',
  gasless: overrides.gasless ?? false,
  status: overrides.status ?? 'pending',
  createdAt: overrides.createdAt ?? new Date().toISOString(),
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  intent: overrides.intent ?? {},
  programIds: overrides.programIds ?? [],
  stageHistory: overrides.stageHistory ?? [],
  ...overrides,
});

describe('TransactionStore', () => {
  it('tracks idempotency keys', () => {
    const store = new TransactionStore();
    const tx = makeTx({ id: 'tx-idem', idempotencyKey: 'idem-key-0001' });

    store.set(tx);

    expect(store.getByIdempotency('idem-key-0001')?.id).toBe('tx-idem');
  });

  it('updates positions and escrow records', () => {
    const store = new TransactionStore();

    store.upsertPosition({
      walletId: 'wallet-1',
      protocol: 'solend',
      positionType: 'lend_supply',
      asset: 'mint-a',
      delta: 2,
    });

    store.upsertPosition({
      walletId: 'wallet-1',
      protocol: 'solend',
      positionType: 'lend_supply',
      asset: 'mint-a',
      delta: 3,
    });

    const [position] = store.listPositions('wallet-1');
    expect(position?.amount).toBe('5');

    store.upsertEscrow({
      walletId: 'wallet-1',
      escrowId: 'escrow-1',
      protocol: 'escrow',
      state: 'create_escrow',
      counterparty: 'wallet-2',
      amount: '100',
    });

    store.upsertEscrow({
      walletId: 'wallet-1',
      escrowId: 'escrow-1',
      protocol: 'escrow',
      state: 'release_escrow',
      counterparty: 'wallet-2',
      amount: '100',
    });

    const [escrow] = store.listEscrows('wallet-1');
    expect(escrow?.state).toBe('release_escrow');
  });
});
