export type ProtocolName =
  | 'system-program'
  | 'spl-token'
  | 'jupiter'
  | 'marinade'
  | 'solend'
  | 'metaplex'
  | 'orca'
  | 'raydium'
  | 'escrow';

export interface ProtocolCapability {
  protocol: ProtocolName;
  version: string;
  capabilities: string[];
  programIds: string[];
}
