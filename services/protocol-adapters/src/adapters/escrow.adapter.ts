import { createHash } from 'node:crypto';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import type {
  AdapterHealth,
  BuildResult,
  ProtocolAdapter,
  SerializedInstruction,
} from './adapter.interface.js';

const ESCROW_INTENTS = new Set([
  'create_escrow',
  'accept_escrow',
  'release_escrow',
  'refund_escrow',
  'dispute_escrow',
  'resolve_dispute',
  'create_milestone_escrow',
  'release_milestone',
  'x402_pay',
]);

const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const DEFAULT_DEADLINE_SECONDS = 24 * 60 * 60;

interface EscrowStateHint {
  creator: PublicKey;
  recipient: PublicKey;
  arbiter: PublicKey;
  feeRecipient: PublicKey;
}

const resolveEscrowProgramId = (): string => process.env.ESCROW_PROGRAM_ID?.trim() ?? '';

const key = (
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean,
): { pubkey: string; isSigner: boolean; isWritable: boolean } => ({
  pubkey: pubkey.toBase58(),
  isSigner,
  isWritable,
});

const discriminator = (method: string): Buffer =>
  createHash('sha256').update(`global:${method}`).digest().subarray(0, 8);

const toU64 = (value: unknown, field: string): bigint => {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    parsed = BigInt(value.trim());
  } else {
    throw new Error(`${field} must be an unsigned integer`);
  }

  if (parsed < 0n || parsed > U64_MAX) {
    throw new Error(`${field} out of u64 range`);
  }
  return parsed;
};

const toI64 = (value: unknown, field: string): bigint => {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    parsed = BigInt(value.trim());
  } else {
    throw new Error(`${field} must be a signed integer`);
  }

  if (parsed < I64_MIN || parsed > I64_MAX) {
    throw new Error(`${field} out of i64 range`);
  }
  return parsed;
};

const parsePubkey = (value: unknown, field: string): PublicKey => {
  if (typeof value !== 'string' || value.trim().length < 32) {
    throw new Error(`${field} must be a base58 public key`);
  }
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new Error(`${field} is not a valid base58 public key`);
  }
};

const parseOptionalPubkey = (value: unknown): PublicKey | null => {
  if (typeof value !== 'string' || value.trim().length < 32) return null;
  try {
    return new PublicKey(value.trim());
  } catch {
    return null;
  }
};

const parseDisputeReason = (intent: Record<string, unknown>): Buffer => {
  const out = Buffer.alloc(64, 0);
  const raw = typeof intent['reason'] === 'string'
    ? intent['reason']
    : typeof intent['disputeReason'] === 'string'
      ? intent['disputeReason']
      : '';
  const bytes = Buffer.from(raw, 'utf8');
  bytes.copy(out, 0, 0, Math.min(bytes.length, 64));
  return out;
};

const parseTermsHash = (intent: Record<string, unknown>): Buffer => {
  const fromArray = intent['termsHash'];
  if (Array.isArray(fromArray) && fromArray.length === 32) {
    const bytes = fromArray.map((item) => Number(item));
    if (bytes.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return Buffer.from(bytes);
    }
  }

  if (typeof fromArray === 'string') {
    const normalized = fromArray.trim().replace(/^0x/i, '');
    if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
      return Buffer.from(normalized, 'hex');
    }
  }

  const terms = typeof intent['terms'] === 'string'
    ? intent['terms']
    : typeof intent['memo'] === 'string'
      ? intent['memo']
      : JSON.stringify(intent);

  return createHash('sha256').update(terms).digest();
};

const parseWinner = (intent: Record<string, unknown>): 0 | 1 => {
  const winner = intent['winner'];
  if (winner === 0 || winner === 'creator') return 0;
  if (winner === 1 || winner === 'recipient') return 1;
  throw new Error('resolve_dispute requires winner to be creator|recipient (or 0|1)');
};

const resolveEscrowId = (intent: Record<string, unknown>, fallbackSeed: string): bigint => {
  const explicit =
    intent['escrowNumericId'] ??
    intent['escrow_id'] ??
    intent['escrowId'];

  if (explicit !== undefined && explicit !== null) {
    if (typeof explicit === 'string' && !/^\d+$/.test(explicit.trim())) {
      return createHash('sha256').update(explicit.trim()).digest().readBigUInt64LE(0);
    }
    return toU64(explicit, 'escrowId');
  }

  return createHash('sha256').update(fallbackSeed).digest().readBigUInt64LE(0);
};

