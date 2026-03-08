import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { decryptText, encryptText } from '../crypto/encryption.js';
import type { KeyProvider } from './key-provider.js';
import type { KeyProvenance } from '@agentic-wallet/common';

export class EncryptedFileKeyProvider implements KeyProvider {
  constructor(
    private readonly keysDir: string,
    private readonly encryptionSecret: string,
  ) {}

  async save(walletId: string, keypair: Keypair): Promise<void> {
    await fs.mkdir(this.keysDir, { recursive: true });
    const keyFile = path.join(this.keysDir, `${walletId}.json`);
    const secretBytes = JSON.stringify(Array.from(keypair.secretKey));
    const encrypted = encryptText(secretBytes, this.encryptionSecret);
    await fs.writeFile(keyFile, encrypted, 'utf8');
  }

  async load(walletId: string): Promise<Keypair> {
    const keyFile = path.join(this.keysDir, `${walletId}.json`);
    const encrypted = await fs.readFile(keyFile, 'utf8');
    const secretBytes = JSON.parse(decryptText(encrypted, this.encryptionSecret)) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secretBytes));
  }

  provenance(): KeyProvenance {
    return {
      backend: 'encrypted-file',
      custody: 'local',
      deterministicAddressing: false,
    };
  }
}
