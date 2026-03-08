import { z } from 'zod';
import { transactionTypeSchema } from './transaction.js';

export const strategyIntentStepSchema = z.object({
  type: transactionTypeSchema,
  protocol: z.string().min(1),
  intent: z.record(z.unknown()).default({}),
  timestamp: z.string().datetime(),
  simulatedPnlLamports: z.number().int().optional(),
});

export const strategyBacktestRequestSchema = z.object({
  walletId: z.string().uuid(),
  name: z.string().min(1).max(128),
  steps: z.array(strategyIntentStepSchema).min(1),
  minimumPassRate: z.number().min(0).max(1).default(0.7),
});

export const strategyBacktestResultSchema = z.object({
  runId: z.string().uuid(),
  walletId: z.string().uuid(),
  name: z.string().min(1),
  totalSteps: z.number().int().positive(),
  passedSteps: z.number().int().nonnegative(),
  failedSteps: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  totalPnlLamports: z.number().int(),
  passed: z.boolean(),
  createdAt: z.string().datetime(),
});

export const paperTradeRequestSchema = z.object({
  agentId: z.string().uuid(),
  walletId: z.string().uuid(),
  type: transactionTypeSchema,
  protocol: z.string().min(1),
  intent: z.record(z.unknown()).default({}),
});

export const paperTradeRecordSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  walletId: z.string().uuid(),
  type: transactionTypeSchema,
  protocol: z.string().min(1),
  intent: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});

export type StrategyBacktestRequest = z.infer<typeof strategyBacktestRequestSchema>;
export type StrategyBacktestResult = z.infer<typeof strategyBacktestResultSchema>;
export type PaperTradeRequest = z.infer<typeof paperTradeRequestSchema>;
export type PaperTradeRecord = z.infer<typeof paperTradeRecordSchema>;
