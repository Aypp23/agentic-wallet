# Security Architecture and Hardening Guide

This document describes the implemented security model, concrete controls in the current codebase, and residual risks that still need production hardening.

Companion references:

- `docs/README.md` (docs index and reading order)
- `docs/ARCHITECTURE.md` (component boundaries and data flow)
- `docs/API_REFERENCE.md` (normalized machine error contract)
- `docs/PROTOCOLS_AND_INTENTS.md` (protocol behavior and safety preconditions)
- `docs/OPERATIONS_RUNBOOK.md` (incident response procedures)
- `docs/TESTING_AND_VALIDATION.md` (security-relevant test paths)

## 1) Security Objectives

Primary security goals:

- prevent private key exfiltration
- enforce policy and risk controls before signing
- prevent unauthorized agent actions
- provide deterministic auditability for every execution
- reduce RPC/network failure impact on transaction reliability

Security posture in one line: agent intent is untrusted until it survives validation, risk, policy, and signing-boundary controls.

## 2) Threat Model

### Assets to protect

- wallet private keys
- signing capability
- policy integrity
- transaction integrity and finality state
- audit/proof artifacts
- API credentials and tenant boundaries

### Adversary assumptions

- can send malicious API payloads
- can attempt replay/duplication through retries
- can attempt policy bypass via alternate surfaces
- can exploit unstable upstream protocol APIs
- may operate with valid but over-privileged API keys

Out-of-scope for this prototype:

- host/kernel compromise
- physical access attacks
- side-channel hardening guarantees

## 3) Trust Boundaries

- agent boundary: agent-runtime and external agents cannot read raw key material
- gateway boundary: inbound auth/scope/rate-limit normalization before service fanout
- policy boundary: spend-capable flows evaluated by risk + policy prior to sign
- signing boundary: wallet-engine is sole transaction/message signer
- protocol boundary: adapter registry mediates protocol instruction construction

## 4) Security Control Matrix

| Threat | Control | Where Enforced | Current Strength |
|---|---|---|---|
| Unauthorized API use | API key auth, scope checks, tenant checks | `api-gateway` | Medium |
| API abuse/flooding | per-key rate limit | `api-gateway` | Medium |
| Input/schema attacks | Zod validation at service edges | all service APIs | High |
| Policy bypass | fail-secure deny on policy failure/unreachable | `transaction-engine` | High |
| Key exfiltration from clients | isolated signing API only | `wallet-engine` | High |
| Duplicate execution | idempotency keys + outbox dedupe/lease/retry | `transaction-engine` | Medium-High |
| Protocol misuse | adapter registry + protocol/program allowlists | adapters + risk/policy | Medium-High |
| Silent execution drift | delta guard + optional auto-pause | `transaction-engine` + `agent-runtime` | Medium |
| Forensics gap | audit stream + deterministic proof hashes | `audit-observability` + `transaction-engine` | High |

## 5) Ingress Security (Gateway)

Implemented at `apps/api-gateway`:

- API key requirement (`x-api-key`) when `API_GATEWAY_ENFORCE_AUTH=true`
- optional tenant boundary via `x-tenant-id`
- route-group scope gating (wallets/transactions/policies/agents/protocols/risk/etc.)
- per-key rate limiting (`API_GATEWAY_RATE_LIMIT_PER_MINUTE`)
- stable machine response envelope:
  - `status`
  - `errorCode`
  - `failedAt`
  - `stage`
  - `traceId`

Normalized error code set:

- `VALIDATION_ERROR`
- `POLICY_VIOLATION`
- `PIPELINE_ERROR`
- `CONFIRMATION_FAILED`

## 6) Validation and Input Safety

Every public API surface validates request payloads with strict Zod schemas from `packages/common`.

Examples:

- transaction create schema + explicit transaction type enum
- policy rule discriminated unions
- capability manifest schema
- risk config schemas
- adapter request schemas

Effect:

- malformed payloads fail at edge
- type confusion and shape drift are reduced

## 7) Key Management and Signing Boundary

### Wallet custody

- keypair generation happens in wallet-engine
- key provider abstraction supports backends
- default persisted backend encrypts secret key payloads at rest

### Encryption details

Current encrypted-file backend uses:

- AES-256-GCM
- scrypt-derived key
- per-record random salt + IV
- auth tag verification on decrypt

### Signing surface

- `POST /api/v1/wallets/:walletId/sign`
- supports legacy and v0 transaction signing
- supports detached message signatures

Security boundary guarantee:

- agents and clients do not get signing keys
- signing occurs only in wallet-engine process

Signer backend support:

- `encrypted-file` and `memory` for local/dev workflows
- `kms` with required `WALLET_KMS_MASTER_SECRET` (+ optional `WALLET_KMS_KEY_ID`)
- `hsm` with required `WALLET_HSM_PIN` + `WALLET_HSM_MODULE_SECRET` (+ optional `WALLET_HSM_SLOT`)
- `mpc` with required 3 node secrets (`WALLET_MPC_NODE_SECRETS` or `WALLET_MPC_NODE1..3_SECRET`)

## 8) Policy and Risk Enforcement

Spend-capable execution path includes:

1. protocol risk evaluation
2. simulation
3. policy-engine evaluation
4. approval gate when required
5. signing/submission only after above succeed

### Fail-secure behavior

If policy-engine is unavailable or evaluation fails, transaction-engine returns deny.

