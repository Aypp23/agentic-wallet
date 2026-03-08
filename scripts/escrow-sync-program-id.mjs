#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const defaultKeypairPath = path.join(root, 'target', 'deploy', 'escrow-keypair.json');
const legacyKeypairPath = path.join(root, 'programs', 'escrow', 'target', 'deploy', 'escrow-keypair.json');
const keypairPath = process.env.ESCROW_PROGRAM_KEYPAIR
  ? path.resolve(process.env.ESCROW_PROGRAM_KEYPAIR)
  : existsSync(defaultKeypairPath)
    ? defaultKeypairPath
    : existsSync(legacyKeypairPath)
      ? legacyKeypairPath
      : defaultKeypairPath;
const libPath = path.join(root, 'programs', 'escrow', 'src', 'lib.rs');
const anchorTomlPath = path.join(root, 'Anchor.toml');

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

mkdirSync(path.dirname(keypairPath), { recursive: true });

if (!existsSync(keypairPath)) {
  execFileSync(
    'solana-keygen',
    ['new', '--no-bip39-passphrase', '--silent', '--force', '-o', keypairPath],
    { stdio: 'inherit' },
  );
}

const programId = run('solana', ['address', '-k', keypairPath]);

if (!existsSync(libPath)) {
  throw new Error(`Missing ${libPath}`);
}

const lib = readFileSync(libPath, 'utf8');
const nextLib = lib.replace(/declare_id!\("[A-Za-z0-9]{32,44}"\);/, `declare_id!("${programId}");`);
if (nextLib !== lib) {
  writeFileSync(libPath, nextLib, 'utf8');
}

if (existsSync(anchorTomlPath)) {
  const anchorToml = readFileSync(anchorTomlPath, 'utf8');
  const nextAnchor = anchorToml
    .replace(/(\[programs\.localnet\][\s\S]*?escrow\s*=\s*")([A-Za-z0-9]{32,44})(")/, `$1${programId}$3`)
    .replace(/(\[programs\.devnet\][\s\S]*?escrow\s*=\s*")([A-Za-z0-9]{32,44})(")/, `$1${programId}$3`);
  if (nextAnchor !== anchorToml) {
    writeFileSync(anchorTomlPath, nextAnchor, 'utf8');
  }
}

console.log(JSON.stringify({ programId, keypairPath }, null, 2));
