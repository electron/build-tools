const readlineSync = require('readline-sync');
const { color } = require('./logging');

const maybeAutoFix = (fn, err) => {
  // If we're running in CI we can't prompt the user
  if (process.env.CI) throw err;
  if (!process.stdin.isTTY) throw err;
  console.error(color.warn, 'A fixable error has occurred');
  console.error('-->', err.message);
  if (!readlineSync.keyInYN(`Do you want build-tools to try fix this for you?`)) throw err;
  console.log('');
  fn();
};

module.exports = {
  maybeAutoFix,
};
