import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { contentSecurityPolicy, noIndex } from '../../src/server/security.ts';
import { ConfigError, loadConfig, type AppConfig } from './config/env.ts';

/**
 * Server entry point (R2.1). `npm run dev` runs this file with tsx (Vite dev
 * server); `npm run build` bundles it into server.js at the repository root,
 * which Hostinger starts. Validates the environment before anything else.
 */
const currentFile = fileURLToPath(import.meta.url);
const compiledEntry =
  path.basename(currentFile) === 'server.js' || path.basename(process.argv[1] || '') === 'server.js';

function readConfig(): AppConfig {
  try {
    return loadConfig(process.env, { compiledEntry });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Mizan POS cannot start.\n${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  // Imported only after the check: loading the app opens (and may create) the database file.
  const { createApp } = await import('./app.ts');
  const { app, logger, errorHandler } = createApp({ config });

  // Last-resort safety net (R1.5): a stray rejected promise is logged, not fatal.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });

  if (!config.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const candidates = [path.resolve(path.dirname(currentFile), 'dist'), path.resolve(process.cwd(), 'dist')];
    const distDir = candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? candidates[0];

    // R1.9 (SEC-11): CSP for the built UI only; Vite's dev server needs inline scripts.
    app.use(contentSecurityPolicy);
    app.use('/i', noIndex); // public invoice pages opened from the receipt QR
    app.use(express.static(distDir));
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'API route not found.', code: 'NOT_FOUND' });
    });
    // Express 5 path syntax: a named wildcard instead of '*'.
    app.get('/{*path}', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) res.sendFile(indexFile);
      else res.status(404).send('Build output not found.');
    });
  }

  // Also covers the UI routes registered above.
  app.use(errorHandler);

  app.listen(config.port, '0.0.0.0', (error?: Error) => {
    if (error) {
      logger.fatal({ err: error, port: config.port }, 'cannot listen');
      process.exit(1);
    }
    logger.info({ port: config.port, production: config.isProduction }, 'Mizan POS server running');
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
