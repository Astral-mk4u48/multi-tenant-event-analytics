import { Pool, PoolClient } from "pg";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "../server/env";

declare global {
  // eslint-disable-next-line no-var
  var __dbPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __migrationPool: Pool | undefined;
}

const isLocal = (url: string) => url.includes("localhost") || url.includes("127.0.0.1");

// Application pool connecting with non-superuser app_user (RLS enforced)
export const pool =
  global.__dbPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: isLocal(env.DATABASE_URL) ? false : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global.__dbPool = pool;
}

export const db = drizzle(pool, { schema });

// Superuser migration pool used solely for running migrations and system setup
export const migrationPool =
  global.__migrationPool ??
  new Pool({
    connectionString: env.DATABASE_MIGRATION_URL,
    max: 5,
    ssl: isLocal(env.DATABASE_MIGRATION_URL) ? false : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global.__migrationPool = migrationPool;
}

export const migrationDb = drizzle(migrationPool, { schema });

export type TenantDb = NodePgDatabase<typeof schema>;

/**
 * Executes a callback within a PostgreSQL transaction strictly scoped to a tenant.
 * Uses SELECT set_config('app.current_org_id', $1, true) so the setting is local
 * to the transaction and pooled connections never leak context.
 */
export async function withTenant<T>(
  orgId: string,
  callback: (tx: TenantDb) => Promise<T>
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const txDb = drizzle(client, { schema });
    const result = await callback(txDb);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
