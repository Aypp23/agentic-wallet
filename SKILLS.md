# SKILLS.md

Canonical machine-readable contract for agents integrating with this repository.

Last verified: 2026-03-03
Network default: Solana devnet

## 1) Current Repository Skill State

```yaml
skills_index_version: 3
project: agentic-wallet
network_default: solana-devnet
repo_skill_dir: skills/
repo_skill_files_present: false
```

Notes:
1. `skills/` exists but has no checked-in `SKILL.md` files.
2. This file (`SKILLS.md`) is the active integration contract.

## 2) Auth, Headers, and Scopes

Gateway base URL (default): `http://localhost:3000`

Required header:
1. `x-api-key: <key>`

Optional header:
1. `x-tenant-id: <tenant>`

Auth env:
1. `API_GATEWAY_ENFORCE_AUTH=true|false` (default `true`)
2. `API_GATEWAY_API_KEYS=key:tenant:scope1,scope2;key2:*:all`
3. `API_GATEWAY_RATE_LIMIT_PER_MINUTE=<int>`

Current scope groups:
1. `wallets`
2. `transactions`
3. `policies`
4. `agents`
5. `protocols`
6. `risk`
7. `strategy`
8. `treasury`
9. `audit`
10. `mcp`

## 3) Supported Integration Modes

### 3.1 Compatibility CLI (orchestrators)

```bash
npm run wallets -- list [--public-key <base58>]
npm run wallets -- create --label <name>
npm run intent-runner -- --file <path-to-json>
npm run intent-runner -- --intent '<json-string>'
```

Legacy adapter behavior (`intent-runner`):
1. `fromWalletId` (base58) -> internal `walletId` UUID lookup
2. Legacy `chain` / `createdAt` / `reasoning` preserved at `intent.legacy`
3. `transfer` -> `transfer_sol` or `transfer_spl`
4. `swap` -> `swap`
5. `create_mint` -> `create_mint`
6. `mint_token` -> `mint_token`

### 3.2 Operator CLI

