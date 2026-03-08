import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

interface ApiKeyConfig {
  tenant: string;
  scopes: Set<string>;
}

interface RateLimitState {
  windowStart: number;
  count: number;
}

type StandardErrorCode =
  | 'VALIDATION_ERROR'
  | 'POLICY_VIOLATION'
  | 'PIPELINE_ERROR'
  | 'CONFIRMATION_FAILED';

type PipelineStage = 'validation' | 'policy' | 'build' | 'sign' | 'send' | 'confirm' | 'completed' | 'gateway';

const allowedErrorCodes = new Set<StandardErrorCode>([
  'VALIDATION_ERROR',
  'POLICY_VIOLATION',
  'PIPELINE_ERROR',
  'CONFIRMATION_FAILED',
]);

const txStageMap: Record<string, PipelineStage> = {
  pending: 'build',
  simulating: 'build',
  policy_eval: 'policy',
  approval_gate: 'policy',
  signing: 'sign',
  submitting: 'send',
  confirmed: 'confirm',
};

const app = new Hono();

const walletEngineUrl = process.env.WALLET_ENGINE_URL ?? 'http://localhost:3002';
const policyEngineUrl = process.env.POLICY_ENGINE_URL ?? 'http://localhost:3003';
const agentRuntimeUrl = process.env.AGENT_RUNTIME_URL ?? 'http://localhost:3004';
const protocolAdaptersUrl = process.env.PROTOCOL_ADAPTERS_URL ?? 'http://localhost:3005';
const transactionEngineUrl = process.env.TRANSACTION_ENGINE_URL ?? 'http://localhost:3006';
const auditObservabilityUrl = process.env.AUDIT_OBSERVABILITY_URL ?? 'http://localhost:3007';
const mcpServerUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:3008';

const enforceAuth = (process.env.API_GATEWAY_ENFORCE_AUTH ?? 'true') === 'true';
const rateLimitPerMinute = Number(process.env.API_GATEWAY_RATE_LIMIT_PER_MINUTE ?? 120);

const parseApiKeys = (raw: string): Map<string, ApiKeyConfig> => {
  const out = new Map<string, ApiKeyConfig>();

  for (const entry of raw.split(';').map((chunk) => chunk.trim()).filter(Boolean)) {
    const [key, tenant = '*', scopesCsv = 'all'] = entry.split(':');
    if (!key) continue;
    out.set(key, {
      tenant,
      scopes: new Set(scopesCsv.split(',').map((scope) => scope.trim()).filter(Boolean)),
    });
  }

  return out;
};

const apiKeys = parseApiKeys(
  process.env.API_GATEWAY_API_KEYS ??
    'dev-api-key:*:all',
);

const rateLimits = new Map<string, RateLimitState>();

const resolveScope = (path: string): string => {
  if (/^\/api\/v1\/wallets\/[^/]+\/policies/.test(path)) return 'policies';
  if (
    /^\/api\/v1\/wallets\/[^/]+\/(transactions|pending-approvals|positions|escrows)/.test(path)
  ) {
    return 'transactions';
  }
  if (path.startsWith('/api/v1/wallets')) return 'wallets';
  if (path.startsWith('/api/v1/transactions')) return 'transactions';
  if (path.startsWith('/api/v1/policies') || path.startsWith('/api/v1/evaluate')) return 'policies';
  if (path.startsWith('/api/v1/agents')) return 'agents';
  if (
    path.startsWith('/api/v1/protocols') ||
    path.startsWith('/api/v1/defi') ||
    path.startsWith('/api/v1/build') ||
    path.startsWith('/api/v1/escrow')
  ) {
    return 'protocols';
  }
  if (path.startsWith('/api/v1/risk') || path.startsWith('/api/v1/chaos')) return 'risk';
  if (path.startsWith('/api/v1/strategy')) return 'strategy';
  if (path.startsWith('/api/v1/treasury')) return 'treasury';
  if (path.startsWith('/api/v1/audit') || path.startsWith('/api/v1/metrics')) return 'audit';
  if (path.startsWith('/mcp')) return 'mcp';
  return 'unknown';
};

const getPathWithQuery = (url: string, path: string): string => {
  const parsed = new URL(url);
  return `${path}${parsed.search}`;
};

const resolveTraceId = (req: Request): string => {
  const existing = req.headers.get('x-trace-id')?.trim();
  return existing && existing.length > 0 ? existing : randomUUID();
};

