import { spawnSync } from 'node:child_process';

import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';

import { color } from './logging';

const ELECTRON_BUILD_TOOLS_GITHUB_CLIENT_ID = '03581ca0d21228704ab3';

function runGhCliCommand(args: string[]): string {
  const { error, status, stdout } = spawnSync('gh', args, { encoding: 'utf8' });

  if (status !== 0) {
    if (error) {
      throw error;
    } else {
      throw new Error(`gh cli exited with non-zero exit code: ${status}`);
    }
  }

  return stdout;
}

/**
 * Parse the scope list from `gh auth status` output. Exported for testing.
 * Returns null if the scope line couldn't be located.
 */
export function parseTokenScopes(authStatus: string): string[] | null {
  const regexMatch = authStatus.match(/^.*Token scopes: (.*)$/m);
  if (!regexMatch?.[1]) return null;
  return regexMatch[1].split(',').map((item) => item.trim().replace(/^'(.*)'$/, '$1'));
}

export async function getGitHubAuthToken(scopes: string[] = []): Promise<string> {
  const envToken = process.env['ELECTRON_BUILD_TOOLS_GH_AUTH'];
  if (envToken) {
    return envToken;
  }

  try {
    const authStatus = runGhCliCommand(['auth', 'status']);
    const tokenScopes = parseTokenScopes(authStatus);

    if (tokenScopes) {
      if (scopes.every((scope) => tokenScopes.includes(scope))) {
        return runGhCliCommand(['auth', 'token']).trim();
      } else {
        console.info(
          `${color.info} Token from gh CLI does not have required scopes, requesting new token`,
        );
      }
    } else {
      console.warn(`${color.warn} Could not determine token scopes from gh CLI`);
    }
  } catch (e) {
    if (e instanceof Error && (!('code' in e) || (e as NodeJS.ErrnoException).code !== 'ENOENT')) {
      console.error(`${color.err} ${e.stack ?? e.message}`);
    }
    // fall through to fetching the token through oauth
  }
  return createGitHubAuthToken(scopes);
}

export async function createGitHubAuthToken(scopes: string[] = []): Promise<string> {
  const auth = createOAuthDeviceAuth({
    clientType: 'oauth-app',
    clientId: ELECTRON_BUILD_TOOLS_GITHUB_CLIENT_ID,
    onVerification(verification) {
      console.error('This @electron/build-tools script requires GitHub Authentication');
      console.error('Open this page in your browser: %s', verification.verification_uri);
      console.error('Enter code: %s', verification.user_code);
    },
  });
  const { token } = await auth({
    type: 'oauth',
    scopes,
  });
  return token;
}
