import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  capabilityManifestSchema,
  agentSchema,
  createAgentRequestSchema,
  executeAgentIntentSchema,
  issueCapabilityManifestRequestSchema,
  paperTradeRequestSchema,
  strategyBacktestRequestSchema,
  treasuryAllocationRequestSchema,
  treasuryRebalanceRequestSchema,
  updateAgentCapabilitiesSchema,
  type Agent,
  type ExecuteAgentIntentRequest,
} from '@agentic-wallet/common';
import { AgentStore } from './store/agent-store.js';
import { AgentScheduler } from './scheduler/scheduler.js';
import { BudgetStore } from './store/budget-store.js';
import { StrategyStore } from './store/strategy-store.js';
import {
  issueCapabilityManifest,
  manifestAllows,
  verifyCapabilityManifest,
} from './security/capability-manifest.js';
import {
  createDecisionState,
  decideAutonomousAction,
  markDecisionExecuted,
  type DecisionState,
} from './decision/engine.js';

const app = new Hono();
const dataDir = process.env.AGENT_RUNTIME_DATA_DIR ?? path.join(process.cwd(), 'services', 'agent-runtime', 'data');
const store = new AgentStore(path.join(dataDir, 'agents.json'));
const scheduler = new AgentScheduler();
const budgetStore = new BudgetStore(path.join(dataDir, 'budgets.json'));
const strategyStore = new StrategyStore(path.join(dataDir, 'strategy.json'));
const decisionStates = new Map<string, DecisionState>();

const walletEngineUrl = process.env.WALLET_ENGINE_URL ?? 'http://localhost:3002';
const transactionEngineUrl = process.env.TRANSACTION_ENGINE_URL ?? 'http://localhost:3006';
const policyEngineUrl = process.env.POLICY_ENGINE_URL ?? 'http://localhost:3003';
const loopIntervalMs = Number(process.env.AGENT_LOOP_INTERVAL_MS ?? 5000);
const manifestSigningSecret = process.env.AGENT_MANIFEST_SIGNING_SECRET ?? 'dev-manifest-secret';
const manifestIssuer = process.env.AGENT_MANIFEST_ISSUER ?? 'agent-runtime';
const requireManifest = (process.env.AGENT_REQUIRE_MANIFEST ?? 'false') === 'true';
const requireBacktestPass = (process.env.AGENT_REQUIRE_BACKTEST_PASS ?? 'false') === 'true';
const pauseWebhookSecret = process.env.AGENT_PAUSE_WEBHOOK_SECRET ?? '';

const spendingTypes = new Set([
  'transfer_sol',
  'transfer_spl',
  'swap',
  'stake',
  'unstake',
  'lend_supply',
  'lend_borrow',
  'create_mint',
  'mint_token',
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
]);

const inferLamports = (intent: Record<string, unknown>): number =>
  Math.max(
    0,
    Number(intent['lamports'] ?? intent['amountLamports'] ?? intent['amount'] ?? 0),
  );

