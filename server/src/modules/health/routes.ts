import { Router } from 'express';
import { sql } from 'kysely';
import { kysely } from '../../db/kysely.ts';
import { sendData, sendError } from '../../shared/respond.ts';

/**
 * GET /api/v1/health (R2.5a): for an external uptime monitor (R8). Public and
 * minimal: it says whether the server can reach its database, nothing else
 * (no version, no settings, no counts).
 */
export function createHealthRouter(): Router {
  const router = Router();

  router.get('/api/v1/health', async (req, res) => {
    try {
      await sql`SELECT 1`.execute(kysely);
      sendData(res, { status: 'ok' });
    } catch {
      sendError(req, res, 503, 'UNHEALTHY', 'The database is not reachable.');
    }
  });

  return router;
}
