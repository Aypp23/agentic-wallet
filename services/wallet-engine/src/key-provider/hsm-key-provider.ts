import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import type { KeyProvenance } from '@agentic-wallet/common';
import { decryptText, encryptText } from '../crypto/encryption.js';
import type { KeyProvider } from './key-provider.js';

interface HsmEnvelope {
  v: 1;
  slotId: string;
  wrappedSecret: string;
  createdAt: string;
}

export class HsmKeyProvider implements KeyProvider {
  constructor(
    private readonly keysDir: string,
    private readonly slotId: string,
    private readonly pin: string,
    private readonly moduleSecret: string,
  ) {}

  private keyFile(walletId: string): string {
    return path.join(this.keysDir, `${walletId}.hsm.json`);
  }

  private unwrapSecret(): string {
    return `${this.moduleSecret}:${this.slotId}:${this.pin}`;
  }

  async save(walletId: string, keypair: Keypair): Promise<void> {
    await fs.mkdir(this.keysDir, { recursive: true });
    const payload: HsmEnvelope = {
      v: 1,
      slotId: this.slotId,
      wrappedSecret: encryptText(Buffer.from(keypair.secretKey).toString('base64'), this.unwrapSecret()),
      createdAt: new Date().toISOString(),
    };

    await fs.writeFile(this.keyFile(walletId), JSON.stringify(payload), 'utf8');
  }

  async load(walletId: string): Promise<Keypair> {
    const raw = await fs.readFile(this.keyFile(walletId), 'utf8');
    const payload = JSON.parse(raw) as HsmEnvelope;
    if (payload.v !== 1) {
      throw new Error(`Unsupported HSM envelope version: ${String(payload.v)}`);
    }

    const secretB64 = decryptText(payload.wrappedSecret, this.unwrapSecret());
    return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(secretB64, 'base64')));
  }

  provenance(): KeyProvenance {
    return {
      backend: 'hsm',
      custody: 'external',
      deterministicAddressing: false,
    };
  }
}

