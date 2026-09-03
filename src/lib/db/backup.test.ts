import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BACKUP_DIR, MAX_BACKUPS, createBackup, listBackups } from "./backup";
import { businesses, db } from "./index";

const run = promisify(execFile);

/**
 * Snapshots are taken before every scrape, so the two things that matter are
 * that the copy is actually restorable and that the directory never grows past
 * the cap.
 */

function clearBackups() {
  if (fs.existsSync(BACKUP_DIR)) fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
}

beforeEach(clearBackups);
afterEach(clearBackups);

/** A throwaway database to restore into, so the real one is never touched. */
const SCRATCH_DB = "lead_tracking_backup_check";

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Restore a dump into an empty database and hand back a client for it.
 *
 * This is the only assertion that proves a snapshot is worth keeping: the file
 * existing and being non-empty says nothing about whether `pg_restore` can read
 * it back, which is the entire reason we take it.
 */
async function restoreInto(dumpPath: string) {
  // `postgres` is the maintenance database every server has; CREATE/DROP
  // DATABASE cannot run from inside the database being created.
  const admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${SCRATCH_DB}`);
    await admin.unsafe(`create database ${SCRATCH_DB}`);
  } finally {
    await admin.end();
  }

  await run("pg_restore", [
    `--dbname=${urlFor(SCRATCH_DB)}`,
    "--no-owner",
    "--no-privileges",
    dumpPath,
  ]);

  return postgres(urlFor(SCRATCH_DB), { max: 1, onnotice: () => {} });
}

async function dropScratch() {
  const admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${SCRATCH_DB}`);
  } finally {
    await admin.end();
  }
}

describe("createBackup", () => {
  it("writes a snapshot that restores into a real database", async () => {
    await db
      .insert(businesses)
      .values({
        placeId: "backup-test-1",
        name: "Peluquería Backup",
        websiteClass: "none",
      })
      .onConflictDoNothing();

    const info = await createBackup();
    expect(fs.existsSync(info.path)).toBe(true);
    expect(info.sizeBytes).toBeGreaterThan(0);

    const restored = await restoreInto(info.path);
    try {
      const rows = await restored`
        select name from businesses where place_id = 'backup-test-1'
      `;
      // Also confirms the dump round-trips UTF-8 rather than mangling it.
      expect(rows[0]?.name).toBe("Peluquería Backup");
    } finally {
      await restored.end();
      await dropScratch();
    }

    await db.delete(businesses);
  });

  it("keeps at most MAX_BACKUPS, dropping the oldest first", async () => {
    const created: string[] = [];

    // Deliberately back-to-back, with no clock spacing: snapshots taken inside
    // the same millisecond must still prune correctly, and must never delete
    // the one just written.
    for (let i = 0; i < MAX_BACKUPS + 3; i++) {
      const info = await createBackup();
      expect(fs.existsSync(info.path)).toBe(true);
      created.push(info.file);
    }

    const remaining = listBackups();
    expect(remaining).toHaveLength(MAX_BACKUPS);

    // The survivors are the newest ones.
    const survivingFiles = remaining.map((b) => b.file).sort();
    expect(survivingFiles).toEqual(created.slice(-MAX_BACKUPS).sort());
  });

  it("reports newest first", async () => {
    for (let i = 0; i < MAX_BACKUPS; i++) await createBackup();

    const listed = listBackups();
    expect(listed).toHaveLength(MAX_BACKUPS);

    const times = listed.map((b) => b.createdAt.getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    // Filenames are ISO stamps, so newest-first must also be name-descending.
    expect(listed.map((b) => b.file)).toEqual([...listed.map((b) => b.file)].sort().reverse());
  });

  it("gives distinct names to snapshots taken in the same millisecond", async () => {
    const a = await createBackup();
    const b = await createBackup();

    expect(a.file).not.toBe(b.file);
    expect(fs.existsSync(a.path)).toBe(true);
    expect(fs.existsSync(b.path)).toBe(true);
    // Same width, so sorting by name is still sorting by time.
    expect(a.file.length).toBe(b.file.length);
    expect(b.file > a.file).toBe(true);
  });

  it("ignores unrelated files in the backup directory", async () => {
    await createBackup();
    fs.writeFileSync(path.join(BACKUP_DIR, "notes.txt"), "not a backup");

    expect(listBackups()).toHaveLength(1);
  });

  it("has no backups to list before the first one is taken", () => {
    expect(listBackups()).toEqual([]);
  });
});
