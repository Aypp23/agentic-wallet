export interface AuditEventInput {
  entityType: 'transaction' | 'wallet' | 'agent' | 'policy' | 'escrow' | 'system';
  entityId: string;
  eventType: string;
  txId?: string;
  walletId?: string;
  agentId?: string;
  protocol?: string;
  escrowId?: string;
  payload: Record<string, unknown>;
}

export interface ObservabilityClient {
  emitAudit(event: AuditEventInput): Promise<void>;
  incrementMetric(name: string, value?: number): Promise<void>;
}

export const createObservabilityClient = (
  baseUrl: string,
): ObservabilityClient => {
  const emitAudit = async (event: AuditEventInput): Promise<void> => {
    await fetch(`${baseUrl}/api/v1/audit/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
  };

  const incrementMetric = async (name: string, value = 1): Promise<void> => {
    await fetch(`${baseUrl}/api/v1/metrics/inc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, value }),
    });
  };

  return { emitAudit, incrementMetric };
};
