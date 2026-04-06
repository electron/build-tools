import * as cp from 'node:child_process';
import * as path from 'node:path';

export function refreshPathVariable(): void {
  if (process.platform === 'win32') {
    const file = path.resolve(__dirname, 'get-path.bat');
    const output = cp.execFileSync(file, { shell: true });
    process.env['PATH'] = output.toString();
  }
}
