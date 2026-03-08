import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJupiterAdapter } from '../src/adapters/jupiter.adapter.js';
import { createOrcaAdapter } from '../src/adapters/orca.adapter.js';
import { createRaydiumAdapter } from '../src/adapters/raydium.adapter.js';

const quoteInput = {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '1000',
  walletAddress: '4Usb5gsxg36LaxaWWH4NmJ5UwEoMpf8WbYzhWhrvWpXw',
  slippageBps: 50,
};

describe('quote adapters fail closed', () => {
  const previousRpcUrl = process.env.SOLANA_RPC_URL;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousRpcUrl === undefined) {
      delete process.env.SOLANA_RPC_URL;
    } else {
      process.env.SOLANA_RPC_URL = previousRpcUrl;
    }
  });

  it('throws for Jupiter when upstream quote is unavailable', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error('network down'));

    const adapter = createJupiterAdapter('https://quote-api.jup.ag/v6');

    await expect(adapter.getSwapQuote!(quoteInput)).rejects.toThrow('Jupiter quote unavailable');
  });

  it('throws for Orca when upstream quote is unavailable', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error('timeout'));

    const adapter = createOrcaAdapter();

    await expect(adapter.getSwapQuote!(quoteInput)).rejects.toThrow('Orca quote unavailable');
  });

  it('throws for Raydium when upstream quote is unavailable', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error('unreachable'));

    const adapter = createRaydiumAdapter();

    await expect(adapter.getSwapQuote!(quoteInput)).rejects.toThrow('Raydium quote unavailable');
  });
});
