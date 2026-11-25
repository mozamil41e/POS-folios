import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../logger.ts';

// A caller-supplied id is kept only if it is short and harmless.
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Gives every request an id (R2.1): echoed in the X-Request-Id header, written
 * in every log line for that request and in 500 responses, so a problem seen
 * at the till can be found in the server log.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

/** One log line per API request: method, path (no query string), status, duration. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const entry = {
        reqId: res.locals.requestId as string | undefined,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
      };
      if (res.statusCode >= 500) logger.error(entry, 'request failed');
      else logger.info(entry, 'request');
    });
    next();
  };
}

/** Express 5 leaves req.body undefined when there is no JSON body; routes expect an object. */
export function emptyBodyAsObject(): RequestHandler {
  return (req, _res, next) => {
    if (req.body === undefined) req.body = {};
    next();
  };
}
