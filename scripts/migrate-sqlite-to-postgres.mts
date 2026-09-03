/**
 * One-off: copy everything out of the old SQLite file into Postgres.
 *
 *   npm run db:import                      # from data/leads.db
 *   SQLITE_PATH=./data/backups/x.db npm run db:import
 *
 * Safe to re-run: it refuses to touch a Postgres database that already has
 * rows, so a second run can't double-insert your leads.
 *
 * Two conversions matter. SQLite stored timestamps as millisecond integers and
 * booleans as 0/1; Postgres wants real `timestamptz` and `boolean`. Everything
 * else is a column-for-column copy, primary keys included, so lead ids in your
 * bookmarks and the `businessId` links between tables all still line up.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import postgres from "postgres";

const SQLITE_PATH = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "leads.db");
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
if (!fs.existsSync(SQLITE_PATH)) throw new Error(`No SQLite database at ${SQLITE_PATH}`);

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

/** Millisecond integer → Date, preserving null. */
const ts = (value: unknown) =>
  value == null ? null : new Date(Number(value));
const bool = (value: unknown) => Boolean(Number(value ?? 0));

/**
 * Order matters: businesses before leads before events, so foreign keys are
 * satisfied as we go rather than needing them switched off.
 */
type TableSpec = {
  name: string;
  columns: string[];
  convert: (row: Record<string, unknown>) => Record<string, unknown>;
};

const TABLES: TableSpec[] = [
  {
    name: "businesses",
    columns: [
      "id", "place_id", "name", "address", "lat", "lng", "types", "primary_category",
      "phone", "website_uri", "website_host", "rating", "user_rating_count",
      "business_status", "website_class", "website_status", "website_status_code",
      "website_checked_at", "lead_score", "area_name", "first_seen_at", "last_seen_at",
    ],
    convert: (row: Record<string, unknown>) => ({
      ...row,
      website_checked_at: ts(row.website_checked_at),
      first_seen_at: ts(row.first_seen_at),
      last_seen_at: ts(row.last_seen_at),
    }),
  },
  {
    name: "leads",
    columns: [
      "id", "business_id", "status", "quote_amount", "currency", "demo_url", "notes",
      "contacted_at", "next_follow_up_at", "created_at", "updated_at",
    ],
    convert: (row: Record<string, unknown>) => ({
      ...row,
      contacted_at: ts(row.contacted_at),
      next_follow_up_at: ts(row.next_follow_up_at),
      created_at: ts(row.created_at),
      updated_at: ts(row.updated_at),
    }),
  },
  {
    name: "lead_events",
    columns: ["id", "lead_id", "type", "message", "created_at"],
    convert: (row: Record<string, unknown>) => ({ ...row, created_at: ts(row.created_at) }),
  },
  {
    name: "scrape_jobs",
    columns: [
      "id", "area_name", "params", "status", "cells_total", "cells_done",
      "requests_made", "estimated_cost_usd", "results_seen", "businesses_found",
      "new_businesses", "leads_created", "saturated_cells", "cells_skipped",
      "stopped_reason", "cancel_requested", "error", "started_at", "finished_at",
      "created_at",
    ],
    convert: (row: Record<string, unknown>) => ({
      ...row,
      cancel_requested: bool(row.cancel_requested),
      started_at: ts(row.started_at),
      finished_at: ts(row.finished_at),
      created_at: ts(row.created_at),
    }),
  },
  {
    name: "cell_coverage",
    columns: [
      "id", "cell_key", "lat", "lng", "radius", "category_slug", "depth",
      "places_found", "saturated", "swept_at",
    ],
    convert: (row: Record<string, unknown>) => ({
      ...row,
      saturated: bool(row.saturated),
      swept_at: ts(row.swept_at),
    }),
  },
  {
    name: "settings",
    columns: ["key", "value", "updated_at"],
    convert: (row: Record<string, unknown>) => ({ ...row, updated_at: ts(row.updated_at) }),
  },
];

function sqliteHas(table: string): boolean {
  return Boolean(
    sqlite
      .prepare("select 1 from sqlite_master where type='table' and name=?")
      .get(table),
  );
}

async function main() {
  // Refuse to run against a database that already holds data.
  for (const table of TABLES) {
    const [{ count }] = await sql`select count(*)::int as count from ${sql(table.name)}`;
    if (count > 0) {
      throw new Error(
        `${table.name} already has ${count} rows in Postgres. Import aborted so nothing is duplicated — empty it first if you meant to re-import.`,
      );
    }
  }

  const summary: Record<string, number> = {};

  for (const table of TABLES) {
    if (!sqliteHas(table.name)) {
      console.log(`  ${table.name}: not present in the SQLite file, skipped`);
      summary[table.name] = 0;
      continue;
    }

    const rows = sqlite
      .prepare(`select ${table.columns.join(", ")} from ${table.name}`)
      .all() as Record<string, unknown>[];

    if (rows.length === 0) {
      console.log(`  ${table.name}: empty`);
      summary[table.name] = 0;
      continue;
    }

    const converted = rows.map((row) => table.convert(row));

    // Chunked: one statement per 500 rows keeps the parameter count well inside
    // Postgres's 65535 limit even on the widest table.
    for (let i = 0; i < converted.length; i += 500) {
      const chunk = converted.slice(i, i + 500);
      await sql`insert into ${sql(table.name)} ${sql(chunk, ...table.columns)}`;
    }

    console.log(`  ${table.name}: ${rows.length} rows`);
    summary[table.name] = rows.length;
  }

  // Every id was carried across explicitly, so the sequences still think they
  // are at 1. Without this the next insert collides with an existing row.
  for (const table of TABLES) {
    if (table.name === "settings") continue;
    await sql.unsafe(
      `select setval(pg_get_serial_sequence('${table.name}', 'id'),
         coalesce((select max(id) from ${table.name}), 1),
         (select count(*) > 0 from ${table.name}))`,
    );
  }

  console.log("\nverifying row counts match…");
  let mismatch = false;
  for (const table of TABLES) {
    const before = summary[table.name];
    const [{ count }] = await sql`select count(*)::int as count from ${sql(table.name)}`;
    const ok = count === before;
    if (!ok) mismatch = true;
    console.log(`  ${ok ? "✓" : "✗"} ${table.name}: sqlite ${before} → postgres ${count}`);
  }

  if (mismatch) throw new Error("Row counts do not match — investigate before using this data.");
  console.log("\nimport complete.");
}

try {
  await main();
} finally {
  await sql.end();
  sqlite.close();
}
