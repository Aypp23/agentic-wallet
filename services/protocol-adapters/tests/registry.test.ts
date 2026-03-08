import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../src/registry.js';
import { createEscrowAdapter } from '../src/adapters/escrow.adapter.js';
import { createMarinadeAdapter } from '../src/adapters/marinade.adapter.js';
import { createMetaplexAdapter } from '../src/adapters/metaplex.adapter.js';
import { createOrcaAdapter } from '../src/adapters/orca.adapter.js';
import { createRaydiumAdapter } from '../src/adapters/raydium.adapter.js';
import { createSolendAdapter } from '../src/adapters/solend.adapter.js';
import { createSplTokenAdapter, createSystemAdapter } from '../src/adapters/system-spl.adapter.js';

vi.mock('../src/adapters/solend.adapter.js', () => ({
  createSolendAdapter: () => ({
    name: 'solend',
    version: '1.1.0',
    programIds: ['So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo'],
    capabilities: ['lend_supply', 'lend_borrow'],
  }),
}));

describe('AdapterRegistry', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('registers the full required protocol set', () => {
    const registry = new AdapterRegistry();

    registry.register(createSystemAdapter());
    registry.register(createSplTokenAdapter());
    registry.register(createMarinadeAdapter());
    registry.register(createSolendAdapter());
    registry.register(createMetaplexAdapter());
    registry.register(createOrcaAdapter());
    registry.register(createRaydiumAdapter());
    registry.register(createEscrowAdapter());

    const protocols = registry.list().map((adapter) => adapter.name);

    expect(protocols).toEqual(
      expect.arrayContaining([
        'system-program',
        'spl-token',
        'marinade',
        'solend',
        'metaplex',
        'orca',
        'raydium',
        'escrow',
      ]),
    );
  });

  it('supports escrow commerce intents including x402_pay', async () => {
    vi.stubEnv('ESCROW_PROGRAM_ID', '8xD9F8dP4yN3iG4MBXit4nB9hQn3ju8pGkJ2m8SLxPCv');
    const adapter = createEscrowAdapter();

    expect(adapter.capabilities).toEqual(expect.arrayContaining(['create_escrow', 'x402_pay']));

    const result = await adapter.buildIntent!('x402_pay', '11111111111111111111111111111111', {
      amount: '100',
      counterparty: '3ffYfeB4toVUhgEPKgEeSRqFbff5EXHHqNvxmW5p2r2G',
    });

    expect(result?.mode).toBe('instructions');
    expect(result?.programIds).toEqual(['8xD9F8dP4yN3iG4MBXit4nB9hQn3ju8pGkJ2m8SLxPCv']);
  });

  it('fails closed for escrow if program is not configured', async () => {
    const adapter = createEscrowAdapter();
    await expect(
      adapter.buildIntent!('create_escrow', '11111111111111111111111111111111', {
        amount: '1000',
        counterparty: '3ffYfeB4toVUhgEPKgEeSRqFbff5EXHHqNvxmW5p2r2G',
      }),
    ).rejects.toThrow('ESCROW_PROGRAM_ID');
  });

  it('checks compatibility and migrates intents', async () => {
    const registry = new AdapterRegistry();
    registry.register(createSystemAdapter());
    registry.registerMigration('system-program', {
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      migrate: (_type, intent) => ({
        ...intent,
        migrated: true,
      }),
    });

    expect(registry.checkCompatibility('system-program', '1.2.0').compatible).toBe(true);
    expect(registry.checkCompatibility('system-program', '2.0.0').compatible).toBe(false);

    const migrated = await registry.migrateIntent('system-program', {
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      type: 'transfer_sol',
      intent: {},
    });

    expect(migrated.migrationApplied).toBe(true);
    expect(migrated.intent).toMatchObject({ migrated: true });
  });
});
