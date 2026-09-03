import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * The database the suite runs against.
 *
 * Separate from your development database on purpose — the tests truncate
 * everything between cases, and pointing them at `lead_tracking` would delete
 * every lead you have.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/lead_tracking_test";

function urlFor(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Create the test database if it isn't there, then reset it to an empty,
 * freshly migrated schema so every run starts from the same place.
 */
export default async function setup() {
  const name = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");

  // A hard stop, not a convention. This function drops every table it can see;
  // a mistyped TEST_DATABASE_URL pointing at real data would be unrecoverable.
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run: the test database must be named *_test, got "${name}". ` +
        "This guard exists because global setup wipes the schema.",
    );
  }

  const admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
  try {
    const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!exists) await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // Cheaper and more thorough than dropping tables one by one, and it clears
    // the drizzle migrations bookkeeping along with them.
    await client.unsafe("drop schema if exists public cascade");
    await client.unsafe("drop schema if exists drizzle cascade");
    await client.unsafe("create schema public");

    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}
