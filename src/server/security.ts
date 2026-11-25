import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';

/**
 * HTTP hardening for a single Node process behind Hostinger's proxy (R1.9,
 * SEC-05/11/14/22). Limits are kept in memory: there is one process, and a
 * restart only resets the per-IP counters (the per-email lockout is in the DB).
 */

/**
 * `trust proxy` from TRUST_PROXY. Default: one proxy hop in production
 * (Hostinger serves the app only through its proxy, so the last
 * X-Forwarded-For entry is the real client), nothing elsewhere.
 * Accepts false/0, a hop count, or anything Express accepts ("loopback", CIDRs).
 */
export function resolveTrustProxy(
  value: string | undefined,
  isProduction: boolean
): boolean | number | string {
  const raw = (value ?? '').trim();
  if (raw === '') return isProduction ? 1 : false;
  if (raw === 'false' || raw === '0') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** helmet's headers everywhere; the CSP is added separately for production pages. */
export const securityHeaders: RequestHandler = helmet({ contentSecurityPolicy: false });

/**
 * CSP for the built UI. Not used with the Vite dev server, which needs inline
 * scripts. Google Fonts stay allowed until the fonts are hosted locally (R4,
 * SEC-25). Inline styles are needed by React style props and the print HTML.
 */
export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
  'img-src': ["'self'", 'data:', 'blob:'],
  'connect-src': ["'self'"],
  'frame-src': ["'self'"],
  'frame-ancestors': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
} satisfies Record<string, string[]>;

export const contentSecurityPolicy: RequestHandler = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: CSP_DIRECTIVES,
});

/** Public invoice pages and data must not show up in search engines. */
export function noIndex(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
}

interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Count only failed requests (status >= 400). */
  failuresOnly: boolean;
  message: string;
}

function createLimiter({ windowMs, limit, failuresOnly, message }: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests: failuresOnly,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfterSeconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: message, code: 'RATE_LIMITED', retryAfterSeconds });
    },
  });
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export type RateLimiters = ReturnType<typeof createRateLimiters>;

/** Per-IP limits approved for R1.9. One set per app instance. */
export function createRateLimiters() {
  return {
    /** 30 failed sign-ins per IP in 15 minutes (any emails). */
    login: createLimiter({
      windowMs: FIFTEEN_MINUTES,
      limit: 30,
      failuresOnly: true,
      message: 'Too many failed sign-in attempts from this network. Try again later.',
    }),
    /** 10 failed first-run setup attempts per IP in 15 minutes. */
    setup: createLimiter({
      windowMs: FIFTEEN_MINUTES,
      limit: 10,
      failuresOnly: true,
      message: 'Too many setup attempts from this network. Try again later.',
    }),
    /** 60 public invoice lookups per IP per minute. */
    publicInvoice: createLimiter({
      windowMs: 60 * 1000,
      limit: 60,
      failuresOnly: false,
      message: 'Too many requests. Try again in a minute.',
    }),
  };
}
