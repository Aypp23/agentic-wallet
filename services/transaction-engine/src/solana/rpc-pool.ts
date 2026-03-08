import { Connection } from '@solana/web3.js';

interface RpcEndpointHealth {
  score: number;
  successes: number;
  failures: number;
  avgLatencyMs: number;
  failStreak: number;
  lastCheckedAt?: string;
  lastError?: string;
}

interface RpcEndpoint {
  url: string;
  connection: Connection;
  health: RpcEndpointHealth;
}

interface RpcPoolConfig {
  urls: string[];
  commitment?: 'processed' | 'confirmed' | 'finalized';
  probeIntervalMs?: number;
}

export interface RpcPoolStatus {
  endpoints: Array<{
    url: string;
    score: number;
    successes: number;
    failures: number;
    avgLatencyMs: number;
    failStreak: number;
    lastCheckedAt?: string;
    lastError?: string;
  }>;
}

const latencyPenalty = (latencyMs: number): number => {
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) return 0;
  if (latencyMs <= 200) return 0;
  if (latencyMs <= 500) return 0.04;
  if (latencyMs <= 1_000) return 0.08;
  return 0.12;
};

const updateSuccess = (endpoint: RpcEndpoint, latencyMs: number): void => {
  const nextAvg =
    endpoint.health.avgLatencyMs === 0
      ? latencyMs
      : Math.round(endpoint.health.avgLatencyMs * 0.7 + latencyMs * 0.3);

  endpoint.health.successes += 1;
  endpoint.health.failStreak = 0;
  endpoint.health.avgLatencyMs = nextAvg;
  endpoint.health.lastCheckedAt = new Date().toISOString();
  delete endpoint.health.lastError;
  endpoint.health.score = Math.max(
    0.05,
    Math.min(1, endpoint.health.score + 0.06 - latencyPenalty(nextAvg)),
  );
};

const updateFailure = (endpoint: RpcEndpoint, error: unknown): void => {
  endpoint.health.failures += 1;
  endpoint.health.failStreak += 1;
  endpoint.health.lastCheckedAt = new Date().toISOString();
  endpoint.health.lastError =
    error instanceof Error ? error.message : String(error);
  endpoint.health.score = Math.max(0.05, endpoint.health.score * 0.7);
};

const byScore = (a: RpcEndpoint, b: RpcEndpoint): number => {
  if (a.health.score === b.health.score) {
    return a.health.avgLatencyMs - b.health.avgLatencyMs;
  }
  return b.health.score - a.health.score;
};

export class SolanaRpcPool {
  private readonly endpoints: RpcEndpoint[];
  private readonly probeIntervalMs: number;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RpcPoolConfig) {
    const urls = config.urls.map((url) => url.trim()).filter(Boolean);
    if (urls.length === 0) {
      throw new Error('SolanaRpcPool requires at least one RPC URL');
    }

    this.endpoints = urls.map((url) => ({
      url,
      connection: new Connection(url, config.commitment ?? 'confirmed'),
      health: {
        score: 1,
        successes: 0,
        failures: 0,
        avgLatencyMs: 0,
        failStreak: 0,
      },
    }));
    this.probeIntervalMs = Math.max(2_000, config.probeIntervalMs ?? 15_000);
    this.startProbes();
  }

  getStatus(): RpcPoolStatus {
    return {
      endpoints: this.endpoints
        .slice()
        .sort(byScore)
        .map((endpoint) => ({
          url: endpoint.url,
          score: Number(endpoint.health.score.toFixed(4)),
          successes: endpoint.health.successes,
          failures: endpoint.health.failures,
          avgLatencyMs: endpoint.health.avgLatencyMs,
          failStreak: endpoint.health.failStreak,
          ...(endpoint.health.lastCheckedAt
            ? { lastCheckedAt: endpoint.health.lastCheckedAt }
            : {}),
          ...(endpoint.health.lastError ? { lastError: endpoint.health.lastError } : {}),
        })),
    };
  }

  async withFailover<T>(
    operation: string,
    run: (connection: Connection, endpointUrl: string) => Promise<T>,
  ): Promise<T> {
    const candidates = this.endpoints.slice().sort(byScore);
    let lastError: unknown;

    for (const endpoint of candidates) {
      const startedAt = Date.now();
      try {
        const result = await run(endpoint.connection, endpoint.url);
        updateSuccess(endpoint, Date.now() - startedAt);
        return result;
      } catch (error) {
        updateFailure(endpoint, error);
        lastError = error;
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`${operation} failed across RPC pool: ${message}`);
  }

  stop(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private startProbes(): void {
    const runProbe = async (): Promise<void> => {
      await Promise.all(
        this.endpoints.map(async (endpoint) => {
          const startedAt = Date.now();
          try {
            await endpoint.connection.getLatestBlockhash('confirmed');
            updateSuccess(endpoint, Date.now() - startedAt);
          } catch (error) {
            updateFailure(endpoint, error);
          }
        }),
      );
    };

    void runProbe();
    this.probeTimer = setInterval(() => {
      void runProbe();
    }, this.probeIntervalMs);
    this.probeTimer.unref?.();
  }
}
