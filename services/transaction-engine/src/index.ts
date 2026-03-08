import { serve } from '@hono/node-server';
import path from 'node:path';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Hono } from 'hono';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  createTransactionRequestSchema,
  executionProofSchema,
  portfolioRiskControlsSchema,
  protocolRiskConfigSchema,
  policyDecisionSchema,
  type PolicyDecision,
  txStatusSchema,
  type CreateTransactionRequest,
  type TransactionType,
  type TxStatus,
} from '@agentic-wallet/common';
import { TransactionStore } from './store/transaction-store.js';
import type { TransactionRecord } from './types.js';
import { ProtocolRiskStore } from './risk/protocol-risk-store.js';
import { PortfolioRiskStore } from './risk/portfolio-risk-store.js';
import { buildExecutionProof } from './security/execution-proof.js';
import { evaluateDeltaGuard, expectedLamportsDelta } from './safety/delta-guard.js';
import { ChaosSwitchboard } from './safety/chaos-switchboard.js';
import { SolanaRpcPool } from './solana/rpc-pool.js';
import {
  applyAdaptiveExecutionConfig,
  buildAdaptiveExecutionConfig,
} from './solana/execution-tuner.js';
import { OutboxStore, type OutboxAction } from './store/outbox-store.js';

const READ_ONLY_TYPES = new Set<TransactionType>(['query_balance', 'query_positions']);
const TERMINAL_STATUSES = new Set<TxStatus>(['confirmed', 'failed']);
const ESCROW_TYPES = new Set<TransactionType>([
  'create_escrow',
  'accept_escrow',
  'release_escrow',
  'refund_escrow',
  'dispute_escrow',
  'resolve_dispute',
  'create_milestone_escrow',
  'release_milestone',
  'x402_pay',
]);

const createBodySchema = createTransactionRequestSchema.extend({
  intent: z.record(z.unknown()).default({}),
  instructions: z.array(z.unknown()).optional(),
  transaction: z.string().optional(),
});

const chaosUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  failureRates: z.record(z.number().min(0).max(1)).optional(),
  latencyMs: z.number().int().min(0).optional(),
});

const toTxInstruction = (input: unknown): TransactionInstruction => {
  const parsed = z
    .object({
      programId: z.string().min(32),
      keys: z.array(
        z.object({
          pubkey: z.string().min(32),
          isSigner: z.boolean(),
          isWritable: z.boolean(),
        }),
      ),
      data: z.string(),
    })
    .parse(input);

  return new TransactionInstruction({
    programId: new PublicKey(parsed.programId),
    keys: parsed.keys.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(parsed.data, 'base64'),
  });
};

const parseAnyTx = (txBase64: string): Transaction | VersionedTransaction => {
  const raw = Buffer.from(txBase64, 'base64');
  try {
    return VersionedTransaction.deserialize(raw);
  } catch {
    return Transaction.from(raw);
  }
};

