# API Reference

This document describes the external API contract exposed through the gateway
(`http://localhost:3000` by default).

All examples assume:

- `x-api-key: dev-api-key`
- `Content-Type: application/json`

## 1. Base Contract

### 1.1 Base URL

- `API_BASE_URL` default: `http://localhost:3000`

### 1.2 Required Headers

- `x-api-key` (required when `API_GATEWAY_ENFORCE_AUTH=true`)
- `x-tenant-id` (optional, required only if your key is tenant-scoped)
- `x-trace-id` (optional; if omitted, gateway generates one)

### 1.3 Machine Response Envelope

Gateway normalizes proxied responses to include:

- `status`: `success` or `failure`
- `errorCode`: one of
  - `VALIDATION_ERROR`
  - `POLICY_VIOLATION`
  - `PIPELINE_ERROR`
  - `CONFIRMATION_FAILED`
- `failedAt`: pipeline stage
- `stage`: pipeline stage
- `traceId`: correlation id

Pipeline stage values:

- `validation`
- `policy`
- `build`
- `sign`
- `send`
- `confirm`
- `completed`
- `gateway`

## 2. Health and Topology

### 2.1 Gateway health

- `GET /health`
- returns gateway status, auth config summary, and backend target URLs

Example:

```bash
curl -sS http://localhost:3000/health
```

## 3. Wallet APIs

### 3.1 Create wallet

- `POST /api/v1/wallets`
- body (common):
  - `label?: string`
  - `autoFund?: boolean`
  - `fundLamports?: number`

### 3.2 List wallets

- `GET /api/v1/wallets`
- optional query:
  - `publicKey`

### 3.3 Get wallet metadata

- `GET /api/v1/wallets/:walletId`

### 3.4 Get SOL balance

- `GET /api/v1/wallets/:walletId/balance`

### 3.5 Get SPL token balances

- `GET /api/v1/wallets/:walletId/tokens`

### 3.6 Sign transaction/message

- `POST /api/v1/wallets/:walletId/sign`
- body supports transaction or message signing payloads

## 4. Transaction APIs

### 4.1 Create transaction

- `POST /api/v1/transactions`
- key fields:
  - `walletId`
  - `agentId?`
  - `type`
  - `protocol`
  - `intent`
  - `gasless?`
  - `idempotencyKey?`
  - optional prebuilt payloads (`transaction`, `instructions`)

### 4.2 Get transaction

- `GET /api/v1/transactions/:txId`

### 4.3 Proof and replay

- `GET /api/v1/transactions/:txId/proof`
- `GET /api/v1/transactions/:txId/replay`

### 4.4 Recovery/approval actions

- `POST /api/v1/transactions/:txId/retry`
- `POST /api/v1/transactions/:txId/approve`
- `POST /api/v1/transactions/:txId/reject`

### 4.5 Wallet-scoped views

- `GET /api/v1/wallets/:walletId/transactions`
- `GET /api/v1/wallets/:walletId/pending-approvals`
- `GET /api/v1/wallets/:walletId/positions`
- `GET /api/v1/wallets/:walletId/escrows`

## 5. Policy APIs

### 5.1 Policy CRUD/versioning

- `POST /api/v1/policies`
- `PUT /api/v1/policies/:policyId`
- `GET /api/v1/wallets/:walletId/policies`
- `GET /api/v1/policies/:policyId/versions`
- `GET /api/v1/policies/:policyId/versions/:version`

### 5.2 Policy migration and compatibility

- `POST /api/v1/policies/compatibility-check`
- `POST /api/v1/policies/:policyId/migrate`

### 5.3 Evaluate request against policy

- `POST /api/v1/evaluate`

## 6. Agent Runtime APIs

### 6.1 Lifecycle

- `POST /api/v1/agents`
- `GET /api/v1/agents`
- `DELETE /api/v1/agents`
- `GET /api/v1/agents/:agentId`
- `POST /api/v1/agents/:agentId/start`
- `POST /api/v1/agents/:agentId/stop`
- `POST /api/v1/agents/:agentId/pause`
- `POST /api/v1/agents/:agentId/resume`

### 6.2 Capabilities and governance

- `PUT /api/v1/agents/:agentId/capabilities`
- `POST /api/v1/agents/:agentId/manifest/issue`
- `POST /api/v1/agents/:agentId/manifest/verify`

### 6.3 Agent status and execution

- `GET /api/v1/agents/:agentId/budget`
- `GET /api/v1/agents/:agentId/autonomy/state`
- `POST /api/v1/agents/:agentId/execute`

### 6.4 Strategy and treasury

- `POST /api/v1/strategy/backtest`
- `POST /api/v1/strategy/paper/execute`
- `GET /api/v1/strategy/paper/:agentId`
- `POST /api/v1/treasury/allocate`
- `POST /api/v1/treasury/rebalance`

