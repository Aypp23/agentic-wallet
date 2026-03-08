import { z } from 'zod';

export const treasuryAllocationRequestSchema = z.object({
  sourceAgentId: z.string().uuid().optional(),
  targetAgentId: z.string().uuid(),
  lamports: z.number().int().positive(),
  reason: z.string().min(1).max(256).default('treasury allocation'),
});

export const treasuryRebalanceRequestSchema = z.object({
  sourceAgentId: z.string().uuid(),
  targetAgentId: z.string().uuid(),
  lamports: z.number().int().positive(),
  reason: z.string().min(1).max(256).default('treasury rebalance'),
});

export const agentBudgetSchema = z.object({
  agentId: z.string().uuid(),
  walletId: z.string().uuid(),
  budgetLamports: z.number().int().nonnegative(),
  spentLamportsToday: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});

export type TreasuryAllocationRequest = z.infer<typeof treasuryAllocationRequestSchema>;
export type TreasuryRebalanceRequest = z.infer<typeof treasuryRebalanceRequestSchema>;
export type AgentBudget = z.infer<typeof agentBudgetSchema>;
