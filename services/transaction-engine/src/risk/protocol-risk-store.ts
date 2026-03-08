import {
  protocolRiskConfigSchema,
  upsertProtocolRiskConfigRequestSchema,
  type ProtocolRiskConfig,
  type UpsertProtocolRiskConfigRequest,
} from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from '../store/persistence.js';

const defaultConfig = (protocol: string): ProtocolRiskConfig =>
  protocolRiskConfigSchema.parse({
    protocol,
    version: '1.0.0',
    maxSlippageBps: 300,
    maxPoolConcentrationBps: 7000,
    allowedPools: [],
    allowedPrograms: [],
    oracleDeviationBps: 800,
    requireOracleForSwap: false,
    maxQuoteAgeSeconds: 45,
    deltaVarianceBpsThreshold: 500,
    gaslessEligible: true,
    updatedAt: new Date().toISOString(),
  });

export class ProtocolRiskStore {
  private readonly configs = new Map<string, ProtocolRiskConfig>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<{ configs: ProtocolRiskConfig[] }>(this.snapshotFile, { configs: [] });
    for (const config of snapshot.configs) {
      this.configs.set(config.protocol, protocolRiskConfigSchema.parse(config));
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, { configs: [...this.configs.values()] });
  }

  get(protocol: string): ProtocolRiskConfig {
    const existing = this.configs.get(protocol);
    if (existing) {
      return existing;
    }
    const created = defaultConfig(protocol);
    this.configs.set(protocol, created);
    this.persist();
    return created;
  }

  list(): ProtocolRiskConfig[] {
    return [...this.configs.values()];
  }

  upsert(input: UpsertProtocolRiskConfigRequest): ProtocolRiskConfig {
    const parsed = upsertProtocolRiskConfigRequestSchema.parse(input);
    const current = this.get(parsed.protocol);
    const next = protocolRiskConfigSchema.parse({
      ...current,
      ...parsed,
      updatedAt: new Date().toISOString(),
    });
    this.configs.set(parsed.protocol, next);
    this.persist();
    return next;
  }
}
