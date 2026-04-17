import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { AppEnv } from '../../env';
import * as schema from './schema';

export type Sql = ReturnType<typeof postgres>;
export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  readonly db: Db;
  readonly sql: Sql;
  /** Graceful shutdown — drains the pool. Idempotent. */
  close(): Promise<void>;
  /**
   * Run the callback in a transaction with the env's statement timeout applied.
   */
  withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
}

export function createDbHandle(env: AppEnv): DbHandle {
  const sql = postgres(env.DATABASE_URL, {
    max: env.DB_POOL_MAX,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    onnotice: () => {},
    connection: {
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    },
  });
  const db = drizzle(sql, { schema });

  let closed = false;
  return {
    db,
    sql,
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await sql.end({ timeout: 5 });
    },
    async withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => fn(tx));
    },
  };
}