const deriveEscrowPda = (programId: PublicKey, creator: PublicKey, escrowId: bigint): PublicKey => {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(escrowId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), creator.toBuffer(), id],
    programId,
  )[0];
};

let sharedConnection: Connection | null = null;

const getConnection = (): Connection => {
  if (!sharedConnection) {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
    sharedConnection = new Connection(rpcUrl, 'confirmed');
  }
  return sharedConnection;
};

const decodeEscrowStateHint = (data: Buffer): EscrowStateHint => {
  if (data.length < 136) {
    throw new Error('Escrow account data too small to decode state hint');
  }
  return {
    creator: new PublicKey(data.subarray(8, 40)),
    recipient: new PublicKey(data.subarray(40, 72)),
    arbiter: new PublicKey(data.subarray(72, 104)),
    feeRecipient: new PublicKey(data.subarray(104, 136)),
  };
};

const loadEscrowStateHint = async (
  escrowAccount: PublicKey,
  programId: PublicKey,
): Promise<EscrowStateHint | null> => {
  try {
    const info = await getConnection().getAccountInfo(escrowAccount, 'confirmed');
    if (!info || !info.owner.equals(programId)) {
      return null;
    }
    return decodeEscrowStateHint(info.data);
  } catch {
    return null;
  }
};

const encodeCreateLike = (
  method: 'create_escrow' | 'create_milestone_escrow' | 'x402_pay',
  args: {
    escrowId: bigint;
    amount: bigint;
    deadline: bigint;
    termsHash: Buffer;
    feeBasisPoints: number;
    autoReleaseAt: bigint;
  },
): Buffer => {
  const data = Buffer.alloc(8 + 8 + 8 + 8 + 32 + 2 + 8);
  discriminator(method).copy(data, 0);
  data.writeBigUInt64LE(args.escrowId, 8);
  data.writeBigUInt64LE(args.amount, 16);
  data.writeBigInt64LE(args.deadline, 24);
  args.termsHash.copy(data, 32);
  data.writeUInt16LE(args.feeBasisPoints, 64);
  data.writeBigInt64LE(args.autoReleaseAt, 66);
  return data;
};

const encodeNoArgs = (method: 'accept_task' | 'release_payment' | 'request_refund'): Buffer => {
  const data = Buffer.alloc(8);
  discriminator(method).copy(data, 0);
  return data;
};

const encodeDispute = (reason: Buffer): Buffer => {
  const data = Buffer.alloc(8 + 64);
  discriminator('dispute').copy(data, 0);
  reason.copy(data, 8, 0, 64);
  return data;
};

const encodeResolve = (winner: 0 | 1): Buffer => {
  const data = Buffer.alloc(9);
  discriminator('resolve_dispute').copy(data, 0);
  data.writeUInt8(winner, 8);
  return data;
};

const encodeReleaseMilestone = (milestoneIndex: number): Buffer => {
  const data = Buffer.alloc(9);
  discriminator('release_milestone').copy(data, 0);
  data.writeUInt8(milestoneIndex, 8);
  return data;
};

const serializeIx = (
  programId: PublicKey,
  keys: SerializedInstruction['keys'],
  data: Buffer,
): SerializedInstruction => ({
  programId: programId.toBase58(),
  keys,
  data: data.toString('base64'),
});

const resolveEscrowProgram = (): PublicKey => {
  const configured = resolveEscrowProgramId();
  if (!configured) {
    throw new Error('Escrow program is not configured. Set ESCROW_PROGRAM_ID to a deployed program id.');
  }

  try {
    return new PublicKey(configured);
  } catch {
    throw new Error('ESCROW_PROGRAM_ID is invalid');
  }
};

