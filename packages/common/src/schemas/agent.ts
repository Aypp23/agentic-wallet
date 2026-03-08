import { z } from 'zod';
import { transactionTypeSchema } from './transaction.js';

export const agentStatusSchema = z.enum(['stopped', 'running', 'paused']);

export const executionModeSchema = z.enum(['autonomous', 'supervised']);

export const autonomousConditionMetricSchema = z.enum([
  'tick',
  'balance_lamports',
  'known_wallets_count',
]);

export const autonomousConditionOperatorSchema = z.enum(['gt', 'gte', 'lt', 'lte', 'eq']);

export const autonomousDecisionConditionSchema = z.object({
  metric: autonomousConditionMetricSchema,
  op: autonomousConditionOperatorSchema,
  value: z.number(),
});

export const autonomousActionSchema = z.object({
  type: transactionTypeSchema,
  protocol: z.string().min(1),
  intent: z.record(z.unknown()).default({}),
  gasless: z.boolean().optional(),
  paperOnly: z.boolean().optional(),
});

export const autonomousStepSchema = z.object({
  id: z.string().min(1).max(128),
  type: transactionTypeSchema,
  protocol: z.string().min(1),
  intent: z.record(z.unknown()).default({}),
  gasless: z.boolean().optional(),
  paperOnly: z.boolean().optional(),
  cooldownSeconds: z.number().int().positive().max(86_400).default(30),
  maxRuns: z.number().int().positive().optional(),
});

export const autonomousDecisionRuleSchema = z.object({
  id: z.string().min(1).max(128),
  when: z.array(autonomousDecisionConditionSchema).min(1),
  then: autonomousActionSchema,
  cooldownSeconds: z.number().int().positive().max(86_400).default(60),
  maxRuns: z.number().int().positive().optional(),
});

export const autonomousConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['execute', 'paper']).default('execute'),
  cadenceSeconds: z.number().int().positive().max(86_400).default(30),
  maxActionsPerHour: z.number().int().positive().max(3_600).default(60),
  steps: z.array(autonomousStepSchema).default([]),
  rules: z.array(autonomousDecisionRuleSchema).default([]),
});

export const capabilityManifestSchema = z.object({
  issuer: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  agentId: z.string().uuid(),
  allowedIntents: z.array(transactionTypeSchema),
  allowedProtocols: z.array(z.string().min(1)),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(8),
  signature: z.string().min(16),
});

export const agentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  walletId: z.string().uuid(),
  status: agentStatusSchema,
  executionMode: executionModeSchema,
  allowedIntents: z.array(transactionTypeSchema),
  autonomy: autonomousConfigSchema.optional(),
  capabilityManifest: capabilityManifestSchema.optional(),
  budgetLamports: z.number().int().nonnegative().optional(),
  pausedReason: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createAgentRequestSchema = z.object({
  name: z.string().min(1).max(128),
  walletId: z.string().uuid().optional(),
  executionMode: executionModeSchema.default('autonomous'),
  allowedIntents: z.array(transactionTypeSchema).default(['transfer_sol', 'transfer_spl', 'query_balance']),
  autonomy: autonomousConfigSchema.optional(),
  budgetLamports: z.number().int().nonnegative().optional(),
});

export const updateAgentCapabilitiesSchema = z.object({
  allowedIntents: z.array(transactionTypeSchema),
  executionMode: executionModeSchema.optional(),
  autonomy: autonomousConfigSchema.optional(),
  budgetLamports: z.number().int().nonnegative().optional(),
});

export const executeAgentIntentSchema = z.object({
  type: transactionTypeSchema,
  protocol: z.string().min(1),
  gasless: z.boolean().optional(),
  intent: z.record(z.unknown()).default({}),
});

export const issueCapabilityManifestRequestSchema = z.object({
  allowedIntents: z.array(transactionTypeSchema),
  allowedProtocols: z.array(z.string().min(1)),
  ttlSeconds: z.number().int().positive().max(60 * 60 * 24 * 30).default(3600),
});

export const verifyCapabilityManifestRequestSchema = z.object({
  manifest: capabilityManifestSchema,
});

export type Agent = z.infer<typeof agentSchema>;
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;
export type UpdateAgentCapabilitiesRequest = z.infer<typeof updateAgentCapabilitiesSchema>;
export type ExecuteAgentIntentRequest = z.infer<typeof executeAgentIntentSchema>;
export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;
export type AutonomousConfig = z.infer<typeof autonomousConfigSchema>;
export type AutonomousAction = z.infer<typeof autonomousActionSchema>;
export type AutonomousDecisionCondition = z.infer<typeof autonomousDecisionConditionSchema>;
export type AutonomousStep = z.infer<typeof autonomousStepSchema>;
export type AutonomousDecisionRule = z.infer<typeof autonomousDecisionRuleSchema>;
