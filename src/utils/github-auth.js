const { spawn } = require('child_process');
const { createOAuthDeviceAuth } = require('@octokit/auth-oauth-device');

const ELECTRON_BUILD_TOOLS_GITHUB_CLIENT_ID = '03581ca0d21228704ab3';

async function getGitHubAuthToken(scopes = []) {
  if (process.env.ELECTRON_BUILD_TOOLS_GH_AUTH) {
    return process.env.ELECTRON_BUILD_TOOLS_GH_AUTH;
  }

  try {
    const gh = spawn('gh', ['auth', 'status', '--show-token']);
    const done = new Promise((resolve, reject) => {
      gh.on('close', resolve);
      gh.on('error', reject);
    });
    const stderrChunks = [];
    gh.stderr.on('data', chunk => stderrChunks.push(chunk));
    const exitCode = await done;
    if (exitCode === 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const m = /Token: (.+)$/m.exec(stderr);
      if (m) {
        return m[1];
      }
    }
  } catch (e) {
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
