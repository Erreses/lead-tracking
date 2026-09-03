import "server-only";

import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { logger } from "@/lib/log";
import { client, db, safeHost, DATABASE_URL } from "./index";

const log = logger("db.migrate");

/**
 * Bring the schema up to date at container start.
 *
 * Deploying is `git push` → Coolify rebuilds → new container. There is no step
 * in between where anyone would run migrations by hand, so the app does it
 * itself on the way up. If it fails the process exits rather than serving
 * against a schema it does not understand.
 */

/**
 * Postgres advisory lock, held for the duration of the migration.
 *
 * A redeploy can briefly run the old and new containers side by side, and both
 * call this. Drizzle's migrator is not safe to run twice concurrently — the
 * loser sees "relation already exists" and takes the container down. The lock
 * serialises them: the second one waits, then finds nothing left to apply.
 *
 * The number is arbitrary but must be stable; it is the lock's identity.
 */
const MIGRATION_LOCK_ID = 4_713_002;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

export async function runMigrations(): Promise<void> {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set; cannot run migrations");
  }

  // A dedicated connection: a session-level advisory lock belongs to the
  // connection that took it, and anything from the pool could be handed to
  // another query — or returned — before we are done.
  const connection = await client.reserve();
  const startedAt = Date.now();

  try {
    log.debug("waiting for lock", { host: safeHost(DATABASE_URL) });
    await connection`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    log.info("up to date", {
      host: safeHost(DATABASE_URL),
      ms: Date.now() - startedAt,
    });
  } finally {
    // Released explicitly rather than left to connection teardown, so a
    // long-lived process doesn't sit on the lock and stall the next deploy.
    await connection`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(
      () => {},
    );
    connection.release();
  }
}
