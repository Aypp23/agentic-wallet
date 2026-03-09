import { Connection, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { BN, Marinade, MarinadeConfig } from '@marinade.finance/marinade-ts-sdk';
import type { BuildResult, ProtocolAdapter, SerializedInstruction, StakeParams } from './adapter.interface.js';

const MARINADE_PROGRAM = 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const DEFAULT_SOLANA_RPC = 'https://api.devnet.solana.com';
const isDevnetRpc = (): boolean =>
  (process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC).toLowerCase().includes('devnet');

const serializeInstruction = (instruction: TransactionInstruction): SerializedInstruction => ({
  programId: instruction.programId.toBase58(),
  keys: instruction.keys.map((key) => ({
    pubkey: key.pubkey.toBase58(),
    isSigner: key.isSigner,
    isWritable: key.isWritable,
  })),
  data: Buffer.from(instruction.data).toString('base64'),
});

const createMemoInstruction = (payload: Record<string, unknown>): SerializedInstruction => ({
  programId: MEMO_PROGRAM,
  keys: [],
  data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
});

const buildWithSdk = async (kind: 'stake' | 'unstake', params: StakeParams): Promise<SerializedInstruction[]> => {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC;
  const connection = new Connection(rpcUrl, 'confirmed');
  const owner = new PublicKey(params.walletAddress);
  const marinade = new Marinade(
    new MarinadeConfig({
      connection,
      publicKey: owner,
    }),
  );
  const amountLamports = new BN(params.amount);

  const built = kind === 'stake'
    ? await marinade.deposit(amountLamports)
    : await marinade.liquidUnstake(amountLamports);

  const instructions = built.transaction.instructions.map((ix) => serializeInstruction(ix));
  if (instructions.length === 0) {
    throw new Error(`Marinade ${kind} build returned no instructions`);
  }
  return instructions;
};

export const createMarinadeAdapter = (): ProtocolAdapter => ({
  name: 'marinade',
  version: '2.0.0',
  programIds: [MARINADE_PROGRAM],
  capabilities: ['stake', 'unstake'],

  async buildStake(params: StakeParams): Promise<BuildResult> {
    if (isDevnetRpc()) {
      return {
        mode: 'instructions',
        instructions: [
          createMemoInstruction({
            protocol: 'marinade',
            mode: 'devnet_compatibility',
            action: 'stake',
            amount: params.amount,
            walletAddress: params.walletAddress,
          }),
        ],
        programIds: [MARINADE_PROGRAM, MEMO_PROGRAM],
        metadata: {
          mode: 'devnet_compatibility',
          reason: 'marinade_devnet_execution_compatibility',
        },
      };
    }

    const instructions = await buildWithSdk('stake', params);
    return {
      mode: 'instructions',
      instructions,
      programIds: [...new Set(instructions.map((ix) => ix.programId))],
      metadata: { source: 'marinade-ts-sdk' },
    };
  },

  async buildUnstake(params: StakeParams): Promise<BuildResult> {
    if (isDevnetRpc()) {
      return {
        mode: 'instructions',
        instructions: [
          createMemoInstruction({
            protocol: 'marinade',
            mode: 'devnet_compatibility',
            action: 'unstake',
            amount: params.amount,
            walletAddress: params.walletAddress,
          }),
        ],
        programIds: [MARINADE_PROGRAM, MEMO_PROGRAM],
        metadata: {
          mode: 'devnet_compatibility',
          reason: 'marinade_devnet_execution_compatibility',
        },
      };
    }

    const instructions = await buildWithSdk('unstake', params);
    return {
      mode: 'instructions',
      instructions,
      programIds: [...new Set(instructions.map((ix) => ix.programId))],
      metadata: { source: 'marinade-ts-sdk' },
    };
  },
});
