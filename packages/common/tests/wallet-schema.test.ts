import { describe, expect, it } from 'vitest';
import { signWalletPayloadSchema } from '../src/schemas/wallet.js';

describe('signWalletPayloadSchema', () => {
  it('accepts transaction-only payload', () => {
    const result = signWalletPayloadSchema.safeParse({ transaction: 'YWJj' });
    expect(result.success).toBe(true);
  });

  it('rejects payload with message and transaction', () => {
    const result = signWalletPayloadSchema.safeParse({
      transaction: 'YWJj',
      message: 'ZGVm',
    });
    expect(result.success).toBe(false);
  });
});
