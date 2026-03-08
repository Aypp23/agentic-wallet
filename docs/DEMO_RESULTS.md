# Demo Results

- Run timestamp (UTC): 2026-03-05T21:38:35.759Z
- RPC: `https://api.devnet.solana.com`
- Overall: **PASS** (36/36 passed)

## Capability Matrix

| Check | Category | Status | Tx ID | Tx Hash | Link | Notes |
|---|---|---|---|---|---|---|
| system.gateway_health | system | PASS | - | - | - | status=200 |
| wallet.create_fund | wallet | PASS | - | 3i1cDSxsCPPSopi6iCxR58DndL44CEzCoKwDuNSS5Eu4WmPM9b2dzszUEBGqERWsi3qAbsnvpieEL6Y3FpJTQQvw | [Explorer](https://explorer.solana.com/tx/3i1cDSxsCPPSopi6iCxR58DndL44CEzCoKwDuNSS5Eu4WmPM9b2dzszUEBGqERWsi3qAbsnvpieEL6Y3FpJTQQvw?cluster=devnet) | walletId=b7bc107e-3137-4a30-b0b5-630d071cbdf4 publicKey=J23vam17uUNtLzPkHX6RY71NiAAyPrniTr6NDVADL9wu |
| wallet.list | wallet | PASS | - | - | - | count=143 |
| wallet.get | wallet | PASS | - | - | - | provider=local-dev |
| wallet.balance | wallet | PASS | - | - | - | lamports=40000000 |
| wallet.tokens | wallet | PASS | - | - | - | tokenCount=0 |
| wallet.sign_message | wallet | PASS | - | - | - | signatureBase58.len=87 |
| tx.transfer_sol | transaction | PASS | 20343fc9-a53a-4a09-b381-0f5c2ded8f90 | 5ReHLuPxqSHwaMgESP4via8yBufEtaxz8B7nFYWJrK8awN9Cu9Y4umjXCQYGRSA13nfAhG7YVWQyBYw5rfPp5XC2 | [Explorer](https://explorer.solana.com/tx/5ReHLuPxqSHwaMgESP4via8yBufEtaxz8B7nFYWJrK8awN9Cu9Y4umjXCQYGRSA13nfAhG7YVWQyBYw5rfPp5XC2?cluster=devnet) | status=confirmed |
| tx.query_balance | transaction | PASS | 5a2b7f68-c5d9-46b5-86dc-1caa21e20ca4 | - | - | status=confirmed |
| tx.proof_replay | transaction | PASS | 20343fc9-a53a-4a09-b381-0f5c2ded8f90 | - | - | proof/replay fetched |
| protocol.system-program.interaction | protocol | PASS | a84a1c65-63f9-45ce-ba38-524263d4ee39 | 2vd771wywuC2z2c6b4VVeW4vqqxkhSWauDwcN7ZT8wsUU593z1V86gs7PRCA4MoFGtYp9vwFrGCJaCZuLbddbi1r | [Explorer](https://explorer.solana.com/tx/2vd771wywuC2z2c6b4VVeW4vqqxkhSWauDwcN7ZT8wsUU593z1V86gs7PRCA4MoFGtYp9vwFrGCJaCZuLbddbi1r?cluster=devnet) | capabilities=true health=true action=true (status=confirmed) |
| protocol.spl-token.interaction | protocol | PASS | - | - | - | capabilities=true health=true action=true (handled execution precondition: {"InstructionError":[2,"IncorrectProgramId"]} code=PIPELINE_ERROR stage=build traceId=141b9f47-423a-48e7-bc94-dd64a0d0b515) |
| protocol.jupiter.interaction | protocol | PASS | - | - | - | capabilities=true health=true action=true (quoteStatus=200) |
| protocol.marinade.interaction | protocol | PASS | - | - | - | capabilities=true health=true action=true (stakeBuild=200) |
| protocol.solend.interaction | protocol | PASS | - | - | - | capabilities=true health=true action=true (lendBuild=200) |
| protocol.metaplex.interaction | protocol | PASS | - | - | - | capabilities=true health=true action=true (build=200) |
| protocol.orca.interaction | protocol | PASS | - | - | - | capabilities=true health=true action=true (quoteStatus=200) |
| protocol.raydium.interaction | protocol | PASS | - | - | - | capabilities=true health=true action=true (quoteStatus=200) |
| protocol.escrow.interaction | protocol | PASS | 4c79a6ac-5cef-4a8e-8da7-c90478368236 | 5JJXSVPKosQ9SLkBu6rdQUScfbDQv8au6tp87XhkFcC2oPKxx3Ma424z7AgXuJrFEaf6FnNzshLWgT6pARJKbcVq | [Explorer](https://explorer.solana.com/tx/5JJXSVPKosQ9SLkBu6rdQUScfbDQv8au6tp87XhkFcC2oPKxx3Ma424z7AgXuJrFEaf6FnNzshLWgT6pARJKbcVq?cluster=devnet) | capabilities=true health=true action=true (status=confirmed) |
| policy.create | policy | PASS | - | - | - | policyId=4f0dde15-a0b8-4c31-b0dc-bc533a935fb4 |
| policy.approval_gate | policy | PASS | 1df23b18-5723-485c-8489-5873a9f54edf | - | - | txId=1df23b18-5723-485c-8489-5873a9f54edf status=approval_gate |
| policy.approve_execute | policy | PASS | 1df23b18-5723-485c-8489-5873a9f54edf | 4fghS6z9AgnxmkvPwobjHE1jPZ3H4eymJ6VRoGRkgVG2AnxoQDWeajAUTSJGewEfD9vn44n9d8kCSjHhN2ntU4L3 | [Explorer](https://explorer.solana.com/tx/4fghS6z9AgnxmkvPwobjHE1jPZ3H4eymJ6VRoGRkgVG2AnxoQDWeajAUTSJGewEfD9vn44n9d8kCSjHhN2ntU4L3?cluster=devnet) | status=confirmed |
| agent.create | agent | PASS | - | - | - | agentA=680bf302-5a9f-49e3-ba38-7b0a2244bd81 agentB=9002bcd7-8c21-451a-bbfb-cc939d582a62 |
| agent.start | agent | PASS | - | - | - | started=680bf302-5a9f-49e3-ba38-7b0a2244bd81,9002bcd7-8c21-451a-bbfb-cc939d582a62 |
| agent.manifest | agent | PASS | - | - | - | verified=true |
| agent.execute_transfer | agent | PASS | 164f11a3-bd6f-4101-9fe1-95d5fa4b89cb | FaFyKuepxmubFtzPHCY7jsT1PnvyMUABBQFBq8qvWyP5xz5WRvt4zJmB6DZ3PnYr98QKsRephu4cwM2sEgUnFMu | [Explorer](https://explorer.solana.com/tx/FaFyKuepxmubFtzPHCY7jsT1PnvyMUABBQFBq8qvWyP5xz5WRvt4zJmB6DZ3PnYr98QKsRephu4cwM2sEgUnFMu?cluster=devnet) | status=confirmed |
| agent.budget | agent | PASS | - | - | - | budgetPresent=true |
| risk.protocol_get_set | risk | PASS | - | - | - | jupiter risk config read/write ok |
| risk.portfolio_get_set | risk | PASS | - | - | - | portfolio controls read/write ok |
| risk.chaos_get | risk | PASS | - | - | - | chaos config fetched |
| strategy.backtest | strategy | PASS | - | - | - | backtest completed |
| strategy.paper_trade | strategy | PASS | - | - | - | paperTrades=1 |
| treasury.allocate_rebalance | treasury | PASS | - | - | - | treasury operations completed |
| mcp.tools | mcp | PASS | - | - | - | toolCount=67 |
| mcp.call | mcp | PASS | - | - | - | wallet.balance, tx.get, gateway.request succeeded |
| agent.stop | agent | PASS | - | - | - | stopped=680bf302-5a9f-49e3-ba38-7b0a2244bd81,9002bcd7-8c21-451a-bbfb-cc939d582a62 |

## Protocol Coverage

| Protocol | Capabilities | Health | Interaction | Notes |
|---|---|---|---|---|
| escrow | PASS | PASS | PASS | capabilities=200; health=200; action=status=confirmed |
| jupiter | PASS | PASS | PASS | capabilities=200; health=200; action=quoteStatus=200 |
| marinade | PASS | PASS | PASS | capabilities=200; health=200; action=stakeBuild=200 |
| metaplex | PASS | PASS | PASS | capabilities=200; health=200; action=build=200 |
| orca | PASS | PASS | PASS | capabilities=200; health=200; action=quoteStatus=200 |
| raydium | PASS | PASS | PASS | capabilities=200; health=200; action=quoteStatus=200 |
| solend | PASS | PASS | PASS | capabilities=200; health=200; action=lendBuild=200 |
| spl-token | PASS | PASS | PASS | capabilities=200; health=200; action=handled execution precondition: {"InstructionError":[2,"IncorrectProgramId"]} code=PIPELINE_ERROR stage=build traceId=141b9f47-423a-48e7-bc94-dd64a0d0b515 |
| system-program | PASS | PASS | PASS | capabilities=200; health=200; action=status=confirmed |

## On-chain Signatures

- wallet.create_fund: 3i1cDSxsCPPSopi6iCxR58DndL44CEzCoKwDuNSS5Eu4WmPM9b2dzszUEBGqERWsi3qAbsnvpieEL6Y3FpJTQQvw ([explorer](https://explorer.solana.com/tx/3i1cDSxsCPPSopi6iCxR58DndL44CEzCoKwDuNSS5Eu4WmPM9b2dzszUEBGqERWsi3qAbsnvpieEL6Y3FpJTQQvw?cluster=devnet))
- tx.transfer_sol: 5ReHLuPxqSHwaMgESP4via8yBufEtaxz8B7nFYWJrK8awN9Cu9Y4umjXCQYGRSA13nfAhG7YVWQyBYw5rfPp5XC2 ([explorer](https://explorer.solana.com/tx/5ReHLuPxqSHwaMgESP4via8yBufEtaxz8B7nFYWJrK8awN9Cu9Y4umjXCQYGRSA13nfAhG7YVWQyBYw5rfPp5XC2?cluster=devnet))
- protocol.system-program.interaction: 2vd771wywuC2z2c6b4VVeW4vqqxkhSWauDwcN7ZT8wsUU593z1V86gs7PRCA4MoFGtYp9vwFrGCJaCZuLbddbi1r ([explorer](https://explorer.solana.com/tx/2vd771wywuC2z2c6b4VVeW4vqqxkhSWauDwcN7ZT8wsUU593z1V86gs7PRCA4MoFGtYp9vwFrGCJaCZuLbddbi1r?cluster=devnet))
- protocol.escrow.interaction: 5JJXSVPKosQ9SLkBu6rdQUScfbDQv8au6tp87XhkFcC2oPKxx3Ma424z7AgXuJrFEaf6FnNzshLWgT6pARJKbcVq ([explorer](https://explorer.solana.com/tx/5JJXSVPKosQ9SLkBu6rdQUScfbDQv8au6tp87XhkFcC2oPKxx3Ma424z7AgXuJrFEaf6FnNzshLWgT6pARJKbcVq?cluster=devnet))
- policy.approve_execute: 4fghS6z9AgnxmkvPwobjHE1jPZ3H4eymJ6VRoGRkgVG2AnxoQDWeajAUTSJGewEfD9vn44n9d8kCSjHhN2ntU4L3 ([explorer](https://explorer.solana.com/tx/4fghS6z9AgnxmkvPwobjHE1jPZ3H4eymJ6VRoGRkgVG2AnxoQDWeajAUTSJGewEfD9vn44n9d8kCSjHhN2ntU4L3?cluster=devnet))
- agent.execute_transfer: FaFyKuepxmubFtzPHCY7jsT1PnvyMUABBQFBq8qvWyP5xz5WRvt4zJmB6DZ3PnYr98QKsRephu4cwM2sEgUnFMu ([explorer](https://explorer.solana.com/tx/FaFyKuepxmubFtzPHCY7jsT1PnvyMUABBQFBq8qvWyP5xz5WRvt4zJmB6DZ3PnYr98QKsRephu4cwM2sEgUnFMu?cluster=devnet))
