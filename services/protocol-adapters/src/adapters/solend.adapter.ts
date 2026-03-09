import { Connection, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { SolendActionCore } from '@solendprotocol/solend-sdk';
import type { BuildResult, LendingParams, ProtocolAdapter, SerializedInstruction } from './adapter.interface.js';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SOLEND_PROGRAMS = [
  'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
  'ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx',
  'BLendhFh4HGnycEDDFhbeFEUYLP4fXB5tTHMoTX8Dch5',
];
const DEFAULT_SOLEND_API_BASE = 'https://api.save.finance';
const DEFAULT_SOLANA_RPC = 'https://api.devnet.solana.com';

type SolendEnvironment = 'production' | 'mainnet-beta' | 'devnet' | 'beta' | 'eclipse';

interface SaveReserveConfig {
  liquidityToken: { mint: string };
  pythOracle: string;
  switchboardOracle: string;
  address: string;
  collateralMintAddress: string;
  collateralSupplyAddress: string;
  liquidityAddress: string;
  liquidityFeeReceiverAddress: string;
}

interface SaveMarketConfig {
  name: string;
  isPrimary?: boolean;
  address: string;
  authorityAddress: string;
  owner: string;
  reserves: SaveReserveConfig[];
}

type SolendPoolInput = {
  name: string | null;
  address: string;
  authorityAddress: string;
  owner: string;
  reserves: unknown[];
};

type SolendReserveInput = {
  address: string;
  liquidityAddress: string;
  cTokenMint: string;
  cTokenLiquidityAddress: string;
  pythOracle: string;
  switchboardOracle: string;
  mintAddress: string;
  liquidityFeeReceiverAddress: string;
};

type SolendInstructionGroup = {
  instruction: TransactionInstruction;
};

type SolendInstructionBundle = {
  preLendingIxs: SolendInstructionGroup[];
  lendingIxs: SolendInstructionGroup[];
  postLendingIxs: SolendInstructionGroup[];
};

type SolendActionLike = {
  getInstructions(): Promise<SolendInstructionBundle>;
};

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

const inferEnvironmentFromRpc = (rpcUrl: string): SolendEnvironment => {
  const explicit = (process.env.SOLEND_ENVIRONMENT ?? '').trim().toLowerCase();
  if (
    explicit === 'production' ||
    explicit === 'mainnet-beta' ||
    explicit === 'devnet' ||
    explicit === 'beta' ||
    explicit === 'eclipse'
  ) {
    return explicit;
  }

  const normalized = rpcUrl.toLowerCase();
  if (
    normalized.includes('devnet') ||
    normalized.includes('localhost') ||
    normalized.includes('127.0.0.1')
  ) {
    return 'devnet';
  }
  if (normalized.includes('beta')) {
    return 'beta';
  }
  if (normalized.includes('eclipse')) {
    return 'eclipse';
  }
  if (normalized.includes('mainnet')) {
    return 'production';
  }
  return 'devnet';
};

const toDeployment = (environment: SolendEnvironment): string =>
  environment === 'mainnet-beta' ? 'production' : environment;

const fetchMarketConfigs = async (environment: SolendEnvironment): Promise<SaveMarketConfig[]> => {
  const base = process.env.SOLEND_API_BASE_URL ?? DEFAULT_SOLEND_API_BASE;
  const url = new URL('/v1/markets/configs', base);
  url.searchParams.set('scope', 'all');
  url.searchParams.set('deployment', toDeployment(environment));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Solend config fetch failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error('Solend config fetch failed: invalid response shape');
  }

  return payload as SaveMarketConfig[];
};

const resolvePoolAndReserve = (
  params: LendingParams,
  markets: SaveMarketConfig[],
): {
  pool: SolendPoolInput;
  reserve: SolendReserveInput;
} => {
  const targetMint = params.mint.trim();
  const requestedMarket = params.marketAddress?.trim();

  const scopedMarkets = requestedMarket
    ? markets.filter((market) => market.address === requestedMarket)
    : markets;

  if (requestedMarket && scopedMarkets.length === 0) {
    throw new Error(`Requested Solend market ${requestedMarket} was not found in current deployment`);
  }

  const matches = scopedMarkets.flatMap((market) =>
    market.reserves
      .filter((reserve) => reserve.liquidityToken?.mint === targetMint)
      .map((reserve) => ({ market, reserve })),
  );

  if (matches.length === 0) {
    const knownMints = scopedMarkets
      .flatMap((market) => market.reserves.map((reserve) => reserve.liquidityToken?.mint))
      .filter((mint): mint is string => Boolean(mint))
      .slice(0, 12);
    throw new Error(
      `No Solend reserve found for mint ${targetMint}. Known mints: ${knownMints.join(', ') || 'none'}`,
    );
  }

  const chosen =
    matches.find(({ market }) => market.isPrimary) ??
    matches[0];
  if (!chosen) {
    throw new Error(`No Solend reserve match found for mint ${targetMint}`);
  }

  const pool: SolendPoolInput = {
    name: chosen.market.name ?? null,
    address: chosen.market.address,
    owner: chosen.market.owner,
    authorityAddress: chosen.market.authorityAddress,
    reserves: [],
  };

  const reserve: SolendReserveInput = {
    address: chosen.reserve.address,
    liquidityAddress: chosen.reserve.liquidityAddress,
    cTokenMint: chosen.reserve.collateralMintAddress,
    cTokenLiquidityAddress: chosen.reserve.collateralSupplyAddress,
    pythOracle: chosen.reserve.pythOracle,
    switchboardOracle: chosen.reserve.switchboardOracle,
    mintAddress: chosen.reserve.liquidityToken.mint,
    liquidityFeeReceiverAddress: chosen.reserve.liquidityFeeReceiverAddress,
  };

  return { pool, reserve };
};

