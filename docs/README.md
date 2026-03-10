# Documentation Index

This folder is the implementation handbook for the Agentic Wallet stack.

If you are new, read in this order:

1. `README.md` (repo root) for setup and quick-start.
2. `docs/ARCHITECTURE.md` for system design and trust boundaries.
3. `docs/API_REFERENCE.md` for endpoint contracts and machine response behavior.
4. `docs/PROTOCOLS_AND_INTENTS.md` for supported intent shapes and protocol adapter behavior.
5. `docs/SECURITY.md` for threat model and controls.
6. `docs/OPERATIONS_RUNBOOK.md` for day-2 operations and incident handling.
7. `docs/TESTING_AND_VALIDATION.md` for test strategy and reproducible evidence capture.

Existing core docs:

- `docs/DEEP_DIVE.md`: end-to-end design rationale and implementation notes.
- `docs/DEMO_RESULTS.md`: execution evidence and protocol coverage snapshots.
- `docs/SECURITY.md`: security controls, residual risks, and hardening priorities.

## What Each Doc Answers

- `ARCHITECTURE.md`
  - What components exist?
  - What does each component trust?
  - How does a transaction move from intent to confirmation?
- `API_REFERENCE.md`
  - Which endpoint do I call for each capability?
  - What request fields are required?
  - How do I parse errors in a stable machine way?
- `PROTOCOLS_AND_INTENTS.md`
  - Which intents are supported?
  - What JSON shape is expected for each intent?
  - What behavior changes on devnet compatibility paths?
- `SECURITY.md`
  - Which attacks are considered?
  - Which controls are implemented now?
  - Which controls remain for production hardening?
- `OPERATIONS_RUNBOOK.md`
  - How do I run/monitor/repair the system?
  - How do I recover from common operational failures?
- `TESTING_AND_VALIDATION.md`
  - How do I prove capabilities reliably?
  - Which checks are required before shipping?

## Audience Routing

- Agent integrators: `SKILLS.md`, then `API_REFERENCE.md`, then `PROTOCOLS_AND_INTENTS.md`.
- Backend contributors: `ARCHITECTURE.md`, `DEEP_DIVE.md`, `SECURITY.md`.
- Operators/SRE: `OPERATIONS_RUNBOOK.md`, `SECURITY.md`, `TESTING_AND_VALIDATION.md`.
- Judges/reviewers: `DEMO_RESULTS.md`, `DEEP_DIVE.md`, `SECURITY.md`.

## Documentation Standards

When changing behavior, update docs in the same PR:

- API contract changes: update `API_REFERENCE.md`.
- New/changed intents or protocol rules: update `PROTOCOLS_AND_INTENTS.md`.
- Runtime/persistence/reliability changes: update `ARCHITECTURE.md` and `OPERATIONS_RUNBOOK.md`.
- New threat/mitigation or risk acceptance: update `SECURITY.md`.
- New test paths or evidence collection changes: update `TESTING_AND_VALIDATION.md`.

## Sources of Truth

- Runtime behavior: service source under `apps/*` and `services/*`.
- Shared schemas and types: `packages/common`.
- Agent contract: `SKILLS.md`.
- Public docs site: <https://aypp23-agentic-wallet.mintlify.app/introduction>
