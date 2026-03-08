import type {
  Agent,
  AutonomousConfig,
  CreateAgentRequest,
  CreatePolicyRequest,
  CreateTransactionRequest,
  ExecuteAgentIntentRequest,
  Policy,
  PolicyDecision,
  TransactionType,
  WalletMetadata,
} from '@agentic-wallet/common';

interface JsonData<T> {
  data: T;
}

interface StableEnvelope<T> extends Partial<JsonData<T>> {
  status?: 'success' | 'failure';
  error?: string;
  errorMessage?: string;
  errorCode?: string | null;
  failedAt?: string | null;
  traceId?: string;
}

const request = async <T>(
  baseUrl: string,
  defaultHeaders: HeadersInit,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(defaultHeaders ?? {}),
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await res.json().catch(() => ({}))) as StableEnvelope<T>;

  const failedByEnvelope = payload.status === 'failure';
  if (!res.ok || failedByEnvelope) {
    const message = payload.errorMessage ?? payload.error ?? `Request failed (${res.status})`;
    const codePart = payload.errorCode ? ` code=${payload.errorCode}` : '';
    const stagePart = payload.failedAt ? ` stage=${payload.failedAt}` : '';
    const tracePart = payload.traceId ? ` traceId=${payload.traceId}` : '';
    throw new Error(`${message}${codePart}${stagePart}${tracePart}`);
  }

  return payload.data as T;
};

export interface WalletClient {
  create(input?: { label?: string; autoFund?: boolean; fundLamports?: number }): Promise<WalletMetadata>;
  list(input?: { publicKey?: string }): Promise<WalletMetadata[]>;
  findByPublicKey(publicKey: string): Promise<WalletMetadata | null>;
  get(walletId: string): Promise<WalletMetadata>;
  getBalance(walletId: string): Promise<{ walletId: string; publicKey: string; lamports: number; sol: number }>;
  getTokens(walletId: string): Promise<{ walletId: string; tokens: Array<{ mint: string; amount: string; decimals: number; uiAmount: number | null }> }>;
  signMessage(walletId: string, messageBase64: string): Promise<{ signatureBase64: string; signatureBase58: string }>;
  signTransaction(walletId: string, transactionBase64: string): Promise<{ signedTransaction: string; signature: string; txVersion: 'legacy' | 'v0' }>;
}

export interface PolicyClient {
  create(input: CreatePolicyRequest): Promise<Policy>;
  list(walletId: string): Promise<Policy[]>;
  listVersions(policyId: string): Promise<Policy[]>;
  getVersion(policyId: string, version: number): Promise<Policy>;
  migrate(policyId: string, input: { targetVersion: number; mode?: string }): Promise<Policy>;
  compatibilityCheck(input: { rules: unknown[] }): Promise<{ compatible: boolean; supportedRuleTypes: string[]; unsupportedRuleTypes: string[] }>;
  evaluate(input: {
    walletId: string;
    type: TransactionType | string;
    protocol: string;
    destination?: string;
    tokenMint?: string;
    amountLamports?: number;
    programIds?: string[];
    slippageBps?: number;
  }): Promise<PolicyDecision>;
}

