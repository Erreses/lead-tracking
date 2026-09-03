/**
 * Read the structured logs back.
 *
 *   npm run logs                     # today, info and above
 *   npm run logs -- --level debug    # everything
 *   npm run logs -- --errors         # only warnings and errors
 *   npm run logs -- --scope places   # one subsystem
 *   npm run logs -- --job 7          # one scrape, start to finish
 *   npm run logs -- --grep budget    # substring match on the whole line
 *   npm run logs -- --days 3         # look further back than today
 *   npm run logs -- --json           # raw JSONL, for piping into jq
 *   npm run logs -- --spend          # per-job cost summary
 */
import fs from "node:fs";
import path from "node:path";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

const dir =
  process.env.LOG_DIR ??
  path.join(path.dirname(process.env.DATABASE_PATH ?? "data/leads.db"), "logs");

if (!fs.existsSync(dir)) {
  console.error(`No logs yet — ${dir} does not exist. Run something first.`);
  process.exit(0);
}

const days = Number(value("days") ?? 1);
const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith("app-") && f.endsWith(".jsonl"))
  .sort()
  .slice(-Math.max(1, days))
  .map((f) => path.join(dir, f));

const minLevel: Level = flag("errors")
  ? "warn"
  : ((value("level") as Level) ?? "info");
const minRank = LEVELS.indexOf(minLevel);
const scope = value("scope");
const job = value("job");
const grep = value("grep");

type Record_ = {
  ts: string;
  level: Level;
  scope: string;
  event: string;
  jobId?: number;
  [key: string]: unknown;
};

const rows: Record_[] = [];
for (const file of files) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record_;
      if (LEVELS.indexOf(row.level) < minRank) continue;
      if (scope && !row.scope.startsWith(scope)) continue;
      if (job && String(row.jobId ?? "") !== job) continue;
      if (grep && !line.toLowerCase().includes(grep.toLowerCase())) continue;
      rows.push(row);
    } catch {
      // A torn last line from a process killed mid-write; skip it.
    }
  }
}

if (flag("json")) {
  for (const row of rows) console.log(JSON.stringify(row));
  process.exit(0);
}

if (flag("spend")) {
  const finished = rows.filter(
    (r) => r.event === "job.finished" || r.event === "job.failed",
  );
  if (finished.length === 0) {
    console.log("No completed scrapes in the selected range.");
    process.exit(0);
  }

  let total = 0;
  console.log("job   status      requests   cost    businesses  leads");
  for (const row of finished) {
    const cost = Number(row.costUsd ?? 0);
    total += cost;
    const status = row.event === "job.failed" ? "failed" : String(row.status ?? "");
    console.log(
      [
        String(row.jobId ?? "?").padEnd(5),
        status.padEnd(11),
        String(row.requests ?? 0).padStart(8),
        `$${cost.toFixed(2)}`.padStart(7),
        String(row.businesses ?? 0).padStart(12),
        String(row.leads ?? 0).padStart(7),
      ].join(" "),
    );
  }
  console.log(`\ntotal list price: $${total.toFixed(2)} across ${finished.length} run(s)`);
  process.exit(0);
}

const COLOR: Record<Level, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

for (const row of rows) {
  const { ts, level, scope: rowScope, event, ...rest } = row;
  const detail = Object.entries(rest)
    .map(([key, val]) => `${key}=${typeof val === "object" ? JSON.stringify(val) : val}`)
    .join(" ");
  console.log(
    `${COLOR[level]}${ts.slice(11, 19)} ${level.toUpperCase().padEnd(5)}\x1b[0m ` +
      `\x1b[1m${rowScope}\x1b[0m ${event} \x1b[90m${detail}\x1b[0m`,
  );
}

if (rows.length === 0) console.log("Nothing matched.");
else console.error(`\n${rows.length} lines from ${files.length} file(s) in ${dir}`);
