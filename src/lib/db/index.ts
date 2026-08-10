import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

export * from "./schema";

const DB_PATH =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "leads.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

function createDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  // WAL keeps the dashboard readable while a scrape is writing to the same file.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  if (fs.existsSync(MIGRATIONS_DIR)) {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }

  return db;
}

type Db = ReturnType<typeof createDb>;

// Next's dev server re-evaluates modules on hot reload; without this the process
// would accumulate open SQLite handles and re-run the migrator on every edit.
const globalForDb = globalThis as unknown as { __leadTrackingDb?: Db };

export const db: Db = globalForDb.__leadTrackingDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__leadTrackingDb = db;
}
