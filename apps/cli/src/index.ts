#!/usr/bin/env node

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { inspect } from 'node:util';
import { emitKeypressEvents } from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import inquirer from 'inquirer';
import { createAgenticWalletClient } from '@agentic-wallet/sdk';
import { renderStartupBanner } from './banner.js';

interface CliOptions {
  api: string;
  key?: string;
  tenant?: string;
  theme: string;
  banner: boolean;
  animatedBanner: boolean;
  raw: boolean;
  quiet: boolean;
}

interface CliContext {
  options: CliOptions;
  client: ReturnType<typeof createAgenticWalletClient>;
}

type CliThemeName = 'midnight' | 'matrix' | 'solarized' | 'fire';

type TableChars = {
  top: string;
  'top-mid': string;
  'top-left': string;
  'top-right': string;
  bottom: string;
  'bottom-mid': string;
  'bottom-left': string;
  'bottom-right': string;
  left: string;
  'left-mid': string;
  mid: string;
  'mid-mid': string;
  right: string;
  'right-mid': string;
  middle: string;
};

interface CliTheme {
  name: CliThemeName;
  accent: (value: string) => string;
  accentSoft: (value: string) => string;
  good: (value: string) => string;
  warn: (value: string) => string;
  bad: (value: string) => string;
  muted: (value: string) => string;
  borderColor: string;
  spinnerColor: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'magenta';
  glyph: string;
  gradientStops: [string, string, string];
  tableChars: TableChars;
  bannerBorderStyle: 'single' | 'double' | 'round' | 'bold' | 'singleDouble';
  chipTextColor: string;
  chipGoodBg: string;
  chipWarnBg: string;
  chipBadBg: string;
}

const KNOWN_INTENTS = [
  'transfer_sol',
  'transfer_spl',
  'swap',
  'stake',
  'unstake',
  'lend_supply',
  'lend_borrow',
  'create_mint',
  'mint_token',
  'query_balance',
  'query_positions',
  'create_escrow',
  'accept_escrow',
  'release_escrow',
  'refund_escrow',
  'dispute_escrow',
  'resolve_dispute',
  'create_milestone_escrow',
  'release_milestone',
  'x402_pay',
  'flash_loan_bundle',
  'cpi_call',
  'custom_instruction_bundle',
  'treasury_allocate',
  'treasury_rebalance',
  'paper_trade',
] as const;

const KNOWN_PROTOCOLS = [
  'system-program',
  'spl-token',
  'jupiter',
  'marinade',
  'solend',
  'metaplex',
  'orca',
  'raydium',
  'escrow',
] as const;

const DEFAULT_API = process.env.API_BASE_URL ?? 'http://localhost:3000';
const DEFAULT_KEY = process.env.API_KEY ?? 'dev-api-key';
const DEFAULT_TENANT = process.env.TENANT_ID ?? '';
const DEFAULT_THEME = (process.env.CLI_THEME ?? 'matrix') as CliThemeName;
const DEFAULT_BANNER = (process.env.CLI_BANNER ?? 'true') !== 'false';
const DEFAULT_ANIMATED_BANNER = (process.env.CLI_ANIMATED_BANNER ?? 'true') !== 'false';
const BACK_OPTION = '__back__';

const ROUNDED_TABLE_CHARS: TableChars = {
  top: '─',
  'top-mid': '┬',
  'top-left': '╭',
  'top-right': '╮',
  bottom: '─',
  'bottom-mid': '┴',
  'bottom-left': '╰',
  'bottom-right': '╯',
  left: '│',
  'left-mid': '├',
  mid: '─',
  'mid-mid': '┼',
  right: '│',
  'right-mid': '┤',
  middle: '│',
};

const HEAVY_TABLE_CHARS: TableChars = {
  top: '━',
  'top-mid': '┳',
  'top-left': '┏',
  'top-right': '┓',
  bottom: '━',
  'bottom-mid': '┻',
  'bottom-left': '┗',
  'bottom-right': '┛',
  left: '┃',
  'left-mid': '┣',
  mid: '━',
  'mid-mid': '╋',
  right: '┃',
  'right-mid': '┫',
  middle: '┃',
};

const DOUBLE_TABLE_CHARS: TableChars = {
  top: '═',
  'top-mid': '╦',
  'top-left': '╔',
  'top-right': '╗',
  bottom: '═',
  'bottom-mid': '╩',
  'bottom-left': '╚',
  'bottom-right': '╝',
  left: '║',
  'left-mid': '╠',
  mid: '═',
  'mid-mid': '╬',
  right: '║',
  'right-mid': '╣',
  middle: '║',
};

const THEMES: Record<CliThemeName, CliTheme> = {
  midnight: {
    name: 'midnight',
    accent: chalk.cyanBright,
    accentSoft: chalk.blueBright,
    good: chalk.greenBright,
    warn: chalk.yellowBright,
    bad: chalk.redBright,
    muted: chalk.gray,
    borderColor: 'blue',
    spinnerColor: 'cyan',
    glyph: '◆',
    gradientStops: ['#15f4ee', '#3688ff', '#9b5dff'],
    tableChars: ROUNDED_TABLE_CHARS,
    bannerBorderStyle: 'round',
    chipTextColor: '#081018',
    chipGoodBg: '#22c55e',
    chipWarnBg: '#f59e0b',
    chipBadBg: '#ef4444',
  },
  matrix: {
    name: 'matrix',
    accent: chalk.greenBright,
    accentSoft: chalk.green,
    good: chalk.greenBright,
    warn: chalk.yellow,
    bad: chalk.redBright,
    muted: chalk.gray,
    borderColor: 'green',
    spinnerColor: 'green',
    glyph: '◉',
    gradientStops: ['#89ff61', '#24ff72', '#00d25c'],
    tableChars: HEAVY_TABLE_CHARS,
    bannerBorderStyle: 'bold',
    chipTextColor: '#011207',
    chipGoodBg: '#22c55e',
    chipWarnBg: '#eab308',
    chipBadBg: '#ef4444',
  },
  solarized: {
    name: 'solarized',
    accent: chalk.hex('#2aa198'),
    accentSoft: chalk.hex('#b58900'),
    good: chalk.hex('#859900'),
    warn: chalk.hex('#b58900'),
    bad: chalk.hex('#dc322f'),
    muted: chalk.hex('#586e75'),
    borderColor: 'yellow',
    spinnerColor: 'yellow',
    glyph: '◈',
    gradientStops: ['#2aa198', '#b58900', '#cb4b16'],
    tableChars: DOUBLE_TABLE_CHARS,
    bannerBorderStyle: 'double',
    chipTextColor: '#1c1b17',
    chipGoodBg: '#859900',
    chipWarnBg: '#b58900',
    chipBadBg: '#dc322f',
  },
  fire: {
    name: 'fire',
    accent: chalk.hex('#ff7f50'),
    accentSoft: chalk.hex('#ffb347'),
    good: chalk.hex('#ffcc66'),
    warn: chalk.hex('#ff9f43'),
    bad: chalk.hex('#ff5252'),
    muted: chalk.gray,
    borderColor: 'red',
    spinnerColor: 'red',
    glyph: '⬢',
    gradientStops: ['#ff8a3d', '#ff5f56', '#ffb347'],
    tableChars: HEAVY_TABLE_CHARS,
    bannerBorderStyle: 'bold',
    chipTextColor: '#220a04',
    chipGoodBg: '#ffcc66',
    chipWarnBg: '#ff9f43',
    chipBadBg: '#ff5252',
  },
};

let ACTIVE_THEME: CliTheme = THEMES[DEFAULT_THEME] ?? THEMES.midnight;

const program = new Command();

const parseBoolean = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
};

const parseJson = (value: string, fieldName: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse ${fieldName} JSON: ${(error as Error).message}`);
  }
};

const parseJsonArray = (value: string, fieldName: string): unknown[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON array`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse ${fieldName} JSON array: ${(error as Error).message}`);
  }
};

const parseCsv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const parseOptionalNumber = (value?: string): number | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid number value: ${value}`);
  }
  return parsed;
};

const parseTheme = (value: string): CliThemeName => {
  const normalized = value.trim().toLowerCase() as CliThemeName;
  if (normalized in THEMES) return normalized;
  throw new Error(`Unknown theme: ${value}. Use one of: ${Object.keys(THEMES).join(', ')}`);
};

const printRule = (label?: string): void => {
  const width = Math.max(26, Math.min((process.stdout.columns ?? 100) - 2, 110));
  const leadCount = Math.max(2, Math.floor(width * 0.12));
  const left = ACTIVE_THEME.accent('─'.repeat(leadCount));
  const fill = ACTIVE_THEME.muted('─'.repeat(Math.max(4, width - leadCount)));
  if (!label) {
    console.log(`${left}${fill}`);
    return;
  }

  const title = ACTIVE_THEME.accent(` ${label} `);
  const rest = Math.max(4, width - leadCount - label.length - 2);
  console.log(`${left}${title}${ACTIVE_THEME.muted('─'.repeat(rest))}`);
};

const maybeReadJsonFile = async (path?: string): Promise<Record<string, unknown> | undefined> => {
  if (!path) return undefined;
  const content = await readFile(path, 'utf8');
  return parseJson(content, `file:${path}`);
};

const truncate = (value: string, max = 72): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
};

const toChip = (value: string, background: string): string =>
  chalk.hex(ACTIVE_THEME.chipTextColor).bgHex(background).bold(` ${value.toUpperCase().replaceAll('_', ' ')} `);

const colorizeStatus = (value: string): string => {
  const normalized = value.toLowerCase();
  if (['ok', 'confirmed', 'active', 'running', 'ready', 'allow'].includes(normalized)) {
    return toChip(value, ACTIVE_THEME.chipGoodBg);
  }
  if (['pending', 'simulating', 'policy_eval', 'approval_gate', 'submitting', 'warning'].includes(normalized)) {
    return toChip(value, ACTIVE_THEME.chipWarnBg);
  }
  if (['error', 'failed', 'deny', 'denied', 'unreachable'].includes(normalized)) {
    return toChip(value, ACTIVE_THEME.chipBadBg);
  }
  return value;
};

