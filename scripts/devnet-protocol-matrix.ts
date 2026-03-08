import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';

const getWalletAddressForQuote = async (): Promise<string> => {
  if (process.env.SAMPLE_WALLET_ADDRESS) {
    return process.env.SAMPLE_WALLET_ADDRESS;
  }

  if (process.env.PRIVATE_KEY) {
    const value = process.env.PRIVATE_KEY.trim();
    if (value.startsWith('[')) {
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(value) as number[]));
      return kp.publicKey.toBase58();
    }

    const base64Decoded = Buffer.from(value, 'base64');
    if (base64Decoded.length === 64) {
      return Keypair.fromSecretKey(new Uint8Array(base64Decoded)).publicKey.toBase58();
    }

    const base58Decoded = bs58.decode(value);
    if (base58Decoded.length === 64) {
      return Keypair.fromSecretKey(base58Decoded).publicKey.toBase58();
    }
  }

  const createRes = await fetch(`${apiBase}/api/v1/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ label: 'protocol-matrix-wallet' }),
  });

  const created = (await createRes.json()) as { data: { publicKey: string } };
  return created.data.publicKey;
};

const main = async () => {
  const protocolsRes = await fetch(`${apiBase}/api/v1/protocols`, { headers: { 'x-api-key': apiKey } });
  if (!protocolsRes.ok) {
    throw new Error(`Failed to fetch protocols: ${protocolsRes.status}`);
  }

  const protocols = (await protocolsRes.json()) as {
    data: Array<{ protocol: string; capabilities: string[] }>;
  };

  console.log('Registered protocols:');
  for (const protocol of protocols.data) {
    console.log(`- ${protocol.protocol}: ${protocol.capabilities.join(', ')}`);
  }

  const walletAddress = await getWalletAddressForQuote();
  const swapProtocols = protocols.data.filter((p) => p.capabilities.includes('swap'));
  let successCount = 0;

  for (const protocol of swapProtocols) {
    const quoteRes = await fetch(`${apiBase}/api/v1/defi/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        protocol: protocol.protocol,
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '1000000',
        slippageBps: 50,
        walletAddress,
      }),
    });

    console.log(`[${protocol.protocol}] quote status: ${quoteRes.status}`);
    const body = await quoteRes.text();
    console.log(body);
    if (quoteRes.ok) {
      successCount += 1;
    }
  }

  if (successCount === 0) {
    throw new Error('No swap protocol returned a successful quote');
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
