import 'dotenv/config';
const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';

const headers: HeadersInit = {
  'content-type': 'application/json',
  'x-api-key': apiKey,
};

const main = async () => {
  const protocolsRes = await fetch(`${apiBase}/api/v1/protocols`, { headers });
  if (!protocolsRes.ok) {
    throw new Error(`protocol list failed: ${protocolsRes.status} ${await protocolsRes.text()}`);
  }
  const protocols = (await protocolsRes.json()) as {
    data: Array<{ protocol: string; version: string }>;
  };

  for (const protocol of protocols.data) {
    const checkRes = await fetch(`${apiBase}/api/v1/protocols/${protocol.protocol}/compatibility-check`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetVersion: protocol.version }),
    });
    const body = await checkRes.text();
    console.log(`[${protocol.protocol}] compatibility`, checkRes.status, body);
    if (!checkRes.ok) {
      throw new Error(`compatibility-check failed for ${protocol.protocol}: ${checkRes.status} ${body}`);
    }
  }

  const migrateRes = await fetch(`${apiBase}/api/v1/protocols/jupiter/migrate-intent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fromVersion: '0.9.0',
      toVersion: '1.0.0',
      type: 'swap',
      intent: {
        slippageBps: 50,
        inputMint: 'So11111111111111111111111111111111111111112',
      },
    }),
  });
  const migrateBody = await migrateRes.text();
  console.log('[jupiter] migrate-intent', migrateRes.status, migrateBody);
  if (!migrateRes.ok) {
    throw new Error(`jupiter migrate-intent failed: ${migrateRes.status} ${migrateBody}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
