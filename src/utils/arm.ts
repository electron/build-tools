import { execSync } from 'node:child_process';

// See https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment.
export const getIsArm = () => {
  try {
    const isCurrentlyTranslated = execSync('sysctl sysctl.proc_translated', { stdio: 'pipe' });

    return (
      process.arch === 'arm64' ||
      isCurrentlyTranslated.toString().startsWith('sysctl.proc_translated: 1')
    );
  } catch (e) {
    // On non-ARM macs `sysctl sysctl.proc_translated` throws with
    // sysctl: unknown oid 'sysctl.proc_translated'
    return false;
  }
};
