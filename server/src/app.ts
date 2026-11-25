import express, { type ErrorRequestHandler, type Express } from 'express';
import { initDatabase } from '../../src/server/db.ts';
import { createRateLimiters, resolveTrustProxy, securityHeaders } from '../../src/server/security.ts';
import { loadConfig, type AppConfig } from './config/env.ts';
import { createLegacyRouter } from './legacy/routes.ts';
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

  // Today's routes, moved as they were (strangler): R2.4 moves them into
  // server/src/modules/<domain> one domain at a time.
  app.use(createLegacyRouter({ config, limiters: createRateLimiters() }));

  const errorHandler = createErrorHandler(logger);
  app.use(errorHandler);
  return { app, config, logger, errorHandler };
}
