import {
  ComputeBudgetProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import type { TransactionType } from '@agentic-wallet/common';

export interface AdaptiveExecutionConfig {
  computeUnitLimit: number;
  priorityFeeMicroLamports: number;
}

interface AdaptiveInput {
  type: TransactionType;
  instructionCount: number;
  recentPriorityFees: number[];
  minPriorityFeeMicroLamports?: number;
  maxPriorityFeeMicroLamports?: number;
  percentile?: number;
  multiplierBps?: number;
}

const computeByType: Record<TransactionType, number> = {
  transfer_sol: 120_000,
  transfer_spl: 180_000,
  swap: 380_000,
  stake: 240_000,
  unstake: 240_000,
  lend_supply: 320_000,
  lend_borrow: 350_000,
  create_mint: 260_000,
  mint_token: 220_000,
  query_balance: 80_000,
  query_positions: 80_000,
  create_escrow: 320_000,
  accept_escrow: 280_000,
  release_escrow: 260_000,
  refund_escrow: 260_000,
  dispute_escrow: 300_000,
  resolve_dispute: 300_000,
  create_milestone_escrow: 340_000,
  release_milestone: 280_000,
  x402_pay: 220_000,
  flash_loan_bundle: 450_000,
  cpi_call: 420_000,
  custom_instruction_bundle: 420_000,
  treasury_allocate: 200_000,
  treasury_rebalance: 260_000,
  paper_trade: 100_000,
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const sortedNonNegativeFees = (fees: number[]): number[] => {
  return fees
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
};

const percentileValue = (values: number[], percentile: number): number => {
  if (values.length === 0) return 0;
  const p = clamp(percentile, 1, 99);
  const index = Math.floor((p / 100) * (values.length - 1));
  return values[index] ?? values[values.length - 1] ?? 0;
};

export const buildAdaptiveExecutionConfig = (input: AdaptiveInput): AdaptiveExecutionConfig => {
  const minFee = input.minPriorityFeeMicroLamports ?? 2_000;
  const maxFee = input.maxPriorityFeeMicroLamports ?? 200_000;
  const percentile = input.percentile ?? 75;
  const multiplier = (input.multiplierBps ?? 1_150) / 10_000;

  const fees = sortedNonNegativeFees(input.recentPriorityFees);
  const pFee = percentileValue(fees, percentile);
  const boostedFee = Math.floor(pFee * multiplier);
  const priorityFeeMicroLamports = clamp(
    boostedFee > 0 ? boostedFee : minFee,
    minFee,
    maxFee,
  );

  const baseUnits = computeByType[input.type] ?? 250_000;
  const instructionBuffer = Math.max(0, input.instructionCount - 1) * 15_000;
  const computeUnitLimit = clamp(baseUnits + instructionBuffer, 100_000, 1_200_000);

  return {
    computeUnitLimit,
    priorityFeeMicroLamports,
  };
};

const isComputeBudgetIx = (ix: TransactionInstruction): boolean =>
  ix.programId.equals(ComputeBudgetProgram.programId);

export const applyAdaptiveExecutionConfig = (
  tx: Transaction,
  config: AdaptiveExecutionConfig,
): Transaction => {
  const nonBudgetIxs = tx.instructions.filter((ix) => !isComputeBudgetIx(ix));
  const budgetIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: config.computeUnitLimit,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: config.priorityFeeMicroLamports,
    }),
  ];

  tx.instructions = [...budgetIxs, ...nonBudgetIxs];
  return tx;
};