```bash
npm run cli -- doctor
npm run cli -- wallet create [label]
npm run cli -- wallet get <walletId>
npm run cli -- wallet balance <walletId>
npm run cli -- wallet tokens <walletId>

npm run cli -- agent create <name> [--wallet-id <walletId>] [--mode autonomous|supervised] [--intents <intent...>]
npm run cli -- agent list
npm run cli -- agent get <agentId>
npm run cli -- agent start <agentId>
npm run cli -- agent stop <agentId>
npm run cli -- agent pause <agentId> [--reason <reason>]
npm run cli -- agent resume <agentId>
npm run cli -- agent budget <agentId>
npm run cli -- agent caps-set <agentId> --intents <intent...> [--mode autonomous|supervised] [--autonomy '<json>']
npm run cli -- agent manifest-issue <agentId> --intents <intent...> --protocols <protocol...> [--ttl <seconds>]
npm run cli -- agent manifest-verify <agentId> [--manifest '<json>' | --manifest-file <path>]
npm run cli -- agent exec <agentId> --type <intentType> --protocol <protocol> --intent '<json>' [--gasless]

npm run cli -- tx create --wallet-id <walletId> --type <intentType> --protocol <protocol> --intent '<json>' [--agent-id <agentId>] [--gasless] [--idempotency-key <key>]
npm run cli -- tx get <txId>
npm run cli -- tx proof <txId>
npm run cli -- tx replay <txId>
npm run cli -- tx retry <txId>
npm run cli -- tx approve <txId>
npm run cli -- tx reject <txId>
npm run cli -- tx list --wallet-id <walletId>
npm run cli -- tx pending --wallet-id <walletId>
npm run cli -- tx positions --wallet-id <walletId>
npm run cli -- tx escrows --wallet-id <walletId>

npm run cli -- policy create --wallet-id <walletId> --name <name> --rules '<jsonArray>' [--active true|false]
npm run cli -- policy list --wallet-id <walletId>
npm run cli -- policy versions <policyId>
npm run cli -- policy version <policyId> --number <version>
npm run cli -- policy migrate <policyId> --target-version <version> [--mode <mode>]
npm run cli -- policy compatibility-check --rules '<jsonArray>'
npm run cli -- policy evaluate --wallet-id <walletId> --type <intentType> --protocol <protocol> [--destination <address>] [--token-mint <mint>] [--amount-lamports <lamports>] [--slippage-bps <bps>] [--program-ids <csv>]

npm run cli -- protocol list
npm run cli -- protocol caps <protocol>
npm run cli -- protocol quote --protocol <protocol> --input-mint <mint> --output-mint <mint> --amount <amount> --wallet <walletAddress> [--slippage-bps <bps>]
npm run cli -- protocol swap --protocol <protocol> --input-mint <mint> --output-mint <mint> --amount <amount> --wallet <walletAddress> [--slippage-bps <bps>]
npm run cli -- protocol stake --protocol <protocol> --wallet <walletAddress> --amount <amount> [--validator <validator>]
npm run cli -- protocol unstake --protocol <protocol> --wallet <walletAddress> --amount <amount> [--validator <validator>]
npm run cli -- protocol lend-supply --protocol <protocol> --wallet <walletAddress> --mint <mint> --amount <amount>
npm run cli -- protocol lend-borrow --protocol <protocol> --wallet <walletAddress> --mint <mint> --amount <amount>
npm run cli -- protocol escrow-create --wallet <walletAddress> [--protocol escrow] [--intent '<json>']
npm run cli -- protocol escrow-accept --id <escrowId> --wallet <walletAddress> [--protocol escrow] [--intent '<json>']
npm run cli -- protocol escrow-release --id <escrowId> --wallet <walletAddress> [--protocol escrow] [--intent '<json>']
npm run cli -- protocol escrow-refund --id <escrowId> --wallet <walletAddress> [--protocol escrow] [--intent '<json>']
npm run cli -- protocol escrow-dispute --id <escrowId> --wallet <walletAddress> [--protocol escrow] [--intent '<json>']
npm run cli -- protocol escrow-resolve --id <escrowId> --wallet <walletAddress> [--protocol escrow] [--intent '<json>']

npm run cli -- risk protocols
npm run cli -- risk protocol-get <protocol>
npm run cli -- risk protocol-set <protocol> --input '<json>'
npm run cli -- risk portfolio
npm run cli -- risk portfolio-get <walletId>
npm run cli -- risk portfolio-set <walletId> --input '<json>'
npm run cli -- risk chaos
npm run cli -- risk chaos-set [--enabled true|false] [--failure-rates '<json>'] [--latency-ms <ms>]

npm run cli -- strategy backtest --wallet-id <walletId> --name <name> --steps '<jsonArray>' [--minimum-pass-rate <rate>]
npm run cli -- strategy paper-execute --agent-id <agentId> --wallet-id <walletId> --type <intentType> --protocol <protocol> [--intent '<json>' | --intent-file <path>]
npm run cli -- strategy paper-list <agentId>

npm run cli -- treasury allocate --target-agent-id <agentId> --lamports <lamports> [--source-agent-id <agentId>] [--reason <reason>]
npm run cli -- treasury rebalance --source-agent-id <agentId> --target-agent-id <agentId> --lamports <lamports> [--reason <reason>]

npm run cli -- mcp tools
npm run cli -- mcp call <tool> [--args '<json>' | --args-file <path>]

npm run cli -- audit events [--tx-id <txId>] [--agent-id <agentId>] [--wallet-id <walletId>] [--protocol <protocol>] [--escrow-id <escrowId>]
npm run cli -- audit metrics
```

### 3.3 Typed SDK (`packages/sdk`)

Create client:
```ts
const client = createAgenticWalletClient(baseUrl, { apiKey, tenantId });
```

Exposed modules:
1. `wallet`
2. `policy`
3. `transaction`
4. `agent`
5. `protocol`
6. `risk`
7. `strategy`
8. `treasury`
9. `audit`
10. `mcp`

### 3.4 MCP tools

Endpoints:
1. `GET /mcp/tools`
2. `POST /mcp/call`

Current tool names:
1. `wallet.create`
2. `wallet.balance`
3. `tx.create`
4. `tx.get`
5. `policy.evaluate`
6. `protocol.quote`
7. `agent.execute`
8. `risk.get_protocol`
9. `risk.set_protocol`
10. `gateway.request` (schema-validated generic `/api/v1/*` proxy)

