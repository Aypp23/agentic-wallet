import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index.js';

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('mcp-server tools', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supports gateway.request with validated /api/v1 path + query', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse({ data: { ok: true, source: 'gateway' } }));

    const response = await app.request('/mcp/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'gateway.request',
        args: {
          path: '/api/v1/metrics',
          method: 'GET',
          query: { name: 'tx.confirmed' },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual({ ok: true, source: 'gateway' });

    const [calledUrl] = fetchMock.mock.calls[0] ?? [];
    expect(String(calledUrl)).toContain('/api/v1/metrics?name=tx.confirmed');
  });

  it('rejects gateway.request outside /api/v1 schema', async () => {
    const response = await app.request('/mcp/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tool: 'gateway.request',
        args: {
          path: '/mcp/tools',
          method: 'GET',
        },
      }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBeDefined();
  });
});
