import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createEscrowAdapter } from '../src/adapters/escrow.adapter.js';

const PROGRAM_ID = '8xD9F8dP4yN3iG4MBXit4nB9hQn3ju8pGkJ2m8SLxPCv';
const CREATOR = '4Usb5gsxg36LaxaWWH4NmJ5UwEoMpf8WbYzhWhrvWpXw';
const RECIPIENT = '3ffYfeB4toVUhgEPKgEeSRqFbff5EXHHqNvxmW5p2r2G';
const ARBITER = 'DEUoqik3sTHqHtPjVdnCFN13eVRVZe6gYPDEgx8GvY54';
const FEE_RECIPIENT = '5fzdT6nGnPZXoqBYwygJyBEtQtdgQXVc3k5ufADG7n2U';
const ESCROW_ACCOUNT = '7RCz8wb6WXxUhAigok9ttgrVgDFFFbibcirECzWSBauM';

const disc = (method: string): Buffer =>
  createHash('sha256').update(`global:${method}`).digest().subarray(0, 8);

describe('escrow adapter instruction encoding', () => {
  it('builds create_escrow instruction with anchor discriminator + args', async () => {
    vi.stubEnv('ESCROW_PROGRAM_ID', PROGRAM_ID);
    const adapter = createEscrowAdapter();

    const result = await adapter.buildIntent!(
      'create_escrow',
      CREATOR,
      {
        counterparty: RECIPIENT,
        arbiter: ARBITER,
        feeRecipient: FEE_RECIPIENT,
        amount: '1000000',
        escrowNumericId: '7',
        feeBasisPoints: 150,
      },
    );

    expect(result.mode).toBe('instructions');
    expect(result.instructions).toHaveLength(1);

    const ix = result.instructions![0];
    expect(ix.programId).toBe(PROGRAM_ID);
    expect(ix.keys).toHaveLength(6);

    const data = Buffer.from(ix.data, 'base64');
    expect(data.subarray(0, 8).equals(disc('create_escrow'))).toBe(true);

    // escrow_id (u64) starts at byte 8
    expect(data.readBigUInt64LE(8)).toBe(7n);
  });

  it('builds resolve_dispute with enum winner payload', async () => {
    vi.stubEnv('ESCROW_PROGRAM_ID', PROGRAM_ID);
    const adapter = createEscrowAdapter();

    const result = await adapter.buildIntent!(
      'resolve_dispute',
      ARBITER,
      {
        escrowAccount: ESCROW_ACCOUNT,
        creator: CREATOR,
        recipient: RECIPIENT,
        feeRecipient: FEE_RECIPIENT,
        winner: 'recipient',
      },
    );

    const ix = result.instructions![0];
    const data = Buffer.from(ix.data, 'base64');
    expect(data.subarray(0, 8).equals(disc('resolve_dispute'))).toBe(true);
    expect(data.readUInt8(8)).toBe(1);

    expect(ix.keys[1]?.pubkey).toBe(ARBITER);
    expect(ix.keys[1]?.isSigner).toBe(true);
  });
});
