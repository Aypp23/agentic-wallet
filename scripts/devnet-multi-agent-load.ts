import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { writeFile } from 'node:fs/promises';
import { createAgenticWalletClient } from '../packages/sdk/src/index.js';

interface AgentRef {
  id: string;
  walletId: string;
  publicKey: string;
}

interface ExecutionResult {
  agentId: string;
  txId: string;
  status: string;
  signature: string;
  explorerUrl: string;
  destination: string;
}

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';
const tenantId = process.env.TENANT_ID;
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const privateKeyInput = process.env.PRIVATE_KEY;

const loadCount = Math.max(10, Math.min(20, Number(process.env.AGENT_LOAD_COUNT ?? 10)));
const transferLamports = Math.max(200_000, Number(process.env.AGENT_LOAD_TRANSFER_LAMPORTS ?? 600_000));
const fundLamports = Math.max(
  transferLamports + 600_000,
  Number(process.env.AGENT_LOAD_FUND_LAMPORTS ?? transferLamports + 900_000),
);
const pollTimeoutMs = Math.max(20_000, Number(process.env.AGENT_LOAD_POLL_TIMEOUT_MS ?? 90_000));
const pollIntervalMs = Math.max(500, Number(process.env.AGENT_LOAD_POLL_INTERVAL_MS ?? 2_000));
const outputFile = process.env.AGENT_LOAD_OUTPUT_FILE ?? '/tmp/multi_agent_load_run.json';

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const clusterFromRpc = (url: string): 'devnet' | 'testnet' | 'mainnet-beta' | 'custom' => {
  const lower = url.toLowerCase();
  if (lower.includes('devnet')) return 'devnet';
  if (lower.includes('testnet')) return 'testnet';
  if (lower.includes('mainnet')) return 'mainnet-beta';
  return 'custom';
};

const explorerTxUrl = (signature: string): string => {
  const cluster = clusterFromRpc(rpcUrl);
  if (cluster === 'mainnet-beta') {
    return `https://explorer.solana.com/tx/${signature}`;
  }
  if (cluster === 'custom') {
    return `https://explorer.solana.com/tx/${signature}?cluster=custom`;
  }
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
};

const pollTxFinal = async (
  client: ReturnType<typeof createAgenticWalletClient>,
  txId: string,
): Promise<Record<string, unknown>> => {
  const start = Date.now();
  while (Date.now() - start < pollTimeoutMs) {
    const tx = await client.transaction.get(txId);
    const status = String(tx.status ?? '');
    if (status === 'confirmed' || status === 'failed') {
      return tx;
    }
    if (status === 'approval_gate') {
      await client.transaction.approve(txId);
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for tx ${txId}`);
};

const main = async (): Promise<void> => {
  if (!privateKeyInput) {
    throw new Error('PRIVATE_KEY is required for devnet:multi-agent:load');
  }

  const client = createAgenticWalletClient(apiBase, {
    apiKey,
    ...(tenantId ? { tenantId } : {}),
  });
  const payer = parseKeypair(privateKeyInput);
  const connection = new Connection(rpcUrl, 'confirmed');
  const runStarted = Date.now();

  const agents: AgentRef[] = [];
  const executionResults: ExecutionResult[] = [];
  const fundingSignatures: string[] = [];

  console.log(`Creating ${loadCount} agents...`);
  for (let i = 0; i < loadCount; i += 1) {
    const created = await client.agent.create({
      name: `load-agent-${Date.now()}-${i + 1}`,
      executionMode: 'autonomous',
      allowedIntents: ['transfer_sol', 'query_balance'],
    });
    const wallet = await client.wallet.get(created.walletId);
    agents.push({
      id: created.id,
      walletId: created.walletId,
      publicKey: wallet.publicKey,
    });
  }

  console.log(`Starting ${agents.length} agents...`);
  for (const agent of agents) {
    await client.agent.start(agent.id);
  }

  console.log(`Funding ${agents.length} wallets with ${fundLamports} lamports each...`);
  for (const agent of agents) {
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(agent.publicKey),
        lamports: fundLamports,
      }),
    );
    const signature = await sendAndConfirmTransaction(connection, fundTx, [payer]);
    fundingSignatures.push(signature);
  }

  console.log(`Executing ${agents.length} agent transfers...`);
  for (let i = 0; i < agents.length; i += 1) {
    const actor = agents[i];
    const target = agents[(i + 1) % agents.length];
    if (!actor || !target) {
      throw new Error('Agent index resolution failed');
    }

    const created = await client.agent.execute(actor.id, {
      type: 'transfer_sol',
      protocol: 'system-program',
      intent: {
        destination: target.publicKey,
        lamports: transferLamports,
      },
    });
    const txId = String(created.id ?? '');
    if (!txId) {
      throw new Error(`agent.execute returned no tx id for agent ${actor.id}`);
    }

    const final = await pollTxFinal(client, txId);
    const status = String(final.status ?? 'unknown');
    const signature = String(final.signature ?? '');
    executionResults.push({
      agentId: actor.id,
      txId,
      status,
      signature,
      explorerUrl: signature ? explorerTxUrl(signature) : '',
      destination: target.publicKey,
    });
  }

  console.log('Stopping agents...');
  for (const agent of agents) {
    await client.agent.stop(agent.id);
  }

  const confirmed = executionResults.filter((entry) => entry.status === 'confirmed').length;
  const failed = executionResults.length - confirmed;
  const runMs = Date.now() - runStarted;

  const payload = {
    generatedAt: new Date().toISOString(),
    apiBase,
    rpcUrl,
    loadCount: agents.length,
    transferLamports,
    fundLamports,
    runMs,
    confirmed,
    failed,
    successRate: executionResults.length > 0 ? Number((confirmed / executionResults.length).toFixed(4)) : 0,
    agents,
    fundingSignatures,
    executionResults,
  };

  await writeFile(outputFile, JSON.stringify(payload, null, 2), 'utf8');

  console.log('');
  console.log('Multi-agent load run summary');
  console.log(`- agents: ${agents.length}`);
  console.log(`- confirmed executions: ${confirmed}`);
  console.log(`- failed executions: ${failed}`);
  console.log(`- success rate: ${payload.successRate}`);
  console.log(`- durationMs: ${runMs}`);
  console.log(`- output: ${outputFile}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

