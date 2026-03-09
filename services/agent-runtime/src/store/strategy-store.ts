import { v4 as uuidv4 } from 'uuid';
import type {
  PaperTradeRecord,
  StrategyBacktestRequest,
  StrategyBacktestResult,
} from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from './persistence.js';

interface StrategyStoreSnapshot {
  backtests: StrategyBacktestResult[];
  latestBacktestByWalletId: Array<[string, StrategyBacktestResult]>;
  paperTrades: Array<[string, PaperTradeRecord[]]>;
}

export class StrategyStore {
  private readonly backtests = new Map<string, StrategyBacktestResult>();
  private readonly latestBacktestByWalletId = new Map<string, StrategyBacktestResult>();
  private readonly paperTrades = new Map<string, PaperTradeRecord[]>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<StrategyStoreSnapshot>(this.snapshotFile, {
      backtests: [],
      latestBacktestByWalletId: [],
      paperTrades: [],
    });
    for (const backtest of snapshot.backtests) {
      this.backtests.set(backtest.runId, backtest);
    }
    for (const [walletId, backtest] of snapshot.latestBacktestByWalletId) {
      this.latestBacktestByWalletId.set(walletId, backtest);
    }
    for (const [agentId, trades] of snapshot.paperTrades) {
      this.paperTrades.set(agentId, trades);
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, {
      backtests: [...this.backtests.values()],
      latestBacktestByWalletId: [...this.latestBacktestByWalletId.entries()],
      paperTrades: [...this.paperTrades.entries()],
    });
  }

  runBacktest(input: StrategyBacktestRequest): StrategyBacktestResult {
    const totalSteps = input.steps.length;
    let passedSteps = 0;
    let totalPnlLamports = 0;

    for (const step of input.steps) {
      const pnl = step.simulatedPnlLamports ?? 0;
      totalPnlLamports += pnl;
      if (pnl >= 0) {
        passedSteps += 1;
      }
    }

    const passRate = totalSteps === 0 ? 0 : passedSteps / totalSteps;
    const result: StrategyBacktestResult = {
      runId: uuidv4(),
      walletId: input.walletId,
      name: input.name,
      totalSteps,
      passedSteps,
      failedSteps: totalSteps - passedSteps,
      passRate,
      totalPnlLamports,
      passed: passRate >= input.minimumPassRate,
      createdAt: new Date().toISOString(),
    };

    this.backtests.set(result.runId, result);
    this.latestBacktestByWalletId.set(result.walletId, result);
    this.persist();
    return result;
  }

  addPaperTrade(
    input: Omit<PaperTradeRecord, 'id' | 'createdAt'>,
  ): PaperTradeRecord {
    const record: PaperTradeRecord = {
      ...input,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    const existing = this.paperTrades.get(input.agentId) ?? [];
    existing.push(record);
    this.paperTrades.set(input.agentId, existing.slice(-500));
    this.persist();
    return record;
  }

  listPaperTrades(agentId: string): PaperTradeRecord[] {
    return [...(this.paperTrades.get(agentId) ?? [])];
  }

  getLatestBacktest(walletId: string): StrategyBacktestResult | null {
    return this.latestBacktestByWalletId.get(walletId) ?? null;
  }

  clear(): void {
    this.backtests.clear();
    this.latestBacktestByWalletId.clear();
    this.paperTrades.clear();
    this.persist();
  }
}
