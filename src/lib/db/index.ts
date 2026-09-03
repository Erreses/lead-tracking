import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { logger } from "@/lib/log";
import * as schema from "./schema";

export * from "./schema";

const log = logger("db");

/**
 * Direct Postgres access.
 *
 * Only the API service is meant to import this. The local dashboard reaches its
 * data over HTTP instead (see `src/lib/data`), so the database never has to be
 * exposed to the internet.
 */

export const DATABASE_URL = process.env.DATABASE_URL ?? "";

function createDb() {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Point it at Postgres, e.g. postgres://user:pass@localhost:5432/lead_tracking",
    );
  }

  const client = postgres(DATABASE_URL, {
    // A local dashboard and a single scrape worker need very few connections,
    // and a small ceiling keeps a runaway loop from exhausting the server.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 15,
    // Managed Postgres usually presents a self-signed certificate. `prefer`
    // encrypts when the server offers it without failing when it doesn't.
    ssl: sslMode(),
    onnotice: () => {},
  });

  log.debug("connected", { host: safeHost(DATABASE_URL) });

  return { db: drizzle(client, { schema }), client };
}

function sslMode(): "require" | "prefer" | false {
  const configured = process.env.DATABASE_SSL;
  if (configured === "require") return "require";
  if (configured === "disable") return false;
  // Local containers speak plaintext; anything else is probably over a network.
  return /@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(DATABASE_URL)
    ? false
    : "prefer";
}

/** Host and database only — never the credentials. */
export function safeHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

type Handle = ReturnType<typeof createDb>;

// Next's dev server re-evaluates modules on hot reload; without this the process
// would open a fresh pool on every edit until the server ran out of connections.
const globalForDb = globalThis as unknown as { __leadTrackingDb?: Handle };

const handle: Handle = (globalForDb.__leadTrackingDb ??= createDb());

export const db = handle.db;

/** The raw postgres.js client, for migrations and shutdown. */
export const client = handle.client;
