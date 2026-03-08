import type { AuditEvent } from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from './persistence.js';

export interface AuditQuery {
  txId?: string;
  agentId?: string;
  walletId?: string;
  protocol?: string;
  escrowId?: string;
}

export class AuditStore {
  private readonly events: AuditEvent[] = [];
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<{ events: AuditEvent[] }>(this.snapshotFile, { events: [] });
    this.events.push(...snapshot.events);
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, { events: this.events });
  }

  add(event: AuditEvent): void {
    this.events.push(event);
    this.persist();
  }

  list(query: AuditQuery): AuditEvent[] {
    return this.events.filter((event) => {
      if (query.txId && event.txId !== query.txId) return false;
      if (query.agentId && event.agentId !== query.agentId) return false;
      if (query.walletId && event.walletId !== query.walletId) return false;
      if (query.protocol && event.protocol !== query.protocol) return false;
      if (query.escrowId && event.escrowId !== query.escrowId) return false;
      return true;
    });
  }
}
