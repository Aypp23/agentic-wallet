# Escrow Program

Anchor-based Solana escrow program used by the `escrow` protocol adapter.

## Instructions

1. `create_escrow`
2. `accept_task`
3. `release_payment`
4. `request_refund`
5. `dispute`
6. `resolve_dispute`
7. `create_milestone_escrow`
8. `release_milestone`
9. `x402_pay`

## Build

```bash
npm run escrow:build
```

## Deploy (devnet)

Requires `PRIVATE_KEY` in `.env` funded on devnet.

```bash
npm run escrow:deploy:devnet
```

On success, `.env` is updated with `ESCROW_PROGRAM_ID`.
