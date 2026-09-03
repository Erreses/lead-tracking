import fs from "node:fs";
import path from "node:path";

/**
 * Structured logging, aimed at one question: after a scrape goes wrong, what
 * exactly did it do and what did it cost?
 *
 * Every line is a single JSON object, appended synchronously. Synchronous is
 * deliberate — a job that segfaults or gets killed mid-run must still leave the
 * lines that explain why, and a buffered stream would lose the last and most
 * interesting ones. Volume is a few hundred lines per scrape, so the cost is
 * irrelevant next to a Places round-trip.
 *
 * Nothing here may throw. A logger that takes down a paid scrape because a
 * directory is read-only is worse than no logger at all.
 */

export const LEVELS = ["debug", "info", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type Fields = Record<string, unknown>;

export type LogRecord = Fields & {
  ts: string;
  level: Level;
  scope: string;
  event: string;
};

/**
 * Google API keys, in any string we're about to write down. The env value is
 * redacted by exact match; the pattern catches a key that arrived some other
 * way — echoed back inside a Google error message, say, or pasted into a note.
 */
const GOOGLE_KEY_PATTERN = /AIza[0-9A-Za-z_-]{35}/g;
const REDACTED = "[redacted]";

/** Field names whose value is never safe to write, whatever it looks like. */
const SECRET_KEYS =
  /^(.*(api[-_]?key|apikey|authorization|password|secret|token|credential).*)$/i;

function redactString(value: string): string {
  let out = value.replace(GOOGLE_KEY_PATTERN, REDACTED);

  const configured = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (configured && configured.length >= 8) {
    out = out.split(configured).join(REDACTED);
  }

  return out;
}

/**
 * Strip secrets and make the value JSON-safe. Cycles and unserialisable values
 * are replaced rather than allowed to throw inside `JSON.stringify`.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // Stack traces can carry a key inside a URL from a fetch frame.
      stack: value.stack ? redactString(value.stack) : undefined,
      ...(value.cause ? { cause: redact(value.cause, seen) } : {}),
      // PlacesApiError and friends carry diagnostic fields worth keeping.
      ...Object.fromEntries(
        Object.entries(value as unknown as Fields)
          .filter(([key]) => !["name", "message", "stack", "cause"].includes(key))
          .map(([key, inner]) => [key, redact(inner, seen)]),
      ),
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) return value.map((item) => redact(item, seen));

    return Object.fromEntries(
      Object.entries(value as Fields).map(([key, inner]) => [
        key,
        SECRET_KEYS.test(key) ? REDACTED : redact(inner, seen),
      ]),
    );
  }

  return String(value);
}

export type LoggerOptions = {
  /** Directory for the JSONL files. Empty string disables file output. */
  dir: string;
  /** Lines below this level are dropped. */
  minLevel: Level;
  /** Mirror to stdout/stderr, for `next dev`. */
  console: boolean;
  /** Delete daily files older than this. */
  keepDays: number;
};

function envOptions(): LoggerOptions {
  const configured = process.env.LOG_LEVEL as Level | undefined;

  return {
    dir:
      process.env.LOG_DIR ??
      path.join(path.dirname(process.env.DATABASE_PATH ?? "data/leads.db"), "logs"),
    minLevel: configured && configured in LEVEL_RANK ? configured : "info",
    console: process.env.LOG_CONSOLE !== "0",
    keepDays: Number(process.env.LOG_KEEP_DAYS ?? 7),
  };
}

/** `app-2026-08-12.jsonl` — one file per day, so pruning is trivial. */
function fileFor(dir: string, when: Date): string {
  return path.join(dir, `app-${when.toISOString().slice(0, 10)}.jsonl`);
}

function pruneOldFiles(dir: string, keepDays: number): void {
  try {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(dir)) {
      if (!file.startsWith("app-") || !file.endsWith(".jsonl")) continue;
      const full = path.join(dir, file);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
  } catch {
    // Housekeeping only — never worth surfacing.
  }
}

export type Log = {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields, error?: unknown): void;
  /** A child logger that stamps every line with `fields` (e.g. a job id). */
  child(fields: Fields): Log;
  /** Milliseconds since this logger was created — for durations. */
  since(): number;
};

export type LoggerFactory = ((scope: string, base?: Fields) => Log) & {
  options: LoggerOptions;
  /** Current log file, or null when file output is off. */
  file(): string | null;
};

export function createLoggerFactory(overrides: Partial<LoggerOptions> = {}): LoggerFactory {
  const options: LoggerOptions = { ...envOptions(), ...overrides };
  let pruned = false;

  const write = (record: LogRecord) => {
    if (options.console) {
      const stream = record.level === "error" || record.level === "warn" ? "warn" : "log";
      const { ts, level, scope, event, ...rest } = record;
      const detail = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
      console[stream](`${ts.slice(11, 23)} ${level.toUpperCase()} [${scope}] ${event}${detail}`);
    }

    if (!options.dir) return;

    try {
      fs.mkdirSync(options.dir, { recursive: true });
      if (!pruned) {
        pruned = true;
        pruneOldFiles(options.dir, options.keepDays);
      }
      fs.appendFileSync(fileFor(options.dir, new Date()), `${JSON.stringify(record)}\n`);
    } catch {
      // Losing a log line must never take down the thing being logged.
    }
  };

  const make = (scope: string, base: Fields = {}): Log => {
    const startedAt = Date.now();

    const emit = (level: Level, event: string, fields?: Fields, error?: unknown) => {
      if (LEVEL_RANK[level] < LEVEL_RANK[options.minLevel]) return;

      let record: LogRecord;
      try {
        record = {
          ts: new Date().toISOString(),
          level,
          scope,
          event,
          ...(redact({ ...base, ...fields }) as Fields),
          ...(error === undefined ? {} : { err: redact(error) }),
        };
      } catch {
        record = {
          ts: new Date().toISOString(),
          level,
          scope,
          event,
          logError: "fields could not be serialised",
        };
      }

      write(record);
    };

    return {
      debug: (event, fields) => emit("debug", event, fields),
      info: (event, fields) => emit("info", event, fields),
      warn: (event, fields) => emit("warn", event, fields),
      error: (event, fields, error) => emit("error", event, fields, error),
      child: (fields) => make(scope, { ...base, ...fields }),
      since: () => Date.now() - startedAt,
    };
  };

  return Object.assign(make, {
    options,
    file: () => (options.dir ? fileFor(options.dir, new Date()) : null),
  });
}

/**
 * The app-wide logger. Held on `globalThis` so the dev server's hot reload
 * doesn't re-run the prune on every edit.
 */
const globalForLog = globalThis as unknown as { __leadTrackingLog?: LoggerFactory };

export const logger: LoggerFactory = (globalForLog.__leadTrackingLog ??=
  createLoggerFactory());