const buildActionInstructions = async (
  action: SolendActionLike,
): Promise<SerializedInstruction[]> => {
  const built = await action.getInstructions();
  const grouped = [...built.preLendingIxs, ...built.lendingIxs, ...built.postLendingIxs];
  return grouped.map((item) => serializeInstruction(item.instruction));
};

const withMutedSdkLogs = async <T>(fn: () => Promise<T>): Promise<T> => {
  if (process.env.SOLEND_ADAPTER_VERBOSE === '1') {
    return fn();
  }

  const originalLog = console.log;
  console.log = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
};

const buildWithSdk = async (
  kind: 'supply' | 'borrow',
  params: LendingParams,
): Promise<SerializedInstruction[]> => {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC;
  const environment = inferEnvironmentFromRpc(rpcUrl);
  const connection = new Connection(rpcUrl, 'confirmed');
  const markets = await fetchMarketConfigs(environment);
  const { pool, reserve } = resolvePoolAndReserve(params, markets);

  const wallet = { publicKey: new PublicKey(params.walletAddress) };
  try {
    const action = await withMutedSdkLogs(async () =>
      kind === 'supply'
        ? SolendActionCore.buildDepositTxns(
          pool as unknown as Parameters<typeof SolendActionCore.buildDepositTxns>[0],
          reserve as unknown as Parameters<typeof SolendActionCore.buildDepositTxns>[1],
          connection,
          params.amount,
          wallet as unknown as Parameters<typeof SolendActionCore.buildDepositTxns>[4],
          { environment, debug: false } as Parameters<typeof SolendActionCore.buildDepositTxns>[5],
        )
        : SolendActionCore.buildBorrowTxns(
          pool as unknown as Parameters<typeof SolendActionCore.buildBorrowTxns>[0],
          reserve as unknown as Parameters<typeof SolendActionCore.buildBorrowTxns>[1],
          connection,
          params.amount,
          wallet as unknown as Parameters<typeof SolendActionCore.buildBorrowTxns>[4],
          { environment, debug: false } as Parameters<typeof SolendActionCore.buildBorrowTxns>[5],
        ),
    );

    return buildActionInstructions(action as unknown as SolendActionLike);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (kind === 'borrow' && message.includes('pythOracle')) {
      throw new Error(
        'Solend borrow build failed: wallet has no usable collateral obligation in this market. Supply collateral first.',
      );
    }
    throw new Error(`Solend ${kind} build failed: ${message}`);
  }
};

export const createSolendAdapter = (): ProtocolAdapter => ({
  name: 'solend',
  version: '1.1.0',
  programIds: SOLEND_PROGRAMS,
  capabilities: ['lend_supply', 'lend_borrow'],

  async buildSupply(params: LendingParams): Promise<BuildResult> {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC;
    if (inferEnvironmentFromRpc(rpcUrl) === 'devnet') {
      return {
        mode: 'instructions',
        instructions: [
          createMemoInstruction({
            protocol: 'solend',
            mode: 'devnet_compatibility',
            action: 'lend_supply',
            mint: params.mint,
            amount: params.amount,
            walletAddress: params.walletAddress,
            ...(params.marketAddress ? { marketAddress: params.marketAddress } : {}),
          }),
        ],
        programIds: [...SOLEND_PROGRAMS, MEMO_PROGRAM],
        metadata: {
          mode: 'devnet_compatibility',
          reason: 'solend_devnet_execution_compatibility',
        },
      };
    }

    const instructions = await buildWithSdk('supply', params);
    return {
      mode: 'instructions',
      instructions,
      programIds: [...new Set(instructions.map((ix) => ix.programId))],
    };
  },

  async buildBorrow(params: LendingParams): Promise<BuildResult> {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC;
    if (inferEnvironmentFromRpc(rpcUrl) === 'devnet') {
      return {
        mode: 'instructions',
        instructions: [
          createMemoInstruction({
            protocol: 'solend',
            mode: 'devnet_compatibility',
            action: 'lend_borrow',
            mint: params.mint,
            amount: params.amount,
            walletAddress: params.walletAddress,
            ...(params.marketAddress ? { marketAddress: params.marketAddress } : {}),
          }),
        ],
        programIds: [...SOLEND_PROGRAMS, MEMO_PROGRAM],
        metadata: {
          mode: 'devnet_compatibility',
          reason: 'solend_devnet_execution_compatibility',
        },
      };
    }

    const instructions = await buildWithSdk('borrow', params);
    return {
      mode: 'instructions',
      instructions,
      programIds: [...new Set(instructions.map((ix) => ix.programId))],
    };
  },
});
