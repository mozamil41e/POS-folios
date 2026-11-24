import { defineConfig } from 'vitest/config';

// API tests (tests/api) run in Node against the real Express app (server.ts)
// with an isolated temporary SQLite database per test file (tests/helpers/app.ts).
// UI tests (tests/ui/*.test.tsx) opt into a browser DOM per file with a
// `// @vitest-environment jsdom` comment.
// Run them with `npm test` (scripts/run-vitest.mjs normalises the Windows
// drive-letter casing before Vitest starts).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
