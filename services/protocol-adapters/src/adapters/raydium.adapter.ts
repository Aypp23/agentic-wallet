import type {
  AdapterHealth,
  BuildResult,
  SerializedInstruction,
  ProtocolAdapter,
  SwapExecuteParams,
  SwapQuote,
  SwapQuoteParams,
} from './adapter.interface.js';

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
}

interface JupiterSwapResponse {
  swapTransaction: string;
}

const JUPITER_API = process.env.JUPITER_API_URL ?? 'https://lite-api.jup.ag/swap/v1';
const RAYDIUM_DEXES = process.env.RAYDIUM_JUP_DEXES ?? 'Raydium CLMM';
const RAYDIUM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const HEALTH_TIMEOUT_MS = 4_000;
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const isDevnetRpc = (): boolean =>
  (process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com').toLowerCase().includes('devnet');

const createMemoInstruction = (payload: Record<string, unknown>): SerializedInstruction => ({
  programId: MEMO_PROGRAM,
  keys: [],
  data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
});

const withDexFilter = (url: URL): URL => {
  url.searchParams.set('dexes', RAYDIUM_DEXES);
  return url;
};

const runHealthProbe = async (): Promise<AdapterHealth> => {
  const url = withDexFilter(new URL(`${JUPITER_API}/quote`));
  url.searchParams.set('inputMint', 'So11111111111111111111111111111111111111112');
  url.searchParams.set('outputMint', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  url.searchParams.set('amount', '1000');
  url.searchParams.set('slippageBps', '50');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    return {
      ok: res.status < 500,
      details: {
        status: res.status,
        latencyMs: Date.now() - started,
        source: 'jupiter-lite',
      },
    };
  } catch (error) {
    return {
      ok: false,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const createRaydiumAdapter = (): ProtocolAdapter => ({
  name: 'raydium',
  version: '1.1.0',
  programIds: [RAYDIUM_PROGRAM],
  capabilities: ['swap', 'quote', 'pool'],

  async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    if (isDevnetRpc()) {
      return {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inputAmount: params.amount,
        outputAmount: params.amount,
        priceImpactPct: 0,
        fee: '0',
        route: {
          mode: 'devnet_compatibility',
          reason: 'raydium_devnet_route_not_available',
        },
      };
    }

    try {
      const url = withDexFilter(new URL(`${JUPITER_API}/quote`));
      url.searchParams.set('inputMint', params.inputMint);
      url.searchParams.set('outputMint', params.outputMint);
      url.searchParams.set('amount', params.amount);
      url.searchParams.set('slippageBps', String(params.slippageBps ?? 50));

      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`Raydium quote failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as JupiterQuoteResponse;
      const fee = data.routePlan.reduce((sum: number, step) => {
        const cast = step as { swapInfo?: { feeAmount?: string } };
        return sum + Number(cast.swapInfo?.feeAmount ?? 0);
      }, 0);

      return {
        inputMint: data.inputMint,
        outputMint: data.outputMint,
        inputAmount: data.inAmount,
        outputAmount: data.outAmount,
        priceImpactPct: Number(data.priceImpactPct),
        fee: String(fee),
        route: data,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Raydium quote unavailable: ${message}`);
    }
  },

  async buildSwap(params: SwapExecuteParams): Promise<BuildResult> {
    if (isDevnetRpc()) {
      return {
        mode: 'instructions',
        instructions: [
          createMemoInstruction({
            protocol: 'raydium',
            mode: 'devnet_compatibility',
            inputMint: params.quote.inputMint,
            outputMint: params.quote.outputMint,
            inputAmount: params.quote.inputAmount,
            outputAmount: params.quote.outputAmount,
          }),
        ],
        programIds: [RAYDIUM_PROGRAM, MEMO_PROGRAM],
        metadata: {
          mode: 'devnet_compatibility',
          reason: 'raydium_devnet_route_not_available',
        },
      };
    }

    const res = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: params.quote.route,
        userPublicKey: params.walletAddress,
        wrapAndUnwrapSol: true,
        asLegacyTransaction: true,
        useSharedAccounts: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Raydium build failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as JupiterSwapResponse;
    return {
      mode: 'transaction',
      transaction: data.swapTransaction,
      programIds: [RAYDIUM_PROGRAM],
      metadata: {
        router: 'jupiter-lite',
        dexes: RAYDIUM_DEXES,
      },
    };
  },

  async healthCheck(): Promise<AdapterHealth> {
    return runHealthProbe();
  },
});
