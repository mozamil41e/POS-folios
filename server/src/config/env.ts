import { z } from 'zod';

/**
 * Environment variables, validated once at boot (R2.1). A missing or invalid
 * value stops the server with a message that names it, instead of failing
 * later in the middle of a request. Production values live in hPanel; there
 * is no .env file (see .env.example).
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SETUP_TOKEN: z.string().trim().optional(),
  TRUST_PROXY: z.string().trim().optional(),
  MIZAN_DB_PATH: z.string().trim().optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
});

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  /** True for NODE_ENV=production and for the compiled bundle (npm start). */
  isProduction: boolean;
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  /** Undefined only outside production (local first-run setup stays open). */
  setupToken: string | undefined;
  trustProxy: string | undefined;
  dbPath: string | undefined;
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
  }
}

/** The setup token guards first-run setup, which reopens on every deploy until MariaDB (R3). */
export const MIN_SETUP_TOKEN_LENGTH = 16;

// Empty strings count as "not set" (hPanel and .env.example leave them blank).
function withoutBlanks(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') result[key] = value;
  }
  return result;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { compiledEntry?: boolean } = {}
): AppConfig {
  const parsed = schema.safeParse(withoutBlanks(env));
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`));
  }
  const values = parsed.data;
  const isProduction = values.NODE_ENV === 'production' || Boolean(options.compiledEntry);

  const problems: string[] = [];
  if (isProduction) {
    if (!values.SETUP_TOKEN) {
      problems.push('SETUP_TOKEN: required in production (set it in Hostinger hPanel).');
    } else if (values.SETUP_TOKEN.length < MIN_SETUP_TOKEN_LENGTH) {
      problems.push(`SETUP_TOKEN: must be at least ${MIN_SETUP_TOKEN_LENGTH} characters.`);
    }
  }
  if (problems.length > 0) throw new ConfigError(problems);

  return {
    isProduction,
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    setupToken: values.SETUP_TOKEN,
    trustProxy: values.TRUST_PROXY,
    dbPath: values.MIZAN_DB_PATH,
    logLevel: values.LOG_LEVEL ?? (values.NODE_ENV === 'test' ? 'silent' : 'info'),
  };
}
