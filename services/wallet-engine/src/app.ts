import { Hono } from 'hono';
import { z } from 'zod';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createWalletRequestSchema,
  signWalletPayloadSchema,
  walletMetadataSchema,
  type WalletMetadata,
} from '@agentic-wallet/common';
import { v4 as uuidv4 } from 'uuid';
import type { WalletEngineConfig } from './config.js';
import { WalletMetadataStore } from './storage/metadata-store.js';
import { createKeyProvider } from './key-provider/factory.js';

const serializeLegacySignature = (tx: Transaction, signer: Keypair): string => {
  const signature = tx.signatures.find(
    (entry) => entry.publicKey.equals(signer.publicKey) && entry.signature !== null,
  )?.signature;
  if (!signature) throw new Error('Transaction signature missing after signing');
  return bs58.encode(signature);
};

const serializeVersionedSignature = (tx: VersionedTransaction, signer: Keypair): string => {
  const requiredSigners = tx.message.header.numRequiredSignatures;
  const signerIndex = tx.message.staticAccountKeys
    .slice(0, requiredSigners)
    .findIndex((key) => key.equals(signer.publicKey));

  if (signerIndex < 0) {
    throw new Error(`Signer ${signer.publicKey.toBase58()} not present in transaction account keys`);
  }

  const signature = tx.signatures[signerIndex];
  if (!signature) {
    throw new Error('Versioned transaction signature missing after signing');
  }
  return bs58.encode(signature);
};

const signSerializedTransaction = (
  transactionB64: string,
  signer: Keypair,
): { signedTransaction: string; signature: string; txVersion: 'legacy' | 'v0' } => {
  const raw = Buffer.from(transactionB64, 'base64');

  try {
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign([signer]);
    return {
      signedTransaction: Buffer.from(tx.serialize()).toString('base64'),
      signature: serializeVersionedSignature(tx, signer),
      txVersion: 'v0',
    };
  } catch {
    const tx = Transaction.from(raw);
    tx.partialSign(signer);
    return {
      signedTransaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
      signature: serializeLegacySignature(tx, signer),
      txVersion: 'legacy',
    };
  }
};

const withRpcRetry = async <T>(
  operation: string,
  fn: () => Promise<T>,
  maxAttempts = Number(process.env.SOLANA_RPC_MAX_RETRIES ?? 5),
  baseDelayMs = Number(process.env.SOLANA_RPC_RETRY_DELAY_MS ?? 500),
): Promise<T> => {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry =
        attempt < maxAttempts &&
        (message.includes('429') ||
          message.includes('fetch failed') ||
          message.includes('blockhash not found') ||
          message.includes('Node is behind'));

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = Math.min(4000, baseDelayMs * attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`${operation} failed after ${maxAttempts} attempts: ${String(lastError)}`);
};

const parseFundingKeypair = (value: string): Keypair => {
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

  throw new Error('Unsupported funding key format; use JSON array, base64 64-byte key, or base58 64-byte key');
};

const isDevnetRpcUrl = (url: string): boolean => url.toLowerCase().includes('devnet');

