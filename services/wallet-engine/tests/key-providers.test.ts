import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createKeyProvider } from '../src/key-provider/factory.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })));
});

const withTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wallet-key-provider-test-'));
  tempDirs.push(dir);
  return dir;
};

describe('key-provider backends', () => {
  it('supports kms backend', async () => {
    const dir = await withTempDir();
    const provider = createKeyProvider({
      backend: 'kms',
      keysDir: dir,
      encryptionSecret: 'unused',
      kmsMasterSecret: 'kms-master-secret',
      kmsKeyId: 'unit-test-key',
    });

    const keypair = Keypair.generate();
    await provider.save('wallet-kms', keypair);
    const loaded = await provider.load('wallet-kms');

    expect(loaded.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
    expect(provider.provenance().backend).toBe('kms');
  });

  it('supports hsm backend', async () => {
    const dir = await withTempDir();
    const provider = createKeyProvider({
      backend: 'hsm',
      keysDir: dir,
      encryptionSecret: 'unused',
      hsmSlotId: 'slot-42',
      hsmPin: '123456',
      hsmModuleSecret: 'module-secret',
    });

    const keypair = Keypair.generate();
    await provider.save('wallet-hsm', keypair);
    const loaded = await provider.load('wallet-hsm');

    expect(loaded.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
    expect(provider.provenance().backend).toBe('hsm');
  });

  it('supports mpc backend', async () => {
    const dir = await withTempDir();
    const provider = createKeyProvider({
      backend: 'mpc',
      keysDir: dir,
      encryptionSecret: 'unused',
      mpcNodeSecrets: ['node-1-secret', 'node-2-secret', 'node-3-secret'],
    });

    const keypair = Keypair.generate();
    await provider.save('wallet-mpc', keypair);
    const loaded = await provider.load('wallet-mpc');

    expect(loaded.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
    expect(provider.provenance().backend).toBe('mpc');
  });
});

