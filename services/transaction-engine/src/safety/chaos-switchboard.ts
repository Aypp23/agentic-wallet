interface ChaosConfig {
  enabled: boolean;
  failureRates: Record<string, number>;
  latencyMs: number;
}

const clampRate = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export class ChaosSwitchboard {
  private config: ChaosConfig = {
    enabled: false,
    failureRates: {},
    latencyMs: 0,
  };

  getConfig(): ChaosConfig {
    return {
      enabled: this.config.enabled,
      failureRates: { ...this.config.failureRates },
      latencyMs: this.config.latencyMs,
    };
  }

  update(input: Partial<ChaosConfig>): ChaosConfig {
    this.config = {
      enabled: input.enabled ?? this.config.enabled,
      failureRates:
        input.failureRates !== undefined
          ? Object.fromEntries(
              Object.entries(input.failureRates).map(([stage, rate]) => [stage, clampRate(rate)]),
            )
          : this.config.failureRates,
      latencyMs:
        input.latencyMs !== undefined
          ? Math.max(0, Math.trunc(input.latencyMs))
          : this.config.latencyMs,
    };
    return this.getConfig();
  }

  async maybeDelay(): Promise<void> {
    if (!this.config.enabled || this.config.latencyMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));
  }

  shouldFail(stage: string): boolean {
    if (!this.config.enabled) return false;
    const rate = clampRate(this.config.failureRates[stage] ?? 0);
    return Math.random() < rate;
  }
}
