import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { logger } from "@/lib/log";
import { DATABASE_URL, safeHost } from "./index";

const run = promisify(execFile);
const log = logger("backup");

/**
 * A snapshot of the database, taken before every scrape.
 *
 * A scrape is the only thing that writes `businesses` and `leads` in bulk, so
 * it is the only moment worth guarding against. This used to be SQLite's own
 * backup API copying a file; on Postgres it shells out to `pg_dump`, which is
 * the equivalent — a consistent snapshot taken while the database keeps serving.
 *
 * `pg_dump` must be on PATH and its major version must be >= the server's.
 * Where this runs beside the database (the API service on the VPS) that is a
 * one-line addition to the image; locally, Homebrew's postgres already provides
 * it. If it is missing, the scrape still runs — see the caller.
 */

export const BACKUP_DIR =
  process.env.BACKUP_DIR ?? path.join(process.cwd(), "data", "backups");

/** Keep the last few. Old snapshots are deleted oldest-first to make room. */
export const MAX_BACKUPS = Number(process.env.MAX_BACKUPS ?? 3);

const PREFIX = "leads-";
const SUFFIX = ".dump";

export type BackupInfo = {
  file: string;
  path: string;
  sizeBytes: number;
  createdAt: Date;
};

/**
 * Existing snapshots, newest first.
 *
 * `BACKUP_DIR` is configurable, so the build's file tracer can't tell where
 * these reads land and defensively pulls the entire project into the server
 * bundle — source, public folder and all. The `turbopackIgnore` comments tell
 * it to stop guessing: this directory holds runtime data written by the app,
 * never build inputs, so there is nothing here worth tracing.
 */
export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(/*turbopackIgnore: true*/ BACKUP_DIR)) return [];

  return fs
    .readdirSync(/*turbopackIgnore: true*/ BACKUP_DIR)
    .filter((file) => file.startsWith(PREFIX) && file.endsWith(SUFFIX))
    .map((file) => {
      const full = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, file);
      const stat = fs.statSync(/*turbopackIgnore: true*/ full);
      return { file, path: full, sizeBytes: stat.size, createdAt: stat.mtime };
    })
    // Two snapshots in the same millisecond would otherwise sort arbitrarily.
    // Filenames are ISO timestamps, so they break the tie the same way a clock
    // would.
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.file.localeCompare(a.file),
    );
}

/**
 * Take a snapshot, then delete the oldest until `MAX_BACKUPS` remain.
 *
 * Pruning happens *after* the new snapshot lands, never before: if the dump
 * fails you still have the full set of old ones rather than having thrown one
 * away to make room for a file that never arrived.
 */
export async function createBackup(): Promise<BackupInfo> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set; cannot take a backup");

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Sortable, filename-safe, and always the same width, so a lexicographic sort
  // stays chronological and two dumps in the same millisecond get distinct
  // names instead of one silently overwriting the other.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  const nameFor = (seq: number) =>
    path.join(BACKUP_DIR, `${PREFIX}${stamp}-${String(seq).padStart(3, "0")}${SUFFIX}`);

  let destination = nameFor(1);
  for (let seq = 2; fs.existsSync(destination); seq++) destination = nameFor(seq);

  try {
    await run(
      "pg_dump",
      [
        DATABASE_URL,
        // Custom format: compressed, and restorable with pg_restore into an
        // empty database without hand-editing SQL.
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--file=${destination}`,
      ],
      { timeout: 5 * 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    // A half-written dump is worse than none: it would occupy a rotation slot
    // and look restorable.
    fs.rmSync(destination, { force: true });
    throw error;
  }

  // Never a candidate for pruning: deleting the snapshot we were just asked to
  // take would be the one unacceptable outcome here.
  const older = listBackups().filter((backup) => backup.path !== destination);
  for (const stale of older.slice(MAX_BACKUPS - 1)) {
    fs.rmSync(stale.path, { force: true });
    log.info("pruned", { file: stale.file, keeping: MAX_BACKUPS });
  }

  const stat = fs.statSync(destination);
  log.debug("created", { file: path.basename(destination), host: safeHost(DATABASE_URL) });

  return {
    file: path.basename(destination),
    path: destination,
    sizeBytes: stat.size,
    createdAt: stat.mtime,
  };
}
