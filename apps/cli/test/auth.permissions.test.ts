import { beforeEach, describe, expect, it } from 'vitest';
import { statSync } from 'node:fs';
import { createWorkspace, resetTestConfigDir } from './helpers/env';

describe('auth permissions', () => {
  beforeEach(() => {
    createWorkspace('auth-permissions');
    resetTestConfigDir();
  });

  it('stores auth config with restricted filesystem permissions', async () => {
    if (process.platform === 'win32') {
      // POSIX mode assertions do not apply on Windows.
      return;
    }

    const { setToken } = await import('../src/utils/auth/auth');
    const { getAuthPath, getConfigDir } = await import('../src/utils/config/config');

    setToken('sk_test_cli_permissions');

    const authMode = statSync(getAuthPath()).mode & 0o777;
    const dirMode = statSync(getConfigDir()).mode & 0o777;

    // No group/other bits should be set.
    expect(authMode & 0o077).toBe(0);
    expect(dirMode & 0o077).toBe(0);
  });
});
