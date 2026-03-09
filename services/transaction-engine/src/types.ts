import type { TxStatus, TransactionType } from '@agentic-wallet/common';
import type { DeltaGuardResult } from './safety/delta-guard.js';
import type { ExecutionProof } from '@agentic-wallet/common';

export interface TransactionRecord {
  id: string;
  walletId: string;
  agentId?: string;
  idempotencyKey?: string;
  type: TransactionType;
  protocol: string;
  gasless: boolean;
  status: TxStatus;
  signature?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  intent: Record<string, unknown>;
  programIds: string[];
  stageHistory: Array<{ status: TxStatus; at: string; note?: string }>;
  unsignedTransaction?: string;
  signedTransaction?: string;
  buildMetadata?: Record<string, unknown>;
  result?: Record<string, unknown>;
  executionProof?: ExecutionProof;
  deltaGuard?: DeltaGuardResult;
  preBalanceLamports?: number;
  postBalanceLamports?: number;
}

export interface PendingApproval {
  txId: string;
  expiresAt: string;
}

export interface ProtocolPosition {
  id: string;
  walletId: string;
  protocol: string;
  positionType: string;
  asset: string;
  amount: string;
  updatedAt: string;
}

export interface EscrowRecord {
  id: string;
  escrowId: string;
  walletId: string;
  protocol: string;
  state: string;
  counterparty: string;
  amount: string;
  updatedAt: string;
}
