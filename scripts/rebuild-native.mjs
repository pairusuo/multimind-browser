import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronVersion = require('electron/package.json').version;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const result = spawnSync(npmCommand, [
  'rebuild',
  'better-sqlite3',
  '--runtime=electron',
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers',
], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
