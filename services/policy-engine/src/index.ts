import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import path from 'node:path';
import {
  createPolicyRequestSchema,
  policyRuleSchema,
  policyEvaluationRequestSchema,
  policySchema,
  updatePolicyRequestSchema,
  type Policy,
} from '@agentic-wallet/common';
import { v4 as uuidv4 } from 'uuid';
import { PolicyStore } from './store/policy-store.js';
import { PolicyEvaluator } from './engine/policy-evaluator.js';

const app = new Hono();
const dataDir = process.env.POLICY_ENGINE_DATA_DIR ?? path.join(process.cwd(), 'services', 'policy-engine', 'data');
const store = new PolicyStore(path.join(dataDir, 'policies.json'));
const evaluator = new PolicyEvaluator(path.join(dataDir, 'policy-evaluator-state.json'));
const supportedRuleTypes = new Set<string>([
  'spending_limit',
  'address_allowlist',
  'address_blocklist',
  'program_allowlist',
  'token_allowlist',
  'protocol_allowlist',
  'rate_limit',
  'time_window',
  'max_slippage',
  'protocol_risk',
  'portfolio_risk',
]);

app.get('/health', (c) => c.json({ status: 'ok', service: 'policy-engine' }));

app.post('/api/v1/policies', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createPolicyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const now = new Date().toISOString();
  const policy: Policy = {
    id: uuidv4(),
    walletId: parsed.data.walletId,
    name: parsed.data.name,
    version: 1,
    active: parsed.data.active,
    rules: parsed.data.rules,
    createdAt: now,
    updatedAt: now,
  };

  store.upsert(policy);
  return c.json({ data: policySchema.parse(policy) }, 201);
});

app.put('/api/v1/policies/:policyId', async (c) => {
  const policyId = c.req.param('policyId');
  const existing = store.getById(policyId);

  if (!existing) {
    return c.json({ error: 'Policy not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updatePolicyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const next: Policy = {
    ...existing,
    ...(parsed.data.name ? { name: parsed.data.name } : {}),
    ...(parsed.data.rules ? { rules: parsed.data.rules } : {}),
    ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  };

  store.upsert(next);
  return c.json({ data: policySchema.parse(next) });
});

app.get('/api/v1/wallets/:walletId/policies', async (c) => {
  const walletId = c.req.param('walletId');
  return c.json({ data: store.listByWallet(walletId).map((policy) => policySchema.parse(policy)) });
});

app.get('/api/v1/policies/:policyId/versions', (c) => {
  const versions = store.listVersions(c.req.param('policyId'));
  if (versions.length === 0) {
    return c.json({ error: 'Policy not found' }, 404);
  }
  return c.json({ data: versions.map((policy) => policySchema.parse(policy)) });
});

app.get('/api/v1/policies/:policyId/versions/:version', (c) => {
  const version = Number(c.req.param('version'));
  if (!Number.isFinite(version)) {
    return c.json({ error: 'Invalid version' }, 400);
  }
  const policy = store.getVersion(c.req.param('policyId'), version);
  if (!policy) {
    return c.json({ error: 'Policy version not found' }, 404);
  }
  return c.json({ data: policySchema.parse(policy) });
});

app.post('/api/v1/policies/compatibility-check', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { rules?: unknown[] };
  const rules: unknown[] = Array.isArray(body.rules) ? body.rules : [];

  const unsupported = rules
    .map((rule: unknown) =>
      typeof rule === 'object' && rule !== null && 'type' in rule
        ? String((rule as { type?: unknown }).type ?? 'unknown')
        : 'unknown',
    )
    .filter((type: string) => !supportedRuleTypes.has(type));

  return c.json({
    data: {
      compatible: unsupported.length === 0,
      supportedRuleTypes: [...supportedRuleTypes],
      unsupportedRuleTypes: unsupported,
    },
  });
});

app.post('/api/v1/policies/:policyId/migrate', async (c) => {
  const policy = store.getById(c.req.param('policyId'));
  if (!policy) {
    return c.json({ error: 'Policy not found' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const targetVersion = Number(body.targetVersion);
  if (!Number.isFinite(targetVersion) || targetVersion <= policy.version) {
    return c.json({ error: 'targetVersion must be greater than current policy version' }, 400);
  }

  const migrationMode = String(body.mode ?? 'normalize');
  let nextRules = [...policy.rules];

  if (migrationMode === 'add_default_risk_rules') {
    const hasProtocolRisk = nextRules.some((rule) => rule.type === 'protocol_risk');
    const hasPortfolioRisk = nextRules.some((rule) => rule.type === 'portfolio_risk');
    if (!hasProtocolRisk) {
      nextRules = [
        ...nextRules,
        {
          type: 'protocol_risk',
          protocol: 'jupiter',
          maxSlippageBps: 200,
          oracleDeviationBps: 500,
        },
      ];
    }
    if (!hasPortfolioRisk) {
      nextRules = [
        ...nextRules,
        {
          type: 'portfolio_risk',
          maxDailyLossLamports: 2_000_000_000,
          maxExposureBpsPerProtocol: 6000,
        },
      ];
    }
  }

  const validatedRules = nextRules.map((rule) => policyRuleSchema.parse(rule));

  const migrated: Policy = {
    ...policy,
    version: Math.trunc(targetVersion),
    rules: validatedRules,
    updatedAt: new Date().toISOString(),
  };

  store.upsert(migrated);
  return c.json({
    data: policySchema.parse(migrated),
    migration: {
      mode: migrationMode,
      fromVersion: policy.version,
      toVersion: migrated.version,
    },
  });
});

app.post('/api/v1/evaluate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = policyEvaluationRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const policies = store.getActiveForWallet(parsed.data.walletId);
  const decision = evaluator.evaluate(parsed.data, policies);
  return c.json({ data: decision });
});

const port = Number(process.env.PORT ?? 3003);

serve({ fetch: app.fetch, port }, (info) => {
  console.log('policy-engine listening on http://localhost:' + info.port);
});

export { app };
