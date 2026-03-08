import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { z } from 'zod';
import type { BuildResult, SwapQuoteParams } from './adapters/adapter.interface.js';
import { createEscrowAdapter } from './adapters/escrow.adapter.js';
import { createJupiterAdapter } from './adapters/jupiter.adapter.js';
import { createMarinadeAdapter } from './adapters/marinade.adapter.js';
import { createMetaplexAdapter } from './adapters/metaplex.adapter.js';
import { createOrcaAdapter } from './adapters/orca.adapter.js';
import { createRaydiumAdapter } from './adapters/raydium.adapter.js';
import { createSolendAdapter } from './adapters/solend.adapter.js';
import { createSplTokenAdapter, createSystemAdapter } from './adapters/system-spl.adapter.js';
import { AdapterRegistry } from './registry.js';

const quoteSchema = z.object({
  protocol: z.string().min(1),
  inputMint: z.string().min(1),
  outputMint: z.string().min(1),
  amount: z.string().min(1),
  walletAddress: z.string().min(32),
  slippageBps: z.number().int().min(0).max(10000).optional(),
});

const buildSchema = z.object({
  protocol: z.string().min(1),
  type: z.string().min(1),
  walletAddress: z.string().min(32),
  intent: z.record(z.unknown()).default({}),
});

const swapBuildSchema = quoteSchema;

const stakeSchema = z.object({
  protocol: z.string().min(1),
  walletAddress: z.string().min(32),
  amount: z.string().min(1),
  validator: z.string().optional(),
});

const lendSchema = z.object({
  protocol: z.string().min(1),
  walletAddress: z.string().min(32),
  mint: z.string().min(1),
  amount: z.string().min(1),
});

const escrowSchema = z.object({
  protocol: z.string().default('escrow'),
  walletAddress: z.string().min(32),
  intent: z.record(z.unknown()).default({}),
});

const app = new Hono();
const registry = new AdapterRegistry();

registry.register(createSystemAdapter());
registry.register(createSplTokenAdapter());
registry.register(createJupiterAdapter(process.env.JUPITER_API_URL ?? 'https://lite-api.jup.ag/swap/v1'));
registry.register(createMarinadeAdapter());
registry.register(createSolendAdapter());
registry.register(createMetaplexAdapter());
registry.register(createOrcaAdapter());
registry.register(createRaydiumAdapter());
registry.register(createEscrowAdapter());
registry.registerMigration('jupiter', {
  fromVersion: '0.9.0',
  toVersion: '1.0.0',
  migrate: (_type, intent) => ({
    ...intent,
    ...(intent['maxSlippageBps'] === undefined && intent['slippageBps'] !== undefined
      ? { maxSlippageBps: intent['slippageBps'] }
      : {}),
  }),
});

const buildForIntent = async (
  protocol: string,
  type: string,
  walletAddress: string,
  intent: Record<string, unknown>,
): Promise<BuildResult> => {
  const adapter = registry.get(protocol);

  if (!adapter) {
    throw new Error(`Unknown protocol: ${protocol}`);
  }

  if (type === 'swap' && adapter.getSwapQuote && adapter.buildSwap) {
    const quote = await adapter.getSwapQuote({
      inputMint: String(intent['inputMint'] ?? ''),
      outputMint: String(intent['outputMint'] ?? ''),
      amount: String(intent['amount'] ?? ''),
      slippageBps: intent['slippageBps'] ? Number(intent['slippageBps']) : 50,
      walletAddress,
    });

    return adapter.buildSwap({ walletAddress, quote });
  }

  if (type === 'stake' && adapter.buildStake) {
    const params = {
      walletAddress,
      amount: String(intent['amount'] ?? '0'),
      ...(intent['validator'] ? { validator: String(intent['validator']) } : {}),
    };
    return adapter.buildStake(params);
  }

  if (type === 'unstake' && adapter.buildUnstake) {
    const params = {
      walletAddress,
      amount: String(intent['amount'] ?? '0'),
      ...(intent['validator'] ? { validator: String(intent['validator']) } : {}),
    };
    return adapter.buildUnstake(params);
  }

  if (type === 'lend_supply' && adapter.buildSupply) {
    const marketAddress = typeof intent['marketAddress'] === 'string'
      ? String(intent['marketAddress'])
      : undefined;

    return adapter.buildSupply({
      walletAddress,
      mint: String(intent['mint'] ?? ''),
      amount: String(intent['amount'] ?? '0'),
      ...(marketAddress ? { marketAddress } : {}),
    });
  }

  if (type === 'lend_borrow' && adapter.buildBorrow) {
    const marketAddress = typeof intent['marketAddress'] === 'string'
      ? String(intent['marketAddress'])
      : undefined;

    return adapter.buildBorrow({
      walletAddress,
      mint: String(intent['mint'] ?? ''),
      amount: String(intent['amount'] ?? '0'),
      ...(marketAddress ? { marketAddress } : {}),
    });
  }

  if (adapter.buildIntent) {
    return adapter.buildIntent(type, walletAddress, intent);
  }

  throw new Error(`Protocol ${protocol} cannot build for intent type ${type}`);
};

