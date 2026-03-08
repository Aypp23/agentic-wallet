import type {
  Agent,
  AutonomousConfig,
  AutonomousDecisionCondition,
  AutonomousDecisionRule,
  AutonomousStep,
  ExecuteAgentIntentRequest,
} from '@agentic-wallet/common';

export interface DecisionContext {
  tick: number;
  walletId: string;
  balanceLamports: number;
  knownWallets: string[];
}

export interface DecisionState {
  lastActionAtMs: number | null;
  actionsLastHourMs: number[];
  stepCursor: number;
  stepRuns: Record<string, number>;
  stepLastRunMs: Record<string, number>;
  ruleRuns: Record<string, number>;
  ruleLastRunMs: Record<string, number>;
}

export interface DecisionCandidate {
  reason: string;
  source: 'rule' | 'step';
  sourceId: string;
  request: ExecuteAgentIntentRequest;
}

const defaultAutonomy: Required<Omit<AutonomousConfig, 'steps' | 'rules'>> = {
  enabled: false,
  mode: 'execute',
  cadenceSeconds: 30,
  maxActionsPerHour: 60,
};

export const createDecisionState = (): DecisionState => ({
  lastActionAtMs: null,
  actionsLastHourMs: [],
  stepCursor: 0,
  stepRuns: {},
  stepLastRunMs: {},
  ruleRuns: {},
  ruleLastRunMs: {},
});

const compare = (left: number, op: AutonomousDecisionCondition['op'], right: number): boolean => {
  switch (op) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'eq':
      return left === right;
  }
};

const metricValue = (condition: AutonomousDecisionCondition, context: DecisionContext): number => {
  switch (condition.metric) {
    case 'tick':
      return context.tick;
    case 'balance_lamports':
      return context.balanceLamports;
    case 'known_wallets_count':
      return context.knownWallets.length;
  }
};

const evaluateRule = (rule: AutonomousDecisionRule, context: DecisionContext): boolean =>
  rule.when.every((condition) => compare(metricValue(condition, context), condition.op, condition.value));

const shouldThrottleByCadence = (autonomy: AutonomousConfig, state: DecisionState, nowMs: number): boolean => {
  if (state.lastActionAtMs === null) return false;
  return nowMs - state.lastActionAtMs < autonomy.cadenceSeconds * 1000;
};

const pruneActionWindow = (state: DecisionState, nowMs: number): void => {
  const cutoff = nowMs - 60 * 60 * 1000;
  state.actionsLastHourMs = state.actionsLastHourMs.filter((timestamp) => timestamp >= cutoff);
};

const shouldThrottleByRate = (autonomy: AutonomousConfig, state: DecisionState): boolean => {
  return state.actionsLastHourMs.length >= autonomy.maxActionsPerHour;
};

const canRun = (
  id: string,
  maxRuns: number | undefined,
  cooldownSeconds: number,
  runCounter: Record<string, number>,
  lastRunAt: Record<string, number>,
  nowMs: number,
): boolean => {
  if (maxRuns !== undefined && (runCounter[id] ?? 0) >= maxRuns) {
    return false;
  }

  const last = lastRunAt[id];
  if (last === undefined) {
    return true;
  }

  return nowMs - last >= cooldownSeconds * 1000;
};

const replaceTemplate = (value: string, context: DecisionContext): string =>
  value
    .replaceAll('{{tick}}', String(context.tick))
    .replaceAll('{{walletId}}', context.walletId)
    .replaceAll('{{balanceLamports}}', String(context.balanceLamports))
    .replaceAll('{{knownWallet0}}', context.knownWallets[0] ?? '')
    .replaceAll('{{knownWallet1}}', context.knownWallets[1] ?? '');

const applyTemplates = (input: Record<string, unknown>, context: DecisionContext): Record<string, unknown> => {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      output[key] = replaceTemplate(value, context);
      continue;
    }

    if (Array.isArray(value)) {
      output[key] = value.map((entry) => (typeof entry === 'string' ? replaceTemplate(entry, context) : entry));
      continue;
    }

    output[key] = value;
  }

  return output;
};

