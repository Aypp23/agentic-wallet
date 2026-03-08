import { z } from 'zod';

export const walletIdSchema = z.string().uuid();

export const keyProvenanceSchema = z.object({
  backend: z.enum(['encrypted-file', 'memory', 'kms', 'hsm', 'mpc']),
  custody: z.enum(['local', 'external']),
  deterministicAddressing: z.boolean(),
});

export const walletMetadataSchema = z.object({
  id: walletIdSchema,
  publicKey: z.string().min(32),
  provider: z.enum(['local-dev', 'local-memory', 'hsm-ready', 'kms', 'hsm', 'mpc']),
  keyProvenance: keyProvenanceSchema.optional(),
  createdAt: z.string().datetime(),
  status: z.enum(['active', 'disabled']),
  label: z.string().min(1).max(128).optional(),
});

export const createWalletRequestSchema = z.object({
  label: z.string().min(1).max(128).optional(),
  autoFund: z.boolean().optional(),
  fundLamports: z.number().int().positive().max(10_000_000_000).optional(),
});

export const signWalletPayloadSchema = z
  .object({
    transaction: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  })
  .refine((data) => (data.transaction ? 1 : 0) + (data.message ? 1 : 0) === 1, {
    message: 'Provide exactly one of transaction or message',
  });

export type WalletMetadata = z.infer<typeof walletMetadataSchema>;
export type CreateWalletRequest = z.infer<typeof createWalletRequestSchema>;
export type SignWalletPayload = z.infer<typeof signWalletPayloadSchema>;
export type KeyProvenance = z.infer<typeof keyProvenanceSchema>;
