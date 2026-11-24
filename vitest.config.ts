import { defineConfig } from 'vitest/config';

// API tests run in Node against the real Express app (server.ts) with an
// isolated temporary SQLite database per test file (see tests/helpers/app.ts).
// Run them with `npm test` (scripts/run-vitest.mjs normalises the Windows
// drive-letter casing before Vitest starts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
