import { describe, expect, it } from "vitest";

import { summarizeJob, type JobContext, type JobFacts } from "./summary";

/**
 * These recommendations tell the user to spend money. Each one has to fire on
 * the right evidence, stay quiet otherwise, and suggest settings that would
 * actually change the outcome.
 */

const CLEAN: JobFacts = {
  status: "completed",
  stoppedReason: null,
  error: null,
  requestsMade: 100,
  estimatedCostUsd: 3.5,
  resultsSeen: 1400,
  businessesFound: 900,
  newBusinesses: 900,
  leadsCreated: 300,
  cellsTotal: 75,
  cellsDone: 75,
  cellsSkipped: 0,
  saturatedCells: 0,
  cellRadius: 500,
  maxDepth: 1,
  maxRequests: 288,
  categories: 3,
};

const QUIET: JobContext = {
  uncheckedWebsites: 0,
  requestsThisMonth: 100,
  freeTierLimit: 1000,
};

const ids = (facts: Partial<JobFacts> = {}, context: Partial<JobContext> = {}) =>
  summarizeJob({ ...CLEAN, ...facts }, { ...QUIET, ...context }).recommendations.map(
    (r) => r.id,
  );

const find = (
  id: string,
  facts: Partial<JobFacts> = {},
  context: Partial<JobContext> = {},
) =>
  summarizeJob({ ...CLEAN, ...facts }, { ...QUIET, ...context }).recommendations.find(
    (r) => r.id === id,
  );

describe("a clean run", () => {
  it("says nothing when there is nothing to say", () => {
    expect(ids()).toEqual([]);
  });

  it("reports it as complete, not needing a re-run", () => {
    const summary = summarizeJob(CLEAN, QUIET);
    expect(summary.outcome).toBe("completed");
    expect(summary.needsRerun).toBe(false);
    expect(summary.headline).toContain("900 new businesses");
    expect(summary.headline).toContain("300 leads");
  });

  it("computes the ratios that decide everything else", () => {
    const summary = summarizeJob(CLEAN, QUIET);
    expect(summary.resultsPerRequest).toBe(14);
    expect(summary.leadRate).toBeCloseTo(33.3, 1);
    expect(summary.costPerLeadUsd).toBeCloseTo(0.012, 3);
  });
});

describe("truncated coverage", () => {
  it("flags saturated cells and offers more depth first", () => {
    const rec = find("saturated", { saturatedCells: 4, maxDepth: 1 })!;
    expect(rec.apply).toBeDefined();
    // Depth targets only the dense spots; a finer grid re-prices empty ground too.
    expect(rec.apply).toEqual({ maxDepth: 2 });
    expect(rec.applyLabel).toContain("depth 2");
  });

  it("scales the alarm to how much of the run was truncated", () => {
    // A quarter of the sweep truncated means the grid was wrong for the area.
    expect(find("saturated", { saturatedCells: 20, cellsDone: 75 })!.severity).toBe(
      "critical",
    );
    // A meaningful minority: worth fixing.
    expect(find("saturated", { saturatedCells: 6, cellsDone: 75 })!.severity).toBe(
      "warning",
    );
    // One dense block in a big sweep: actionable, but not alarming.
    expect(find("saturated", { saturatedCells: 1, cellsDone: 400 })!.severity).toBe(
      "info",
    );
  });

  it("offers the same fix regardless of how loudly it says it", () => {
    for (const saturatedCells of [1, 6, 20]) {
      expect(find("saturated", { saturatedCells, cellsDone: 400 })!.apply).toEqual({
        maxDepth: 2,
      });
    }
  });

  it("falls back to a finer grid once depth is maxed out", () => {
    const rec = find("saturated", { saturatedCells: 3, maxDepth: 3, cellRadius: 800 })!;
    expect(rec.apply).toEqual({ cellRadius: 500 });
  });

  it("admits when there is nothing left to tune", () => {
    const rec = find("saturated", { saturatedCells: 3, maxDepth: 3, cellRadius: 500 })!;
    expect(rec.apply).toBeUndefined();
    expect(rec.detail).toContain("split the area");
  });

  it("marks the run partial rather than complete", () => {
    expect(summarizeJob({ ...CLEAN, saturatedCells: 1 }, QUIET).outcome).toBe("partial");
    expect(summarizeJob({ ...CLEAN, saturatedCells: 1 }, QUIET).needsRerun).toBe(true);
  });
});

describe("budget cap", () => {
  const STOPPED = {
    stoppedReason: "Stopped at the 100-request budget cap.",
    maxRequests: 100,
    requestsMade: 100,
    cellsTotal: 75,
    cellsDone: 40,
  };

  it("suggests a cap big enough to finish the queue", () => {
    const rec = find("budget", STOPPED)!;
    expect(rec.apply!.maxRequests).toBeGreaterThan(100);
    expect(rec.detail).toContain("35 searches never ran");
  });

  it("explains that the finished searches will not be paid for twice", () => {
    expect(find("budget", STOPPED)!.detail).toContain("only pay for the remainder");
  });

  it("stays quiet when the run finished on its own", () => {
    expect(ids()).not.toContain("budget");
  });

  it("stays quiet when the cap was reached with nothing left to do", () => {
    // Landing exactly on the cap after the last search is a finished run.
    // Telling someone to raise a budget for zero remaining searches is noise.
    expect(ids({ ...STOPPED, cellsDone: 75, cellsTotal: 75 })).not.toContain("budget");
  });

  it("writes the suggested spend as money", () => {
    const detail = find("budget", STOPPED)!.detail;
    expect(detail).toMatch(/\$\d+\.\d{2} list at most/);
  });
});

