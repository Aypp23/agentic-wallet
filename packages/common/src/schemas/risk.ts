import { z } from 'zod';

export const protocolRiskConfigSchema = z.object({
  protocol: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  maxSlippageBps: z.number().int().min(0).max(10000).optional(),
  maxPoolConcentrationBps: z.number().int().min(0).max(10000).optional(),
  allowedPools: z.array(z.string().min(1)).default([]),
  allowedPrograms: z.array(z.string().min(32)).default([]),
  oracleDeviationBps: z.number().int().min(0).max(10000).optional(),
  requireOracleForSwap: z.boolean().default(false),
  maxQuoteAgeSeconds: z.number().int().positive().optional(),
  deltaVarianceBpsThreshold: z.number().int().min(0).max(10000).default(500),
  gaslessEligible: z.boolean().default(true),
  updatedAt: z.string().datetime(),
});

export const upsertProtocolRiskConfigRequestSchema = protocolRiskConfigSchema
  .omit({
    updatedAt: true,
  })
  .partial()
  .extend({
    protocol: z.string().min(1),
  });

export const portfolioRiskControlsSchema = z.object({
  walletId: z.string().uuid(),
  maxDrawdownLamports: z.number().int().nonnegative().optional(),
  maxDailyLossLamports: z.number().int().nonnegative().optional(),
  maxExposureBpsPerToken: z.number().int().min(0).max(10000).optional(),
  maxExposureBpsPerProtocol: z.number().int().min(0).max(10000).optional(),
  autoPauseOnBreach: z.boolean().default(true),
  updatedAt: z.string().datetime(),
});

export const upsertPortfolioRiskControlsRequestSchema = portfolioRiskControlsSchema
  .omit({
    updatedAt: true,
  })
  .partial()
  .extend({
    walletId: z.string().uuid(),
  });

export const executionProofSchema = z.object({
  txId: z.string().uuid(),
  walletId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  intentHash: z.string().length(64),
  policyHash: z.string().length(64),
  simulationHash: z.string().length(64),
  signature: z.string().optional(),
  proofHash: z.string().length(64),
  createdAt: z.string().datetime(),
});

export type ProtocolRiskConfig = z.infer<typeof protocolRiskConfigSchema>;
export type UpsertProtocolRiskConfigRequest = z.infer<typeof upsertProtocolRiskConfigRequestSchema>;
export type PortfolioRiskControls = z.infer<typeof portfolioRiskControlsSchema>;
export type UpsertPortfolioRiskControlsRequest = z.infer<typeof upsertPortfolioRiskControlsRequestSchema>;
export type ExecutionProof = z.infer<typeof executionProofSchema>;