const stepToCandidate = (
  step: AutonomousStep,
  context: DecisionContext,
  autonomy: AutonomousConfig,
): DecisionCandidate => ({
  reason: `autonomy.step:${step.id}`,
  source: 'step',
  sourceId: step.id,
  request: {
    type: step.type,
    protocol: step.protocol,
    ...(step.gasless !== undefined ? { gasless: step.gasless } : {}),
    intent: {
      ...applyTemplates(step.intent, context),
      ...(autonomy.mode === 'paper' || step.paperOnly === true ? { paperOnly: true } : {}),
    },
  },
});

const ruleToCandidate = (
  rule: AutonomousDecisionRule,
  context: DecisionContext,
  autonomy: AutonomousConfig,
): DecisionCandidate => ({
  reason: `autonomy.rule:${rule.id}`,
  source: 'rule',
  sourceId: rule.id,
  request: {
    type: rule.then.type,
    protocol: rule.then.protocol,
    ...(rule.then.gasless !== undefined ? { gasless: rule.then.gasless } : {}),
    intent: {
      ...applyTemplates(rule.then.intent, context),
      ...(autonomy.mode === 'paper' || rule.then.paperOnly === true ? { paperOnly: true } : {}),
    },
  },
});

const chooseRuleCandidate = (
  autonomy: AutonomousConfig,
  context: DecisionContext,
  state: DecisionState,
  nowMs: number,
): DecisionCandidate | null => {
  for (const rule of autonomy.rules) {
    if (!evaluateRule(rule, context)) {
      continue;
    }

    if (!canRun(rule.id, rule.maxRuns, rule.cooldownSeconds, state.ruleRuns, state.ruleLastRunMs, nowMs)) {
      continue;
    }

    return ruleToCandidate(rule, context, autonomy);
  }

  return null;
};

const chooseStepCandidate = (
  autonomy: AutonomousConfig,
  context: DecisionContext,
  state: DecisionState,
  nowMs: number,
): DecisionCandidate | null => {
  const { steps } = autonomy;
  if (steps.length === 0) {
    return null;
  }

  const start = state.stepCursor % steps.length;
  for (let offset = 0; offset < steps.length; offset += 1) {
    const index = (start + offset) % steps.length;
    const step = steps[index];
    if (!step) {
      continue;
    }

    if (!canRun(step.id, step.maxRuns, step.cooldownSeconds, state.stepRuns, state.stepLastRunMs, nowMs)) {
      continue;
    }

    state.stepCursor = (index + 1) % steps.length;
    return stepToCandidate(step, context, autonomy);
  }

  return null;
};

export const decideAutonomousAction = (
  agent: Agent,
  context: DecisionContext,
  state: DecisionState,
  nowMs = Date.now(),
): DecisionCandidate | null => {
  const autonomy = agent.autonomy;
  if (!autonomy?.enabled) {
    return null;
  }

  if (agent.executionMode !== 'autonomous') {
    return null;
  }

  const normalizedAutonomy: AutonomousConfig = {
    ...defaultAutonomy,
    ...autonomy,
    steps: autonomy.steps ?? [],
    rules: autonomy.rules ?? [],
  };

  pruneActionWindow(state, nowMs);
  if (shouldThrottleByRate(normalizedAutonomy, state)) {
    return null;
  }
  if (shouldThrottleByCadence(normalizedAutonomy, state, nowMs)) {
    return null;
  }

  const ruleCandidate = chooseRuleCandidate(normalizedAutonomy, context, state, nowMs);
  if (ruleCandidate) {
    return ruleCandidate;
  }

  return chooseStepCandidate(normalizedAutonomy, context, state, nowMs);
};

export const markDecisionExecuted = (state: DecisionState, candidate: DecisionCandidate, nowMs = Date.now()): void => {
  state.lastActionAtMs = nowMs;
  state.actionsLastHourMs.push(nowMs);

  if (candidate.source === 'rule') {
    state.ruleRuns[candidate.sourceId] = (state.ruleRuns[candidate.sourceId] ?? 0) + 1;
    state.ruleLastRunMs[candidate.sourceId] = nowMs;
    return;
  }

  state.stepRuns[candidate.sourceId] = (state.stepRuns[candidate.sourceId] ?? 0) + 1;
  state.stepLastRunMs[candidate.sourceId] = nowMs;
};
