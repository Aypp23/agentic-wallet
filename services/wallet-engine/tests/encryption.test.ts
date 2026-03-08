import { describe, expect, it } from 'vitest';
import { decryptText, encryptText } from '../src/crypto/encryption.js';

describe('encryption', () => {
  it('round-trips encrypted text', () => {
    const secret = 'unit-test-secret';
    const plain = 'super-secret-key-material';
    const encrypted = encryptText(plain, secret);

    expect(encrypted).not.toEqual(plain);
    expect(decryptText(encrypted, secret)).toEqual(plain);
  });
});
