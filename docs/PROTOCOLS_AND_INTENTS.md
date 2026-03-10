# Protocols and Intents Reference

This guide maps intent types to protocols, required payload fields, and runtime
behavior in the current implementation.

## 1. Intent Taxonomy

Transaction types are defined in shared schema and include:

- transfer and balance:
  - `transfer_sol`, `transfer_spl`, `query_balance`, `query_positions`
- swap/stake/lending:
  - `swap`, `stake`, `unstake`, `lend_supply`, `lend_borrow`
- token lifecycle:
  - `create_mint`, `mint_token`
- escrow family:
  - `create_escrow`, `accept_escrow`, `release_escrow`, `refund_escrow`,
    `dispute_escrow`, `resolve_dispute`, `create_milestone_escrow`,
    `release_milestone`, `x402_pay`
- advanced/restricted:
  - `flash_loan_bundle`, `cpi_call`, `custom_instruction_bundle`
- treasury/strategy helpers:
  - `treasury_allocate`, `treasury_rebalance`, `paper_trade`

## 2. Pipeline Semantics by Intent Class

### 2.1 Read-only intents

- `query_balance`, `query_positions`
- no on-chain spend path
- no signing required
- status transitions directly to `confirmed`

### 2.2 Spend-capable intents

- simulation, risk, policy, signing, submit, confirm stages apply
- can be denied or approval-gated before signing

### 2.3 Restricted intents

- `flash_loan_bundle`, `cpi_call`, `custom_instruction_bundle`
- treated as high-risk and typically approval-oriented by design

## 3. Minimal Intent Payloads (Practical)

### 3.1 `transfer_sol` (`system-program`)

```json
{
  "destination": "<recipient-pubkey>",
  "lamports": 1000000
}
```

### 3.2 `transfer_spl` (`spl-token`)

```json
{
  "destination": "<recipient-pubkey>",
  "mint": "<token-mint>",
  "amount": 1000000
}
```

### 3.3 `swap` (`jupiter|orca|raydium`)

```json
{
  "inputMint": "So11111111111111111111111111111111111111112",
  "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amount": "1000000",
  "slippageBps": 50
}
```

### 3.4 `stake` / `unstake` (`marinade`)

```json
{
  "amount": "1000000"
}
```

Optional:

```json
{
  "validator": "<validator-pubkey>"
}
```

### 3.5 `lend_supply` / `lend_borrow` (`solend`)

```json
{
  "mint": "So11111111111111111111111111111111111111112",
  "amount": "1000000"
}
```

Optional:

```json
{
  "marketAddress": "<solend-market-address>"
}
```

### 3.6 `create_escrow` (`escrow`)

```json
{
  "counterparty": "<recipient-pubkey>",
  "amount": "1000000",
  "escrowId": "1"
}
```

Optional fields include `arbiter`, `feeRecipient`, `deadlineUnixSec`,
`feeBasisPoints`, `termsHash`, `terms`, `memo`.

### 3.7 Escrow follow-up actions

- accept:

```json
{
  "escrowId": "1"
}
```

- release:

```json
{
  "escrowId": "1",
  "counterparty": "<recipient-pubkey>"
}
```

- dispute:

```json
{
  "escrowId": "1",
  "reason": "counterparty did not deliver"
}
```

- resolve:

```json
{
  "escrowId": "1",
  "winner": "creator"
}
```

## 4. Protocol Adapter Matrix

| Protocol | Primary Intents | Notes |
|---|---|---|
| `system-program` | `transfer_sol`, `query_balance` | direct native SOL flows |
| `spl-token` | `transfer_spl`, mint ops | SPL token account rules apply |
| `jupiter` | `swap` | quote/build route behavior and risk limits |
| `marinade` | `stake`, `unstake` | stake lifecycle flows |
| `solend` | `lend_supply`, `lend_borrow` | reserve/market dependent |
| `metaplex` | token/NFT-related build paths | adapter-specific build semantics |
| `orca` | `swap` | route availability dependent |
| `raydium` | `swap` | route availability dependent |
| `escrow` | escrow family intents | real Anchor escrow program integration |

## 5. Devnet Compatibility Modes

Certain adapters emit `buildMetadata.mode=devnet_compatibility` in known devnet
constraints.

Current compatibility reasons include:

- `jupiter_devnet_quote_not_available`
- `orca_devnet_route_not_available`
- `raydium_devnet_route_not_available`
- `marinade_devnet_execution_compatibility`
- `solend_devnet_execution_compatibility`
- `insufficient_balance_for_escrow_rent` (escrow create path)

Operational interpretation:

- execution can still confirm and produce tx proof/audit data
- metadata explicitly records compatibility fallback reason
- do not assume mainnet-equivalent economic semantics for these fallback paths

## 6. Risk and Policy Interaction

Intent execution is constrained by both protocol-risk and policy rules.

### 6.1 Protocol risk controls (examples)

- `maxSlippageBps`
- `maxPoolConcentrationBps`
- `allowedPools`
- `allowedPrograms`
- `oracleDeviationBps`
- `requireOracleForSwap`
- `maxQuoteAgeSeconds`
- `deltaVarianceBpsThreshold`
- `gaslessEligible`

### 6.2 Policy rule controls (examples)

- `spending_limit`
- `address_allowlist` / `address_blocklist`
- `program_allowlist`
- `token_allowlist`
- `protocol_allowlist`
- `rate_limit`
- `time_window`
- `max_slippage`
- `protocol_risk`
- `portfolio_risk`

## 7. Intent Safety Preconditions

### 7.1 SOL transfer

- destination account rent economics can matter if account is unfunded
- source wallet must cover transfer amount + fee

### 7.2 SPL transfer

- source ATA must exist and contain token balance
- destination ATA creation may be required

### 7.3 Swap

- route/quote availability required
- slippage and quote age checks may deny execution

### 7.4 Lending

- valid reserve for mint required
- borrow path requires collateral/obligation context

### 7.5 Escrow

- `ESCROW_PROGRAM_ID` must be configured and deployed
- create path requires amount plus rent/fee economics

## 8. Gasless (`gasless=true`) Interaction

- gasless does not bypass validation/policy/risk
- protocol `gaslessEligible` controls whether gasless is allowed
- final submit path uses Kora when enabled

## 9. Common Failure Classes by Intent

- validation failures: malformed payload or missing required fields
- policy/risk denial: slippage, allowlist, budget, or spend/rate/time violations
- simulation failures: precondition or on-chain instruction errors
- confirmation failures: RPC or chain confirmation issues

Use normalized fields (`errorCode`, `stage`, `traceId`) for deterministic
client handling.

## 10. Agent Integration Patterns

### 10.1 Direct transaction create

Use `/api/v1/transactions` for explicit wallet-level execution.

### 10.2 Agent execute

Use `/api/v1/agents/:agentId/execute` to enforce per-agent capability and budget
controls before delegating to transaction-engine.

### 10.3 MCP integration

Use named MCP tools for common flows; use `gateway.request` for full route
coverage.

## 11. Recommended Production Policy Defaults

- strict protocol/program allowlists
- conservative slippage limits
- spending limits per tx/day
- rate limiting for autonomous agents
- approval requirement for critical intent classes

## 12. Cross-Links

- API contracts: `docs/API_REFERENCE.md`
- Architecture details: `docs/ARCHITECTURE.md`
- Security controls: `docs/SECURITY.md`
- Agent contract: `SKILLS.md`
