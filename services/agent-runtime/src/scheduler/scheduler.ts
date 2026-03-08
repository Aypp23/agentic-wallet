interface AgentHeartbeat {
  agentId: string;
  timestamp: string;
  context: Record<string, unknown>;
}

interface SchedulerTaskInput {
  agentId: string;
  tick: number;
}

export class AgentScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly heartbeats = new Map<string, AgentHeartbeat[]>();
  private readonly ticks = new Map<string, number>();

  start(
    agentId: string,
    task: (input: SchedulerTaskInput) => Promise<Record<string, unknown>>,
    intervalMs = 5000,
  ): void {
    this.stop(agentId);
    this.ticks.set(agentId, 0);

    const timer = setInterval(async () => {
      try {
        const tick = (this.ticks.get(agentId) ?? 0) + 1;
        this.ticks.set(agentId, tick);
        const context = await task({ agentId, tick });
        const list = this.heartbeats.get(agentId) ?? [];
        list.push({
          agentId,
          timestamp: new Date().toISOString(),
          context,
        });
        this.heartbeats.set(agentId, list.slice(-100));
      } catch {
        // Keep scheduler alive even if one cycle fails.
      }
    }, intervalMs);

    this.timers.set(agentId, timer);
  }

  stop(agentId: string): void {
    const timer = this.timers.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(agentId);
    }
    this.ticks.delete(agentId);
  }

  getHeartbeats(agentId: string): AgentHeartbeat[] {
    return this.heartbeats.get(agentId) ?? [];
  }
}
