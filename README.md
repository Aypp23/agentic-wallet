# Agentic Wallet (Solana Devnet)

Autonomous wallet infrastructure for AI agents.

This repo ships a working multi-service prototype that lets agents emit intents while the platform handles validation, policy checks, signing boundaries, protocol interaction, submission, and audit proofs.

## Contents

- [What It Does](#what-it-does)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Kora Gasless Guide](#kora-gasless-guide)
- [Escrow Program (Anchor)](#escrow-program-anchor)
- [CLI Quick Use](#cli-quick-use)
- [Agent Integration](#agent-integration)
- [Validation and Demo](#validation-and-demo)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Further Docs](#further-docs)

## What It Does

- Programmatic wallet creation and custody
- Automatic transaction signing through wallet-engine (agents do not hold keys)
- SOL/SPL balance and transfer support
- Intent pipeline:
  - `pending -> simulating -> policy_eval -> approval_gate -> signing -> submitting -> confirmed/failed`
- Protocol adapters:
  - `system-program`, `spl-token`, `jupiter`, `marinade`, `solend`, `metaplex`, `orca`, `raydium`, `escrow`
- Agent runtime:
  - create/start/stop/pause/resume agents
  - capability allowlists (intents/protocols)
  - autonomous/supervised modes
- Risk and safety controls:
  - spending/rate limits, protocol + portfolio risk controls, delta guard
- Proof and observability:
  - proof artifacts (`intentHash`, `policyHash`, `simulationHash`, `proofHash`), audit events, metrics

## Architecture

```text
Agent / CLI / SDK / MCP
          |
          v
   API Gateway (auth, rate limit, normalized errors)
          |
          v
Transaction Engine
  -> build + simulate
  -> policy evaluation / approval gate
  -> wallet-engine signing boundary
  -> submit + confirm
  -> proof + audit + metrics
          |
          v
Solana RPC / Protocol Programs / Kora (optional gasless)
```

### Services

| Service | Port | Role |
|---|---:|---|
| `apps/api-gateway` | 3000 | auth, scope, routing, response envelope |
| `services/wallet-engine` | 3002 | wallet creation, key custody, signing |
| `services/policy-engine` | 3003 | allow/deny/require_approval |
| `services/agent-runtime` | 3004 | agent lifecycle, capability checks |
| `services/protocol-adapters` | 3005 | protocol quote/build adapters |
| `services/transaction-engine` | 3006 | tx lifecycle, proofs, outbox |
| `services/audit-observability` | 3007 | audit + metrics |
| `services/mcp-server` | 3008 | MCP tools + gateway proxy |

## Quick Start

### Prerequisites

- Node.js `>= 20`
- npm `>= 10`
- Solana CLI `>= 1.18` (devnet funding/deploy tasks)
- Anchor CLI `>= 0.31` (escrow program)

### Install

```bash
npm install
cp .env.example .env
```

Minimum env for local stack:

- `WALLET_KEY_ENCRYPTION_SECRET`
- `API_GATEWAY_API_KEYS` (default dev key is already set in `.env.example`)

Optional devnet funding variables:

- `PRIVATE_KEY`
- `WALLET_AUTOFUND_PAYER_PRIVATE_KEY`

### Start stack

```bash
set -a; source .env; set +a
npm run dev
```

### Health checks

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3006/health
curl -s http://localhost:3005/health
```

## Kora Gasless Guide

Kora is optional. If `gasless=true`, transaction-engine routes submission through Kora RPC (`KORA_RPC_URL`) instead of direct Solana submission.

### Why Kora warnings appear in dev

You may see warnings like:

- `price_source = Mock`
- `price.type = free`
- no auth configured

This is intentional for local/dev convenience:

- `Mock` price source means fee pricing is not market-derived.
- `free` means relays are sponsored with no token fee collection.
- no auth means any caller with network access can hit Kora.

This is fine for localhost testing, not fine for internet-exposed production.

### Config files used here

- Kora config: [`infrastructure/kora/kora.toml`](./infrastructure/kora/kora.toml)
- Signer pool: [`infrastructure/kora/signers.toml`](./infrastructure/kora/signers.toml)

### Env used by Kora flow

- `KORA_RPC_URL` (default `http://localhost:8080`)
- `KORA_PRIVATE_KEY` (optional)
- `PRIVATE_KEY` (fallback used by npm scripts if `KORA_PRIVATE_KEY` is not set)

### Kora commands

```bash
npm run kora:validate
npm run kora:validate:rpc
npm run kora:start
```

### Gasless transaction command

```bash
npm run cli -- tx create --wallet-id <walletId> --type transfer_sol --protocol system-program --intent '{"destination":"<toPubkey>","lamports":100000}' --gasless
```

### Gasless internals in this repo

When `gasless=true`, transaction-engine now:

1. fetches Kora payer signer (`getPayerSigner`)
2. builds tx with Kora signer as fee payer
3. fetches blockhash from Kora (`getBlockhash`) for compatibility
4. signs user side in wallet-engine (partial signature boundary)
5. submits via `signAndSendTransaction`
6. handles Kora response variants, including responses without explicit `signature`

### Current gasless support notes

- Works well for locally-built intent tx (for example `transfer_sol`, `transfer_spl`, instruction-built paths).
- For adapter-provided **prebuilt versioned transactions**, gasless is explicitly blocked with a clear error (use non-gasless for those paths until adapter-side gasless-aware build support is added).

### Production hardening checklist for Kora

- Set `price_source` to a real source (for example `Jupiter` where appropriate)
- Use non-free pricing (`margin` or `fixed`) in `[validation.price]`
- Enable authentication in `[kora.auth]` (`api_key` or `hmac_secret`)
- Restrict network exposure (private subnet / firewall / mTLS gateway)
- Keep allowlists minimal (`allowed_programs`, `allowed_tokens`)
- Monitor payer balances and relay usage metrics

## Escrow Program (Anchor)

Escrow is backed by a real on-chain Anchor program in [`programs/escrow`](./programs/escrow/README.md).

```bash
npm run escrow:build
npm run escrow:deploy:devnet
```

After deploy, set/update:

- `ESCROW_PROGRAM_ID=<deployed_program_id>`

Escrow adapter health:

```bash
curl -s -H 'x-api-key: dev-api-key' http://localhost:3000/api/v1/protocols/escrow/health
```

## CLI Quick Use

```bash
npm run cli -- doctor
npm run cli -- wallet create demo --auto-fund --fund-lamports 2000000
npm run cli -- wallet balance <walletId>
npm run cli -- agent list
npm run cli -- tx list --wallet-id <walletId>
npm run cli -- interactive
```

Command groups:

```bash
npm run cli -- wallet --help
npm run cli -- agent --help
npm run cli -- tx --help
npm run cli -- policy --help
npm run cli -- risk --help
npm run cli -- strategy --help
npm run cli -- treasury --help
npm run cli -- mcp --help
npm run cli -- protocol --help
npm run cli -- audit --help
```

## Agent Integration

### SKILLS contract

`SKILLS.md` is the machine-readable integration contract for agents and orchestrators.

### Intent compatibility runner

```bash
npm run intent-runner -- --file <intent.json>
npm run intent-runner -- --intent '<json-string>'
```

### Wallet helper

```bash
npm run wallets -- list
npm run wallets -- create --label bot-1
npm run wallets -- create --label bot-1 --auto-fund --fund-lamports 2000000
```

## Validation and Demo

### Core checks

```bash
npm run secret:scan
npm run lint
npm run typecheck
npm run test
npm run build
```

### Devnet scripts

```bash
npm run devnet:smoke
npm run devnet:multi-agent
npm run devnet:protocol-matrix
npm run demo:judge
```

`npm run demo:judge` writes judge evidence to:

- `docs/DEMO_RESULTS.md`

## Troubleshooting

### `EADDRINUSE` on startup

```bash
PIDS=$(for p in 3000 3002 3003 3004 3005 3006 3007 3008 8080; do lsof -ti tcp:$p; done | sort -u)
[ -n "$PIDS" ] && kill $PIDS
```

Then restart services.

### Gasless submit fails with Kora-related errors

Check in order:

1. `npm run kora:validate:rpc`
2. `curl -s -X POST http://localhost:8080 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getConfig"}'`
3. Ensure `KORA_RPC_URL` points to this running Kora instance
4. Ensure fee payer key is set (`KORA_PRIVATE_KEY` or fallback `PRIVATE_KEY`)
5. Ensure intent/protocol is gasless-eligible per risk config

### Transfer fails with rent-related errors

Destination or source account rent constraints are being hit.

Fixes:

- increase transfer amount for first-fund destination accounts
- top up source wallet before next transfer
- use `--auto-fund` on wallet creation for local testing

### Escrow health says not configured or deployed

- set `ESCROW_PROGRAM_ID`
- restart with env exported
- redeploy if needed: `npm run escrow:deploy:devnet`

## Known Limitations

- Some stores remain local/file-backed and are not distributed consensus state.
- Gasless currently blocks adapter-provided prebuilt versioned tx paths.
- External protocol upstream dependencies (quotes/build APIs) can degrade availability.

## Further Docs

- Deep dive: [`docs/DEEP_DIVE.md`](./docs/DEEP_DIVE.md)
- Security: [`docs/SECURITY.md`](./docs/SECURITY.md)
- Agent integration contract: [`SKILLS.md`](./SKILLS.md)
