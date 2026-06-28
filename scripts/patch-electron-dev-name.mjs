import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const plistPath = path.join(
  process.cwd(),
  'node_modules/electron/dist/Electron.app/Contents/Info.plist',
);

if (!fs.existsSync(plistPath)) {
  process.exit(0);
}

const plistBuddy = '/usr/libexec/PlistBuddy';
const displayName = 'MultiMind Flow';

setPlistValue('CFBundleName', displayName);
setPlistValue('CFBundleDisplayName', displayName);

function setPlistValue(key, value) {
  const setCommand = `Set :${key} ${value}`;
  const addCommand = `Add :${key} string ${value}`;

  try {
    execFileSync(plistBuddy, ['-c', setCommand, plistPath], { stdio: 'ignore' });
  } catch {
    execFileSync(plistBuddy, ['-c', addCommand, plistPath], { stdio: 'ignore' });
  }
}