const formatCell = (value: unknown, key = ''): string => {
  if (value === null || value === undefined) return '';

  if (Array.isArray(value)) {
    return truncate(JSON.stringify(value));
  }

  if (typeof value === 'string') {
    if (key.toLowerCase() === 'status') return colorizeStatus(value);
    if (key.toLowerCase().endsWith('id')) return ACTIVE_THEME.muted(truncate(value));
    return truncate(value);
  }

  if (typeof value === 'number') {
    if (key.toLowerCase().includes('latency')) {
      if (value >= 1000) return ACTIVE_THEME.bad(String(value));
      if (value >= 350) return ACTIVE_THEME.warn(String(value));
      return ACTIVE_THEME.good(String(value));
    }
    if (key.toLowerCase() === 'http') {
      if (value >= 200 && value < 300) return ACTIVE_THEME.good(String(value));
      if (value >= 300 && value < 500) return ACTIVE_THEME.warn(String(value));
      return ACTIVE_THEME.bad(String(value));
    }
    return String(value);
  }

  if (typeof value === 'boolean') return value ? ACTIVE_THEME.good('true') : ACTIVE_THEME.muted('false');
  return truncate(JSON.stringify(value));
};

const printPromptHint = (): void => {
  console.log(
    `${ACTIVE_THEME.muted('keys:')} ${ACTIVE_THEME.accent('↑/↓')} ${ACTIVE_THEME.muted('navigate')} ${ACTIVE_THEME.accent('•')} ${ACTIVE_THEME.accent('Enter')} ${ACTIVE_THEME.muted('select')} ${ACTIVE_THEME.accent('•')} ${ACTIVE_THEME.accent('Ctrl+C')} ${ACTIVE_THEME.muted('quit')} ${ACTIVE_THEME.accent(ACTIVE_THEME.glyph)}`,
  );
};

const withEscToExit = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  if (!process.stdin.isTTY) {
    return fn();
  }

  emitKeypressEvents(process.stdin);
  const stdin = process.stdin as NodeJS.ReadStream;
  const wasRaw = Boolean(stdin.isRaw);

  if (!wasRaw && stdin.setRawMode) {
    stdin.setRawMode(true);
  }

  const onData = (chunk: Buffer | string): void => {
    const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (data === '\u001b') {
      process.stdout.write('\n');
      printSuccess(`${label} closed`);
      process.exit(0);
    }
  };

  stdin.on('data', onData);

  try {
    return await fn();
  } finally {
    stdin.off('data', onData);
    if (!wasRaw && stdin.setRawMode) {
      stdin.setRawMode(false);
    }
  }
};

const printTable = (rows: Array<Record<string, unknown>>): void => {
  if (rows.length === 0) {
    console.log(ACTIVE_THEME.muted('No data'));
    return;
  }

  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
  const table = new Table({
    head: keys.map((key) => ACTIVE_THEME.accent(key)),
    wordWrap: true,
    style: {
      head: [],
      border: [],
      compact: true,
    },
    chars: ACTIVE_THEME.tableChars,
  });

  for (const row of rows) {
    table.push(keys.map((key) => formatCell(row[key], key)));
  }

  printRule(`${rows.length} row${rows.length === 1 ? '' : 's'}`);
  console.log(table.toString());
};

const printObjectDetails = (value: Record<string, unknown>): void => {
  const width = process.stdout.columns ?? 120;
  const fieldWidth = Math.max(18, Math.min(30, Math.floor(width * 0.24)));
  const valueWidth = Math.max(24, width - fieldWidth - 8);

  const table = new Table({
    head: [ACTIVE_THEME.accent('field'), ACTIVE_THEME.accent('value')],
    colWidths: [fieldWidth, valueWidth],
    wordWrap: true,
    style: {
      head: [],
      border: [],
      compact: true,
    },
    chars: ACTIVE_THEME.tableChars,
  });

  for (const [key, entry] of Object.entries(value)) {
    table.push([ACTIVE_THEME.accentSoft(key), formatCell(entry, key)]);
  }

  printRule('details');
  console.log(table.toString());
};

const printData = (value: unknown, raw = false): void => {
  if (raw) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))) {
    printTable(value as Array<Record<string, unknown>>);
    return;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    printObjectDetails(value as Record<string, unknown>);
    return;
  }

  console.log(inspect(value, { colors: true, depth: 6 }));
};

const printSuccess = (message: string): void => {
  console.log(`${toChip('ok', ACTIVE_THEME.chipGoodBg)} ${message}`);
};

const printError = (message: string): void => {
  console.error(`${toChip('error', ACTIVE_THEME.chipBadBg)} ${message}`);
};

const getContext = (): CliContext => {
  const opts = program.opts<Partial<CliOptions>>();
  const options: CliOptions = {
    api: opts.api ?? DEFAULT_API,
    key: opts.key ?? DEFAULT_KEY,
    tenant: opts.tenant ?? DEFAULT_TENANT,
    theme: opts.theme ?? DEFAULT_THEME,
    banner: opts.banner ?? DEFAULT_BANNER,
    animatedBanner: opts.animatedBanner ?? DEFAULT_ANIMATED_BANNER,
    raw: Boolean(opts.raw),
    quiet: Boolean(opts.quiet),
  };

  ACTIVE_THEME = THEMES[parseTheme(options.theme)];

  const client = createAgenticWalletClient(options.api, {
    ...(options.key ? { apiKey: options.key } : {}),
    ...(options.tenant ? { tenantId: options.tenant } : {}),
  });

  return { options, client };
};

const withSpinner = async <T>(label: string, quiet: boolean, fn: () => Promise<T>): Promise<T> => {
  if (quiet) {
    return fn();
  }

  const spinner = ora({
    text: label,
    spinner: 'dots12',
    color: ACTIVE_THEME.spinnerColor,
    prefixText: ACTIVE_THEME.accent(ACTIVE_THEME.glyph),
  }).start();
  try {
    const value = await fn();
    spinner.succeed(label);
    return value;
  } catch (error) {
    spinner.fail(label);
    throw error;
  }
};

const handleCliError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  printError(message);
  process.exitCode = 1;
};

const commandAction = (fn: (ctx: CliContext, ...args: any[]) => Promise<void>) => {
  return async (...args: any[]) => {
    const ctx = getContext();

    try {
      await fn(ctx, ...args);
    } catch (error) {
      handleCliError(error);
    }
  };
};

const doctor = async (ctx: CliContext): Promise<void> => {
  const checks: Array<{ service: string; url: string }> = [
    { service: 'api-gateway', url: `${ctx.options.api}/health` },
  ];
  const rows: Array<Record<string, unknown>> = [];

  let gatewayHealth: { routes?: Record<string, string> } | null = null;
  const gatewayStart = Date.now();

  try {
    gatewayHealth = await withSpinner('Checking gateway health', ctx.options.quiet, async () => {
      const res = await fetch(`${ctx.options.api}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        throw new Error(`Gateway health failed: HTTP ${res.status}`);
      }
      return (await res.json()) as {
        routes?: Record<string, string>;
      };
    });
    rows.push({
      service: 'api-gateway',
      status: 'ok',
      http: 200,
      latencyMs: Date.now() - gatewayStart,
      url: `${ctx.options.api}/health`,
    });
  } catch (error) {
    rows.push({
      service: 'api-gateway',
      status: 'unreachable',
      http: '-',
      latencyMs: Date.now() - gatewayStart,
      url: `${ctx.options.api}/health`,
      error: (error as Error).message,
    });

    printData(rows, ctx.options.raw);
    printError(
      `Gateway is unreachable at ${ctx.options.api}. Start services with \`npm run dev\` or pass \`--api <url>\`.`,
    );
    return;
  }

  for (const [name, base] of Object.entries(gatewayHealth.routes ?? {})) {
    checks.push({ service: name, url: `${base}/health` });
  }

  for (const check of checks.slice(1)) {
    const start = Date.now();
    try {
      const res = await fetch(check.url, { signal: AbortSignal.timeout(5000) });
      rows.push({
        service: check.service,
        status: res.ok ? 'ok' : 'error',
        http: res.status,
        latencyMs: Date.now() - start,
        url: check.url,
      });
    } catch (error) {
      rows.push({
        service: check.service,
        status: 'unreachable',
        http: '-',
        latencyMs: Date.now() - start,
        url: check.url,
        error: (error as Error).message,
      });
    }
  }

  printData(rows, ctx.options.raw);
};

const runTxWizard = async (ctx: CliContext): Promise<void> => {
  while (true) {
    printPromptHint();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyanBright('Transaction wizard'),
        pageSize: 12,
        choices: [
          { name: 'Create transaction', value: 'create' },
          { name: 'Get transaction', value: 'get' },
          { name: 'Get proof', value: 'proof' },
          { name: 'Replay transaction', value: 'replay' },
          { name: 'Retry transaction', value: 'retry' },
          { name: 'Approve transaction', value: 'approve' },
          { name: 'Reject transaction', value: 'reject' },
          { name: 'List wallet transactions', value: 'list' },
          { name: 'List pending approvals', value: 'pending' },
          { name: 'List positions', value: 'positions' },
          { name: 'List escrows', value: 'escrows' },
          { name: 'Back', value: BACK_OPTION },
        ],
      },
    ]);

    if (action === BACK_OPTION) return;

    try {
      if (action === 'create') {
        const answers = await inquirer.prompt<{
          walletId: string;
          type: string;
          protocol: string;
          intentJson: string;
          gasless: boolean;
          agentId?: string;
          idempotencyKey?: string;
        }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
          { type: 'list', name: 'type', message: 'Intent type:', choices: KNOWN_INTENTS, default: 'query_balance' },
          { type: 'list', name: 'protocol', message: 'Protocol:', choices: KNOWN_PROTOCOLS, default: 'system-program' },
          { type: 'input', name: 'intentJson', message: 'Intent JSON:', default: '{}' },
          { type: 'confirm', name: 'gasless', message: 'Gasless mode?', default: false },
          { type: 'input', name: 'agentId', message: 'Agent ID (optional):' },
          { type: 'input', name: 'idempotencyKey', message: 'Idempotency key (optional):' },
        ]);

        const data = await withSpinner('Creating transaction', ctx.options.quiet, () =>
          ctx.client.transaction.create({
            walletId: answers.walletId,
            type: answers.type as any,
            protocol: answers.protocol,
            intent: parseJson(answers.intentJson, 'intentJson'),
            gasless: answers.gasless,
            ...(answers.agentId ? { agentId: answers.agentId } : {}),
            ...(answers.idempotencyKey ? { idempotencyKey: answers.idempotencyKey } : {}),
          }),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'get' || action === 'proof' || action === 'replay' || action === 'retry' || action === 'approve' || action === 'reject') {
        const { txId } = await inquirer.prompt<{ txId: string }>([
          { type: 'input', name: 'txId', message: 'Transaction ID:' },
        ]);

        const data = await withSpinner(`Running tx ${action}`, ctx.options.quiet, async () => {
          if (action === 'get') return ctx.client.transaction.get(txId);
          if (action === 'proof') return ctx.client.transaction.getProof(txId);
          if (action === 'replay') return ctx.client.transaction.replay(txId);
          if (action === 'retry') return ctx.client.transaction.retry(txId);
          if (action === 'approve') return ctx.client.transaction.approve(txId);
          return ctx.client.transaction.reject(txId);
        });
        printData(data, ctx.options.raw);
      } else if (action === 'list' || action === 'pending' || action === 'positions' || action === 'escrows') {
        const { walletId } = await inquirer.prompt<{ walletId: string }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
        ]);

        const data = await withSpinner(`Listing ${action}`, ctx.options.quiet, async () => {
          if (action === 'list') return ctx.client.transaction.listByWallet(walletId);
          if (action === 'pending') return ctx.client.transaction.listPendingApprovals(walletId);
          if (action === 'positions') return ctx.client.transaction.listPositions(walletId);
          return ctx.client.transaction.listEscrows(walletId);
        });
        printData(data, ctx.options.raw);
      }
    } catch (error) {
      handleCliError(error);
    }
  }
};

