const { spawnSync } = require('child_process');
const { createOAuthDeviceAuth } = require('@octokit/auth-oauth-device');

const ELECTRON_BUILD_TOOLS_GITHUB_CLIENT_ID = '03581ca0d21228704ab3';

async function getGitHubAuthToken(scopes = []) {
  try {
    const { stdout } = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    return stdout.trim();
  } catch {
    // fall through to fetching the token through oauth
  }
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
  getGitHubAuthToken,
};
