import readlineSync from 'readline-sync';

import { color } from './logging.js';

export const maybeAutoFix = (fn: () => void, err: Error) => {
  if (process.env.ELECTRON_BUILD_TOOLS_AUTO_FIX) return fn();
  // If we're running in CI we can't prompt the user
  if (process.env.CI) throw err;
  if (!process.stdin.isTTY) throw err;
  console.error(color.warn, 'A fixable error has occurred');
  console.error('-->', err.message);
  if (!readlineSync.keyInYN(`Do you want build-tools to try fix this for you?`)) throw err;
  console.log('');
  fn();
};