const runPolicyWizard = async (ctx: CliContext): Promise<void> => {
  while (true) {
    printPromptHint();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyanBright('Policy wizard'),
        choices: [
          { name: 'Create policy', value: 'create' },
          { name: 'List wallet policies', value: 'list' },
          { name: 'List policy versions', value: 'versions' },
          { name: 'Get one policy version', value: 'version' },
          { name: 'Migrate policy', value: 'migrate' },
          { name: 'Compatibility check', value: 'compat' },
          { name: 'Evaluate request', value: 'evaluate' },
          { name: 'Back', value: BACK_OPTION },
        ],
      },
    ]);

    if (action === BACK_OPTION) return;

    try {
      if (action === 'create') {
        const answers = await inquirer.prompt<{
          walletId: string;
          name: string;
          rulesJson: string;
          active: boolean;
        }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
          { type: 'input', name: 'name', message: 'Policy name:' },
          { type: 'input', name: 'rulesJson', message: 'Rules JSON array:', default: '[]' },
          { type: 'confirm', name: 'active', message: 'Active?', default: true },
        ]);

        const data = await withSpinner('Creating policy', ctx.options.quiet, () =>
          ctx.client.policy.create({
            walletId: answers.walletId,
            name: answers.name,
            rules: parseJsonArray(answers.rulesJson, 'rulesJson') as any,
            active: answers.active,
          }),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'list') {
        const { walletId } = await inquirer.prompt<{ walletId: string }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
        ]);
        const data = await withSpinner('Listing policies', ctx.options.quiet, () =>
          ctx.client.policy.list(walletId),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'versions') {
        const { policyId } = await inquirer.prompt<{ policyId: string }>([
          { type: 'input', name: 'policyId', message: 'Policy ID:' },
        ]);
        const data = await withSpinner('Listing versions', ctx.options.quiet, () =>
          ctx.client.policy.listVersions(policyId),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'version') {
        const { policyId, version } = await inquirer.prompt<{ policyId: string; version: string }>([
          { type: 'input', name: 'policyId', message: 'Policy ID:' },
          { type: 'input', name: 'version', message: 'Version number:' },
        ]);
        const data = await withSpinner('Fetching version', ctx.options.quiet, () =>
          ctx.client.policy.getVersion(policyId, Number(version)),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'migrate') {
        const { policyId, targetVersion, mode } = await inquirer.prompt<{
          policyId: string;
          targetVersion: string;
          mode?: string;
        }>([
          { type: 'input', name: 'policyId', message: 'Policy ID:' },
          { type: 'input', name: 'targetVersion', message: 'Target version:' },
          { type: 'input', name: 'mode', message: 'Mode (optional):' },
        ]);
        const data = await withSpinner('Migrating policy', ctx.options.quiet, () =>
          ctx.client.policy.migrate(policyId, {
            targetVersion: Number(targetVersion),
            ...(mode ? { mode } : {}),
          }),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'compat') {
        const { rulesJson } = await inquirer.prompt<{ rulesJson: string }>([
          { type: 'input', name: 'rulesJson', message: 'Rules JSON array:', default: '[]' },
        ]);
        const data = await withSpinner('Checking compatibility', ctx.options.quiet, () =>
          ctx.client.policy.compatibilityCheck({ rules: parseJsonArray(rulesJson, 'rulesJson') }),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'evaluate') {
        const answers = await inquirer.prompt<{
          walletId: string;
          type: string;
          protocol: string;
          destination?: string;
          tokenMint?: string;
          amountLamports?: string;
          slippageBps?: string;
          programIds?: string;
        }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
          { type: 'list', name: 'type', message: 'Intent type:', choices: KNOWN_INTENTS, default: 'transfer_sol' },
          { type: 'list', name: 'protocol', message: 'Protocol:', choices: KNOWN_PROTOCOLS, default: 'system-program' },
          { type: 'input', name: 'destination', message: 'Destination (optional):' },
          { type: 'input', name: 'tokenMint', message: 'Token mint (optional):' },
          { type: 'input', name: 'amountLamports', message: 'Amount lamports (optional):' },
          { type: 'input', name: 'slippageBps', message: 'Slippage bps (optional):' },
          { type: 'input', name: 'programIds', message: 'Program IDs CSV (optional):' },
        ]);

        const data = await withSpinner('Evaluating policy', ctx.options.quiet, () =>
          ctx.client.policy.evaluate({
            walletId: answers.walletId,
            type: answers.type,
            protocol: answers.protocol,
            ...(answers.destination ? { destination: answers.destination } : {}),
            ...(answers.tokenMint ? { tokenMint: answers.tokenMint } : {}),
            ...(parseOptionalNumber(answers.amountLamports) !== undefined
              ? { amountLamports: parseOptionalNumber(answers.amountLamports)! }
              : {}),
            ...(parseOptionalNumber(answers.slippageBps) !== undefined
              ? { slippageBps: parseOptionalNumber(answers.slippageBps)! }
              : {}),
            ...(answers.programIds ? { programIds: parseCsv(answers.programIds) } : {}),
          }),
        );
        printData(data, ctx.options.raw);
      }
    } catch (error) {
      handleCliError(error);
    }
  }
};

const runRiskWizard = async (ctx: CliContext): Promise<void> => {
  while (true) {
    printPromptHint();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyanBright('Risk wizard'),
        choices: [
          { name: 'List protocol risk profiles', value: 'protocols' },
          { name: 'Get protocol risk profile', value: 'protocol-get' },
          { name: 'Set protocol risk profile', value: 'protocol-set' },
          { name: 'List portfolio controls', value: 'portfolio' },
          { name: 'Get portfolio controls', value: 'portfolio-get' },
          { name: 'Set portfolio controls', value: 'portfolio-set' },
          { name: 'Get chaos config', value: 'chaos' },
          { name: 'Set chaos config', value: 'chaos-set' },
          { name: 'Back', value: BACK_OPTION },
        ],
      },
    ]);

    if (action === BACK_OPTION) return;

    try {
      if (action === 'protocols') {
        const data = await withSpinner('Listing protocol risk', ctx.options.quiet, () => ctx.client.risk.listProtocols());
        printData(data, ctx.options.raw);
      } else if (action === 'protocol-get') {
        const { protocol } = await inquirer.prompt<{ protocol: string }>([
          { type: 'list', name: 'protocol', message: 'Protocol:', choices: KNOWN_PROTOCOLS },
        ]);
        const data = await withSpinner('Fetching protocol risk', ctx.options.quiet, () => ctx.client.risk.getProtocol(protocol));
        printData(data, ctx.options.raw);
      } else if (action === 'protocol-set') {
        const { protocol, inputJson } = await inquirer.prompt<{ protocol: string; inputJson: string }>([
          { type: 'list', name: 'protocol', message: 'Protocol:', choices: KNOWN_PROTOCOLS },
          { type: 'input', name: 'inputJson', message: 'Risk JSON object:', default: '{}' },
        ]);
        const data = await withSpinner('Updating protocol risk', ctx.options.quiet, () =>
          ctx.client.risk.setProtocol(protocol, parseJson(inputJson, 'inputJson')),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'portfolio') {
        const data = await withSpinner('Listing portfolio controls', ctx.options.quiet, () => ctx.client.risk.listPortfolioControls());
        printData(data, ctx.options.raw);
      } else if (action === 'portfolio-get') {
        const { walletId } = await inquirer.prompt<{ walletId: string }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
        ]);
        const data = await withSpinner('Fetching portfolio controls', ctx.options.quiet, () => ctx.client.risk.getPortfolioControls(walletId));
        printData(data, ctx.options.raw);
      } else if (action === 'portfolio-set') {
        const { walletId, inputJson } = await inquirer.prompt<{ walletId: string; inputJson: string }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
          { type: 'input', name: 'inputJson', message: 'Portfolio JSON object:', default: '{}' },
        ]);
        const data = await withSpinner('Updating portfolio controls', ctx.options.quiet, () =>
          ctx.client.risk.setPortfolioControls(walletId, parseJson(inputJson, 'inputJson')),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'chaos') {
        const data = await withSpinner('Fetching chaos config', ctx.options.quiet, () => ctx.client.risk.getChaos());
        printData(data, ctx.options.raw);
      } else if (action === 'chaos-set') {
        const { enabled, failureRatesJson, latencyMs } = await inquirer.prompt<{
          enabled?: string;
          failureRatesJson?: string;
          latencyMs?: string;
        }>([
          { type: 'input', name: 'enabled', message: 'Enabled true/false (optional):' },
          { type: 'input', name: 'failureRatesJson', message: 'Failure rates JSON object (optional):' },
          { type: 'input', name: 'latencyMs', message: 'Latency ms (optional):' },
        ]);
        const payload: { enabled?: boolean; failureRates?: Record<string, number>; latencyMs?: number } = {};
        if (enabled && enabled.trim()) payload.enabled = parseBoolean(enabled);
        if (failureRatesJson && failureRatesJson.trim()) payload.failureRates = parseJson(failureRatesJson, 'failureRatesJson') as Record<string, number>;
        const parsedLatency = parseOptionalNumber(latencyMs);
        if (parsedLatency !== undefined) payload.latencyMs = parsedLatency;
        const data = await withSpinner('Updating chaos config', ctx.options.quiet, () => ctx.client.risk.setChaos(payload));
        printData(data, ctx.options.raw);
      }
    } catch (error) {
      handleCliError(error);
    }
  }
};

