export interface DeltaGuardResult {
  ok: boolean;
  expectedLamportsDelta: number | null;
  observedLamportsDelta: number | null;
  varianceBps: number | null;
  reason?: string;
}

export const expectedLamportsDelta = (
  type: string,
  intent: Record<string, unknown>,
): number | null => {
  const amount = Number(intent['lamports'] ?? intent['amountLamports'] ?? intent['amount'] ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  if (
    type === 'transfer_sol' ||
    type === 'stake' ||
    type === 'lend_supply' ||
    type === 'create_escrow' ||
    type === 'create_milestone_escrow'
  ) {
    return -amount;
  }

  if (type === 'unstake' || type === 'release_escrow' || type === 'refund_escrow' || type === 'resolve_dispute') {
    return amount;
  }

  return null;
};

export const evaluateDeltaGuard = (
  expected: number | null,
  observed: number | null,
  thresholdBps: number,
  absoluteToleranceLamports = 0,
): DeltaGuardResult => {
  if (expected === null || observed === null) {
    return {
      ok: true,
      expectedLamportsDelta: expected,
      observedLamportsDelta: observed,
      varianceBps: null,
      reason: 'insufficient delta data',
    };
  }

  const absoluteDelta = Math.abs(observed - expected);
  if (absoluteToleranceLamports > 0 && absoluteDelta <= absoluteToleranceLamports) {
    return {
      ok: true,
      expectedLamportsDelta: expected,
      observedLamportsDelta: observed,
      varianceBps: 0,
      reason: `within absolute tolerance (${absoluteDelta} <= ${absoluteToleranceLamports} lamports)`,
    };
  }

  const denom = Math.max(1, Math.abs(expected));
  const varianceBps = Math.round((absoluteDelta / denom) * 10000);
  const ok = varianceBps <= thresholdBps;

  return {
    ok,
    expectedLamportsDelta: expected,
    observedLamportsDelta: observed,
    varianceBps,
    ...(ok ? {} : { reason: `delta variance ${varianceBps} bps exceeds ${thresholdBps}` }),
  };
};
