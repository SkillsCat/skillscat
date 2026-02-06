import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const existingHome = process.env.SKILLSCAT_TEST_HOME;
const testHome = existingHome || mkdtempSync(join(tmpdir(), 'skillscat-cli-'));

process.env.SKILLSCAT_TEST_HOME = testHome;
process.env.HOME = testHome;
process.env.XDG_CONFIG_HOME = testHome;
process.env.NO_COLOR = '1';
process.env.SKILLSCAT_TEST_REGISTRY_URL = process.env.SKILLSCAT_TEST_REGISTRY_URL || 'http://localhost:3000/registry';

const workspace = join(testHome, 'workspace');
mkdirSync(workspace, { recursive: true });
process.chdir(workspace);
process.env.SKILLSCAT_TEST_WORKSPACE = workspace;
