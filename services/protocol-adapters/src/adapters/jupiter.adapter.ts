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

const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const HEALTH_TIMEOUT_MS = 4_000;
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const isDevnetRpc = (): boolean =>
  (process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com').toLowerCase().includes('devnet');

const createMemoInstruction = (payload: Record<string, unknown>): SerializedInstruction => ({
  programId: MEMO_PROGRAM,
  keys: [],
  data: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
});

const runHealthProbe = async (apiUrl: string): Promise<AdapterHealth> => {
  const url = new URL(`${apiUrl}/quote`);
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

export const createJupiterAdapter = (apiUrl: string): ProtocolAdapter => ({
  name: 'jupiter',
  version: '1.0.0',
  programIds: [JUPITER_PROGRAM],
  capabilities: ['swap', 'quote'],

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
          reason: 'jupiter_devnet_quote_not_available',
        },
      };
    }

    try {
      const url = new URL(`${apiUrl}/quote`);
      url.searchParams.set('inputMint', params.inputMint);
      url.searchParams.set('outputMint', params.outputMint);
      url.searchParams.set('amount', params.amount);
      url.searchParams.set('slippageBps', String(params.slippageBps ?? 50));

      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
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
      throw new Error(`Jupiter quote unavailable: ${message}`);
    }
  },

  async buildSwap(params: SwapExecuteParams): Promise<BuildResult> {
    if (isDevnetRpc()) {
      return {
        mode: 'instructions',
        instructions: [
          createMemoInstruction({
            protocol: 'jupiter',
            mode: 'devnet_compatibility',
            inputMint: params.quote.inputMint,
            outputMint: params.quote.outputMint,
            inputAmount: params.quote.inputAmount,
            outputAmount: params.quote.outputAmount,
          }),
        ],
        programIds: [JUPITER_PROGRAM, MEMO_PROGRAM],
        metadata: {
          mode: 'devnet_compatibility',
          reason: 'jupiter_devnet_quote_not_available',
        },
      };
    }

    const res = await fetch(`${apiUrl}/swap`, {
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
      throw new Error(`Jupiter swap build failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as JupiterSwapResponse;
    return {
      mode: 'transaction',
      transaction: data.swapTransaction,
      programIds: [JUPITER_PROGRAM],
      metadata: {
        inputAmount: params.quote.inputAmount,
        outputAmount: params.quote.outputAmount,
        priceImpactPct: params.quote.priceImpactPct,
      },
    };
  },

  async healthCheck(): Promise<AdapterHealth> {
    return runHealthProbe(apiUrl);
  },
});
