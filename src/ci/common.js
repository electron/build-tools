const { Option } = require('commander');

const BuildTypes = {
  CIRCLECI: 'CIRCLECI',
  APPVEYOR: 'APPVEYOR',
};

const ArchTypes = {
  ia32: 'electron-ia32-testing',
  x64: 'electron-x64-testing',
  woa: 'electron-woa-testing',
};

// CircleCI workflow IDs have letters and numbers and contain dashes,
// while Appveyor Build IDs are all numbers.
const getCIType = id => {
  const isAppveyorID = !id.includes('-') && /^[0-9]+$/.test(id);
  return isAppveyorID ? BuildTypes.APPVEYOR : BuildTypes.CIRCLECI;
};

const archOption = new Option(
  '-a, --arch <arch>',
  'The arch of the build to rerun (required for AppVeyor)',
).choices(['ia32', 'x64', 'woa']);

module.exports = {
  ArchTypes,
  archOption,
  BuildTypes,
  getCIType,
};
