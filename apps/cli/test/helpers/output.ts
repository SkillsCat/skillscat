import { vi } from 'vitest';

export class ExitError extends Error {
  code: number;

  constructor(code: number) {
    super(`Process exited with code ${code}`);
    this.code = code;
  }
}

export function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-9;]*m/g, '');
}

export async function runCommand(fn: () => Promise<void> | void): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.join(' '));
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    warns.push(args.join(' '));
  });
  const stdoutWriteMock = ((..._args: Parameters<typeof process.stdout.write>) => true) as typeof process.stdout.write;
  const stderrWriteMock = ((..._args: Parameters<typeof process.stderr.write>) => true) as typeof process.stderr.write;
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(stdoutWriteMock);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(stderrWriteMock);

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as unknown as { mockRestore: () => void };

  let exitCode: number | null = null;

  try {
    await fn();
  } catch (err) {
    if (err instanceof ExitError) {
      exitCode = err.code;
    } else {
      throw err;
    }
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }

  const stdout = stripAnsi(logs.join('\n'));
  const stderr = stripAnsi([...errors, ...warns].join('\n'));

  return { stdout, stderr, exitCode };
}
