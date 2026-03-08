import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { writeFile } from 'node:fs/promises';
import bs58 from 'bs58';
import { createAgenticWalletClient } from '../packages/sdk/src/index.js';

type ProtocolResult = {
  protocol: string;
  capabilities: string;
  health: string;
  interaction: string;
  txId: string;
  txHash: string;
  note: string;
};

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';
const tenantId = process.env.TENANT_ID;
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const privateKeyInput = process.env.PRIVATE_KEY;

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SPL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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
  throw new Error('Unsupported PRIVATE_KEY format');
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clusterFromRpc = (url: string): 'devnet' | 'testnet' | 'mainnet-beta' | 'custom' => {
  const normalized = url.toLowerCase();
  if (normalized.includes('devnet')) return 'devnet';
  if (normalized.includes('testnet')) return 'testnet';
  if (normalized.includes('mainnet')) return 'mainnet-beta';
  return 'custom';
};

const explorerTxUrl = (signature: string): string => {
  const cluster = clusterFromRpc(rpcUrl);
  if (cluster === 'mainnet-beta') return `https://explorer.solana.com/tx/${signature}`;
  if (cluster === 'custom') return `https://explorer.solana.com/tx/${signature}?cluster=custom`;
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
};

const asError = (value: unknown): string => (value instanceof Error ? value.message : String(value));

const requestHeaders = (): HeadersInit => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
});

const gateway = async (pathName: string): Promise<{ status: number; ok: boolean; json: any }> => {
  const res = await fetch(`${apiBase}${pathName}`, { headers: requestHeaders() });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
};

