# Operations Runbook

This runbook covers daily operation, debugging, and recovery for the multi-service
Agentic Wallet stack.

## 1. Runtime Topology

Default local ports:

- gateway: `3000`
- wallet-engine: `3002`
- policy-engine: `3003`
- agent-runtime: `3004`
- protocol-adapters: `3005`
- transaction-engine: `3006`
- audit-observability: `3007`
- mcp-server: `3008`

## 2. Environment Baseline

Copy and edit `.env` from `.env.example`.

Critical variables:

- `SOLANA_RPC_URL`
- `SOLANA_RPC_POOL_URLS`
- `WALLET_KEY_ENCRYPTION_SECRET`
- `API_GATEWAY_ENFORCE_AUTH`
- `API_GATEWAY_API_KEYS`
- `AGENT_MANIFEST_SIGNING_SECRET`
- `ESCROW_PROGRAM_ID` (if escrow execution required)

Optional but important:

- `WALLET_AUTOFUND_PAYER_PRIVATE_KEY` or `PRIVATE_KEY` for auto-fund
- `KORA_RPC_URL` and `KORA_PRIVATE_KEY` for gasless mode
- signer backend envs for `kms|hsm|mpc`

## 3. Start/Stop Procedures

### 3.1 Start full stack

```bash
npm run dev
```

### 3.2 Start only CLI

```bash
npm run cli
```

### 3.3 Stop

- foreground mode: `Ctrl+C`
- if stale ports remain, kill by port and restart cleanly

## 4. Smoke Validation (Operator Minimum)

1. health

```bash
npm run cli -- doctor --raw
```

2. wallet create + auto-fund

```bash
npm run cli -- -q --raw wallet create ops-smoke --auto-fund --fund-lamports 2000000
```

3. balance read

```bash
npm run cli -- -q --raw wallet balance <wallet-id>
```

4. transaction smoke (`query_balance` or tiny `transfer_sol`)

5. metrics check

```bash
npm run cli -- -q --raw audit metrics
```

## 5. Deep Validation Paths

For judge/demo-grade checks:

- `npm run demo:judge`
- `npm run devnet:protocol-matrix`
- `npm run devnet:multi-agent`
- `npm run devnet:multi-agent:load`

Outputs are typically written to `docs/DEMO_RESULTS.md` or script-defined paths.

## 6. Service Health Diagnostics

### 6.1 Gateway health

```bash
curl -sS http://localhost:3000/health
```

### 6.2 Protocol adapter health

```bash
curl -sS http://localhost:3000/api/v1/protocols/health -H 'x-api-key: dev-api-key'
```

### 6.3 Escrow health

```bash
curl -sS http://localhost:3000/api/v1/protocols/escrow/health -H 'x-api-key: dev-api-key'
```

## 7. Common Incidents and Fixes

### 7.1 `EADDRINUSE` on startup

Symptoms:

- service fails with `listen EADDRINUSE`

Actions:

1. find processes using ports `3000..3008`
2. terminate stale node processes
3. restart stack

### 7.2 Wallet create auto-fund fails

Symptoms:

- error about missing payer key

Actions:

1. set `WALLET_AUTOFUND_PAYER_PRIVATE_KEY` or `PRIVATE_KEY`
2. ensure payer has devnet SOL
3. retry wallet creation

### 7.3 Transfer fails with rent-related or custom instruction errors

Symptoms:

- transfer to new address fails due rent/exemption economics

Actions:

1. ensure destination is funded enough when creating new system account
2. use auto-fund on test wallets
3. retry with adequate lamports

### 7.4 Agent gets paused unexpectedly

Symptoms:

- `Agent is paused` in execution

Actions:

1. inspect latest tx via `tx list --wallet-id ...`
2. inspect `deltaGuard` and failure reason
3. resume agent after issue correction:

```bash
npm run cli -- -q --raw agent resume <agent-id>
```

### 7.5 Policy denies unexpectedly

Actions:

1. list policies for wallet
2. inspect current policy rules and version
3. run policy evaluate endpoint for dry-run diagnosis
4. adjust policy or payload

### 7.6 Jupiter/Orca/Raydium quote issues on devnet

Actions:

1. verify protocol health endpoints
2. check risk config (`maxSlippageBps`, quote age, allowlists)
3. if devnet quote unavailable, confirm compatibility path behavior and metadata

### 7.7 Escrow execution failure

Actions:

1. verify `ESCROW_PROGRAM_ID` is set and deployed
2. ensure wallet has enough lamports for escrow amount + account rent + fees
3. verify escrow adapter health endpoint

### 7.8 Gasless/Kora submit failures

Actions:

1. confirm Kora is running:

```bash
npm run kora:validate
npm run kora:start
```

2. verify `KORA_RPC_URL`
3. verify Kora signer key config
4. retry with `gasless=false` to isolate Kora-specific failures

## 8. Data and State Management

### 8.1 Local data directories

Defaults are under service `data/` paths.

### 8.2 Safe reset for local dev only

Use only in local/test environments.

Recommended sequence:

1. stop services
2. back up data dirs and sqlite files
3. clear selected local state
4. restart and run smoke checks

### 8.3 Snapshot/outbox recovery

On restart, transaction-engine outbox workers recover pending jobs via leasing and
retry semantics. Validate by checking tx status progression and metrics counters.

## 9. Security Operations

### 9.1 Secrets handling

- do not commit `.env`
- rotate API keys and signing secrets regularly
- rotate encryption secret with planned rekey procedures

### 9.2 API key management

`API_GATEWAY_API_KEYS` supports `<key>:<tenant>:<scopes>` entries.

Operational practice:

- least-privilege scopes per automation/consumer
- separate keys per environment
- periodic rotation and revocation

### 9.3 Signing backend changes

When switching `WALLET_SIGNER_BACKEND`, verify backend-specific env vars before restart.

## 10. Change Management

Before release:

1. run checks

```bash
npm run ci:check
```

2. run judge/demo validation
3. update docs (`DEMO_RESULTS.md` and related runbooks)
4. capture versioned deployment notes

## 11. Observability Practices

### 11.1 Metrics to track

- tx state counters (`pending`, `policy_eval`, `confirmed`, `failed`)
- simulation failure frequency
- policy deny frequency
- confirmation latency totals

### 11.2 Audit review

Use audit event filters by txId/agentId/walletId/protocol for forensic flow reconstruction.

### 11.3 Trace correlation

Use `traceId` in gateway-normalized responses to correlate across services.

## 12. Capacity and Performance Notes

- high-volume devnet runs can hit RPC throttling
- tune retry/backoff and fee controls for sustained loads
- avoid overloading a single RPC endpoint; use pool URL list

## 13. Operational Hardening Backlog

Recommended priorities:

1. centralize/distribute rate-limit store
2. move from local-only durability to shared durable queue/state
3. add stronger multi-approver governance for high-risk operations
4. formalize incident drills and chaos tests in CI

## 14. Quick Command Appendix

```bash
# Full stack
npm run dev

# Doctor
npm run cli -- doctor --raw

# Create funded wallet
npm run cli -- -q --raw wallet create demo --auto-fund --fund-lamports 2000000

# Create agent
npm run cli -- -q --raw agent create bot --mode autonomous --intents query_balance transfer_sol --wallet-id <wallet-id>

# Execute intent
npm run cli -- -q --raw agent exec <agent-id> --type query_balance --protocol system-program --intent '{}'

# Metrics
npm run cli -- -q --raw audit metrics

# MCP tools
npm run cli -- -q --raw mcp tools
```
