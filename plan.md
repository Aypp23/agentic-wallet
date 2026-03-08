# Agentic Wallet Implementation Plan (Project-Only)

## 1. Objective

Build a devnet-ready **agentic wallet platform** that satisfies every `task.md` requirement and materially exceeds baseline bounty expectations in:

1. Agent action breadth
2. Protocol integration depth
3. Security and policy enforcement
4. Reliability, observability, and maintainability

## 2. Non-Negotiable Requirements

1. Programmatic wallet creation
2. Automatic transaction signing
3. SOL + SPL token custody/transfer support
4. Interaction with at least one test dApp/protocol
5. Multi-agent support with strict wallet isolation
6. Clear separation between agent logic and wallet/signing execution
7. Devnet working prototype
8. Complete docs: `README`, `SKILLS.md`, deep-dive write-up

## 3. Architecture (Target)

## 3.1 Core Services

1. `wallet-engine`
   - Wallet create/load/recover
   - Key provider abstraction
   - Signing boundary (no key export in production mode)
2. `transaction-engine`
   - Deterministic transaction lifecycle:
     - `pending -> simulating -> policy_eval -> approval_gate -> signing -> submitting -> confirmed/failed`
   - Retry + idempotency + dedupe
3. `policy-engine`
   - Rule evaluation: `allow | deny | require_approval`
   - Rule modules: spending, allowlist/blocklist, program/token/protocol allowlists, rate/time windows, risk tiering
4. `agent-runtime`
   - Multi-agent scheduler
   - Tool-call + intent emission runtime
   - Agent decision interface (no signing path)
5. `protocol-adapters`
   - Adapter registry + capability discovery
   - Standardized instruction builders per protocol
   - Versioned adapter contracts and conformance tests
6. `api-gateway`
   - Unified API surface
   - Auth + rate limiting + tenant/agent scopes
7. `audit-observability`
   - Structured audit artifacts
   - Metrics/logging/traces
   - Replay-friendly execution history
8. `developer-sdk`
   - Typed client SDK
   - Intent builders + adapter clients + examples

## 3.2 Trust Boundaries

1. Agent code is untrusted
2. Wallet private keys never leave `wallet-engine`
3. All spend actions pass through `policy-engine`
4. `AUTONOMOUS` mode cannot bypass policy engine
5. Frontend/clients cannot request raw secret material
6. High-risk intents can only run under explicit policy + approval mode

## 3.3 Capability Governance Model

1. Capability is granted by intersection of:
   - Agent profile allowed intents
   - Wallet policy rules
   - Protocol adapter allowlist
2. Every intent is mapped to a risk tier:
   - `low`, `medium`, `high`, `critical`
3. Execution mode by risk tier:
   - `low`: autonomous eligible
   - `medium`: autonomous with stricter limits
   - `high`: require approval
   - `critical`: disabled by default
4. No raw transaction execution in default autonomous lane

## 4. Repository Structure (Implementation)

```text
/Users/aomine/Desktop/agentic-wallet/
  apps/
    api-gateway/
    dashboard/
  services/
    agent-runtime/
    wallet-engine/
    policy-engine/
    transaction-engine/
    protocol-adapters/
  packages/
    common/
    sdk/
    observability/
  infrastructure/
    docker/
    kora/
  scripts/
    devnet-smoke.ts
    devnet-multi-agent.ts
    devnet-protocol-matrix.ts
  docs/
    DEEP_DIVE.md
    SECURITY.md
```

## 5. Feature Specification

## 5.1 Wallet and Custody

1. `POST /wallets` creates wallet programmatically
2. `GET /wallets/:id` returns public metadata only
3. `POST /wallets/:id/sign` signs payload/transaction
4. Key providers:
   - `local-dev` (encrypted at rest)
   - `hsm-ready` interface stub (future turnkey/HSM)

## 5.2 Transaction Lifecycle

1. Build transaction from validated intent
2. Simulate before signing
3. Enforce policy decision
4. Enforce approval gate if required
5. Sign only after allow/approval
6. Submit, confirm, persist status transitions
7. Emit audit event for each stage

## 5.3 Policy and Risk

1. Rule types:
   - `spending_limit`
   - `address_allowlist`
   - `address_blocklist`
   - `program_allowlist`
   - `token_allowlist`
   - `protocol_allowlist`
   - `rate_limit`
   - `time_window`
   - `max_slippage`
2. Per-agent allowed intent set
3. Per-intent risk classification
4. High-risk transactions require manual approval
5. Policy engine outage = fail-secure deny

## 5.4 Agent Integration

1. Agent emits typed intent schema only
2. Runtime builds context:
   - balances
   - recent txs
   - open approvals
   - policy summary
   - protocol positions summary