## 4) HTTP API Surface (Current)

### 4.1 Health
1. `GET /health` (gateway)
2. `GET http://localhost:3006/health` (transaction-engine direct; includes `rpcPool` + `outbox` stats)

### 4.2 Wallet
1. `GET /api/v1/wallets`
2. `POST /api/v1/wallets`
3. `GET /api/v1/wallets/:walletId`
4. `GET /api/v1/wallets/:walletId/balance`
5. `GET /api/v1/wallets/:walletId/tokens`
6. `POST /api/v1/wallets/:walletId/sign`

### 4.3 Policy
1. `POST /api/v1/policies`
2. `PUT /api/v1/policies/:policyId`
3. `GET /api/v1/wallets/:walletId/policies`
4. `GET /api/v1/policies/:policyId/versions`
5. `GET /api/v1/policies/:policyId/versions/:version`
6. `POST /api/v1/policies/compatibility-check`
7. `POST /api/v1/policies/:policyId/migrate`
8. `POST /api/v1/evaluate`

### 4.4 Agent Runtime
1. `POST /api/v1/agents`
2. `GET /api/v1/agents`
3. `GET /api/v1/agents/:agentId`
4. `PUT /api/v1/agents/:agentId/capabilities`
5. `POST /api/v1/agents/:agentId/start`
6. `POST /api/v1/agents/:agentId/stop`
7. `POST /api/v1/agents/:agentId/pause`
8. `POST /api/v1/agents/:agentId/resume`
9. `GET /api/v1/agents/:agentId/budget`
10. `GET /api/v1/agents/:agentId/autonomy/state`
11. `POST /api/v1/agents/:agentId/manifest/issue`
12. `POST /api/v1/agents/:agentId/manifest/verify`
13. `POST /api/v1/agents/:agentId/execute`

### 4.5 Transaction Engine
1. `POST /api/v1/transactions`
2. `GET /api/v1/transactions/:txId`
3. `POST /api/v1/transactions/:txId/retry`
4. `POST /api/v1/transactions/:txId/approve`
5. `POST /api/v1/transactions/:txId/reject`
6. `GET /api/v1/transactions/:txId/proof`
7. `GET /api/v1/transactions/:txId/replay`
8. `GET /api/v1/wallets/:walletId/transactions`
9. `GET /api/v1/wallets/:walletId/pending-approvals`
10. `GET /api/v1/wallets/:walletId/positions`
11. `GET /api/v1/wallets/:walletId/escrows`

### 4.6 Protocol Adapters
1. `GET /api/v1/protocols`
2. `GET /api/v1/protocols/:protocol/capabilities`
3. `GET /api/v1/protocols/:protocol/version`
4. `GET /api/v1/protocols/health`
5. `GET /api/v1/protocols/:protocol/health`
6. `POST /api/v1/protocols/:protocol/compatibility-check`
7. `POST /api/v1/protocols/:protocol/migrate-intent`
8. `POST /api/v1/defi/quote`
9. `POST /api/v1/defi/swap`
10. `POST /api/v1/defi/stake`
11. `POST /api/v1/defi/unstake`
12. `POST /api/v1/defi/lend/supply`
13. `POST /api/v1/defi/lend/borrow`
14. `POST /api/v1/escrow/create`
15. `POST /api/v1/escrow/:id/accept`
16. `POST /api/v1/escrow/:id/release`
17. `POST /api/v1/escrow/:id/refund`
18. `POST /api/v1/escrow/:id/dispute`
19. `POST /api/v1/escrow/:id/resolve`
20. `POST /api/v1/build`

### 4.7 Treasury / Strategy
1. `POST /api/v1/treasury/allocate`
2. `POST /api/v1/treasury/rebalance`
3. `POST /api/v1/strategy/backtest`
4. `POST /api/v1/strategy/paper/execute`
5. `GET /api/v1/strategy/paper/:agentId`

