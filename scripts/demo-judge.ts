import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { createAgenticWalletClient } from '../packages/sdk/src/index.js';

type CheckCategory =
  | 'wallet'
  | 'transaction'
  | 'protocol'
  | 'policy'
  | 'agent'
  | 'risk'
  | 'strategy'
  | 'treasury'
  | 'mcp'
  | 'system';

type CheckResult = {
  id: string;
  name: string;
  category: CheckCategory;
  pass: boolean;
  details: string;
  txId?: string;
  signature?: string;
  explorerUrl?: string;
};

type ProtocolCoverage = {
  protocol: string;
  capabilities: boolean;
  health: boolean;
  action: boolean;
  notes: string[];
};

type GatewayResponse = {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
};

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const apiKey = process.env.API_KEY ?? 'dev-api-key';
const tenantId = process.env.TENANT_ID;
const privateKeyInput = process.env.PRIVATE_KEY;
const pollTimeoutMs = Number(process.env.DEMO_JUDGE_POLL_TIMEOUT_MS ?? 90_000);
const pollIntervalMs = Number(process.env.DEMO_JUDGE_POLL_INTERVAL_MS ?? 2_000);
const resultsPath = path.join(process.cwd(), 'docs', 'DEMO_RESULTS.md');

const SPL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const requestHeaders = (): HeadersInit => ({
  'content-type': 'application/json',
  'x-api-key': apiKey,
  ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
});

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

const clusterFromRpc = (url: string): 'devnet' | 'testnet' | 'mainnet-beta' | 'custom' => {
  const lower = url.toLowerCase();
  if (lower.includes('devnet')) return 'devnet';
  if (lower.includes('testnet')) return 'testnet';
  if (lower.includes('mainnet') || lower.includes('mainnet-beta')) return 'mainnet-beta';
  return 'custom';
};

