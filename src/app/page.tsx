import Link from "next/link";

import {
  BarList,
  Card,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatTile,
  formatCompact,
  formatMoney,
} from "@/components/ui";
import { getCategory } from "@/config/categories";
import { WEBSITE_CLASS_LABELS } from "@/lib/leads/classify";
import { getApiUsage, getOverview } from "@/lib/leads/stats";
import { hasApiKey } from "@/lib/places/client";

// Reads SQLite on every request; there is nothing to prerender at build time.
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const stats = await getOverview();
  const usage = await getApiUsage();
  const keyPresent = hasApiKey();

  const conversion =
    stats.totalLeads > 0 ? ((stats.won / stats.totalLeads) * 100).toFixed(1) : "0.0";

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Local businesses with no real website, and where each one sits in your pipeline."
        action={
          <Link
            href="/scrape"
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Run a scrape
          </Link>
        }
      />

      {!keyPresent ? (
        <div className="mb-6 rounded-xl border border-line bg-card-muted px-4 py-3 text-sm">
          <span className="font-medium text-serious">No API key configured.</span>{" "}
          <span className="text-ink-secondary">
            Add <code className="font-mono text-xs">GOOGLE_MAPS_API_KEY</code> to{" "}
            <code className="font-mono text-xs">.env.local</code> and restart the dev
            server before scraping. See the README for how to create one.
          </span>
        </div>
      ) : null}

      {stats.totalBusinesses === 0 ? (
        <EmptyState
          title="Nothing scraped yet"
          action={
            <Link
              href="/scrape"
              className="inline-block rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
            >
              Run your first scrape
            </Link>
          }
        >
          Pick an area and some categories, and the scraper will sweep Google Maps for
          businesses with no website of their own.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <section>
            {/* The one number the dashboard leads with. */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                hero
                label="Leads worth pitching"
                value={formatCompact(stats.totalLeads)}
                note={`from ${formatCompact(stats.totalBusinesses)} businesses scraped`}
              />
              <StatTile
                label="Open pipeline"
                value={formatMoney(stats.openPipeline)}
                note="Quoted, not yet won or lost"
              />
              <StatTile
                label="Won"
                value={formatMoney(stats.wonValue)}
                tone={stats.wonValue > 0 ? "good" : undefined}
                note={`${stats.won} sold · ${conversion}% of leads`}
              />
              <StatTile
                label="Places API this month"
                value={
                  usage.costUsd > 0 ? `$${usage.costUsd.toFixed(2)}` : "Free"
                }
                note={
                  usage.freeRemaining > 0
                    ? `${formatCompact(usage.freeRemaining)} of ${formatCompact(usage.freeTier)} free requests left`
                    : `${formatCompact(usage.requests)} requests · free tier used up`
                }
              />
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <SectionTitle hint="Won and lost leave the funnel — they're counted below.">
                Pipeline
              </SectionTitle>
              <BarList data={stats.funnel} emptyMessage="No leads in the pipeline yet." />

              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                <div>
                  <div className="text-xs text-ink-muted">Won</div>
                  <div className="tnum mt-0.5 font-semibold text-good">{stats.won}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Lost</div>
                  <div className="tnum mt-0.5 font-semibold">{stats.lost}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Discarded</div>
                  <div className="tnum mt-0.5 font-semibold">{stats.discarded}</div>
                </div>
              </div>
            </Card>

            <Card>
              <SectionTitle hint="Why each business counts as a lead.">
                Why they qualify
              </SectionTitle>
              <BarList data={stats.byWebsiteClass} />

              {stats.unchecked > 0 ? (
                <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
                  {formatCompact(stats.unchecked)} businesses have a website that hasn&apos;t
                  been checked yet.{" "}
                  <Link href="/settings" className="text-accent hover:underline">
                    Run a link check
                  </Link>{" "}
                  to find dead sites — those become leads too.
                </p>
              ) : null}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <SectionTitle hint="Top 10 by lead count.">Leads by category</SectionTitle>
              <BarList data={stats.byCategory} />
            </Card>

            <Card>
              <SectionTitle
                hint="Highest-scoring new leads — busy, well-rated and reachable."
                action={
                  <Link
                    href="/leads?status=new"
                    className="text-xs text-accent hover:underline"
                  >
                    See all
                  </Link>
                }
              >
                Start here
              </SectionTitle>

              {stats.topLeads.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-muted">
                  No untouched leads left — nice.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {stats.topLeads.map((lead) => (
                    <li key={lead.id}>
                      <Link
                        href={`/leads/${lead.id}`}
                        className="flex items-center justify-between gap-3 py-2 transition-colors hover:text-accent"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{lead.name}</span>
                          <span className="block truncate text-xs text-ink-muted">
                            {getCategory(lead.category ?? "")?.label ?? lead.category} ·{" "}
                            {WEBSITE_CLASS_LABELS[lead.websiteClass]}
                            {lead.reviews ? ` · ${lead.reviews} reviews` : ""}
                          </span>
                        </span>
                        <span className="tnum shrink-0 text-sm font-medium">
                          {lead.score}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
