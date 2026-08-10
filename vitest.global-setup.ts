import fs from "node:fs";
import path from "node:path";

/**
 * The runner integration test writes to a real SQLite file. Remove it before the
 * suite so each run starts from an empty, freshly migrated database.
 */
export default function setup() {
  const base = path.join(process.cwd(), "data", "test-runner.db");
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${base}${suffix}`, { force: true });
  }
}
