import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLoggerFactory, redact, type LogRecord } from "./log";

/** A key-shaped string, matching Google's `AIza` + 35 chars format. */
const FAKE_KEY = `AIza${"Sy0123456789abcdefghijklmnopqrstuvw".slice(0, 35)}`;

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lead-tracking-log-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.GOOGLE_MAPS_API_KEY;
});

function read(): LogRecord[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  return files.flatMap((file) =>
    fs
      .readFileSync(path.join(dir, file), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogRecord),
  );
}

const make = (minLevel: "debug" | "info" | "warn" | "error" = "debug") =>
  createLoggerFactory({ dir, console: false, minLevel, keepDays: 7 });

/**
 * The logger writes to disk on every scrape. If it ever wrote the API key, the
 * key would be sitting in a plain file — so these come first.
 */
describe("redaction", () => {
  it("removes anything shaped like a Google API key", () => {
    expect(redact(`key=${FAKE_KEY}&q=x`)).toBe("key=[redacted]&q=x");
    expect(String(redact(FAKE_KEY))).not.toContain("AIza");
  });

  it("removes the configured key even if it isn't AIza-shaped", () => {
    process.env.GOOGLE_MAPS_API_KEY = "totally-custom-secret-value";
    expect(redact("called with totally-custom-secret-value")).toBe(
      "called with [redacted]",
    );
  });

  it("redacts by field name whatever the value looks like", () => {
    const out = redact({
      apiKey: "plain",
      "X-Goog-Api-Key": "plain",
      authorization: "Bearer abc",
      password: "hunter2",
      token: "t",
      safe: "keep me",
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe("[redacted]");
    expect(out["X-Goog-Api-Key"]).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.safe).toBe("keep me");
  });

  it("scrubs keys hidden in nested values and error stacks", () => {
    const error = new Error(`GET https://places.googleapis.com/?key=${FAKE_KEY} failed`);
    const out = JSON.stringify(redact({ nested: { deep: [FAKE_KEY] }, error }));

    expect(out).not.toContain("AIza");
    expect(out).toContain("[redacted]");
  });

  it("never lets the key reach the file", () => {
    process.env.GOOGLE_MAPS_API_KEY = FAKE_KEY;
    const log = make()("places");
    log.error("request.failed", { url: `https://x/?key=${FAKE_KEY}` }, new Error(FAKE_KEY));

    const raw = fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("");
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).toContain("[redacted]");
  });
});

describe("serialisation", () => {
  it("keeps an error's diagnostic fields, not just its message", () => {
    const error = Object.assign(new Error("boom"), { status: 403, code: "DENIED" });
    const out = redact(error) as Record<string, unknown>;

    expect(out.message).toBe("boom");
    expect(out.status).toBe(403);
    expect(out.code).toBe("DENIED");
    expect(out.stack).toContain("Error: boom");
  });

  it("survives circular structures instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() => JSON.stringify(redact(circular))).not.toThrow();
    expect((redact(circular) as Record<string, unknown>).self).toBe("[circular]");
  });

  it("writes one JSON object per line", () => {
    const log = make()("scrape");
    log.info("a", { n: 1 });
    log.info("b", { n: 2 });

    const rows = read();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ scope: "scrape", event: "a", n: 1, level: "info" });
    expect(rows[1]).toMatchObject({ event: "b", n: 2 });
    expect(Date.parse(rows[0].ts)).not.toBeNaN();
  });
});

describe("levels and context", () => {
  it("drops lines below the configured level", () => {
    const log = make("warn")("scrape");
    log.debug("nope");
    log.info("nope");
    log.warn("yes");
    log.error("yes too");

    expect(read().map((r) => r.event)).toEqual(["yes", "yes too"]);
  });

  it("stamps child context onto every line", () => {
    const log = make()("scrape").child({ jobId: 7 });
    log.info("job.start");
    log.child({ category: "peluqueria" }).info("cell.done");

    const rows = read();
    expect(rows[0].jobId).toBe(7);
    expect(rows[1]).toMatchObject({ jobId: 7, category: "peluqueria" });
  });

  it("reports elapsed time for durations", () => {
    const log = make()("scrape");
    expect(log.since()).toBeGreaterThanOrEqual(0);
    expect(log.since()).toBeLessThan(5000);
  });
});

/**
 * A logger that throws takes down a paid scrape with it. Every failure mode
 * here has to end in "carry on".
 */
describe("never throws", () => {
  it("swallows an unwritable directory", () => {
    const factory = createLoggerFactory({
      dir: "/proc/definitely/not/writable",
      console: false,
      minLevel: "debug",
      keepDays: 7,
    });

    expect(() => factory("scope").error("boom", { a: 1 }, new Error("x"))).not.toThrow();
  });

  it("still logs when a field cannot be serialised", () => {
    const log = make()("scope");
    const hostile = {
      get boom() {
        throw new Error("getter exploded");
      },
    };

    expect(() => log.info("event", { hostile })).not.toThrow();
    const rows = read();
    expect(rows).toHaveLength(1);
    expect(rows[0].event).toBe("event");
  });

  it("handles values JSON does not model", () => {
    const log = make()("scope");
    log.info("odd", {
      big: BigInt(10),
      fn: () => {},
      sym: Symbol("s"),
      when: new Date(0),
    });

    const row = read()[0];
    expect(row.big).toBe("10");
    expect(row.when).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("file management", () => {
  it("writes one file per day and reports the current one", () => {
    const factory = make();
    factory("scope").info("hello");

    const file = factory.file()!;
    expect(path.basename(file)).toMatch(/^app-\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("prunes files older than the retention window", () => {
    const stale = path.join(dir, "app-2020-01-01.jsonl");
    fs.writeFileSync(stale, '{"ts":"2020-01-01T00:00:00.000Z"}\n');
    fs.utimesSync(stale, new Date(0), new Date(0));

    make()("scope").info("triggers the prune");

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.readdirSync(dir).length).toBe(1);
  });

  it("can be turned off entirely", () => {
    const factory = createLoggerFactory({
      dir: "",
      console: false,
      minLevel: "debug",
      keepDays: 7,
    });
    factory("scope").info("nowhere");

    expect(factory.file()).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