const runStrategyWizard = async (ctx: CliContext): Promise<void> => {
  while (true) {
    printPromptHint();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyanBright('Strategy wizard'),
        choices: [
          { name: 'Run backtest', value: 'backtest' },
          { name: 'Execute paper trade step', value: 'paper-execute' },
          { name: 'List paper ledger', value: 'paper-list' },
          { name: 'Back', value: BACK_OPTION },
        ],
      },
    ]);

    if (action === BACK_OPTION) return;

    try {
      if (action === 'backtest') {
        const now = new Date().toISOString();
        const defaultSteps = JSON.stringify(
          [{ type: 'query_balance', protocol: 'system-program', intent: {}, timestamp: now }],
          null,
          0,
        );
        const { walletId, name, stepsJson, minimumPassRate } = await inquirer.prompt<{
          walletId: string;
          name: string;
          stepsJson: string;
          minimumPassRate?: string;
        }>([
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
          { type: 'input', name: 'name', message: 'Backtest name:' },
          { type: 'input', name: 'stepsJson', message: 'Steps JSON array:', default: defaultSteps },
          { type: 'input', name: 'minimumPassRate', message: 'Minimum pass rate (0-1, optional):' },
        ]);
        const parsedPassRate = parseOptionalNumber(minimumPassRate);
        const data = await withSpinner('Running backtest', ctx.options.quiet, () =>
          ctx.client.strategy.backtest({
            walletId,
            name,
            steps: parseJsonArray(stepsJson, 'stepsJson') as any,
            ...(parsedPassRate !== undefined ? { minimumPassRate: parsedPassRate } : {}),
          }),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'paper-execute') {
        const { agentId, walletId, type, protocol, intentJson } = await inquirer.prompt<{
          agentId: string;
          walletId: string;
          type: string;
          protocol: string;
          intentJson: string;
        }>([
          { type: 'input', name: 'agentId', message: 'Agent ID:' },
          { type: 'input', name: 'walletId', message: 'Wallet ID:' },
          { type: 'list', name: 'type', message: 'Intent type:', choices: KNOWN_INTENTS, default: 'query_balance' },
          { type: 'list', name: 'protocol', message: 'Protocol:', choices: KNOWN_PROTOCOLS, default: 'system-program' },
          { type: 'input', name: 'intentJson', message: 'Intent JSON:', default: '{}' },
        ]);
        const data = await withSpinner('Executing paper trade', ctx.options.quiet, () =>
          ctx.client.strategy.paperExecute({
            agentId,
            walletId,
            type: type as any,
            protocol,
            intent: parseJson(intentJson, 'intentJson'),
          }),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'paper-list') {
        const { agentId } = await inquirer.prompt<{ agentId: string }>([
          { type: 'input', name: 'agentId', message: 'Agent ID:' },
        ]);
        const data = await withSpinner('Fetching paper ledger', ctx.options.quiet, () => ctx.client.strategy.paperList(agentId));
        printData(data, ctx.options.raw);
      }
    } catch (error) {
      handleCliError(error);
    }
  }
};

const runTreasuryWizard = async (ctx: CliContext): Promise<void> => {
  while (true) {
    printPromptHint();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyanBright('Treasury wizard'),
        choices: [
          { name: 'Allocate budget', value: 'allocate' },
          { name: 'Rebalance budget', value: 'rebalance' },
          { name: 'Back', value: BACK_OPTION },
        ],
      },
    ]);

    if (action === BACK_OPTION) return;

    try {
      if (action === 'allocate') {
        const { targetAgentId, lamports, sourceAgentId, reason } = await inquirer.prompt<{
          targetAgentId: string;
          lamports: string;
          sourceAgentId?: string;
          reason?: string;
        }>([
          { type: 'input', name: 'targetAgentId', message: 'Target agent ID:' },
          { type: 'input', name: 'lamports', message: 'Lamports:' },
          { type: 'input', name: 'sourceAgentId', message: 'Source agent ID (optional):' },
          { type: 'input', name: 'reason', message: 'Reason (optional):' },
        ]);
        const data = await withSpinner('Allocating treasury', ctx.options.quiet, () =>
          ctx.client.treasury.allocate({
            targetAgentId,
            lamports: Number(lamports),
            ...(sourceAgentId ? { sourceAgentId } : {}),
            ...(reason ? { reason } : {}),
          }),
        );
        printData(data, ctx.options.raw);
      } else if (action === 'rebalance') {
        const { sourceAgentId, targetAgentId, lamports, reason } = await inquirer.prompt<{
          sourceAgentId: string;
          targetAgentId: string;
          lamports: string;
          reason?: string;
        }>([
          { type: 'input', name: 'sourceAgentId', message: 'Source agent ID:' },
          { type: 'input', name: 'targetAgentId', message: 'Target agent ID:' },
          { type: 'input', name: 'lamports', message: 'Lamports:' },
          { type: 'input', name: 'reason', message: 'Reason (optional):' },
        ]);
        const data = await withSpinner('Rebalancing treasury', ctx.options.quiet, () =>
          ctx.client.treasury.rebalance({
            sourceAgentId,
            targetAgentId,
            lamports: Number(lamports),
            ...(reason ? { reason } : {}),
          }),
        );
        printData(data, ctx.options.raw);
      }
    } catch (error) {
      handleCliError(error);
    }
  }
};

const runMcpWizard = async (ctx: CliContext): Promise<void> => {
  while (true) {
    printPromptHint();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyanBright('MCP wizard'),
        choices: [
          { name: 'List tools', value: 'tools' },
          { name: 'Call tool', value: 'call' },
          { name: 'Back', value: BACK_OPTION },
        ],
      },
    ]);

    if (action === BACK_OPTION) return;

    try {
      if (action === 'tools') {
        const data = await withSpinner('Listing MCP tools', ctx.options.quiet, () => ctx.client.mcp.tools());
        printData(data, ctx.options.raw);
      } else if (action === 'call') {
        const { tool, argsJson } = await inquirer.prompt<{ tool: string; argsJson: string }>([
          { type: 'input', name: 'tool', message: 'Tool name:' },
          { type: 'input', name: 'argsJson', message: 'Args JSON object:', default: '{}' },
        ]);
        const data = await withSpinner('Calling MCP tool', ctx.options.quiet, () =>
          ctx.client.mcp.call(tool, parseJson(argsJson, 'argsJson')),
        );
        printData(data, ctx.options.raw);
      }
    } catch (error) {
      handleCliError(error);
    }
  }
};

