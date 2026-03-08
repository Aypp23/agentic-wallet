import { Keypair } from '@solana/web3.js';
import type { KeyProvenance } from '@agentic-wallet/common';
import type { KeyProvider } from './key-provider.js';

export class MemoryKeyProvider implements KeyProvider {
  private readonly keys = new Map<string, Uint8Array>();

  async save(walletId: string, keypair: Keypair): Promise<void> {
    this.keys.set(walletId, Uint8Array.from(keypair.secretKey));
  }

  async load(walletId: string): Promise<Keypair> {
    const secret = this.keys.get(walletId);
    if (!secret) {
      throw new Error(`Key not found in memory provider for wallet ${walletId}`);
    }
    return Keypair.fromSecretKey(secret);
  }

  provenance(): KeyProvenance {
    return {
      backend: 'memory',
      custody: 'local',
      deterministicAddressing: false,
    };
  }
}