export interface TransactionClient {
  create(input: CreateTransactionRequest & { intent?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  get(txId: string): Promise<Record<string, unknown>>;
  getProof(txId: string): Promise<Record<string, unknown>>;
  replay(txId: string): Promise<Record<string, unknown>>;
  retry(txId: string): Promise<Record<string, unknown>>;
  approve(txId: string): Promise<Record<string, unknown>>;
  reject(txId: string): Promise<Record<string, unknown>>;
  listByWallet(walletId: string): Promise<Record<string, unknown>[]>;
  listPendingApprovals(walletId: string): Promise<Record<string, unknown>[]>;
  listPositions(walletId: string): Promise<Record<string, unknown>[]>;
  listEscrows(walletId: string): Promise<Record<string, unknown>[]>;
}

export interface AgentClient {
  create(input: CreateAgentRequest): Promise<Agent>;
  list(): Promise<Agent[]>;
  get(agentId: string): Promise<Record<string, unknown>>;
  updateCapabilities(
    agentId: string,
    input: { allowedIntents: TransactionType[]; executionMode?: 'autonomous' | 'supervised'; autonomy?: AutonomousConfig },
  ): Promise<Agent>;
  start(agentId: string): Promise<Agent>;
  stop(agentId: string): Promise<Agent>;
  pause(agentId: string, reason?: string): Promise<Agent>;
  resume(agentId: string): Promise<Agent>;
  budget(agentId: string): Promise<Record<string, unknown> | null>;
  issueManifest(agentId: string, input: { allowedIntents: TransactionType[]; allowedProtocols: string[]; ttlSeconds?: number }): Promise<Record<string, unknown>>;
  verifyManifest(agentId: string, input?: { manifest: Record<string, unknown> }): Promise<{ ok: boolean; reason?: string }>;
  execute(agentId: string, input: ExecuteAgentIntentRequest): Promise<Record<string, unknown>>;
}

export interface RiskClient {
  listProtocols(): Promise<Record<string, unknown>[]>;
  getProtocol(protocol: string): Promise<Record<string, unknown>>;
  setProtocol(protocol: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  listPortfolioControls(): Promise<Record<string, unknown>[]>;
  getPortfolioControls(walletId: string): Promise<Record<string, unknown> | null>;
  setPortfolioControls(walletId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  getChaos(): Promise<Record<string, unknown>>;
  setChaos(input: { enabled?: boolean; failureRates?: Record<string, number>; latencyMs?: number }): Promise<Record<string, unknown>>;
}

export interface StrategyClient {
  backtest(input: {
    walletId: string;
    name: string;
    minimumPassRate?: number;
    steps: Array<{ type: TransactionType; protocol: string; intent?: Record<string, unknown>; timestamp: string; simulatedPnlLamports?: number }>;
  }): Promise<Record<string, unknown>>;
  paperExecute(input: { agentId: string; walletId: string; type: TransactionType; protocol: string; intent?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  paperList(agentId: string): Promise<Record<string, unknown>[]>;
}

export interface TreasuryClient {
  allocate(input: { sourceAgentId?: string; targetAgentId: string; lamports: number; reason?: string }): Promise<Record<string, unknown>>;
  rebalance(input: { sourceAgentId: string; targetAgentId: string; lamports: number; reason?: string }): Promise<Record<string, unknown>>;
}

export interface MpcClient {
  tools(): Promise<Array<{ name: string; description: string }>>;
  call(tool: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface ProtocolClient {
  list(): Promise<Array<{ protocol: string; capabilities: string[]; programIds: string[] }>>;
  capabilities(protocol: string): Promise<{ protocol: string; capabilities: string[]; programIds: string[] }>;
  quote(input: { protocol: string; inputMint: string; outputMint: string; amount: string; walletAddress: string; slippageBps?: number }): Promise<Record<string, unknown>>;
  swap(input: { protocol: string; inputMint: string; outputMint: string; amount: string; walletAddress: string; slippageBps?: number }): Promise<Record<string, unknown>>;
  stake(input: { protocol: string; walletAddress: string; amount: string; validator?: string }): Promise<Record<string, unknown>>;
  unstake(input: { protocol: string; walletAddress: string; amount: string; validator?: string }): Promise<Record<string, unknown>>;
  lendSupply(input: { protocol: string; walletAddress: string; mint: string; amount: string }): Promise<Record<string, unknown>>;
  lendBorrow(input: { protocol: string; walletAddress: string; mint: string; amount: string }): Promise<Record<string, unknown>>;
  escrowCreate(input: { protocol?: string; walletAddress: string; intent: Record<string, unknown> }): Promise<Record<string, unknown>>;
  escrowAccept(escrowId: string, input: { protocol?: string; walletAddress: string; intent?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  escrowRelease(escrowId: string, input: { protocol?: string; walletAddress: string; intent?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  escrowRefund(escrowId: string, input: { protocol?: string; walletAddress: string; intent?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  escrowDispute(escrowId: string, input: { protocol?: string; walletAddress: string; intent?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  escrowResolve(escrowId: string, input: { protocol?: string; walletAddress: string; intent?: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

export interface AuditClient {
  listEvents(query?: { txId?: string; agentId?: string; walletId?: string; protocol?: string; escrowId?: string }): Promise<Record<string, unknown>[]>;
  metrics(): Promise<Record<string, number>>;
}

export interface AgenticWalletClient {
  wallet: WalletClient;
  policy: PolicyClient;
  transaction: TransactionClient;
  agent: AgentClient;
  protocol: ProtocolClient;
  audit: AuditClient;
  risk: RiskClient;
  strategy: StrategyClient;
  treasury: TreasuryClient;
  mcp: MpcClient;
}

const toQuery = (params: Record<string, string | undefined>): string => {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }

  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
};

export const createAgenticWalletClient = (
  baseUrl: string,
  options?: { apiKey?: string; tenantId?: string; headers?: HeadersInit },
): AgenticWalletClient => {
  const defaultHeaders: HeadersInit = {
    ...(options?.headers ?? {}),
    ...(options?.apiKey ? { 'x-api-key': options.apiKey } : {}),
    ...(options?.tenantId ? { 'x-tenant-id': options.tenantId } : {}),
  };

  return {
    wallet: {
      create: (input) => request<WalletMetadata>(baseUrl, defaultHeaders, '/api/v1/wallets', { method: 'POST', body: JSON.stringify(input ?? {}) }),
      list: (input) =>
        request<WalletMetadata[]>(
          baseUrl,
          defaultHeaders,
          `/api/v1/wallets${toQuery({ publicKey: input?.publicKey })}`,
        ),
      findByPublicKey: async (publicKey) => {
        const wallets = await request<WalletMetadata[]>(
          baseUrl,
          defaultHeaders,
          `/api/v1/wallets${toQuery({ publicKey })}`,
        );
        return wallets[0] ?? null;
      },
      get: (walletId) => request<WalletMetadata>(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}`),
      getBalance: (walletId) => request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/balance`),
      getTokens: (walletId) => request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/tokens`),
      signMessage: (walletId, messageBase64) => request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/sign`, { method: 'POST', body: JSON.stringify({ message: messageBase64 }) }),
      signTransaction: (walletId, transactionBase64) =>
        request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/sign`, {
          method: 'POST',
          body: JSON.stringify({ transaction: transactionBase64 }),
        }),
    },

    policy: {
      create: (input) => request<Policy>(baseUrl, defaultHeaders, '/api/v1/policies', { method: 'POST', body: JSON.stringify(input) }),
      list: (walletId) => request<Policy[]>(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/policies`),
      listVersions: (policyId) => request<Policy[]>(baseUrl, defaultHeaders, `/api/v1/policies/${policyId}/versions`),
      getVersion: (policyId, version) => request<Policy>(baseUrl, defaultHeaders, `/api/v1/policies/${policyId}/versions/${version}`),
      migrate: (policyId, input) =>
        request<Policy>(baseUrl, defaultHeaders, `/api/v1/policies/${policyId}/migrate`, { method: 'POST', body: JSON.stringify(input) }),
      compatibilityCheck: (input) => request(baseUrl, defaultHeaders, '/api/v1/policies/compatibility-check', { method: 'POST', body: JSON.stringify(input) }),
      evaluate: (input) => request<PolicyDecision>(baseUrl, defaultHeaders, '/api/v1/evaluate', { method: 'POST', body: JSON.stringify(input) }),
    },

    transaction: {
      create: (input) => request(baseUrl, defaultHeaders, '/api/v1/transactions', { method: 'POST', body: JSON.stringify(input) }),
      get: (txId) => request(baseUrl, defaultHeaders, `/api/v1/transactions/${txId}`),
      getProof: (txId) => request(baseUrl, defaultHeaders, `/api/v1/transactions/${txId}/proof`),
      replay: (txId) => request(baseUrl, defaultHeaders, `/api/v1/transactions/${txId}/replay`),
      retry: (txId) => request(baseUrl, defaultHeaders, `/api/v1/transactions/${txId}/retry`, { method: 'POST' }),
      approve: (txId) => request(baseUrl, defaultHeaders, `/api/v1/transactions/${txId}/approve`, { method: 'POST' }),
      reject: (txId) => request(baseUrl, defaultHeaders, `/api/v1/transactions/${txId}/reject`, { method: 'POST' }),
      listByWallet: (walletId) => request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/transactions`),
      listPendingApprovals: (walletId) => request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/pending-approvals`),
      listPositions: (walletId) => request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/positions`),
      listEscrows: (walletId) => request(baseUrl, defaultHeaders, `/api/v1/wallets/${walletId}/escrows`),
    },

    agent: {
      create: (input) => request<Agent>(baseUrl, defaultHeaders, '/api/v1/agents', { method: 'POST', body: JSON.stringify(input) }),
      list: () => request<Agent[]>(baseUrl, defaultHeaders, '/api/v1/agents'),
      get: (agentId) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}`),
      updateCapabilities: (agentId, input) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/capabilities`, { method: 'PUT', body: JSON.stringify(input) }),
      start: (agentId) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/start`, { method: 'POST' }),
      stop: (agentId) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/stop`, { method: 'POST' }),
      pause: (agentId, reason) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/pause`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) }),
      resume: (agentId) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/resume`, { method: 'POST' }),
      budget: (agentId) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/budget`),
      issueManifest: (agentId, input) =>
        request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/manifest/issue`, { method: 'POST', body: JSON.stringify(input) }),
      verifyManifest: (agentId, input) =>
        request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/manifest/verify`, { method: 'POST', body: JSON.stringify(input ?? {}) }),
      execute: (agentId, input) => request(baseUrl, defaultHeaders, `/api/v1/agents/${agentId}/execute`, { method: 'POST', body: JSON.stringify(input) }),
    },

    protocol: {
      list: () => request(baseUrl, defaultHeaders, '/api/v1/protocols'),
      capabilities: (protocol) => request(baseUrl, defaultHeaders, `/api/v1/protocols/${protocol}/capabilities`),
      quote: (input) => request(baseUrl, defaultHeaders, '/api/v1/defi/quote', { method: 'POST', body: JSON.stringify(input) }),
      swap: (input) => request(baseUrl, defaultHeaders, '/api/v1/defi/swap', { method: 'POST', body: JSON.stringify(input) }),
      stake: (input) => request(baseUrl, defaultHeaders, '/api/v1/defi/stake', { method: 'POST', body: JSON.stringify(input) }),
      unstake: (input) => request(baseUrl, defaultHeaders, '/api/v1/defi/unstake', { method: 'POST', body: JSON.stringify(input) }),
      lendSupply: (input) => request(baseUrl, defaultHeaders, '/api/v1/defi/lend/supply', { method: 'POST', body: JSON.stringify(input) }),
      lendBorrow: (input) => request(baseUrl, defaultHeaders, '/api/v1/defi/lend/borrow', { method: 'POST', body: JSON.stringify(input) }),
      escrowCreate: (input) => request(baseUrl, defaultHeaders, '/api/v1/escrow/create', { method: 'POST', body: JSON.stringify(input) }),
      escrowAccept: (escrowId, input) => request(baseUrl, defaultHeaders, `/api/v1/escrow/${escrowId}/accept`, { method: 'POST', body: JSON.stringify(input) }),
      escrowRelease: (escrowId, input) => request(baseUrl, defaultHeaders, `/api/v1/escrow/${escrowId}/release`, { method: 'POST', body: JSON.stringify(input) }),
      escrowRefund: (escrowId, input) => request(baseUrl, defaultHeaders, `/api/v1/escrow/${escrowId}/refund`, { method: 'POST', body: JSON.stringify(input) }),
      escrowDispute: (escrowId, input) => request(baseUrl, defaultHeaders, `/api/v1/escrow/${escrowId}/dispute`, { method: 'POST', body: JSON.stringify(input) }),
      escrowResolve: (escrowId, input) => request(baseUrl, defaultHeaders, `/api/v1/escrow/${escrowId}/resolve`, { method: 'POST', body: JSON.stringify(input) }),
    },

    audit: {
      listEvents: (query) => request(baseUrl, defaultHeaders, `/api/v1/audit/events${toQuery({
        txId: query?.txId,
        agentId: query?.agentId,
        walletId: query?.walletId,
        protocol: query?.protocol,
        escrowId: query?.escrowId,
      })}`),
      metrics: () => request(baseUrl, defaultHeaders, '/api/v1/metrics'),
    },

    risk: {
      listProtocols: () => request(baseUrl, defaultHeaders, '/api/v1/risk/protocols'),
      getProtocol: (protocol) => request(baseUrl, defaultHeaders, `/api/v1/risk/protocols/${protocol}`),
      setProtocol: (protocol, input) =>
        request(baseUrl, defaultHeaders, `/api/v1/risk/protocols/${protocol}`, { method: 'PUT', body: JSON.stringify(input) }),
      listPortfolioControls: () => request(baseUrl, defaultHeaders, '/api/v1/risk/portfolio'),
      getPortfolioControls: (walletId) => request(baseUrl, defaultHeaders, `/api/v1/risk/portfolio/${walletId}`),
      setPortfolioControls: (walletId, input) =>
        request(baseUrl, defaultHeaders, `/api/v1/risk/portfolio/${walletId}`, { method: 'PUT', body: JSON.stringify(input) }),
      getChaos: () => request(baseUrl, defaultHeaders, '/api/v1/chaos'),
      setChaos: (input) => request(baseUrl, defaultHeaders, '/api/v1/chaos', { method: 'PUT', body: JSON.stringify(input) }),
    },

    strategy: {
      backtest: (input) => request(baseUrl, defaultHeaders, '/api/v1/strategy/backtest', { method: 'POST', body: JSON.stringify(input) }),
      paperExecute: (input) =>
        request(baseUrl, defaultHeaders, '/api/v1/strategy/paper/execute', { method: 'POST', body: JSON.stringify(input) }),
      paperList: (agentId) => request(baseUrl, defaultHeaders, `/api/v1/strategy/paper/${agentId}`),
    },

    treasury: {
      allocate: (input) => request(baseUrl, defaultHeaders, '/api/v1/treasury/allocate', { method: 'POST', body: JSON.stringify(input) }),
      rebalance: (input) => request(baseUrl, defaultHeaders, '/api/v1/treasury/rebalance', { method: 'POST', body: JSON.stringify(input) }),
    },

    mcp: {
      tools: () => request(baseUrl, defaultHeaders, '/mcp/tools'),
      call: (tool, args) =>
        request(baseUrl, defaultHeaders, '/mcp/call', {
          method: 'POST',
          body: JSON.stringify({ tool, args: args ?? {} }),
        }),
    },
  };
};
