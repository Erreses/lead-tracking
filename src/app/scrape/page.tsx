import { desc } from "drizzle-orm";

import { PageHeader } from "@/components/ui";
import { ScrapeForm } from "@/components/scrape-form";
import { db } from "@/lib/db";
import { scrapeJobs } from "@/lib/db/schema";
import { hasApiKey } from "@/lib/places/client";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  completed: "text-good",
  running: "text-accent",
  failed: "text-critical",
  cancelled: "text-ink-muted",
  interrupted: "text-serious",
  pending: "text-ink-muted",
};

export default async function ScrapePage() {
  const jobs = db
    .select()
    .from(scrapeJobs)
    .orderBy(desc(scrapeJobs.createdAt))
    .limit(10)
    .all();

  return (
    <>
      <PageHeader
        title="Scrape"
        subtitle="Sweep an area of Google Maps for businesses with no website of their own. You always see the cost before anything runs."
      />

      <ScrapeForm hasApiKey={hasApiKey()} />

      {jobs.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Recent runs</h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Area</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Businesses</th>
                  <th className="px-4 py-2.5 text-right font-medium">Leads</th>
                  <th className="px-4 py-2.5 text-right font-medium">Requests</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-4 py-2.5">{job.areaName}</td>
                    <td
                      className={`px-4 py-2.5 ${STATUS_TONE[job.status] ?? "text-ink-secondary"}`}
                    >
                      {job.status}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">{job.businessesFound}</td>
                    <td className="tnum px-4 py-2.5 text-right">{job.leadsCreated}</td>
                    <td className="tnum px-4 py-2.5 text-right">{job.requestsMade}</td>
                    <td className="tnum px-4 py-2.5 text-right">
                      ${job.estimatedCostUsd.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-muted">
                      {job.createdAt.toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
