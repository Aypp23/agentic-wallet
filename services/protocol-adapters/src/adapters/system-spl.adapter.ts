import type { ProtocolAdapter } from './adapter.interface.js';

export const createSystemAdapter = (): ProtocolAdapter => ({
  name: 'system-program',
  version: '1.0.0',
  programIds: ['11111111111111111111111111111111'],
  capabilities: ['transfer_sol'],
});

export const createSplTokenAdapter = (): ProtocolAdapter => ({
  name: 'spl-token',
  version: '1.0.0',
  programIds: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'],
  capabilities: ['transfer_spl', 'create_mint', 'mint_token'],
});