### 4.8 Risk / Chaos
1. `GET /api/v1/risk/protocols`
2. `GET /api/v1/risk/protocols/:protocol`
3. `PUT /api/v1/risk/protocols/:protocol`
4. `GET /api/v1/risk/portfolio`
5. `GET /api/v1/risk/portfolio/:walletId`
6. `PUT /api/v1/risk/portfolio/:walletId`
7. `GET /api/v1/chaos`
8. `PUT /api/v1/chaos`

### 4.9 Audit / Metrics
1. `POST /api/v1/audit/events`
2. `GET /api/v1/audit/events`
3. `POST /api/v1/metrics/inc`
4. `GET /api/v1/metrics`

## 5) Canonical Schemas and Payload Contracts

### 5.1 Wallet create
```json
{ "label": "optional string" }
```

### 5.2 Wallet sign
Exactly one of:
```json
{ "transaction": "base64" }
```
or
```json
{ "message": "base64" }
```

### 5.3 Transaction create
```json
{
  "walletId": "uuid",
  "agentId": "uuid optional",
  "type": "transactionType",
  "protocol": "string",
  "gasless": false,
  "idempotencyKey": "optional string",
  "intent": {}
}
```

Supported `type` values:
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
12. `create_escrow`
13. `accept_escrow`
14. `release_escrow`
15. `refund_escrow`
16. `dispute_escrow`
17. `resolve_dispute`
18. `create_milestone_escrow`
19. `release_milestone`
20. `x402_pay`
21. `flash_loan_bundle`
22. `cpi_call`
23. `custom_instruction_bundle`
24. `treasury_allocate`
25. `treasury_rebalance`
26. `paper_trade`

Common intent payload expectations:
1. `transfer_sol`: `{ "destination": "base58", "lamports": <number> }`
2. `transfer_spl`: `{ "destination": "base58", "mint": "base58", "amount": "string|number" }`
3. `query_balance`: `{}`
4. `query_positions`: `{}`

Notes:
1. `query_*` types are read-only and do not produce on-chain signatures.
2. `transfer_sol` prechecks rent floor for unfunded recipient accounts.

### 5.4 Policy create
```json
{
  "walletId": "uuid",
  "name": "string",
  "active": true,
  "rules": [
    { "type": "spending_limit", "maxLamportsPerTx": 1000000, "maxLamportsPerDay": 10000000, "requireApprovalAboveLamports": 500000 },
    { "type": "protocol_allowlist", "protocols": ["system-program", "jupiter"] }
  ]
}
```

Rule types:
1. `spending_limit`
2. `address_allowlist`
3. `address_blocklist`
4. `program_allowlist`
5. `token_allowlist`
6. `protocol_allowlist`
7. `rate_limit`
8. `time_window`
9. `max_slippage`
10. `protocol_risk`
11. `portfolio_risk`

### 5.5 Policy evaluate
```json
{
  "walletId": "uuid",
  "agentId": "uuid optional",
  "type": "string",
  "protocol": "string",
  "destination": "optional",
  "tokenMint": "optional",
  "amountLamports": 1000,
  "programIds": [],
  "slippageBps": 50
}
```

### 5.6 Agent create
```json
{
  "name": "string",
  "walletId": "uuid optional",
  "executionMode": "autonomous|supervised",
  "allowedIntents": ["transfer_sol", "query_balance"],
  "autonomy": {
    "enabled": true,
    "mode": "execute|paper",
    "cadenceSeconds": 30,
    "maxActionsPerHour": 60,
    "steps": [
      {
        "id": "step-1",
        "type": "swap",
        "protocol": "jupiter",
        "intent": {
          "inputMint": "So11111111111111111111111111111111111111112",
          "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "amount": "1000000",
          "slippageBps": 50
        },
        "cooldownSeconds": 30,
        "maxRuns": 100
      }
    ],
    "rules": [
      {
        "id": "rule-1",
        "when": [{ "metric": "balance_lamports", "op": "lt", "value": 1000000 }],
        "then": { "type": "query_balance", "protocol": "system-program", "intent": {} },
        "cooldownSeconds": 60
      }
    ]
  },
  "budgetLamports": 1000000
}
```

### 5.7 Agent execute
```json
{
  "type": "transactionType",
  "protocol": "string",
  "gasless": false,
  "intent": {}
}
```

### 5.8 Manifest issue
```json
{
  "allowedIntents": ["transfer_sol"],
  "allowedProtocols": ["system-program"],
  "ttlSeconds": 3600
}
```