const createWallet = async (): Promise<string> => {
  const res = await fetch(`${walletEngineUrl}/api/v1/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    throw new Error(`Wallet creation failed (${res.status}): ${await res.text()}`);
  }

  const payload = (await res.json()) as { data: { id: string } };
  return payload.data.id;
};

const fetchWalletContext = async (walletId: string): Promise<Record<string, unknown>> => {
  const [balanceRes, tokensRes, txRes, approvalsRes, positionsRes, escrowsRes, policiesRes] = await Promise.all([
    fetch(`${walletEngineUrl}/api/v1/wallets/${walletId}/balance`),
    fetch(`${walletEngineUrl}/api/v1/wallets/${walletId}/tokens`),
    fetch(`${transactionEngineUrl}/api/v1/wallets/${walletId}/transactions`),
    fetch(`${transactionEngineUrl}/api/v1/wallets/${walletId}/pending-approvals`),
    fetch(`${transactionEngineUrl}/api/v1/wallets/${walletId}/positions`),
    fetch(`${transactionEngineUrl}/api/v1/wallets/${walletId}/escrows`),
    fetch(`${policyEngineUrl}/api/v1/wallets/${walletId}/policies`),
  ]);

  return {
    balance: balanceRes.ok ? (await balanceRes.json()) : { error: 'balance unavailable' },
    tokens: tokensRes.ok ? (await tokensRes.json()) : { error: 'tokens unavailable' },
    recentTransactions: txRes.ok ? (await txRes.json()) : { error: 'transactions unavailable' },
    openApprovals: approvalsRes.ok ? (await approvalsRes.json()) : { error: 'approvals unavailable' },
    protocolPositions: positionsRes.ok ? (await positionsRes.json()) : { error: 'positions unavailable' },
    escrowSummary: escrowsRes.ok ? (await escrowsRes.json()) : { error: 'escrows unavailable' },
    policySummary: policiesRes.ok ? (await policiesRes.json()) : { error: 'policies unavailable' },
  };
};

const getKnownWallets = (): string[] => Array.from(new Set(store.list().map((entry) => entry.walletId)));

const extractBalanceLamports = (walletContext: Record<string, unknown>): number => {
  const balance = walletContext['balance'];
  if (!balance || typeof balance !== 'object') {
    return 0;
  }

  const data = (balance as Record<string, unknown>)['data'];
  if (!data || typeof data !== 'object') {
    return 0;
  }

  const lamports = (data as Record<string, unknown>)['lamports'];
  const numeric = typeof lamports === 'number' ? lamports : Number(lamports ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
};

const getDecisionState = (agentId: string): DecisionState => {
  const existing = decisionStates.get(agentId);
  if (existing) {
    return existing;
  }

  const created = createDecisionState();
  decisionStates.set(agentId, created);
  return created;
};

const executeAgentIntent = async (
  agent: Agent,
  request: ExecuteAgentIntentRequest,
  source: 'api' | 'autonomy',
): Promise<{ status: number; payload: Record<string, unknown> }> => {
  if (agent.status === 'paused') {
    return {
      status: 409,
      payload: { error: `Agent is paused: ${agent.pausedReason ?? 'no reason supplied'}` },
    };
  }

  if (source === 'autonomy' && agent.status !== 'running') {
    return {
      status: 409,
      payload: { error: `Autonomy execution requires running status (current=${agent.status})` },
    };
  }

  if (!agent.allowedIntents.includes(request.type)) {
    return {
      status: 403,
      payload: { error: `Intent ${request.type} not permitted for this agent` },
    };
  }

  if (requireManifest && !agent.capabilityManifest) {
    return {
      status: 403,
      payload: { error: 'Capability manifest is required for this runtime' },
    };
  }

  if (agent.capabilityManifest) {
    const verify = verifyCapabilityManifest(agent.capabilityManifest, manifestSigningSecret);
    if (!verify.ok) {
      return { status: 403, payload: { error: verify.reason ?? 'Invalid capability manifest' } };
    }

    if (!manifestAllows(agent.capabilityManifest, request.type, request.protocol)) {
      return {
        status: 403,
        payload: { error: `Manifest denies intent ${request.type} on protocol ${request.protocol}` },
      };
    }
  }

  if (spendingTypes.has(request.type)) {
    if (requireBacktestPass) {
      const latestBacktest = strategyStore.getLatestBacktest(agent.walletId);
      if (!latestBacktest || !latestBacktest.passed) {
        return {
          status: 403,
          payload: {
            error: 'Backtest pass is required before live spend-capable execution on this runtime',
            data: latestBacktest,
          },
        };
      }
    }

    const lamports = inferLamports(request.intent);
    const budgetResult = budgetStore.spend(agent.id, lamports);
    if (!budgetResult.ok) {
      return {
        status: 403,
        payload: { error: budgetResult.reason ?? 'Budget check failed', data: budgetResult.budget },
      };
    }
  }

  if (request.intent['paperOnly'] === true) {
    const record = strategyStore.addPaperTrade({
      agentId: agent.id,
      walletId: agent.walletId,
      type: request.type,
      protocol: request.protocol,
      intent: request.intent,
    });
    return { status: 201, payload: { data: { mode: 'paper', record } } };
  }

  const txRes = await fetch(`${transactionEngineUrl}/api/v1/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      walletId: agent.walletId,
      agentId: agent.id,
      type: request.type,
      protocol: request.protocol,
      gasless: request.gasless ?? false,
      intent: {
        ...request.intent,
        ...(source === 'autonomy' ? { _executionSource: 'autonomy' } : {}),
      },
    }),
  });

  const payload = (await txRes.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: txRes.status, payload };
};

const buildAgentLoopContext = async (agentId: string, tick: number): Promise<Record<string, unknown>> => {
  const current = store.get(agentId);
  if (!current) {
    return {
      tick,
      walletId: null,
      knownWallets: getKnownWallets(),
      meta: {
        generatedAt: new Date().toISOString(),
        source: 'agent-runtime',
        error: 'agent no longer exists',
      },
    };
  }

  const knownWallets = getKnownWallets();
  const walletContext = await fetchWalletContext(current.walletId);
  const meta: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source: 'agent-runtime',
    executionMode: current.executionMode,
  };

  if (current.executionMode === 'autonomous' && current.status === 'running' && current.autonomy?.enabled) {
    const decision = decideAutonomousAction(
      current,
      {
        tick,
        walletId: current.walletId,
        knownWallets,
        balanceLamports: extractBalanceLamports(walletContext),
      },
      getDecisionState(current.id),
    );

    if (decision) {
      const execution = await executeAgentIntent(current, decision.request, 'autonomy');
      const wasSuccessful = execution.status >= 200 && execution.status < 300;
      if (wasSuccessful) {
        markDecisionExecuted(getDecisionState(current.id), decision);
      }

      meta['autonomy'] = {
        decision: {
          reason: decision.reason,
          source: decision.source,
          sourceId: decision.sourceId,
          request: decision.request,
        },
        execution: {
          status: execution.status,
          success: wasSuccessful,
          payload: execution.payload,
        },
      };
    }
  }

  return {
    tick,
    walletId: current.walletId,
    knownWallets,
    meta,
    ...walletContext,
  };
};