### Rule coverage

- spending, rate, time windows
- address/program/token/protocol allow/block lists
- slippage limits
- protocol risk rules
- portfolio risk rules

### Restricted intents

High-risk intents (flash-loan/cpi/custom bundles) are treated as critical and routed to approval-required posture.

## 9) Approval and Human Controls

Approval gate behavior:

- pending approvals stored with expiry (24h)
- explicit approve/reject endpoints
- reject marks transaction failed
- approve re-enters sign/submit path with proofing

This prevents autonomous completion of flagged high-risk actions.

## 10) Protocol Safety Controls

### Adapter-level controls

- only registered adapters can build transactions
- unsupported protocol/type combinations fail closed
- adapter health endpoints expose upstream availability

### Risk-level controls

- program allowlists
- pool allowlists
- slippage and quote-age constraints
- oracle deviation checks
- gasless eligibility per protocol

### Escrow safety posture

Escrow is backed by a real Anchor program integration and requires `ESCROW_PROGRAM_ID`.

- if not configured/deployed, escrow adapter health fails and build calls fail closed
- dispute/resolve flows enforce required signer/account roles at program level

## 11) Integrity, Replay, and Reliability Controls

### Idempotency

- `idempotencyKey` support returns existing tx record on replay

### Durable outbox

- SQLite-backed `outbox_jobs`
- lease-based claim/processing
- retry with max attempts
- open-job dedupe index `(tx_id, action)`

### Submission resilience

- RPC pool with health scoring and failover
- bounded retry wrappers for critical RPC calls
- adaptive compute budget and priority fee tuning

### Proof integrity

Execution proof stores deterministic hashes:

- `intentHash`
- `policyHash`
- `simulationHash`
- `proofHash`
- tx signature when available

These support post-incident verification and replay analysis.

## 12) Agent Governance Security

### Intent and protocol gating

- per-agent `allowedIntents`
- optional capability manifest enforcement
- manifest signature + expiry verification
- manifest denies if intent/protocol not explicitly granted

### Budget guardrails

- per-agent spend budget checks before live spend-capable execution
- treasury transfer/rebalance paths remain explicit APIs

### Optional runtime constraints

- backtest-pass gate can be required before live spend
- auto-pause integration on delta-guard breach

## 13) Observability and Forensics

Audit service records transaction-centric events and supports filtering by:

- txId
- agentId
- walletId
- protocol
- escrowId

Metrics counters include tx status and latency counters to detect anomalies and operational degradation.

## 14) Incident Response Playbook

### A) Suspected key compromise

1. stop ingress: rotate gateway API keys immediately
2. freeze automation: pause affected agents
3. contain wallets: move funds to new wallets
4. rotate encryption secret and rekey wallet store
5. inspect audit/proof timeline for unauthorized signatures

### B) Policy bypass suspicion

1. review tx stage history and policy decision payload
2. verify manifest state and agent capabilities at execution time
3. validate gateway `traceId` chain across services
4. tighten allowlists and spending/rate rules

### C) RPC instability / confirmation failures

1. inspect `/health` for rpcPool endpoint scores/fail streaks
2. adjust fee/compute/rpc retry controls
3. switch or reorder pool endpoints
4. re-run failed tx via retry endpoint when safe

## 15) Secure Deployment Checklist

Before production-like usage:

1. secrets and env
- set strong `WALLET_KEY_ENCRYPTION_SECRET`
- replace default dev API keys
- lock down tenant-scoped keys and scopes
- secure `AGENT_MANIFEST_SIGNING_SECRET`
- secure `AGENT_PAUSE_WEBHOOK_SECRET`

2. transport and network
- put gateway behind TLS termination
- restrict service-to-service network paths
- enforce private networking for internal services

3. policy defaults
- define strict allowlists (addresses/programs/tokens/protocols)
- set spending/rate/time-window limits
- configure protocol and portfolio risk ceilings

4. operations
- run `npm run ci:check` in CI
- enable secret scanning in CI and VCS hooks
- monitor audit/metrics pipelines

5. escrow and protocol setup
- deploy escrow program and set `ESCROW_PROGRAM_ID`
- validate adapter health endpoints before enabling agents

## 16) Residual Risks and Current Limitations

1. single-node assumptions
- outbox + state snapshots are locally durable, but not a distributed consensus state/queue.

2. best-effort persistence writes
- some snapshot writes intentionally fail open to keep service alive; this is a tradeoff between uptime and strict durability.

3. gateway rate limit storage
- current rate-limit state is in-memory and resets on process restart.

4. upstream dependency risk
- protocol APIs (Jupiter/Orca/Raydium/Solend/Kora) can fail or change contracts.

5. transport hardening
- mTLS/service identity is not built-in by default and should be added at infra layer.

6. advanced approval governance
- two-person approvals and multisig treasury execution are not yet first-class in runtime.

## 17) Hardening Priorities (Practical Order)

1. introduce distributed queue/state for multi-node execution guarantees
2. persist and centralize rate limiting (redis/db) across gateway replicas
3. add two-person approval and treasury multisig execution path
4. add continuous chaos + property-based security tests to CI gates

## 18) Summary

The current system already enforces meaningful defense-in-depth: strict signing boundary, layered risk/policy gates, approval workflows, deterministic proofing, and resilient RPC/outbox execution.

What remains is production maturity work: distributed operations, stronger infra security defaults, and multi-approver governance.
