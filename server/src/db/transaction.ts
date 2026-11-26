import type { RequestHandler } from 'express';
import type { Transaction } from 'kysely';
import { sendError } from '../shared/respond.ts';
import { kysely, type Database } from './kysely.ts';

/**
 * Transactions for the new modules (R2.3), approved design.
 *
 * SQLite runs on ONE connection shared by every request. A transaction is
 * therefore only safe if nothing else runs while it is open. The rule:
 *
 *   A withTransaction() body contains database work only. Do slow or real
 *   asynchronous work (password hashing, HTTP calls, timers, file I/O) before
 *   it starts and pass the results in.
 *
 * With only database work, the whole body completes within one event-loop
 * turn (better-sqlite3 is synchronous), so no other request can interleave.
 * Two guards make a violation fail safe instead of mixing data:
 *   1. requestsWaitWhileTransactionOpen(): a request that arrives while a
 *      transaction is still open is refused with 503 SERVER_BUSY (retryable)
 *      and never touches the database.
 *   2. The transaction itself notices that it outlived its event-loop turn,
 *      throws TransactionSpanError and is rolled back entirely.
 * With MariaDB (R3) every transaction gets its own pooled connection; the
 * rule and guards then become plain good practice.
 */

export class TransactionSpanError extends Error {
  constructor() {
    super(
      'A database transaction stayed open across an event-loop turn (it awaited non-database work). ' +
        'It was rolled back. Move slow work out of withTransaction().'
    );
    this.name = 'TransactionSpanError';
  }
}

interface OpenTransaction {
  /** Set when the event loop moved on while the transaction was open. */
  interrupted: boolean;
}

let open: OpenTransaction | null = null;

/** True while a withTransaction() body is running. */
export function isTransactionOpen(): boolean {
  return open !== null;
}

/**
 * Runs `work` in one database transaction: everything commits together, or
 * nothing does if it throws. Do not nest: pass `trx` down to the helpers.
 */
export async function withTransaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  if (open) {
    throw new Error('withTransaction() is already running: pass the trx down instead of nesting transactions.');
  }
  const state: OpenTransaction = { interrupted: false };
  open = state;
  // Fires only once the current turn and its microtasks are done, i.e. if the
  // body awaited something other than database work.
  const turnEnded = setImmediate(() => {
    state.interrupted = true;
  });
  try {
    return await kysely.transaction().execute(async (trx) => {
      const result = await work(trx);
      if (state.interrupted) throw new TransactionSpanError();
      return result;
    });
  } finally {
    clearImmediate(turnEnded);
    open = null;
  }
}

/**
 * Guard 1 (see above): registered before every route in createApp(). Costs a
 * single check per request; only ever answers when a transaction broke the rule.
 */
export function requestsWaitWhileTransactionOpen(): RequestHandler {
  return (req, res, next) => {
    if (open) {
      open.interrupted = true;
      res.setHeader('Retry-After', '1');
      sendError(req, res, 503, 'SERVER_BUSY', 'The server is busy. Please try again.');
      return;
    }
    next();
  };
}
