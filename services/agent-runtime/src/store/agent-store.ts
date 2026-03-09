import type { Agent } from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from './persistence.js';

interface AgentStoreSnapshot {
  agents: Agent[];
}

export class AgentStore {
  private readonly agents = new Map<string, Agent>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<AgentStoreSnapshot>(this.snapshotFile, { agents: [] });
    for (const agent of snapshot.agents) {
      this.agents.set(agent.id, agent);
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, { agents: [...this.agents.values()] });
  }

  set(agent: Agent): Agent {
    this.agents.set(agent.id, agent);
    this.persist();
    return agent;
  }

  get(agentId: string): Agent | null {
    return this.agents.get(agentId) ?? null;
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  clear(): void {
    this.agents.clear();
    this.persist();
  }
}