3. Scheduler supports N agents with isolated wallet IDs
4. Optional BYOA mode with scoped control token
5. Tool registry supports deterministic capability exposure by agent profile

## 5.5 Intent Capability Surface (Target)

## 5.5.1 Core Intents (MVP)

1. `transfer_sol`
2. `transfer_spl`
3. `swap`
4. `stake`
5. `unstake`
6. `lend_supply`
7. `lend_borrow`
8. `create_mint`
9. `mint_token`
10. `query_balance`
11. `query_positions`

## 5.5.2 Commerce Intents (V2)

1. `create_escrow`
2. `accept_escrow`
3. `release_escrow`
4. `refund_escrow`
5. `dispute_escrow`
6. `resolve_dispute`
7. `create_milestone_escrow`
8. `release_milestone`
9. `x402_pay`

## 5.5.3 Restricted Intents (V2+)

1. `flash_loan_bundle`
2. `cpi_call`
3. `custom_instruction_bundle`

Restricted intent rules:

1. Disabled by default
2. Require explicit protocol/program allowlist
3. Require simulation + approval
4. Full audit payload capture

## 5.6 Protocol Coverage (All Required)

1. System Program (SOL transfer)
2. SPL Token Program (SPL transfer + ATA handling)
3. Jupiter (swap route + execution)
4. Marinade (stake/unstake)
5. Solend (supply/borrow)
6. Metaplex token metadata/mint flow
7. Orca
8. Raydium
9. Escrow protocol adapter (AION-style commerce flow)

Adapter requirements:

1. Declared capabilities endpoint
2. Program ID registry
3. Input schema validation
4. Adapter conformance tests

## 5.7 Kora Gasless Mode

Dual execution mode:

1. Standard RPC path (`sendTransaction`)
2. Gasless Kora path (when enabled)

Gasless requirements:

1. Kora allowlists configured in `kora.toml`
2. Same policy/simulation gate as standard path
3. Relayer health and fee payer balance checks
4. Per-protocol gasless eligibility controls

## 6. Data Model (Minimum)

## 6.1 Tables/Collections

1. `wallets`
   - `id`, `public_key`, `provider`, `created_at`, `status`
2. `agents`
   - `id`, `wallet_id`, `status`, `allowed_intents`, `execution_mode`, `created_at`
3. `transactions`
   - `id`, `wallet_id`, `agent_id`, `type`, `protocol`, `status`, `signature`, `error`, `created_at`, `confirmed_at`
4. `policies`
   - `id`, `wallet_id`, `name`, `version`, `rules`, `active`
5. `policy_evaluations`
   - `id`, `tx_id`, `decision`, `reasons`, `risk_tier`, `created_at`
6. `pending_approvals`
   - `id`, `tx_id`, `wallet_id`, `status`, `expires_at`
7. `protocol_positions`
   - `id`, `wallet_id`, `protocol`, `position_type`, `asset`, `amount`, `updated_at`
8. `escrow_records`
   - `id`, `wallet_id`, `protocol`, `state`, `counterparty`, `amount`, `updated_at`
9. `audit_log`
   - `id`, `entity_id`, `event_type`, `payload`, `timestamp`

## 7. API Plan (V1)

## 7.1 Wallet APIs

1. `POST /api/v1/wallets`
2. `GET /api/v1/wallets/:walletId`
3. `GET /api/v1/wallets/:walletId/balance`
4. `GET /api/v1/wallets/:walletId/tokens`

## 7.2 Transaction APIs

1. `POST /api/v1/transactions`
2. `GET /api/v1/transactions/:txId`
3. `POST /api/v1/transactions/:txId/retry`
4. `POST /api/v1/transactions/:txId/approve`
5. `POST /api/v1/transactions/:txId/reject`

## 7.3 Policy APIs

1. `POST /api/v1/policies`
2. `PUT /api/v1/policies/:policyId`
3. `GET /api/v1/wallets/:walletId/policies`
4. `POST /api/v1/evaluate`

## 7.4 Agent APIs

1. `POST /api/v1/agents`
2. `PUT /api/v1/agents/:agentId/capabilities`
3. `POST /api/v1/agents/:agentId/start`
4. `POST /api/v1/agents/:agentId/stop`
5. `POST /api/v1/agents/:agentId/execute`

## 7.5 Protocol APIs

1. `GET /api/v1/protocols`
2. `GET /api/v1/protocols/:protocol/capabilities`
3. `POST /api/v1/defi/quote`
4. `POST /api/v1/defi/swap`
5. `POST /api/v1/defi/stake`
6. `POST /api/v1/defi/unstake`
7. `POST /api/v1/defi/lend/supply`
8. `POST /api/v1/defi/lend/borrow`

## 7.6 Escrow/Commerce APIs (V2)