const runInteractive = async (ctx: CliContext): Promise<void> => {
  await renderStartupBanner({
    enabled: ctx.options.banner,
    animated: ctx.options.animatedBanner,
    theme: {
      name: ACTIVE_THEME.name,
      accent: ACTIVE_THEME.accent,
      accentSoft: ACTIVE_THEME.accentSoft,
      muted: ACTIVE_THEME.muted,
      borderColor: ACTIVE_THEME.borderColor,
      bannerBorderStyle: ACTIVE_THEME.bannerBorderStyle,
      gradientStops: ACTIVE_THEME.gradientStops,
    },
  });
  printRule();

  await withEscToExit('Interactive mode', async () => {
    while (true) {
      printPromptHint();

      const { action } = await inquirer.prompt<{ action: string }>([
        {
          type: 'list',
          name: 'action',
          message: chalk.cyanBright('Choose action'),
          pageSize: 16,
          choices: [
            { name: 'Doctor / Health checks', value: 'doctor' },
            { name: 'Wallet: Create', value: 'wallet-create' },
            { name: 'Wallet: Get balance', value: 'wallet-balance' },
            { name: 'Agent: Create', value: 'agent-create' },
            { name: 'Agent: List', value: 'agent-list' },
            { name: 'Agent: Execute intent', value: 'agent-exec' },
            { name: 'Transaction Wizard', value: 'tx-wizard' },
            { name: 'Policy Wizard', value: 'policy-wizard' },
            { name: 'Risk Wizard', value: 'risk-wizard' },
            { name: 'Strategy Wizard', value: 'strategy-wizard' },
            { name: 'Treasury Wizard', value: 'treasury-wizard' },
            { name: 'MCP Wizard', value: 'mcp-wizard' },
            { name: 'Observability: Metrics', value: 'metrics' },
            { name: 'Exit', value: 'exit' },
          ],
        },
      ]);

      if (action === 'exit') {
        printSuccess('Session closed');
        return;
      }

      try {
        if (action === 'doctor') {
          await doctor(ctx);
        } else if (action === 'wallet-create') {
          const { label, autoFund, fundLamports } = await inquirer.prompt<{
            label: string;
            autoFund: boolean;
            fundLamports?: string;
          }>([
            { type: 'input', name: 'label', message: 'Wallet label (optional):' },
            { type: 'confirm', name: 'autoFund', message: 'Auto-fund on create (devnet only)?', default: false },
            {
              type: 'input',
              name: 'fundLamports',
              message: 'Funding lamports (optional):',
              when: (answers: { autoFund?: boolean }) => Boolean(answers.autoFund),
            },
          ]);
          const parsedLamports = parseOptionalNumber(fundLamports);
          const data = await withSpinner('Creating wallet', ctx.options.quiet, () =>
            ctx.client.wallet.create({
              ...(label ? { label } : {}),
              ...(autoFund ? { autoFund: true } : {}),
              ...(parsedLamports !== undefined ? { fundLamports: parsedLamports } : {}),
            }),
          );
          printData(data, ctx.options.raw);
        } else if (action === 'wallet-balance') {
          const { walletId } = await inquirer.prompt<{ walletId: string }>([
            { type: 'input', name: 'walletId', message: 'Wallet ID:' },
          ]);
          const data = await withSpinner('Fetching balance', ctx.options.quiet, () =>
            ctx.client.wallet.getBalance(walletId),
          );
          printData(data, ctx.options.raw);
        } else if (action === 'agent-create') {
          const answers = await inquirer.prompt<{
            name: string;
            mode: 'autonomous' | 'supervised';
            intentsCsv: string;
            walletId?: string;
          }>([
            { type: 'input', name: 'name', message: 'Agent name:' },
            {
              type: 'list',
              name: 'mode',
              message: 'Execution mode:',
              choices: ['autonomous', 'supervised'],
              default: 'autonomous',
            },
            {
              type: 'input',
              name: 'intentsCsv',
              message: 'Allowed intents (comma separated):',
              default: 'query_balance,transfer_sol',
            },
            { type: 'input', name: 'walletId', message: 'Wallet ID (optional):' },
          ]);

          const data = await withSpinner('Creating agent', ctx.options.quiet, () =>
            ctx.client.agent.create({
              name: answers.name,
              executionMode: answers.mode,
              allowedIntents: parseCsv(answers.intentsCsv) as unknown as any,
              ...(answers.walletId ? { walletId: answers.walletId } : {}),
            }),
          );
          printData(data, ctx.options.raw);
        } else if (action === 'agent-list') {
          const data = await withSpinner('Listing agents', ctx.options.quiet, () => ctx.client.agent.list());
          printData(data, ctx.options.raw);
        } else if (action === 'agent-exec') {
          const answers = await inquirer.prompt<{
            agentId: string;
            type: string;
            protocol: string;
            intentJson: string;
            gasless: boolean;
          }>([
            { type: 'input', name: 'agentId', message: 'Agent ID:' },
            {
              type: 'list',
              name: 'type',
              message: 'Intent type:',
              choices: KNOWN_INTENTS,
              default: 'query_balance',
            },
            {
              type: 'list',
              name: 'protocol',
              message: 'Protocol:',
              choices: KNOWN_PROTOCOLS,
              default: 'system-program',
            },
            {
              type: 'input',
              name: 'intentJson',
              message: 'Intent JSON object:',
              default: '{}',
            },
            {
              type: 'confirm',
              name: 'gasless',
              message: 'Gasless via Kora?',
              default: false,
            },
          ]);

          const intent = parseJson(answers.intentJson, 'intentJson');

          const data = await withSpinner('Executing intent', ctx.options.quiet, () =>
            ctx.client.agent.execute(answers.agentId, {
              type: answers.type as any,
              protocol: answers.protocol,
              intent,
              gasless: answers.gasless,
            }),
          );
          printData(data, ctx.options.raw);
        } else if (action === 'tx-wizard') {
          await runTxWizard(ctx);
        } else if (action === 'policy-wizard') {
          await runPolicyWizard(ctx);
        } else if (action === 'risk-wizard') {
          await runRiskWizard(ctx);
        } else if (action === 'strategy-wizard') {
          await runStrategyWizard(ctx);
        } else if (action === 'treasury-wizard') {
          await runTreasuryWizard(ctx);
        } else if (action === 'mcp-wizard') {
          await runMcpWizard(ctx);
        } else if (action === 'metrics') {
          const data = await withSpinner('Loading metrics', ctx.options.quiet, () =>
            ctx.client.audit.metrics(),
          );
          printData(data, ctx.options.raw);
        }
      } catch (error) {
        handleCliError(error);
      }
    }
  });
};

program
  .name('aw')
  .description('Agentic Wallet CLI')
  .option('--api <url>', 'API base URL', DEFAULT_API)
  .option('--key <apiKey>', 'Gateway API key', DEFAULT_KEY)
  .option('--tenant <tenantId>', 'Optional tenant ID', DEFAULT_TENANT)
  .option('--theme <name>', 'Theme (midnight|matrix|solarized|fire)', DEFAULT_THEME)
  .option('--banner', 'Show startup banner', DEFAULT_BANNER)
  .option('--animated-banner', 'Play animated startup banner', DEFAULT_ANIMATED_BANNER)
  .option('--raw', 'Output raw JSON')
  .option('-q, --quiet', 'Quiet mode (less spinner noise)');

program.addHelpText(
  'after',
  `
Examples:
  $ aw doctor
  $ aw wallet create trader-1
  $ aw agent create arb-bot --intents transfer_sol swap query_balance
  $ aw --animated-banner interactive
  $ aw agent exec <agentId> --type query_balance --protocol system-program --intent '{}'
  $ aw tx create --wallet-id <walletId> --type transfer_sol --protocol system-program --intent '{"destination":"...","lamports":1000000}'
  $ aw protocol list
  $ aw interactive
`,
);

program.command('doctor').description('Run health checks against gateway and service backends').action(commandAction(async (ctx) => {
  await doctor(ctx);
}));

program.command('config').description('Print active CLI configuration').action(commandAction(async (ctx) => {
  printData(
    {
      api: ctx.options.api,
      key: ctx.options.key ? `${ctx.options.key.slice(0, 4)}…` : '',
      tenant: ctx.options.tenant ?? '',
      theme: ctx.options.theme,
      banner: ctx.options.banner,
      animatedBanner: ctx.options.animatedBanner,
      raw: ctx.options.raw,
      quiet: ctx.options.quiet,
    },
    ctx.options.raw,
  );
}));

const wallet = program.command('wallet').alias('w').description('Wallet operations');

wallet.command('create [label]')
  .description('Create wallet')
  .option('--auto-fund', 'Auto-fund on create (devnet only)')
  .option('--fund-lamports <lamports>', 'Auto-funding amount in lamports')
  .action(commandAction(async (
    ctx,
    label?: string,
    options?: { autoFund?: boolean; fundLamports?: string },
  ) => {
  const fundLamports = parseOptionalNumber(options?.fundLamports);
  const data = await withSpinner('Creating wallet', ctx.options.quiet, () =>
    ctx.client.wallet.create({
      ...(label ? { label } : {}),
      ...(options?.autoFund ? { autoFund: true } : {}),
      ...(fundLamports !== undefined ? { fundLamports } : {}),
    }),
  );
  printData(data, ctx.options.raw);
}));

wallet.command('get <walletId>').description('Get wallet metadata').action(commandAction(async (ctx, walletId: string) => {
  const data = await withSpinner('Fetching wallet', ctx.options.quiet, () => ctx.client.wallet.get(walletId));
  printData(data, ctx.options.raw);
}));

wallet.command('balance <walletId>').description('Get SOL balance').action(commandAction(async (ctx, walletId: string) => {
  const data = await withSpinner('Fetching balance', ctx.options.quiet, () => ctx.client.wallet.getBalance(walletId));
  printData(data, ctx.options.raw);
}));

wallet.command('tokens <walletId>').description('Get SPL token balances').action(commandAction(async (ctx, walletId: string) => {
  const data = await withSpinner('Fetching token balances', ctx.options.quiet, () => ctx.client.wallet.getTokens(walletId));
  printData(data, ctx.options.raw);
}));

const agent = program.command('agent').alias('a').description('Agent operations');

