import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CreateTransactionRequest } from '@agentic-wallet/common';

export type OutboxAction = 'execute' | 'retry' | 'approve';
export type OutboxStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface OutboxPayload {
  request?: CreateTransactionRequest;
  providedTransaction?: string;
  providedInstructions?: unknown[];
  requireApprovalOnDemand?: boolean;
}

export interface OutboxJob {
  id: string;
  txId: string;
  action: OutboxAction;
  status: OutboxStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  leaseId?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  payload?: OutboxPayload;
}

interface LegacyOutboxSnapshot {
  jobs: OutboxJob[];
}

interface OutboxRow {
  id: string;
  tx_id: string;
  action: OutboxAction;
  status: OutboxStatus;
  created_at: string;
  updated_at: string;
  attempts: number;
  lease_id: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  payload: string | null;
}

const resolveDbPath = (snapshotFile: string | undefined): string => {
  const configured = process.env.TRANSACTION_ENGINE_DB_PATH?.trim();
  if (configured) return configured;
  if (!snapshotFile) return ':memory:';
  return path.join(path.dirname(snapshotFile), 'state.sqlite');
};

const parsePayload = (payload: string | null): OutboxPayload | undefined => {
  if (!payload) return undefined;
  try {
    return JSON.parse(payload) as OutboxPayload;
  } catch {
    return undefined;
  }
};

