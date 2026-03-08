import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { WalletEngineConfig } from '../src/config.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0, dirs.length).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('wallet-engine app', () => {
  it('creates and reads wallet metadata', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'wallet-engine-test-'));
    dirs.push(dataDir);

    const config: WalletEngineConfig = {
      port: 0,
      solanaRpcUrl: 'https://api.devnet.solana.com',
      encryptionSecret: 'test-secret',
      dataDir,
      signerBackend: 'encrypted-file',
      mpcNodeSecrets: [],
      autoFundDefaultLamports: 2_000_000,
    };

    const app = createApp(config);

    const createRes = await app.request('/api/v1/wallets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'agent-1' }),
    });

    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const getRes = await app.request(`/api/v1/wallets/${created.data.id}`);
    expect(getRes.status).toBe(200);

    const fetched = await getRes.json();
    expect(fetched.data.id).toBe(created.data.id);
    expect(fetched.data.publicKey).toBeTypeOf('string');
  });

  it('rejects auto-fund create when payer key is not configured', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'wallet-engine-test-'));
    dirs.push(dataDir);

    const config: WalletEngineConfig = {
      port: 0,
      solanaRpcUrl: 'https://api.devnet.solana.com',
      encryptionSecret: 'test-secret',
      dataDir,
      signerBackend: 'encrypted-file',
      mpcNodeSecrets: [],
      autoFundDefaultLamports: 2_000_000,
    };

    const app = createApp(config);

    const createRes = await app.request('/api/v1/wallets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'agent-auto-fund', autoFund: true }),
    });

    expect(createRes.status).toBe(400);

    const listRes = await app.request('/api/v1/wallets');
    expect(listRes.status).toBe(200);
    const listed = await listRes.json();
    expect(Array.isArray(listed.data)).toBe(true);
    expect(listed.data.length).toBe(0);
  });
});