### 5.9 Treasury
Allocate:
```json
{ "targetAgentId": "uuid", "lamports": 100000, "reason": "string", "sourceAgentId": "uuid optional" }
```
Rebalance:
```json
{ "sourceAgentId": "uuid", "targetAgentId": "uuid", "lamports": 100000, "reason": "string" }
```

### 5.10 Strategy
Backtest:
```json
{
  "walletId": "uuid",
  "name": "string",
  "minimumPassRate": 0.7,
  "steps": [
    { "type": "query_balance", "protocol": "system-program", "intent": {}, "timestamp": "ISO-8601" }
  ]
}
```
Paper execute:
```json
{ "agentId": "uuid", "walletId": "uuid", "type": "transactionType", "protocol": "string", "intent": {} }
```

### 5.11 Risk / chaos
Protocol risk upsert (`PUT /api/v1/risk/protocols/:protocol`) accepts partial config fields including:
1. `maxSlippageBps`
2. `maxPoolConcentrationBps`
3. `allowedPools`
4. `allowedPrograms`
5. `oracleDeviationBps`
6. `requireOracleForSwap`
7. `maxQuoteAgeSeconds`
8. `deltaVarianceBpsThreshold`
9. `gaslessEligible`

Portfolio risk upsert (`PUT /api/v1/risk/portfolio/:walletId`) accepts partial controls including:
1. `maxDrawdownLamports`
2. `maxDailyLossLamports`
3. `maxExposureBpsPerToken`
4. `maxExposureBpsPerProtocol`
5. `autoPauseOnBreach`

Chaos upsert:
```json
{ "enabled": false, "failureRates": { "simulation": 0.1 }, "latencyMs": 0 }
```

## 6) Runtime Lifecycle and Async Semantics

Canonical lifecycle:
`pending -> simulating -> policy_eval -> approval_gate -> signing -> submitting -> confirmed|failed`

Behavior rules:
1. `POST /api/v1/transactions` can return `201`, `202`, or `500` based on current state.
2. Use `GET /api/v1/transactions/:txId` polling for final state.
3. If `approval_gate`, call `/approve` or `/reject`.
4. `idempotencyKey` replays prior record when identical key is reused.
5. Durable outbox is SQLite-backed and used for create/retry/approve processing.

Read-only intents:
1. `query_balance`
2. `query_positions`

These confirm without on-chain signing/submission.

## 7) Reliability and Solana Execution

### 7.1 RPC and fee tuning
1. Health-scored RPC pool failover via `SOLANA_RPC_POOL_URLS`
2. Adaptive compute budget and priority fee from recent fee samples
3. Background endpoint probes and runtime health scoring
4. Durable outbox queue with lease/retry/dedupe/recovery persisted in SQLite

### 7.2 Rent preflight and delta guard
1. `transfer_sol` validates unfunded destination rent threshold before execution
2. Delta guard checks expected vs observed lamport movement
3. Absolute lamport tolerance avoids false positive fee-noise pauses
4. Auto-pause on delta breach respects wallet `autoPauseOnBreach` control

### 7.3 Gasless path
1. `gasless=true` routes submit through Kora RPC path
2. Per-protocol `gaslessEligible` gate is enforced before submission

### 7.4 Env knobs (current)
1. `SOLANA_RPC_URL`
2. `SOLANA_RPC_POOL_URLS`
3. `SOLANA_RPC_HEALTH_PROBE_MS`
4. `SOLANA_RPC_MAX_RETRIES`
5. `SOLANA_RPC_RETRY_DELAY_MS`
6. `SOLANA_PRIORITY_FEE_MIN_MICROLAMPORTS`
7. `SOLANA_PRIORITY_FEE_MAX_MICROLAMPORTS`
8. `SOLANA_PRIORITY_FEE_PERCENTILE`
9. `SOLANA_PRIORITY_FEE_MULTIPLIER_BPS`
10. `DELTA_GUARD_ABSOLUTE_TOLERANCE_LAMPORTS`
11. `TX_OUTBOX_LEASE_MS`
12. `TX_OUTBOX_POLL_MS`
13. `TX_OUTBOX_MAX_ATTEMPTS`
14. `KORA_RPC_URL`
15. `TRANSACTION_ENGINE_DB_PATH`
16. `AGENT_RUNTIME_DB_PATH`
17. `POLICY_ENGINE_DB_PATH`
18. `AUDIT_OBSERVABILITY_DB_PATH`
19. `WALLET_ENGINE_DB_PATH`
20. `ESCROW_PROGRAM_ID`

