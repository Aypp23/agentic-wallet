# Testing and Validation Guide

This document defines how to verify the system end-to-end and how to capture
reproducible evidence.

## 1. Test Objectives

Testing must prove:

- wallet creation and custody boundary
- automatic signing behavior
- protocol interaction coverage
- policy/risk denial and approval behavior
- multi-agent independence
- audit/proof/metrics observability

## 2. Test Layers

### 2.1 Unit and schema tests

Run package/service tests:

```bash
npm run test
npm run typecheck
npm run lint
```

### 2.2 Integration tests

Run stack-level checks and migration checks:

```bash
npm run policy:migrate:test
npm run adapter:migrate:test
```

### 2.3 End-to-end devnet tests

```bash
npm run demo:judge
npm run devnet:protocol-matrix
npm run devnet:multi-agent
```

## 3. Minimal Operator Test (5-10 min)

1. start stack: `npm run dev`
2. health: `npm run cli -- doctor --raw`
3. create funded wallet
4. run one read-only and one spend-capable tx
5. fetch tx proof
6. check metrics counters moved

Pass criteria:

- all services healthy
- tx reaches `confirmed`
- proof endpoint returns hashes
- metrics counters increment

## 4. Full Manual Validation (Terminal-Only)

This mirrors judge-grade CLI usage.

### 4.1 Setup

- create Wallet A (`5,000,000` lamports auto-fund)
- create Wallet B (`2,000,000` lamports auto-fund)
- verify balances

### 4.2 Agent

- create agent on Wallet A with intents:
  - `query_balance`
  - `transfer_sol`
  - `swap`
  - `stake`
  - `lend_supply`
  - `create_escrow`

### 4.3 Core flows

Run and record tx ids for:

- query balance (`system-program`)
- transfer SOL (`system-program`)
- swap (`jupiter`)
- stake (`marinade`)
- lend supply (`solend`)
- create escrow (`escrow`)

### 4.4 Governance/safety

- create strict spending policy
- run over-limit transfer and verify deny
- set strict protocol risk and verify deny (e.g., high slippage swap)
- check metrics and audit stream

### 4.5 Advanced ops

- run backtest
- execute paper trade and list paper ledger
- allocate and rebalance treasury budgets
- list and call MCP tools

Pass criteria:

- core protocol interactions confirm or fail with expected deny semantics
- policy/risk denials are deterministic and explainable
- strategy/treasury/mcp flows return valid records

## 5. Evidence Capture Rules

For each run capture:

- UTC timestamp
- cluster RPC URL
- wallet ids/public keys used
- agent ids used
- tx ids and signatures
- explorer links for on-chain signatures
- any deny/failure with normalized machine fields

Recommended evidence format:

- update `docs/DEMO_RESULTS.md`
- include pass/fail matrix by capability
- include a protocol coverage table

## 6. Normalized Error Verification

For expected failures, verify machine envelope fields:

- `status=failure`
- `errorCode` present
- `stage` and/or `failedAt` present
- `traceId` present

Required error classes to test at least once:

- `VALIDATION_ERROR`
- `POLICY_VIOLATION`
- `PIPELINE_ERROR`
- `CONFIRMATION_FAILED` (best effort, can be hard to force reliably)

## 7. Reliability and Recovery Tests

### 7.1 Idempotency

- submit with `idempotencyKey`
- replay same request
- verify same tx record returned

### 7.2 Outbox recovery

- trigger tx execution
- restart transaction-engine during processing window (controlled test)
- verify tx recovers and reaches terminal state

### 7.3 RPC failover

- configure multiple RPC URLs
- induce one endpoint degradation
- verify continued execution via healthier endpoints

## 8. Security-Critical Test Cases

- agent cannot sign directly without wallet-engine
- policy deny blocks signing and submission
- approval-gated tx does not proceed until explicit approve
- capability manifest denies disallowed intent/protocol
- budget check denies over-budget spend-capable actions

## 9. Multi-Agent Isolation Test

Minimum recommendation:

- run at least 2 agents with separate wallets
- execute intents concurrently
- confirm budgets/capabilities are enforced per-agent
- verify one paused/failed agent does not block other agents

Stretch goal:

- run 10-20 agents (load script or controlled CLI automation) and report
  throughput/failure rates with timestamps.

## 10. Protocol-Specific Validation Notes

### 10.1 Jupiter/Orca/Raydium

- validate route/quote behavior
- validate slippage deny behavior
- on devnet, compatibility metadata may appear

### 10.2 Marinade/Solend

- validate builder behavior and confirmation path
- on devnet, compatibility metadata may appear

### 10.3 Escrow

- validate adapter health is `ok`
- verify `ESCROW_PROGRAM_ID` and deployment
- validate create path with realistic wallet balance/rent economics

## 11. Regression Checklist Before Merging

1. `npm run ci:check`
2. `npm run demo:judge`
3. manual CLI smoke (doctor + wallet + one protocol tx)
4. docs update (`DEMO_RESULTS.md` plus any changed contract docs)

## 12. Troubleshooting During Test Runs

### 12.1 Devnet throttling

- reduce request concurrency
- use RPC pool with healthy endpoints
- retry with backoff

### 12.2 Auto-fund failures

- verify payer key env and payer balance

### 12.3 Policy/risk false negatives

- inspect current policy and risk config state before run
- reset profiles to known baseline

### 12.4 Agent paused after compatibility tx

- inspect `deltaGuard` and `buildMetadata`
- resume agent after validating expected behavior

## 13. Cross-Links

- Demo evidence format: `docs/DEMO_RESULTS.md`
- Operational runbook: `docs/OPERATIONS_RUNBOOK.md`
- API contracts: `docs/API_REFERENCE.md`
- Security test priorities: `docs/SECURITY.md`
