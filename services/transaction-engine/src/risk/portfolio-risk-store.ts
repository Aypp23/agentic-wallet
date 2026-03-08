import {
  portfolioRiskControlsSchema,
  upsertPortfolioRiskControlsRequestSchema,
  type PortfolioRiskControls,
  type UpsertPortfolioRiskControlsRequest,
} from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from '../store/persistence.js';

interface PortfolioState {
  day: string;
  startBalanceLamports: number;
  currentBalanceLamports: number;
  peakBalanceLamports: number;
  dailyLossLamports: number;
  tokenExposureLamports: Map<string, number>;
  protocolExposureLamports: Map<string, number>;
}

interface PortfolioStateSnapshot {
  walletId: string;
  day: string;
  startBalanceLamports: number;
  currentBalanceLamports: number;
  peakBalanceLamports: number;
  dailyLossLamports: number;
  tokenExposureLamports: Array<[string, number]>;
  protocolExposureLamports: Array<[string, number]>;
}

interface PortfolioRiskSnapshot {
  controls: PortfolioRiskControls[];
  state: PortfolioStateSnapshot[];
}

export interface PortfolioRiskEvaluation {
  decision: 'allow' | 'deny' | 'require_approval';
  reasons: string[];
  projectedDailyLossLamports: number;
  projectedDrawdownLamports: number;
  projectedTokenExposureBps: number;
  projectedProtocolExposureBps: number;
}

const utcDay = (): string => new Date().toISOString().slice(0, 10);

const newState = (balanceLamports: number): PortfolioState => ({
  day: utcDay(),
  startBalanceLamports: balanceLamports,
  currentBalanceLamports: balanceLamports,
  peakBalanceLamports: balanceLamports,
  dailyLossLamports: 0,
  tokenExposureLamports: new Map<string, number>(),
  protocolExposureLamports: new Map<string, number>(),
});