## 7. Protocol Adapter APIs

### 7.1 Registry and health

- `GET /api/v1/protocols`
- `GET /api/v1/protocols/:protocol/capabilities`
- `GET /api/v1/protocols/:protocol/version`
- `GET /api/v1/protocols/health`
- `GET /api/v1/protocols/:protocol/health`

### 7.2 Compatibility/migration

- `POST /api/v1/protocols/:protocol/compatibility-check`
- `POST /api/v1/protocols/:protocol/migrate-intent`

### 7.3 DeFi helper endpoints

- `POST /api/v1/defi/quote`
- `POST /api/v1/defi/swap`
- `POST /api/v1/defi/stake`
- `POST /api/v1/defi/unstake`
- `POST /api/v1/defi/lend/supply`
- `POST /api/v1/defi/lend/borrow`

### 7.4 Escrow helper endpoints

- `POST /api/v1/escrow/create`
- `POST /api/v1/escrow/:id/accept`
- `POST /api/v1/escrow/:id/release`
- `POST /api/v1/escrow/:id/refund`
- `POST /api/v1/escrow/:id/dispute`
- `POST /api/v1/escrow/:id/resolve`

### 7.5 Generic build endpoint

- `POST /api/v1/build`

Request shape:

```json
{
  "protocol": "jupiter",
  "type": "swap",
  "walletAddress": "<base58>",
  "intent": {}
}
```

## 8. Risk and Chaos APIs

### 8.1 Protocol risk

- `GET /api/v1/risk/protocols`
- `GET /api/v1/risk/protocols/:protocol`
- `PUT /api/v1/risk/protocols/:protocol`

### 8.2 Portfolio risk

- `GET /api/v1/risk/portfolio`
- `GET /api/v1/risk/portfolio/:walletId`
- `PUT /api/v1/risk/portfolio/:walletId`

### 8.3 Chaos switchboard

- `GET /api/v1/chaos`
- `PUT /api/v1/chaos`

## 9. Audit and Metrics APIs

- `POST /api/v1/audit/events`
- `GET /api/v1/audit/events`
- `POST /api/v1/metrics/inc`
- `GET /api/v1/metrics`

## 10. MCP APIs

Gateway pass-through to mcp-server:

- `ALL /mcp`
- `ALL /mcp/*`

Note:

- unlike `/api/v1/*`, MCP routes are passthrough and not wrapped in the same
  machine error envelope from gateway.

## 11. Common Examples

### 11.1 Create wallet

```bash
curl -sS -X POST "http://localhost:3000/api/v1/wallets" \
  -H "x-api-key: dev-api-key" \
  -H "content-type: application/json" \
  -d '{"label":"demo","autoFund":true,"fundLamports":2000000}'
```

### 11.2 Create transaction

```bash
curl -sS -X POST "http://localhost:3000/api/v1/transactions" \
  -H "x-api-key: dev-api-key" \
  -H "content-type: application/json" \
  -d '{
    "walletId":"<wallet-id>",
    "type":"transfer_sol",
    "protocol":"system-program",
    "intent":{"destination":"<pubkey>","lamports":1000000}
  }'
```

### 11.3 Get transaction proof

```bash
curl -sS "http://localhost:3000/api/v1/transactions/<tx-id>/proof" \
  -H "x-api-key: dev-api-key"
```

### 11.4 Set protocol risk profile

```bash
curl -sS -X PUT "http://localhost:3000/api/v1/risk/protocols/jupiter" \
  -H "x-api-key: dev-api-key" \
  -H "content-type: application/json" \
  -d '{"maxSlippageBps":50,"gaslessEligible":true}'
```

## 12. Error Handling Guidance for Integrators

Recommended handling logic:

1. branch on `status` (`success` vs `failure`)
2. on failure, classify by `errorCode`
3. read `stage`/`failedAt` for retry strategy
4. always log `traceId`

Suggested retry policy:

- `VALIDATION_ERROR`: do not retry until payload corrected
- `POLICY_VIOLATION`: do not retry unchanged payload
- `PIPELINE_ERROR`: retry depending on stage and idempotency strategy
- `CONFIRMATION_FAILED`: safe retry path with tx-specific policy

## 13. Backward Compatibility Notes

- Legacy intent runners and helper scripts are supported (`npm run intent-runner`, `npm run wallets`).
- Migration endpoints exist for policy and adapter intent compatibility.
- Gateway machine envelope provides stable fields for orchestrators.

## 14. Cross-Links

- Architecture model: `docs/ARCHITECTURE.md`
- Intent/protocol details: `docs/PROTOCOLS_AND_INTENTS.md`
- Security and hardening: `docs/SECURITY.md`
- Operational procedures: `docs/OPERATIONS_RUNBOOK.md`
