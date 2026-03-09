# Agentic Wallet (Solana Devnet)

Autonomous wallet infrastructure for AI agents, built as a multi-service execution system on Solana devnet.

This repository is designed to satisfy the `task.md` bounty requirements with a working prototype that supports wallet custody, automatic signing, policy-gated execution, protocol interactions, and agent orchestration.

## Table of Contents

- [What This Project Is](#what-this-project-is)
- [Bounty Requirement Coverage](#bounty-requirement-coverage)
- [Architecture](#architecture)
- [Service Map](#service-map)
- [Execution Pipelines](#execution-pipelines)
- [Supported Capabilities](#supported-capabilities)
- [Repository Layout](#repository-layout)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Escrow Program (On-chain Anchor)](#escrow-program-on-chain-anchor)
- [CLI Guide](#cli-guide)
- [Agent/Orchestrator Integration](#agentorchestrator-integration)
- [Live Devnet Runbook](#live-devnet-runbook)
- [Judge Demo](#judge-demo)
- [API Reference](#api-reference)
- [Security Model](#security-model)
- [Reliability and Durability](#reliability-and-durability)
- [Testing and Quality Gates](#testing-and-quality-gates)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Project Documentation](#project-documentation)

## What This Project Is

Agentic Wallet is a gateway + engine architecture where AI agents express **intents**, and the platform handles:

1. Validation and policy enforcement
2. Protocol-specific transaction construction
3. Secure signing boundary
4. Submission and confirmation
5. Auditable proof artifacts

Agents do not directly hold private keys and do not submit raw RPC transactions by themselves.

## Bounty Requirement Coverage

| Requirement | Status | Where Implemented | How To Verify |
|---|---|---|---|
| Programmatic wallet creation | Implemented | `wallet-engine`, SDK, CLI | `npm run wallets -- create --label demo` |
| Automatic transaction signing | Implemented | `wallet-engine` sign boundary + `transaction-engine` pipeline | Submit any spend intent and inspect tx stage history |
| Hold SOL / SPL tokens | Implemented | Solana wallet accounts + token APIs | `GET /api/v1/wallets/:walletId/balance` and `/tokens` |
| Interact with test dApp/protocol | Implemented | protocol adapters (`jupiter`, `marinade`, `solend`, `metaplex`, `orca`, `raydium`, `escrow`) | `npm run devnet:protocol-matrix` |
| AI agent integration | Implemented | `agent-runtime`, `intent-runner`, MCP tools, SDK | `POST /api/v1/agents/:agentId/execute` |
| Security + key management | Implemented | signer abstraction, policy gates, auth/rate limits, manifests | `docs/SECURITY.md` |
| Multi-agent scalability | Implemented (single-node) | agent runtime + per-agent budget/capability controls | `npm run devnet:multi-agent` |
| SKILLS file for agents | Implemented | `SKILLS.md` | open `SKILLS.md` |
| Open-source setup docs | Implemented | this README + docs | follow [Quick Start](#quick-start) |
| Working devnet prototype | Implemented | full stack + devnet scripts + escrow deploy flow | `npm run devnet:smoke` |

## Architecture

### High-level Intent Flow

```text
Agent / CLI / SDK / MCP
          |
          v
   API Gateway (auth/scope/rate-limit, stable error envelope)
          |
          v
Transaction Engine
  -> build/simulate
  -> policy_eval / approval_gate
  -> sign boundary (wallet-engine)
  -> submit / confirm
  -> proof + audit + metrics
          |
          v
Solana RPC / Protocol Programs
```

### Trust Boundaries

- **Agent boundary:** agents emit intents only.
- **Signing boundary:** only `wallet-engine` signs.
- **Policy boundary:** all spend-capable intents pass policy evaluation before signing.
- **Protocol boundary:** adapter registry handles chain/protocol-specific build logic.

## Service Map

| Service | Default Port | Responsibility |
|---|---:|---|
| `apps/api-gateway` | `3000` | auth, tenant scope checks, rate limiting, response normalization, routing |
| `services/wallet-engine` | `3002` | wallet creation, key custody, signing APIs, SOL/SPL balance reads |
| `services/policy-engine` | `3003` | allow/deny/require_approval rule evaluation |
| `services/agent-runtime` | `3004` | agent lifecycle, capabilities, execution modes, treasury/strategy endpoints |
| `services/protocol-adapters` | `3005` | protocol registry, quote/build endpoints, escrow adapter |
| `services/transaction-engine` | `3006` | transaction lifecycle, simulation, policy gate, submit/confirm, proofs, outbox |
| `services/audit-observability` | `3007` | audit events and metrics aggregation |
| `services/mcp-server` | `3008` | MCP-compatible tools and generic gateway proxy tool |
| `packages/common` | n/a | shared schemas, types, validation |
| `packages/sdk` | n/a | typed client for API gateway |

## Execution Pipelines

### Transaction Lifecycle

`pending -> simulating -> policy_eval -> approval_gate -> signing -> submitting -> confirmed/failed`

### Escrow Lifecycle (on-chain)

Escrow adapter maps intents to real Anchor instructions:

- `create_escrow`
- `accept_escrow`
- `release_escrow`
- `refund_escrow`
- `dispute_escrow`
- `resolve_dispute`
- `create_milestone_escrow`
- `release_milestone`
- `x402_pay`

## Supported Capabilities

### Wallet + Custody

- Programmatic wallet creation
- SOL balance retrieval
- SPL token balance retrieval
- Message signing
- Legacy + v0 transaction signing
- Signer backend support (`encrypted-file`, `memory`, `kms`, `hsm`, `mpc`)

### Protocols

- System Program (`transfer_sol`)
- SPL Token (`transfer_spl`, mint operations)
- Jupiter (quote/swap build)
- Marinade (stake/unstake build)
- Solend (lend supply/borrow build)
- Metaplex (NFT minting intents)
- Orca / Raydium (swap intents)
- Escrow (real Anchor program instructions)

### Agent Runtime

- Create/list/get/start/stop/pause/resume agents
- Capability allowlists (intent/protocol gating)
- Autonomous or supervised modes
- Built-in autonomous decision engine (rule conditions + strategy steps + cadence/cooldown/rate caps)
- Budget operations and treasury allocation/rebalance
- Backtesting and paper trading endpoints
- Capability manifests (issue + verify)

### Risk and Safety

- Spending limits
- Rate limits
- Address/program/token/protocol allowlists
- Slippage controls
- Protocol risk controls
- Portfolio risk controls
- Delta guard checks (expected vs observed lamport movement)
- Optional auto-pause hooks

### Observability and Replayability

- Audit event stream
- Metrics counters
- Execution proofs:
  - `intentHash`
  - `policyHash`
  - `simulationHash`
  - `proofHash`
  - tx signature
- Replay endpoint per transaction

### Reliability

- RPC pool failover with health scoring (`SOLANA_RPC_POOL_URLS`)
- Adaptive priority fee + compute budget tuning
- Durable outbox queue with lease/retry semantics
- Restart recovery drain of pending processing work

## Repository Layout

```text
apps/
  api-gateway/
  cli/
services/
  wallet-engine/
  policy-engine/
  agent-runtime/
  protocol-adapters/
  transaction-engine/
  audit-observability/
  mcp-server/
packages/
  common/
  sdk/
  observability/
programs/
  escrow/                         # Anchor escrow program
scripts/
  intent-runner.ts
  wallets.ts
  devnet-smoke.ts
  devnet-multi-agent.ts
  devnet-protocol-matrix.ts
  escrow-sync-program-id.mjs
  escrow-deploy-devnet.mjs
docs/
  DEEP_DIVE.md
  SECURITY.md
SKILLS.md
plan.md
task.md
```

## Quick Start

### Prerequisites

- Node.js `>= 20`
- npm `>= 10`
- Solana CLI `>= 1.18` (required for devnet funding + escrow deploy)
- Anchor CLI `>= 0.31` (required for escrow build/deploy)

### 1) Install

```bash
npm install
```

### 2) Configure environment

```bash
cp .env.example .env
```

Minimum required for local dev:

- `WALLET_KEY_ENCRYPTION_SECRET`
- `API_GATEWAY_API_KEYS` (or keep default dev key)

For escrow devnet deployment:

- `PRIVATE_KEY` (base58 secret key or JSON byte array)

### 3) Start full stack

```bash
set -a; source .env; set +a
npm run dev
```

### 4) Health check

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3006/health
curl -s http://localhost:3005/health
```

### 5) Run baseline validation

```bash
npm run secret:scan
npm run lint
npm run typecheck
npm run test
npm run build
```

## Environment Configuration

Full list lives in `.env.example`. Key groups:

### RPC and execution tuning

- `SOLANA_RPC_URL`
- `SOLANA_RPC_POOL_URLS`
- `SOLANA_RPC_HEALTH_PROBE_MS`
- `SOLANA_PRIORITY_FEE_MIN_MICROLAMPORTS`
- `SOLANA_PRIORITY_FEE_MAX_MICROLAMPORTS`
- `SOLANA_PRIORITY_FEE_PERCENTILE`
- `SOLANA_PRIORITY_FEE_MULTIPLIER_BPS`
- `DELTA_GUARD_ABSOLUTE_TOLERANCE_LAMPORTS`

### Service ports

- `API_GATEWAY_PORT=3000`
- `WALLET_ENGINE_PORT=3002`
- `POLICY_ENGINE_PORT=3003`
- `AGENT_RUNTIME_PORT=3004`
- `PROTOCOL_ADAPTERS_PORT=3005`
- `TRANSACTION_ENGINE_PORT=3006`
- `AUDIT_OBSERVABILITY_PORT=3007`
- `MCP_SERVER_PORT=3008`

### Storage and durability

Directory defaults:

- `WALLET_ENGINE_DATA_DIR`
- `POLICY_ENGINE_DATA_DIR`
- `AGENT_RUNTIME_DATA_DIR`
- `TRANSACTION_ENGINE_DATA_DIR`
- `AUDIT_OBSERVABILITY_DATA_DIR`

Optional explicit SQLite DB path overrides:

- `WALLET_ENGINE_DB_PATH`
- `POLICY_ENGINE_DB_PATH`
- `AGENT_RUNTIME_DB_PATH`
- `TRANSACTION_ENGINE_DB_PATH`
- `AUDIT_OBSERVABILITY_DB_PATH`

### Gateway auth

- `API_GATEWAY_ENFORCE_AUTH=true`
- `API_GATEWAY_API_KEYS=dev-api-key:*:all`
- `API_GATEWAY_RATE_LIMIT_PER_MINUTE=120`
- `TENANT_ID` (optional)

### Agent governance

- `AGENT_MANIFEST_SIGNING_SECRET`
- `AGENT_MANIFEST_ISSUER`
- `AGENT_REQUIRE_MANIFEST`
- `AGENT_REQUIRE_BACKTEST_PASS`
- `AGENT_PAUSE_WEBHOOK_SECRET`

### Signer backends

- `WALLET_SIGNER_BACKEND=encrypted-file|memory|kms|hsm|mpc`
- `WALLET_KMS_MASTER_SECRET` and optional `WALLET_KMS_KEY_ID` (required for `kms`)
- `WALLET_HSM_PIN`, `WALLET_HSM_MODULE_SECRET`, optional `WALLET_HSM_SLOT` (required for `hsm`)
- `WALLET_MPC_NODE_SECRETS` (CSV of 3 secrets) or `WALLET_MPC_NODE1_SECRET..WALLET_MPC_NODE3_SECRET` (required for `mpc`)

#### When to use each signer backend

- `encrypted-file`:
  - best for local development and fast prototyping
  - key material is encrypted at rest on local disk using `WALLET_KEY_ENCRYPTION_SECRET`
- `memory`:
  - ephemeral/testing mode only
  - keys are not persisted and are lost on process restart
- `kms`:
  - use for managed key governance and centralized access control
  - ideal when you need key-usage auditability and rotation controls in managed infrastructure
- `hsm`:
  - use for hardware-rooted custody and stricter compliance posture
  - suitable when signing controls must be anchored to dedicated hardware boundaries
- `mpc`:
  - use for distributed custody and threshold-style operational controls
  - reduces single-key-holder risk by splitting key material across multiple secrets/nodes

Operational note:
- current `kms|hsm|mpc` implementations in this repository are pluggable backend modules with a unified interface for portability; production-grade external integrations may require environment-specific hardening and provider-specific adapters.

### Escrow and gasless

- `ESCROW_PROGRAM_ID=<deployed_program_id>`
- `KORA_RPC_URL`
- `KORA_PRIVATE_KEY` (optional; defaults to `PRIVATE_KEY` in provided npm scripts)
- `PRIVATE_KEY` (for deploy/funding workflows)

### Kora operator (local devnet)

Kora config lives in [`infrastructure/kora/kora.toml`](./infrastructure/kora/kora.toml), with signer pool config in [`infrastructure/kora/signers.toml`](./infrastructure/kora/signers.toml).

Validate config:

```bash
npm run kora:validate
npm run kora:validate:rpc
```

Start Kora RPC on `http://localhost:8080`:

```bash
npm run kora:start
```

Then run a gasless intent from CLI (`Gasless via Kora? Yes`) or command mode:

```bash
npm run cli -- tx create --wallet-id <walletId> --type transfer_sol --protocol system-program --intent '{"destination":"<toWalletId>","lamports":1000000}' --gasless
```

## Escrow Program (On-chain Anchor)

Escrow is backed by a real Anchor program in [`programs/escrow`](./programs/escrow/README.md), not memo placeholders.

### Build escrow program

```bash
npm run escrow:build
```

### Deploy escrow program to devnet

```bash
npm run escrow:deploy:devnet
```

This command:

1. Syncs `declare_id!` and `Anchor.toml` from the deploy keypair
2. Builds and deploys via Anchor
3. Updates `.env` with `ESCROW_PROGRAM_ID=<deployed_id>`

### Verify escrow adapter health

```bash
curl -s -H 'x-api-key: dev-api-key' http://localhost:3000/api/v1/protocols/escrow/health
```

Expected:

- `ok: true`
- `configured: true`
- `deployed: true`

## CLI Guide

The CLI is in `apps/cli` and uses the typed SDK.

### Run help

```bash
npm run cli -- --help
```

### Useful command examples

```bash
npm run cli -- doctor
npm run cli -- wallet create trader-1
npm run cli -- wallet create trader-1 --auto-fund --fund-lamports 2000000
npm run cli -- wallet balance <walletId>
npm run cli -- tx list --wallet-id <walletId>
npm run cli -- protocol list
npm run cli -- agent list
npm run cli -- --animated-banner interactive
```

### Command groups

```bash
npm run cli -- wallet --help
npm run cli -- agent --help
npm run cli -- tx --help
npm run cli -- policy --help
npm run cli -- protocol --help
npm run cli -- risk --help
npm run cli -- strategy --help
npm run cli -- treasury --help
npm run cli -- mcp --help
npm run cli -- audit --help
```

### Advanced command examples

```bash
# Agent lifecycle / capabilities / manifests
npm run cli -- agent pause <agentId> --reason "manual review"
npm run cli -- agent resume <agentId>
npm run cli -- agent budget <agentId>
npm run cli -- agent caps-set <agentId> --intents transfer_sol swap query_balance --mode autonomous
npm run cli -- agent manifest-issue <agentId> --intents transfer_sol swap --protocols system-program jupiter --ttl 3600
npm run cli -- agent manifest-verify <agentId> --manifest '{"manifestId":"..."}'

# Transaction proofs / replay
npm run cli -- tx proof <txId>
npm run cli -- tx replay <txId>

# Policy versioning / migration
npm run cli -- policy versions <policyId>
npm run cli -- policy version <policyId> --number 1
npm run cli -- policy migrate <policyId> --target-version 2 --mode safe
npm run cli -- policy compatibility-check --rules '[{"type":"spending_limit","maxLamports":1000000}]'

# Risk controls
npm run cli -- risk protocols
npm run cli -- risk protocol-get jupiter
npm run cli -- risk protocol-set jupiter --input '{"slippageBps":75,"maxNotionalLamports":100000000}'
npm run cli -- risk portfolio-get <walletId>
npm run cli -- risk portfolio-set <walletId> --input '{"maxExposureLamports":500000000}'
npm run cli -- risk chaos
npm run cli -- risk chaos-set --enabled false --latency-ms 0

# Strategy + treasury
npm run cli -- strategy backtest --wallet-id <walletId> --name smoke --steps '[{"type":"transfer_sol","protocol":"system-program","intent":{"destination":"<pubkey>","lamports":1000},"timestamp":"2026-01-01T00:00:00.000Z"}]'
npm run cli -- strategy paper-execute --agent-id <agentId> --wallet-id <walletId> --type query_balance --protocol system-program --intent '{}'
npm run cli -- strategy paper-list <agentId>
npm run cli -- treasury allocate --target-agent-id <agentId> --lamports 1000000 --reason "initial budget"
npm run cli -- treasury rebalance --source-agent-id <agentA> --target-agent-id <agentB> --lamports 500000

# MCP
npm run cli -- mcp tools
npm run cli -- mcp call wallet.balance --args '{"walletId":"<walletId>"}'
```

### Themes

```bash
npm run cli -- --theme midnight doctor
npm run cli -- --theme matrix doctor
npm run cli -- --theme solarized doctor
npm run cli -- --theme fire doctor
```

### Interactive mode

```bash
npm run cli -- interactive
```

Exit options:

- choose `Exit` from menu
- press `Ctrl+C`

## Agent/Orchestrator Integration

### `SKILLS.md`

`SKILLS.md` is the machine-readable integration contract for agents. It documents:

- intent execution model
- policy and safety guardrails
- runtime behavior and output contracts
- known limitations

### `intent-runner`

Compatibility interface for orchestrators:

```bash
npm run intent-runner -- --file <intent.json>
npm run intent-runner -- --intent '<json-string>'
```

Supports both:

- current request model (`walletId`, transaction `type`, `protocol`, `intent`)
- legacy fields (`fromWalletId`, `chain`, `createdAt`) with adaptation

### Wallet helper

```bash
npm run wallets -- list
npm run wallets -- create --label bot-1
npm run wallets -- create --label bot-1 --auto-fund --fund-lamports 2000000
```

## Live Devnet Runbook

These scripts assume your stack is running and `.env` is loaded.

### 1) Baseline smoke

```bash
npm run devnet:smoke
npm run devnet:multi-agent
npm run devnet:protocol-matrix
```

### 2) Create wallets

```bash
npm run wallets -- create --label escrow-creator
npm run wallets -- create --label escrow-recipient
npm run wallets -- list
```

### 3) Fund wallets

Choose one:

- Auto-fund on creation (devnet only): `npm run wallets -- create --label demo --auto-fund --fund-lamports 2000000`
- Manual faucet/transfer from your devnet funding wallet.

Auto-fund requires one of:

- `WALLET_AUTOFUND_PAYER_PRIVATE_KEY` (preferred), or
- `PRIVATE_KEY` (fallback)

### 4) Submit escrow intents through full pipeline

Create escrow:

```bash
npm run intent-runner -- --intent '{
  "type":"create_escrow",
  "walletId":"<creatorWalletId>",
  "protocol":"escrow",
  "intent":{
    "escrowNumericId":"900001",
    "counterparty":"<recipientPubkey>",
    "creator":"<creatorPubkey>",
    "arbiter":"<creatorPubkey>",
    "feeRecipient":"<creatorPubkey>",
    "amount":"10000000",
    "deadlineUnixSec":4102444800,
    "terms":"Devnet escrow test"
  }
}'
```

Accept:

```bash
npm run intent-runner -- --intent '{
  "type":"accept_escrow",
  "walletId":"<recipientWalletId>",
  "protocol":"escrow",
  "intent":{
    "escrowNumericId":"900001",
    "creator":"<creatorPubkey>"
  }
}'
```

Release:

```bash
npm run intent-runner -- --intent '{
  "type":"release_escrow",
  "walletId":"<creatorWalletId>",
  "protocol":"escrow",
  "intent":{
    "escrowNumericId":"900001",
    "creator":"<creatorPubkey>",
    "counterparty":"<recipientPubkey>",
    "feeRecipient":"<creatorPubkey>"
  }
}'
```

### 5) Inspect outputs

- Transaction state: `GET /api/v1/transactions/:txId`
- Proof artifact: `GET /api/v1/transactions/:txId/proof`
- Replay data: `GET /api/v1/transactions/:txId/replay`
- Escrow records by wallet: `GET /api/v1/wallets/:walletId/escrows`

## Judge Demo

Run one command for an end-to-end proof flow with pass/fail summary and explorer links:

```bash
npm run demo:judge
```

The command executes:

1. wallet create + devnet funding tx
2. `transfer_sol` tx
3. protocol interaction tx (`create_escrow`)
4. multi-agent transfer tx

Artifact generated on every run:

- `docs/DEMO_RESULTS.md` (includes real tx hashes + explorer URLs)

## API Reference

All endpoints are exposed via API gateway (`http://localhost:3000`).

### Response envelope

Gateway responses include stable machine fields:

- `status`: `success | failure`
- `errorCode`: `VALIDATION_ERROR | POLICY_VIOLATION | PIPELINE_ERROR | CONFIRMATION_FAILED | null`
- `failedAt`: deterministic stage name or `null`
- `stage`: `validation | policy | build | sign | send | confirm | completed | gateway`
- `traceId`: request trace id
- `data`: original response payload

### Wallet

- `POST /api/v1/wallets`
- `GET /api/v1/wallets/:walletId`
- `GET /api/v1/wallets/:walletId/balance`
- `GET /api/v1/wallets/:walletId/tokens`
- `POST /api/v1/wallets/:walletId/sign`

### Transactions

- `POST /api/v1/transactions`
- `GET /api/v1/transactions/:txId`
- `POST /api/v1/transactions/:txId/retry`
- `POST /api/v1/transactions/:txId/approve`
- `POST /api/v1/transactions/:txId/reject`
- `GET /api/v1/transactions/:txId/proof`
- `GET /api/v1/transactions/:txId/replay`
- `GET /api/v1/wallets/:walletId/transactions`
- `GET /api/v1/wallets/:walletId/pending-approvals`
- `GET /api/v1/wallets/:walletId/positions`
- `GET /api/v1/wallets/:walletId/escrows`

### Policies

- `POST /api/v1/policies`
- `PUT /api/v1/policies/:policyId`
- `GET /api/v1/wallets/:walletId/policies`
- `POST /api/v1/evaluate`
- `GET /api/v1/policies/:policyId/versions`
- `GET /api/v1/policies/:policyId/versions/:version`
- `POST /api/v1/policies/:policyId/migrate`
- `POST /api/v1/policies/compatibility-check`

### Agents

- `POST /api/v1/agents`
- `GET /api/v1/agents`
- `GET /api/v1/agents/:agentId`
- `PUT /api/v1/agents/:agentId/capabilities`
- `POST /api/v1/agents/:agentId/start`
- `POST /api/v1/agents/:agentId/stop`
- `POST /api/v1/agents/:agentId/pause`
- `POST /api/v1/agents/:agentId/resume`
- `GET /api/v1/agents/:agentId/budget`
- `GET /api/v1/agents/:agentId/autonomy/state`
- `POST /api/v1/agents/:agentId/manifest/issue`
- `POST /api/v1/agents/:agentId/manifest/verify`
- `POST /api/v1/agents/:agentId/execute`
- `POST /api/v1/strategy/backtest`
- `POST /api/v1/strategy/paper/execute`
- `GET /api/v1/strategy/paper/:agentId`
- `POST /api/v1/treasury/allocate`
- `POST /api/v1/treasury/rebalance`

### Protocol adapters

- `GET /api/v1/protocols`
- `GET /api/v1/protocols/:protocol/capabilities`
- `GET /api/v1/protocols/:protocol/version`
- `GET /api/v1/protocols/health`
- `GET /api/v1/protocols/:protocol/health`
- `POST /api/v1/protocols/:protocol/compatibility-check`
- `POST /api/v1/protocols/:protocol/migrate-intent`
- `POST /api/v1/defi/quote`
- `POST /api/v1/defi/swap`
- `POST /api/v1/defi/stake`
- `POST /api/v1/defi/unstake`
- `POST /api/v1/defi/lend/supply`
- `POST /api/v1/defi/lend/borrow`
- `POST /api/v1/escrow/create`
- `POST /api/v1/escrow/:id/accept`
- `POST /api/v1/escrow/:id/release`
- `POST /api/v1/escrow/:id/refund`
- `POST /api/v1/escrow/:id/dispute`
- `POST /api/v1/escrow/:id/resolve`

### Audit + metrics

- `POST /api/v1/audit/events`
- `GET /api/v1/audit/events`
- `POST /api/v1/metrics/inc`
- `GET /api/v1/metrics`

### Risk + chaos controls

- `GET /api/v1/risk/protocols`
- `GET /api/v1/risk/protocols/:protocol`
- `PUT /api/v1/risk/protocols/:protocol`
- `GET /api/v1/risk/portfolio`
- `GET /api/v1/risk/portfolio/:walletId`
- `PUT /api/v1/risk/portfolio/:walletId`
- `GET /api/v1/chaos`
- `PUT /api/v1/chaos`

### MCP tools

- `GET /mcp/tools`
- `POST /mcp/call`

Default MCP tool names:

- `wallet.create`
- `wallet.balance`
- `tx.create`
- `tx.get`
- `policy.evaluate`
- `protocol.quote`
- `agent.execute`
- `risk.get_protocol`
- `risk.set_protocol`
- `gateway.request`

## Security Model

### Key isolation and signing boundary

- Private keys are stored and loaded by wallet-engine key providers.
- Agents never receive secret key material.
- Transaction-engine requests signing via wallet-engine API only.

### Policy gating before submit

- All spend-capable intents are evaluated by policy-engine.
- Results are `allow`, `deny`, or `require_approval`.
- `require_approval` pauses at `approval_gate` until operator `approve`/`reject`.

### Gateway protections

- API key auth and per-key scopes
- tenant header support
- per-key rate limiting
- normalized failure envelope with deterministic `errorCode`/`stage`

### Capability governance

- signed capability manifests
- runtime verification and intent/protocol permission checks

## Reliability and Durability

### Execution robustness

- RPC failover pool with endpoint health scores
- adaptive compute budget and priority fee tuning
- confirmation retry behavior

### Durable queue semantics

- SQLite-backed outbox
- lease/retry attempts (`TX_OUTBOX_LEASE_MS`, `TX_OUTBOX_MAX_ATTEMPTS`)
- restart recovery drain

### Proof and replay

Each transaction can produce deterministic proof artifacts and replay metadata for auditability.

## Testing and Quality Gates

### Unit and integration validation

```bash
npm run test
npm run typecheck
npm run build
```

### Security and CI gate

```bash
npm run secret:scan
npm run lint
npm run ci:check
```

### Devnet behavior checks

```bash
npm run devnet:smoke
npm run devnet:multi-agent
npm run devnet:protocol-matrix
npm run demo:judge
npm run chaos:test
npm run policy:migrate:test
npm run adapter:migrate:test
```

## Troubleshooting

### `EADDRINUSE` when starting stack

Ports are already in use.

```bash
PIDS=$(for p in 3000 3002 3003 3004 3005 3006 3007 3008; do lsof -ti tcp:$p; done | sort -u)
[ -n "$PIDS" ] && kill $PIDS
```

Then restart:

```bash
set -a; source .env; set +a
npm run dev
```

### Escrow health says not configured

- Ensure `.env` contains `ESCROW_PROGRAM_ID`
- Ensure services were started with env exported (`set -a; source .env; set +a`)
- Verify endpoint:

```bash
curl -s -H 'x-api-key: dev-api-key' http://localhost:3000/api/v1/protocols/escrow/health
```

### Escrow health says not deployed

Deploy the program:

```bash
npm run escrow:deploy:devnet
```

### Transfer fails with rent error

If recipient account is unfunded, transfer amount may be below rent-exempt minimum. Fund destination first or increase amount.

### `approval_gate` transactions not progressing

Approve or reject explicitly:

```bash
curl -X POST -H 'x-api-key: dev-api-key' http://localhost:3000/api/v1/transactions/<txId>/approve
```

### Solend or DEX quote/build failures

Adapters are fail-closed for safety. Upstream API outages will return errors instead of synthetic success.

## Known Limitations

1. Persistence is SQLite-backed and single-node; horizontal scale needs Postgres + distributed queue.
2. Solend/DEX integrations depend on upstream API availability and contract stability.
3. Escrow adapter requires a deployed program id in environment; no shared hosted escrow program is bundled.
4. MCP currently includes a curated tool set plus validated `gateway.request`; not every REST endpoint has a named MCP wrapper.

## Project Documentation

- [`plan.md`](./plan.md)
- [`docs/DEEP_DIVE.md`](./docs/DEEP_DIVE.md)
- [`docs/SECURITY.md`](./docs/SECURITY.md)
- [`SKILLS.md`](./SKILLS.md)
- [`task.md`](./task.md)
