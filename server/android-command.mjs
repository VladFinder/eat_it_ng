import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const task = process.argv[2];
if (!['assembleDebug', 'bundleRelease'].includes(task)) {
  throw new Error('Supported Android tasks: assembleDebug, bundleRelease');
}

const windows = process.platform === 'win32';
const result = spawnSync(
  windows ? 'cmd.exe' : '/bin/sh',
  windows ? ['/d', '/s', '/c', 'gradlew.bat', task] : ['./gradlew', task],
  { cwd: fileURLToPath(new URL('../android/', import.meta.url)), stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
