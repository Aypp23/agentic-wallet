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

  throw new Error('Unsupported PRIVATE_KEY format; use JSON array, base64 64-byte key, or base58 64-byte key');
};

const createAgent = async (name: string) => {
  const res = await fetch(`${apiBase}/api/v1/agents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      name,
      allowedIntents: ['transfer_sol', 'query_balance'],
      executionMode: 'autonomous',
    }),
  });

  if (!res.ok) {
    throw new Error(`Agent create failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as { data: { id: string; walletId: string } };
};

const main = async () => {
  const [a1, a2] = await Promise.all([createAgent('agent-alpha'), createAgent('agent-beta')]);

  await Promise.all([
    fetch(`${apiBase}/api/v1/agents/${a1.data.id}/start`, { method: 'POST', headers: { 'x-api-key': apiKey } }),
    fetch(`${apiBase}/api/v1/agents/${a2.data.id}/start`, { method: 'POST', headers: { 'x-api-key': apiKey } }),
  ]);

  const [wallet1Res, wallet2Res] = await Promise.all([
    fetch(`${apiBase}/api/v1/wallets/${a1.data.walletId}`, { headers: { 'x-api-key': apiKey } }),
    fetch(`${apiBase}/api/v1/wallets/${a2.data.walletId}`, { headers: { 'x-api-key': apiKey } }),
  ]);

  const wallet1 = (await wallet1Res.json()) as { data: { publicKey: string } };
  const wallet2 = (await wallet2Res.json()) as { data: { publicKey: string } };

  if (!privateKeyInput) {
    throw new Error('PRIVATE_KEY is required for devnet:multi-agent');
  }

  const payer = parseKeypair(privateKeyInput);
  const connection = new Connection(rpcUrl, 'confirmed');

  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(wallet1.data.publicKey),
      lamports: 2_000_000,
    }),
  );

  await sendAndConfirmTransaction(connection, fundTx, [payer]);

  const executeRes = await fetch(`${apiBase}/api/v1/agents/${a1.data.id}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      type: 'transfer_sol',
      protocol: 'system-program',
      intent: {
        destination: wallet2.data.publicKey,
        lamports: 1_000_000,
      },
    }),
  });

  const executePayloadText = await executeRes.text();
  console.log('Multi-agent execute response:', executePayloadText);
  const executePayload = JSON.parse(executePayloadText) as { data?: { status?: string } };
  if (executePayload.data?.status !== 'confirmed') {
    throw new Error(`Multi-agent transfer not confirmed (status=${executePayload.data?.status ?? 'unknown'})`);
  }

  await Promise.all([
    fetch(`${apiBase}/api/v1/agents/${a1.data.id}/stop`, { method: 'POST', headers: { 'x-api-key': apiKey } }),
    fetch(`${apiBase}/api/v1/agents/${a2.data.id}/stop`, { method: 'POST', headers: { 'x-api-key': apiKey } }),
  ]);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
