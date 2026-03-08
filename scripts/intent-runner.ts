import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CreateTransactionRequest, TransactionType } from '@agentic-wallet/common';
import { createAgenticWalletClient } from '../packages/sdk/src/index.js';

type JsonObject = Record<string, unknown>;

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';
const tenantId = process.env.TENANT_ID;

const currentTypes = new Set<TransactionType>([
  'transfer_sol',
  'transfer_spl',
  'swap',
  'stake',
  'unstake',
  'lend_supply',
  'lend_borrow',
  'create_mint',
  'mint_token',
  'query_balance',
  'query_positions',
  'create_escrow',
  'accept_escrow',
  'release_escrow',
  'refund_escrow',
  'dispute_escrow',
  'resolve_dispute',
  'create_milestone_escrow',
  'release_milestone',
  'x402_pay',
  'flash_loan_bundle',
  'cpi_call',
  'custom_instruction_bundle',
  'treasury_allocate',
  'treasury_rebalance',
  'paper_trade',
]);

const usage = (): void => {
  console.log('Usage: npm run intent-runner -- --file <intent.json>');
  console.log('   or: npm run intent-runner -- --intent \'<json-string>\'');
};

const getArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
};

const parseJson = (raw: string): JsonObject => {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Intent payload must be a JSON object');
  }
  return parsed as JsonObject;
};

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Field "${field}" must be a non-empty string`);
  }
  return value;
};

const asOptionalString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const asOptionalNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse numeric value: ${String(value)}`);
  }
  return Math.trunc(parsed);
};

const toLegacyMetadata = (input: JsonObject): JsonObject => {
  const legacy: JsonObject = {};

  if (typeof input.fromWalletId === 'string') {
    legacy.fromWalletId = input.fromWalletId;
  }
  if (typeof input.chain === 'string') {
    legacy.chain = input.chain;
  }
  if (typeof input.createdAt === 'string') {
    legacy.createdAt = input.createdAt;
  }
  if (typeof input.reasoning === 'string') {
    legacy.reasoning = input.reasoning;
  }

  return legacy;
};

const resolveWalletId = async (
  client: ReturnType<typeof createAgenticWalletClient>,
  intent: JsonObject,
): Promise<string> => {
  if (typeof intent.walletId === 'string' && intent.walletId.length > 0) {
    return intent.walletId;
  }

  const fromWalletId = asOptionalString(intent.fromWalletId);
  if (!fromWalletId) {
    throw new Error('Missing walletId or fromWalletId');
  }

  const wallet = await client.wallet.findByPublicKey(fromWalletId);
  if (!wallet) {
    throw new Error(`No wallet found for fromWalletId=${fromWalletId}`);
  }

  return wallet.id;
};