const resolveEscrowAccount = (
  intent: Record<string, unknown>,
  walletAddress: string,
  programId: PublicKey,
): { escrowAccount: PublicKey; escrowId: bigint; creatorHint: PublicKey } => {
  const directEscrow = parseOptionalPubkey(intent['escrowAccount']);
  const creatorHint = parseOptionalPubkey(intent['creator']) ?? new PublicKey(walletAddress);
  const escrowId = resolveEscrowId(intent, `${walletAddress}:${Date.now()}`);

  if (directEscrow) {
    return {
      escrowAccount: directEscrow,
      escrowId,
      creatorHint,
    };
  }

  return {
    escrowAccount: deriveEscrowPda(programId, creatorHint, escrowId),
    escrowId,
    creatorHint,
  };
};

const validateIntentType = (intentType: string): void => {
  if (!ESCROW_INTENTS.has(intentType)) {
    throw new Error(`Unsupported escrow intent type: ${intentType}`);
  }
};

export const createEscrowAdapter = (): ProtocolAdapter => ({
  name: 'escrow',
  version: '3.0.0',
  programIds: resolveEscrowProgramId() ? [resolveEscrowProgramId()] : [],
  capabilities: [...ESCROW_INTENTS],

  async buildIntent(intentType: string, walletAddress: string, intent: Record<string, unknown>): Promise<BuildResult> {
    validateIntentType(intentType);

    const programId = resolveEscrowProgram();
    const signer = new PublicKey(walletAddress);

    if (intentType === 'create_escrow' || intentType === 'create_milestone_escrow' || intentType === 'x402_pay') {
      const recipient = parsePubkey(intent['counterparty'] ?? intent['recipient'], 'counterparty');
      const arbiter = parseOptionalPubkey(intent['arbiter']) ?? signer;
      const feeRecipient = parseOptionalPubkey(intent['feeRecipient']) ?? signer;

      const escrowId = resolveEscrowId(intent, `${walletAddress}:${intentType}:${Date.now()}`);
      const amount = toU64(
        intent['amount'] ?? intent['lamports'] ?? intent['amountLamports'],
        'amount',
      );
      const deadline = toI64(
        intent['deadlineUnixSec'] ?? intent['deadline'] ?? Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS,
        'deadline',
      );
      const feeBasisPoints = Number(intent['feeBasisPoints'] ?? 100);
      if (!Number.isInteger(feeBasisPoints) || feeBasisPoints < 0 || feeBasisPoints > 1000) {
        throw new Error('feeBasisPoints must be an integer between 0 and 1000');
      }
      const autoReleaseAt = toI64(intent['autoReleaseAt'] ?? 0, 'autoReleaseAt');
      const termsHash = parseTermsHash(intent);

      const escrowAccount = deriveEscrowPda(programId, signer, escrowId);

      const method = intentType as 'create_escrow' | 'create_milestone_escrow' | 'x402_pay';
      const ix = serializeIx(
        programId,
        [
          key(escrowAccount, false, true),
          key(signer, true, true),
          key(recipient, false, false),
          key(arbiter, false, false),
          key(feeRecipient, false, false),
          key(SystemProgram.programId, false, false),
        ],
        encodeCreateLike(method, {
          escrowId,
          amount,
          deadline,
          termsHash,
          feeBasisPoints,
          autoReleaseAt,
        }),
      );

      return {
        mode: 'instructions',
        instructions: [ix],
        programIds: [programId.toBase58()],
        metadata: {
          escrowAccount: escrowAccount.toBase58(),
          escrowId: escrowId.toString(),
          method,
        },
      };
    }

    const escrowRef = resolveEscrowAccount(intent, walletAddress, programId);

    if (intentType === 'accept_escrow') {
      return {
        mode: 'instructions',
        instructions: [
          serializeIx(programId, [
            key(escrowRef.escrowAccount, false, true),
            key(signer, true, false),
          ], encodeNoArgs('accept_task')),
        ],
        programIds: [programId.toBase58()],
        metadata: {
          escrowAccount: escrowRef.escrowAccount.toBase58(),
          escrowId: escrowRef.escrowId.toString(),
          method: 'accept_task',
        },
      };
    }

    if (intentType === 'release_escrow' || intentType === 'release_milestone') {
      const providedRecipient =
        parseOptionalPubkey(intent['counterparty']) ??
        parseOptionalPubkey(intent['recipient']);
      const providedFeeRecipient = parseOptionalPubkey(intent['feeRecipient']);
      const stateHint =
        providedRecipient && providedFeeRecipient
          ? null
          : await loadEscrowStateHint(escrowRef.escrowAccount, programId);
      const recipient = providedRecipient ?? stateHint?.recipient;
      if (!recipient) {
        throw new Error('release requires recipient (or a fetchable escrow account state)');
      }

      const feeRecipient = providedFeeRecipient ?? stateHint?.feeRecipient ?? signer;

      const data = intentType === 'release_milestone'
        ? encodeReleaseMilestone(Number(intent['milestoneIndex'] ?? 0))
        : encodeNoArgs('release_payment');

      return {
        mode: 'instructions',
        instructions: [
          serializeIx(
            programId,
            [
              key(escrowRef.escrowAccount, false, true),
              key(signer, true, true),
              key(recipient, false, true),
              key(feeRecipient, false, true),
            ],
            data,
          ),
        ],
        programIds: [programId.toBase58()],
        metadata: {
          escrowAccount: escrowRef.escrowAccount.toBase58(),
          escrowId: escrowRef.escrowId.toString(),
          method: intentType === 'release_milestone' ? 'release_milestone' : 'release_payment',
        },
      };
    }

    if (intentType === 'refund_escrow') {
      return {
        mode: 'instructions',
        instructions: [
          serializeIx(programId, [
            key(escrowRef.escrowAccount, false, true),
            key(signer, true, true),
          ], encodeNoArgs('request_refund')),
        ],
        programIds: [programId.toBase58()],
        metadata: {
          escrowAccount: escrowRef.escrowAccount.toBase58(),
          escrowId: escrowRef.escrowId.toString(),
          method: 'request_refund',
        },
      };
    }

    if (intentType === 'dispute_escrow') {
      const reason = parseDisputeReason(intent);
      return {
        mode: 'instructions',
        instructions: [
          serializeIx(programId, [
            key(escrowRef.escrowAccount, false, true),
            key(signer, true, false),
          ], encodeDispute(reason)),
        ],
        programIds: [programId.toBase58()],
        metadata: {
          escrowAccount: escrowRef.escrowAccount.toBase58(),
          escrowId: escrowRef.escrowId.toString(),
          method: 'dispute',
        },
      };
    }

    if (intentType === 'resolve_dispute') {
      const providedCreator = parseOptionalPubkey(intent['creator']);
      const providedRecipient =
        parseOptionalPubkey(intent['counterparty']) ??
        parseOptionalPubkey(intent['recipient']);
      const providedFeeRecipient = parseOptionalPubkey(intent['feeRecipient']);

      const stateHint =
        providedCreator && providedRecipient && providedFeeRecipient
          ? null
          : await loadEscrowStateHint(escrowRef.escrowAccount, programId);

      const creator = providedCreator ?? stateHint?.creator;
      const recipient = providedRecipient ?? stateHint?.recipient;
      const feeRecipient = providedFeeRecipient ?? stateHint?.feeRecipient;

      if (!creator || !recipient || !feeRecipient) {
        throw new Error('resolve_dispute requires creator/recipient/feeRecipient (or fetchable escrow account state)');
      }

      return {
        mode: 'instructions',
        instructions: [
          serializeIx(programId, [
            key(escrowRef.escrowAccount, false, true),
            key(signer, true, false),
            key(creator, false, true),
            key(recipient, false, true),
            key(feeRecipient, false, true),
          ], encodeResolve(parseWinner(intent))),
        ],
        programIds: [programId.toBase58()],
        metadata: {
          escrowAccount: escrowRef.escrowAccount.toBase58(),
          escrowId: escrowRef.escrowId.toString(),
          method: 'resolve_dispute',
        },
      };
    }

    throw new Error(`Unsupported escrow intent type: ${intentType}`);
  },

  async healthCheck(): Promise<AdapterHealth> {
    const escrowProgramId = resolveEscrowProgramId();
    if (!escrowProgramId) {
      return {
        ok: false,
        details: {
          configured: false,
          reason: 'ESCROW_PROGRAM_ID is not set',
        },
      };
    }

    try {
      const program = new PublicKey(escrowProgramId);
      const info = await getConnection().getAccountInfo(program, 'confirmed');
      return {
        ok: info !== null,
        details: {
          configured: true,
          programId: escrowProgramId,
          deployed: info !== null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        details: {
          configured: false,
          reason: error instanceof Error ? error.message : String(error),
        },
      };
    }
  },
});
