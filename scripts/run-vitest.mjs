// Launches Vitest from the OS-reported real path of the project.
//
// Why: on Windows a terminal can report the drive letter in lowercase (d:\…)
// while installed packages resolve with the real casing (D:\…). Vitest then
// loads its own runner twice and every suite fails with
// "Cannot read properties of undefined (reading 'config')".
// Re-launching from the real path keeps one consistent casing. On Linux/macOS
// (CI, Hostinger) the real path equals the current directory, so this is a no-op.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cwd = fs.realpathSync.native(process.cwd());
const vitestBin = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');

const result = spawnSync(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
