const { spawnSync } = require('child_process');
const { createOAuthDeviceAuth } = require('@octokit/auth-oauth-device');

const { color } = require('./logging');

const ELECTRON_BUILD_TOOLS_GITHUB_CLIENT_ID = '03581ca0d21228704ab3';

function runGhCliCommand(args) {
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

async function getGitHubAuthToken(scopes = []) {
  if (process.env.ELECTRON_BUILD_TOOLS_GH_AUTH) {
    return process.env.ELECTRON_BUILD_TOOLS_GH_AUTH;
  }

  try {
    const authStatus = runGhCliCommand(['auth', 'status']);

    // Check that the scopes on the token include the requested scopes
    const regexMatch = authStatus.match(/^.*Token scopes: (.*)$/m);

    if (regexMatch) {
      const tokenScopes = regexMatch[1]
        .split(',')
        .map((item) => item.trim().replace(/^'(.*)'$/, '$1'));

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
    if (e instanceof Error && (!('code' in e) || e.code !== 'ENOENT')) {
      console.error(`${color.err} ${e.stack ? e.stack : e.message}`);
    }

    // fall through to fetching the token through oauth
  }
  return await createGitHubAuthToken(scopes);
}

async function createGitHubAuthToken(scopes = []) {
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

module.exports = {
  createGitHubAuthToken,
  getGitHubAuthToken,
};