const getAdapterHealth = async (protocol: string): Promise<{
  protocol: string;
  version: string;
  ok: boolean;
  details?: Record<string, unknown>;
}> => {
  const adapter = registry.get(protocol);
  if (!adapter) {
    throw new Error(`Unknown protocol: ${protocol}`);
  }

  if (!adapter.healthCheck) {
    return {
      protocol: adapter.name,
      version: adapter.version,
      ok: true,
      details: {
        mode: 'static',
      },
    };
  }

  const result = await adapter.healthCheck();
  return {
    protocol: adapter.name,
    version: adapter.version,
    ok: result.ok,
    ...(result.details ? { details: result.details } : {}),
  };
};

app.get('/health', (c) => c.json({ status: 'ok', service: 'protocol-adapters' }));

app.get('/api/v1/protocols', (c) => {
  return c.json({
    data: registry.list().map((adapter) => ({
      protocol: adapter.name,
      version: adapter.version,
      capabilities: adapter.capabilities,
      programIds: adapter.programIds,
    })),
  });
});

app.get('/api/v1/protocols/:protocol/capabilities', (c) => {
  const protocol = c.req.param('protocol');
  const adapter = registry.get(protocol);
  if (!adapter) {
    return c.json({ error: `Unknown protocol: ${protocol}` }, 404);
  }

  return c.json({
    data: {
      protocol: adapter.name,
      version: adapter.version,
      capabilities: adapter.capabilities,
      programIds: adapter.programIds,
    },
  });
});

app.get('/api/v1/protocols/:protocol/version', (c) => {
  const protocol = c.req.param('protocol');
  const adapter = registry.get(protocol);
  if (!adapter) {
    return c.json({ error: `Unknown protocol: ${protocol}` }, 404);
  }

  return c.json({
    data: {
      protocol: adapter.name,
      version: adapter.version,
      programIds: adapter.programIds,
    },
  });
});