const toJob = (row: OutboxRow): OutboxJob => {
  const payload = parsePayload(row.payload);
  return {
    id: row.id,
    txId: row.tx_id,
    action: row.action,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attempts: Number(row.attempts ?? 0),
    ...(row.lease_id ? { leaseId: row.lease_id } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(payload ? { payload } : {}),
  };
};

export class OutboxStore {
  private readonly db: Database.Database;
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;

    const dbPath = resolveDbPath(snapshotFile);
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox_jobs (
        id TEXT PRIMARY KEY,
        tx_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        lease_id TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_status_created ON outbox_jobs(status, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_outbox_tx_action ON outbox_jobs(tx_id, action, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_open_dedupe
        ON outbox_jobs(tx_id, action)
        WHERE status IN ('pending', 'processing');
    `);

    this.maybeMigrateLegacySnapshot();
  }

  private maybeMigrateLegacySnapshot(): void {
    if (!this.snapshotFile || !existsSync(this.snapshotFile)) {
      return;
    }

    const existingCount = this.db
      .prepare('SELECT COUNT(1) as count FROM outbox_jobs')
      .get() as { count: number };
    if ((existingCount?.count ?? 0) > 0) {
      return;
    }

    try {
      const raw = readFileSync(this.snapshotFile, 'utf8');
      const parsed = JSON.parse(raw) as LegacyOutboxSnapshot;
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO outbox_jobs (
          id, tx_id, action, status, created_at, updated_at, attempts, lease_id, lease_expires_at, last_error, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const migrate = this.db.transaction(() => {
        for (const job of parsed.jobs ?? []) {
          insert.run(
            job.id,
            job.txId,
            job.action,
            job.status,
            job.createdAt,
            job.updatedAt,
            Number(job.attempts ?? 0),
            job.leaseId ?? null,
            job.leaseExpiresAt ?? null,
            job.lastError ?? null,
            job.payload ? JSON.stringify(job.payload) : null,
          );
        }
      });

      migrate();
    } catch {
      // Ignore legacy snapshot migration failures.
    }
  }

  enqueue(txId: string, action: OutboxAction, payload?: OutboxPayload): OutboxJob {
    const now = new Date().toISOString();
    const payloadJson = payload ? JSON.stringify(payload) : null;

    const createOrFetch = this.db.transaction((): OutboxJob => {
      const open = this.db
        .prepare(
          `SELECT * FROM outbox_jobs
           WHERE tx_id = ?
             AND action = ?
             AND status IN ('pending', 'processing')
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(txId, action) as OutboxRow | undefined;
      if (open) {
        return toJob(open);
      }

      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO outbox_jobs (
             id, tx_id, action, status, created_at, updated_at, attempts, payload
           ) VALUES (?, ?, ?, 'pending', ?, ?, 0, ?)`,
        )
        .run(id, txId, action, now, now, payloadJson);

      const created = this.db
        .prepare('SELECT * FROM outbox_jobs WHERE id = ?')
        .get(id) as OutboxRow;
      return toJob(created);
    });

    try {
      return createOrFetch();
    } catch {
      const existing = this.db
        .prepare(
          `SELECT * FROM outbox_jobs
           WHERE tx_id = ?
             AND action = ?
             AND status IN ('pending', 'processing')
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(txId, action) as OutboxRow | undefined;
      if (existing) {
        return toJob(existing);
      }
      throw new Error(`Unable to enqueue outbox job for tx ${txId} action ${action}`);
    }
  }

  claimNext(leaseMs: number): OutboxJob | null {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(now + Math.max(1, leaseMs)).toISOString();

    const claim = this.db.transaction((): OutboxJob | null => {
      const row = this.db
        .prepare(
          `SELECT *
           FROM outbox_jobs
           WHERE status = 'pending'
              OR (
                status = 'processing'
                AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
              )
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
        )
        .get(nowIso) as OutboxRow | undefined;

      if (!row) {
        return null;
      }

      this.db
        .prepare(
          `UPDATE outbox_jobs
           SET status = 'processing',
               attempts = attempts + 1,
               lease_id = ?,
               lease_expires_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(leaseId, leaseExpiresAt, nowIso, row.id);

      const claimed = this.db
        .prepare('SELECT * FROM outbox_jobs WHERE id = ?')
        .get(row.id) as OutboxRow;
      return toJob(claimed);
    });

    return claim();
  }

  markDone(jobId: string, leaseId: string): void {
    this.db
      .prepare(
        `UPDATE outbox_jobs
         SET status = 'done',
             lease_id = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE id = ? AND lease_id = ?`,
      )
      .run(new Date().toISOString(), jobId, leaseId);
  }

  markFailed(
    jobId: string,
    leaseId: string,
    error: string,
    options?: { retryable?: boolean; maxAttempts?: number },
  ): void {
    const retryable = options?.retryable ?? false;
    const maxAttempts = Math.max(1, options?.maxAttempts ?? 5);

    const run = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM outbox_jobs WHERE id = ? AND lease_id = ?')
        .get(jobId, leaseId) as OutboxRow | undefined;
      if (!row) {
        return;
      }

      const attempts = Number(row.attempts ?? 0);
      const shouldRetry = retryable && attempts < maxAttempts;
      this.db
        .prepare(
          `UPDATE outbox_jobs
           SET status = ?,
               lease_id = NULL,
               lease_expires_at = NULL,
               last_error = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(shouldRetry ? 'pending' : 'failed', error, new Date().toISOString(), jobId);
    });

    run();
  }

  get(jobId: string): OutboxJob | null {
    const row = this.db
      .prepare('SELECT * FROM outbox_jobs WHERE id = ?')
      .get(jobId) as OutboxRow | undefined;
    return row ? toJob(row) : null;
  }

  getByTxAndAction(txId: string, action: OutboxAction): OutboxJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM outbox_jobs
         WHERE tx_id = ? AND action = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(txId, action) as OutboxRow[];
    return rows.map(toJob);
  }

  listOpen(): OutboxJob[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM outbox_jobs
         WHERE status IN ('pending', 'processing')
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as OutboxRow[];
    return rows.map(toJob);
  }

  stats(): {
    pending: number;
    processing: number;
    failed: number;
    done: number;
  } {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(1) as count
         FROM outbox_jobs
         GROUP BY status`,
      )
      .all() as Array<{ status: OutboxStatus; count: number }>;

    let pending = 0;
    let processing = 0;
    let failed = 0;
    let done = 0;

    for (const row of rows) {
      if (row.status === 'pending') pending = Number(row.count);
      else if (row.status === 'processing') processing = Number(row.count);
      else if (row.status === 'failed') failed = Number(row.count);
      else if (row.status === 'done') done = Number(row.count);
    }

    return { pending, processing, failed, done };
  }
}
