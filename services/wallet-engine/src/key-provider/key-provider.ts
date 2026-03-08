import type { Keypair } from '@solana/web3.js';
import type { KeyProvenance } from '@agentic-wallet/common';

export interface KeyProvider {
  save(walletId: string, keypair: Keypair): Promise<void>;
  load(walletId: string): Promise<Keypair>;
  provenance(): KeyProvenance;
}
