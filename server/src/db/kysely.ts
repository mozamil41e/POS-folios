import { Kysely, SqliteDialect } from 'kysely';
import { db as sqlite } from '../../../src/server/db.ts';
import type { Database } from './schema.ts';

/**
 * Typed query builder over the application database (R2.3, decision D3).
 *
 * It shares the one better-sqlite3 connection with the legacy routes, so old
 * and new code see the same data while domains move over (strangler). Every
 * query runs synchronously underneath and resolves within the same event-loop
 * turn, which is what makes withTransaction() safe on a single connection;
 * see transaction.ts. In R3 the dialect switches to MariaDB (mysql2 pool).
 *
 * Never call kysely.destroy(): it would close the shared connection.
 */
export const kysely = new Kysely<Database>({
  dialect: new SqliteDialect({ database: sqlite }),
});

export type { Database };
