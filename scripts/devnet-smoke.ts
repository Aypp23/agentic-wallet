import 'dotenv/config';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const privateKeyInput = process.env.PRIVATE_KEY;
const apiKey = process.env.API_KEY ?? 'dev-api-key';

const parseKeypair = (value: string): Keypair => {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
  }

  const base64Decoded = Buffer.from(trimmed, 'base64');
  if (base64Decoded.length === 64) {
    return Keypair.fromSecretKey(new Uint8Array(base64Decoded));
  }

  const base58Decoded = bs58.decode(trimmed);
  if (base58Decoded.length === 64) {
    return Keypair.fromSecretKey(base58Decoded);
  }

  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(Buffer.from(trimmed, 'utf8').toString()) as number[]));
};

const main = async () => {
  console.log('Running devnet smoke test...');

  const createWalletRes = await fetch(`${apiBase}/api/v1/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ label: 'smoke-wallet' }),
  });

  if (!createWalletRes.ok) {
    throw new Error(`Wallet creation failed: ${createWalletRes.status} ${await createWalletRes.text()}`);
  }

  const created = (await createWalletRes.json()) as { data: { id: string; publicKey: string } };
  console.log(`Created wallet ${created.data.id} -> ${created.data.publicKey}`);

  if (!privateKeyInput) {
    throw new Error('PRIVATE_KEY is required for devnet:smoke');
  }

  const payer = parseKeypair(privateKeyInput);
  const connection = new Connection(rpcUrl, 'confirmed');
  const dest = new PublicKey(created.data.publicKey);

  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: dest,
      lamports: 2_000_000,
    }),
  );

  const fundSig = await sendAndConfirmTransaction(connection, fundTx, [payer]);
  console.log(`Funded smoke wallet: ${fundSig}`);

  const transferRes = await fetch(`${apiBase}/api/v1/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      walletId: created.data.id,
      type: 'transfer_sol',
      protocol: 'system-program',
      gasless: false,
      intent: {
        destination: payer.publicKey.toBase58(),
        lamports: 1_000_000,
      },
    }),
  });

  const transferPayload = await transferRes.json();
  console.log('Smoke transfer response:', JSON.stringify(transferPayload, null, 2));

  const status = (transferPayload as { data?: { status?: string } }).data?.status;
  if (status !== 'confirmed') {
    throw new Error(`Smoke transfer did not confirm (status=${status ?? 'unknown'})`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
