import { Pool } from "pg";
import { env } from "../config/env";

let pool: Pool | null = null;

export function getPgPool() {
  if (!env.usePostgres || !env.databaseUrl) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.nodeEnv === "production" ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}
