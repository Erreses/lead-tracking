"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AREAS, getArea } from "@/config/areas";
import { CATEGORIES, CATEGORY_GROUPS, type Category } from "@/config/categories";
import { COST_PER_REQUEST_USD, RESULTS_PER_REQUEST } from "@/lib/places/pricing";
import { CELL_SIZES, defaultCellRadius } from "@/lib/scrape/params";
import type { JobSummary, SuggestedParams } from "@/lib/scrape/summary";

type FreeTier = {
  limit: number;
  used: number;
  remaining: number;
  covered: number;
  billable: number;
  minChargeUsd: number;
  expectedChargeUsd: number;
};

type Estimate = {
  cells: number;
  categories: number;
  maxDepth: number;
  searches: number;
  coveredSearches: number;
  newSearches: number;
  minRequests: number;
  expectedRequests: number;
  minCostUsd: number;
  expectedCostUsd: number;
  suggestedMaxRequests: number;
  suggestedMaxCostUsd: number;
  minResults: number;
  expectedResults: number;
  suggestedMaxResults: number;
  freeTier: FreeTier;
};

type Job = {
  id: number;
  areaName: string;
  status: string;
  cellsTotal: number;
  cellsDone: number;
  requestsMade: number;
  estimatedCostUsd: number;
  resultsSeen: number;
  businessesFound: number;
  newBusinesses: number;
  leadsCreated: number;
  saturatedCells: number;
  cellsSkipped: number;
  stoppedReason: string | null;
  error: string | null;
};

const num = (value: number) => value.toLocaleString("en-US");

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

const SEVERITY_STYLE: Record<JobSummary["recommendations"][number]["severity"], string> = {
  critical: "border-critical/40 bg-critical/5",
  warning: "border-serious/40 bg-serious/5",
  info: "border-line bg-card-muted",
  good: "border-good/40 bg-good/5",
};

const SEVERITY_DOT: Record<JobSummary["recommendations"][number]["severity"], string> = {
  critical: "bg-critical",
  warning: "bg-serious",
  info: "bg-ink-muted",
  good: "bg-good",
};

const groupedCategories = Object.entries(CATEGORY_GROUPS).map(([group, label]) => ({
  group: group as Category["group"],
  label,
  items: CATEGORIES.filter((c) => c.group === group),
}));

