import { z } from 'zod';

export const riskTierSchema = z.enum(['low', 'medium', 'high', 'critical']);

export const spendingLimitRuleSchema = z.object({
  type: z.literal('spending_limit'),
  maxLamportsPerTx: z.number().int().nonnegative().optional(),
  maxLamportsPerDay: z.number().int().nonnegative().optional(),
  requireApprovalAboveLamports: z.number().int().nonnegative().optional(),
});

export const addressAllowlistRuleSchema = z.object({
  type: z.literal('address_allowlist'),
  addresses: z.array(z.string().min(32)).min(1),
});

export const addressBlocklistRuleSchema = z.object({
  type: z.literal('address_blocklist'),
  addresses: z.array(z.string().min(32)).min(1),
});

export const programAllowlistRuleSchema = z.object({
  type: z.literal('program_allowlist'),
  programIds: z.array(z.string().min(32)).min(1),
});

export const tokenAllowlistRuleSchema = z.object({
  type: z.literal('token_allowlist'),
  mints: z.array(z.string().min(32)).min(1),
});

export const protocolAllowlistRuleSchema = z.object({
  type: z.literal('protocol_allowlist'),
  protocols: z.array(z.string().min(1)).min(1),
});

export const rateLimitRuleSchema = z.object({
  type: z.literal('rate_limit'),
  maxTx: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
});

export const timeWindowRuleSchema = z.object({
  type: z.literal('time_window'),
  startHourUtc: z.number().int().min(0).max(23),
  endHourUtc: z.number().int().min(0).max(23),
});

export const maxSlippageRuleSchema = z.object({
  type: z.literal('max_slippage'),
  maxBps: z.number().int().min(0).max(10000),
});

export const protocolRiskRuleSchema = z.object({
  type: z.literal('protocol_risk'),
  protocol: z.string().min(1),
  maxSlippageBps: z.number().int().min(0).max(10000).optional(),
  maxPoolConcentrationBps: z.number().int().min(0).max(10000).optional(),
  allowedPools: z.array(z.string().min(1)).optional(),
  allowedPrograms: z.array(z.string().min(32)).optional(),
  oracleDeviationBps: z.number().int().min(0).max(10000).optional(),
});

export const portfolioRiskRuleSchema = z.object({
  type: z.literal('portfolio_risk'),
  maxDrawdownLamports: z.number().int().nonnegative().optional(),
  maxDailyLossLamports: z.number().int().nonnegative().optional(),
  maxExposureBpsPerToken: z.number().int().min(0).max(10000).optional(),
  maxExposureBpsPerProtocol: z.number().int().min(0).max(10000).optional(),
});

export const policyRuleSchema = z.discriminatedUnion('type', [
  spendingLimitRuleSchema,
  addressAllowlistRuleSchema,
  addressBlocklistRuleSchema,
  programAllowlistRuleSchema,
  tokenAllowlistRuleSchema,
  protocolAllowlistRuleSchema,
  rateLimitRuleSchema,
  timeWindowRuleSchema,
  maxSlippageRuleSchema,
  protocolRiskRuleSchema,
  portfolioRiskRuleSchema,
]);

export const policySchema = z.object({
  id: z.string().uuid(),
  walletId: z.string().uuid(),
  name: z.string().min(1).max(128),
  version: z.number().int().positive(),
  active: z.boolean().default(true),
  rules: z.array(policyRuleSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createPolicyRequestSchema = z.object({
  walletId: z.string().uuid(),
  name: z.string().min(1).max(128),
  rules: z.array(policyRuleSchema).default([]),
  active: z.boolean().default(true),
});

export const updatePolicyRequestSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  rules: z.array(policyRuleSchema).optional(),
  active: z.boolean().optional(),
});

export const policyEvaluationRequestSchema = z.object({
  walletId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  type: z.string().min(1),
  protocol: z.string().min(1),
  destination: z.string().optional(),
  tokenMint: z.string().optional(),
  amountLamports: z.number().int().nonnegative().optional(),
  programIds: z.array(z.string()).default([]),
  slippageBps: z.number().int().min(0).max(10000).optional(),
  pool: z.string().optional(),
  poolConcentrationBps: z.number().int().min(0).max(10000).optional(),
  oraclePriceUsd: z.number().positive().optional(),
  quotedPriceUsd: z.number().positive().optional(),
  projectedDailyLossLamports: z.number().int().nonnegative().optional(),
  projectedDrawdownLamports: z.number().int().nonnegative().optional(),
  projectedTokenExposureBps: z.number().int().min(0).max(10000).optional(),
  projectedProtocolExposureBps: z.number().int().min(0).max(10000).optional(),
  timestamp: z.string().datetime().optional(),
  riskTierHint: riskTierSchema.optional(),
});

export const policyDecisionSchema = z.object({
  decision: z.enum(['allow', 'deny', 'require_approval']),
  reasons: z.array(z.string()),
  riskTier: riskTierSchema,
});

export type Policy = z.infer<typeof policySchema>;
export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type RiskTier = z.infer<typeof riskTierSchema>;
export type CreatePolicyRequest = z.infer<typeof createPolicyRequestSchema>;
export type UpdatePolicyRequest = z.infer<typeof updatePolicyRequestSchema>;
export type PolicyEvaluationRequest = z.infer<typeof policyEvaluationRequestSchema>;
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