describe("low yield", () => {
  const THIN = { resultsSeen: 120, requestsMade: 100, cellRadius: 500 };

  it("flags pages coming back nearly empty and suggests coarser cells", () => {
    const rec = find("low_yield", THIN)!;
    expect(rec.apply).toEqual({ cellRadius: 800, force: true });
  });

  it("forces the re-run, since the same ground is already recorded as covered", () => {
    expect(find("low_yield", THIN)!.apply!.force).toBe(true);
  });

  it("does not fire when cells were saturating — that is the opposite problem", () => {
    expect(ids({ ...THIN, saturatedCells: 5 })).not.toContain("low_yield");
  });

  it("does not judge a sample too small to mean anything", () => {
    expect(ids({ resultsSeen: 10, requestsMade: 10 })).not.toContain("low_yield");
  });

  it("suggests different categories when the grid is already coarsest", () => {
    const rec = find("low_yield", { ...THIN, cellRadius: 2000 })!;
    expect(rec.apply).toBeUndefined();
    expect(rec.detail).toContain("different categories");
  });
});

describe("failures", () => {
  it("reports the error and what it still cost", () => {
    const rec = find("failed", {
      status: "failed",
      error: "PERMISSION_DENIED",
      requestsMade: 7,
      estimatedCostUsd: 0.245,
    })!;

    expect(rec.severity).toBe("critical");
    expect(rec.detail).toContain("PERMISSION_DENIED");
    expect(rec.detail).toContain("7 requests");
    expect(rec.detail).toContain("npm run logs");
  });

  it("offers to resume an interrupted run without re-buying what finished", () => {
    const rec = find("interrupted", { status: "interrupted" })!;
    expect(rec.apply).toEqual({});
    expect(rec.applyLabel).toContain("rest");
  });
});

describe("the coverage cache", () => {
  it("celebrates a free run instead of calling it a failure", () => {
    const rec = find("all_covered", {
      cellsDone: 0,
      cellsSkipped: 75,
      requestsMade: 0,
      businessesFound: 0,
      newBusinesses: 0,
      leadsCreated: 0,
      estimatedCostUsd: 0,
    })!;

    expect(rec.severity).toBe("good");
    expect(rec.apply).toEqual({ force: true });
  });

  it("does not call a free run a re-run that needs doing", () => {
    const summary = summarizeJob(
      { ...CLEAN, cellsDone: 0, cellsSkipped: 75, requestsMade: 0 },
      QUIET,
    );
    expect(summary.needsRerun).toBe(false);
    expect(summary.headline).toContain("already covered");
  });

  it("notes when a run found only things already stored", () => {
    expect(ids({ newBusinesses: 0 })).toContain("nothing_new");
  });
});

describe("free follow-ups and budget", () => {
  it("points at the free dead-website pass when there is something to probe", () => {
    expect(find("check_websites", {}, { uncheckedWebsites: 40 })!.detail).toContain(
      "no Places quota",
    );
    expect(ids({}, { uncheckedWebsites: 0 })).not.toContain("check_websites");
  });

  it("suggests better categories when few businesses qualify", () => {
    expect(ids({ businessesFound: 100, leadsCreated: 5 })).toContain("low_lead_rate");
    expect(ids()).not.toContain("low_lead_rate");
  });

  it("warns only as the monthly allowance runs down", () => {
    expect(ids({}, { requestsThisMonth: 500 })).not.toContain("free_tier");
    expect(ids({}, { requestsThisMonth: 850 })).toContain("free_tier");
    expect(find("free_tier", {}, { requestsThisMonth: 1000 })!.severity).toBe("warning");
  });
});

describe("robustness", () => {
  it("survives a job with zero of everything", () => {
    const summary = summarizeJob(
      {
        ...CLEAN,
        requestsMade: 0,
        resultsSeen: 0,
        businessesFound: 0,
        newBusinesses: 0,
        leadsCreated: 0,
        cellsTotal: 0,
        cellsDone: 0,
        estimatedCostUsd: 0,
      },
      QUIET,
    );

    expect(summary.resultsPerRequest).toBe(0);
    expect(summary.leadRate).toBe(0);
    expect(summary.costPerLeadUsd).toBeNull();
  });

  it("degrades rather than crashes when params could not be parsed", () => {
    const summary = summarizeJob(
      { ...CLEAN, saturatedCells: 2, cellRadius: 0, maxDepth: 0, maxRequests: 0 },
      QUIET,
    );
    expect(() => summary.recommendations).not.toThrow();
    expect(summary.recommendations.find((r) => r.id === "saturated")).toBeDefined();
  });

  it("never suggests a depth above what the form allows", () => {
    for (const maxDepth of [0, 1, 2, 3]) {
      const rec = find("saturated", { saturatedCells: 2, maxDepth });
      if (rec?.apply?.maxDepth != null) {
        expect(rec.apply.maxDepth).toBeLessThanOrEqual(3);
        expect(rec.apply.maxDepth).toBeGreaterThan(maxDepth);
      }
    }
  });
});
