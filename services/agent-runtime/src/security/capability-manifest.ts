import { createHmac, randomUUID } from 'node:crypto';
import type { CapabilityManifest, TransactionType } from '@agentic-wallet/common';

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`).join(',')}}`;
};

const signPayload = (payload: Omit<CapabilityManifest, 'signature'>, secret: string): string =>
  createHmac('sha256', secret).update(canonicalize(payload)).digest('hex');

export const issueCapabilityManifest = (
  input: {
    agentId: string;
    allowedIntents: TransactionType[];
    allowedProtocols: string[];
    issuer: string;
    ttlSeconds: number;
    version?: string;
  },
  secret: string,
): CapabilityManifest => {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + input.ttlSeconds * 1000);
  const unsigned: Omit<CapabilityManifest, 'signature'> = {
    issuer: input.issuer,
    version: input.version ?? '1.0.0',
    agentId: input.agentId,
    allowedIntents: input.allowedIntents,
    allowedProtocols: input.allowedProtocols,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: randomUUID(),
  };

  return {
    ...unsigned,
    signature: signPayload(unsigned, secret),
  };
};

export const verifyCapabilityManifest = (
  manifest: CapabilityManifest,
  secret: string,
): { ok: boolean; reason?: string } => {
  const { signature, ...unsigned } = manifest;
  const expected = signPayload(unsigned, secret);

  if (expected !== signature) {
    return { ok: false, reason: 'Capability manifest signature mismatch' };
  }

  if (new Date(manifest.expiresAt).getTime() <= Date.now()) {
    return { ok: false, reason: 'Capability manifest expired' };
  }

  return { ok: true };
};

export const manifestAllows = (
  manifest: CapabilityManifest,
  type: TransactionType,
  protocol: string,
): boolean => manifest.allowedIntents.includes(type) && manifest.allowedProtocols.includes(protocol);
