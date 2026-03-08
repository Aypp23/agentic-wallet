import type { ProtocolAdapter } from './adapters/adapter.interface.js';

interface AdapterMigration {
  fromVersion: string;
  toVersion: string;
  migrate: (type: string, intent: Record<string, unknown>) => Record<string, unknown>;
}

const major = (version: string): number => Number(version.split('.')[0] ?? '0');

export class AdapterRegistry {
  private readonly adapters = new Map<string, ProtocolAdapter>();
  private readonly migrations = new Map<string, AdapterMigration[]>();

  register(adapter: ProtocolAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  get(name: string): ProtocolAdapter | null {
    return this.adapters.get(name) ?? null;
  }

  list(): ProtocolAdapter[] {
    return [...this.adapters.values()];
  }

  registerMigration(
    protocol: string,
    migration: AdapterMigration,
  ): void {
    const list = this.migrations.get(protocol) ?? [];
    list.push(migration);
    this.migrations.set(protocol, list);
  }

  checkCompatibility(protocol: string, targetVersion: string): {
    compatible: boolean;
    currentVersion?: string;
    reason?: string;
  } {
    const adapter = this.get(protocol);
    if (!adapter) {
      return { compatible: false, reason: `Unknown protocol ${protocol}` };
    }

    const compatible = major(adapter.version) === major(targetVersion);
    return {
      compatible,
      currentVersion: adapter.version,
      ...(compatible ? {} : { reason: `Major version mismatch ${adapter.version} -> ${targetVersion}` }),
    };
  }

  async migrateIntent(
    protocol: string,
    input: { fromVersion: string; toVersion: string; type: string; intent: Record<string, unknown> },
  ): Promise<{ intent: Record<string, unknown>; migrationApplied: boolean }> {
    const adapter = this.get(protocol);
    if (!adapter) {
      throw new Error(`Unknown protocol ${protocol}`);
    }

    if (input.fromVersion === input.toVersion) {
      return { intent: input.intent, migrationApplied: false };
    }

    const adapterLevel = adapter.migrateIntent;
    if (adapterLevel) {
      return {
        intent: await adapterLevel(input),
        migrationApplied: true,
      };
    }

    const migrations = this.migrations.get(protocol) ?? [];
    const found = migrations.find(
      (migration) =>
        migration.fromVersion === input.fromVersion && migration.toVersion === input.toVersion,
    );

    if (!found) {
      throw new Error(
        `No migration registered for ${protocol} from ${input.fromVersion} to ${input.toVersion}`,
      );
    }

    return {
      intent: found.migrate(input.type, input.intent),
      migrationApplied: true,
    };
  }
}
