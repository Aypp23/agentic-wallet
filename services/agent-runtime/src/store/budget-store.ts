import type { AgentBudget } from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from './persistence.js';

const utcDay = (): string => new Date().toISOString().slice(0, 10);

interface BudgetStoreSnapshot {
  budgets: AgentBudget[];
}

export class BudgetStore {
  private readonly budgets = new Map<string, AgentBudget>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<BudgetStoreSnapshot>(this.snapshotFile, { budgets: [] });
    for (const budget of snapshot.budgets) {
      this.budgets.set(budget.agentId, budget);
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, { budgets: [...this.budgets.values()] });
  }

  setBudget(agentId: string, walletId: string, budgetLamports: number): AgentBudget {
    const existing = this.budgets.get(agentId);
    const day = utcDay();
    const shouldReset = existing ? existing.updatedAt.slice(0, 10) !== day : false;

    const next: AgentBudget = {
      agentId,
      walletId,
      budgetLamports,
      spentLamportsToday: shouldReset ? 0 : (existing?.spentLamportsToday ?? 0),
      updatedAt: new Date().toISOString(),
    };

    this.budgets.set(agentId, next);
    this.persist();
    return next;
  }

  get(agentId: string): AgentBudget | null {
    const budget = this.budgets.get(agentId);
    if (!budget) return null;
    const day = utcDay();
    if (budget.updatedAt.slice(0, 10) !== day) {
      const refreshed: AgentBudget = {
        ...budget,
        spentLamportsToday: 0,
        updatedAt: new Date().toISOString(),
      };
      this.budgets.set(agentId, refreshed);
      this.persist();
      return refreshed;
    }
    return budget;
  }

  spend(agentId: string, lamports: number): { ok: boolean; budget?: AgentBudget; reason?: string } {
    const budget = this.get(agentId);
    if (!budget) {
      return { ok: true };
    }

    const nextSpent = budget.spentLamportsToday + Math.max(0, lamports);
    if (nextSpent > budget.budgetLamports) {
      return {
        ok: false,
        budget,
        reason: `Agent budget exceeded (${nextSpent}/${budget.budgetLamports} lamports today)`,
      };
    }

    const next: AgentBudget = {
      ...budget,
      spentLamportsToday: nextSpent,
      updatedAt: new Date().toISOString(),
    };
    this.budgets.set(agentId, next);
    this.persist();
    return { ok: true, budget: next };
  }

  transfer(sourceAgentId: string, targetAgentId: string, lamports: number): {
    source: AgentBudget | null;
    target: AgentBudget | null;
  } {
    const source = this.get(sourceAgentId);
    const target = this.get(targetAgentId);

    if (!source || !target) {
      return { source, target };
    }

    const amount = Math.max(0, lamports);
    const sourceNext = this.setBudget(source.agentId, source.walletId, Math.max(0, source.budgetLamports - amount));
    const targetNext = this.setBudget(target.agentId, target.walletId, target.budgetLamports + amount);
    return { source: sourceNext, target: targetNext };
  }
}
