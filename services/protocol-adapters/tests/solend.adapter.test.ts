import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSolendAdapter } from '../src/adapters/solend.adapter.js';

const mocks = vi.hoisted(() => ({
  buildDepositTxns: vi.fn(),
  buildBorrowTxns: vi.fn(),
}));

vi.mock('@solendprotocol/solend-sdk', () => ({
  SolendActionCore: {
    buildDepositTxns: mocks.buildDepositTxns,
    buildBorrowTxns: mocks.buildBorrowTxns,
  },
}));

const USER = '4Usb5gsxg36LaxaWWH4NmJ5UwEoMpf8WbYzhWhrvWpXw';
const MINT = 'So11111111111111111111111111111111111111112';
const ALT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const makeIx = (programId: string): TransactionInstruction =>
  new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      {
        pubkey: new PublicKey(USER),
        isSigner: true,
        isWritable: true,
      },
    ],
    data: Buffer.from([1, 2, 3]),
  });

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('solend adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('SOLANA_RPC_URL', 'https://api.devnet.solana.com');
    vi.stubGlobal('fetch', vi.fn());
    mocks.buildDepositTxns.mockReset();
    mocks.buildBorrowTxns.mockReset();
  });

  it('builds supply instructions using Save market configs + sdk action', async () => {
    const marketAddress = '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY';
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          name: 'main',
          isPrimary: true,
          address: marketAddress,
          authorityAddress: '6QfCGK6UN1Cv9VVmowefTaY3oMpvW7d4W8ddmK5g4z42',
          owner: '5pHk2TmnqQzRF9L6egy5FfiyBgS7G9cMZ5RFaJAvghzw',
          reserves: [
            {
              liquidityToken: { mint: MINT },
              pythOracle: '4WSN3XDSTfBX9A1YXGg8HJ7n2GtWMDNbtz1ab6aGGXfG',
              switchboardOracle: 'Lp3VNoRQi699VZe6u59TV8J38ELEUzxkaisoWsDuJgB',
              address: 'CRsHewGBRceCKVQNV9vF15HQVDTvqgqExtCfDQtRWGRi',
              collateralMintAddress: '6SspvG4AxDzThprZKpmdh95Wdj8baWLJhyrrRnP3wCxP',
              collateralSupplyAddress: 'iCs4vZd1Cz3ygybbyRf6VmQVhunNFeVwNt55bujmh69',
              liquidityAddress: 'DY93wrycxhZePZWgqq2oKnUQ8vqXTSPqJefreAjNkyr9',
              liquidityFeeReceiverAddress: 'FnaTEj5uBSdDntyb4ngevtgYGqwn5Fkh1FCdczqq8HVg',
            },
          ],
        },
      ]),
    );

    mocks.buildDepositTxns.mockResolvedValue({
      getInstructions: async () => ({
        preLendingIxs: [{ instruction: makeIx('11111111111111111111111111111111') }],
        lendingIxs: [{ instruction: makeIx('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }],
        postLendingIxs: [],
      }),
    });

    const adapter = createSolendAdapter();
    const result = await adapter.buildSupply?.({
      walletAddress: USER,
      mint: MINT,
      amount: '1000',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.buildDepositTxns).toHaveBeenCalledOnce();
    expect(result?.mode).toBe('instructions');
    expect(result?.instructions).toHaveLength(2);
    expect(result?.programIds).toEqual(
      expect.arrayContaining([
        '11111111111111111111111111111111',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      ]),
    );
  });

  it('scopes reserve lookup to an explicitly requested market', async () => {
    const primaryMarket = '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY';
    const altMarket = '7RCz8wb6WXxUhAigok9ttgrVgDFFFbibcirECzWSBauM';
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          name: 'main',
          isPrimary: true,
          address: primaryMarket,
          authorityAddress: '6QfCGK6UN1Cv9VVmowefTaY3oMpvW7d4W8ddmK5g4z42',
          owner: '5pHk2TmnqQzRF9L6egy5FfiyBgS7G9cMZ5RFaJAvghzw',
          reserves: [
            {
              liquidityToken: { mint: MINT },
              pythOracle: '4WSN3XDSTfBX9A1YXGg8HJ7n2GtWMDNbtz1ab6aGGXfG',
              switchboardOracle: 'Lp3VNoRQi699VZe6u59TV8J38ELEUzxkaisoWsDuJgB',
              address: 'CRsHewGBRceCKVQNV9vF15HQVDTvqgqExtCfDQtRWGRi',
              collateralMintAddress: '6SspvG4AxDzThprZKpmdh95Wdj8baWLJhyrrRnP3wCxP',
              collateralSupplyAddress: 'iCs4vZd1Cz3ygybbyRf6VmQVhunNFeVwNt55bujmh69',
              liquidityAddress: 'DY93wrycxhZePZWgqq2oKnUQ8vqXTSPqJefreAjNkyr9',
              liquidityFeeReceiverAddress: 'FnaTEj5uBSdDntyb4ngevtgYGqwn5Fkh1FCdczqq8HVg',
            },
          ],
        },
        {
          name: 'alt',
          isPrimary: false,
          address: altMarket,
          authorityAddress: '9q3tefVhojSm6VQ3EwBrv8afao95Y3nxXUFAT3zh7T4E',
          owner: '81KTtWjRndxGQbJHGJq6EaJWL8JfXbyywVvZReVPQd1X',
          reserves: [
            {
              liquidityToken: { mint: ALT_MINT },
              pythOracle: 'J83w4HKfqxwcq3fhd2qYvPRxMSEVYQx4jMvydMWVX32',
              switchboardOracle: 'FfFjR4HABwRkQ7Yr8XfN45xqM3wXptqSLU6nRK2dRfBN',
              address: '4xBByEdJs6z83PLfG7hQ6mR2bx2gPVmF8bYw4cHnQPeA',
              collateralMintAddress: '8msRFJ8rFeY6J4BK9W5Ju2MecfTGup5ad5nDv8f94p42',
              collateralSupplyAddress: 'FFWTj5fSMjkgSbGzSDkaZaEZDwR6RmaUqT1M7jM5FnV3',
              liquidityAddress: '52x69QeWkk3j4ibdafoQweBjHpb54m8Xj9DXcW4y1q2F',
              liquidityFeeReceiverAddress: '3kWf6RoJ79hL3jiVdZjQh4Zb9M2A59P5pWfM6wMkxcuM',
            },
          ],
        },
      ]),
    );

    mocks.buildBorrowTxns.mockResolvedValue({
      getInstructions: async () => ({
        preLendingIxs: [],
        lendingIxs: [{ instruction: makeIx('11111111111111111111111111111111') }],
        postLendingIxs: [],
      }),
    });

    const adapter = createSolendAdapter();
    await adapter.buildBorrow?.({
      walletAddress: USER,
      mint: ALT_MINT,
      amount: '250',
      marketAddress: altMarket,
    });

    expect(mocks.buildBorrowTxns).toHaveBeenCalledOnce();
    const [poolArg] = mocks.buildBorrowTxns.mock.calls[0] ?? [];
    expect(poolArg?.address).toBe(altMarket);
  });

  it('returns a clear error when no reserve matches the requested mint', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          name: 'main',
          isPrimary: true,
          address: '4UpD2fh7xH3VP9QQaXtsS1YY3bxzWhtfpks7FatyKvdY',
          authorityAddress: '6QfCGK6UN1Cv9VVmowefTaY3oMpvW7d4W8ddmK5g4z42',
          owner: '5pHk2TmnqQzRF9L6egy5FfiyBgS7G9cMZ5RFaJAvghzw',
          reserves: [
            {
              liquidityToken: { mint: ALT_MINT },
              pythOracle: 'J83w4HKfqxwcq3fhd2qYvPRxMSEVYQx4jMvydMWVX32',
              switchboardOracle: 'FfFjR4HABwRkQ7Yr8XfN45xqM3wXptqSLU6nRK2dRfBN',
              address: '4xBByEdJs6z83PLfG7hQ6mR2bx2gPVmF8bYw4cHnQPeA',
              collateralMintAddress: '8msRFJ8rFeY6J4BK9W5Ju2MecfTGup5ad5nDv8f94p42',
              collateralSupplyAddress: 'FFWTj5fSMjkgSbGzSDkaZaEZDwR6RmaUqT1M7jM5FnV3',
              liquidityAddress: '52x69QeWkk3j4ibdafoQweBjHpb54m8Xj9DXcW4y1q2F',
              liquidityFeeReceiverAddress: '3kWf6RoJ79hL3jiVdZjQh4Zb9M2A59P5pWfM6wMkxcuM',
            },
          ],
        },
      ]),
    );

    const adapter = createSolendAdapter();
    await expect(
      adapter.buildSupply?.({
        walletAddress: USER,
        mint: MINT,
        amount: '1',
      }),
    ).rejects.toThrow(/No Solend reserve found for mint/);
  });
});