app.get('/health', (c) => c.json({ status: 'ok', service: 'agent-runtime' }));

app.post('/api/v1/agents', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createAgentRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const walletId = parsed.data.walletId ?? (await createWallet());
  const now = new Date().toISOString();

  const agent: Agent = {
    id: uuidv4(),
    name: parsed.data.name,
    walletId,
    status: 'stopped',
    executionMode: parsed.data.executionMode,
    allowedIntents: parsed.data.allowedIntents,
    ...(parsed.data.autonomy ? { autonomy: parsed.data.autonomy } : {}),
    ...(parsed.data.budgetLamports !== undefined ? { budgetLamports: parsed.data.budgetLamports } : {}),
    createdAt: now,
    updatedAt: now,
  };

  store.set(agent);
  if (parsed.data.budgetLamports !== undefined) {
    budgetStore.setBudget(agent.id, agent.walletId, parsed.data.budgetLamports);
  }
  return c.json({ data: agentSchema.parse(agent) }, 201);
});

app.get('/api/v1/agents', (c) => {
  return c.json({ data: store.list().map((agent) => agentSchema.parse(agent)) });
});

app.delete('/api/v1/agents', (c) => {
  const existing = store.list();
  for (const agent of existing) {
    scheduler.stop(agent.id);
  }

  store.clear();
  budgetStore.clear();
  strategyStore.clear();
  decisionStates.clear();

  return c.json({
    data: {
      cleared: true,
      removedAgents: existing.length,
    },
  });
});

app.get('/api/v1/agents/:agentId', (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ data: agentSchema.parse(agent), heartbeats: scheduler.getHeartbeats(agent.id) });
});

app.put('/api/v1/agents/:agentId/capabilities', async (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateAgentCapabilitiesSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const updated: Agent = {
    ...agent,
    allowedIntents: parsed.data.allowedIntents,
    ...(parsed.data.executionMode ? { executionMode: parsed.data.executionMode } : {}),
    ...(parsed.data.autonomy ? { autonomy: parsed.data.autonomy } : {}),
    ...(parsed.data.budgetLamports !== undefined ? { budgetLamports: parsed.data.budgetLamports } : {}),
    updatedAt: new Date().toISOString(),
  };

  store.set(updated);
  if (parsed.data.budgetLamports !== undefined) {
    budgetStore.setBudget(updated.id, updated.walletId, parsed.data.budgetLamports);
  }
  return c.json({ data: agentSchema.parse(updated) });
});

app.post('/api/v1/agents/:agentId/start', async (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const updated: Agent = { ...agent, status: 'running', updatedAt: new Date().toISOString() };
  store.set(updated);

  scheduler.start(updated.id, ({ tick }) => buildAgentLoopContext(updated.id, tick), loopIntervalMs);

  return c.json({ data: agentSchema.parse(updated) });
});

app.post('/api/v1/agents/:agentId/stop', (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  scheduler.stop(agent.id);
  const updated: Agent = { ...agent, status: 'stopped', updatedAt: new Date().toISOString() };
  store.set(updated);

  return c.json({ data: agentSchema.parse(updated) });
});

app.post('/api/v1/agents/:agentId/pause', async (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  if (pauseWebhookSecret) {
    const token = c.req.header('x-agent-runtime-secret') ?? '';
    if (token !== pauseWebhookSecret) {
      return c.json({ error: 'Forbidden: invalid pause webhook secret' }, 403);
    }
  }

  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason : 'paused by operator';

  scheduler.stop(agent.id);
  const updated: Agent = {
    ...agent,
    status: 'paused',
    pausedReason: reason,
    updatedAt: new Date().toISOString(),
  };
  store.set(updated);
  return c.json({ data: agentSchema.parse(updated) });
});

