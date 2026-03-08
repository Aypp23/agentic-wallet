#!/usr/bin/env node
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';

const root = process.cwd();
const run = (cmd, args, env = process.env) =>
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });

const get = (cmd, args) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const parsePrivateKey = (raw) => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error('PRIVATE_KEY JSON format must be an array');
    return Uint8Array.from(arr.map((n) => Number(n)));
  }
  return bs58.decode(trimmed);
};

const updateEnvEscrowProgramId = (programId) => {
  const envPath = path.join(root, '.env');
  let content = '';
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    // file may not exist
  }

  if (!content.includes('ESCROW_PROGRAM_ID=')) {
    content = `${content.trim()}\nESCROW_PROGRAM_ID=${programId}\n`;
  } else {
    content = content.replace(/ESCROW_PROGRAM_ID=.*/g, `ESCROW_PROGRAM_ID=${programId}`);
  }

  writeFileSync(envPath, content, 'utf8');
};

const main = async () => {
  const privateKeyRaw = process.env.PRIVATE_KEY;
  if (!privateKeyRaw) {
    throw new Error('PRIVATE_KEY is required in .env to deploy escrow program');
  }

  const deployerSecret = parsePrivateKey(privateKeyRaw);
  const deployerPath = path.join(os.tmpdir(), 'agentic-wallet-escrow-deployer.json');
  writeFileSync(deployerPath, JSON.stringify(Array.from(deployerSecret)), 'utf8');

  const syncOutput = get('node', ['scripts/escrow-sync-program-id.mjs']);
  const synced = JSON.parse(syncOutput);

  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

  run('solana', ['config', 'set', '--url', rpcUrl, '--keypair', deployerPath]);

  run('anchor', ['build']);
  run('anchor', ['deploy', '--provider.cluster', 'devnet', '--provider.wallet', deployerPath]);

  const deployedProgramId = get('solana', ['address', '-k', synced.keypairPath]);

  updateEnvEscrowProgramId(deployedProgramId);

  console.log('\nEscrow program deployed to devnet.');
  console.log(`ESCROW_PROGRAM_ID=${deployedProgramId}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
