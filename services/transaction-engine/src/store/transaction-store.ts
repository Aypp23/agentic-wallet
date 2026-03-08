import { v4 as uuidv4 } from 'uuid';
import type {
  EscrowRecord,
  PendingApproval,
  ProtocolPosition,
  TransactionRecord,
} from '../types.js';
import type { ExecutionProof } from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from './persistence.js';

interface TransactionStoreSnapshot {
  txs: TransactionRecord[];
  pending: Array<[string, PendingApproval]>;
  idempotency: Array<[string, string]>;
  positions: Array<[string, ProtocolPosition]>;
  escrows: Array<[string, EscrowRecord]>;
  proofs: Array<[string, ExecutionProof]>;
}

export class TransactionStore {
  private readonly txs = new Map<string, TransactionRecord>();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly idempotency = new Map<string, string>();
  private readonly positions = new Map<string, ProtocolPosition>();
  private readonly escrows = new Map<string, EscrowRecord>();
  private readonly proofs = new Map<string, ExecutionProof>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<TransactionStoreSnapshot>(this.snapshotFile, {
      txs: [],
      pending: [],
      idempotency: [],
      positions: [],
      escrows: [],
      proofs: [],
    });

    for (const tx of snapshot.txs) {
      this.txs.set(tx.id, tx);
    }
    for (const [key, value] of snapshot.pending) {
      this.pending.set(key, value);
    }
    for (const [key, value] of snapshot.idempotency) {
      this.idempotency.set(key, value);
    }
    for (const [key, value] of snapshot.positions) {
      this.positions.set(key, value);
    }
    for (const [key, value] of snapshot.escrows) {
      this.escrows.set(key, value);
    }
    for (const [key, value] of snapshot.proofs) {
      this.proofs.set(key, value);
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, {
      txs: [...this.txs.values()],
      pending: [...this.pending.entries()],
      idempotency: [...this.idempotency.entries()],
      positions: [...this.positions.entries()],
      escrows: [...this.escrows.entries()],
      proofs: [...this.proofs.entries()],
    });
  }

  set(tx: TransactionRecord): void {
    this.txs.set(tx.id, tx);
    if (tx.idempotencyKey) {
      this.idempotency.set(tx.idempotencyKey, tx.id);
    }
    this.persist();
  }

  get(txId: string): TransactionRecord | null {
    return this.txs.get(txId) ?? null;
  }

  getByIdempotency(idempotencyKey: string): TransactionRecord | null {
    const txId = this.idempotency.get(idempotencyKey);
    if (!txId) return null;
    return this.get(txId);
  }

  listByWallet(walletId: string): TransactionRecord[] {
    return [...this.txs.values()].filter((tx) => tx.walletId === walletId);
  }

  setPending(txId: string, expiresAt: string): void {
    this.pending.set(txId, { txId, expiresAt });
    this.persist();
  }

  getPending(txId: string): PendingApproval | null {
    const pending = this.pending.get(txId);
    if (!pending) return null;
    if (new Date(pending.expiresAt).getTime() < Date.now()) {
      this.pending.delete(txId);
      this.persist();
      return null;
    }
    return pending;
  }

  removePending(txId: string): void {
    this.pending.delete(txId);
    this.persist();
  }

  listPendingByWallet(walletId: string): PendingApproval[] {
    const pending: PendingApproval[] = [];

    for (const [txId, approval] of this.pending.entries()) {
      const tx = this.get(txId);
      if (tx && tx.walletId === walletId && this.getPending(txId)) {
        pending.push(approval);
      }
    }

    return pending;
  }

  upsertPosition(input: {
    walletId: string;
    protocol: string;
    positionType: string;
    asset: string;
    delta: number;
  }): void {
    const key = `${input.walletId}:${input.protocol}:${input.positionType}:${input.asset}`;
    const now = new Date().toISOString();
    const existing = this.positions.get(key);
    const nextAmount = (existing ? Number(existing.amount) : 0) + input.delta;

    this.positions.set(key, {
      id: existing?.id ?? uuidv4(),
      walletId: input.walletId,
      protocol: input.protocol,
      positionType: input.positionType,
      asset: input.asset,
      amount: String(nextAmount),
      updatedAt: now,
    });
    this.persist();
  }

  listPositions(walletId: string): ProtocolPosition[] {
    return [...this.positions.values()].filter((position) => position.walletId === walletId);
  }

  upsertEscrow(input: {
    walletId: string;
    escrowId: string;
    protocol: string;
    state: string;
    counterparty: string;
    amount: string;
  }): void {
    const key = `${input.walletId}:${input.escrowId}`;
    const now = new Date().toISOString();
    const existing = this.escrows.get(key);

    this.escrows.set(key, {
      id: existing?.id ?? uuidv4(),
      escrowId: input.escrowId,
      walletId: input.walletId,
      protocol: input.protocol,
      state: input.state,
      counterparty: input.counterparty,
      amount: input.amount,
      updatedAt: now,
    });
    this.persist();
  }

  listEscrows(walletId: string): EscrowRecord[] {
    return [...this.escrows.values()].filter((escrow) => escrow.walletId === walletId);
  }

  setProof(proof: ExecutionProof): void {
    this.proofs.set(proof.txId, proof);
    this.persist();
  }

  getProof(txId: string): ExecutionProof | null {
    return this.proofs.get(txId) ?? null;
  }
}
