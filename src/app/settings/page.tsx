import { and, eq, inArray, sql } from "drizzle-orm";

import { SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { businesses } from "@/lib/db/schema";
import { hasApiKey } from "@/lib/places/client";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = getSettings();
  const keyPresent = hasApiKey();

  const uncheckedCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(businesses)
      .where(
        and(
          inArray(businesses.websiteClass, ["has_website", "builder_subdomain"]),
          eq(businesses.websiteStatus, "unchecked"),
        ),
      )
      .get()?.count ?? 0;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your details, the messages you send, and how a website gets judged."
      />

      <div className="mb-5 rounded-xl border border-line bg-card p-5">
        <h2 className="text-sm font-semibold tracking-tight">Google Places API key</h2>
        {keyPresent ? (
          <p className="mt-1 text-xs text-ink-secondary">
            <span className="font-medium text-good">Configured.</span> Read from{" "}
            <code className="font-mono">GOOGLE_MAPS_API_KEY</code>. The key itself is never
            shown here or sent to the browser.
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-secondary">
            <span className="font-medium text-serious">Not set.</span> Create{" "}
            <code className="font-mono">.env.local</code> with{" "}
            <code className="font-mono">GOOGLE_MAPS_API_KEY=…</code> and restart the dev
            server. The README walks through creating one.
          </p>
        )}
      </div>

      <SettingsForm initial={settings} uncheckedCount={uncheckedCount} />
    </>
  );
}
