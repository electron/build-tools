import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { input } from '@inquirer/prompts';
import open from 'open';

import { color } from './logging.js';

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9222;
const REMOTE_DEBUG_URL = 'chrome://inspect/#remote-debugging';

// The server started by the "Allow remote debugging" checkbox does not expose
// the /json/* HTTP discovery endpoints, so probe liveness with a raw TCP
// connect and speak CDP over a fixed WebSocket path.
function isDebuggerListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: CDP_HOST, port: CDP_PORT });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitForDebugger(listening: boolean): Promise<void> {
  while ((await isDebuggerListening()) !== listening) {
    await sleep(500);
  }
}

function requestTerminalFocus(): void {
  if (!process.stdout.isTTY) return;
  // iTerm2 StealFocus OSC, xterm de-iconify + raise, then BEL as a fallback
  // attention cue. Unsupported terminals silently ignore unknown sequences.
  process.stdout.write('\x1b]1337;StealFocus\x07\x1b[1t\x1b[5t\x07');
}

type CDPCookie = { name: string; value: string; domain: string };

function fetchCookieViaCDP(host: string, name: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${CDP_HOST}:${CDP_PORT}/devtools/browser`);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
    });
    ws.addEventListener('message', (event) => {
      ws.close();
      try {
        const msg = JSON.parse(String(event.data)) as { result: { cookies: CDPCookie[] } };
        const match = msg.result.cookies.find(
          (c) => c.name === name && host.endsWith(c.domain.replace(/^\./, '')),
        );
        resolve(match?.value ?? null);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    ws.addEventListener('error', () => {
      reject(new Error(`Failed to connect to Chrome DevTools at ${CDP_HOST}:${CDP_PORT}`));
    });
  });
}

/**
 * Walk the user through temporarily enabling Chrome's remote debugger, grab the
 * requested cookie over CDP, then block until the debugger is disabled again.
 */
export async function borrowCookieViaCDP(host: string, name: string): Promise<string> {
  if (!process.stdin.isTTY && !(await isDebuggerListening())) {
    throw new Error(
      `Cannot borrow ${host} cookie: no TTY for the interactive remote-debugger flow and no debugger already listening on ${CDP_HOST}:${CDP_PORT}.`,
    );
  }

  if (await isDebuggerListening()) {
    console.log(
      `${color.info} Chrome's remote debugger is already enabled on ${CDP_HOST}:${CDP_PORT}; reading your ${host} session cookie.`,
    );
  } else {
    console.log(
      `${color.info} To read your ${host} session cookie, Chrome's remote debugger must be enabled.`,
    );
    console.log(
      `${color.info} In Chrome, navigate to ${color.cmd(REMOTE_DEBUG_URL)} and tick "Allow remote debugging".`,
    );
    await input({ message: 'Press enter to open Chrome' });

    const chromeApp =
      process.platform === 'darwin'
        ? 'google chrome'
        : process.platform === 'win32'
          ? 'chrome'
          : 'google-chrome';
    await open(REMOTE_DEBUG_URL, { app: chromeApp }).catch(() => {
      /* best effort — chrome:// URLs often cannot be opened externally */
    });

    process.stdout.write(
      `${color.info} Waiting for remote debugger on ${CDP_HOST}:${CDP_PORT}... `,
    );
    await waitForDebugger(true);
    process.stdout.write('connected.\n');
  }

  const value = await fetchCookieViaCDP(host, name);
  if (!value) {
    throw new Error(
      `No ${name} cookie found for ${host}. Make sure you are logged in using the Chrome profile that has remote debugging enabled.`,
    );
  }

  requestTerminalFocus();
  console.log(
    `${color.warn} Now go back to ${color.cmd(REMOTE_DEBUG_URL)} and untick "Allow remote debugging".`,
  );
  process.stdout.write(
    `${color.warn} For safety, this command will not continue until the debugger is disabled... `,
  );
  await waitForDebugger(false);
  process.stdout.write('done.\n');

  return value;
}
