import { createHash } from 'node:crypto';
import type { ExecutionProof } from '@agentic-wallet/common';

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`).join(',')}}`;
};

export const sha256Hex = (value: unknown): string =>
  createHash('sha256').update(canonicalize(value)).digest('hex');

export const buildExecutionProof = (input: {
  txId: string;
  walletId: string;
  agentId?: string;
  intent: Record<string, unknown>;
  policyDecision: Record<string, unknown>;
  simulation: Record<string, unknown>;
  signature?: string;
}): ExecutionProof => {
  const intentHash = sha256Hex(input.intent);
  const policyHash = sha256Hex(input.policyDecision);
  const simulationHash = sha256Hex(input.simulation);
  const proofHash = sha256Hex({
    txId: input.txId,
    walletId: input.walletId,
    agentId: input.agentId ?? null,
    intentHash,
    policyHash,
    simulationHash,
    signature: input.signature ?? null,
  });

  return {
    txId: input.txId,
    walletId: input.walletId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    intentHash,
    policyHash,
    simulationHash,
    ...(input.signature ? { signature: input.signature } : {}),
    proofHash,
    createdAt: new Date().toISOString(),
  };
};
