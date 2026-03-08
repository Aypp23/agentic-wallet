import { describe, expect, it } from 'vitest';
import { OutboxStore } from '../src/store/outbox-store.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('OutboxStore', () => {
  it('deduplicates open jobs per tx/action and marks done', () => {
    const store = new OutboxStore();
    const first = store.enqueue('tx-1', 'execute', {
      request: {
        walletId: '00000000-0000-0000-0000-000000000001',
        type: 'query_balance',
        protocol: 'system-program',
        gasless: false,
        intent: {},
      },
    });
    const second = store.enqueue('tx-1', 'execute');

    expect(second.id).toBe(first.id);
    const claimed = store.claimNext(5_000);
    expect(claimed?.id).toBe(first.id);

    store.markDone(claimed!.id, claimed!.leaseId!);
    expect(store.stats().done).toBe(1);
    expect(store.listOpen().length).toBe(0);
  });

  it('reclaims expired processing jobs and supports retry/fail paths', async () => {
    const store = new OutboxStore();
    const job = store.enqueue('tx-2', 'retry');
    const claimed = store.claimNext(1);
    expect(claimed?.id).toBe(job.id);
    await sleep(5);

    const reclaimed = store.claimNext(1_000);
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.attempts).toBeGreaterThan(1);

    store.markFailed(reclaimed!.id, reclaimed!.leaseId!, 'transient', {
      retryable: true,
      maxAttempts: 3,
    });
    expect(store.stats().pending).toBe(1);

    const claimedAgain = store.claimNext(1_000);
    expect(claimedAgain?.id).toBe(job.id);
    store.markFailed(claimedAgain!.id, claimedAgain!.leaseId!, 'terminal', {
      retryable: false,
      maxAttempts: 3,
    });
    expect(store.stats().failed).toBe(1);
  });
});