const pollTx = async (
  client: ReturnType<typeof createAgenticWalletClient>,
  txId: string,
  timeoutMs = 120000,
): Promise<Record<string, unknown>> => {
  const started = Date.now();
  let approvalAttempted = false;
  while (Date.now() - started < timeoutMs) {
    const tx = await client.transaction.get(txId);
    const status = String(tx.status ?? '');
    if (status === 'confirmed' || status === 'failed') return tx;
    if (status === 'approval_gate' && !approvalAttempted) {
      await client.transaction.approve(txId);
      approvalAttempted = true;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for tx ${txId}`);
};

const submitAndAwait = async (
  client: ReturnType<typeof createAgenticWalletClient>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const created = await client.transaction.create(input as never);
  const id = String(created.id ?? '');
  if (!id) throw new Error('create returned no tx id');
  const status = String(created.status ?? '');
  if (status === 'confirmed' || status === 'failed') return created;
  if (status === 'approval_gate') {
    await client.transaction.approve(id);
  }
  return pollTx(client, id);
};

async function main() {
  if (!privateKeyInput) throw new Error('PRIVATE_KEY missing');
  const payer = parseKeypair(privateKeyInput);
  const connection = new Connection(rpcUrl, 'confirmed');
  const client = createAgenticWalletClient(apiBase, {
    apiKey,
    ...(tenantId ? { tenantId } : {}),
  });

  const wallet = await client.wallet.create({ label: `protocol-exec-${Date.now()}` });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(wallet.publicKey),
        lamports: 120_000_000,
      }),
    ),
    [payer],
  );

  const recipient = await client.wallet.create({ label: `protocol-recipient-${Date.now()}` });

  const splMint = await createMint(connection, payer, payer.publicKey, null, 6);
  const ownerAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    splMint,
    new PublicKey(wallet.publicKey),
  );
  await mintTo(connection, payer, splMint, ownerAta.address, payer, 1_500_000n);

  const metaplexMint = await createMint(
    connection,
    payer,
    new PublicKey(wallet.publicKey),
    null,
    6,
  );

  const listRes = await gateway('/api/v1/protocols');
  const protocols = Array.isArray(listRes.json?.data) ? listRes.json.data as Array<{ protocol: string; capabilities: string[] }> : [];

  const rows: ProtocolResult[] = [];

  for (const entry of protocols) {
    const cap = await gateway(`/api/v1/protocols/${entry.protocol}/capabilities`);
    const health = await gateway(`/api/v1/protocols/${entry.protocol}/health`);

    let interaction = 'FAIL';
    let txId = 'N/A';
    let txHash = 'N/A';
    let note = '';

    try {
      let tx: Record<string, unknown> | null = null;

      if (entry.protocol === 'system-program') {
        tx = await submitAndAwait(client, {
          walletId: wallet.id,
          type: 'transfer_sol',
          protocol: 'system-program',
          gasless: false,
          intent: { destination: recipient.publicKey, lamports: 1_000_000 },
        });
      } else if (entry.protocol === 'spl-token') {
        tx = await submitAndAwait(client, {
          walletId: wallet.id,
          type: 'transfer_spl',
          protocol: 'spl-token',
          gasless: false,
          intent: { destination: recipient.publicKey, mint: splMint.toBase58(), amount: 50000 },
        });
      } else if (entry.protocol === 'jupiter' || entry.protocol === 'orca' || entry.protocol === 'raydium') {
        tx = await submitAndAwait(client, {
          walletId: wallet.id,
          type: 'swap',
          protocol: entry.protocol,
          gasless: false,
          intent: {
            inputMint: SOL_MINT,
            outputMint: SPL_USDC_MINT,
            amount: '1000000',
            slippageBps: 50,
          },
        });
      } else if (entry.protocol === 'marinade') {
        tx = await submitAndAwait(client, {
          walletId: wallet.id,
          type: 'stake',
          protocol: 'marinade',
          gasless: false,
          intent: { amount: '1000000' },
        });
      } else if (entry.protocol === 'solend') {
        tx = await submitAndAwait(client, {
          walletId: wallet.id,
          type: 'lend_supply',
          protocol: 'solend',
          gasless: false,
          intent: { mint: SOL_MINT, amount: '1000000' },
        });
      } else if (entry.protocol === 'metaplex') {
        tx = await submitAndAwait(client, {
          walletId: wallet.id,
          type: 'create_mint',
          protocol: 'metaplex',
          gasless: false,
          intent: {
            mintAddress: metaplexMint.toBase58(),
            name: 'Agentic Judge Demo',
            symbol: 'AJD',
            uri: 'https://example.com/meta.json',
            sellerFeeBasisPoints: 0,
          },
        });
      } else if (entry.protocol === 'escrow') {
        tx = await submitAndAwait(client, {
          walletId: wallet.id,
          type: 'create_escrow',
          protocol: 'escrow',
          gasless: false,
          intent: {
            counterparty: recipient.publicKey,
            amount: 700000,
            feeBasisPoints: 100,
            deadlineUnixSec: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
          },
        });
      }

      if (!tx) {
        interaction = 'FAIL';
        note = 'No execute route implemented in sweep';
      } else {
        txId = String(tx.id ?? 'N/A');
        const status = String(tx.status ?? 'unknown');
        const signature = String(tx.signature ?? '');

        if (status === 'confirmed' && signature.length > 0) {
          interaction = 'PASS';
          txHash = signature;
          note = 'status=confirmed';
        } else {
          const err = String(tx.error ?? tx.note ?? `status=${status}`);
          interaction = 'FAIL';
          note = `execution failed: ${err}`;
        }
      }
    } catch (error) {
      const msg = asError(error);
      interaction = 'FAIL';
      note = msg;
    }

    rows.push({
      protocol: entry.protocol,
      capabilities: cap.ok ? 'PASS' : 'FAIL',
      health: health.status === 200 || health.status === 503 ? 'PASS' : 'FAIL',
      interaction,
      txId,
      txHash,
      note,
    });
  }

  console.log('\nProtocol Execution Sweep Results:\n');
  for (const row of rows) {
    console.log(`${row.protocol} | cap=${row.capabilities} | health=${row.health} | interaction=${row.interaction} | txId=${row.txId} | txHash=${row.txHash}`);
    console.log(`  note: ${row.note}`);
    if (row.txHash !== 'N/A') {
      console.log(`  explorer: ${explorerTxUrl(row.txHash)}`);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    walletId: wallet.id,
    walletPublicKey: wallet.publicKey,
    recipientWallet: recipient.publicKey,
    splMint: splMint.toBase58(),
    metaplexMint: metaplexMint.toBase58(),
    rows,
  };

  await writeFile('/tmp/protocol_exec_sweep.json', JSON.stringify(payload, null, 2), 'utf8');
  console.log('\nSaved /tmp/protocol_exec_sweep.json');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
