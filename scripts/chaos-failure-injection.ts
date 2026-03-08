import 'dotenv/config';
const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';

const headers: HeadersInit = {
  'content-type': 'application/json',
  'x-api-key': apiKey,
};

const main = async () => {
  console.log('Enabling chaos mode (forced simulation failure)...');
  await fetch(`${apiBase}/api/v1/chaos`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      enabled: true,
      failureRates: {
        simulation: 1,
      },
      latencyMs: 0,
    }),
  });

  const walletRes = await fetch(`${apiBase}/api/v1/wallets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ label: 'chaos-wallet' }),
  });
  const walletPayload = (await walletRes.json()) as { data: { id: string; publicKey: string } };

  const txRes = await fetch(`${apiBase}/api/v1/transactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      walletId: walletPayload.data.id,
      type: 'transfer_sol',
      protocol: 'system-program',
      intent: {
        destination: walletPayload.data.publicKey,
        lamports: 1_000_000,
      },
    }),
  });
  const txPayload = await txRes.text();
  console.log('Chaos transaction response:', txRes.status, txPayload);
  const parsed = JSON.parse(txPayload) as { data?: { status?: string; error?: string } };
  if (parsed.data?.status !== 'failed' || !String(parsed.data?.error ?? '').includes('Chaos switchboard')) {
    throw new Error('Chaos scenario did not produce expected forced failure result');
  }

  console.log('Resetting chaos mode...');
  await fetch(`${apiBase}/api/v1/chaos`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      enabled: false,
      failureRates: {},
      latencyMs: 0,
    }),
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
