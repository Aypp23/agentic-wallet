import type { KeyProvider } from './key-provider.js';
import { EncryptedFileKeyProvider } from './encrypted-file-key-provider.js';
import { MemoryKeyProvider } from './memory-key-provider.js';
import { KmsKeyProvider } from './kms-key-provider.js';
import { HsmKeyProvider } from './hsm-key-provider.js';
import { MpcKeyProvider } from './mpc-key-provider.js';

export type SignerBackend = 'encrypted-file' | 'memory' | 'kms' | 'hsm' | 'mpc';

interface FactoryInput {
  backend: SignerBackend;
  keysDir: string;
  encryptionSecret: string;
  kmsMasterSecret?: string;
  kmsKeyId?: string;
  hsmPin?: string;
  hsmModuleSecret?: string;
  hsmSlotId?: string;
  mpcNodeSecrets?: string[];
}

export const createKeyProvider = (input: FactoryInput): KeyProvider => {
  switch (input.backend) {
    case 'memory':
      return new MemoryKeyProvider();
    case 'kms': {
      if (!input.kmsMasterSecret) {
        throw new Error('WALLET_KMS_MASTER_SECRET is required when WALLET_SIGNER_BACKEND=kms');
      }
      return new KmsKeyProvider(input.keysDir, input.kmsMasterSecret, input.kmsKeyId ?? 'wallet-engine-kms-key');
    }
    case 'hsm': {
      if (!input.hsmPin || !input.hsmModuleSecret) {
        throw new Error('WALLET_HSM_PIN and WALLET_HSM_MODULE_SECRET are required when WALLET_SIGNER_BACKEND=hsm');
      }
      return new HsmKeyProvider(
        input.keysDir,
        input.hsmSlotId ?? 'slot-0',
        input.hsmPin,
        input.hsmModuleSecret,
      );
    }
    case 'mpc': {
      const secrets = (input.mpcNodeSecrets ?? []).filter((value) => value.trim().length > 0);
      if (secrets.length < 3) {
        throw new Error(
          'At least 3 MPC node secrets are required when WALLET_SIGNER_BACKEND=mpc. Set WALLET_MPC_NODE_SECRETS or WALLET_MPC_NODE{1,2,3}_SECRET.',
        );
      }
      const tuple: [string, string, string] = [secrets[0]!, secrets[1]!, secrets[2]!];
      return new MpcKeyProvider(input.keysDir, tuple);
    }
    case 'encrypted-file':
    default:
      return new EncryptedFileKeyProvider(input.keysDir, input.encryptionSecret);
  }
};