const serializeUnsigned = (tx: Transaction | VersionedTransaction): string => {
  if (tx instanceof VersionedTransaction) {
    return Buffer.from(tx.serialize()).toString('base64');
  }

  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const withRpcRetry = async <T>(
  operation: string,
  fn: () => Promise<T>,
  maxAttempts = Number(process.env.SOLANA_RPC_MAX_RETRIES ?? 5),
  baseDelayMs = Number(process.env.SOLANA_RPC_RETRY_DELAY_MS ?? 500),
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      const delayMs = baseDelayMs * attempt;
      await sleep(delayMs);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${operation} failed after ${maxAttempts} attempts: ${message}`);
};

const simulateTx = async (
  rpcPool: SolanaRpcPool,
  txBase64: string,
): Promise<{ ok: boolean; error?: string; logs?: string[] | null }> => {
  const tx = parseAnyTx(txBase64);

  if (tx instanceof VersionedTransaction) {
    const result = await withRpcRetry('simulateTransaction(versioned)', () =>
      rpcPool.withFailover('simulateTransaction(versioned)', (connection) =>
        connection.simulateTransaction(tx, {
          commitment: 'confirmed',
          sigVerify: false,
          replaceRecentBlockhash: true,
        }),
      ),
    );

    if (result.value.err) {
      return { ok: false, error: JSON.stringify(result.value.err), logs: result.value.logs };
    }

    return { ok: true, logs: result.value.logs };
  }

  const result = await withRpcRetry('simulateTransaction(legacy)', () =>
    rpcPool.withFailover('simulateTransaction(legacy)', (connection) =>
      connection.simulateTransaction(tx),
    ),
  );

  if (result.value.err) {
    return { ok: false, error: JSON.stringify(result.value.err), logs: result.value.logs };
  }

  return { ok: true, logs: result.value.logs };
};

const createApp = () => {
  const app = new Hono();
  const dataDir =
    process.env.TRANSACTION_ENGINE_DATA_DIR ?? path.join(process.cwd(), 'services', 'transaction-engine', 'data');
  const store = new TransactionStore(path.join(dataDir, 'transactions.json'));
  const outbox = new OutboxStore(path.join(dataDir, 'outbox.json'));
  const protocolRiskStore = new ProtocolRiskStore(path.join(dataDir, 'protocol-risk.json'));
  const portfolioRiskStore = new PortfolioRiskStore(path.join(dataDir, 'portfolio-risk.json'));
  const chaos = new ChaosSwitchboard();

  const solanaRpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const solanaRpcPoolUrls = (
    process.env.SOLANA_RPC_POOL_URLS ?? solanaRpcUrl
  )
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const walletEngineUrl = process.env.WALLET_ENGINE_URL ?? 'http://localhost:3002';
  const policyEngineUrl = process.env.POLICY_ENGINE_URL ?? 'http://localhost:3003';
  const protocolAdaptersUrl = process.env.PROTOCOL_ADAPTERS_URL ?? 'http://localhost:3005';
  const auditUrl = process.env.AUDIT_OBSERVABILITY_URL ?? 'http://localhost:3007';
  const koraRpcUrl = process.env.KORA_RPC_URL ?? 'http://localhost:8080';
  const agentRuntimeUrl = process.env.AGENT_RUNTIME_URL ?? 'http://localhost:3004';
  const pauseWebhookSecret = process.env.AGENT_PAUSE_WEBHOOK_SECRET ?? '';
  const rpcHealthProbeIntervalMs = Number(process.env.SOLANA_RPC_HEALTH_PROBE_MS ?? 15_000);
  const outboxLeaseMs = Number(process.env.TX_OUTBOX_LEASE_MS ?? 30_000);
  const outboxPollMs = Number(process.env.TX_OUTBOX_POLL_MS ?? 2_000);
  const outboxMaxAttempts = Number(process.env.TX_OUTBOX_MAX_ATTEMPTS ?? 6);
  const minPriorityFeeMicroLamports = Number(process.env.SOLANA_PRIORITY_FEE_MIN_MICROLAMPORTS ?? 2_000);
  const maxPriorityFeeMicroLamports = Number(process.env.SOLANA_PRIORITY_FEE_MAX_MICROLAMPORTS ?? 200_000);
  const priorityFeePercentile = Number(process.env.SOLANA_PRIORITY_FEE_PERCENTILE ?? 75);
  const priorityFeeMultiplierBps = Number(process.env.SOLANA_PRIORITY_FEE_MULTIPLIER_BPS ?? 1_150);
  const deltaGuardAbsoluteToleranceLamports = Number(
    process.env.DELTA_GUARD_ABSOLUTE_TOLERANCE_LAMPORTS ?? 10_000,
  );
  let destinationRentExemptionLamports: number | null = null;

  const rpcPool = new SolanaRpcPool({
    urls: solanaRpcPoolUrls,
    commitment: 'confirmed',
    probeIntervalMs: rpcHealthProbeIntervalMs,
  });

  const emitAudit = async (
    record: TransactionRecord,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    try {
      await fetch(`${auditUrl}/api/v1/audit/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityType: 'transaction',
          entityId: record.id,
          eventType,
          txId: record.id,
          walletId: record.walletId,
          ...(record.agentId ? { agentId: record.agentId } : {}),
          protocol: record.protocol,
          escrowId: String(record.intent['escrowId'] ?? ''),
          payload,
        }),
      });
    } catch {
      // Best-effort audit sink.
    }
  };

  const incrementMetric = async (name: string, value = 1): Promise<void> => {
    try {
      await fetch(`${auditUrl}/api/v1/metrics/inc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, value }),
      });
    } catch {
      // Best-effort metrics sink.
    }
  };

  const updateStatus = (record: TransactionRecord, status: TxStatus, note?: string): void => {
    record.status = txStatusSchema.parse(status);
    record.updatedAt = new Date().toISOString();
    record.stageHistory.push({ status, at: record.updatedAt, ...(note ? { note } : {}) });
    store.set(record);

    void incrementMetric(`tx.status.${status}`);
    void emitAudit(record, 'tx_status', { status, note: note ?? null });
  };

  const ensureFailureProof = (
    record: TransactionRecord,
    details: {
      stage: 'build' | 'simulation' | 'policy' | 'sign' | 'send' | 'confirm';
      policyDecision?: Record<string, unknown>;
      simulation?: Record<string, unknown>;
    },
  ): void => {
    if (record.executionProof) {
      return;
    }

    const proof = buildExecutionProof({
      txId: record.id,
      walletId: record.walletId,
      ...(record.agentId ? { agentId: record.agentId } : {}),
      intent: record.intent,
      policyDecision: {
        failed: true,
        stage: details.stage,
        error: record.error ?? 'unknown',
        ...(details.policyDecision ?? {}),
      },
      simulation: {
        failed: true,
        stage: details.stage,
        ...(details.simulation ?? {}),
      },
      ...(record.signature ? { signature: record.signature } : {}),
    });

    record.executionProof = executionProofSchema.parse(proof);
    store.setProof(record.executionProof);
    void emitAudit(record, 'execution_proof_failed', {
      intentHash: proof.intentHash,
      policyHash: proof.policyHash,
      simulationHash: proof.simulationHash,
      proofHash: proof.proofHash,
      ...(record.signature ? { signature: record.signature } : {}),
      stage: details.stage,
      error: record.error ?? 'unknown',
    });
  };

  const failTransaction = (
    record: TransactionRecord,
    errorMessage: string,
    details: {
      stage: 'build' | 'simulation' | 'policy' | 'sign' | 'send' | 'confirm';
      notePrefix?: string;
      policyDecision?: Record<string, unknown>;
      simulation?: Record<string, unknown>;
    },
  ): void => {
    record.error = errorMessage;
    ensureFailureProof(record, {
      stage: details.stage,
      ...(details.policyDecision ? { policyDecision: details.policyDecision } : {}),
      ...(details.simulation ? { simulation: details.simulation } : {}),
    });

    updateStatus(
      record,
      'failed',
      `${details.notePrefix ?? 'Transaction failed'}: ${errorMessage}`,
    );
  };

  const fetchWallet = async (walletId: string): Promise<{ id: string; publicKey: string }> => {
    const res = await fetch(`${walletEngineUrl}/api/v1/wallets/${walletId}`);
    if (!res.ok) {
      throw new Error(`Wallet fetch failed (${res.status}): ${await res.text()}`);
    }

    const payload = (await res.json()) as { data: { id: string; publicKey: string } };
    return payload.data;
  };

  const fetchLamports = async (walletId: string): Promise<number> => {
    const response = await fetch(`${walletEngineUrl}/api/v1/wallets/${walletId}/balance`);
    if (!response.ok) {
      throw new Error(`Wallet balance fetch failed (${response.status}): ${await response.text()}`);
    }
    const payload = (await response.json()) as { data: { lamports: number } };
    return Number(payload.data.lamports);
  };

  const maybePauseAgent = async (agentId: string, reason: string): Promise<void> => {
    try {
      await fetch(`${agentRuntimeUrl}/api/v1/agents/${agentId}/pause`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(pauseWebhookSecret ? { 'x-agent-runtime-secret': pauseWebhookSecret } : {}),
        },
        body: JSON.stringify({ reason }),
      });
    } catch {
      // best effort
    }
  };

  const shouldAutoPauseWallet = (walletId: string): boolean =>
    portfolioRiskStore.getControls(walletId)?.autoPauseOnBreach ?? true;

  const withLatestBlockhash = async (): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> => {
    return withRpcRetry('getLatestBlockhash', () =>
      rpcPool.withFailover('getLatestBlockhash', (connection) =>
        connection.getLatestBlockhash('confirmed'),
      ),
    );
  };

  const getDestinationRentExemptionLamports = async (): Promise<number> => {
    if (destinationRentExemptionLamports !== null) {
      return destinationRentExemptionLamports;
    }

    destinationRentExemptionLamports = await withRpcRetry(
      'getMinimumBalanceForRentExemption(0)',
      () =>
        rpcPool.withFailover('getMinimumBalanceForRentExemption(0)', (connection) =>
          connection.getMinimumBalanceForRentExemption(0),
        ),
    );
    return destinationRentExemptionLamports;
  };

  const resolveAdaptiveExecutionConfig = async (
    type: TransactionType,
    instructionCount: number,
  ): Promise<{
    computeUnitLimit: number;
    priorityFeeMicroLamports: number;
  }> => {
    const recentFees = await withRpcRetry('getRecentPrioritizationFees', () =>
      rpcPool.withFailover('getRecentPrioritizationFees', (connection) =>
        connection.getRecentPrioritizationFees(),
      ),
    );

    return buildAdaptiveExecutionConfig({
      type,
      instructionCount,
      recentPriorityFees: recentFees.map((item) => Number(item.prioritizationFee ?? 0)),
      minPriorityFeeMicroLamports,
      maxPriorityFeeMicroLamports,
      percentile: priorityFeePercentile,
      multiplierBps: priorityFeeMultiplierBps,
    });
  };

  const evaluateProtocolRisk = (
    request: CreateTransactionRequest,
    record: TransactionRecord,
    preBalanceLamports: number,
  ): {
    decision: 'allow' | 'deny' | 'require_approval';
    reasons: string[];
    config: ReturnType<ProtocolRiskStore['get']>;
    projectedTokenExposureBps: number;
    projectedProtocolExposureBps: number;
    projectedDailyLossLamports: number;
    projectedDrawdownLamports: number;
  } => {
    const config = protocolRiskStore.get(request.protocol);
    const reasons: string[] = [];
    let decision: 'allow' | 'deny' | 'require_approval' = 'allow';

    const slippageBps = Number(record.intent['slippageBps'] ?? 0);
    if (config.maxSlippageBps !== undefined && slippageBps > config.maxSlippageBps) {
      decision = 'deny';
      reasons.push(`Slippage ${slippageBps} bps exceeds protocol max ${config.maxSlippageBps}`);
    }

    const pool = String(record.intent['pool'] ?? '');
    if (config.allowedPools.length > 0 && pool && !config.allowedPools.includes(pool)) {
      decision = 'deny';
      reasons.push(`Pool ${pool} not allowlisted for protocol ${request.protocol}`);
    }

    if (config.allowedPrograms.length > 0) {
      const disallowedPrograms = record.programIds.filter((programId) => !config.allowedPrograms.includes(programId));
      if (disallowedPrograms.length > 0) {
        decision = 'deny';
        reasons.push(`Programs not allowlisted for protocol ${request.protocol}: ${disallowedPrograms.join(', ')}`);
      }
    }

    const amountLamports = Number(
      record.intent['lamports'] ?? record.intent['amountLamports'] ?? record.intent['amount'] ?? 0,
    );
    const poolConcentrationBps = preBalanceLamports > 0
      ? Math.round((Math.max(0, amountLamports) / preBalanceLamports) * 10000)
      : 0;
    if (
      config.maxPoolConcentrationBps !== undefined &&
      poolConcentrationBps > config.maxPoolConcentrationBps
    ) {
      decision = 'deny';
      reasons.push(
        `Pool concentration ${poolConcentrationBps} bps exceeds ${config.maxPoolConcentrationBps}`,
      );
    }

    const oraclePriceUsd = Number(record.intent['oraclePriceUsd'] ?? 0);
    const quotedPriceUsd = Number(record.intent['quotedPriceUsd'] ?? 0);
    const quoteTimestamp = String(record.intent['quoteTimestamp'] ?? '');
    if (request.type === 'swap' && config.maxQuoteAgeSeconds !== undefined && quoteTimestamp) {
      const ageSeconds = Math.floor((Date.now() - new Date(quoteTimestamp).getTime()) / 1000);
      if (Number.isFinite(ageSeconds) && ageSeconds > config.maxQuoteAgeSeconds) {
        decision = 'deny';
        reasons.push(`Quote is stale (${ageSeconds}s > ${config.maxQuoteAgeSeconds}s)`);
      }
    }

    if (config.requireOracleForSwap && request.type === 'swap' && (!oraclePriceUsd || !quotedPriceUsd)) {
      if (decision !== 'deny') {
        decision = 'require_approval';
      }
      reasons.push('Oracle sanity price inputs are required for swap under this protocol risk config');
    }

    if (
      config.oracleDeviationBps !== undefined &&
      oraclePriceUsd > 0 &&
      quotedPriceUsd > 0
    ) {
      const deviation = Math.round((Math.abs(oraclePriceUsd - quotedPriceUsd) / oraclePriceUsd) * 10000);
      if (deviation > config.oracleDeviationBps && decision !== 'deny') {
        decision = 'require_approval';
        reasons.push(`Oracle deviation ${deviation} bps exceeds ${config.oracleDeviationBps}`);
      }
    }

    const token = String(record.intent['mint'] ?? record.intent['tokenMint'] ?? 'SOL');
    const portfolioRisk = portfolioRiskStore.evaluateProjected(
      request.walletId,
      request.protocol,
      token,
      Math.max(0, amountLamports),
      preBalanceLamports,
    );

    if (portfolioRisk.decision === 'deny') {
      decision = 'deny';
      reasons.push(...portfolioRisk.reasons);
    } else if (portfolioRisk.decision === 'require_approval' && decision !== 'deny') {
      decision = 'require_approval';
      reasons.push(...portfolioRisk.reasons);
    }

    return {
      decision,
      reasons,
      config,
      projectedTokenExposureBps: portfolioRisk.projectedTokenExposureBps,
      projectedProtocolExposureBps: portfolioRisk.projectedProtocolExposureBps,
      projectedDailyLossLamports: portfolioRisk.projectedDailyLossLamports,
      projectedDrawdownLamports: portfolioRisk.projectedDrawdownLamports,
    };
  };

  const buildLocalUnsignedTx = async (
    walletPublicKey: string,
    request: CreateTransactionRequest,
    intent: Record<string, unknown>,
    providedTransaction?: string,
    providedInstructions?: unknown[],
  ): Promise<{ unsignedTx: string; programIds: string[] }> => {
    const owner = new PublicKey(walletPublicKey);

    if (providedTransaction) {
      const parsed = parseAnyTx(providedTransaction);
      if (parsed instanceof VersionedTransaction) {
        return { unsignedTx: providedTransaction, programIds: [] };
      }

      const tunedConfig = await resolveAdaptiveExecutionConfig(
        request.type,
        parsed.instructions.length,
      );
      applyAdaptiveExecutionConfig(parsed, tunedConfig);
      const { blockhash, lastValidBlockHeight } = await withLatestBlockhash();
      parsed.recentBlockhash = blockhash;
      parsed.lastValidBlockHeight = lastValidBlockHeight;
      parsed.feePayer = owner;

      return {
        unsignedTx: serializeUnsigned(parsed),
        programIds: parsed.instructions.map((ix) => ix.programId.toBase58()),
      };
    }

    if (providedInstructions && providedInstructions.length > 0) {
      const tx = new Transaction().add(...providedInstructions.map((ix) => toTxInstruction(ix)));
      const tunedConfig = await resolveAdaptiveExecutionConfig(request.type, tx.instructions.length);
      applyAdaptiveExecutionConfig(tx, tunedConfig);
      const { blockhash, lastValidBlockHeight } = await withLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = owner;

      return {
        unsignedTx: serializeUnsigned(tx),
        programIds: tx.instructions.map((ix) => ix.programId.toBase58()),
      };
    }

    if (request.type === 'transfer_sol') {
      const destination = String(intent['destination'] ?? intent['recipient'] ?? '');
      const lamports = Number(intent['lamports'] ?? intent['amountLamports'] ?? 0);

      if (!destination || lamports <= 0) {
        throw new Error('transfer_sol requires destination and lamports/amountLamports > 0');
      }

      const destinationPubkey = new PublicKey(destination);
      const destinationAccount = await withRpcRetry('getAccountInfo(destination)', () =>
        rpcPool.withFailover('getAccountInfo(destination)', (connection) =>
          connection.getAccountInfo(destinationPubkey, 'confirmed'),
        ),
      );
      if (!destinationAccount) {
        const minRentLamports = await getDestinationRentExemptionLamports();
        if (lamports < minRentLamports) {
          throw new Error(
            `transfer_sol amount ${lamports} is below rent-exempt minimum ${minRentLamports} for unfunded destination ${destination}`,
          );
        }
      }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: destinationPubkey,
          lamports,
        }),
      );

      const tunedConfig = await resolveAdaptiveExecutionConfig(request.type, tx.instructions.length);
      applyAdaptiveExecutionConfig(tx, tunedConfig);
      const { blockhash, lastValidBlockHeight } = await withLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = owner;

      return {
        unsignedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
        programIds: [SystemProgram.programId.toBase58()],
      };
    }

    if (request.type === 'transfer_spl') {
      const destination = String(intent['destination'] ?? intent['recipient'] ?? '');
      const mint = String(intent['mint'] ?? intent['tokenMint'] ?? '');
      const amount = BigInt(Number(intent['amount'] ?? intent['amountRaw'] ?? 0));

      if (!destination || !mint || amount <= 0n) {
        throw new Error('transfer_spl requires destination, mint, and amount > 0');
      }

      const mintPubkey = new PublicKey(mint);
      const destinationPubkey = new PublicKey(destination);
      const sourceAta = getAssociatedTokenAddressSync(mintPubkey, owner);
      const destinationAta = getAssociatedTokenAddressSync(mintPubkey, destinationPubkey);

      const tx = new Transaction();
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(owner, destinationAta, destinationPubkey, mintPubkey),
      );
      tx.add(createTransferInstruction(sourceAta, destinationAta, owner, amount));

      const tunedConfig = await resolveAdaptiveExecutionConfig(request.type, tx.instructions.length);
      applyAdaptiveExecutionConfig(tx, tunedConfig);
      const { blockhash, lastValidBlockHeight } = await withLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = owner;

      return {
        unsignedTx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
        programIds: [TOKEN_PROGRAM_ID.toBase58()],
      };
    }

    const buildRes = await fetch(`${protocolAdaptersUrl}/api/v1/build`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: request.protocol,
        type: request.type,
        walletAddress: walletPublicKey,
        intent,
      }),
    });

    if (!buildRes.ok) {
      throw new Error(`Protocol build failed (${buildRes.status}): ${await buildRes.text()}`);
    }

    const built = (await buildRes.json()) as {
      data: {
        mode: 'transaction' | 'instructions';
        transaction?: string;
        instructions?: unknown[];
        programIds: string[];
      };
    };

    if (built.data.mode === 'transaction') {
      if (!built.data.transaction) {
        throw new Error('Adapter build returned transaction mode without transaction payload');
      }

      const parsed = parseAnyTx(built.data.transaction);
      if (!(parsed instanceof VersionedTransaction)) {
        const tunedConfig = await resolveAdaptiveExecutionConfig(
          request.type,
          parsed.instructions.length,
        );
        applyAdaptiveExecutionConfig(parsed, tunedConfig);
        const { blockhash, lastValidBlockHeight } = await withLatestBlockhash();
        parsed.recentBlockhash = blockhash;
        parsed.lastValidBlockHeight = lastValidBlockHeight;
        parsed.feePayer = owner;
        return {
          unsignedTx: serializeUnsigned(parsed),
          programIds: built.data.programIds,
        };
      }

      return {
        unsignedTx: built.data.transaction,
        programIds: built.data.programIds,
      };
    }

    const instructions = (built.data.instructions ?? []).map((ix) => toTxInstruction(ix));
    const tx = new Transaction().add(...instructions);
    const tunedConfig = await resolveAdaptiveExecutionConfig(request.type, tx.instructions.length);
    applyAdaptiveExecutionConfig(tx, tunedConfig);
    const { blockhash, lastValidBlockHeight } = await withLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = owner;

    return {
      unsignedTx: serializeUnsigned(tx),
      programIds: built.data.programIds,
    };
  };

  const evaluatePolicy = async (
    request: CreateTransactionRequest,
    record: TransactionRecord,
    riskHints: {
      poolConcentrationBps: number;
      projectedDailyLossLamports: number;
      projectedDrawdownLamports: number;
      projectedTokenExposureBps: number;
      projectedProtocolExposureBps: number;
      oraclePriceUsd?: number;
      quotedPriceUsd?: number;
    },
  ): Promise<PolicyDecision> => {
    if (chaos.shouldFail('policy_engine')) {
      return {
        decision: 'deny',
        reasons: ['Chaos switchboard forced policy-engine failure'],
        riskTier: 'high',
      };
    }

    try {
      const response = await fetch(`${policyEngineUrl}/api/v1/evaluate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          walletId: request.walletId,
          agentId: request.agentId,
          type: request.type,
          protocol: request.protocol,
          destination: String(record.intent['destination'] ?? record.intent['recipient'] ?? ''),
          tokenMint: String(record.intent['mint'] ?? record.intent['tokenMint'] ?? ''),
          amountLamports: Number(record.intent['amountLamports'] ?? record.intent['lamports'] ?? 0),
          programIds: record.programIds,
          slippageBps: Number(record.intent['slippageBps'] ?? 0),
          pool: String(record.intent['pool'] ?? ''),
          poolConcentrationBps: riskHints.poolConcentrationBps,
          ...(riskHints.oraclePriceUsd !== undefined
            ? { oraclePriceUsd: riskHints.oraclePriceUsd }
            : {}),
          ...(riskHints.quotedPriceUsd !== undefined
            ? { quotedPriceUsd: riskHints.quotedPriceUsd }
            : {}),
          projectedDailyLossLamports: riskHints.projectedDailyLossLamports,
          projectedDrawdownLamports: riskHints.projectedDrawdownLamports,
          projectedTokenExposureBps: riskHints.projectedTokenExposureBps,
          projectedProtocolExposureBps: riskHints.projectedProtocolExposureBps,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        return {
          decision: 'deny',
          reasons: [`Policy evaluation failed (${response.status})`],
          riskTier: 'high',
        };
      }

      const payload = (await response.json()) as { data: unknown };
      return policyDecisionSchema.parse(payload.data);
    } catch (error) {
      return {
        decision: 'deny',
        reasons: [`Policy engine unreachable: ${(error as Error).message}`],
        riskTier: 'high',
      };
    }
  };

  const signTransaction = async (walletId: string, unsignedTx: string): Promise<{ signedTx: string; signature: string }> => {
    if (chaos.shouldFail('signing')) {
      throw new Error('Chaos switchboard forced signing failure');
    }

    const response = await fetch(`${walletEngineUrl}/api/v1/wallets/${walletId}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction: unsignedTx }),
    });

    if (!response.ok) {
      throw new Error(`Wallet signing failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as { data: { signedTransaction: string; signature: string } };
    return { signedTx: payload.data.signedTransaction, signature: payload.data.signature };
  };

  const confirmSignature = async (signature: string): Promise<void> => {
    await withRpcRetry('confirmTransaction', () =>
      rpcPool.withFailover('confirmTransaction', (connection) =>
        connection.confirmTransaction(signature, 'confirmed'),
      ),
    );
  };

  const submitSignedTx = async (
    signedTx: string,
    gasless: boolean,
    existingSignature?: string,
  ): Promise<{ signature: string }> => {
    if (chaos.shouldFail('submit')) {
      throw new Error('Chaos switchboard forced submit failure');
    }

    if (gasless) {
      if (chaos.shouldFail('kora_submit')) {
        throw new Error('Chaos switchboard forced Kora submit failure');
      }
      const response = await fetch(koraRpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'signAndSendTransaction',
          params: { transaction: signedTx },
        }),
      });

      const payload = (await response.json()) as {
        result?: { signature: string };
        error?: { message: string };
      };

      if (!response.ok || payload.error || !payload.result?.signature) {
        throw new Error(`Kora signAndSendTransaction failed: ${payload.error?.message ?? 'unknown error'}`);
      }

      return { signature: payload.result.signature };
    }

    if (existingSignature) {
      await confirmSignature(existingSignature);
      return { signature: existingSignature };
    }

    const signature = await withRpcRetry('sendRawTransaction', () =>
      rpcPool.withFailover('sendRawTransaction', (connection) =>
        connection.sendRawTransaction(Buffer.from(signedTx, 'base64'), {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        }),
      ),
    );

    await confirmSignature(signature);
    return { signature };
  };

  const indexPositionsAndEscrows = (record: TransactionRecord): void => {
    const amount = Number(record.intent['amount'] ?? record.intent['lamports'] ?? record.intent['amountLamports'] ?? 0);

    if (record.type === 'stake') {
      store.upsertPosition({
        walletId: record.walletId,
        protocol: record.protocol,
        positionType: 'stake',
        asset: String(record.intent['asset'] ?? 'SOL'),
        delta: amount,
      });
    }

    if (record.type === 'unstake') {
      store.upsertPosition({
        walletId: record.walletId,
        protocol: record.protocol,
        positionType: 'stake',
        asset: String(record.intent['asset'] ?? 'SOL'),
        delta: -amount,
      });
    }

    if (record.type === 'lend_supply') {
      store.upsertPosition({
        walletId: record.walletId,
        protocol: record.protocol,
        positionType: 'lend_supply',
        asset: String(record.intent['mint'] ?? 'unknown'),
        delta: amount,
      });
    }

    if (record.type === 'lend_borrow') {
      store.upsertPosition({
        walletId: record.walletId,
        protocol: record.protocol,
        positionType: 'lend_borrow',
        asset: String(record.intent['mint'] ?? 'unknown'),
        delta: amount,
      });
    }

    if (ESCROW_TYPES.has(record.type)) {
      store.upsertEscrow({
        walletId: record.walletId,
        protocol: record.protocol,
        escrowId: String(record.intent['escrowId'] ?? `${record.walletId}-${record.id}`),
        state: record.type,
        counterparty: String(record.intent['counterparty'] ?? ''),
        amount: String(record.intent['amount'] ?? '0'),
      });
    }
  };

  const executeReadOnlyIntent = async (
    request: CreateTransactionRequest,
    record: TransactionRecord,
  ): Promise<void> => {
    if (request.type === 'query_balance') {
      const [balanceRes, tokenRes] = await Promise.all([
        fetch(`${walletEngineUrl}/api/v1/wallets/${request.walletId}/balance`),
        fetch(`${walletEngineUrl}/api/v1/wallets/${request.walletId}/tokens`),
      ]);

      record.result = {
        balance: balanceRes.ok ? await balanceRes.json() : { error: await balanceRes.text() },
        tokens: tokenRes.ok ? await tokenRes.json() : { error: await tokenRes.text() },
      };
    } else {
      record.result = {
        positions: store.listPositions(request.walletId),
        escrows: store.listEscrows(request.walletId),
        recentTransactions: store.listByWallet(request.walletId).slice(-20),
      };
    }

    updateStatus(record, 'confirmed', 'Read-only intent executed');
    store.set(record);
  };

  const executePipeline = async (
    request: CreateTransactionRequest,
    record: TransactionRecord,
    requireApprovalOnDemand: boolean,
    providedTransaction?: string,
    providedInstructions?: unknown[],
  ): Promise<{ awaitingApproval: boolean }> => {
    const startMs = Date.now();
    await chaos.maybeDelay();
    const preBalanceLamports = await fetchLamports(request.walletId);
    record.preBalanceLamports = preBalanceLamports;
    portfolioRiskStore.updateBalance(request.walletId, preBalanceLamports);

    if (
      record.status === 'submitting' &&
      record.signedTransaction &&
      record.signature
    ) {
      const submitted = await submitSignedTx(record.signedTransaction, request.gasless ?? false, record.signature);
      record.signature = submitted.signature;
      record.confirmedAt = new Date().toISOString();

      if (record.postBalanceLamports === undefined) {
        record.postBalanceLamports = await fetchLamports(request.walletId);
        indexPositionsAndEscrows(record);
      }

      if (!record.executionProof) {
        const recoveredProof = buildExecutionProof({
          txId: record.id,
          walletId: record.walletId,
          ...(record.agentId ? { agentId: record.agentId } : {}),
          intent: record.intent,
          policyDecision: {
            recoveredFromOutbox: true,
          },
          simulation: {
            recovered: true,
          },
          signature: submitted.signature,
        });
        record.executionProof = executionProofSchema.parse(recoveredProof);
        store.setProof(record.executionProof);
      }

      updateStatus(record, 'confirmed', 'Recovered submission confirmed');
      return { awaitingApproval: false };
    }

    const wallet = await fetchWallet(request.walletId);

    updateStatus(record, 'simulating');
    const built = await buildLocalUnsignedTx(
      wallet.publicKey,
      request,
      record.intent,
      providedTransaction,
      providedInstructions,
    );

    record.unsignedTransaction = built.unsignedTx;
    record.programIds = built.programIds;
    store.set(record);

    const protocolRisk = evaluateProtocolRisk(request, record, preBalanceLamports);
    void emitAudit(record, 'protocol_risk_decision', {
      decision: protocolRisk.decision,
      reasons: protocolRisk.reasons,
      config: protocolRisk.config,
    });

    if (request.gasless && !protocolRisk.config.gaslessEligible) {
      failTransaction(record, `Protocol ${request.protocol} is not eligible for gasless execution`, {
        stage: 'policy',
        notePrefix: 'Policy deny',
        policyDecision: {
          protocolRisk: {
            decision: protocolRisk.decision,
            reasons: protocolRisk.reasons,
          },
        },
      });
      return { awaitingApproval: false };
    }

    if (protocolRisk.decision === 'deny') {
      failTransaction(record, protocolRisk.reasons.join('; '), {
        stage: 'policy',
        notePrefix: 'Protocol risk deny',
        policyDecision: {
          protocolRisk: {
            decision: protocolRisk.decision,
            reasons: protocolRisk.reasons,
          },
        },
      });
      return { awaitingApproval: false };
    }

    if (chaos.shouldFail('simulation')) {
      failTransaction(record, 'Chaos switchboard forced simulation failure', {
        stage: 'simulation',
        notePrefix: 'Simulation failed',
        simulation: {
          chaosFailure: true,
        },
      });
      void incrementMetric('tx.simulation_failed');
      return { awaitingApproval: false };
    }

    const simulation = await simulateTx(rpcPool, built.unsignedTx);
    if (!simulation.ok) {
      failTransaction(record, simulation.error ?? 'Simulation failed', {
        stage: 'simulation',
        notePrefix: 'Simulation failed',
        simulation: {
          ok: false,
          logs: simulation.logs ?? [],
        },
      });
      void incrementMetric('tx.simulation_failed');
      return { awaitingApproval: false };
    }

    updateStatus(record, 'policy_eval');
    const policyRiskHints = {
      poolConcentrationBps:
        preBalanceLamports > 0
          ? Math.round(
              ((Number(
                record.intent['amountLamports'] ?? record.intent['lamports'] ?? record.intent['amount'] ?? 0,
              ) || 0) /
                preBalanceLamports) *
                10000,
            )
          : 0,
      projectedDailyLossLamports: protocolRisk.projectedDailyLossLamports,
      projectedDrawdownLamports: protocolRisk.projectedDrawdownLamports,
      projectedTokenExposureBps: protocolRisk.projectedTokenExposureBps,
      projectedProtocolExposureBps: protocolRisk.projectedProtocolExposureBps,
      ...((Number(record.intent['oraclePriceUsd'] ?? 0) || 0) > 0
        ? { oraclePriceUsd: Number(record.intent['oraclePriceUsd']) }
        : {}),
      ...((Number(record.intent['quotedPriceUsd'] ?? 0) || 0) > 0
        ? { quotedPriceUsd: Number(record.intent['quotedPriceUsd']) }
        : {}),
    };
    const policy = await evaluatePolicy(request, record, policyRiskHints);
    void emitAudit(record, 'policy_decision', policy);

    if (policy.decision === 'deny') {
      failTransaction(record, policy.reasons.join('; '), {
        stage: 'policy',
        notePrefix: 'Policy deny',
        policyDecision: {
          policy,
          protocolRisk: {
            decision: protocolRisk.decision,
            reasons: protocolRisk.reasons,
          },
        },
        simulation: {
          ok: simulation.ok,
          logs: simulation.logs ?? [],
        },
      });
      void incrementMetric('tx.policy_deny');
      return { awaitingApproval: false };
    }

    if (
      policy.decision === 'require_approval' ||
      protocolRisk.decision === 'require_approval' ||
      requireApprovalOnDemand
    ) {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      store.setPending(record.id, expiresAt);
      updateStatus(record, 'approval_gate', `Awaiting approval until ${expiresAt}`);
      void incrementMetric('tx.approval_required');
      return { awaitingApproval: true };
    }

    let signedTx = record.signedTransaction;
    if (!signedTx) {
      updateStatus(record, 'signing');
      const signed = await signTransaction(request.walletId, built.unsignedTx);
      signedTx = signed.signedTx;
      record.signedTransaction = signed.signedTx;
      record.signature = signed.signature;
      store.set(record);
    } else {
      updateStatus(record, 'signing', 'Reusing signed transaction from durable outbox');
    }

    updateStatus(record, 'submitting');
    const submitted = await submitSignedTx(signedTx, request.gasless ?? false);

    record.signature = submitted.signature;
    record.confirmedAt = new Date().toISOString();
    record.postBalanceLamports = await fetchLamports(request.walletId);
    indexPositionsAndEscrows(record);

    const amountLamports = Math.max(
      0,
      Number(record.intent['amountLamports'] ?? record.intent['lamports'] ?? record.intent['amount'] ?? 0),
    );
    const token = String(record.intent['mint'] ?? record.intent['tokenMint'] ?? 'SOL');
    portfolioRiskStore.recordExposure(request.walletId, request.protocol, token, amountLamports);

    const delta = evaluateDeltaGuard(
      expectedLamportsDelta(request.type, record.intent),
      record.preBalanceLamports !== undefined && record.postBalanceLamports !== undefined
        ? record.postBalanceLamports - record.preBalanceLamports
        : null,
      protocolRisk.config.deltaVarianceBpsThreshold,
      deltaGuardAbsoluteToleranceLamports,
    );
    record.deltaGuard = delta;
    if (!delta.ok && record.agentId && shouldAutoPauseWallet(record.walletId)) {
      void maybePauseAgent(record.agentId, `Delta guard breach for tx ${record.id}: ${delta.reason ?? 'unknown'}`);
    }

    const proof = buildExecutionProof({
      txId: record.id,
      walletId: record.walletId,
      ...(record.agentId ? { agentId: record.agentId } : {}),
      intent: record.intent,
      policyDecision: {
        policy,
        protocolRisk: {
          decision: protocolRisk.decision,
          reasons: protocolRisk.reasons,
        },
      },
      simulation: {
        ok: simulation.ok,
        logs: simulation.logs ?? [],
      },
      signature: submitted.signature,
    });
    record.executionProof = executionProofSchema.parse(proof);
    store.setProof(record.executionProof);
    void emitAudit(record, 'execution_proof', {
      intentHash: proof.intentHash,
      policyHash: proof.policyHash,
      simulationHash: proof.simulationHash,
      proofHash: proof.proofHash,
      signature: submitted.signature,
    });

    updateStatus(record, 'confirmed', 'Transaction confirmed');

    const durationMs = Date.now() - startMs;
    void incrementMetric('tx.confirmed');
    void incrementMetric('tx.confirmation_latency_ms_total', durationMs);
    return { awaitingApproval: false };
  };

  const buildRequestFromRecord = (tx: TransactionRecord): CreateTransactionRequest => ({
    walletId: tx.walletId,
    ...(tx.agentId ? { agentId: tx.agentId } : {}),
    ...(tx.idempotencyKey ? { idempotencyKey: tx.idempotencyKey } : {}),
    type: tx.type,
    protocol: tx.protocol,
    gasless: tx.gasless,
    intent: tx.intent,
  });

  const executeApprovalPath = async (tx: TransactionRecord): Promise<void> => {
    if (!store.getPending(tx.id)) {
      if (TERMINAL_STATUSES.has(tx.status)) {
        return;
      }
      throw new Error('Transaction is not pending approval');
    }

    if (!tx.unsignedTransaction) {
      throw new Error('No unsigned transaction payload for approval');
    }

    updateStatus(tx, 'signing', 'Approved by operator');
    const signed = await signTransaction(tx.walletId, tx.unsignedTransaction);
    tx.signedTransaction = signed.signedTx;
    store.set(tx);

    updateStatus(tx, 'submitting');
    const submitted = await submitSignedTx(signed.signedTx, tx.gasless);
    tx.signature = submitted.signature;
    tx.confirmedAt = new Date().toISOString();
    tx.postBalanceLamports = await fetchLamports(tx.walletId);
    indexPositionsAndEscrows(tx);

    const protocolConfig = protocolRiskStore.get(tx.protocol);
    const delta = evaluateDeltaGuard(
      expectedLamportsDelta(tx.type, tx.intent),
      tx.preBalanceLamports !== undefined && tx.postBalanceLamports !== undefined
        ? tx.postBalanceLamports - tx.preBalanceLamports
        : null,
      protocolConfig.deltaVarianceBpsThreshold,
      deltaGuardAbsoluteToleranceLamports,
    );
    tx.deltaGuard = delta;
    if (!delta.ok && tx.agentId && shouldAutoPauseWallet(tx.walletId)) {
      void maybePauseAgent(tx.agentId, `Delta guard breach for approved tx ${tx.id}: ${delta.reason ?? 'unknown'}`);
    }

    const approvedProof = buildExecutionProof({
      txId: tx.id,
      walletId: tx.walletId,
      ...(tx.agentId ? { agentId: tx.agentId } : {}),
      intent: tx.intent,
      policyDecision: {
        approvedByOperator: true,
        approvedAt: new Date().toISOString(),
      },
      simulation: {
        approvedPath: true,
      },
      signature: submitted.signature,
    });
    tx.executionProof = executionProofSchema.parse(approvedProof);
    store.setProof(tx.executionProof);

    updateStatus(tx, 'confirmed', 'Approved and confirmed');
    store.removePending(tx.id);
  };

  const isRetryableOutboxError = (error: unknown): boolean => {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (message.includes('not found')) return false;
    if (message.includes('not pending approval')) return false;
    if (message.includes('invalid')) return false;
    if (message.includes('unsupported')) return false;
    return true;
  };

  const processOutboxJob = async (job: ReturnType<OutboxStore['claimNext']>): Promise<void> => {
    if (!job) return;
    const tx = store.get(job.txId);
    if (!tx) {
      return;
    }

    if (TERMINAL_STATUSES.has(tx.status)) {
      return;
    }

    if (job.action === 'execute') {
      if (tx.status === 'approval_gate') {
        return;
      }

      const request = job.payload?.request ?? buildRequestFromRecord(tx);
      const providedTransaction = job.payload?.providedTransaction;
      const providedInstructions = job.payload?.providedInstructions;
      const requireApprovalOnDemand = job.payload?.requireApprovalOnDemand ?? false;

      if (READ_ONLY_TYPES.has(request.type)) {
        await executeReadOnlyIntent(request, tx);
        return;
      }

      await executePipeline(
        request,
        tx,
        requireApprovalOnDemand,
        providedTransaction,
        providedInstructions,
      );
      return;
    }

    if (job.action === 'retry') {
      const request = buildRequestFromRecord(tx);
      if (READ_ONLY_TYPES.has(request.type)) {
        await executeReadOnlyIntent(request, tx);
        return;
      }

      await executePipeline(request, tx, false);
      return;
    }

    if (job.action === 'approve') {
      await executeApprovalPath(tx);
    }
  };

  let outboxDrainInFlight = false;
  const drainOutbox = async (limit = 8): Promise<void> => {
    if (outboxDrainInFlight) return;
    outboxDrainInFlight = true;
    try {
      for (let i = 0; i < limit; i += 1) {
        const job = outbox.claimNext(outboxLeaseMs);
        if (!job) break;

        try {
          await processOutboxJob(job);
          outbox.markDone(job.id, job.leaseId ?? '');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const tx = store.get(job.txId);
          if (tx) {
            failTransaction(tx, message, {
              stage: 'build',
              notePrefix: 'Outbox execution failed',
              policyDecision: {
                action: job.action,
                retryable: isRetryableOutboxError(error),
              },
              simulation: {
                action: job.action,
              },
            });
          }

          outbox.markFailed(job.id, job.leaseId ?? '', message, {
            retryable: isRetryableOutboxError(error),
            maxAttempts: outboxMaxAttempts,
          });
        }
      }
    } finally {
      outboxDrainInFlight = false;
    }
  };

  const queueAction = async (
    txId: string,
    action: OutboxAction,
    payload?: Parameters<OutboxStore['enqueue']>[2],
  ): Promise<void> => {
    outbox.enqueue(txId, action, payload);
    await drainOutbox(8);
  };

  const executionResponse = (
    record: TransactionRecord,
    successStatusCode: number,
  ): { status: number; body: Record<string, unknown> } => {
    if (record.status === 'approval_gate') {
      return {
        status: 202,
        body: { data: { id: record.id, status: record.status }, awaitingApproval: true },
      };
    }

    if (record.status === 'failed') {
      return {
        status: 500,
        body: { data: record, error: record.error ?? 'Execution failed' },
      };
    }

    if (record.status === 'confirmed') {
      return {
        status: successStatusCode,
        body: { data: record },
      };
    }

    return {
      status: 202,
      body: { data: { id: record.id, status: record.status }, queued: true },
    };
  };

  const outboxTimer = setInterval(() => {
    void drainOutbox();
  }, Math.max(1_000, outboxPollMs));
  outboxTimer.unref?.();
  void drainOutbox(32);

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'transaction-engine',
      rpcPool: rpcPool.getStatus(),
      outbox: outbox.stats(),
    }),
  );

  app.get('/api/v1/risk/protocols', (c) => {
    return c.json({ data: protocolRiskStore.list().map((config) => protocolRiskConfigSchema.parse(config)) });
  });

  app.get('/api/v1/risk/protocols/:protocol', (c) => {
    const config = protocolRiskStore.get(c.req.param('protocol'));
    return c.json({ data: protocolRiskConfigSchema.parse(config) });
  });

  app.put('/api/v1/risk/protocols/:protocol', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const next = protocolRiskStore.upsert({
      ...(body as Record<string, unknown>),
      protocol: c.req.param('protocol'),
    });
    return c.json({ data: protocolRiskConfigSchema.parse(next) });
  });

  app.get('/api/v1/risk/portfolio', (c) => {
    return c.json({ data: portfolioRiskStore.listControls().map((item) => portfolioRiskControlsSchema.parse(item)) });
  });

  app.get('/api/v1/risk/portfolio/:walletId', (c) => {
    const controls = portfolioRiskStore.getControls(c.req.param('walletId'));
    return c.json({ data: controls ? portfolioRiskControlsSchema.parse(controls) : null });
  });

  app.put('/api/v1/risk/portfolio/:walletId', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const next = portfolioRiskStore.upsertControls({
      ...(body as Record<string, unknown>),
      walletId: c.req.param('walletId'),
    });
    return c.json({ data: portfolioRiskControlsSchema.parse(next) });
  });

  app.get('/api/v1/chaos', (c) => {
    return c.json({ data: chaos.getConfig() });
  });

  app.put('/api/v1/chaos', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = chaosUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const input = {
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.failureRates !== undefined ? { failureRates: parsed.data.failureRates } : {}),
      ...(parsed.data.latencyMs !== undefined ? { latencyMs: parsed.data.latencyMs } : {}),
    };
    return c.json({ data: chaos.update(input) });
  });

  app.post('/api/v1/transactions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createBodySchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    if (parsed.data.idempotencyKey) {
      const existing = store.getByIdempotency(parsed.data.idempotencyKey);
      if (existing) {
        return c.json({ data: existing, idempotentReplay: true });
      }
    }

    const request: CreateTransactionRequest = {
      walletId: parsed.data.walletId,
      ...(parsed.data.agentId ? { agentId: parsed.data.agentId } : {}),
      type: parsed.data.type,
      protocol: parsed.data.protocol,
      gasless: parsed.data.gasless,
      ...(parsed.data.idempotencyKey ? { idempotencyKey: parsed.data.idempotencyKey } : {}),
      intent: parsed.data.intent,
    };

    const now = new Date().toISOString();
    const txId = uuidv4();

    const record: TransactionRecord = {
      id: txId,
      walletId: request.walletId,
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      type: request.type,
      protocol: request.protocol,
      gasless: request.gasless ?? false,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      intent: request.intent ?? {},
      programIds: [],
      stageHistory: [{ status: 'pending', at: now }],
    };

    store.set(record);
    void emitAudit(record, 'tx_created', { type: record.type, protocol: record.protocol });

    await queueAction(txId, 'execute', {
      request,
      ...(parsed.data.transaction ? { providedTransaction: parsed.data.transaction } : {}),
      ...(parsed.data.instructions ? { providedInstructions: parsed.data.instructions } : {}),
    });

    const current = store.get(txId) ?? record;
    const response = executionResponse(
      current,
      READ_ONLY_TYPES.has(request.type) ? 200 : 201,
    );
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  });

  app.get('/api/v1/transactions/:txId', (c) => {
    const tx = store.get(c.req.param('txId'));
    if (!tx) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    return c.json({ data: tx });
  });

  app.get('/api/v1/transactions/:txId/proof', (c) => {
    const proof = store.getProof(c.req.param('txId'));
    if (!proof) {
      return c.json({ error: 'Execution proof not found for transaction' }, 404);
    }
    return c.json({ data: executionProofSchema.parse(proof) });
  });

  app.get('/api/v1/transactions/:txId/replay', (c) => {
    const tx = store.get(c.req.param('txId'));
    if (!tx) {
      return c.json({ error: 'Transaction not found' }, 404);
    }
    const proof = store.getProof(tx.id);
    return c.json({
      data: {
        txId: tx.id,
        deterministicReplay: {
          intent: tx.intent,
          policyStageHistory: tx.stageHistory,
          signature: tx.signature ?? null,
          executionProof: proof ?? null,
          deltaGuard: tx.deltaGuard ?? null,
        },
      },
    });
  });

  app.post('/api/v1/transactions/:txId/retry', async (c) => {
    const tx = store.get(c.req.param('txId'));
    if (!tx) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    await queueAction(tx.id, 'retry');
    const current = store.get(tx.id) ?? tx;
    const response = executionResponse(current, 200);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  });

  app.post('/api/v1/transactions/:txId/approve', async (c) => {
    const txId = c.req.param('txId');
    const tx = store.get(txId);

    if (!tx) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    if (!store.getPending(txId)) {
      return c.json({ error: 'Transaction is not pending approval' }, 400);
    }

    await queueAction(tx.id, 'approve');
    const current = store.get(tx.id) ?? tx;
    const response = executionResponse(current, 200);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  });

  app.post('/api/v1/transactions/:txId/reject', (c) => {
    const txId = c.req.param('txId');
    const tx = store.get(txId);

    if (!tx) {
      return c.json({ error: 'Transaction not found' }, 404);
    }

    if (!store.getPending(txId)) {
      return c.json({ error: 'Transaction is not pending approval' }, 400);
    }

    failTransaction(tx, 'Rejected by operator', {
      stage: 'policy',
      notePrefix: 'Rejected',
      policyDecision: {
        approvedByOperator: false,
      },
      simulation: {
        approvedPath: false,
      },
    });
    store.removePending(txId);

    return c.json({ data: tx });
  });

  app.get('/api/v1/wallets/:walletId/transactions', (c) => {
    return c.json({ data: store.listByWallet(c.req.param('walletId')) });
  });

  app.get('/api/v1/wallets/:walletId/pending-approvals', (c) => {
    return c.json({ data: store.listPendingByWallet(c.req.param('walletId')) });
  });

  app.get('/api/v1/wallets/:walletId/positions', (c) => {
    return c.json({ data: store.listPositions(c.req.param('walletId')) });
  });

  app.get('/api/v1/wallets/:walletId/escrows', (c) => {
    return c.json({ data: store.listEscrows(c.req.param('walletId')) });
  });

  return app;
};

const app = createApp();
const port = Number(process.env.PORT ?? 3006);

serve({ fetch: app.fetch, port }, (info) => {
  console.log('transaction-engine listening on http://localhost:' + info.port);
});

export { app };
