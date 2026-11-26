import express, { type ErrorRequestHandler, type Express } from 'express';
import { initDatabase } from '../../src/server/db.ts';
import { createRateLimiters, resolveTrustProxy, securityHeaders } from '../../src/server/security.ts';
import { loadConfig, type AppConfig } from './config/env.ts';
import { requestsWaitWhileTransactionOpen } from './db/transaction.ts';
import { requireAuth } from './middleware/auth.ts';
import { createAuthRouter } from './modules/auth/routes.ts';
import { createPublicInvoiceRouter } from './modules/public-invoice/routes.ts';
import { createWorkspaceRouter } from './modules/workspace/routes.ts';
import { createCustomersRouter } from './modules/customers/routes.ts';
import { createPurchasesRouter } from './modules/purchases/routes.ts';
import { createSalesRouter } from './modules/sales/routes.ts';
import { createSettingsRouter } from './modules/settings/routes.ts';
import { createSuppliersRouter } from './modules/suppliers/routes.ts';
import { createUsersRouter } from './modules/users/routes.ts';
import { createVouchersRouter } from './modules/vouchers/routes.ts';
import { createInventoryRouter } from './modules/inventory/routes.ts';
import { createLogger, type Logger } from './logger.ts';
import { emptyBodyAsObject, requestId, requestLogger } from './middleware/request.ts';
import { AppError } from './shared/errors.ts';

/**
 * Builds the Express app (R2.1): API routes and the central error handler,
 * without opening a port. main.ts adds the UI (Vite or dist/) and listens;
 * the tests use the app directly.
 */
export interface CreateAppOptions {
  /** Defaults to the validated environment (loadConfig). */
  config?: AppConfig;
  logger?: Logger;
}

export interface MizanApp {
  app: Express;
  config: AppConfig;
  logger: Logger;
  /** Registered after the API; main.ts registers it again after the UI routes. */
  errorHandler: ErrorRequestHandler;
}

/**
 * Every error ends as JSON without stack traces or internals (R1.5). Known
 * errors (AppError, including the input rules) keep their status and code;
 * anything else is logged with the request id and answered as 500 INTERNAL.
 * Express 5 forwards errors from async routes here by itself.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    const e = err as { type?: string } | null;
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON request body.', code: 'INVALID_JSON' });
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    if (err instanceof AppError) {
      res.set(err.headers);
      res.status(err.status).json({ error: err.message, code: err.code, ...err.details });
      return;
    }

    const reqId = res.locals.requestId as string | undefined;
    logger.error({ err, reqId, method: req.method, path: req.originalUrl.split('?')[0] }, 'unhandled error');
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL', requestId: reqId });
  };
}

export function createApp(options: CreateAppOptions = {}): MizanApp {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);

  initDatabase();

  const app = express();
  app.disable('x-powered-by');
  // Client IPs come from Hostinger's proxy (X-Forwarded-For); see security.ts (SEC-22).
  app.set('trust proxy', resolveTrustProxy(config.trustProxy, config.isProduction));
  app.use(requestId());
  app.use('/api', requestLogger(logger));
  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));
  app.use(emptyBodyAsObject());
  // R2.3: never let a request touch the shared SQLite connection while a
  // transaction is open (see server/src/db/transaction.ts).
  app.use(requestsWaitWhileTransactionOpen());

  // The modules (R2.4): each route authenticates itself and declares its
  // permission. One set of rate limiters per app.
  const limiters = createRateLimiters();
  app.use(createAuthRouter({ config, limiters }));
  app.use(createPublicInvoiceRouter({ limiters }));
  app.use(createWorkspaceRouter());
  app.use(createUsersRouter());
  app.use(createSettingsRouter());
  app.use(createCustomersRouter());
  app.use(createSuppliersRouter());
  app.use(createPurchasesRouter());
  app.use(createVouchersRouter());
  app.use(createSalesRouter({ logger }));
  app.use(createInventoryRouter());
  // Any other /api path: 401 without a session, so strangers cannot probe which
  // routes exist; with a session main.ts answers 404 (as before R2.4).
  app.use('/api', requireAuth());

  const errorHandler = createErrorHandler(logger);
  app.use(errorHandler);
  return { app, config, logger, errorHandler };
}
