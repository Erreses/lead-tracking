"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AREAS, getArea } from "@/config/areas";
import { CATEGORIES, CATEGORY_GROUPS, type Category } from "@/config/categories";
import { defaultCellRadius } from "@/lib/scrape/params";

type Estimate = {
  cells: number;
  categories: number;
  minRequests: number;
  expectedRequests: number;
  minCostUsd: number;
  expectedCostUsd: number;
  suggestedMaxRequests: number;
  suggestedMaxCostUsd: number;
};

type Job = {
  id: number;
  areaName: string;
  status: string;
  cellsTotal: number;
  cellsDone: number;
  requestsMade: number;
  estimatedCostUsd: number;
  businessesFound: number;
  newBusinesses: number;
  leadsCreated: number;
  saturatedCells: number;
  stoppedReason: string | null;
  error: string | null;
};

const CELL_SIZES = [
  { value: 2000, label: "2 km — cheapest sweep" },
  { value: 1500, label: "1.5 km — balanced" },
  { value: 1000, label: "1 km — thorough" },
  { value: 800, label: "800 m — dense areas" },
  { value: 500, label: "500 m — very dense" },
];

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

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

  const [rawEstimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [job, setJob] = useState<Job | null>(null);
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
    }),
    [areaSlug, selected, cellRadius, maxDepth, budget, estimate?.suggestedMaxRequests],
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
  }, [areaSlug, selected, cellRadius, maxDepth]);

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

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the scrape");

      setJob({
        id: data.id,
        areaName: area?.label ?? areaSlug,
        status: "running",
        cellsTotal: estimate?.cells ?? 0,
        cellsDone: 0,
        requestsMade: 0,
        estimatedCostUsd: 0,
        businessesFound: 0,
        newBusinesses: 0,
        leadsCreated: 0,
        saturatedCells: 0,
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
                  <div className="flex justify-between gap-3 border-t border-line pt-2.5">
                    <dt className="text-ink-secondary">Requests</dt>
                    <dd className="tnum font-medium">
                      {estimate ? `${estimate.minRequests}–${estimate.expectedRequests}` : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-secondary">Estimated cost</dt>
                    <dd className="tnum font-semibold">
                      {estimate
                        ? `$${estimate.minCostUsd.toFixed(2)}–$${estimate.expectedCostUsd.toFixed(2)}`
                        : "—"}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs text-ink-muted">
                  Text Search Enterprise is $35 per 1,000 requests, and the first 1,000
                  each month are free. Each request returns up to 20 businesses.
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
                      requests (${(budgetValue * 0.035).toFixed(2)} max)
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    A hard cap. The job stops cleanly here and keeps everything it found.
                  </p>
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
                {job.cellsDone} of {job.cellsTotal} cells
                {job.cellsTotal > (estimate?.cells ?? 0) * selected.length
                  ? " (grew from subdividing dense cells)"
                  : ""}
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-muted">Businesses</dt>
                  <dd className="tnum font-semibold">{job.businessesFound}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">New leads</dt>
                  <dd className="tnum font-semibold text-accent">{job.leadsCreated}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Requests</dt>
                  <dd className="tnum font-semibold">{job.requestsMade}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Spent</dt>
                  <dd className="tnum font-semibold">
                    ${job.estimatedCostUsd.toFixed(2)}
                  </dd>
                </div>
              </dl>

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
        </div>
      </div>
    </div>
  );
}
