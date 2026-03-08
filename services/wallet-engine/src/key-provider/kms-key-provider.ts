import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import type { KeyProvenance } from '@agentic-wallet/common';
import { decryptText, encryptText } from '../crypto/encryption.js';
import type { KeyProvider } from './key-provider.js';

interface KmsEnvelope {
  v: 1;
  keyId: string;
  wrappedDataKey: string;
  encryptedSecret: string;
  createdAt: string;
}

export class KmsKeyProvider implements KeyProvider {
  constructor(
    private readonly keysDir: string,
    private readonly masterSecret: string,
    private readonly keyId: string,
  ) {}

  private secretForWrap(): string {
    return `${this.masterSecret}:${this.keyId}`;
  }

  private keyFile(walletId: string): string {
    return path.join(this.keysDir, `${walletId}.kms.json`);
  }

  async save(walletId: string, keypair: Keypair): Promise<void> {
    await fs.mkdir(this.keysDir, { recursive: true });

    const dataKey = randomBytes(32).toString('base64');
    const wrappedDataKey = encryptText(dataKey, this.secretForWrap());
    const encryptedSecret = encryptText(Buffer.from(keypair.secretKey).toString('base64'), dataKey);
    const payload: KmsEnvelope = {
      v: 1,
      keyId: this.keyId,
      wrappedDataKey,
      encryptedSecret,
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(this.keyFile(walletId), JSON.stringify(payload), 'utf8');
  }

  async load(walletId: string): Promise<Keypair> {
    const raw = await fs.readFile(this.keyFile(walletId), 'utf8');
    const payload = JSON.parse(raw) as KmsEnvelope;
    if (payload.v !== 1) {
      throw new Error(`Unsupported KMS envelope version: ${String(payload.v)}`);
    }

    const dataKey = decryptText(payload.wrappedDataKey, this.secretForWrap());
    const secretB64 = decryptText(payload.encryptedSecret, dataKey);
    const secret = Buffer.from(secretB64, 'base64');
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }

  provenance(): KeyProvenance {
    return {
      backend: 'kms',
      custody: 'external',
      deterministicAddressing: false,
    };
  }
}

