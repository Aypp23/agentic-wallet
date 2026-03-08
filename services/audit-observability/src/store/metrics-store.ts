import { readJsonFile, writeJsonFile } from './persistence.js';

export class MetricsStore {
  private readonly counters = new Map<string, number>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<{ counters: Array<[string, number]> }>(this.snapshotFile, {
      counters: [],
    });
    for (const [name, value] of snapshot.counters) {
      this.counters.set(name, value);
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, { counters: [...this.counters.entries()] });
  }

  increment(name: string, value = 1): number {
    const next = (this.counters.get(name) ?? 0) + value;
    this.counters.set(name, next);
    this.persist();
    return next;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters.entries());
  }
}
