import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const snapshotsTable = 'snapshots';
const dbCache = new Map<string, Database.Database>();

const resolveDbPath = (filePath: string | undefined): string | undefined => {
  const configured = process.env.TRANSACTION_ENGINE_DB_PATH?.trim();
  if (configured) return configured;
  if (!filePath) return undefined;
  return path.join(path.dirname(filePath), 'state.sqlite');
};

const snapshotKey = (filePath: string | undefined): string => {
  if (!filePath) return 'default';
  return path.basename(filePath);
};

const getDb = (dbPath: string): Database.Database => {
  const cached = dbCache.get(dbPath);
  if (cached) {
    return cached;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${snapshotsTable} (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  dbCache.set(dbPath, db);
  return db;
};

const tryMigrateLegacyJson = <T>(db: Database.Database, filePath: string | undefined, key: string): T | null => {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as T;
    db.prepare(
      `INSERT OR REPLACE INTO ${snapshotsTable} (key, payload, updated_at) VALUES (?, ?, ?)`,
    ).run(key, JSON.stringify(parsed), new Date().toISOString());
    return parsed;
  } catch {
    return null;
  }
};

export const readJsonFile = <T>(filePath: string | undefined, fallback: T): T => {
  const dbPath = resolveDbPath(filePath);
  if (!dbPath) {
    return fallback;
  }

  try {
    const db = getDb(dbPath);
    const key = snapshotKey(filePath);
    const row = db
      .prepare(`SELECT payload FROM ${snapshotsTable} WHERE key = ?`)
      .get(key) as { payload: string } | undefined;
    if (row?.payload) {
      return JSON.parse(row.payload) as T;
    }

    const migrated = tryMigrateLegacyJson<T>(db, filePath, key);
    if (migrated !== null) {
      return migrated;
    }
  } catch {
    // Falls through to fallback.
  }

  return fallback;
};

export const writeJsonFile = <T>(filePath: string | undefined, payload: T): void => {
  const dbPath = resolveDbPath(filePath);
  if (!dbPath) {
    return;
  }

  try {
    const db = getDb(dbPath);
    db.prepare(
      `INSERT OR REPLACE INTO ${snapshotsTable} (key, payload, updated_at) VALUES (?, ?, ?)`,
    ).run(snapshotKey(filePath), JSON.stringify(payload), new Date().toISOString());
  } catch {
    // Best effort durability. Service continues even if DB write fails.
  }
};