1. `POST /api/v1/escrow/create`
2. `POST /api/v1/escrow/:id/accept`
3. `POST /api/v1/escrow/:id/release`
4. `POST /api/v1/escrow/:id/refund`
5. `POST /api/v1/escrow/:id/dispute`
6. `POST /api/v1/escrow/:id/resolve`

## 8. Implementation Phases

## Phase 0: Foundation + Safety (Day 1-3)

Tasks:

1. Create monorepo/service skeleton
2. Add shared schemas/types package
3. Add lint, typecheck, test harness
4. Add secret scan + key-file denylist in CI

Exit criteria:

1. CI passes (`lint`, `typecheck`, baseline tests)
2. Secret scan gate active

## Phase 1: Wallet Engine (Day 4-7)

Tasks:

1. Implement `KeyProvider` abstraction
2. Implement encrypted local provider
3. Implement wallet CRUD + public metadata APIs
4. Implement signing endpoint boundary

Exit criteria:

1. Programmatic wallet creation works on devnet
2. No secret material exposed in API/logs

## Phase 2: Transaction Engine (Day 8-12)

Tasks:

1. Build transaction lifecycle state machine
2. Add simulation before signing
3. Add submission + confirmation + retries
4. Persist transaction stage transitions

Exit criteria:

1. SOL transfer flow succeeds end-to-end
2. Failed simulation never reaches signing

## Phase 3: Policy Engine + HITL (Day 13-17)

Tasks:

1. Implement rule evaluator modules
2. Add policy evaluation endpoint + persistence
3. Add `require_approval` queue with TTL
4. Integrate policy checks into transaction engine

Exit criteria:

1. Policy deny blocks execution
2. Approval flow resumes execution correctly

## Phase 4: Agent Runtime + Capability Profiles (Day 18-22)

Tasks:

1. Implement agent scheduler and context builder
2. Bind one wallet per agent
3. Add per-agent allowed intent configuration
4. Record per-agent intent and execution history

Exit criteria:

1. Multi-agent demo runs with isolated wallets
2. Agents cannot access keys
3. Agent cannot execute intent outside allowed set

## Phase 5: Full Protocol Adapter Surface (Day 23-31)

Tasks:

1. Add protocol adapters:
   - System Program
   - SPL Token Program
   - Jupiter
   - Marinade
   - Solend
   - Metaplex
   - Orca
   - Raydium
   - Escrow adapter
2. Add adapter-specific validation guards
3. Add adapter capability-discovery endpoint
4. Add adapter conformance tests

Exit criteria:

1. All protocol adapters registered and discoverable
2. At least one successful devnet execution per adapter

## Phase 6: Intent Workflows + Position Tracking (Day 32-37)

Tasks:

1. Implement `lend_supply` and `lend_borrow` workflows on top of Solend adapter
2. Implement create-mint and mint-token intent workflows
3. Add position tracking for lending/staking and swap activity

Exit criteria:

1. Lending workflows execute with policy controls
2. Token lifecycle workflows execute with policy controls

## Phase 7: Escrow + Commerce Flows (Day 38-42)

Tasks:

1. Implement escrow intent flows (create/accept/release/refund/dispute/resolve) via escrow adapter
2. Implement milestone escrow flows
3. Add x402 payment intent flow

Exit criteria:

1. Agent-to-agent escrow lifecycle demo works on devnet
2. Escrow actions are fully auditable and policy-gated

## Phase 8: Restricted Intents Lane (Day 41-44)

Tasks:

1. Add `flash_loan_bundle`, `cpi_call`, `custom_instruction_bundle` schemas
2. Enforce strict default disablement
3. Require simulation + approval + program allowlist for execution

Exit criteria:

1. Restricted intents cannot run without explicit policy grant
2. Approval and audit artifacts are complete

## Phase 9: Kora Gasless Integration (Day 45-48)

Tasks:

1. Add gasless route in transaction engine
2. Integrate Kora client and health checks
3. Configure `infrastructure/kora/kora.toml` allowlists
4. Add gasless smoke tests per eligible protocol

Exit criteria:

1. Gasless submit path functional
2. Same policy/simulation gate behavior as standard path

## Phase 10: SDK, Docs, Demo Hardening (Day 49-56)

Tasks:

1. Write README with one-command setup
2. Write `docs/DEEP_DIVE.md` and `docs/SECURITY.md`
3. Add `SKILLS.md`
4. Add typed SDK methods + intent builders + examples
5. Add dashboard/CLI demo polish

Exit criteria:

1. Complete bounty submission artifacts
2. Reproducible demo script succeeds

## 9. Testing Plan

## 9.1 Unit Tests

1. Wallet key management and encryption
2. Policy rule evaluator behavior
3. Transaction state machine transitions
4. Intent schema validation and risk tier mapping

