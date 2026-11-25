import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config/env.ts';

/**
 * Structured JSON logs on stdout (R2.1), which Hostinger keeps with the app's
 * output. Request bodies are never logged; credentials are redacted wherever
 * they could appear (headers, nested objects).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'token',
  'setup_token',
  '*.password',
  '*.token',
  '*.setup_token',
  '*.authorization',
];

export function createLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    },
    destination
  );
}

export type { Logger };