agent
  .command('create <name>')
  .description('Create agent')
  .option('--wallet-id <walletId>', 'Attach existing wallet')
  .option('--mode <mode>', 'Execution mode (autonomous|supervised)', 'autonomous')
  .option('--intents <intents...>', 'Allowed intents', ['query_balance'])
  .action(commandAction(async (ctx, name: string, options: { walletId?: string; mode: string; intents: string[] }) => {
    const data = await withSpinner('Creating agent', ctx.options.quiet, () =>
      ctx.client.agent.create({
        name,
        executionMode: options.mode as 'autonomous' | 'supervised',
        allowedIntents: options.intents as any,
        ...(options.walletId ? { walletId: options.walletId } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

agent.command('list').description('List agents').action(commandAction(async (ctx) => {
  const data = await withSpinner('Listing agents', ctx.options.quiet, () => ctx.client.agent.list());
  printData(data, ctx.options.raw);
}));

agent.command('get <agentId>').description('Get agent details').action(commandAction(async (ctx, agentId: string) => {
  const data = await withSpinner('Fetching agent', ctx.options.quiet, () => ctx.client.agent.get(agentId));
  printData(data, ctx.options.raw);
}));

agent.command('start <agentId>').description('Start agent').action(commandAction(async (ctx, agentId: string) => {
  const data = await withSpinner('Starting agent', ctx.options.quiet, () => ctx.client.agent.start(agentId));
  printData(data, ctx.options.raw);
}));

agent.command('stop <agentId>').description('Stop agent').action(commandAction(async (ctx, agentId: string) => {
  const data = await withSpinner('Stopping agent', ctx.options.quiet, () => ctx.client.agent.stop(agentId));
  printData(data, ctx.options.raw);
}));

agent
  .command('pause <agentId>')
  .description('Pause agent')
  .option('--reason <reason>', 'Pause reason')
  .action(commandAction(async (ctx, agentId: string, options: { reason?: string }) => {
    const data = await withSpinner('Pausing agent', ctx.options.quiet, () =>
      ctx.client.agent.pause(agentId, options.reason),
    );
    printData(data, ctx.options.raw);
  }));

agent.command('resume <agentId>').description('Resume agent').action(commandAction(async (ctx, agentId: string) => {
  const data = await withSpinner('Resuming agent', ctx.options.quiet, () => ctx.client.agent.resume(agentId));
  printData(data, ctx.options.raw);
}));

agent.command('budget <agentId>').description('Get agent budget').action(commandAction(async (ctx, agentId: string) => {
  const data = await withSpinner('Fetching budget', ctx.options.quiet, () => ctx.client.agent.budget(agentId));
  printData(data, ctx.options.raw);
}));

agent
  .command('caps-set <agentId>')
  .description('Update agent capability set')
  .requiredOption('--intents <intents...>', 'Allowed intents')
  .option('--mode <mode>', 'Execution mode (autonomous|supervised)')
  .option('--autonomy <json>', 'Autonomy config JSON object')
  .action(commandAction(async (
    ctx,
    agentId: string,
    options: { intents: string[]; mode?: 'autonomous' | 'supervised'; autonomy?: string },
  ) => {
    const data = await withSpinner('Updating capabilities', ctx.options.quiet, () =>
      ctx.client.agent.updateCapabilities(agentId, {
        allowedIntents: options.intents as any,
        ...(options.mode ? { executionMode: options.mode } : {}),
        ...(options.autonomy ? { autonomy: parseJson(options.autonomy, 'autonomy') as any } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

agent
  .command('manifest-issue <agentId>')
  .description('Issue signed capability manifest')
  .requiredOption('--intents <intents...>', 'Allowed intents')
  .requiredOption('--protocols <protocols...>', 'Allowed protocols')
  .option('--ttl <seconds>', 'Manifest ttl seconds')
  .action(commandAction(async (
    ctx,
    agentId: string,
    options: { intents: string[]; protocols: string[]; ttl?: string },
  ) => {
    const data = await withSpinner('Issuing manifest', ctx.options.quiet, () =>
      ctx.client.agent.issueManifest(agentId, {
        allowedIntents: options.intents as any,
        allowedProtocols: options.protocols,
        ...(options.ttl ? { ttlSeconds: Number(options.ttl) } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

agent
  .command('manifest-verify <agentId>')
  .description('Verify capability manifest')
  .option('--manifest <json>', 'Manifest JSON object')
  .option('--manifest-file <path>', 'Read manifest JSON object from file')
  .action(commandAction(async (
    ctx,
    agentId: string,
    options: { manifest?: string; manifestFile?: string },
  ) => {
    const fromFile = await maybeReadJsonFile(options.manifestFile);
    const fromOption = options.manifest ? parseJson(options.manifest, 'manifest') : undefined;
    const manifest = fromFile ?? fromOption;

    const data = await withSpinner('Verifying manifest', ctx.options.quiet, () =>
      ctx.client.agent.verifyManifest(agentId, manifest ? { manifest } : undefined),
    );

    printData(data, ctx.options.raw);
  }));

agent
  .command('exec <agentId>')
  .description('Execute one intent via an agent')
  .requiredOption('--type <intentType>', 'Intent type')
  .requiredOption('--protocol <protocol>', 'Protocol name')
  .option('--intent <json>', 'Intent JSON object', '{}')
  .option('--intent-file <path>', 'Read intent object from file')
  .option('--gasless', 'Use gasless Kora mode')
  .action(commandAction(async (
    ctx,
    agentId: string,
    options: { type: string; protocol: string; intent: string; intentFile?: string; gasless?: boolean },
  ) => {
    const fromFile = await maybeReadJsonFile(options.intentFile);
    const intent = fromFile ?? parseJson(options.intent, 'intent');

    const data = await withSpinner('Executing intent', ctx.options.quiet, () =>
      ctx.client.agent.execute(agentId, {
        type: options.type as any,
        protocol: options.protocol,
        intent,
        gasless: Boolean(options.gasless),
      }),
    );

    printData(data, ctx.options.raw);
  }));

agent.command('shell <agentId>').description('Interactive execution shell for one agent').action(commandAction(async (ctx, agentId: string) => {
  printSuccess(`Interactive agent shell: ${agentId}`);

  await withEscToExit('Agent shell', async () => {
    while (true) {
      printPromptHint();

      const answers = await inquirer.prompt<{
        intentType: string;
        protocol: string;
        intentJson: string;
        gasless: boolean;
        again: boolean;
      }>([
        {
          type: 'list',
          name: 'intentType',
          message: 'Intent type',
          choices: KNOWN_INTENTS,
          default: 'query_balance',
        },
        {
          type: 'list',
          name: 'protocol',
          message: 'Protocol',
          choices: KNOWN_PROTOCOLS,
          default: 'system-program',
        },
        {
          type: 'input',
          name: 'intentJson',
          message: 'Intent JSON',
          default: '{}',
        },
        {
          type: 'confirm',
          name: 'gasless',
          message: 'Gasless mode?',
          default: false,
        },
      ]);

      const result = await withSpinner('Executing', ctx.options.quiet, () =>
        ctx.client.agent.execute(agentId, {
          type: answers.intentType as any,
          protocol: answers.protocol,
          intent: parseJson(answers.intentJson, 'intentJson'),
          gasless: answers.gasless,
        }),
      );

      printData(result, ctx.options.raw);

      const { again } = await inquirer.prompt<{ again: boolean }>([
        {
          type: 'confirm',
          name: 'again',
          message: 'Execute another intent?',
          default: true,
        },
      ]);

      if (!again) return;
    }
  });
}));

const tx = program.command('tx').alias('t').description('Transaction operations');

tx
  .command('create')
  .description('Create transaction from typed intent')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .requiredOption('--type <intentType>', 'Transaction/intent type')
  .requiredOption('--protocol <protocol>', 'Protocol name')
  .option('--agent-id <agentId>', 'Optional agent ID')
  .option('--intent <json>', 'Intent JSON object', '{}')
  .option('--intent-file <path>', 'Read intent object from file')
  .option('--gasless', 'Use gasless Kora mode')
  .option('--idempotency-key <key>', 'Optional idempotency key')
  .action(commandAction(async (
    ctx,
    options: {
      walletId: string;
      type: string;
      protocol: string;
      agentId?: string;
      intent: string;
      intentFile?: string;
      gasless?: boolean;
      idempotencyKey?: string;
    },
  ) => {
    const fromFile = await maybeReadJsonFile(options.intentFile);
    const intent = fromFile ?? parseJson(options.intent, 'intent');

    const data = await withSpinner('Creating transaction', ctx.options.quiet, () =>
      ctx.client.transaction.create({
        walletId: options.walletId,
        type: options.type as any,
        protocol: options.protocol,
        intent,
        ...(options.agentId ? { agentId: options.agentId } : {}),
        gasless: Boolean(options.gasless),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

tx.command('get <txId>').description('Get transaction').action(commandAction(async (ctx, txId: string) => {
  const data = await withSpinner('Fetching transaction', ctx.options.quiet, () => ctx.client.transaction.get(txId));
  printData(data, ctx.options.raw);
}));

tx.command('proof <txId>').description('Get execution proof').action(commandAction(async (ctx, txId: string) => {
  const data = await withSpinner('Fetching proof', ctx.options.quiet, () => ctx.client.transaction.getProof(txId));
  printData(data, ctx.options.raw);
}));

tx.command('replay <txId>').description('Replay transaction deterministically').action(commandAction(async (ctx, txId: string) => {
  const data = await withSpinner('Replaying transaction', ctx.options.quiet, () => ctx.client.transaction.replay(txId));
  printData(data, ctx.options.raw);
}));

tx.command('retry <txId>').description('Retry transaction').action(commandAction(async (ctx, txId: string) => {
  const data = await withSpinner('Retrying transaction', ctx.options.quiet, () => ctx.client.transaction.retry(txId));
  printData(data, ctx.options.raw);
}));

tx.command('approve <txId>').description('Approve pending transaction').action(commandAction(async (ctx, txId: string) => {
  const data = await withSpinner('Approving transaction', ctx.options.quiet, () => ctx.client.transaction.approve(txId));
  printData(data, ctx.options.raw);
}));

tx.command('reject <txId>').description('Reject pending transaction').action(commandAction(async (ctx, txId: string) => {
  const data = await withSpinner('Rejecting transaction', ctx.options.quiet, () => ctx.client.transaction.reject(txId));
  printData(data, ctx.options.raw);
}));

tx
  .command('list')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .description('List wallet transactions')
  .action(commandAction(async (ctx, options: { walletId: string }) => {
    const data = await withSpinner('Listing transactions', ctx.options.quiet, () =>
      ctx.client.transaction.listByWallet(options.walletId),
    );
    printData(data, ctx.options.raw);
  }));

tx
  .command('pending')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .description('List pending approvals for wallet')
  .action(commandAction(async (ctx, options: { walletId: string }) => {
    const data = await withSpinner('Listing approvals', ctx.options.quiet, () =>
      ctx.client.transaction.listPendingApprovals(options.walletId),
    );
    printData(data, ctx.options.raw);
  }));

tx
  .command('positions')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .description('List protocol positions for wallet')
  .action(commandAction(async (ctx, options: { walletId: string }) => {
    const data = await withSpinner('Listing positions', ctx.options.quiet, () =>
      ctx.client.transaction.listPositions(options.walletId),
    );
    printData(data, ctx.options.raw);
  }));

tx
  .command('escrows')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .description('List escrow records for wallet')
  .action(commandAction(async (ctx, options: { walletId: string }) => {
    const data = await withSpinner('Listing escrows', ctx.options.quiet, () =>
      ctx.client.transaction.listEscrows(options.walletId),
    );
    printData(data, ctx.options.raw);
  }));

const policy = program.command('policy').alias('p').description('Policy operations');

policy
  .command('create')
  .description('Create policy')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .requiredOption('--name <name>', 'Policy name')
  .requiredOption('--rules <jsonArray>', 'Policy rules JSON array')
  .option('--active <bool>', 'Active flag (true|false)', 'true')
  .action(commandAction(async (
    ctx,
    options: { walletId: string; name: string; rules: string; active: string },
  ) => {
    const rules = parseJsonArray(options.rules, 'rules');
    const data = await withSpinner('Creating policy', ctx.options.quiet, () =>
      ctx.client.policy.create({
        walletId: options.walletId,
        name: options.name,
        active: parseBoolean(options.active),
        rules: rules as any,
      }),
    );
    printData(data, ctx.options.raw);
  }));

policy
  .command('list')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .description('List wallet policies')
  .action(commandAction(async (ctx, options: { walletId: string }) => {
    const data = await withSpinner('Listing policies', ctx.options.quiet, () =>
      ctx.client.policy.list(options.walletId),
    );
    printData(data, ctx.options.raw);
  }));

policy
  .command('versions <policyId>')
  .description('List policy versions')
  .action(commandAction(async (ctx, policyId: string) => {
    const data = await withSpinner('Fetching policy versions', ctx.options.quiet, () =>
      ctx.client.policy.listVersions(policyId),
    );
    printData(data, ctx.options.raw);
  }));

policy
  .command('version <policyId>')
  .description('Get one policy version')
  .requiredOption('--number <version>', 'Version number')
  .action(commandAction(async (
    ctx,
    policyId: string,
    options: { number: string },
  ) => {
    const data = await withSpinner('Fetching policy version', ctx.options.quiet, () =>
      ctx.client.policy.getVersion(policyId, Number(options.number)),
    );
    printData(data, ctx.options.raw);
  }));

policy
  .command('migrate <policyId>')
  .description('Migrate policy to target version')
  .requiredOption('--target-version <version>', 'Target version number')
  .option('--mode <mode>', 'Migration mode')
  .action(commandAction(async (
    ctx,
    policyId: string,
    options: { targetVersion: string; mode?: string },
  ) => {
    const data = await withSpinner('Migrating policy', ctx.options.quiet, () =>
      ctx.client.policy.migrate(policyId, {
        targetVersion: Number(options.targetVersion),
        ...(options.mode ? { mode: options.mode } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

policy
  .command('compatibility-check')
  .description('Check policy rules compatibility')
  .requiredOption('--rules <jsonArray>', 'Rules JSON array')
  .action(commandAction(async (
    ctx,
    options: { rules: string },
  ) => {
    const data = await withSpinner('Checking compatibility', ctx.options.quiet, () =>
      ctx.client.policy.compatibilityCheck({
        rules: parseJsonArray(options.rules, 'rules'),
      }),
    );
    printData(data, ctx.options.raw);
  }));

policy
  .command('evaluate')
  .description('Evaluate one hypothetical request against active wallet policy')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .requiredOption('--type <type>', 'Intent type')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .option('--destination <address>', 'Destination address')
  .option('--token-mint <mint>', 'Token mint')
  .option('--amount-lamports <lamports>', 'Amount in lamports')
  .option('--slippage-bps <bps>', 'Slippage bps')
  .option('--program-ids <csv>', 'Program IDs comma separated')
  .action(commandAction(async (
    ctx,
    options: {
      walletId: string;
      type: string;
      protocol: string;
      destination?: string;
      tokenMint?: string;
      amountLamports?: string;
      slippageBps?: string;
      programIds?: string;
    },
  ) => {
    const data = await withSpinner('Evaluating policy', ctx.options.quiet, () =>
      ctx.client.policy.evaluate({
        walletId: options.walletId,
        type: options.type,
        protocol: options.protocol,
        ...(options.destination ? { destination: options.destination } : {}),
        ...(options.tokenMint ? { tokenMint: options.tokenMint } : {}),
        ...(options.amountLamports ? { amountLamports: Number(options.amountLamports) } : {}),
        ...(options.slippageBps ? { slippageBps: Number(options.slippageBps) } : {}),
        ...(options.programIds ? { programIds: parseCsv(options.programIds) } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

const risk = program.command('risk').description('Risk operations');

risk.command('protocols').description('List protocol risk profiles').action(commandAction(async (ctx) => {
  const data = await withSpinner('Listing protocol risk', ctx.options.quiet, () => ctx.client.risk.listProtocols());
  printData(data, ctx.options.raw);
}));

risk.command('protocol-get <protocol>').description('Get protocol risk profile').action(commandAction(async (ctx, protocolName: string) => {
  const data = await withSpinner('Fetching protocol risk', ctx.options.quiet, () =>
    ctx.client.risk.getProtocol(protocolName),
  );
  printData(data, ctx.options.raw);
}));

risk
  .command('protocol-set <protocol>')
  .description('Set protocol risk profile')
  .requiredOption('--input <json>', 'Risk profile JSON object')
  .action(commandAction(async (
    ctx,
    protocolName: string,
    options: { input: string },
  ) => {
    const data = await withSpinner('Updating protocol risk', ctx.options.quiet, () =>
      ctx.client.risk.setProtocol(protocolName, parseJson(options.input, 'input')),
    );
    printData(data, ctx.options.raw);
  }));

risk.command('portfolio').description('List portfolio risk controls').action(commandAction(async (ctx) => {
  const data = await withSpinner('Listing portfolio controls', ctx.options.quiet, () =>
    ctx.client.risk.listPortfolioControls(),
  );
  printData(data, ctx.options.raw);
}));

risk.command('portfolio-get <walletId>').description('Get portfolio risk controls').action(commandAction(async (ctx, walletId: string) => {
  const data = await withSpinner('Fetching portfolio controls', ctx.options.quiet, () =>
    ctx.client.risk.getPortfolioControls(walletId),
  );
  printData(data, ctx.options.raw);
}));

risk
  .command('portfolio-set <walletId>')
  .description('Set portfolio risk controls')
  .requiredOption('--input <json>', 'Portfolio controls JSON object')
  .action(commandAction(async (
    ctx,
    walletId: string,
    options: { input: string },
  ) => {
    const data = await withSpinner('Updating portfolio controls', ctx.options.quiet, () =>
      ctx.client.risk.setPortfolioControls(walletId, parseJson(options.input, 'input')),
    );
    printData(data, ctx.options.raw);
  }));

risk.command('chaos').description('Get chaos switchboard').action(commandAction(async (ctx) => {
  const data = await withSpinner('Fetching chaos config', ctx.options.quiet, () => ctx.client.risk.getChaos());
  printData(data, ctx.options.raw);
}));

risk
  .command('chaos-set')
  .description('Set chaos switchboard values')
  .option('--enabled <bool>', 'Enable chaos mode')
  .option('--failure-rates <json>', 'Failure rates JSON object')
  .option('--latency-ms <ms>', 'Injected latency in ms')
  .action(commandAction(async (
    ctx,
    options: { enabled?: string; failureRates?: string; latencyMs?: string },
  ) => {
    const input: { enabled?: boolean; failureRates?: Record<string, number>; latencyMs?: number } = {};
    if (options.enabled !== undefined) {
      input.enabled = parseBoolean(options.enabled);
    }
    if (options.failureRates) {
      input.failureRates = parseJson(options.failureRates, 'failure-rates') as Record<string, number>;
    }
    if (options.latencyMs) {
      input.latencyMs = Number(options.latencyMs);
    }

    const data = await withSpinner('Updating chaos config', ctx.options.quiet, () => ctx.client.risk.setChaos(input));
    printData(data, ctx.options.raw);
  }));

const protocol = program.command('protocol').alias('proto').description('Protocol adapter operations');

protocol.command('list').description('List registered protocols').action(commandAction(async (ctx) => {
  const data = await withSpinner('Listing protocols', ctx.options.quiet, () => ctx.client.protocol.list());
  printData(data, ctx.options.raw);
}));

protocol.command('caps <protocol>').description('Get protocol capabilities').action(commandAction(async (ctx, protocolName: string) => {
  const data = await withSpinner('Fetching capabilities', ctx.options.quiet, () =>
    ctx.client.protocol.capabilities(protocolName),
  );
  printData(data, ctx.options.raw);
}));

protocol
  .command('quote')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .requiredOption('--input-mint <mint>', 'Input mint')
  .requiredOption('--output-mint <mint>', 'Output mint')
  .requiredOption('--amount <amount>', 'Input amount (raw units)')
  .requiredOption('--wallet <walletAddress>', 'Wallet public key')
  .option('--slippage-bps <bps>', 'Slippage bps', '50')
  .description('Get swap quote')
  .action(commandAction(async (
    ctx,
    options: {
      protocol: string;
      inputMint: string;
      outputMint: string;
      amount: string;
      wallet: string;
      slippageBps: string;
    },
  ) => {
    const data = await withSpinner('Fetching quote', ctx.options.quiet, () =>
      ctx.client.protocol.quote({
        protocol: options.protocol,
        inputMint: options.inputMint,
        outputMint: options.outputMint,
        amount: options.amount,
        walletAddress: options.wallet,
        slippageBps: Number(options.slippageBps),
      }),
    );
    printData(data, ctx.options.raw);
  }));

protocol
  .command('swap')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .requiredOption('--input-mint <mint>', 'Input mint')
  .requiredOption('--output-mint <mint>', 'Output mint')
  .requiredOption('--amount <amount>', 'Input amount')
  .requiredOption('--wallet <walletAddress>', 'Wallet public key')
  .option('--slippage-bps <bps>', 'Slippage bps', '50')
  .description('Build swap instructions/transaction')
  .action(commandAction(async (
    ctx,
    options: {
      protocol: string;
      inputMint: string;
      outputMint: string;
      amount: string;
      wallet: string;
      slippageBps: string;
    },
  ) => {
    const data = await withSpinner('Building swap', ctx.options.quiet, () =>
      ctx.client.protocol.swap({
        protocol: options.protocol,
        inputMint: options.inputMint,
        outputMint: options.outputMint,
        amount: options.amount,
        walletAddress: options.wallet,
        slippageBps: Number(options.slippageBps),
      }),
    );
    printData(data, ctx.options.raw);
  }));

protocol
  .command('stake')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .requiredOption('--wallet <walletAddress>', 'Wallet public key')
  .requiredOption('--amount <amount>', 'Amount')
  .option('--validator <validator>', 'Optional validator')
  .description('Build stake instructions')
  .action(commandAction(async (
    ctx,
    options: { protocol: string; wallet: string; amount: string; validator?: string },
  ) => {
    const data = await withSpinner('Building stake action', ctx.options.quiet, () =>
      ctx.client.protocol.stake({
        protocol: options.protocol,
        walletAddress: options.wallet,
        amount: options.amount,
        ...(options.validator ? { validator: options.validator } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

protocol
  .command('unstake')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .requiredOption('--wallet <walletAddress>', 'Wallet public key')
  .requiredOption('--amount <amount>', 'Amount')
  .option('--validator <validator>', 'Optional validator')
  .description('Build unstake instructions')
  .action(commandAction(async (
    ctx,
    options: { protocol: string; wallet: string; amount: string; validator?: string },
  ) => {
    const data = await withSpinner('Building unstake action', ctx.options.quiet, () =>
      ctx.client.protocol.unstake({
        protocol: options.protocol,
        walletAddress: options.wallet,
        amount: options.amount,
        ...(options.validator ? { validator: options.validator } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

protocol
  .command('lend-supply')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .requiredOption('--wallet <walletAddress>', 'Wallet public key')
  .requiredOption('--mint <mint>', 'Token mint')
  .requiredOption('--amount <amount>', 'Amount')
  .description('Build lending supply action')
  .action(commandAction(async (
    ctx,
    options: { protocol: string; wallet: string; mint: string; amount: string },
  ) => {
    const data = await withSpinner('Building lend supply action', ctx.options.quiet, () =>
      ctx.client.protocol.lendSupply({
        protocol: options.protocol,
        walletAddress: options.wallet,
        mint: options.mint,
        amount: options.amount,
      }),
    );
    printData(data, ctx.options.raw);
  }));

protocol
  .command('lend-borrow')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .requiredOption('--wallet <walletAddress>', 'Wallet public key')
  .requiredOption('--mint <mint>', 'Token mint')
  .requiredOption('--amount <amount>', 'Amount')
  .description('Build lending borrow action')
  .action(commandAction(async (
    ctx,
    options: { protocol: string; wallet: string; mint: string; amount: string },
  ) => {
    const data = await withSpinner('Building lend borrow action', ctx.options.quiet, () =>
      ctx.client.protocol.lendBorrow({
        protocol: options.protocol,
        walletAddress: options.wallet,
        mint: options.mint,
        amount: options.amount,
      }),
    );
    printData(data, ctx.options.raw);
  }));

protocol
  .command('escrow-create')
  .requiredOption('--wallet <walletAddress>', 'Wallet public key')
  .option('--protocol <protocol>', 'Protocol', 'escrow')
  .option('--intent <json>', 'Intent JSON object', '{}')
  .description('Build escrow create action')
  .action(commandAction(async (
    ctx,
    options: { wallet: string; protocol: string; intent: string },
  ) => {
    const data = await withSpinner('Building escrow create action', ctx.options.quiet, () =>
      ctx.client.protocol.escrowCreate({
        protocol: options.protocol,
        walletAddress: options.wallet,
        intent: parseJson(options.intent, 'intent'),
      }),
    );
    printData(data, ctx.options.raw);
  }));

const registerEscrowCommand = (name: string, runner: (escrowId: string, input: {
  protocol?: string;
  walletAddress: string;
  intent?: Record<string, unknown>;
}, ctx: CliContext) => Promise<Record<string, unknown>>) => {
  protocol
    .command(name)
    .requiredOption('--id <escrowId>', 'Escrow ID')
    .requiredOption('--wallet <walletAddress>', 'Wallet public key')
    .option('--protocol <protocol>', 'Protocol', 'escrow')
    .option('--intent <json>', 'Intent JSON object', '{}')
    .action(commandAction(async (
      ctx,
      options: { id: string; wallet: string; protocol: string; intent: string },
    ) => {
      const data = await withSpinner(`Building ${name}`, ctx.options.quiet, () =>
        runner(options.id, {
          protocol: options.protocol,
          walletAddress: options.wallet,
          intent: parseJson(options.intent, 'intent'),
        }, ctx),
      );
      printData(data, ctx.options.raw);
    }));
};

registerEscrowCommand('escrow-accept', (id, input, ctx) => ctx.client.protocol.escrowAccept(id, input));
registerEscrowCommand('escrow-release', (id, input, ctx) => ctx.client.protocol.escrowRelease(id, input));
registerEscrowCommand('escrow-refund', (id, input, ctx) => ctx.client.protocol.escrowRefund(id, input));
registerEscrowCommand('escrow-dispute', (id, input, ctx) => ctx.client.protocol.escrowDispute(id, input));
registerEscrowCommand('escrow-resolve', (id, input, ctx) => ctx.client.protocol.escrowResolve(id, input));

const strategy = program.command('strategy').alias('strat').description('Strategy operations');

strategy
  .command('backtest')
  .description('Run strategy backtest')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .requiredOption('--name <name>', 'Strategy name')
  .requiredOption('--steps <jsonArray>', 'Backtest steps JSON array')
  .option('--minimum-pass-rate <rate>', 'Minimum pass rate')
  .action(commandAction(async (
    ctx,
    options: { walletId: string; name: string; steps: string; minimumPassRate?: string },
  ) => {
    const data = await withSpinner('Running backtest', ctx.options.quiet, () =>
      ctx.client.strategy.backtest({
        walletId: options.walletId,
        name: options.name,
        steps: parseJsonArray(options.steps, 'steps') as any,
        ...(options.minimumPassRate ? { minimumPassRate: Number(options.minimumPassRate) } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

strategy
  .command('paper-execute')
  .description('Execute paper trade step')
  .requiredOption('--agent-id <agentId>', 'Agent ID')
  .requiredOption('--wallet-id <walletId>', 'Wallet ID')
  .requiredOption('--type <intentType>', 'Intent type')
  .requiredOption('--protocol <protocol>', 'Protocol')
  .option('--intent <json>', 'Intent JSON object', '{}')
  .option('--intent-file <path>', 'Read intent JSON object from file')
  .action(commandAction(async (
    ctx,
    options: {
      agentId: string;
      walletId: string;
      type: string;
      protocol: string;
      intent: string;
      intentFile?: string;
    },
  ) => {
    const fromFile = await maybeReadJsonFile(options.intentFile);
    const intent = fromFile ?? parseJson(options.intent, 'intent');
    const data = await withSpinner('Executing paper trade', ctx.options.quiet, () =>
      ctx.client.strategy.paperExecute({
        agentId: options.agentId,
        walletId: options.walletId,
        type: options.type as any,
        protocol: options.protocol,
        intent,
      }),
    );
    printData(data, ctx.options.raw);
  }));

strategy.command('paper-list <agentId>').description('List paper ledger for agent').action(commandAction(async (ctx, agentId: string) => {
  const data = await withSpinner('Fetching paper ledger', ctx.options.quiet, () =>
    ctx.client.strategy.paperList(agentId),
  );
  printData(data, ctx.options.raw);
}));

const treasury = program.command('treasury').description('Treasury operations');

treasury
  .command('allocate')
  .description('Allocate budget to agent')
  .requiredOption('--target-agent-id <agentId>', 'Target agent ID')
  .requiredOption('--lamports <lamports>', 'Amount in lamports')
  .option('--source-agent-id <agentId>', 'Optional source agent ID')
  .option('--reason <reason>', 'Optional reason')
  .action(commandAction(async (
    ctx,
    options: {
      targetAgentId: string;
      lamports: string;
      sourceAgentId?: string;
      reason?: string;
    },
  ) => {
    const data = await withSpinner('Allocating treasury', ctx.options.quiet, () =>
      ctx.client.treasury.allocate({
        targetAgentId: options.targetAgentId,
        lamports: Number(options.lamports),
        ...(options.sourceAgentId ? { sourceAgentId: options.sourceAgentId } : {}),
        ...(options.reason ? { reason: options.reason } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

treasury
  .command('rebalance')
  .description('Rebalance budget between agents')
  .requiredOption('--source-agent-id <agentId>', 'Source agent ID')
  .requiredOption('--target-agent-id <agentId>', 'Target agent ID')
  .requiredOption('--lamports <lamports>', 'Amount in lamports')
  .option('--reason <reason>', 'Optional reason')
  .action(commandAction(async (
    ctx,
    options: { sourceAgentId: string; targetAgentId: string; lamports: string; reason?: string },
  ) => {
    const data = await withSpinner('Rebalancing treasury', ctx.options.quiet, () =>
      ctx.client.treasury.rebalance({
        sourceAgentId: options.sourceAgentId,
        targetAgentId: options.targetAgentId,
        lamports: Number(options.lamports),
        ...(options.reason ? { reason: options.reason } : {}),
      }),
    );
    printData(data, ctx.options.raw);
  }));

const mcp = program.command('mcp').description('MCP operations');

mcp.command('tools').description('List MCP tools').action(commandAction(async (ctx) => {
  const data = await withSpinner('Listing MCP tools', ctx.options.quiet, () => ctx.client.mcp.tools());
  printData(data, ctx.options.raw);
}));

mcp
  .command('call <tool>')
  .description('Invoke MCP tool')
  .option('--args <json>', 'Tool args JSON object', '{}')
  .option('--args-file <path>', 'Read tool args JSON object from file')
  .action(commandAction(async (
    ctx,
    tool: string,
    options: { args: string; argsFile?: string },
  ) => {
    const fromFile = await maybeReadJsonFile(options.argsFile);
    const args = fromFile ?? parseJson(options.args, 'args');
    const data = await withSpinner('Calling MCP tool', ctx.options.quiet, () => ctx.client.mcp.call(tool, args));
    printData(data, ctx.options.raw);
  }));

const audit = program.command('audit').description('Audit/metrics operations');

audit
  .command('events')
  .option('--tx-id <txId>', 'Filter by txId')
  .option('--agent-id <agentId>', 'Filter by agentId')
  .option('--wallet-id <walletId>', 'Filter by walletId')
  .option('--protocol <protocol>', 'Filter by protocol')
  .option('--escrow-id <escrowId>', 'Filter by escrowId')
  .description('List audit events')
  .action(commandAction(async (
    ctx,
    options: {
      txId?: string;
      agentId?: string;
      walletId?: string;
      protocol?: string;
      escrowId?: string;
    },
  ) => {
    const data = await withSpinner('Fetching audit events', ctx.options.quiet, () =>
      ctx.client.audit.listEvents({
        ...(options.txId ? { txId: options.txId } : {}),
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(options.walletId ? { walletId: options.walletId } : {}),
        ...(options.protocol ? { protocol: options.protocol } : {}),
        ...(options.escrowId ? { escrowId: options.escrowId } : {}),
      }),
    );

    printData(data, ctx.options.raw);
  }));

audit.command('metrics').description('Read metrics snapshot').action(commandAction(async (ctx) => {
  const data = await withSpinner('Fetching metrics', ctx.options.quiet, () => ctx.client.audit.metrics());
  printData(data, ctx.options.raw);
}));

program.command('interactive').alias('i').description('Launch interactive mode').action(commandAction(async (ctx) => {
  await runInteractive(ctx);
}));

const run = async (): Promise<void> => {
  const hasHelpOrVersionFlag = process.argv.some((arg) =>
    ['-h', '--help', '-V', '--version'].includes(arg),
  );
  if (hasHelpOrVersionFlag) {
    await program.parseAsync(process.argv);
    return;
  }

  const { operands, unknown } = program.parseOptions(process.argv.slice(2));
  if (operands.length === 0 && unknown.length === 0) {
    // No explicit command supplied: run interactive by default and honor any global flags.
    await program.parseAsync([...process.argv.slice(0, 2), ...process.argv.slice(2), 'interactive']);
    return;
  }

  await program.parseAsync(process.argv);
};

run().catch((error) => {
  handleCliError(error);
});
