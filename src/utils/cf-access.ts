import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import nacl from 'tweetnacl';
import open from 'open';
import debug from 'debug';

import { color } from './logging.js';

const d = debug('build-tools:cf-access');

// Ported from cloudflare/cloudflared's `token` package so we can complete the
// Cloudflare Access browser-login "dance" ourselves without shelling out to the
// `cloudflared` binary. See:
//   https://github.com/cloudflare/cloudflared/blob/master/token/token.go
//   https://github.com/cloudflare/cloudflared/blob/master/token/transfer.go

const ACCESS_LOGIN_WORKER_PATH = '/cdn-cgi/access/login';
/** Cloudflare's hosted login-helper / token-transfer service. */
const TRANSFER_STORE_URL = 'https://login.cloudflareaccess.org/';
/** Header the CF edge consumes and converts into `cf-access-jwt-assertion`. */
export const CF_ACCESS_TOKEN_HEADER = 'Cf-Access-Token';

const USER_AGENT = 'electron-build-tools';
/** Per-poll timeout. The transfer service long-polls, holding the request
 *  open until the user finishes login or it times out server-side. */
const POLL_TIMEOUT_MS = 60_000;
const POLL_ATTEMPTS = 12;

export interface AppInfo {
  /** The Access team domain, e.g. `electronjs.cloudflareaccess.com`. */
  authDomain: string;
  /** The AUD tag of the Access application fronting the service. */
  appAUD: string;
  /** The application hostname, e.g. `agents.electronjs.org`. Used for the
   *  on-disk token cache filename (kept compatible with cloudflared's). */
  appDomain: string;
}

/** `~/.cloudflared` — shared with the cloudflared binary so a token either of
 *  us fetches is reusable by the other. Created lazily with 0700 perms. */
function configDir(): string {
  const dir = path.join(os.homedir(), '.cloudflared');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

function appTokenPath(appInfo: AppInfo): string {
  const name = `${appInfo.appDomain}-${appInfo.appAUD}-token`
    .replace(/\//g, '-')
    .replace(/\*/g, '-');
  return path.join(configDir(), name);
}

/** Standard (padded) base64url, matching Go's `base64.URLEncoding`. */
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

interface JwtPayload {
  exp?: number;
  email?: string;
}

function decodeJwtPayload(jwt: string): JwtPayload | null {
  const parts = jwt.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
}

function isExpired(jwt: string): boolean {
  const payload = decodeJwtPayload(jwt);
  if (!payload?.exp) return true;
  return Math.floor(Date.now() / 1000) >= payload.exp;
}

/**
 * Discover the Access application fronting `appURL` by issuing a HEAD request
 * and inspecting the redirect to the login worker. Mirrors
 * `token.GetAppInfo`.
 */
export async function getAppInfo(appURL: URL): Promise<AppInfo> {
  // First hop: the edge 302s an unauthenticated request to the team's login
  // worker, whose URL carries the AUD as the `kid` query param.
  const res = await fetch(appURL.toString(), {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'User-Agent': USER_AGENT },
  });

  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) {
    const loginURL = new URL(location);
    if (loginURL.pathname.includes(ACCESS_LOGIN_WORKER_PATH)) {
      const aud = loginURL.searchParams.get('kid');
      if (!aud) throw new Error('Access login redirect did not contain an app AUD (kid)');
      return {
        authDomain: loginURL.hostname,
        appAUD: aud,
        // CF-Access-Domain is the app hostname; derive it directly rather than
        // chasing it through a second redirect hop.
        appDomain: appURL.hostname,
      };
    }
  }

  // A 401/403 carries the AUD in a header instead of a redirect.
  const audHeader = res.headers.get('cf-access-aud');
  if (audHeader) {
    const domain = res.headers.get('cf-access-domain') || appURL.hostname;
    return { authDomain: domain, appAUD: audHeader, appDomain: appURL.hostname };
  }

  throw new Error(
    `No Cloudflare Access application found in front of ${appURL.origin} (status ${res.status}). ` +
      `Is the service reachable and Access-protected?`,
  );
}

function readCachedToken(appInfo: AppInfo): string | null {
  const tokenPath = appTokenPath(appInfo);
  let content: string;
  try {
    content = fs.readFileSync(tokenPath, 'utf8').trim();
  } catch {
    return null;
  }
  if (!content) return null;
  if (isExpired(content)) {
    d('cached token at %s is expired; discarding', tokenPath);
    try {
      fs.rmSync(tokenPath);
    } catch {
      /* best effort */
    }
    return null;
  }
  return content;
}

function writeCachedToken(appInfo: AppInfo, token: string): void {
  fs.writeFileSync(appTokenPath(appInfo), token, { mode: 0o600 });
}

/**
 * Build the `cdn-cgi/access/cli` URL the browser is sent to. Mirrors
 * `token.buildRequestURL` with `useHostOnly` + `cli` + `autoClose` all set.
 */
function buildLoginURL(appURL: URL, appAUD: string, publicKey: string): string {
  const host = appURL.hostname;
  // The value CF redirects the browser to after a successful login. It carries
  // our public key (as `token`) and the AUD so the login worker knows which
  // app + transfer slot to post the encrypted token to.
  const redirectURL = new URL(`https://${host}`);
  redirectURL.searchParams.set('aud', appAUD);
  redirectURL.searchParams.set('token', publicKey);

  const cli = new URL(`https://${host}/cdn-cgi/access/cli`);
  cli.searchParams.set('aud', appAUD);
  cli.searchParams.set('token', publicKey);
  cli.searchParams.set('redirect_url', redirectURL.toString());
  cli.searchParams.set('send_org_token', 'true');
  cli.searchParams.set('edge_token_transfer', 'true');
  cli.searchParams.set('close_interstitial', 'true');
  return cli.toString();
}

