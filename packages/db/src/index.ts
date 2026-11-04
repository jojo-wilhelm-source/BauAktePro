import postgres from 'postgres';

/** Superuser/owner connection – migrations and seed only. */
export const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:54329/bap';
/** Restricted connection used by the API (RLS applies). */
export const APP_URL = process.env.DATABASE_URL ?? 'postgres://bap_app:bap_app@localhost:54329/bap';

export type Sql = postgres.Sql;
export type TxSql = postgres.TransactionSql;

export function connect(url: string = APP_URL, max = 10): Sql {
  return postgres(url, { max, onnotice: () => {} });
}

/**
 * Run fn inside a transaction as the given user. Sets app.user_id (transaction-local) so
 * Row Level Security policies apply. Every API database access must go through this.
 */
export function asUser<T>(sql: Sql, userId: string, fn: (tx: TxSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