export const createApp = (config: WalletEngineConfig) => {
  const app = new Hono();
  const connection = new Connection(config.solanaRpcUrl, 'confirmed');
  const keyProvider = createKeyProvider({
    backend: config.signerBackend,
    keysDir: `${config.dataDir}/keys`,
    encryptionSecret: config.encryptionSecret,
    mpcNodeSecrets: config.mpcNodeSecrets,
    ...(config.kmsMasterSecret ? { kmsMasterSecret: config.kmsMasterSecret } : {}),
    ...(config.kmsKeyId ? { kmsKeyId: config.kmsKeyId } : {}),
    ...(config.hsmPin ? { hsmPin: config.hsmPin } : {}),
    ...(config.hsmModuleSecret ? { hsmModuleSecret: config.hsmModuleSecret } : {}),
    ...(config.hsmSlotId ? { hsmSlotId: config.hsmSlotId } : {}),
  });
  const metadataStore = new WalletMetadataStore(config.dataDir);

  app.get('/health', (c) => c.json({ status: 'ok', service: 'wallet-engine' }));

  app.get('/api/v1/wallets', async (c) => {
    const publicKey = c.req.query('publicKey');
    const wallets = await metadataStore.list();
    const filtered = publicKey
      ? wallets.filter((wallet) => wallet.publicKey === publicKey)
      : wallets;

    return c.json({ data: filtered.map((wallet) => walletMetadataSchema.parse(wallet)) });
  });

  app.post('/api/v1/wallets', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createWalletRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const walletId = uuidv4();
    const keypair = Keypair.generate();

    const provenance = keyProvider.provenance();
    const provider = provenance.backend === 'memory'
      ? 'local-memory'
      : provenance.backend === 'encrypted-file'
        ? 'local-dev'
        : provenance.backend;

    const metadata: WalletMetadata = {
      id: walletId,
      publicKey: keypair.publicKey.toBase58(),
      provider,
      keyProvenance: provenance,
      createdAt: new Date().toISOString(),
      status: 'active',
      ...(parsed.data.label ? { label: parsed.data.label } : {}),
    };

    const autoFundRequested = Boolean(parsed.data.autoFund);
    if (!autoFundRequested) {
      await keyProvider.save(walletId, keypair);
      await metadataStore.add(metadata);
      return c.json({ data: metadata }, 201);
    }

    if (!isDevnetRpcUrl(config.solanaRpcUrl)) {
      return c.json({ error: 'autoFund is only supported on devnet RPC URLs' }, 400);
    }

    if (!config.autoFundPayerPrivateKey) {
      return c.json({
        error: 'autoFund requested but no payer key is configured. Set WALLET_AUTOFUND_PAYER_PRIVATE_KEY or PRIVATE_KEY.',
      }, 400);
    }

    const fundLamports = parsed.data.fundLamports ?? config.autoFundDefaultLamports;
    if (!Number.isFinite(fundLamports) || fundLamports <= 0) {
      return c.json({ error: 'Invalid fundLamports value; must be a positive integer' }, 400);
    }

    await keyProvider.save(walletId, keypair);
    await metadataStore.add(metadata);

    try {
      const payer = parseFundingKeypair(config.autoFundPayerPrivateKey);
      const destination = new PublicKey(metadata.publicKey);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: destination,
          lamports: Math.floor(fundLamports),
        }),
      );
      const signature = await withRpcRetry('sendAndConfirmTransaction:autoFund', () =>
        sendAndConfirmTransaction(connection, tx, [payer]),
      );

      return c.json({
        data: {
          ...metadata,
          autoFunding: {
            requested: true,
            funded: true,
            lamports: Math.floor(fundLamports),
            signature,
          },
        },
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        data: {
          ...metadata,
          autoFunding: {
            requested: true,
            funded: false,
            lamports: Math.floor(fundLamports),
            error: message,
          },
        },
      }, 201);
    }
  });

  app.get('/api/v1/wallets/:walletId', async (c) => {
    const walletId = z.string().uuid().safeParse(c.req.param('walletId'));
    if (!walletId.success) {
      return c.json({ error: 'Invalid walletId' }, 400);
    }

    const wallet = await metadataStore.getById(walletId.data);
    if (!wallet) {
      return c.json({ error: 'Wallet not found' }, 404);
    }

    return c.json({ data: walletMetadataSchema.parse(wallet) });
  });

  app.get('/api/v1/wallets/:walletId/balance', async (c) => {
    const walletId = z.string().uuid().safeParse(c.req.param('walletId'));
    if (!walletId.success) {
      return c.json({ error: 'Invalid walletId' }, 400);
    }
    const wallet = await metadataStore.getById(walletId.data);

    if (!wallet) {
      return c.json({ error: 'Wallet not found' }, 404);
    }
    const owner = new PublicKey(wallet.publicKey);
    const balanceLamports = await withRpcRetry('getBalance', () =>
      connection.getBalance(owner),
    );

    return c.json({
      data: {
        walletId: wallet.id,
        publicKey: wallet.publicKey,
        lamports: balanceLamports,
        sol: balanceLamports / 1_000_000_000,
      },
    });
  });

  app.get('/api/v1/wallets/:walletId/tokens', async (c) => {
    const walletId = z.string().uuid().safeParse(c.req.param('walletId'));
    if (!walletId.success) {
      return c.json({ error: 'Invalid walletId' }, 400);
    }
    const wallet = await metadataStore.getById(walletId.data);

    if (!wallet) {
      return c.json({ error: 'Wallet not found' }, 404);
    }
    const owner = new PublicKey(wallet.publicKey);

    const tokenAccounts = await withRpcRetry('getParsedTokenAccountsByOwner', () =>
      connection.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      }),
    );

    const tokens = tokenAccounts.value
      .map((account) => {
      const parsedData = account.account.data;
      if (Buffer.isBuffer(parsedData)) {
        return null;
      }
      if (parsedData.program !== 'spl-token' || parsedData.parsed.type !== 'account') {
        return null;
      }
      const info = parsedData.parsed.info;
      return {
        mint: info.mint,
        amount: info.tokenAmount.amount,
        decimals: info.tokenAmount.decimals,
        uiAmount: info.tokenAmount.uiAmount,
      };
      })
      .filter(
        (token): token is { mint: string; amount: string; decimals: number; uiAmount: number | null } =>
          token !== null,
      );

    return c.json({ data: { walletId: wallet.id, tokens } });
  });

  app.post('/api/v1/wallets/:walletId/sign', async (c) => {
    const walletId = z.string().uuid().safeParse(c.req.param('walletId'));
    if (!walletId.success) {
      return c.json({ error: 'Invalid walletId' }, 400);
    }
    const wallet = await metadataStore.getById(walletId.data);

    if (!wallet) {
      return c.json({ error: 'Wallet not found' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = signWalletPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const keypair = await keyProvider.load(wallet.id);

    if (parsed.data.transaction) {
      const signed = signSerializedTransaction(parsed.data.transaction, keypair);
      return c.json({ data: signed });
    }

    if (parsed.data.message) {
      const messageBytes = Buffer.from(parsed.data.message, 'base64');
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
      return c.json({
        data: {
          signatureBase64: Buffer.from(signature).toString('base64'),
          signatureBase58: bs58.encode(signature),
        },
      });
    }

    return c.json({ error: 'Invalid sign payload' }, 400);
  });

  return app;
};
