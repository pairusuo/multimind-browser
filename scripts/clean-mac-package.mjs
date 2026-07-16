import fs from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.join(process.cwd(), 'release');
const macPackageDirs = [
  'mac-universal',
  'mac-universal-x64-temp',
  'mac-universal-arm64-temp',
];

await Promise.all(
  macPackageDirs.map((dir) =>
    fs.rm(path.join(releaseDir, dir), { recursive: true, force: true }),
  ),
);
