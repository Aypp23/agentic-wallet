import { z } from 'zod';

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  entityType: z.enum(['transaction', 'wallet', 'agent', 'policy', 'escrow', 'system']),
  entityId: z.string().min(1),
  eventType: z.string().min(1),
  txId: z.string().uuid().optional(),
  walletId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  protocol: z.string().optional(),
  escrowId: z.string().optional(),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown()),
});

export const createAuditEventRequestSchema = auditEventSchema.omit({
  id: true,
  timestamp: true,
});

export const metricsIncrementRequestSchema = z.object({
  name: z.string().min(1),
  value: z.number().optional().default(1),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type CreateAuditEventRequest = z.infer<typeof createAuditEventRequestSchema>;
