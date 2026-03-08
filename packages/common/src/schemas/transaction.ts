import { z } from 'zod';

export const txStatusSchema = z.enum([
  'pending',
  'simulating',
  'policy_eval',
  'approval_gate',
  'signing',
  'submitting',
  'confirmed',
  'failed',
]);

export const transactionTypeSchema = z.enum([
  'transfer_sol',
  'transfer_spl',
  'swap',
  'stake',
  'unstake',
  'lend_supply',
  'lend_borrow',
  'create_mint',
  'mint_token',
  'query_balance',
  'query_positions',
  'create_escrow',
  'accept_escrow',
  'release_escrow',
  'refund_escrow',
  'dispute_escrow',
  'resolve_dispute',
  'create_milestone_escrow',
  'release_milestone',
  'x402_pay',
  'flash_loan_bundle',
  'cpi_call',
  'custom_instruction_bundle',
  'treasury_allocate',
  'treasury_rebalance',
  'paper_trade',
]);

export const createTransactionRequestSchema = z.object({
  walletId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  type: transactionTypeSchema,
  protocol: z.string().min(1),
  gasless: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128).optional(),
  intent: z.record(z.unknown()).optional(),
});

export type TxStatus = z.infer<typeof txStatusSchema>;
export type TransactionType = z.infer<typeof transactionTypeSchema>;
export type CreateTransactionRequest = z.infer<typeof createTransactionRequestSchema>;
