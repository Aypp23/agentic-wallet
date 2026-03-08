import type { Policy } from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from './persistence.js';

interface PolicyStoreSnapshot {
  policies: Policy[];
  history: Array<[string, Policy[]]>;
}

export class PolicyStore {
  private readonly policies = new Map<string, Policy>();
  private readonly history = new Map<string, Policy[]>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<PolicyStoreSnapshot>(this.snapshotFile, { policies: [], history: [] });
    for (const policy of snapshot.policies) {
      this.policies.set(policy.id, policy);
    }
    for (const [policyId, versions] of snapshot.history) {
      this.history.set(policyId, versions);
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, {
      policies: [...this.policies.values()],
      history: [...this.history.entries()],
    });
  }

  upsert(policy: Policy): Policy {
    this.policies.set(policy.id, policy);
    const versions = this.history.get(policy.id) ?? [];
    const hasVersion = versions.some((existing) => existing.version === policy.version);
    if (!hasVersion) {
      versions.push(policy);
      versions.sort((a, b) => a.version - b.version);
      this.history.set(policy.id, versions);
    } else {
      this.history.set(
        policy.id,
        versions.map((existing) => (existing.version === policy.version ? policy : existing)),
      );
    }
    this.persist();
    return policy;
  }

  getById(policyId: string): Policy | null {
    return this.policies.get(policyId) ?? null;
  }

  listByWallet(walletId: string): Policy[] {
    return [...this.policies.values()].filter((policy) => policy.walletId === walletId);
  }

  getActiveForWallet(walletId: string): Policy[] {
    return this.listByWallet(walletId).filter((policy) => policy.active);
  }

  listVersions(policyId: string): Policy[] {
    return [...(this.history.get(policyId) ?? [])];
  }

  getVersion(policyId: string, version: number): Policy | null {
    return this.listVersions(policyId).find((policy) => policy.version === version) ?? null;
  }
}
