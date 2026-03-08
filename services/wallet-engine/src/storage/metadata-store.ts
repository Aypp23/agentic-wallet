import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { WalletMetadata } from '@agentic-wallet/common';

const LEGACY_STORE_FILE = 'wallets.json';

interface LegacyWalletStoreData {
  wallets: WalletMetadata[];
}

export class WalletMetadataStore {
  private readonly db: Database.Database;
  private readonly legacyStorePath: string;

  constructor(dataDir: string) {
    const configured = process.env.WALLET_ENGINE_DB_PATH?.trim();
    const dbPath = configured && configured.length > 0
      ? configured
      : path.join(dataDir, 'wallet-engine.sqlite');

    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wallets_public_key ON wallets(public_key);
      CREATE INDEX IF NOT EXISTS idx_wallets_created_at ON wallets(created_at);
    `);
    this.migrateWalletTableSchema();

    this.legacyStorePath = path.join(dataDir, LEGACY_STORE_FILE);
    this.maybeMigrateLegacyStore();
  }

  async list(): Promise<WalletMetadata[]> {
    const rows = this.db
      .prepare('SELECT payload FROM wallets ORDER BY created_at ASC, id ASC')
      .all() as Array<{ payload: string }>;

    return rows
      .map((row) => {
        try {
          return JSON.parse(row.payload) as WalletMetadata;
        } catch {
          return null;
        }
      })
      .filter((wallet): wallet is WalletMetadata => wallet !== null);
  }

  async getById(walletId: string): Promise<WalletMetadata | null> {
    const row = this.db
      .prepare('SELECT payload FROM wallets WHERE id = ? LIMIT 1')
      .get(walletId) as { payload: string } | undefined;

    if (!row?.payload) {
      return null;
    }

    try {
      return JSON.parse(row.payload) as WalletMetadata;
    } catch {
      return null;
    }
  }

  async add(wallet: WalletMetadata): Promise<void> {
    const columns = this.getWalletTableColumns();
    const fieldNames: string[] = ['id', 'public_key'];
    const values: Array<string | null> = [wallet.id, wallet.publicKey];

    // Backward compatibility for older schema variants that still enforce these columns.
    if (columns.has('encrypted_secret_key')) {
      fieldNames.push('encrypted_secret_key');
      values.push('__managed_by_key_provider__');
    }
    if (columns.has('chain')) {
      fieldNames.push('chain');
      values.push('solana');
    }

    fieldNames.push('provider', 'label', 'created_at', 'payload');
    values.push(
      wallet.provider ?? 'local-dev',
      wallet.label ?? null,
      wallet.createdAt,
      JSON.stringify(wallet),
    );

    const placeholders = fieldNames.map(() => '?').join(', ');
    this.db
      .prepare(
        `INSERT OR REPLACE INTO wallets (${fieldNames.join(', ')}) VALUES (${placeholders})`,
      )
      .run(...values);
  }

  private migrateWalletTableSchema(): void {
    const columns = this.db
      .prepare('PRAGMA table_info(wallets)')
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));

    if (!names.has('provider')) {
      this.db.exec(`ALTER TABLE wallets ADD COLUMN provider TEXT NOT NULL DEFAULT 'local-dev'`);
    }

    if (!names.has('label')) {
      this.db.exec(`ALTER TABLE wallets ADD COLUMN label TEXT`);
    }
  }

  private getWalletTableColumns(): Set<string> {
    const columns = this.db
      .prepare('PRAGMA table_info(wallets)')
      .all() as Array<{ name: string }>;
    return new Set(columns.map((column) => column.name));
  }

  private maybeMigrateLegacyStore(): void {
    if (!existsSync(this.legacyStorePath)) {
      return;
    }

    const count = this.db
      .prepare('SELECT COUNT(1) as count FROM wallets')
      .get() as { count: number };
    if ((count?.count ?? 0) > 0) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.legacyStorePath, 'utf8')) as LegacyWalletStoreData;
      const wallets = parsed.wallets ?? [];
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO wallets (
          id,
          public_key,
          provider,
          label,
          created_at,
          payload
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );

      const migrate = this.db.transaction(() => {
        for (const wallet of wallets) {
          insert.run(
            wallet.id,
            wallet.publicKey,
            wallet.provider ?? 'local-dev',
            wallet.label ?? null,
            wallet.createdAt,
            JSON.stringify(wallet),
          );
        }
      });

      migrate();
    } catch {
      // Ignore migration failure and continue with empty DB.
    }
  }
}