const adaptIntent = async (
  client: ReturnType<typeof createAgenticWalletClient>,
  raw: JsonObject,
): Promise<CreateTransactionRequest> => {
  const walletId = await resolveWalletId(client, raw);
  const type = asString(raw.type, 'type');
  const protocolFromInput = asOptionalString(raw.protocol);
  const gasless = raw.gasless === true;
  const legacyMetadata = toLegacyMetadata(raw);
  if (Object.keys(legacyMetadata).length > 0 || typeof raw.fromWalletId === 'string') {
    if (!('chain' in legacyMetadata)) legacyMetadata.chain = 'solana';
    if (!('createdAt' in legacyMetadata)) legacyMetadata.createdAt = new Date().toISOString();
    if (!('id' in legacyMetadata)) legacyMetadata.id = randomUUID();
  }

  if (type === 'transfer') {
    const to = asString(raw.to, 'to');
    const amountRaw = raw.amount;
    if (amountRaw === undefined || amountRaw === null) {
      throw new Error('Field "amount" is required for transfer');
    }
    const tokenMint = asOptionalString(raw.tokenMint);

    if (tokenMint) {
      return {
        walletId,
        type: 'transfer_spl',
        protocol: protocolFromInput ?? 'spl-token',
        gasless,
        intent: {
          destination: to,
          mint: tokenMint,
          amount: String(amountRaw),
          ...(Object.keys(legacyMetadata).length > 0 ? { legacy: legacyMetadata } : {}),
        },
      };
    }

    const lamports = asOptionalNumber(amountRaw);
    if (!lamports || lamports <= 0) {
      throw new Error('SOL transfer requires amount > 0');
    }
    return {
      walletId,
      type: 'transfer_sol',
      protocol: protocolFromInput ?? 'system-program',
      gasless,
      intent: {
        destination: to,
        lamports,
        ...(Object.keys(legacyMetadata).length > 0 ? { legacy: legacyMetadata } : {}),
      },
    };
  }

  if (type === 'swap') {
    const amountIn = raw.amountIn;
    const minAmountOut = raw.minAmountOut;
    if (amountIn === undefined || minAmountOut === undefined) {
      throw new Error('swap requires amountIn and minAmountOut');
    }
    const slippageBps = asOptionalNumber(raw.slippageBps);

    return {
      walletId,
      type: 'swap',
      protocol: protocolFromInput ?? 'orca',
      gasless,
      intent: {
        pool: asString(raw.poolAddress, 'poolAddress'),
        inputMint: asString(raw.tokenInMint, 'tokenInMint'),
        outputMint: asString(raw.tokenOutMint, 'tokenOutMint'),
        amount: String(amountIn),
        minimumOut: String(minAmountOut),
        ...(slippageBps !== undefined ? { slippageBps } : {}),
        ...(Object.keys(legacyMetadata).length > 0 ? { legacy: legacyMetadata } : {}),
      },
    };
  }

  if (type === 'create_mint') {
    return {
      walletId,
      type: 'create_mint',
      protocol: protocolFromInput ?? 'spl-token',
      gasless,
      intent: {
        decimals: asOptionalNumber(raw.decimals) ?? 9,
        ...(asOptionalString(raw.mintAuthority) ? { mintAuthority: asOptionalString(raw.mintAuthority) } : {}),
        ...(asOptionalString(raw.freezeAuthority) ? { freezeAuthority: asOptionalString(raw.freezeAuthority) } : {}),
        ...(Object.keys(legacyMetadata).length > 0 ? { legacy: legacyMetadata } : {}),
      },
    };
  }

  if (type === 'mint_token') {
    if (raw.amount === undefined) {
      throw new Error('mint_token requires amount');
    }
    return {
      walletId,
      type: 'mint_token',
      protocol: protocolFromInput ?? 'spl-token',
      gasless,
      intent: {
        mint: asString(raw.mint, 'mint'),
        destination: asString(raw.to, 'to'),
        amount: String(raw.amount),
        ...(Object.keys(legacyMetadata).length > 0 ? { legacy: legacyMetadata } : {}),
      },
    };
  }

  if (!currentTypes.has(type as TransactionType)) {
    throw new Error(`Unsupported intent type: ${type}`);
  }

  return {
    walletId,
    type: type as TransactionType,
    protocol: protocolFromInput ?? 'custom',
    gasless,
    ...(typeof raw.agentId === 'string' ? { agentId: raw.agentId } : {}),
    ...(typeof raw.idempotencyKey === 'string' ? { idempotencyKey: raw.idempotencyKey } : {}),
    intent:
      raw.intent && typeof raw.intent === 'object' && !Array.isArray(raw.intent)
        ? (raw.intent as Record<string, unknown>)
        : {},
  };
};

const main = async (): Promise<void> => {
  const file = getArg('--file');
  const intentArg = getArg('--intent');
  const showHelp = process.argv.includes('--help') || process.argv.includes('-h');

  if (showHelp) {
    usage();
    return;
  }

  if (!file && !intentArg) {
    usage();
    throw new Error('Either --file or --intent is required');
  }

  const rawInput = file ? await readFile(file, 'utf8') : intentArg!;
  const intent = parseJson(rawInput);

  const client = createAgenticWalletClient(apiBase, {
    apiKey,
    ...(tenantId ? { tenantId } : {}),
  });

  const request = await adaptIntent(client, intent);
  const result = await client.transaction.create(request);

  console.log(
    JSON.stringify(
      {
        status: 'success',
        request,
        result,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        status: 'failure',
        errorCode: 'PIPELINE_ERROR',
        failedAt: 'build',
        errorMessage: message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