interface TransferResponse {
  app_token?: string;
  org_token?: string;
}

/** One long-poll of the transfer store. Resolves to the decrypted token JSON,
 *  or null if the resource isn't ready yet (user hasn't finished logging in). */
async function pollTransfer(
  url: string,
  encrypter: { secretKey: Uint8Array },
): Promise<TransferResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 500) {
    throw new Error(`Transfer service error ${res.status}: ${await res.text()}`);
  }
  if (res.status !== 200) {
    // Not ready yet — the user still needs to complete the browser login.
    return null;
  }

  const senderPublicKey = res.headers.get('service-public-key');
  if (!senderPublicKey) throw new Error('Transfer response missing service-public-key header');

  // Body is base64(nonce[24] || box) per token/transfer.go + token/encrypt.go.
  const wire = new Uint8Array(Buffer.from((await res.text()).trim(), 'base64'));
  const nonce = wire.slice(0, 24);
  const ciphertext = wire.slice(24);
  const opened = nacl.box.open(
    ciphertext,
    nonce,
    new Uint8Array(Buffer.from(senderPublicKey, 'base64url')),
    encrypter.secretKey,
  );
  if (!opened) throw new Error('Failed to decrypt transfer payload');
  return JSON.parse(Buffer.from(opened).toString('utf8')) as TransferResponse;
}

/**
 * Run the browser-login transfer flow: generate an ephemeral NaCl keypair,
 * open the Access login page, then long-poll the transfer service for the
 * encrypted token and decrypt it. Mirrors `token.RunTransfer`.
 */
async function runTransfer(appURL: URL, appAUD: string): Promise<string> {
  const keypair = nacl.box.keyPair();
  const publicKey = base64url(keypair.publicKey);

  const loginURL = buildLoginURL(appURL, appAUD, publicKey);
  const transferURL = `${TRANSFER_STORE_URL}transfer/${publicKey}`;

  console.error(`${color.info} Opening your browser to log in to ${color.path(appURL.origin)}`);
  console.error(`${color.info} If it doesn't open, visit this URL manually:\n\n  ${loginURL}\n`);
  await open(loginURL).catch(() => {
    /* best effort — message above tells them how to open it manually */
  });

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const resp = await pollTransfer(transferURL, keypair);
    if (resp?.app_token) {
      return resp.app_token;
    }
    console.error(`${color.info} Waiting for you to finish logging in...`);
  }
  throw new Error('Timed out waiting for Cloudflare Access login to complete');
}

/**
 * Return a valid Cloudflare Access application token for `appURL`, either from
 * the on-disk cache or by running the interactive browser-login flow. The
 * token is sent to the service in the `Cf-Access-Token` header.
 */
export async function getAccessToken(
  appURL: URL,
  opts: { forceRefresh?: boolean } = {},
): Promise<string> {
  const appInfo = await getAppInfo(appURL);

  if (!opts.forceRefresh) {
    const cached = readCachedToken(appInfo);
    if (cached) {
      d('using cached Access token for %s', appInfo.appDomain);
      return cached;
    }
  }

  const token = await runTransfer(appURL, appInfo.appAUD);
  writeCachedToken(appInfo, token);
  console.error(`${color.success} Authenticated with Cloudflare Access`);
  return token;
}

/** Drop any cached token for `appURL` (used after a 401 to force re-login). */
export async function clearCachedToken(appURL: URL): Promise<void> {
  try {
    const appInfo = await getAppInfo(appURL);
    fs.rmSync(appTokenPath(appInfo), { force: true });
  } catch {
    /* best effort */
  }
}

/**
 * True when `res` is Cloudflare Access turning us away (expired/invalid token)
 * rather than a legitimate application response. That's either a 401 from the
 * origin or an edge redirect to the Access login page — as distinct from, say,
 * the artifact-download endpoint's 302 to a signed blob URL.
 */
export function isAccessChallenge(res: Response): boolean {
  if (res.status === 401) return true;
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') ?? '';
    return (
      location.includes('.cloudflareaccess.com') || location.includes(ACCESS_LOGIN_WORKER_PATH)
    );
  }
  return false;
}

/**
 * A thin fetch wrapper that attaches the Access token and, on an Access
 * challenge, transparently re-authenticates once and retries. Redirects are
 * surfaced to the caller (`redirect: 'manual'`) so legitimate ones — like the
 * artifact download's 302 to signed storage — can be handled explicitly.
 */
export class AccessClient {
  private constructor(
    private readonly appURL: URL,
    private token: string,
  ) {}

  static async create(appURL: URL): Promise<AccessClient> {
    return new AccessClient(appURL, await getAccessToken(appURL));
  }

  async request(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = /^https?:\/\//.test(pathOrUrl)
      ? pathOrUrl
      : new URL(pathOrUrl, this.appURL).toString();

    const send = () =>
      fetch(url, {
        redirect: 'manual',
        ...init,
        headers: {
          ...init.headers,
          'User-Agent': USER_AGENT,
          [CF_ACCESS_TOKEN_HEADER]: this.token,
        },
      });

    let res = await send();
    if (isAccessChallenge(res)) {
      d('Access challenge on %s; refreshing token', url);
      this.token = await getAccessToken(this.appURL, { forceRefresh: true });
      res = await send();
    }
    return res;
  }
}
