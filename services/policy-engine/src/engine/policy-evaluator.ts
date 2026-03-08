import type {
  Policy,
  PolicyDecision,
  PolicyEvaluationRequest,
  PolicyRule,
  RiskTier,
} from '@agentic-wallet/common';
import { readJsonFile, writeJsonFile } from '../store/persistence.js';

interface RateLimitWindow {
  timestamp: number;
}

interface PolicyEvaluatorSnapshot {
  rateLimitEvents: Array<[string, RateLimitWindow[]]>;
  dailySpendByWallet: Array<[string, number]>;
}

const RESTRICTED_TYPES = new Set(['flash_loan_bundle', 'cpi_call', 'custom_instruction_bundle']);

const deduceRiskTier = (input: PolicyEvaluationRequest): RiskTier => {
  if (input.riskTierHint) {
    return input.riskTierHint;
  }
  if (RESTRICTED_TYPES.has(input.type)) {
    return 'critical';
  }
  if ((input.amountLamports ?? 0) > 2_000_000_000) {
    return 'high';
  }
  if (input.type.includes('swap') || input.type.includes('lend') || input.type.includes('stake')) {
    return 'medium';
  }
  return 'low';
};

export class PolicyEvaluator {
  private readonly rateLimitEvents = new Map<string, RateLimitWindow[]>();
  private readonly dailySpendByWallet = new Map<string, number>();
  private readonly snapshotFile: string | undefined;

  constructor(snapshotFile?: string) {
    this.snapshotFile = snapshotFile;
    const snapshot = readJsonFile<PolicyEvaluatorSnapshot>(this.snapshotFile, {
      rateLimitEvents: [],
      dailySpendByWallet: [],
    });
    for (const [key, windows] of snapshot.rateLimitEvents) {
      this.rateLimitEvents.set(key, windows);
    }
    for (const [key, value] of snapshot.dailySpendByWallet) {
      this.dailySpendByWallet.set(key, value);
    }
  }

  private persist(): void {
    writeJsonFile(this.snapshotFile, {
      rateLimitEvents: [...this.rateLimitEvents.entries()],
      dailySpendByWallet: [...this.dailySpendByWallet.entries()],
    });
  }

  evaluate(input: PolicyEvaluationRequest, policies: Policy[]): PolicyDecision {
    const reasons: string[] = [];
    let decision: PolicyDecision['decision'] = 'allow';
    const riskTier = deduceRiskTier(input);
    const spendingUpdates: Array<{ key: string; amount: number }> = [];

    if (riskTier === 'critical') {
      decision = 'require_approval';
      reasons.push('Critical risk tier requires approval by default');
    }

    for (const policy of policies) {
      for (const rule of policy.rules) {
        const ruleDecision = this.applyRule(input, rule, riskTier);

        if (ruleDecision.decision === 'deny') {
          this.persist();
          return {
            decision: 'deny',
            reasons: [...reasons, ...ruleDecision.reasons],
            riskTier,
          };
        }

        if (ruleDecision.decision === 'require_approval') {
          decision = 'require_approval';
        }

        reasons.push(...ruleDecision.reasons);
        if (ruleDecision.spendingUpdate) {
          spendingUpdates.push(ruleDecision.spendingUpdate);
        }
      }
    }

    if (decision === 'allow') {
      for (const update of spendingUpdates) {
        const current = this.dailySpendByWallet.get(update.key) ?? 0;
        this.dailySpendByWallet.set(update.key, current + update.amount);
      }
    }
    this.persist();

    return {
      decision,
      reasons,
      riskTier,
    };
  }