## 9.2 Integration Tests

1. Wallet -> policy -> tx engine interactions
2. Approval workflow
3. Adapter integration:
   - System Program
   - SPL Token Program
   - Jupiter
   - Marinade
   - Solend
   - Metaplex
   - Orca
   - Raydium
   - Escrow adapter
4. Escrow lifecycle integration

## 9.3 E2E Devnet Tests

1. Create wallet -> airdrop -> transfer SOL
2. Transfer SPL token
3. Swap, stake, unstake, lend, borrow flows
4. Multi-agent concurrent run
5. Orca and Raydium route execution checks
6. Escrow create -> accept -> release flow
7. Gasless flow (if Kora enabled)

## 9.4 Security Tests

1. Secret leakage checks
2. Policy bypass attempt tests
3. Unauthorized signing attempts
4. Capability escalation attempts
5. Restricted intent safety tests

## 10. Observability Plan

1. Structured logs with request/tx/intent IDs
2. Metrics:
   - policy decisions by type
   - intent executions by risk tier
   - protocol success/failure rates
   - simulation failure rate
   - confirmation latency
   - retry count
3. Audit log query by:
   - transaction
   - agent
   - wallet
   - protocol
   - escrow ID

## 11. Demo Plan (Submission)

## 11.1 Required Demo Flow

1. Create 3+ wallets programmatically
2. Fund wallets on devnet
3. Run multi-agent loop
4. Show automatic signing and confirmed transactions
5. Show SPL transfer + Jupiter/Orca/Raydium swaps
6. Show staking + lending actions
7. Show Metaplex token lifecycle action
8. Show escrow lifecycle between two agents
9. Show policy deny + approval scenario
10. Show gasless submit on eligible flow

## 11.2 Command Targets

1. `npm|bun run dev`
2. `npm|bun run test`
3. `npm|bun run devnet:smoke`
4. `npm|bun run devnet:multi-agent`
5. `npm|bun run devnet:protocol-matrix`

## 12. Delivery Gates (Definition of Done)

Project is done only if all pass:

1. All `task.md` requirements satisfied in code and demo
2. Devnet smoke tests pass consistently
3. No committed secrets/private keys
4. No policy bypass path for spend actions
5. Expanded intent/protocol surface implemented and tested
6. Full docs complete (`README`, `DEEP_DIVE`, `SECURITY`, `SKILLS`)
7. Clear, reproducible setup for judges

## 13. Immediate Next Execution Steps

1. Create monorepo folders and baseline package/tooling config
2. Implement `wallet-engine` first (encryption + signing boundary)
3. Implement `transaction-engine` state machine with simulation
4. Add `policy-engine` and wire deny/approval flow
5. Implement full protocol adapter set (System, SPL, Jupiter, Marinade, Solend, Metaplex, Orca, Raydium, Escrow)
6. Add lending and escrow intent workflows
7. Add restricted-intent lane and Kora gasless mode
8. Finalize SDK, docs, and demo scripts

## 14. Competitive Differentiators (Additions)

1. Protocol Risk Engine
   - Per-protocol risk configs:
     - max slippage
     - max pool concentration
     - allowlisted pools/programs
     - oracle sanity checks before execution
2. Pre/Post-Execution Delta Guard
   - Compare simulated deltas against confirmed on-chain deltas
   - Auto-pause agents when variance exceeds configured thresholds
3. Strategy Backtesting + Paper Trading
   - Replay strategies against historical or captured market snapshots
   - Require paper-trade pass criteria before live execution grants
4. Capability Manifest for Agent Plugins
   - Every agent/tool declares requested intents/protocols in a signed manifest
   - Runtime enforces manifest permissions in addition to policy rules
5. Portfolio-Level Risk Controls
   - Wallet/agent/global controls for:
     - max drawdown
     - max daily loss
     - max exposure per token/protocol
6. MCP Server for Platform Interoperability
   - Expose wallet/transaction/policy/protocol operations as MCP tools
   - Enable secure external AI agent integration without key exposure
7. Cross-Agent Treasury + Budget Allocator
   - Central treasury intents for controlled funding and rebalancing
   - Policy-gated budget routing across agent wallets
8. Execution Proof Artifacts (Compliance Mode)
   - Persist signed artifacts:
     - `intentHash`
     - `policyHash`
     - simulation hash
     - transaction signature
   - Support deterministic audit replay
9. Chaos + Failure Injection Testing
   - Fault injection for:
     - RPC outages
     - stale quote scenarios
     - relayer failures
     - policy-engine degradation
   - Validate fail-secure behavior across services
10. Versioned Policy + Adapter Migration Framework
   - Explicit semantic versioning for policies/adapters
   - Migration scripts and compatibility checks for live upgrades
