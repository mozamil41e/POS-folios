import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// API tests (tests/api) run in Node against the real Express app (createApp in
// server/src/app.ts) with an isolated temporary SQLite database per test file
// (tests/helpers/app.ts). UI tests (tests/ui/*.test.tsx) opt into a browser DOM
// per file with a `// @vitest-environment jsdom` comment.
// Run them with `npm test` (scripts/run-vitest.mjs normalises the Windows
// drive-letter casing before Vitest starts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      // Safety net (R2.1): anything that opens the database before a test sets
      // its own path lands in the temp folder, never in the repository's ./data.
      MIZAN_DB_PATH: path.join(os.tmpdir(), `mizan-vitest-fallback-${process.pid}.db`),
    },
  },
});