const normalizeStage = (value: unknown): PipelineStage | null => {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (
    normalized === 'validation' ||
    normalized === 'policy' ||
    normalized === 'build' ||
    normalized === 'sign' ||
    normalized === 'send' ||
    normalized === 'confirm' ||
    normalized === 'completed' ||
    normalized === 'gateway'
  ) {
    return normalized;
  }

  return txStageMap[normalized] ?? null;
};

const extractErrorMessage = (payload: Record<string, unknown>): string | null => {
  if (typeof payload.errorMessage === 'string' && payload.errorMessage.trim().length > 0) {
    return payload.errorMessage;
  }

  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return payload.error;
  }

  if (payload.error && typeof payload.error === 'object') {
    return 'Request failed';
  }

  return null;
};

const inferErrorCode = (
  payload: Record<string, unknown>,
  status: number,
  fallbackMessage: string,
): StandardErrorCode => {
  const payloadErrorCode = payload.errorCode;
  if (typeof payloadErrorCode === 'string' && allowedErrorCodes.has(payloadErrorCode as StandardErrorCode)) {
    return payloadErrorCode as StandardErrorCode;
  }

  const message = fallbackMessage.toLowerCase();

  if (status === 400 || message.includes('validation') || message.includes('invalid') || message.includes('zod')) {
    return 'VALIDATION_ERROR';
  }

  if (
    status === 403 ||
    message.includes('policy') ||
    message.includes('manifest denies') ||
    message.includes('not permitted') ||
    message.includes('allowlist') ||
    message.includes('budget')
  ) {
    return 'POLICY_VIOLATION';
  }

  if (message.includes('confirm') || message.includes('confirmation')) {
    return 'CONFIRMATION_FAILED';
  }

  return 'PIPELINE_ERROR';
};

const inferStageFromErrorCode = (errorCode: StandardErrorCode): PipelineStage => {
  if (errorCode === 'VALIDATION_ERROR') return 'validation';
  if (errorCode === 'POLICY_VIOLATION') return 'policy';
  if (errorCode === 'CONFIRMATION_FAILED') return 'confirm';
  return 'build';
};

const normalizeProxyResponse = async (upstream: Response, req: Request): Promise<Response> => {
  const traceId = resolveTraceId(req);
  const contentType = upstream.headers.get('content-type') ?? '';

  let payload: Record<string, unknown> = {};
  if (contentType.includes('application/json')) {
    payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const text = await upstream.text().catch(() => '');
    payload = text ? { error: text } : {};
  }

  const dataStatus =
    payload.data && typeof payload.data === 'object' && payload.data !== null && 'status' in payload.data
      ? (payload.data as Record<string, unknown>).status
      : null;
  const isDataFailure = dataStatus === 'failed';
  const isFailure = !upstream.ok || isDataFailure;

  const message = extractErrorMessage(payload) ?? `Request failed (${upstream.status})`;
  const errorCode = isFailure ? inferErrorCode(payload, upstream.status, message) : null;
  const detectedStage =
    normalizeStage(payload.failedAt) ??
    normalizeStage(payload.stage) ??
    normalizeStage(dataStatus) ??
    (errorCode ? inferStageFromErrorCode(errorCode) : 'completed');

  const normalized = {
    ...payload,
    status: isFailure ? 'failure' : 'success',
    errorCode,
    failedAt: isFailure ? detectedStage : null,
    stage: detectedStage,
    traceId,
    ...(isFailure && typeof payload.errorMessage !== 'string' ? { errorMessage: message } : {}),
    ...(isFailure && typeof payload.error !== 'string' ? { error: message } : {}),
  };

  return new Response(JSON.stringify(normalized), {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
};

const machineErrorResponse = (
  req: Request,
  statusCode: number,
  message: string,
  stage: PipelineStage,
  errorCode: StandardErrorCode,
): Response => {
  return new Response(
    JSON.stringify({
      status: 'failure',
      errorCode,
      failedAt: stage,
      stage,
      traceId: resolveTraceId(req),
      error: message,
      errorMessage: message,
    }),
    {
      status: statusCode,
      headers: { 'content-type': 'application/json' },
    },
  );
};

const proxy = async (
  targetBase: string,
  pathWithQuery: string,
  req: Request,
  options?: { passthrough?: boolean },
): Promise<Response> => {
  const headers = new Headers(req.headers);
  headers.delete('host');

  const init: RequestInit = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(`${targetBase}${pathWithQuery}`, init);
  if (options?.passthrough) {
    return upstream;
  }

  return normalizeProxyResponse(upstream, req);
};

app.use('/api/*', async (c, next) => {
  const scope = resolveScope(c.req.path);
  const apiKey = c.req.header('x-api-key') ?? '';
  const tenant = c.req.header('x-tenant-id') ?? '';

  if (enforceAuth) {
    const keyConfig = apiKeys.get(apiKey);
    if (!keyConfig) {
      return machineErrorResponse(
        c.req.raw,
        401,
        'Unauthorized: missing or invalid x-api-key',
        'gateway',
        'PIPELINE_ERROR',
      );
    }

    if (keyConfig.tenant !== '*' && tenant && keyConfig.tenant !== tenant) {
      return machineErrorResponse(
        c.req.raw,
        403,
        'Forbidden: tenant scope mismatch',
        'gateway',
        'PIPELINE_ERROR',
      );
    }

    if (!keyConfig.scopes.has('all') && !keyConfig.scopes.has(scope)) {
      return machineErrorResponse(
        c.req.raw,
        403,
        `Forbidden: missing scope ${scope}`,
        'gateway',
        'PIPELINE_ERROR',
      );
    }
  }

  const now = Date.now();
  const state = rateLimits.get(apiKey) ?? { windowStart: now, count: 0 };
  if (now - state.windowStart > 60_000) {
    state.windowStart = now;
    state.count = 0;
  }

  state.count += 1;
  rateLimits.set(apiKey, state);

  if (state.count > rateLimitPerMinute) {
    return machineErrorResponse(c.req.raw, 429, 'Too Many Requests', 'gateway', 'PIPELINE_ERROR');
  }

  await next();
});

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'api-gateway',
    auth: {
      enforceAuth,
      configuredKeys: apiKeys.size,
      rateLimitPerMinute,
    },
    routes: {
      walletEngineUrl,
      policyEngineUrl,
      agentRuntimeUrl,
      protocolAdaptersUrl,
      transactionEngineUrl,
      auditObservabilityUrl,
      mcpServerUrl,
    },
  }),
);

