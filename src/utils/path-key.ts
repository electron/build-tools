/**
 * Returns the name of the PATH environment variable on the current platform.
 * On Windows, env var names are case-insensitive but the actual casing varies,
 * so we locate the real key from process.env.
 */
export function pathKey(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform !== 'win32') return 'PATH';
  return (
    Object.keys(env)
      .reverse()
      .find((key) => key.toUpperCase() === 'PATH') ?? 'Path'
  );
}
