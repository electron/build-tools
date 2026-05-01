import { z } from 'zod';

const gitUrl = z
  .union([z.url(), z.string().regex(/^git@.+$/)])
  .refine((s) => s.length > 0, { message: 'must not be empty' });

const electronRemotesSchema = z
  .strictObject({
    origin: gitUrl.describe('Origin remote'),
    fork: gitUrl.describe('Fork remote').optional(),
  })
  .describe('Remotes for the Electron repo');

const remotesSchema = z
  .strictObject({
    electron: electronRemotesSchema,
  })
  .describe('Remotes for Git checkouts');

const genSchema = z
  .strictObject({
    args: z.array(z.string().min(1)).describe('Extra arguments for GN'),
    out: z.string().min(1).describe('Output directory'),
  })
  .describe('Configuration for GN');

const envSchema = z
  .object({
    CHROMIUM_BUILDTOOLS_PATH: z
      .string()
      .min(1)
      .describe('Path of Chromium buildtools in the checkout')
      .optional(),
    GIT_CACHE_PATH: z.string().min(1).describe('Path to use as git cache for gclient').optional(),
  })
  .catchall(z.string())
  .describe('Environment variables set when building Electron');

const baseConfigShape = z.strictObject({
  $schema: z.string().meta({ format: 'uri-reference' }).optional(),
  defaultTarget: z
    .string()
    .describe('Default build target')
    .meta({ default: 'electron' })
    .optional(),
  preserveSDK: z
    .number()
    .int()
    .min(1)
    .describe('Preserve the N most recent Xcode SDK versions')
    .meta({ default: 5 })
    .optional(),
  execName: z
    .string()
    .min(1)
    .describe('Name of the built executable to run')
    .meta({ default: 'Electron' })
    .optional(),
  extends: z.string().min(1).describe('Name of base config to extend').optional(),
  remoteBuild: z
    .enum(['reclient', 'siso', 'none'])
    .describe('Whether to use remote builds and what system to use')
    .optional(),
  rbeHelperPath: z.string().describe('Path to alternative reclient credential helper').optional(),
  rbeServiceAddress: z.string().describe('Alternative RBE cluster address').optional(),
  root: z
    .string()
    .min(1)
    .describe('Path of the top directory. Home of the .gclient file')
    .optional(),
  remotes: remotesSchema.optional(),
  gen: genSchema.optional(),
  env: envSchema.optional(),
  configValidationLevel: z
    .enum(['strict', 'warn', 'none'])
    .describe('Validation level for this configuration')
    .meta({ default: 'strict' })
    .optional(),
});

// Mirrors the oneOf clause injected by gen-schema.ts — keep the two in sync.
export const evmConfigSchema = baseConfigShape
  .refine(
    (c) =>
      c.extends !== undefined ||
      (c.defaultTarget === 'chrome' && c.env && c.root) ||
      (c.root && c.remotes && c.gen && c.env),
    {
      message:
        'Config must either extend another config, target chrome with root+env, or define root+remotes+gen+env',
    },
  )
  .meta({ title: 'JSON schema for EVM configuration files' });

export type RemoteBuild = 'reclient' | 'siso' | 'none';
export type ConfigValidationLevel = 'strict' | 'warn' | 'none';
export type ElectronRemotes = z.infer<typeof electronRemotesSchema>;
export type Remotes = z.infer<typeof remotesSchema>;
export type GenConfig = z.infer<typeof genSchema>;
export type EnvConfig = z.infer<typeof envSchema>;

/** Raw config as loaded from disk. Legacy fields may be present before sanitization. */
export type EvmConfig = z.infer<typeof evmConfigSchema> & {
  // Legacy fields that get migrated during sanitization.
  preserveXcode?: number;
  onlySdk?: boolean;
  reclient?: string;
  reclientHelperPath?: string;
  reclientServiceAddress?: string;
};

/** A config after sanitization — certain optionals are guaranteed. */
export type SanitizedConfig = EvmConfig & {
  root: string;
  remotes: Remotes;
  gen: GenConfig;
  env: EnvConfig;
  preserveSDK: number;
  remoteBuild: RemoteBuild;
  configValidationLevel: ConfigValidationLevel;
};

export interface SpawnResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string | null;
  stderr: string | null;
  pid: number | undefined;
  output: [null, string, string] | null;
}
