export interface AuditRecord {
  id: string;
  entityId: string;
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