## 8) Response Envelope and Error Semantics

Gateway normalizes to stable machine envelope:

```json
{
  "status": "success|failure",
  "errorCode": "VALIDATION_ERROR|POLICY_VIOLATION|PIPELINE_ERROR|CONFIRMATION_FAILED|null",
  "failedAt": "validation|policy|build|sign|send|confirm|completed|gateway|null",
  "stage": "validation|policy|build|sign|send|confirm|completed|gateway",
  "traceId": "uuid",
  "data": {},
  "error": "optional string",
  "errorMessage": "optional string"
}
```

Important current behavior:
1. `GET /api/v1/transactions/:txId` may return HTTP `200` but envelope `status="failure"` when transaction `data.status="failed"`.
2. Agents must key control flow from envelope `status`, `errorCode`, and `stage`, not HTTP code alone.

Error code expectations:
1. `VALIDATION_ERROR`: schema/input mismatch
2. `POLICY_VIOLATION`: policy/capability/budget disallow
3. `PIPELINE_ERROR`: build/sign/send/runtime failures
4. `CONFIRMATION_FAILED`: explicit confirmation-stage failures

## 9) Agent Heartbeat Context (Scheduler)

Current scheduler context fields:
1. `tick`
2. `walletId`
3. `knownWallets`
4. `meta`
5. `balance`
6. `tokens`
7. `recentTransactions`
8. `openApprovals`
9. `protocolPositions`
10. `escrowSummary`
11. `policySummary`

## 10) Security Guardrails

1. Agent logic must never hold or print private keys.
2. Signing is only through wallet-engine sign boundary.
3. Keep execution pipeline ordering intact.
4. Simulate before submit whenever supported.
5. Default demos/tests to Solana devnet.
6. Do not bypass durable outbox for spend-capable actions.
7. Choose signer backend explicitly for production:
   - `WALLET_SIGNER_BACKEND=encrypted-file|memory|kms|hsm|mpc`
   - `kms`: set `WALLET_KMS_MASTER_SECRET` (+ optional `WALLET_KMS_KEY_ID`)
   - `hsm`: set `WALLET_HSM_PIN`, `WALLET_HSM_MODULE_SECRET` (+ optional `WALLET_HSM_SLOT`)
   - `mpc`: set `WALLET_MPC_NODE_SECRETS` CSV (3 secrets) or `WALLET_MPC_NODE1_SECRET..3`

## 11) Known Current Limitations

1. Persistence is now SQLite-backed, but still single-node; horizontal scale still needs Postgres + distributed queue infrastructure.
2. Solend/DEX adapters depend on external API contracts and availability; they now fail closed instead of returning synthetic fallback quotes.
3. Escrow adapter requires a deployed escrow program (`ESCROW_PROGRAM_ID`) and account wiring in intent; this repo does not ship a deployed escrow program artifact.
4. MCP includes a validated generic `gateway.request` tool, but named high-level MCP wrappers are still curated (not exhaustive one-by-one parity wrappers).

## 12) Minimal Integration Runbook

1. `npm install`
2. `cp .env.example .env`
3. `npm run dev`
4. Create wallet/agent
5. Attach policy
6. Execute intent
7. Poll tx until `confirmed|failed`
8. If `approval_gate`, call `/approve` or `/reject`
9. Collect `/proof`, `/replay`, `/audit/events`, `/metrics`

Suggested smoke commands:
```bash
npm run devnet:smoke
npm run devnet:multi-agent
npm run devnet:protocol-matrix
```

## 13) Output Contract for Agents

For substantial runs, return:
1. interface used (CLI/API/SDK/MCP)
2. commands or API calls executed
3. wallet/agent/tx IDs and signatures
4. final statuses and policy decisions
5. proof/replay references
6. remaining risks or TODOs
