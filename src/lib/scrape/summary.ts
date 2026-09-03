import { COST_PER_REQUEST_USD, RESULTS_PER_REQUEST } from "@/lib/places/pricing";
import { coarserCellRadius, finerCellRadius } from "./params";

/**
 * What a finished scrape actually tells you, and what to do about it.
 *
 * The raw counters answer "what happened". These answer the question that
 * follows: was the coverage complete, was the money well spent, and if not,
 * which settings would fix it. Pure and dependency-free so the thresholds can
 * be tested rather than argued about.
 */

export type Severity = "critical" | "warning" | "info" | "good";

/** Settings for a re-run, ready to drop straight into the scrape form. */
export type SuggestedParams = {
  cellRadius?: number;
  maxDepth?: number;
  maxRequests?: number;
  force?: boolean;
};

export type Recommendation = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Present when there is a concrete re-run worth offering. */
  apply?: SuggestedParams;
  applyLabel?: string;
};

export type JobFacts = {
  status: string;
  stoppedReason: string | null;
  error: string | null;
  requestsMade: number;
  estimatedCostUsd: number;
  resultsSeen: number;
  businessesFound: number;
  newBusinesses: number;
  leadsCreated: number;
  cellsTotal: number;
  cellsDone: number;
  cellsSkipped: number;
  saturatedCells: number;
  /** Resolved job params, as stored on the row. */
  cellRadius: number;
  maxDepth: number;
  maxRequests: number;
  categories: number;
};

export type JobContext = {
  /** Businesses with a site that has never been probed — the free extra pass. */
  uncheckedWebsites: number;
  /** Billable requests this calendar month, and the free allowance. */
  requestsThisMonth: number;
  freeTierLimit: number;
};

export type JobSummary = {
  outcome: "completed" | "partial" | "failed" | "cancelled" | "interrupted" | "running";
  headline: string;
  /** True when coverage is known to be incomplete and a re-run would add to it. */
  needsRerun: boolean;
  resultsPerRequest: number;
  leadRate: number;
  costPerLeadUsd: number | null;
  recommendations: Recommendation[];
};

/**
 * Saturated cells mean Google truncated the answer, so those results are
 * missing entirely. A stray one in a dense block is normal; a meaningful share
 * of the run means the grid was too coarse to see the area.
 */
const SATURATION_NOTABLE = 0.05;
const SATURATION_SERIOUS = 0.2;

/**
 * Each request can return 20 places. Averaging under this means most pages came
 * back half empty — full price for thin results, usually cells finer than the
 * area is dense.
 */
const LOW_YIELD = 5;
/** Below this many requests the average is noise, not a signal. */
const MIN_REQUESTS_TO_JUDGE_YIELD = 20;

/** Warn about the monthly allowance once this much of it is gone. */
const FREE_TIER_WARN_AT = 0.8;

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const usd = (requests: number) => round(requests * COST_PER_REQUEST_USD, 3);

function outcomeOf(facts: JobFacts): JobSummary["outcome"] {
  if (facts.status === "failed") return "failed";
  if (facts.status === "cancelled") return "cancelled";
  if (facts.status === "interrupted") return "interrupted";
  if (facts.status !== "completed") return "running";

  const truncated =
    facts.saturatedCells > 0 || Boolean(facts.stoppedReason?.includes("budget cap"));
  return truncated ? "partial" : "completed";
}

