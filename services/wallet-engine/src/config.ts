import path from 'node:path';
import type { SignerBackend } from './key-provider/factory.js';

export interface WalletEngineConfig {
  port: number;
  solanaRpcUrl: string;
  encryptionSecret: string;
  dataDir: string;
  signerBackend: SignerBackend;
  kmsMasterSecret?: string;
  kmsKeyId?: string;
  hsmPin?: string;
  hsmModuleSecret?: string;
  hsmSlotId?: string;
  mpcNodeSecrets: string[];
  autoFundDefaultLamports: number;
  autoFundPayerPrivateKey?: string;
}

export const loadConfig = (): WalletEngineConfig => {
  const port = Number(process.env.WALLET_ENGINE_PORT ?? process.env.PORT ?? 3002);
  const solanaRpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const encryptionSecret = process.env.WALLET_KEY_ENCRYPTION_SECRET ?? 'local-dev-wallet-secret-change-me';
  const dataDir = process.env.WALLET_ENGINE_DATA_DIR ?? path.join(process.cwd(), 'services', 'wallet-engine', 'data');
  const signerBackend = (process.env.WALLET_SIGNER_BACKEND ?? 'encrypted-file') as SignerBackend;
  const mpcCsv = (process.env.WALLET_MPC_NODE_SECRETS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const mpcNodeSecrets = mpcCsv.length > 0
    ? mpcCsv
    : [
      process.env.WALLET_MPC_NODE1_SECRET ?? '',
      process.env.WALLET_MPC_NODE2_SECRET ?? '',
      process.env.WALLET_MPC_NODE3_SECRET ?? '',
    ].filter((value) => value.trim().length > 0);

  const autoFundDefaultLamportsRaw = Number(process.env.WALLET_AUTOFUND_DEFAULT_LAMPORTS ?? 2_000_000);
  const autoFundDefaultLamports = Number.isFinite(autoFundDefaultLamportsRaw) && autoFundDefaultLamportsRaw > 0
    ? Math.floor(autoFundDefaultLamportsRaw)
    : 2_000_000;

  const base: WalletEngineConfig = {
    port,
    solanaRpcUrl,
    encryptionSecret,
    dataDir,
    signerBackend,
    mpcNodeSecrets,
    autoFundDefaultLamports,
  };

  const autoFundPayerPrivateKey = process.env.WALLET_AUTOFUND_PAYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (autoFundPayerPrivateKey && autoFundPayerPrivateKey.trim().length > 0) {
    base.autoFundPayerPrivateKey = autoFundPayerPrivateKey.trim();
  }

  const kmsMasterSecret = process.env.WALLET_KMS_MASTER_SECRET;
  if (kmsMasterSecret) {
    base.kmsMasterSecret = kmsMasterSecret;
  }

  const kmsKeyId = process.env.WALLET_KMS_KEY_ID;
  if (kmsKeyId) {
    base.kmsKeyId = kmsKeyId;
  }

  const hsmPin = process.env.WALLET_HSM_PIN;
  if (hsmPin) {
    base.hsmPin = hsmPin;
  }

  const hsmModuleSecret = process.env.WALLET_HSM_MODULE_SECRET;
  if (hsmModuleSecret) {
    base.hsmModuleSecret = hsmModuleSecret;
  }

  const hsmSlotId = process.env.WALLET_HSM_SLOT;
  if (hsmSlotId) {
    base.hsmSlotId = hsmSlotId;
  }

  return base;
};
