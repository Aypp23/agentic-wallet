import 'dotenv/config';
const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';

const headers: HeadersInit = {
  'content-type': 'application/json',
  'x-api-key': apiKey,
};

const main = async () => {
  const walletRes = await fetch(`${apiBase}/api/v1/wallets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ label: 'policy-migration-wallet' }),
  });
  if (!walletRes.ok) {
    throw new Error(`wallet create failed: ${walletRes.status} ${await walletRes.text()}`);
  }
  const wallet = (await walletRes.json()) as { data: { id: string } };

  const createRes = await fetch(`${apiBase}/api/v1/policies`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      walletId: wallet.data.id,
      name: 'migration-test-policy',
      active: true,
      rules: [
        {
          type: 'spending_limit',
          maxLamportsPerTx: 2_000_000,
        },
      ],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`policy create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { data: { id: string; version: number } };

  const migrateRes = await fetch(`${apiBase}/api/v1/policies/${created.data.id}/migrate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      targetVersion: created.data.version + 1,
      mode: 'add_default_risk_rules',
    }),
  });
  const migrateBody = await migrateRes.text();
  console.log('migrate status', migrateRes.status, migrateBody);
  if (!migrateRes.ok) {
    throw new Error(`policy migrate failed: ${migrateRes.status} ${migrateBody}`);
  }

  const versionsRes = await fetch(`${apiBase}/api/v1/policies/${created.data.id}/versions`, {
    headers,
  });
  const versionsBody = await versionsRes.text();
  console.log('versions status', versionsRes.status, versionsBody);
  if (!versionsRes.ok) {
    throw new Error(`policy versions failed: ${versionsRes.status} ${versionsBody}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