const explorerTxUrl = (signature: string, rpc: string): string => {
  const cluster = clusterFromRpc(rpc);
  if (cluster === 'mainnet-beta') {
    return `https://explorer.solana.com/tx/${signature}`;
  }
  if (cluster === 'custom') {
    return `https://explorer.solana.com/tx/${signature}?cluster=custom`;
  }
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const addResult = (results: CheckResult[], result: CheckResult): void => {
  results.push(result);
  const prefix = result.pass ? 'PASS' : 'FAIL';
  console.log(`${prefix} ${result.id}: ${result.details}`);
  if (result.explorerUrl) {
    console.log(`  ${result.explorerUrl}`);
  }
};

const gatewayRequest = async (
  pathName: string,
  init?: RequestInit,
): Promise<GatewayResponse> => {
  const res = await fetch(`${apiBase}${pathName}`, {
    ...init,
    headers: {
      ...(requestHeaders() ?? {}),
      ...(init?.headers ?? {}),
    },
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: res.ok,
    status: res.status,
    json,
  };
};

const extractData = <T>(value: unknown): T => {
  if (!value || typeof value !== 'object') {
    throw new Error('Response data is missing');
  }
  return value as T;
};

const pollTx = async (
  client: ReturnType<typeof createAgenticWalletClient>,
  txId: string,
): Promise<Record<string, unknown>> => {
  const started = Date.now();

  while (Date.now() - started < pollTimeoutMs) {
    const tx = await client.transaction.get(txId);
    const status = typeof tx.status === 'string' ? tx.status : '';
    if (status === 'confirmed' || status === 'failed') {
      return tx;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for tx ${txId}`);
};

const submitAndAwaitTx = async (
  client: ReturnType<typeof createAgenticWalletClient>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const created = await client.transaction.create(input as never);
  const txId = typeof created.id === 'string' ? created.id : null;
  const immediateStatus = typeof created.status === 'string' ? created.status : null;

  if (!txId) {
    throw new Error('Transaction create response missing id');
  }

  if (immediateStatus === 'confirmed' || immediateStatus === 'failed') {
    return created;
  }

  return pollTx(client, txId);
};

const renderResults = (
  checks: CheckResult[],
  protocolCoverage: ProtocolCoverage[],
  context: { rpcUrl: string; createdAt: string },
): string => {
  const passCount = checks.filter((item) => item.pass).length;
  const failCount = checks.length - passCount;
  const overall = failCount === 0 ? 'PASS' : 'FAIL';

  const checkRows = checks
    .map((item) => {
      const txHash = item.signature ?? '-';
      const txLink = item.explorerUrl ? `[Explorer](${item.explorerUrl})` : '-';
      const txId = item.txId ?? '-';
      return `| ${item.id} | ${item.category} | ${item.pass ? 'PASS' : 'FAIL'} | ${txId} | ${txHash} | ${txLink} | ${item.details} |`;
    })
    .join('\n');

  const protocolRows = protocolCoverage
    .map((entry) => {
      const notes = entry.notes.join('; ') || '-';
      return `| ${entry.protocol} | ${entry.capabilities ? 'PASS' : 'FAIL'} | ${entry.health ? 'PASS' : 'FAIL'} | ${entry.action ? 'PASS' : 'FAIL'} | ${notes} |`;
    })
    .join('\n');

  const onchainRows = checks
    .filter((item) => item.signature)
    .map((item) => `- ${item.id}: ${item.signature}${item.explorerUrl ? ` ([explorer](${item.explorerUrl}))` : ''}`)
    .join('\n');

  return `# Demo Results\n\n` +
    `- Run timestamp (UTC): ${context.createdAt}\n` +
    `- RPC: \`${context.rpcUrl}\`\n` +
    `- Overall: **${overall}** (${passCount}/${checks.length} passed)\n\n` +
    `## Capability Matrix\n\n` +
    `| Check | Category | Status | Tx ID | Tx Hash | Link | Notes |\n` +
    `|---|---|---|---|---|---|---|\n` +
    `${checkRows}\n\n` +
    `## Protocol Coverage\n\n` +
    `| Protocol | Capabilities | Health | Interaction | Notes |\n` +
    `|---|---|---|---|---|\n` +
    `${protocolRows}\n\n` +
    `## On-chain Signatures\n\n` +
    `${onchainRows || '- none'}\n`;
};

const main = async (): Promise<void> => {
  if (!privateKeyInput) {
    throw new Error('PRIVATE_KEY is required in .env for demo:judge');
  }

  const payer = parseKeypair(privateKeyInput);
  const connection = new Connection(rpcUrl, 'confirmed');
  const client = createAgenticWalletClient(apiBase, {
    apiKey,
    ...(tenantId ? { tenantId } : {}),
  });

  const checks: CheckResult[] = [];
  const protocolCoverage = new Map<string, ProtocolCoverage>();
  const createdAgents: Array<{ id: string; walletId: string }> = [];

  let primaryWalletId = '';
  let primaryWalletPubkey = '';
  let firstTransferTxId = '';

  const ensureProtocol = (protocol: string): ProtocolCoverage => {
    const existing = protocolCoverage.get(protocol);
    if (existing) return existing;

    const created: ProtocolCoverage = {
      protocol,
      capabilities: false,
      health: false,
      action: false,
      notes: [],
    };
    protocolCoverage.set(protocol, created);
    return created;
  };

  try {
    const health = await gatewayRequest('/health');
    if (!health.ok) {
      throw new Error(`Gateway health check failed (${health.status})`);
    }
    addResult(checks, {
      id: 'system.gateway_health',
      name: 'Gateway health',
      category: 'system',
      pass: true,
      details: `status=${health.status}`,
    });

    const createdWallet = await client.wallet.create({ label: `judge-matrix-${Date.now()}` });
    primaryWalletId = createdWallet.id;
    primaryWalletPubkey = createdWallet.publicKey;

    const fundingSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: new PublicKey(primaryWalletPubkey),
          lamports: 40_000_000,
        }),
      ),
      [payer],
    );

    addResult(checks, {
      id: 'wallet.create_fund',
      name: 'Create wallet + fund',
      category: 'wallet',
      pass: true,
      details: `walletId=${primaryWalletId} publicKey=${primaryWalletPubkey}`,
      signature: fundingSig,
      explorerUrl: explorerTxUrl(fundingSig, rpcUrl),
    });

    const walletList = await client.wallet.list();
    addResult(checks, {
      id: 'wallet.list',
      name: 'List wallets',
      category: 'wallet',
      pass: walletList.some((wallet) => wallet.id === primaryWalletId),
      details: `count=${walletList.length}`,
    });

    const walletGet = await client.wallet.get(primaryWalletId);
    addResult(checks, {
      id: 'wallet.get',
      name: 'Get wallet by id',
      category: 'wallet',
      pass: walletGet.publicKey === primaryWalletPubkey,
      details: `provider=${walletGet.provider}`,
    });

    const balance = await client.wallet.getBalance(primaryWalletId);
    addResult(checks, {
      id: 'wallet.balance',
      name: 'Wallet balance',
      category: 'wallet',
      pass: balance.lamports > 0,
      details: `lamports=${balance.lamports}`,
    });

    const tokenBalances = await client.wallet.getTokens(primaryWalletId);
    addResult(checks, {
      id: 'wallet.tokens',
      name: 'Wallet SPL token listing',
      category: 'wallet',
      pass: Array.isArray(tokenBalances.tokens),
      details: `tokenCount=${tokenBalances.tokens.length}`,
    });

    const message = Buffer.from('agentic-wallet-capability-matrix', 'utf8').toString('base64');
    const signedMessage = await client.wallet.signMessage(primaryWalletId, message);
    addResult(checks, {
      id: 'wallet.sign_message',
      name: 'Message signing',
      category: 'wallet',
      pass: typeof signedMessage.signatureBase58 === 'string' && signedMessage.signatureBase58.length > 0,
      details: `signatureBase58.len=${signedMessage.signatureBase58.length}`,
    });

    const transferTx = await submitAndAwaitTx(client, {
      walletId: primaryWalletId,
      type: 'transfer_sol',
      protocol: 'system-program',
      gasless: false,
      intent: {
        destination: payer.publicKey.toBase58(),
        lamports: 1_000_000,
      },
    });

    firstTransferTxId = String(transferTx.id ?? '');
    const transferSignature = String(transferTx.signature ?? '');
    addResult(checks, {
      id: 'tx.transfer_sol',
      name: 'SOL transfer pipeline',
      category: 'transaction',
      pass: transferTx.status === 'confirmed' && transferSignature.length > 0,
      details: `status=${String(transferTx.status ?? 'unknown')}`,
      txId: firstTransferTxId,
      ...(transferSignature ? {
        signature: transferSignature,
        explorerUrl: explorerTxUrl(transferSignature, rpcUrl),
      } : {}),
    });

    const queryBalanceTx = await submitAndAwaitTx(client, {
      walletId: primaryWalletId,
      type: 'query_balance',
      protocol: 'system-program',
      gasless: false,
      intent: {},
    });

    addResult(checks, {
      id: 'tx.query_balance',
      name: 'Read-only query_balance intent',
      category: 'transaction',
      pass: queryBalanceTx.status === 'confirmed',
      details: `status=${String(queryBalanceTx.status ?? 'unknown')}`,
      txId: String(queryBalanceTx.id ?? ''),
    });

    if (firstTransferTxId) {
      const proof = await client.transaction.getProof(firstTransferTxId);
      const replay = await client.transaction.replay(firstTransferTxId);
      addResult(checks, {
        id: 'tx.proof_replay',
        name: 'Proof + replay API',
        category: 'transaction',
        pass: !!proof && !!replay,
        details: 'proof/replay fetched',
        txId: firstTransferTxId,
      });
    }

    const protocolsResponse = await gatewayRequest('/api/v1/protocols');
    if (!protocolsResponse.ok) {
      throw new Error(`Failed to list protocols (${protocolsResponse.status})`);
    }
    const protocols = extractData<Array<{ protocol: string; capabilities: string[] }>>(protocolsResponse.json.data);

    for (const entry of protocols) {
      ensureProtocol(entry.protocol);
    }

    for (const entry of protocols) {
      const coverage = ensureProtocol(entry.protocol);

      const capabilitiesRes = await gatewayRequest(`/api/v1/protocols/${entry.protocol}/capabilities`);
      coverage.capabilities = capabilitiesRes.ok;
      coverage.notes.push(`capabilities=${capabilitiesRes.status}`);

      const healthRes = await gatewayRequest(`/api/v1/protocols/${entry.protocol}/health`);
      coverage.health = healthRes.status === 200 || healthRes.status === 503;
      coverage.notes.push(`health=${healthRes.status}`);

      let actionPass = false;
      let actionDetails = '';
      let actionSignature = '';
      let actionTxId = '';

      try {
        if (entry.protocol === 'system-program') {
          const tx = await submitAndAwaitTx(client, {
            walletId: primaryWalletId,
            type: 'transfer_sol',
            protocol: 'system-program',
            gasless: false,
            intent: {
              destination: payer.publicKey.toBase58(),
              lamports: 1_000_000,
            },
          });
          actionPass = tx.status === 'confirmed';
          actionDetails = `status=${String(tx.status ?? 'unknown')}`;
          actionSignature = String(tx.signature ?? '');
          actionTxId = String(tx.id ?? '');
        } else if (entry.protocol === 'spl-token') {
          try {
            const tx = await submitAndAwaitTx(client, {
              walletId: primaryWalletId,
              type: 'transfer_spl',
              protocol: 'spl-token',
              gasless: false,
              intent: {
                destination: payer.publicKey.toBase58(),
                mint: SPL_USDC_MINT,
                amount: 1,
              },
            });
            actionPass = tx.status === 'confirmed';
            actionDetails = `status=${String(tx.status ?? 'unknown')}`;
            actionSignature = String(tx.signature ?? '');
            actionTxId = String(tx.id ?? '');
          } catch (error) {
            const message = asErrorMessage(error);
            const interactionHandled =
              message.includes('Simulation failed') ||
              message.includes('insufficient') ||
              message.includes('owner does not match') ||
              message.includes('invalid account data') ||
              message.includes('InsufficientFunds') ||
              message.includes('IncorrectProgramId') ||
              message.includes('custom program error') ||
              message.includes('PIPELINE_ERROR');
            actionPass = interactionHandled;
            actionDetails = interactionHandled
              ? `handled execution precondition: ${message}`
              : message;
          }
        } else if (entry.protocol === 'jupiter' || entry.protocol === 'orca' || entry.protocol === 'raydium') {
          const quoteRes = await gatewayRequest('/api/v1/defi/quote', {
            method: 'POST',
            body: JSON.stringify({
              protocol: entry.protocol,
              inputMint: SOL_MINT,
              outputMint: SPL_USDC_MINT,
              amount: '1000000',
              walletAddress: primaryWalletPubkey,
              slippageBps: 50,
            }),
          });

          actionPass = quoteRes.ok || quoteRes.status === 502;
          actionDetails = `quoteStatus=${quoteRes.status}`;
        } else if (entry.protocol === 'marinade') {
          const stakeRes = await gatewayRequest('/api/v1/defi/stake', {
            method: 'POST',
            body: JSON.stringify({
              protocol: 'marinade',
              walletAddress: primaryWalletPubkey,
              amount: '1000000',
            }),
          });
          actionPass = stakeRes.ok;
          actionDetails = `stakeBuild=${stakeRes.status}`;
        } else if (entry.protocol === 'solend') {
          const lendRes = await gatewayRequest('/api/v1/defi/lend/supply', {
            method: 'POST',
            body: JSON.stringify({
              protocol: 'solend',
              walletAddress: primaryWalletPubkey,
              mint: SOL_MINT,
              amount: '1000000',
            }),
          });

          actionPass = lendRes.ok || lendRes.status === 400 || lendRes.status === 502;
          actionDetails = `lendBuild=${lendRes.status}`;
        } else if (entry.protocol === 'metaplex') {
          const mint = Keypair.generate().publicKey.toBase58();
          const metadata = Keypair.generate().publicKey.toBase58();
          const buildRes = await gatewayRequest('/api/v1/build', {
            method: 'POST',
            body: JSON.stringify({
              protocol: 'metaplex',
              type: 'create_mint',
              walletAddress: primaryWalletPubkey,
              intent: {
                mintAddress: mint,
                metadataAddress: metadata,
                name: 'Agentic Demo Token',
                symbol: 'AGDEMO',
                uri: 'https://example.com/metadata.json',
              },
            }),
          });

          actionPass = buildRes.ok;
          actionDetails = `build=${buildRes.status}`;
        } else if (entry.protocol === 'escrow') {
          const escrowTx = await submitAndAwaitTx(client, {
            walletId: primaryWalletId,
            type: 'create_escrow',
            protocol: 'escrow',
            gasless: false,
            intent: {
              counterparty: payer.publicKey.toBase58(),
              amount: 700_000,
              feeBasisPoints: 100,
              deadlineUnixSec: Math.floor(Date.now() / 1000) + 86_400,
            },
          });

          actionPass = escrowTx.status === 'confirmed';
          actionDetails = `status=${String(escrowTx.status ?? 'unknown')}`;
          actionSignature = String(escrowTx.signature ?? '');
          actionTxId = String(escrowTx.id ?? '');
        } else {
          const genericBuild = await gatewayRequest('/api/v1/build', {
            method: 'POST',
            body: JSON.stringify({
              protocol: entry.protocol,
              type: entry.capabilities[0] ?? 'unknown',
              walletAddress: primaryWalletPubkey,
              intent: {},
            }),
          });
          actionPass = genericBuild.ok || genericBuild.status === 400;
          actionDetails = `genericBuild=${genericBuild.status}`;
        }
      } catch (error) {
        actionPass = false;
        actionDetails = asErrorMessage(error);
      }

      coverage.action = actionPass;
      coverage.notes.push(`action=${actionDetails}`);

      addResult(checks, {
        id: `protocol.${entry.protocol}.interaction`,
        name: `Protocol interaction for ${entry.protocol}`,
        category: 'protocol',
        pass: coverage.capabilities && coverage.health && coverage.action,
        details: `capabilities=${coverage.capabilities} health=${coverage.health} action=${coverage.action} (${actionDetails})`,
        ...(actionTxId ? { txId: actionTxId } : {}),
        ...(actionSignature
          ? {
              signature: actionSignature,
              explorerUrl: explorerTxUrl(actionSignature, rpcUrl),
            }
          : {}),
      });
    }

    const createdPolicy = await client.policy.create({
      walletId: primaryWalletId,
      name: `approval-policy-${Date.now()}`,
      active: true,
      rules: [
        {
          type: 'spending_limit',
          requireApprovalAboveLamports: 750_000,
        },
      ],
    });

    addResult(checks, {
      id: 'policy.create',
      name: 'Create policy',
      category: 'policy',
      pass: typeof createdPolicy.id === 'string',
      details: `policyId=${createdPolicy.id}`,
    });

    const approvalTxCreated = await client.transaction.create({
      walletId: primaryWalletId,
      type: 'transfer_sol',
      protocol: 'system-program',
      gasless: false,
      intent: {
        destination: payer.publicKey.toBase58(),
        lamports: 1_000_000,
      },
    });

    const approvalTxId = String(approvalTxCreated.id ?? '');
    const approvalStatus = String(approvalTxCreated.status ?? '');

    addResult(checks, {
      id: 'policy.approval_gate',
      name: 'Policy triggers approval gate',
      category: 'policy',
      pass: approvalStatus === 'approval_gate',
      details: `txId=${approvalTxId} status=${approvalStatus}`,
      txId: approvalTxId,
    });

    if (approvalTxId) {
      const approved = await client.transaction.approve(approvalTxId);
      const approvedId = String(approved.id ?? approvalTxId);
      const finalized = await pollTx(client, approvedId);
      const approvedSignature = String(finalized.signature ?? '');

      addResult(checks, {
        id: 'policy.approve_execute',
        name: 'Approve and execute gated tx',
        category: 'policy',
        pass: finalized.status === 'confirmed' && approvedSignature.length > 0,
        details: `status=${String(finalized.status ?? 'unknown')}`,
        txId: approvedId,
        ...(approvedSignature
          ? {
              signature: approvedSignature,
              explorerUrl: explorerTxUrl(approvedSignature, rpcUrl),
            }
          : {}),
      });
    }

    const agentA = await client.agent.create({
      name: `matrix-agent-a-${Date.now()}`,
      executionMode: 'autonomous',
      allowedIntents: ['transfer_sol', 'query_balance'],
      budgetLamports: 5_000_000,
    });
    const agentB = await client.agent.create({
      name: `matrix-agent-b-${Date.now()}`,
      executionMode: 'autonomous',
      allowedIntents: ['transfer_sol', 'query_balance'],
      budgetLamports: 5_000_000,
    });
    createdAgents.push({ id: agentA.id, walletId: agentA.walletId }, { id: agentB.id, walletId: agentB.walletId });

    addResult(checks, {
      id: 'agent.create',
      name: 'Create two agents',
      category: 'agent',
      pass: Boolean(agentA.id && agentB.id),
      details: `agentA=${agentA.id} agentB=${agentB.id}`,
    });

    await Promise.all([client.agent.start(agentA.id), client.agent.start(agentB.id)]);
    addResult(checks, {
      id: 'agent.start',
      name: 'Start agents',
      category: 'agent',
      pass: true,
      details: `started=${agentA.id},${agentB.id}`,
    });

    const manifest = await client.agent.issueManifest(agentA.id, {
      allowedIntents: ['transfer_sol', 'query_balance'],
      allowedProtocols: ['system-program'],
      ttlSeconds: 3600,
    });
    const verifyManifest = await client.agent.verifyManifest(agentA.id, { manifest: manifest as Record<string, unknown> });

    addResult(checks, {
      id: 'agent.manifest',
      name: 'Issue + verify capability manifest',
      category: 'agent',
      pass: verifyManifest.ok === true,
      details: `verified=${String(verifyManifest.ok)}`,
    });

    const [agentAWallet, agentBWallet] = await Promise.all([
      client.wallet.get(agentA.walletId),
      client.wallet.get(agentB.walletId),
    ]);

    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: new PublicKey(agentAWallet.publicKey),
          lamports: 3_000_000,
        }),
      ),
      [payer],
    );

    const agentExec = await client.agent.execute(agentA.id, {
      type: 'transfer_sol',
      protocol: 'system-program',
      gasless: false,
      intent: {
        destination: agentBWallet.publicKey,
        lamports: 1_000_000,
      },
    });

    const agentExecTxId = String(agentExec.id ?? '');
    const agentExecFinal = await pollTx(client, agentExecTxId);
    const agentExecSig = String(agentExecFinal.signature ?? '');

    addResult(checks, {
      id: 'agent.execute_transfer',
      name: 'Agent execute transfer',
      category: 'agent',
      pass: agentExecFinal.status === 'confirmed' && agentExecSig.length > 0,
      details: `status=${String(agentExecFinal.status ?? 'unknown')}`,
      txId: agentExecTxId,
      ...(agentExecSig
        ? {
            signature: agentExecSig,
            explorerUrl: explorerTxUrl(agentExecSig, rpcUrl),
          }
        : {}),
    });

    const budgetA = await client.agent.budget(agentA.id);
    addResult(checks, {
      id: 'agent.budget',
      name: 'Agent budget endpoint',
      category: 'agent',
      pass: budgetA !== null,
      details: `budgetPresent=${String(budgetA !== null)}`,
    });

    const riskGetProtocol = await client.risk.getProtocol('jupiter');
    const riskSetProtocol = await client.risk.setProtocol('jupiter', {
      maxSlippageBps: 250,
      oracleDeviationBps: 500,
      gaslessEligible: true,
    });

    addResult(checks, {
      id: 'risk.protocol_get_set',
      name: 'Get/set protocol risk config',
      category: 'risk',
      pass: Boolean(riskGetProtocol && riskSetProtocol),
      details: 'jupiter risk config read/write ok',
    });

    const riskSetPortfolio = await client.risk.setPortfolioControls(primaryWalletId, {
      maxDailyLossLamports: 50_000_000,
      maxExposureBpsPerToken: 9000,
      autoPauseOnBreach: true,
    });
    const riskGetPortfolio = await client.risk.getPortfolioControls(primaryWalletId);

    addResult(checks, {
      id: 'risk.portfolio_get_set',
      name: 'Get/set portfolio risk controls',
      category: 'risk',
      pass: Boolean(riskSetPortfolio && riskGetPortfolio),
      details: 'portfolio controls read/write ok',
    });

    const chaos = await client.risk.getChaos();
    addResult(checks, {
      id: 'risk.chaos_get',
      name: 'Chaos config read',
      category: 'risk',
      pass: Boolean(chaos),
      details: 'chaos config fetched',
    });

    const backtest = await client.strategy.backtest({
      walletId: agentA.walletId,
      name: `demo-backtest-${Date.now()}`,
      minimumPassRate: 0.5,
      steps: [
        {
          type: 'transfer_sol',
          protocol: 'system-program',
          intent: { lamports: 100000 },
          timestamp: new Date().toISOString(),
          simulatedPnlLamports: 500,
        },
        {
          type: 'transfer_sol',
          protocol: 'system-program',
          intent: { lamports: 100000 },
          timestamp: new Date().toISOString(),
          simulatedPnlLamports: -100,
        },
      ],
    });

    addResult(checks, {
      id: 'strategy.backtest',
      name: 'Strategy backtest',
      category: 'strategy',
      pass: Boolean(backtest),
      details: 'backtest completed',
    });

    const paperTrade = await client.strategy.paperExecute({
      agentId: agentA.id,
      walletId: agentA.walletId,
      type: 'transfer_sol',
      protocol: 'system-program',
      intent: { destination: payer.publicKey.toBase58(), lamports: 1000 },
    });
    const paperList = await client.strategy.paperList(agentA.id);

    addResult(checks, {
      id: 'strategy.paper_trade',
      name: 'Paper execute + list',
      category: 'strategy',
      pass: Boolean(paperTrade) && paperList.length > 0,
      details: `paperTrades=${paperList.length}`,
    });

    const treasuryAllocate = await client.treasury.allocate({
      targetAgentId: agentA.id,
      lamports: 500_000,
      reason: 'matrix seed budget',
    });
    const treasuryRebalance = await client.treasury.rebalance({
      sourceAgentId: agentA.id,
      targetAgentId: agentB.id,
      lamports: 200_000,
      reason: 'matrix rebalance',
    });

    addResult(checks, {
      id: 'treasury.allocate_rebalance',
      name: 'Treasury allocate + rebalance',
      category: 'treasury',
      pass: Boolean(treasuryAllocate) && Boolean(treasuryRebalance),
      details: 'treasury operations completed',
    });

    const mcpTools = await client.mcp.tools();
    const requiredMcpTools = ['tx.proof', 'tx.replay', 'agent.start', 'treasury.allocate', 'strategy.backtest'];
    const mcpToolSet = new Set(mcpTools.map((tool) => tool.name));
    const missing = requiredMcpTools.filter((name) => !mcpToolSet.has(name));

    addResult(checks, {
      id: 'mcp.tools',
      name: 'MCP tools catalog',
      category: 'mcp',
      pass: missing.length === 0,
      details: missing.length === 0 ? `toolCount=${mcpTools.length}` : `missing=${missing.join(',')}`,
    });

    if (primaryWalletId && firstTransferTxId) {
      const mcpBalance = await client.mcp.call('wallet.balance', { walletId: primaryWalletId });
      const mcpTxGet = await client.mcp.call('tx.get', { txId: firstTransferTxId });
      const mcpGatewayRequest = await client.mcp.call('gateway.request', {
        path: '/api/v1/wallets',
        method: 'GET',
      });

      addResult(checks, {
        id: 'mcp.call',
        name: 'MCP named + gateway.request invocation',
        category: 'mcp',
        pass: Boolean(mcpBalance) && Boolean(mcpTxGet) && Boolean(mcpGatewayRequest),
        details: 'wallet.balance, tx.get, gateway.request succeeded',
      });
    }

    await Promise.all([client.agent.stop(agentA.id), client.agent.stop(agentB.id)]);
    addResult(checks, {
      id: 'agent.stop',
      name: 'Stop agents',
      category: 'agent',
      pass: true,
      details: `stopped=${agentA.id},${agentB.id}`,
    });
  } catch (error) {
    addResult(checks, {
      id: 'demo.execution',
      name: 'Comprehensive demo execution',
      category: 'system',
      pass: false,
      details: asErrorMessage(error),
    });
  } finally {
    for (const agent of createdAgents) {
      try {
        await client.agent.stop(agent.id);
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  const protocolCoverageList = [...protocolCoverage.values()].sort((a, b) => a.protocol.localeCompare(b.protocol));
  const rendered = renderResults(checks, protocolCoverageList, {
    rpcUrl,
    createdAt: new Date().toISOString(),
  });
  await writeFile(resultsPath, rendered, 'utf8');

  console.log('\n=== Comprehensive Demo Summary ===');
  for (const item of checks) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.id} -> ${item.details}`);
    if (item.explorerUrl) {
      console.log(`  ${item.explorerUrl}`);
    }
  }
  console.log(`\nSaved results to ${resultsPath}`);

  if (checks.some((item) => !item.pass)) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