export function ScrapeForm({ hasApiKey }: { hasApiKey: boolean }) {
  const [areaSlug, setAreaSlug] = useState("madrid-centro");
  const [selected, setSelected] = useState<string[]>([
    "peluqueria",
    "barberia",
    "restaurante",
  ]);
  const [cellRadiusOverride, setCellRadiusOverride] = useState<number | null>(null);
  const [maxDepth, setMaxDepth] = useState(1);
  const [budget, setBudget] = useState<number | null>(null);
  const [force, setForce] = useState(false);
  const [backup, setBackup] = useState<string | null>(null);

  const [rawEstimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [job, setJob] = useState<Job | null>(null);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const area = getArea(areaSlug);
  const running = job != null && !TERMINAL.has(job.status);

  // The cell size follows the area unless you pick one explicitly, so switching
  // from a district to a whole city doesn't silently cost 20× more.
  const [lastAreaSlug, setLastAreaSlug] = useState(areaSlug);
  if (areaSlug !== lastAreaSlug) {
    setLastAreaSlug(areaSlug);
    setCellRadiusOverride(null);
  }
  const cellRadius =
    cellRadiusOverride ?? (area ? defaultCellRadius(area.radius) : 500);

  // A stale estimate must never be shown against an empty category list.
  const estimate = selected.length === 0 ? null : rawEstimate;

  const requestBody = useMemo(
    () => ({
      areaSlug,
      categories: selected,
      cellRadius,
      maxDepth,
      maxRequests: budget ?? estimate?.suggestedMaxRequests ?? 500,
      force,
    }),
    [
      areaSlug,
      selected,
      cellRadius,
      maxDepth,
      budget,
      force,
      estimate?.suggestedMaxRequests,
    ],
  );

  // Re-price whenever the shape of the job changes. Debounced so dragging
  // through categories doesn't fire a request per keystroke.
  useEffect(() => {
    if (selected.length === 0) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      setEstimating(true);
      try {
        const res = await fetch("/api/jobs/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            areaSlug,
            categories: selected,
            cellRadius,
            maxDepth,
            maxRequests: 1,
            force,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Could not estimate");
        setEstimate(data.estimate);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [areaSlug, selected, cellRadius, maxDepth, force]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    (jobId: number) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Lost track of the job");
          setJob(data.job);
          setSummary(data.summary ?? null);
          if (TERMINAL.has(data.job.status)) stopPolling();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          stopPolling();
        }
      }, 1500);
    },
    [stopPolling],
  );

  useEffect(() => stopPolling, [stopPolling]);

  /**
   * Load a recommendation's settings into the form. Deliberately does not start
   * the run — the price changes, and you should see the new number first.
   */
  function applySuggestion(id: string, params: SuggestedParams) {
    if (params.cellRadius != null) setCellRadiusOverride(params.cellRadius);
    if (params.maxDepth != null) setMaxDepth(params.maxDepth);
    if (params.maxRequests != null) setBudget(params.maxRequests);
    if (params.force != null) setForce(params.force);
    setApplied(id);
  }

  async function start() {
    setStarting(true);
    setError(null);
    setSummary(null);
    setApplied(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the scrape");

      setBackup(data.backup ?? null);
      if (data.backupError) {
        setError(`Scrape started, but the safety backup failed: ${data.backupError}`);
      }

      setJob({
        id: data.id,
        areaName: area?.label ?? areaSlug,
        status: "running",
        cellsTotal: estimate?.newSearches ?? 0,
        cellsDone: 0,
        requestsMade: 0,
        estimatedCostUsd: 0,
        resultsSeen: 0,
        businessesFound: 0,
        newBusinesses: 0,
        leadsCreated: 0,
        saturatedCells: 0,
        cellsSkipped: estimate?.coveredSearches ?? 0,
        stoppedReason: null,
        error: null,
      });
      poll(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!job) return;
    await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
  }

  function toggleCategory(slug: string) {
    setSelected((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );
  }

  function toggleGroup(items: Category[]) {
    const slugs = items.map((i) => i.slug);
    const allOn = slugs.every((s) => selected.includes(s));
    setSelected((current) =>
      allOn
        ? current.filter((s) => !slugs.includes(s))
        : [...new Set([...current, ...slugs])],
    );
  }

  const budgetValue = budget ?? estimate?.suggestedMaxRequests ?? 500;
  const requestsLeft = Math.max(0, budgetValue - (job?.requestsMade ?? 0));
  const progress =
    job && job.cellsTotal > 0
      ? Math.min(100, (job.cellsDone / job.cellsTotal) * 100)
      : 0;

  return (
    <div className="space-y-5">
      {!hasApiKey ? (
        <div className="rounded-xl border border-line bg-card-muted px-4 py-3 text-sm">
          <span className="font-medium text-serious">No API key configured.</span>{" "}
          <span className="text-ink-secondary">
            Add <code className="font-mono text-xs">GOOGLE_MAPS_API_KEY</code> to{" "}
            <code className="font-mono text-xs">.env.local</code> and restart the dev
            server. You can still price a sweep below without one.
          </span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold tracking-tight">Where</h2>

            <label className="block text-xs text-ink-muted" htmlFor="area">
              Area
            </label>
            <select
              id="area"
              value={areaSlug}
              onChange={(e) => setAreaSlug(e.target.value)}
              disabled={running}
              className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm disabled:opacity-60"
            >
              <optgroup label="Cities">
                {AREAS.filter((a) => !a.parent).map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.label} · {(a.radius / 1000).toFixed(1)} km
                  </option>
                ))}
              </optgroup>
              <optgroup label="Madrid districts">
                {AREAS.filter((a) => a.parent === "madrid").map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.label} · {(a.radius / 1000).toFixed(1)} km
                  </option>
                ))}
              </optgroup>
            </select>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-ink-muted" htmlFor="cell">
                  Grid density
                </label>
                <select
                  id="cell"
                  value={cellRadius}
                  onChange={(e) => setCellRadiusOverride(Number(e.target.value))}
                  disabled={running}
                  className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm disabled:opacity-60"
                >
                  {CELL_SIZES.map((size) => (
                    <option key={size.value} value={size.value}>
                      {size.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-muted">
                  Smaller cells find more, and cost more.
                </p>
              </div>

              <div>
                <label className="block text-xs text-ink-muted" htmlFor="depth">
                  Auto-subdivide
                </label>
                <select
                  id="depth"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(Number(e.target.value))}
                  disabled={running}
                  className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm disabled:opacity-60"
                >
                  <option value={0}>Off</option>
                  <option value={1}>1 level</option>
                  <option value={2}>2 levels</option>
                  <option value={3}>3 levels</option>
                </select>
                <p className="mt-1 text-xs text-ink-muted">
                  Google caps each query at 60 results. Full cells get split and
                  re-searched.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-tight">
                What
                <span className="ml-2 font-normal text-ink-muted">
                  {selected.length} selected
                </span>
              </h2>
              {selected.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  disabled={running}
                  className="text-xs text-ink-muted hover:text-ink disabled:opacity-60"
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="space-y-4">
              {groupedCategories.map(({ group, label, items }) => (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(items)}
                    disabled={running}
                    className="mb-1.5 text-xs font-medium text-ink-secondary hover:text-accent disabled:opacity-60"
                  >
                    {label}
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((category) => {
                      const on = selected.includes(category.slug);
                      return (
                        <button
                          key={category.slug}
                          type="button"
                          onClick={() => toggleCategory(category.slug)}
                          disabled={running}
                          aria-pressed={on}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
                            on
                              ? "border-accent bg-accent-soft font-medium text-accent"
                              : "border-line text-ink-secondary hover:border-line-strong hover:text-ink"
                          }`}
                        >
                          {category.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cost preview and controls stay visible while you tune the form. */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="text-sm font-semibold tracking-tight">Before you run</h2>

            {selected.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted">Pick at least one category.</p>
            ) : (
              <>
                <dl className="mt-4 space-y-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Grid cells</dt>
                    <dd className="tnum font-medium">{estimate?.cells ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Categories</dt>
                    <dd className="tnum font-medium">{selected.length}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Searches</dt>
                    <dd className="tnum font-medium">
                      {estimate ? num(estimate.searches) : "—"}
                    </dd>
                  </div>
                  {/* Skipping what a recent run already covered is the only
                      lever that makes a repeat sweep cheaper. */}
                  {estimate && estimate.coveredSearches > 0 ? (
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-secondary">Already covered</dt>
                      <dd className="tnum font-medium text-good">
                        −{num(estimate.coveredSearches)} skipped
                      </dd>
                    </div>
                  ) : null}

                  <div className="flex justify-between gap-3 border-t border-line pt-2.5">
                    <dt className="text-ink-secondary">Requests</dt>
                    <dd className="tnum font-medium">
                      {estimate
                        ? `${num(estimate.minRequests)}–${num(estimate.expectedRequests)}`
                        : "—"}
                    </dd>
                  </div>
                  {/* Requests are what you buy; businesses are what you want. */}
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Businesses reachable</dt>
                    <dd className="tnum font-medium">
                      {estimate ? `up to ${num(estimate.expectedResults)}` : "—"}
                    </dd>
                  </div>

                  <div className="flex justify-between gap-3 border-t border-line pt-2.5">
                    <dt className="text-ink-secondary">Free requests left</dt>
                    <dd className="tnum font-medium">
                      {estimate
                        ? `${num(estimate.freeTier.remaining)} of ${num(estimate.freeTier.limit)}`
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">You&apos;d be charged</dt>
                    <dd
                      className={`tnum font-semibold ${
                        estimate && estimate.freeTier.expectedChargeUsd === 0
                          ? "text-good"
                          : ""
                      }`}
                    >
                      {estimate
                        ? estimate.freeTier.expectedChargeUsd === 0
                          ? "$0.00"
                          : `$${estimate.freeTier.minChargeUsd.toFixed(2)}–$${estimate.freeTier.expectedChargeUsd.toFixed(2)}`
                        : "—"}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs text-ink-muted">
                  Text Search Enterprise is $35 per 1,000 requests, and the first 1,000
                  each month are free. Each request returns up to{" "}
                  {RESULTS_PER_REQUEST} businesses.
                  {estimate ? (
                    <>
                      {" "}
                      This sweep is{" "}
                      <span className="tnum">
                        ${estimate.minCostUsd.toFixed(2)}–$
                        {estimate.expectedCostUsd.toFixed(2)}
                      </span>{" "}
                      at list price
                      {estimate.freeTier.expectedChargeUsd === 0
                        ? ", covered by this month's free allowance."
                        : `, of which ${num(estimate.freeTier.covered)} requests are free.`}
                    </>
                  ) : null}
                </p>

                <div className="mt-4 border-t border-line pt-4">
                  <label className="block text-xs text-ink-muted" htmlFor="budget">
                    Stop after
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="budget"
                      type="number"
                      min={1}
                      value={budgetValue}
                      onChange={(e) => setBudget(Number(e.target.value) || 1)}
                      disabled={running}
                      className="tnum w-24 rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm disabled:opacity-60"
                    />
                    <span className="text-xs text-ink-muted">
                      requests (${(budgetValue * COST_PER_REQUEST_USD).toFixed(2)} max)
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    A hard cap, worth up to {num(budgetValue * RESULTS_PER_REQUEST)}{" "}
                    businesses. The job stops cleanly here and keeps everything it found.
                  </p>

                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                      disabled={running}
                      className="mt-0.5 accent-[var(--accent)] disabled:opacity-60"
                    />
                    <span className="text-ink-secondary">
                      Re-sweep everything
                      <span className="block text-ink-muted">
                        Ignore what recent runs already covered and pay for it again.
                        Use when listings may have changed.
                      </span>
                    </span>
                  </label>
                </div>
              </>
            )}

            {error ? (
              <p className="mt-4 rounded-lg bg-card-muted px-3 py-2 text-xs text-critical">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={start}
              disabled={running || starting || selected.length === 0 || !hasApiKey}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting
                ? "Starting…"
                : running
                  ? "Scraping…"
                  : estimating
                    ? "Pricing…"
                    : "Start scrape"}
            </button>
          </div>

          {job ? (
            <div className="mt-5 rounded-xl border border-line bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-tight">
                  {running ? "Scraping" : "Finished"}
                </h2>
                {running ? (
                  <button
                    type="button"
                    onClick={cancel}
                    className="text-xs text-ink-muted hover:text-critical"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-r-[4px] bg-accent transition-[width] duration-500"
                  style={{ width: `${Math.max(progress, 2)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-ink-muted">
                {job.cellsDone} of {job.cellsTotal} searches
                {job.cellsTotal > (estimate?.newSearches ?? 0)
                  ? " (grew from subdividing dense cells)"
                  : ""}
                {job.cellsSkipped > 0
                  ? ` · ${num(job.cellsSkipped)} skipped as already covered, saving $${(
                      job.cellsSkipped * COST_PER_REQUEST_USD
                    ).toFixed(2)}+`
                  : ""}
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-muted">Businesses</dt>
                  <dd className="tnum font-semibold">{num(job.businessesFound)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">New leads</dt>
                  <dd className="tnum font-semibold text-accent">
                    {num(job.leadsCreated)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Requests</dt>
                  <dd className="tnum font-semibold">
                    {num(job.requestsMade)}
                    <span className="font-normal text-ink-muted">
                      {" "}
                      / {num(budgetValue)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">List price</dt>
                  <dd className="tnum font-semibold">
                    ${job.estimatedCostUsd.toFixed(2)}
                  </dd>
                </div>
              </dl>

              {/* What the budget still buys, and how much of each request it's
                  actually using. A run averaging 3 of a possible 20 results per
                  request is paying full price for near-empty pages. */}
              <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
                {requestsLeft > 0
                  ? `${num(requestsLeft)} requests left in the budget — room for up to ${num(
                      requestsLeft * RESULTS_PER_REQUEST,
                    )} more businesses.`
                  : "Budget spent."}
                {job.requestsMade > 0
                  ? ` Averaging ${(job.resultsSeen / job.requestsMade).toFixed(1)} of ${RESULTS_PER_REQUEST} results per request.`
                  : ""}
              </p>
              {job.resultsSeen > job.businessesFound ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {num(job.resultsSeen)} results returned,{" "}
                  {num(job.businessesFound)} distinct businesses — cells overlap and
                  a business can match several categories.
                </p>
              ) : null}

              {backup ? (
                <p className="mt-3 text-xs text-ink-muted">
                  Database backed up to{" "}
                  <code className="font-mono">data/backups/{backup}</code> before this
                  run.
                </p>
              ) : null}
              {job.stoppedReason ? (
                <p className="mt-3 text-xs text-ink-muted">{job.stoppedReason}</p>
              ) : null}
              {job.saturatedCells > 0 ? (
                <p className="mt-3 text-xs text-serious">
                  {job.saturatedCells} cells still hit the 60-result cap at the deepest
                  level — coverage there may be incomplete. Try a smaller grid or more
                  subdivision levels.
                </p>
              ) : null}
              {job.error ? (
                <p className="mt-3 text-xs text-critical">{job.error}</p>
              ) : null}

              {!running && job.leadsCreated > 0 ? (
                <Link
                  href="/leads"
                  className="mt-4 block rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
                >
                  See {job.leadsCreated} new leads
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* What the run actually means, and what to do next. Only once it's
              over — mid-run counters would give advice that contradicts itself
              as the numbers move. */}
          {summary ? (
            <div className="mt-5 rounded-xl border border-line bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-tight">Results</h2>
                {summary.needsRerun ? (
                  <span className="rounded-full bg-serious/10 px-2 py-0.5 text-xs font-medium text-serious">
                    Re-run suggested
                  </span>
                ) : summary.outcome === "completed" ? (
                  <span className="rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">
                    Complete
                  </span>
                ) : null}
              </div>

              <p className="mt-2 text-sm text-ink-secondary">{summary.headline}</p>

              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                <div>
                  <dt className="text-xs text-ink-muted">Results/request</dt>
                  <dd className="tnum font-semibold">
                    {summary.resultsPerRequest}
                    <span className="font-normal text-ink-muted">
                      {" "}
                      / {RESULTS_PER_REQUEST}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Lead rate</dt>
                  <dd className="tnum font-semibold">{summary.leadRate}%</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Cost/lead</dt>
                  <dd className="tnum font-semibold">
                    {summary.costPerLeadUsd == null
                      ? "—"
                      : `$${summary.costPerLeadUsd.toFixed(3)}`}
                  </dd>
                </div>
              </dl>

              {summary.recommendations.length > 0 ? (
                <ul className="mt-4 space-y-2.5">
                  {summary.recommendations.map((item) => (
                    <li
                      key={item.id}
                      className={`rounded-lg border px-3 py-2.5 ${SEVERITY_STYLE[item.severity]}`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                            SEVERITY_DOT[item.severity]
                          }`}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium">{item.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                            {item.detail}
                          </p>
                          {item.apply ? (
                            <button
                              type="button"
                              onClick={() => applySuggestion(item.id, item.apply!)}
                              disabled={running}
                              className="mt-2 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
                            >
                              {applied === item.id
                                ? "Applied — check the price above"
                                : (item.applyLabel ?? "Use these settings")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-xs text-ink-muted">
                  Nothing to flag — coverage was complete and the spend was
                  proportionate.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
