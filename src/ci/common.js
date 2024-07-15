const { Option } = require('commander');

// TODO(codebytere): add support for GitHub Actions.
const BuildTypes = {
  APPVEYOR: 'APPVEYOR',
};

const ArchTypes = {
  ia32: 'electron-ia32-testing',
  x64: 'electron-x64-testing',
  woa: 'electron-woa-testing',
};

const archOption = new Option(
  '-a, --arch <arch>',
  'The arch of the build to rerun (required for AppVeyor)',
).choices(['ia32', 'x64', 'woa']);

module.exports = {
  ArchTypes,
  archOption,
  BuildTypes,
};
