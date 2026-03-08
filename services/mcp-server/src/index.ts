import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { z } from 'zod';

const app = new Hono();

const gatewayUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';
const tenantId = process.env.TENANT_ID ?? '';

const defaultHeaders = (): HeadersInit => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
});

const request = async (path: string, init?: RequestInit): Promise<unknown> => {
  const res = await fetch(`${gatewayUrl}${path}`, {
    ...init,
    headers: {
      ...(defaultHeaders() ?? {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await res.json().catch(() => ({}))) as { data?: unknown; error?: string };
  if (!res.ok) {
    throw new Error(payload.error ?? `Gateway request failed (${res.status})`);
  }
  return payload.data;
};

const toolCallSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});

const gatewayRequestSchema = z.object({
  path: z.string().regex(/^\/api\/v1\/[a-zA-Z0-9/_:-]*$/),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.record(z.unknown()).optional(),
});

type ToolArgs = Record<string, unknown>;
type ToolHandler = (args: ToolArgs) => Promise<unknown>;

type ToolDefinition = {
  name: string;
  description: string;
  handler: ToolHandler;
};

class MpcInputError extends Error {}

const withQuery = (
  path: string,
  query?: Record<string, string | number | boolean>,
): string => {
  if (!query || Object.keys(query).length === 0) return path;
  const url = new URL(path, 'http://localhost');
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
};

const requireString = (args: ToolArgs, field: string): string => {
  const value = args[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MpcInputError(`${field} is required`);
  }
  return value.trim();
};

const optionalString = (args: ToolArgs, field: string): string | null => {
  const value = args[field];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MpcInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
};

const omit = (args: ToolArgs, keys: string[]): ToolArgs => {
  const next: ToolArgs = {};
  for (const [key, value] of Object.entries(args)) {
    if (!keys.includes(key)) {
      next[key] = value;
    }
  }
  return next;
};

const toolDefinitions: ToolDefinition[] = [
  { name: 'wallet.create', description: 'Create a wallet', handler: (args) => request('/api/v1/wallets', { method: 'POST', body: JSON.stringify({ label: args.label }) }) },
  {
    name: 'wallet.list',
    description: 'List wallets',
    handler: (args) => {
      const publicKey = optionalString(args, 'publicKey');
      return request(withQuery('/api/v1/wallets', publicKey ? { publicKey } : undefined));
    },
  },
  { name: 'wallet.get', description: 'Get wallet metadata by walletId', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}`) },
  { name: 'wallet.balance', description: 'Get wallet SOL balance', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/balance`) },
  { name: 'wallet.tokens', description: 'Get wallet SPL balances', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/tokens`) },
  {
    name: 'wallet.sign_message',
    description: 'Sign a base64 message with wallet key',
    handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/sign`, {
      method: 'POST',
      body: JSON.stringify({ message: requireString(args, 'message') }),
    }),
  },
  {
    name: 'wallet.sign_transaction',
    description: 'Sign a base64 transaction with wallet key',
    handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/sign`, {
      method: 'POST',
      body: JSON.stringify({ transaction: requireString(args, 'transaction') }),
    }),
  },

  { name: 'tx.create', description: 'Create a transaction from intent', handler: (args) => request('/api/v1/transactions', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'tx.get', description: 'Fetch transaction by id', handler: (args) => request(`/api/v1/transactions/${requireString(args, 'txId')}`) },
  { name: 'tx.retry', description: 'Retry a transaction by id', handler: (args) => request(`/api/v1/transactions/${requireString(args, 'txId')}/retry`, { method: 'POST' }) },
  { name: 'tx.approve', description: 'Approve an approval-gated transaction', handler: (args) => request(`/api/v1/transactions/${requireString(args, 'txId')}/approve`, { method: 'POST' }) },
  { name: 'tx.reject', description: 'Reject an approval-gated transaction', handler: (args) => request(`/api/v1/transactions/${requireString(args, 'txId')}/reject`, { method: 'POST' }) },
  { name: 'tx.proof', description: 'Get execution proof by txId', handler: (args) => request(`/api/v1/transactions/${requireString(args, 'txId')}/proof`) },
  { name: 'tx.replay', description: 'Get deterministic replay data by txId', handler: (args) => request(`/api/v1/transactions/${requireString(args, 'txId')}/replay`) },
  { name: 'tx.list_by_wallet', description: 'List wallet transactions', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/transactions`) },
  { name: 'tx.pending_approvals', description: 'List wallet pending approvals', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/pending-approvals`) },
  { name: 'tx.positions', description: 'List wallet protocol positions', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/positions`) },
  { name: 'tx.escrows', description: 'List wallet escrow records', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/escrows`) },

  { name: 'policy.create', description: 'Create a policy', handler: (args) => request('/api/v1/policies', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'policy.list_wallet', description: 'List policies for a wallet', handler: (args) => request(`/api/v1/wallets/${requireString(args, 'walletId')}/policies`) },
  {
    name: 'policy.compatibility_check',
    description: 'Check if policy rules are compatible',
    handler: (args) => request('/api/v1/policies/compatibility-check', { method: 'POST', body: JSON.stringify({ rules: args.rules }) }),
  },
  {
    name: 'policy.migrate',
    description: 'Migrate a policy to a target version',
    handler: (args) => request(`/api/v1/policies/${requireString(args, 'policyId')}/migrate`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['policyId'])),
    }),
  },
  { name: 'policy.evaluate', description: 'Evaluate wallet policy decision', handler: (args) => request('/api/v1/evaluate', { method: 'POST', body: JSON.stringify(args) }) },

  { name: 'agent.create', description: 'Create an agent', handler: (args) => request('/api/v1/agents', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'agent.list', description: 'List agents', handler: () => request('/api/v1/agents') },
  { name: 'agent.get', description: 'Get agent details', handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}`) },
  {
    name: 'agent.capabilities_update',
    description: 'Update agent capabilities/execution mode',
    handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/capabilities`, {
      method: 'PUT',
      body: JSON.stringify(omit(args, ['agentId'])),
    }),
  },
  { name: 'agent.start', description: 'Start agent scheduler loop', handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/start`, { method: 'POST' }) },
  { name: 'agent.stop', description: 'Stop agent scheduler loop', handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/stop`, { method: 'POST' }) },
  {
    name: 'agent.pause',
    description: 'Pause an agent',
    handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/pause`, {
      method: 'POST',
      body: JSON.stringify(optionalString(args, 'reason') ? { reason: optionalString(args, 'reason') } : {}),
    }),
  },
  { name: 'agent.resume', description: 'Resume an agent', handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/resume`, { method: 'POST' }) },
  { name: 'agent.budget', description: 'Get agent budget status', handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/budget`) },
  {
    name: 'agent.manifest_issue',
    description: 'Issue capability manifest for an agent',
    handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/manifest/issue`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['agentId'])),
    }),
  },
  {
    name: 'agent.manifest_verify',
    description: 'Verify capability manifest for an agent',
    handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/manifest/verify`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['agentId'])),
    }),
  },
  {
    name: 'agent.execute',
    description: 'Execute an intent as an agent',
    handler: (args) => request(`/api/v1/agents/${requireString(args, 'agentId')}/execute`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['agentId'])),
    }),
  },

  { name: 'protocol.list', description: 'List available protocol adapters', handler: () => request('/api/v1/protocols') },
  { name: 'protocol.capabilities', description: 'Get protocol capabilities', handler: (args) => request(`/api/v1/protocols/${requireString(args, 'protocol')}/capabilities`) },
  { name: 'protocol.health_all', description: 'Get health for all protocols', handler: () => request('/api/v1/protocols/health') },
  { name: 'protocol.health', description: 'Get health for a protocol', handler: (args) => request(`/api/v1/protocols/${requireString(args, 'protocol')}/health`) },
  { name: 'protocol.quote', description: 'Fetch swap quote', handler: (args) => request('/api/v1/defi/quote', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'protocol.swap', description: 'Build swap transaction/instructions', handler: (args) => request('/api/v1/defi/swap', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'protocol.stake', description: 'Build staking transaction/instructions', handler: (args) => request('/api/v1/defi/stake', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'protocol.unstake', description: 'Build unstake transaction/instructions', handler: (args) => request('/api/v1/defi/unstake', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'protocol.lend_supply', description: 'Build lending supply instructions', handler: (args) => request('/api/v1/defi/lend/supply', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'protocol.lend_borrow', description: 'Build lending borrow instructions', handler: (args) => request('/api/v1/defi/lend/borrow', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'protocol.escrow_create', description: 'Build create escrow instructions', handler: (args) => request('/api/v1/escrow/create', { method: 'POST', body: JSON.stringify(args) }) },
  {
    name: 'protocol.escrow_accept',
    description: 'Build accept escrow instructions',
    handler: (args) => request(`/api/v1/escrow/${requireString(args, 'escrowId')}/accept`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['escrowId'])),
    }),
  },
  {
    name: 'protocol.escrow_release',
    description: 'Build release escrow instructions',
    handler: (args) => request(`/api/v1/escrow/${requireString(args, 'escrowId')}/release`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['escrowId'])),
    }),
  },
  {
    name: 'protocol.escrow_refund',
    description: 'Build refund escrow instructions',
    handler: (args) => request(`/api/v1/escrow/${requireString(args, 'escrowId')}/refund`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['escrowId'])),
    }),
  },
  {
    name: 'protocol.escrow_dispute',
    description: 'Build dispute escrow instructions',
    handler: (args) => request(`/api/v1/escrow/${requireString(args, 'escrowId')}/dispute`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['escrowId'])),
    }),
  },
  {
    name: 'protocol.escrow_resolve',
    description: 'Build resolve escrow instructions',
    handler: (args) => request(`/api/v1/escrow/${requireString(args, 'escrowId')}/resolve`, {
      method: 'POST',
      body: JSON.stringify(omit(args, ['escrowId'])),
    }),
  },

  { name: 'risk.list_protocols', description: 'List protocol risk configs', handler: () => request('/api/v1/risk/protocols') },
  { name: 'risk.get_protocol', description: 'Get protocol risk config', handler: (args) => request(`/api/v1/risk/protocols/${requireString(args, 'protocol')}`) },
  { name: 'risk.set_protocol', description: 'Update protocol risk config', handler: (args) => request(`/api/v1/risk/protocols/${requireString(args, 'protocol')}`, { method: 'PUT', body: JSON.stringify(args) }) },
  { name: 'risk.list_portfolio', description: 'List portfolio risk controls', handler: () => request('/api/v1/risk/portfolio') },
  { name: 'risk.get_portfolio', description: 'Get wallet portfolio risk controls', handler: (args) => request(`/api/v1/risk/portfolio/${requireString(args, 'walletId')}`) },
  {
    name: 'risk.set_portfolio',
    description: 'Update wallet portfolio risk controls',
    handler: (args) => request(`/api/v1/risk/portfolio/${requireString(args, 'walletId')}`, {
      method: 'PUT',
      body: JSON.stringify(omit(args, ['walletId'])),
    }),
  },
  { name: 'risk.get_chaos', description: 'Get chaos switchboard settings', handler: () => request('/api/v1/chaos') },
  { name: 'risk.set_chaos', description: 'Update chaos switchboard settings', handler: (args) => request('/api/v1/chaos', { method: 'PUT', body: JSON.stringify(args) }) },

  { name: 'strategy.backtest', description: 'Run strategy backtest', handler: (args) => request('/api/v1/strategy/backtest', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'strategy.paper_execute', description: 'Execute paper trade intent', handler: (args) => request('/api/v1/strategy/paper/execute', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'strategy.paper_list', description: 'List paper trades for an agent', handler: (args) => request(`/api/v1/strategy/paper/${requireString(args, 'agentId')}`) },

  { name: 'treasury.allocate', description: 'Allocate treasury budget', handler: (args) => request('/api/v1/treasury/allocate', { method: 'POST', body: JSON.stringify(args) }) },
  { name: 'treasury.rebalance', description: 'Rebalance treasury budget', handler: (args) => request('/api/v1/treasury/rebalance', { method: 'POST', body: JSON.stringify(args) }) },

  {
    name: 'audit.events',
    description: 'List audit events with optional filters',
    handler: (args) => {
      const query: Record<string, string> = {};
      for (const field of ['txId', 'agentId', 'walletId', 'protocol', 'escrowId']) {
        const value = optionalString(args, field);
        if (value) query[field] = value;
      }
      return request(withQuery('/api/v1/audit/events', query));
    },
  },
  { name: 'audit.metrics', description: 'Get metrics snapshot', handler: () => request('/api/v1/metrics') },

  {
    name: 'gateway.request',
    description: 'Call any API gateway /api/v1 endpoint with schema validation',
    handler: async (args) => {
      const parsedRequest = gatewayRequestSchema.safeParse(args);
      if (!parsedRequest.success) {
        throw new MpcInputError(parsedRequest.error.message);
      }

      const method = parsedRequest.data.method;
      const path = withQuery(parsedRequest.data.path, parsedRequest.data.query);
      return request(path, {
        method,
        ...(method === 'GET' || method === 'DELETE'
          ? {}
          : { body: JSON.stringify(parsedRequest.data.body ?? {}) }),
      });
    },
  },
];

const tools = toolDefinitions.map((tool) => ({ name: tool.name, description: tool.description }));
const toolMap = new Map<string, ToolHandler>(toolDefinitions.map((tool) => [tool.name, tool.handler]));

app.get('/health', (c) => c.json({ status: 'ok', service: 'mcp-server' }));

app.get('/mcp/tools', (c) => c.json({ data: tools }));

app.post('/mcp/call', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = toolCallSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const { tool, args } = parsed.data;
    const handler = toolMap.get(tool);
    if (!handler) {
      return c.json({ error: `Unknown MCP tool: ${tool}` }, 404);
    }

    return c.json({ data: await handler(args) });
  } catch (error) {
    if (error instanceof MpcInputError) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: (error as Error).message }, 500);
  }
});

const port = Number(process.env.PORT ?? 3008);

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`mcp-server listening on http://localhost:${info.port}`);
  });
}

export { app };