  private applyRule(
    input: PolicyEvaluationRequest,
    rule: PolicyRule,
    _riskTier: RiskTier,
  ): {
    decision: 'allow' | 'deny' | 'require_approval';
    reasons: string[];
    spendingUpdate?: { key: string; amount: number };
  } {
    switch (rule.type) {
      case 'spending_limit': {
        const amount = input.amountLamports ?? 0;

        if (rule.maxLamportsPerTx !== undefined && amount > rule.maxLamportsPerTx) {
          return {
            decision: 'deny',
            reasons: [`Amount ${amount} exceeds maxLamportsPerTx ${rule.maxLamportsPerTx}`],
          };
        }

        if (
          rule.requireApprovalAboveLamports !== undefined &&
          amount >= rule.requireApprovalAboveLamports
        ) {
          return {
            decision: 'require_approval',
            reasons: [
              `Amount ${amount} is above approval threshold ${rule.requireApprovalAboveLamports}`,
            ],
          };
        }

        if (rule.maxLamportsPerDay !== undefined) {
          const day = new Date(input.timestamp ?? Date.now()).toISOString().slice(0, 10);
          const key = `${input.walletId}:${day}`;
          const alreadySpent = this.dailySpendByWallet.get(key) ?? 0;
          if (alreadySpent + amount > rule.maxLamportsPerDay) {
            return {
              decision: 'deny',
              reasons: [
                `Projected daily spend ${alreadySpent + amount} exceeds maxLamportsPerDay ${rule.maxLamportsPerDay}`,
              ],
            };
          }

          return {
            decision: 'allow',
            reasons: [],
            spendingUpdate: { key, amount },
          };
        }

        return { decision: 'allow', reasons: [] };
      }

      case 'address_allowlist': {
        if (input.destination && !rule.addresses.includes(input.destination)) {
          return {
            decision: 'deny',
            reasons: [`Destination ${input.destination} not in allowlist`],
          };
        }
        return { decision: 'allow', reasons: [] };
      }

      case 'address_blocklist': {
        if (input.destination && rule.addresses.includes(input.destination)) {
          return {
            decision: 'deny',
            reasons: [`Destination ${input.destination} is blocklisted`],
          };
        }
        return { decision: 'allow', reasons: [] };
      }

      case 'program_allowlist': {
        const nonAllowed = input.programIds.filter((programId) => !rule.programIds.includes(programId));
        if (nonAllowed.length > 0) {
          return {
            decision: 'deny',
            reasons: [`Programs not allowed: ${nonAllowed.join(', ')}`],
          };
        }
        return { decision: 'allow', reasons: [] };
      }

      case 'token_allowlist': {
        if (input.tokenMint && !rule.mints.includes(input.tokenMint)) {
          return {
            decision: 'deny',
            reasons: [`Token mint ${input.tokenMint} not allowed`],
          };
        }
        return { decision: 'allow', reasons: [] };
      }

      case 'protocol_allowlist': {
        if (!rule.protocols.includes(input.protocol)) {
          return {
            decision: 'deny',
            reasons: [`Protocol ${input.protocol} not allowed`],
          };
        }
        return { decision: 'allow', reasons: [] };
      }

      case 'rate_limit': {
        const key = `${input.walletId}:${input.agentId ?? 'none'}`;
        const now = Date.now();
        const windowStart = now - rule.windowSeconds * 1000;
        const events = (this.rateLimitEvents.get(key) ?? []).filter((event) => event.timestamp >= windowStart);

        if (events.length >= rule.maxTx) {
          return {
            decision: 'deny',
            reasons: [`Rate limit exceeded: ${events.length}/${rule.maxTx} in ${rule.windowSeconds}s`],
          };
        }

        events.push({ timestamp: now });
        this.rateLimitEvents.set(key, events);

        return { decision: 'allow', reasons: [] };
      }

      case 'time_window': {
        const ts = input.timestamp ? new Date(input.timestamp) : new Date();
        const hour = ts.getUTCHours();
        const inWindow =
          rule.startHourUtc <= rule.endHourUtc
            ? hour >= rule.startHourUtc && hour <= rule.endHourUtc
            : hour >= rule.startHourUtc || hour <= rule.endHourUtc;

        if (!inWindow) {
          return {
            decision: 'deny',
            reasons: [
              `Current UTC hour ${hour} outside allowed window ${rule.startHourUtc}-${rule.endHourUtc}`,
            ],
          };
        }

        return { decision: 'allow', reasons: [] };
      }

      case 'max_slippage': {
        if ((input.slippageBps ?? 0) > rule.maxBps) {
          return {
            decision: 'deny',
            reasons: [`Slippage ${input.slippageBps} bps exceeds max ${rule.maxBps}`],
          };
        }
        return { decision: 'allow', reasons: [] };
      }

      case 'protocol_risk': {
        if (input.protocol !== rule.protocol) {
          return { decision: 'allow', reasons: [] };
        }

        if (
          rule.maxSlippageBps !== undefined &&
          input.slippageBps !== undefined &&
          input.slippageBps > rule.maxSlippageBps
        ) {
          return {
            decision: 'deny',
            reasons: [`Protocol slippage ${input.slippageBps} bps exceeds ${rule.maxSlippageBps}`],
          };
        }

        if (
          rule.maxPoolConcentrationBps !== undefined &&
          input.poolConcentrationBps !== undefined &&
          input.poolConcentrationBps > rule.maxPoolConcentrationBps
        ) {
          return {
            decision: 'deny',
            reasons: [
              `Pool concentration ${input.poolConcentrationBps} bps exceeds ${rule.maxPoolConcentrationBps}`,
            ],
          };
        }

        if (rule.allowedPools?.length && input.pool && !rule.allowedPools.includes(input.pool)) {
          return {
            decision: 'deny',
            reasons: [`Pool ${input.pool} is not allowlisted for protocol ${input.protocol}`],
          };
        }

        if (rule.allowedPrograms?.length) {
          const disallowed = input.programIds.filter((program) => !rule.allowedPrograms?.includes(program));
          if (disallowed.length > 0) {
            return {
              decision: 'deny',
              reasons: [`Protocol risk disallowed programs: ${disallowed.join(', ')}`],
            };
          }
        }

        if (
          rule.oracleDeviationBps !== undefined &&
          input.oraclePriceUsd !== undefined &&
          input.quotedPriceUsd !== undefined
        ) {
          const diff = Math.abs(input.oraclePriceUsd - input.quotedPriceUsd);
          const bps = input.oraclePriceUsd === 0 ? 10000 : Math.round((diff / input.oraclePriceUsd) * 10000);
          if (bps > rule.oracleDeviationBps) {
            return {
              decision: 'require_approval',
              reasons: [
                `Oracle deviation ${bps} bps exceeds ${rule.oracleDeviationBps}, requiring approval`,
              ],
            };
          }
        }

        return { decision: 'allow', reasons: [] };
      }

      case 'portfolio_risk': {
        if (
          rule.maxDailyLossLamports !== undefined &&
          input.projectedDailyLossLamports !== undefined &&
          input.projectedDailyLossLamports > rule.maxDailyLossLamports
        ) {
          return {
            decision: 'deny',
            reasons: [
              `Projected daily loss ${input.projectedDailyLossLamports} exceeds ${rule.maxDailyLossLamports}`,
            ],
          };
        }

        if (
          rule.maxDrawdownLamports !== undefined &&
          input.projectedDrawdownLamports !== undefined &&
          input.projectedDrawdownLamports > rule.maxDrawdownLamports
        ) {
          return {
            decision: 'deny',
            reasons: [
              `Projected drawdown ${input.projectedDrawdownLamports} exceeds ${rule.maxDrawdownLamports}`,
            ],
          };
        }

        if (
          rule.maxExposureBpsPerToken !== undefined &&
          input.projectedTokenExposureBps !== undefined &&
          input.projectedTokenExposureBps > rule.maxExposureBpsPerToken
        ) {
          return {
            decision: 'require_approval',
            reasons: [
              `Projected token exposure ${input.projectedTokenExposureBps} bps exceeds ${rule.maxExposureBpsPerToken}`,
            ],
          };
        }

        if (
          rule.maxExposureBpsPerProtocol !== undefined &&
          input.projectedProtocolExposureBps !== undefined &&
          input.projectedProtocolExposureBps > rule.maxExposureBpsPerProtocol
        ) {
          return {
            decision: 'require_approval',
            reasons: [
              `Projected protocol exposure ${input.projectedProtocolExposureBps} bps exceeds ${rule.maxExposureBpsPerProtocol}`,
            ],
          };
        }

        return { decision: 'allow', reasons: [] };
      }

      default:
        return { decision: 'allow', reasons: [] };
    }
  }
}