app.all('/api/v1/wallets/:walletId/policies', async (c) =>
  proxy(policyEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw),
);
app.all('/api/v1/wallets/:walletId/transactions', async (c) =>
  proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw),
);
app.all('/api/v1/wallets/:walletId/pending-approvals', async (c) =>
  proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw),
);
app.all('/api/v1/wallets/:walletId/positions', async (c) =>
  proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw),
);
app.all('/api/v1/wallets/:walletId/escrows', async (c) =>
  proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw),
);

app.all('/api/v1/wallets/*', async (c) => proxy(walletEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/wallets', async (c) => proxy(walletEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));

app.all('/api/v1/transactions/*', async (c) => proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/transactions', async (c) => proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/risk/*', async (c) => proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/risk', async (c) => proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/chaos/*', async (c) => proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/chaos', async (c) => proxy(transactionEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));

app.all('/api/v1/policies/*', async (c) => proxy(policyEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/policies', async (c) => proxy(policyEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/evaluate', async (c) => proxy(policyEngineUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));

app.all('/api/v1/agents/*', async (c) => proxy(agentRuntimeUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/agents', async (c) => proxy(agentRuntimeUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/strategy/*', async (c) => proxy(agentRuntimeUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/strategy', async (c) => proxy(agentRuntimeUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/treasury/*', async (c) => proxy(agentRuntimeUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/treasury', async (c) => proxy(agentRuntimeUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));

app.all('/api/v1/protocols/*', async (c) => proxy(protocolAdaptersUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/protocols', async (c) => proxy(protocolAdaptersUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/defi/*', async (c) => proxy(protocolAdaptersUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/defi', async (c) => proxy(protocolAdaptersUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/build', async (c) => proxy(protocolAdaptersUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/escrow/*', async (c) => proxy(protocolAdaptersUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/escrow', async (c) => proxy(protocolAdaptersUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));

app.all('/api/v1/audit/*', async (c) => proxy(auditObservabilityUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/audit', async (c) => proxy(auditObservabilityUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/metrics/*', async (c) => proxy(auditObservabilityUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/api/v1/metrics', async (c) => proxy(auditObservabilityUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw));
app.all('/mcp/*', async (c) =>
  proxy(mcpServerUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw, { passthrough: true }),
);
app.all('/mcp', async (c) =>
  proxy(mcpServerUrl, getPathWithQuery(c.req.url, c.req.path), c.req.raw, { passthrough: true }),
);

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api-gateway listening on http://localhost:${info.port}`);
});

export { app };