app.get('/api/v1/protocols/health', async (c) => {
  const checks = await Promise.all(
    registry.list().map(async (adapter) => {
      try {
        return await getAdapterHealth(adapter.name);
      } catch (error) {
        return {
          protocol: adapter.name,
          version: adapter.version,
          ok: false,
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );

  return c.json({
    data: {
      ok: checks.every((check) => check.ok),
      checks,
    },
  });
});

app.get('/api/v1/protocols/:protocol/health', async (c) => {
  const protocol = c.req.param('protocol');
  try {
    const check = await getAdapterHealth(protocol);
    return c.json({ data: check }, check.ok ? 200 : 503);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 404);
  }
});

app.post('/api/v1/protocols/:protocol/compatibility-check', async (c) => {
  const protocol = c.req.param('protocol');
  const body = await c.req.json().catch(() => ({}));
  const targetVersion = String(body.targetVersion ?? '').trim();
  if (!targetVersion) {
    return c.json({ error: 'targetVersion is required' }, 400);
  }

  const result = registry.checkCompatibility(protocol, targetVersion);
  if (!result.currentVersion) {
    return c.json({ error: result.reason ?? 'Unknown protocol' }, 404);
  }

  return c.json({ data: result });
});

app.post('/api/v1/protocols/:protocol/migrate-intent', async (c) => {
  const protocol = c.req.param('protocol');
  const body = await c.req.json().catch(() => ({}));
  const fromVersion = String(body.fromVersion ?? '').trim();
  const toVersion = String(body.toVersion ?? '').trim();
  const type = String(body.type ?? '').trim();
  const intent = body.intent && typeof body.intent === 'object' && !Array.isArray(body.intent)
    ? (body.intent as Record<string, unknown>)
    : null;

  if (!fromVersion || !toVersion || !type || !intent) {
    return c.json({ error: 'fromVersion, toVersion, type and intent object are required' }, 400);
  }

  try {
    const migrated = await registry.migrateIntent(protocol, { fromVersion, toVersion, type, intent });
    return c.json({ data: migrated });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/defi/quote', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = quoteSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const adapter = registry.get(parsed.data.protocol);
  if (!adapter || !adapter.getSwapQuote) {
    return c.json({ error: `Protocol ${parsed.data.protocol} does not support quote` }, 400);
  }

  try {
    const quote = await adapter.getSwapQuote(parsed.data as SwapQuoteParams);
    return c.json({ data: quote });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 502);
  }
});

app.post('/api/v1/defi/swap', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = swapBuildSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const built = await buildForIntent(parsed.data.protocol, 'swap', parsed.data.walletAddress, parsed.data);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/defi/stake', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = stakeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const built = await buildForIntent(parsed.data.protocol, 'stake', parsed.data.walletAddress, parsed.data);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/defi/unstake', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = stakeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const built = await buildForIntent(parsed.data.protocol, 'unstake', parsed.data.walletAddress, parsed.data);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/defi/lend/supply', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = lendSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const built = await buildForIntent(parsed.data.protocol, 'lend_supply', parsed.data.walletAddress, parsed.data);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/defi/lend/borrow', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = lendSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const built = await buildForIntent(parsed.data.protocol, 'lend_borrow', parsed.data.walletAddress, parsed.data);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/escrow/create', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = escrowSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const built = await buildForIntent(parsed.data.protocol, 'create_escrow', parsed.data.walletAddress, parsed.data.intent);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/escrow/:id/accept', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = escrowSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const intent = { ...parsed.data.intent, escrowId: c.req.param('id') };
    const built = await buildForIntent(parsed.data.protocol, 'accept_escrow', parsed.data.walletAddress, intent);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/escrow/:id/release', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = escrowSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const intent = { ...parsed.data.intent, escrowId: c.req.param('id') };
    const built = await buildForIntent(parsed.data.protocol, 'release_escrow', parsed.data.walletAddress, intent);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/escrow/:id/refund', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = escrowSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const intent = { ...parsed.data.intent, escrowId: c.req.param('id') };
    const built = await buildForIntent(parsed.data.protocol, 'refund_escrow', parsed.data.walletAddress, intent);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/escrow/:id/dispute', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = escrowSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const intent = { ...parsed.data.intent, escrowId: c.req.param('id') };
    const built = await buildForIntent(parsed.data.protocol, 'dispute_escrow', parsed.data.walletAddress, intent);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/escrow/:id/resolve', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = escrowSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const intent = { ...parsed.data.intent, escrowId: c.req.param('id') };
    const built = await buildForIntent(parsed.data.protocol, 'resolve_dispute', parsed.data.walletAddress, intent);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post('/api/v1/build', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = buildSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const built = await buildForIntent(parsed.data.protocol, parsed.data.type, parsed.data.walletAddress, parsed.data.intent);
    return c.json({ data: built });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

const port = Number(process.env.PORT ?? 3005);

serve({ fetch: app.fetch, port }, (info) => {
  console.log('protocol-adapters listening on http://localhost:' + info.port);
});

export { app };
