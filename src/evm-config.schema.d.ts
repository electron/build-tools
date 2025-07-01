type EVMExtendsConfiguration = {
  extends: string;
} & Partial<EVMBaseElectronConfiguration>;

type EVMBaseElectronConfiguration = {
  $schema: string;
  root: string;
  remoteBuild: 'reclient' | 'siso' | 'none';

  defaultTarget?: string;
  preserveSDK?: number;
  execName?: string;

  rbeHelperPath?: string;
  rbeServiceAddress?: string;
  remotes?: {
    electron: {
      fork?: string;
      origin: string;
    };
  };
  gen: {
    args: string[];
    out: string;
  };
  env: {
    GIT_CACHE_PATH?: string;
    CHROMIUM_BUILDTOOLS_PATH: string;
    [k: string]: string | undefined;
  };
  configValidationLevel?: 'strict' | 'warn' | 'none';
};

export type EVMMaybeOutdatedBaseElectronConfiguration = EVMBaseElectronConfiguration & {
  preserveXcode?: number;
  onlySdk?: boolean;
  reclient?: 'remote_exec' | 'none';
  reclientHelperPath?: string;
  reclientServiceAddress?: string;
};

export type EVMConfigurationSchema = EVMBaseElectronConfiguration | EVMExtendsConfiguration;
export type EVMResolvedConfiguration = EVMBaseElectronConfiguration;
