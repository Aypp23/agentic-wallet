import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import type { KeyProvenance } from '@agentic-wallet/common';
import { decryptText, encryptText } from '../crypto/encryption.js';
import type { KeyProvider } from './key-provider.js';

interface StoredShare {
  id: number;
  wrapped: string;
}

interface MpcEnvelope {
  v: 1;
  threshold: 2;
  shares: StoredShare[];
  createdAt: string;
}

const gfMul = (left: number, right: number): number => {
  let a = left & 0xff;
  let b = right & 0xff;
  let product = 0;

  for (let bit = 0; bit < 8; bit += 1) {
    if ((b & 1) === 1) {
      product ^= a;
    }
    const carry = a & 0x80;
    a = (a << 1) & 0xff;
    if (carry !== 0) {
      a ^= 0x1b;
    }
    b >>= 1;
  }

  return product & 0xff;
};

const gfPow = (value: number, exponent: number): number => {
  let result = 1;
  let base = value & 0xff;
  let exp = exponent;

  while (exp > 0) {
    if ((exp & 1) === 1) {
      result = gfMul(result, base);
    }
    base = gfMul(base, base);
    exp >>= 1;
  }

  return result & 0xff;
};

const gfInverse = (value: number): number => {
  if ((value & 0xff) === 0) {
    throw new Error('GF(256) inverse does not exist for zero');
  }

  return gfPow(value, 254);
};

const gfDiv = (left: number, right: number): number => gfMul(left, gfInverse(right));

const splitSecret = (secret: Uint8Array): Array<{ id: number; bytes: Uint8Array }> => {
  const coefficient = randomBytes(secret.length);
  const s1 = new Uint8Array(secret.length);
  const s2 = new Uint8Array(secret.length);
  const s3 = new Uint8Array(secret.length);

  for (let i = 0; i < secret.length; i += 1) {
    const secretByte = secret[i] ?? 0;
    const a = coefficient[i] ?? 0;
    s1[i] = (secretByte ^ gfMul(a, 1)) & 0xff;
    s2[i] = (secretByte ^ gfMul(a, 2)) & 0xff;
    s3[i] = (secretByte ^ gfMul(a, 3)) & 0xff;
  }

  return [
    { id: 1, bytes: s1 },
    { id: 2, bytes: s2 },
    { id: 3, bytes: s3 },
  ];
};

const reconstructFromTwoShares = (
  first: { id: number; bytes: Uint8Array },
  second: { id: number; bytes: Uint8Array },
): Uint8Array => {
  if (first.id === second.id) {
    throw new Error('Shares must come from different nodes');
  }
  if (first.bytes.length !== second.bytes.length) {
    throw new Error('MPC share length mismatch');
  }

  const denominator = (first.id ^ second.id) & 0xff;
  if (denominator === 0) {
    throw new Error('Invalid MPC share denominator');
  }

  const l1 = gfDiv(second.id & 0xff, denominator);
  const l2 = gfDiv(first.id & 0xff, denominator);
  const secret = new Uint8Array(first.bytes.length);

  for (let i = 0; i < secret.length; i += 1) {
    const y1 = first.bytes[i] ?? 0;
    const y2 = second.bytes[i] ?? 0;
    secret[i] = (gfMul(y1, l1) ^ gfMul(y2, l2)) & 0xff;
  }

  return secret;
};

export class MpcKeyProvider implements KeyProvider {
  constructor(
    private readonly keysDir: string,
    private readonly nodeSecrets: [string, string, string],
  ) {}

  private keyFile(walletId: string): string {
    return path.join(this.keysDir, `${walletId}.mpc.json`);
  }

  async save(walletId: string, keypair: Keypair): Promise<void> {
    await fs.mkdir(this.keysDir, { recursive: true });
    const shares = splitSecret(Uint8Array.from(keypair.secretKey));
    const wrappedShares: StoredShare[] = shares.map((share) => {
      const nodeSecret = this.nodeSecrets[share.id - 1];
      if (!nodeSecret) {
        throw new Error(`Missing MPC node secret for share ${share.id}`);
      }
      return {
        id: share.id,
        wrapped: encryptText(Buffer.from(share.bytes).toString('base64'), nodeSecret),
      };
    });

    const payload: MpcEnvelope = {
      v: 1,
      threshold: 2,
      shares: wrappedShares,
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(this.keyFile(walletId), JSON.stringify(payload), 'utf8');
  }

  async load(walletId: string): Promise<Keypair> {
    const raw = await fs.readFile(this.keyFile(walletId), 'utf8');
    const payload = JSON.parse(raw) as MpcEnvelope;
    if (payload.v !== 1) {
      throw new Error(`Unsupported MPC envelope version: ${String(payload.v)}`);
    }

    const availableShares: Array<{ id: number; bytes: Uint8Array }> = [];
    for (const share of payload.shares) {
      const secret = this.nodeSecrets[share.id - 1];
      if (!secret) {
        continue;
      }
      const shareB64 = decryptText(share.wrapped, secret);
      availableShares.push({
        id: share.id,
        bytes: Uint8Array.from(Buffer.from(shareB64, 'base64')),
      });
    }

    if (availableShares.length < payload.threshold) {
      throw new Error(
        `Insufficient MPC shares to reconstruct key: have ${availableShares.length}, require ${payload.threshold}`,
      );
    }

    const first = availableShares[0];
    const second = availableShares[1];
    if (!first || !second) {
      throw new Error('MPC reconstruction failed: share selection error');
    }
    const secret = reconstructFromTwoShares(first, second);
    return Keypair.fromSecretKey(secret);
  }

  provenance(): KeyProvenance {
    return {
      backend: 'mpc',
      custody: 'external',
      deterministicAddressing: false,
    };
  }
}