export class PortfolioRiskStore {
  private readonly controls = new Map<string, PortfolioRiskControls>();
  private readonly state = new Map<string, PortfolioState>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<PortfolioRiskSnapshot>(this.snapshotFile, {
      controls: [],
      state: [],
    });
    for (const control of snapshot.controls) {
      this.controls.set(control.walletId, portfolioRiskControlsSchema.parse(control));
    }
    for (const item of snapshot.state) {
      this.state.set(item.walletId, {
        day: item.day,
        startBalanceLamports: item.startBalanceLamports,
        currentBalanceLamports: item.currentBalanceLamports,
        peakBalanceLamports: item.peakBalanceLamports,
        dailyLossLamports: item.dailyLossLamports,
        tokenExposureLamports: new Map<string, number>(item.tokenExposureLamports),
        protocolExposureLamports: new Map<string, number>(item.protocolExposureLamports),
      });
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, {
      controls: [...this.controls.values()],
      state: [...this.state.entries()].map(([walletId, value]) => ({
        walletId,
        day: value.day,
        startBalanceLamports: value.startBalanceLamports,
        currentBalanceLamports: value.currentBalanceLamports,
        peakBalanceLamports: value.peakBalanceLamports,
        dailyLossLamports: value.dailyLossLamports,
        tokenExposureLamports: [...value.tokenExposureLamports.entries()],
        protocolExposureLamports: [...value.protocolExposureLamports.entries()],
      })),
    } satisfies PortfolioRiskSnapshot);
  }

  getControls(walletId: string): PortfolioRiskControls | null {
    return this.controls.get(walletId) ?? null;
  }

  upsertControls(input: UpsertPortfolioRiskControlsRequest): PortfolioRiskControls {
    const parsed = upsertPortfolioRiskControlsRequestSchema.parse(input);
    const current = this.getControls(parsed.walletId);
    const next = portfolioRiskControlsSchema.parse({
      walletId: parsed.walletId,
      maxDrawdownLamports: parsed.maxDrawdownLamports ?? current?.maxDrawdownLamports,
      maxDailyLossLamports: parsed.maxDailyLossLamports ?? current?.maxDailyLossLamports,
      maxExposureBpsPerToken: parsed.maxExposureBpsPerToken ?? current?.maxExposureBpsPerToken,
      maxExposureBpsPerProtocol: parsed.maxExposureBpsPerProtocol ?? current?.maxExposureBpsPerProtocol,
      autoPauseOnBreach: parsed.autoPauseOnBreach ?? current?.autoPauseOnBreach ?? true,
      updatedAt: new Date().toISOString(),
    });
    this.controls.set(parsed.walletId, next);
    this.persist();
    return next;
  }

  listControls(): PortfolioRiskControls[] {
    return [...this.controls.values()];
  }

  updateBalance(walletId: string, balanceLamports: number): void {
    const today = utcDay();
    const existing = this.state.get(walletId);
    const nextState = !existing || existing.day !== today ? newState(balanceLamports) : existing;
    nextState.currentBalanceLamports = balanceLamports;
    nextState.peakBalanceLamports = Math.max(nextState.peakBalanceLamports, balanceLamports);
    nextState.dailyLossLamports = Math.max(0, nextState.startBalanceLamports - balanceLamports);
    this.state.set(walletId, nextState);
    this.persist();
  }

  recordExposure(walletId: string, protocol: string, token: string, deltaLamports: number): void {
    const existing = this.state.get(walletId) ?? newState(0);
    const tokenCurrent = existing.tokenExposureLamports.get(token) ?? 0;
    const protocolCurrent = existing.protocolExposureLamports.get(protocol) ?? 0;
    existing.tokenExposureLamports.set(token, Math.max(0, tokenCurrent + deltaLamports));
    existing.protocolExposureLamports.set(protocol, Math.max(0, protocolCurrent + deltaLamports));
    this.state.set(walletId, existing);
    this.persist();
  }

  evaluateProjected(
    walletId: string,
    protocol: string,
    token: string,
    projectedDeltaLamports: number,
    currentBalanceLamports: number,
  ): PortfolioRiskEvaluation {
    const control = this.getControls(walletId);
    const snapshot = this.state.get(walletId) ?? newState(currentBalanceLamports);
    this.updateBalance(walletId, currentBalanceLamports);

    const balance = Math.max(1, currentBalanceLamports);
    const tokenCurrent = snapshot.tokenExposureLamports.get(token) ?? 0;
    const protocolCurrent = snapshot.protocolExposureLamports.get(protocol) ?? 0;
    const projectedTokenExposureBps = Math.round(
      ((tokenCurrent + Math.max(0, projectedDeltaLamports)) / balance) * 10000,
    );
    const projectedProtocolExposureBps = Math.round(
      ((protocolCurrent + Math.max(0, projectedDeltaLamports)) / balance) * 10000,
    );
    const projectedDailyLossLamports = snapshot.dailyLossLamports + Math.max(0, projectedDeltaLamports);
    const projectedBalance = Math.max(0, currentBalanceLamports - Math.max(0, projectedDeltaLamports));
    const projectedDrawdownLamports = Math.max(0, snapshot.peakBalanceLamports - projectedBalance);

    if (!control) {
      return {
        decision: 'allow',
        reasons: [],
        projectedDailyLossLamports,
        projectedDrawdownLamports,
        projectedTokenExposureBps,
        projectedProtocolExposureBps,
      };
    }

    const reasons: string[] = [];
    let decision: 'allow' | 'deny' | 'require_approval' = 'allow';

    if (
      control.maxDailyLossLamports !== undefined &&
      projectedDailyLossLamports > control.maxDailyLossLamports
    ) {
      decision = 'deny';
      reasons.push(
        `Projected daily loss ${projectedDailyLossLamports} exceeds ${control.maxDailyLossLamports}`,
      );
    }

    if (
      control.maxDrawdownLamports !== undefined &&
      projectedDrawdownLamports > control.maxDrawdownLamports
    ) {
      decision = 'deny';
      reasons.push(
        `Projected drawdown ${projectedDrawdownLamports} exceeds ${control.maxDrawdownLamports}`,
      );
    }

    if (
      decision !== 'deny' &&
      control.maxExposureBpsPerToken !== undefined &&
      projectedTokenExposureBps > control.maxExposureBpsPerToken
    ) {
      decision = 'require_approval';
      reasons.push(
        `Projected token exposure ${projectedTokenExposureBps} bps exceeds ${control.maxExposureBpsPerToken}`,
      );
    }

    if (
      decision !== 'deny' &&
      control.maxExposureBpsPerProtocol !== undefined &&
      projectedProtocolExposureBps > control.maxExposureBpsPerProtocol
    ) {
      decision = 'require_approval';
      reasons.push(
        `Projected protocol exposure ${projectedProtocolExposureBps} bps exceeds ${control.maxExposureBpsPerProtocol}`,
      );
    }

    return {
      decision,
      reasons,
      projectedDailyLossLamports,
      projectedDrawdownLamports,
      projectedTokenExposureBps,
      projectedProtocolExposureBps,
    };
  }
}
