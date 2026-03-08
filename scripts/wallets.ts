import 'dotenv/config';
import { createAgenticWalletClient } from '../packages/sdk/src/index.js';

const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.API_KEY ?? 'dev-api-key';
const tenantId = process.env.TENANT_ID;

const usage = (): void => {
  console.log('Usage: npm run wallets -- list');
  console.log('   or: npm run wallets -- create --label <name>');
  console.log('   or: npm run wallets -- create --label <name> --auto-fund [--fund-lamports <lamports>]');
};

const getArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  const showHelp = process.argv.includes('--help') || process.argv.includes('-h');
  if (showHelp || !command) {
    usage();
    return;
  }

  const client = createAgenticWalletClient(apiBase, {
    apiKey,
    ...(tenantId ? { tenantId } : {}),
  });

  if (command === 'list') {
    const publicKey = getArg('--public-key');
    const data = await client.wallet.list(publicKey ? { publicKey } : undefined);
    console.log(JSON.stringify({ status: 'success', data }, null, 2));
    return;
  }

  if (command === 'create') {
    const label = getArg('--label');
    const autoFund = process.argv.includes('--auto-fund');
    const fundLamportsRaw = getArg('--fund-lamports');
    const fundLamports = fundLamportsRaw ? Number(fundLamportsRaw) : undefined;
    if (fundLamportsRaw && (!Number.isFinite(fundLamports) || fundLamports <= 0)) {
      throw new Error('--fund-lamports must be a positive number');
    }
    const data = await client.wallet.create({
      ...(label ? { label } : {}),
      ...(autoFund ? { autoFund: true } : {}),
      ...(fundLamports !== undefined ? { fundLamports } : {}),
    });
    console.log(JSON.stringify({ status: 'success', data }, null, 2));
    return;
  }

  usage();
  throw new Error(`Unsupported wallets command: ${command}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify(
      {
        status: 'failure',
        errorCode: 'PIPELINE_ERROR',
        failedAt: 'build',
        errorMessage: message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
