export interface SerializedInstruction {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export interface SwapQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  walletAddress: string;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: number;
  fee: string;
  route: unknown;
}

export interface SwapExecuteParams {
  walletAddress: string;
  quote: SwapQuote;
}

export interface StakeParams {
  walletAddress: string;
  amount: string;
  validator?: string;
}

export interface LendingParams {
  walletAddress: string;
  mint: string;
  amount: string;
  marketAddress?: string;
}

export interface SwapTransactionResult {
  transaction: string;
  inputAmount: string;
  outputAmount: string;
  priceImpactPct: number;
}

export interface BuildResult {
  mode: 'transaction' | 'instructions';
  transaction?: string;
  instructions?: SerializedInstruction[];
  programIds: string[];
  metadata?: Record<string, unknown>;
}

export interface AdapterHealth {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface ProtocolAdapter {
  readonly name: string;
  readonly version: string;
  readonly programIds: string[];
  readonly capabilities: string[];

  getSwapQuote?(params: SwapQuoteParams): Promise<SwapQuote>;
  buildSwap?(params: SwapExecuteParams): Promise<BuildResult>;
  buildStake?(params: StakeParams): Promise<BuildResult>;
  buildUnstake?(params: StakeParams): Promise<BuildResult>;
  buildSupply?(params: LendingParams): Promise<BuildResult>;
  buildBorrow?(params: LendingParams): Promise<BuildResult>;
  buildIntent?(intentType: string, walletAddress: string, intent: Record<string, unknown>): Promise<BuildResult>;
  migrateIntent?(
    input: { fromVersion: string; toVersion: string; type: string; intent: Record<string, unknown> },
  ): Promise<Record<string, unknown>>;
  healthCheck?(): Promise<AdapterHealth>;
}
