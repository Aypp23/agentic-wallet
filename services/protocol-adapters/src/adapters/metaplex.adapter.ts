import {
  PROGRAM_ID,
  createCreateMetadataAccountV3Instruction,
  type DataV2,
} from '@metaplex-foundation/mpl-token-metadata';
import { Connection, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import type { BuildResult, ProtocolAdapter, SerializedInstruction } from './adapter.interface.js';

const DEFAULT_SOLANA_RPC = 'https://api.devnet.solana.com';
const METAPLEX_PROGRAM_PUBKEY = PROGRAM_ID;
const METAPLEX_PROGRAM = METAPLEX_PROGRAM_PUBKEY.toBase58();

const serializeInstruction = (instruction: TransactionInstruction): SerializedInstruction => ({
  programId: instruction.programId.toBase58(),
  keys: instruction.keys.map((key) => ({
    pubkey: key.pubkey.toBase58(),
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  })),
  data: instruction.data.toString('base64'),
});

const pickString = (intent: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = intent[key];
  return typeof value === 'string' ? value : fallback;
};

const deriveMetadataAddress = (mint: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METAPLEX_PROGRAM_PUBKEY.toBuffer(), mint.toBuffer()],
    METAPLEX_PROGRAM_PUBKEY,
  )[0];

const buildMetadataInstruction = (
  walletAddress: string,
  intent: Record<string, unknown>,
): SerializedInstruction => {
  const owner = new PublicKey(walletAddress);
  const mintAddressRaw = pickString(intent, 'mintAddress');

  if (!mintAddressRaw) {
    throw new Error('mintAddress is required for metaplex create metadata flow');
  }

  const mint = new PublicKey(mintAddressRaw);
  const metadataAddressRaw = pickString(intent, 'metadataAddress');
  const metadata = metadataAddressRaw ? new PublicKey(metadataAddressRaw) : deriveMetadataAddress(mint);

  const creatorsRaw = Array.isArray(intent['creators']) ? intent['creators'] : [];
  const creators = creatorsRaw
    .map((creator) => {
      if (!creator || typeof creator !== 'object') return null;
      const entry = creator as Record<string, unknown>;
      const address = typeof entry['address'] === 'string' ? entry['address'] : '';
      if (!address) return null;

      const verified = entry['verified'] === true;
      const share = Number(entry['share'] ?? 0);
      if (!Number.isFinite(share) || share < 0 || share > 100) return null;

      return {
        address: new PublicKey(address),
        verified,
        share: Math.floor(share),
      };
    })
    .filter((value): value is { address: PublicKey; verified: boolean; share: number } => value !== null);

  const sellerFeeBasisPoints = Number(intent['sellerFeeBasisPoints'] ?? 0);
  if (!Number.isFinite(sellerFeeBasisPoints) || sellerFeeBasisPoints < 0 || sellerFeeBasisPoints > 10000) {
    throw new Error('sellerFeeBasisPoints must be a number between 0 and 10000');
  }

  const metadataData: DataV2 = {
    name: pickString(intent, 'name', 'Agentic Wallet Asset'),
    symbol: pickString(intent, 'symbol', 'AWA'),
    uri: pickString(intent, 'uri', 'https://example.com/metadata.json'),
    sellerFeeBasisPoints: Math.floor(sellerFeeBasisPoints),
    creators: creators.length > 0 ? creators : null,
    collection: null,
    uses: null,
  };

  const instruction = createCreateMetadataAccountV3Instruction(
    {
      metadata,
      mint,
      mintAuthority: owner,
      payer: owner,
      updateAuthority: owner,
    },
    {
      createMetadataAccountArgsV3: {
        data: metadataData,
        isMutable: true,
        collectionDetails: null,
      },
    },
    METAPLEX_PROGRAM_PUBKEY,
  );

  return serializeInstruction(instruction);
};

const runHealthProbe = async (): Promise<{ ok: boolean; details?: Record<string, unknown> }> => {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');
  try {
    const slot = await connection.getSlot('confirmed');
    return {
      ok: true,
      details: { slot, rpcUrl },
    };
  } catch (error) {
    return {
      ok: false,
      details: {
        rpcUrl,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

export const createMetaplexAdapter = (): ProtocolAdapter => ({
  name: 'metaplex',
  version: '2.1.0',
  programIds: [METAPLEX_PROGRAM],
  capabilities: ['create_metadata', 'create_mint', 'mint_token'],

  async buildIntent(intentType: string, walletAddress: string, intent: Record<string, unknown>): Promise<BuildResult> {
    if (intentType !== 'create_mint' && intentType !== 'mint_token' && intentType !== 'create_metadata') {
      throw new Error(`Unsupported metaplex intent type: ${intentType}`);
    }

    const instruction = buildMetadataInstruction(walletAddress, intent);
    return {
      mode: 'instructions',
      instructions: [instruction],
      programIds: [METAPLEX_PROGRAM],
      metadata: { intentType },
    };
  },

  async healthCheck() {
    return runHealthProbe();
  },
});
