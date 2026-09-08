"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type BuildStatus = "pending" | "fetching" | "generating" | "completed" | "failed";

type Build = {
  id: number;
  slug: string;
  status: BuildStatus;
  photoCount: number;
  costUsd: number;
  error: string | null;
  finishedAt: string | null;
};

type State = {
  build: Build | null;
  live: boolean;
  available: boolean;
  estimatedCostUsd: number;
};

/** What the user sees while each stage runs. */
const STAGE_LABEL: Record<BuildStatus, string> = {
  pending: "Starting…",
  fetching: "Fetching details and photos from Google…",
  generating: "Claude is writing the page…",
  completed: "Done",
  failed: "Failed",
};

const POLL_MS = 2000;

export function SiteGenerator({ leadId }: { leadId: number }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Survives re-renders without restarting the effect that owns it.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/site`);
      if (!res.ok) return null;
      const next = (await res.json()) as State;
      setState(next);
      return next;
    } catch {
      // A failed poll is not worth showing; the next one will most likely work.
      return null;
    }
  }, [leadId]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const next = await load();
      if (cancelled) return;

      // Keep polling only while there is something to watch.
      const active =
        next?.live || next?.build?.status === "pending" ||
        next?.build?.status === "fetching" || next?.build?.status === "generating";

      if (active) {
        timer.current = setTimeout(tick, POLL_MS);
      } else if (next?.build?.status === "completed") {
        // The build may have filled in the demo URL on the lead.
        router.refresh();
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, router]);

  const start = async (refresh: boolean) => {
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/leads/${leadId}/site`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not start the build.");
        return;
      }

      // Show "starting" immediately rather than waiting for the first poll.
      setState((prev) =>
        prev
          ? { ...prev, live: true, build: { ...(prev.build ?? {} as Build), id: body.buildId, slug: body.slug, status: "pending", error: null } }
          : prev,
      );

      const tick = async () => {
        const next = await load();
        const active =
          next?.live || next?.build?.status === "pending" ||
          next?.build?.status === "fetching" || next?.build?.status === "generating";
        if (active) timer.current = setTimeout(tick, POLL_MS);
        else router.refresh();
      };
      timer.current = setTimeout(tick, POLL_MS);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  const build = state.build;
  const running =
    state.live ||
    build?.status === "pending" ||
    build?.status === "fetching" ||
    build?.status === "generating";
  const done = build?.status === "completed" && !running;

  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Demo website</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Pulls everything Google has, then has Claude build a page.
          </p>
        </div>
      </div>

      {!state.available ? (
        <div className="space-y-3">
          {/* Generating needs the CLI; viewing does not. On the VPS the button
              is impossible but the finished page is committed and served, and
              that is the half your partner needs. */}
          {done && build ? (
            <a
              href={`/demos/${build.slug}/index.html`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              Open the site
            </a>
          ) : null}
          <p className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
            {done
              ? "Rebuilding needs the claude CLI, which only runs on the machine that generated this."
              : "No site yet. Generating needs the claude CLI and a Google Maps API key, so run it locally."}
          </p>
        </div>
      ) : running ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2 animate-pulse rounded-full bg-accent"
            />
            <span>{STAGE_LABEL[build?.status ?? "pending"]}</span>
          </div>
          <p className="text-xs text-ink-muted">
            This usually takes a minute or two. You can leave the page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {done && build ? (
            <>
              <a
                href={`/demos/${build.slug}/index.html`}
                target="_blank"
                rel="noreferrer"
                className="block rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
              >
                Open the site
              </a>
              <p className="text-xs text-ink-muted">
                {build.photoCount} photo{build.photoCount === 1 ? "" : "s"}
                {build.costUsd > 0
                  ? ` · cost $${build.costUsd.toFixed(3)}`
                  : " · reused cached details, free"}
              </p>
            </>
          ) : null}

          {build?.status === "failed" ? (
            <p className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-critical">
              {build.error ?? "The build failed."}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => start(done)}
            disabled={busy}
            className="w-full rounded-md border border-line px-3 py-2 text-sm font-medium transition-colors hover:border-line-strong disabled:opacity-50"
          >
            {done ? "Rebuild" : build?.status === "failed" ? "Try again" : "Generate site"}
          </button>

          {!done ? (
            <p className="text-xs text-ink-muted">
              About ${state.estimatedCostUsd.toFixed(3)} in Google API calls the
              first time; rebuilds reuse the details and cost nothing.
            </p>
          ) : null}

          {error ? <p className="text-xs text-critical">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
