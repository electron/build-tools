import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const refreshPathVariable = () => {
  if (process.platform === 'win32') {
    const file = path.resolve(import.meta.dirname, '..', '..', 'src', 'utils', 'get-path.bat');
    const output = execFileSync(file, { shell: true });
    const pathOut = output.toString();
    process.env.PATH = pathOut;
  }
};