export function summarizeJob(facts: JobFacts, context: JobContext): JobSummary {
  const recommendations: Recommendation[] = [];

  const resultsPerRequest =
    facts.requestsMade > 0 ? round(facts.resultsSeen / facts.requestsMade, 1) : 0;
  const leadRate =
    facts.businessesFound > 0
      ? round((facts.leadsCreated / facts.businessesFound) * 100, 1)
      : 0;
  const costPerLeadUsd =
    facts.leadsCreated > 0 ? round(facts.estimatedCostUsd / facts.leadsCreated, 3) : null;

  const outcome = outcomeOf(facts);

  // ---- Something went wrong -------------------------------------------------

  if (outcome === "failed") {
    recommendations.push({
      id: "failed",
      severity: "critical",
      title: "The scrape failed",
      detail: `${facts.error ?? "No error recorded."} You were still billed for the ${
        facts.requestsMade
      } request${facts.requestsMade === 1 ? "" : "s"} it sent ($${facts.estimatedCostUsd.toFixed(
        2,
      )} list). Run "npm run logs -- --errors" for the API status and Google's error code.`,
    });
  }

  if (outcome === "interrupted") {
    recommendations.push({
      id: "interrupted",
      severity: "warning",
      title: "The server restarted mid-run",
      detail:
        "Everything found before the restart was saved, and the searches that completed are recorded as covered. Re-running picks up only what's left.",
      apply: {},
      applyLabel: "Re-run the rest",
    });
  }

  // ---- Coverage is incomplete ----------------------------------------------

  const saturationShare =
    facts.cellsDone > 0 ? facts.saturatedCells / facts.cellsDone : 0;

  if (facts.saturatedCells > 0) {
    const deeper = facts.maxDepth < 3 ? facts.maxDepth + 1 : null;
    const finer = finerCellRadius(facts.cellRadius);

    // Prefer more depth: it only spends money where the density actually is,
    // whereas a finer grid re-prices the whole area including its empty parts.
    const apply: SuggestedParams = deeper
      ? { maxDepth: deeper }
      : finer
        ? { cellRadius: finer }
        : {};

    const fix = deeper
      ? `Re-run at ${deeper} level${deeper === 1 ? "" : "s"} of subdivision.`
      : finer
        ? `Subdivision is already at its limit, so drop the grid to ${
            finer >= 1000 ? `${finer / 1000} km` : `${finer} m`
          } cells.`
        : "Already at the finest grid and deepest subdivision — split the area instead.";

    recommendations.push({
      id: "saturated",
      // Still worth acting on at any scale, but a stray truncated cell in a
      // large sweep is not the same alarm as a quarter of the run.
      severity:
        saturationShare >= SATURATION_SERIOUS
          ? "critical"
          : saturationShare >= SATURATION_NOTABLE
            ? "warning"
            : "info",
      title: `${facts.saturatedCells} search${
        facts.saturatedCells === 1 ? "" : "es"
      } hit Google's 60-result cap`,
      detail:
        `Those areas have more businesses than one query can return, so you are missing some. ${fix} ` +
        `Cells that were truncated are not recorded as covered, so the re-run pays only for them — not for the whole area again.`,
      apply: Object.keys(apply).length > 0 ? apply : undefined,
      applyLabel: deeper ? `Re-run at depth ${deeper}` : finer ? "Re-run on a finer grid" : undefined,
    });
  }

  const remainingSearches = Math.max(0, facts.cellsTotal - facts.cellsDone);
  // Only a real problem if work was actually left. A run whose last search
  // happens to land exactly on the cap is finished, not cut short, and telling
  // someone to raise the budget for zero remaining searches is noise.
  if (facts.stoppedReason?.includes("budget cap") && remainingSearches > 0) {
    // Enough headroom to finish the queue, with the same paging allowance the
    // estimate uses. Rounded up to something a human would type.
    const suggested = Math.max(
      facts.maxRequests * 2,
      Math.ceil((facts.requestsMade + remainingSearches * 1.6) / 10) * 10,
    );

    recommendations.push({
      id: "budget",
      severity: "warning",
      title: "Stopped early at the budget cap",
      detail:
        `${remainingSearches} search${remainingSearches === 1 ? "" : "es"} never ran. Raise the cap to about ` +
        `${suggested} ($${usd(suggested).toFixed(2)} list at most) and re-run — the searches that finished are ` +
        `recorded as covered, so you only pay for the remainder.`,
      apply: { maxRequests: suggested },
      applyLabel: `Re-run with a ${suggested}-request cap`,
    });
  }

  // ---- The money was spent badly -------------------------------------------

  if (
    facts.requestsMade >= MIN_REQUESTS_TO_JUDGE_YIELD &&
    resultsPerRequest < LOW_YIELD &&
    facts.saturatedCells === 0
  ) {
    const coarser = coarserCellRadius(facts.cellRadius);
    recommendations.push({
      id: "low_yield",
      severity: "warning",
      title: `Only ${resultsPerRequest} of ${RESULTS_PER_REQUEST} results per request`,
      detail: coarser
        ? `Most pages came back nearly empty, so you paid full price for thin results. The grid is finer than this ` +
          `area is dense — ${coarser >= 1000 ? `${coarser / 1000} km` : `${coarser} m`} cells would cover the same ` +
          `ground for fewer requests. Nothing was truncated, so no coverage is lost by going coarser.`
        : `Most pages came back nearly empty. This area is sparse for these categories — the grid is already as ` +
          `coarse as it goes, so try different categories rather than different geometry.`,
      apply: coarser ? { cellRadius: coarser, force: true } : undefined,
      applyLabel: coarser ? "Re-run on a coarser grid" : undefined,
    });
  }

  // ---- Nothing happened -----------------------------------------------------

  if (outcome !== "failed" && facts.cellsDone === 0 && facts.cellsSkipped > 0) {
    recommendations.push({
      id: "all_covered",
      severity: "good",
      title: "Everything was already covered",
      detail:
        `All ${facts.cellsSkipped} searches were swept recently enough to skip, so this run cost nothing. ` +
        `Tick "Re-sweep everything" if you think the listings have changed, or widen the area or categories.`,
      apply: { force: true },
      applyLabel: "Re-sweep anyway",
    });
  }

  if (outcome !== "failed" && facts.businessesFound > 0 && facts.newBusinesses === 0) {
    recommendations.push({
      id: "nothing_new",
      severity: "info",
      title: "No businesses you didn't already have",
      detail:
        "Every place returned was already in the database, refreshed rather than added. This ground is worked out — move to a neighbouring area or add categories.",
    });
  }

  // ---- Free follow-ups ------------------------------------------------------

  if (context.uncheckedWebsites > 0) {
    recommendations.push({
      id: "check_websites",
      severity: "info",
      title: `${context.uncheckedWebsites} website${
        context.uncheckedWebsites === 1 ? "" : "s"
      } worth probing`,
      detail:
        "Settings → Check for dead websites visits the sites of businesses that appear to have one and promotes the broken ones into leads. It uses no Places quota, so it is free.",
    });
  }

  if (facts.leadsCreated > 0 && leadRate < 15 && facts.businessesFound >= 20) {
    recommendations.push({
      id: "low_lead_rate",
      severity: "info",
      title: `Only ${leadRate}% of these businesses became leads`,
      detail:
        "Most of them already have a real website. Trades and beauty (fontanero, cerrajero, peluquería, estética) tend to convert better than categories where a website is standard.",
    });
  }

  // ---- Budget for the month -------------------------------------------------

  const monthShare =
    context.freeTierLimit > 0 ? context.requestsThisMonth / context.freeTierLimit : 0;

  if (monthShare >= FREE_TIER_WARN_AT) {
    const left = Math.max(0, context.freeTierLimit - context.requestsThisMonth);
    recommendations.push({
      id: "free_tier",
      severity: left === 0 ? "warning" : "info",
      title:
        left === 0
          ? "This month's free requests are gone"
          : `${left} free requests left this month`,
      detail:
        left === 0
          ? `Further requests bill at $${(COST_PER_REQUEST_USD * 1000).toFixed(0)} per 1,000. The coverage cache still applies, so repeat sweeps of the same ground stay free.`
          : `You have used ${context.requestsThisMonth} of ${context.freeTierLimit}. The allowance resets on the 1st.`,
    });
  }

  // ---- Headline -------------------------------------------------------------

  const needsRerun = recommendations.some(
    (item) => item.apply !== undefined && item.id !== "all_covered",
  );

  let headline: string;
  if (outcome === "failed") {
    headline = `Failed after ${facts.requestsMade} request${facts.requestsMade === 1 ? "" : "s"}.`;
  } else if (facts.cellsDone === 0 && facts.cellsSkipped > 0) {
    headline = "Nothing to do — every search was already covered.";
  } else {
    const found =
      `${facts.newBusinesses} new business${facts.newBusinesses === 1 ? "" : "es"}, ` +
      `${facts.leadsCreated} lead${facts.leadsCreated === 1 ? "" : "s"}`;
    const spend = `${facts.requestsMade} request${
      facts.requestsMade === 1 ? "" : "s"
    } ($${facts.estimatedCostUsd.toFixed(2)} list)`;
    headline =
      outcome === "partial"
        ? `${found} from ${spend} — but the sweep was cut short.`
        : `${found} from ${spend}.`;
  }

  return {
    outcome,
    headline,
    needsRerun,
    resultsPerRequest,
    leadRate,
    costPerLeadUsd,
    recommendations,
  };
}