app.post('/api/v1/agents/:agentId/resume', (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const { pausedReason: _ignored, ...base } = agent;
  const updated: Agent = {
    ...base,
    status: 'running',
    updatedAt: new Date().toISOString(),
  };
  store.set(updated);
  scheduler.start(updated.id, ({ tick }) => buildAgentLoopContext(updated.id, tick), loopIntervalMs);
  return c.json({ data: agentSchema.parse(updated) });
});

app.get('/api/v1/agents/:agentId/budget', (c) => {
  const budget = budgetStore.get(c.req.param('agentId'));
  if (!budget) {
    return c.json({ data: null });
  }
  return c.json({ data: budget });
});

app.get('/api/v1/agents/:agentId/autonomy/state', (c) => {
  const agentId = c.req.param('agentId');
  const agent = store.get(agentId);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({
    data: {
      agentId,
      enabled: agent.autonomy?.enabled ?? false,
      mode: agent.autonomy?.mode ?? 'execute',
      state: decisionStates.get(agentId) ?? createDecisionState(),
    },
  });
});

app.post('/api/v1/agents/:agentId/manifest/issue', async (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = issueCapabilityManifestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const manifest = issueCapabilityManifest(
    {
      agentId: agent.id,
      allowedIntents: parsed.data.allowedIntents,
      allowedProtocols: parsed.data.allowedProtocols,
      ttlSeconds: parsed.data.ttlSeconds,
      issuer: manifestIssuer,
    },
    manifestSigningSecret,
  );

  const updated: Agent = {
    ...agent,
    capabilityManifest: manifest,
    updatedAt: new Date().toISOString(),
  };
  store.set(updated);
  return c.json({ data: capabilityManifestSchema.parse(manifest) });
});

app.post('/api/v1/agents/:agentId/manifest/verify', async (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const manifest = capabilityManifestSchema.parse(body.manifest ?? agent.capabilityManifest);
  const result = verifyCapabilityManifest(manifest, manifestSigningSecret);
  return c.json({ data: result });
});

app.post('/api/v1/treasury/allocate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = treasuryAllocationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const target = store.get(parsed.data.targetAgentId);
  if (!target) {
    return c.json({ error: 'Target agent not found' }, 404);
  }

  if (parsed.data.sourceAgentId) {
    const source = store.get(parsed.data.sourceAgentId);
    if (!source) {
      return c.json({ error: 'Source agent not found' }, 404);
    }

    if (!budgetStore.get(source.id)) {
      budgetStore.setBudget(source.id, source.walletId, source.budgetLamports ?? 0);
    }
    if (!budgetStore.get(target.id)) {
      budgetStore.setBudget(target.id, target.walletId, target.budgetLamports ?? 0);
    }
    const moved = budgetStore.transfer(source.id, target.id, parsed.data.lamports);
    return c.json({ data: moved });
  }

  const current = budgetStore.get(target.id);
  const nextLamports = (current?.budgetLamports ?? target.budgetLamports ?? 0) + parsed.data.lamports;
  const updated = budgetStore.setBudget(target.id, target.walletId, nextLamports);
  return c.json({ data: updated });
});

app.post('/api/v1/treasury/rebalance', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = treasuryRebalanceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const source = store.get(parsed.data.sourceAgentId);
  const target = store.get(parsed.data.targetAgentId);
  if (!source || !target) {
    return c.json({ error: 'Source or target agent not found' }, 404);
  }

  if (!budgetStore.get(source.id)) {
    budgetStore.setBudget(source.id, source.walletId, source.budgetLamports ?? 0);
  }
  if (!budgetStore.get(target.id)) {
    budgetStore.setBudget(target.id, target.walletId, target.budgetLamports ?? 0);
  }

  return c.json({ data: budgetStore.transfer(source.id, target.id, parsed.data.lamports) });
});

app.post('/api/v1/strategy/backtest', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = strategyBacktestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const result = strategyStore.runBacktest(parsed.data);
  return c.json({ data: result }, 201);
});

app.post('/api/v1/strategy/paper/execute', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = paperTradeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const agent = store.get(parsed.data.agentId);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const record = strategyStore.addPaperTrade(parsed.data);
  return c.json({ data: record }, 201);
});

app.get('/api/v1/strategy/paper/:agentId', (c) => {
  return c.json({ data: strategyStore.listPaperTrades(c.req.param('agentId')) });
});

app.post('/api/v1/agents/:agentId/execute', async (c) => {
  const agent = store.get(c.req.param('agentId'));
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = executeAgentIntentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const execution = await executeAgentIntent(agent, parsed.data, 'api');
  return new Response(JSON.stringify(execution.payload), {
    status: execution.status,
    headers: { 'content-type': 'application/json' },
  });
});

const port = Number(process.env.PORT ?? 3004);

serve({ fetch: app.fetch, port }, (info) => {
  console.log('agent-runtime listening on http://localhost:' + info.port);
});

export { app };
