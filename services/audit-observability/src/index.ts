import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
  auditEventSchema,
  createAuditEventRequestSchema,
  metricsIncrementRequestSchema,
  type AuditEvent,
} from '@agentic-wallet/common';
import { AuditStore } from './store/audit-store.js';
import { MetricsStore } from './store/metrics-store.js';

const app = new Hono();
const dataDir =
  process.env.AUDIT_OBSERVABILITY_DATA_DIR ?? path.join(process.cwd(), 'services', 'audit-observability', 'data');
const auditStore = new AuditStore(path.join(dataDir, 'audit-events.json'));
const metricsStore = new MetricsStore(path.join(dataDir, 'metrics.json'));

app.get('/health', (c) => c.json({ status: 'ok', service: 'audit-observability' }));

app.post('/api/v1/audit/events', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createAuditEventRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const event: AuditEvent = auditEventSchema.parse({
    ...parsed.data,
    id: uuidv4(),
    timestamp: new Date().toISOString(),
  });

  auditStore.add(event);
  metricsStore.increment(`audit_event.${event.eventType}`);

  return c.json({ data: event }, 201);
});

app.get('/api/v1/audit/events', (c) => {
  const txId = c.req.query('txId');
  const agentId = c.req.query('agentId');
  const walletId = c.req.query('walletId');
  const protocol = c.req.query('protocol');
  const escrowId = c.req.query('escrowId');

  const events = auditStore.list({
    ...(txId ? { txId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(walletId ? { walletId } : {}),
    ...(protocol ? { protocol } : {}),
    ...(escrowId ? { escrowId } : {}),
  });

  return c.json({ data: events });
});

app.post('/api/v1/metrics/inc', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = metricsIncrementRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const value = metricsStore.increment(parsed.data.name, parsed.data.value);
  return c.json({ data: { name: parsed.data.name, value } });
});

app.get('/api/v1/metrics', (c) => {
  return c.json({ data: metricsStore.snapshot() });
});

const port = Number(process.env.PORT ?? 3007);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`audit-observability listening on http://localhost:${info.port}`);
});

export { app };
