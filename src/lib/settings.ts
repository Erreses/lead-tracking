import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_EMAIL_SUBJECT,
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_WHATSAPP_TEMPLATE,
} from "@/lib/leads/outreach";

export type AppSettings = {
  myName: string;
  myPhone: string;
  defaultQuote: number;
  currency: string;
  emailSubject: string;
  emailTemplate: string;
  whatsappTemplate: string;
  /** Extra domains to treat as "not a real website", one per line. */
  extraAggregatorDomains: string;
  /**
   * How long a cell × category search counts as already covered. Re-running an
   * area inside this window skips those searches instead of paying for them
   * again. 0 disables the cache and always sweeps everything.
   */
  coverageTtlDays: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  myName: "",
  myPhone: "",
  defaultQuote: 450,
  currency: "EUR",
  emailSubject: DEFAULT_EMAIL_SUBJECT,
  emailTemplate: DEFAULT_EMAIL_TEMPLATE,
  whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE,
  extraAggregatorDomains: "",
  coverageTtlDays: 30,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return {
    myName: stored.myName ?? DEFAULT_SETTINGS.myName,
    myPhone: stored.myPhone ?? DEFAULT_SETTINGS.myPhone,
    defaultQuote: stored.defaultQuote
      ? Number(stored.defaultQuote)
      : DEFAULT_SETTINGS.defaultQuote,
    currency: stored.currency ?? DEFAULT_SETTINGS.currency,
    emailSubject: stored.emailSubject ?? DEFAULT_SETTINGS.emailSubject,
    emailTemplate: stored.emailTemplate ?? DEFAULT_SETTINGS.emailTemplate,
    whatsappTemplate: stored.whatsappTemplate ?? DEFAULT_SETTINGS.whatsappTemplate,
    extraAggregatorDomains:
      stored.extraAggregatorDomains ?? DEFAULT_SETTINGS.extraAggregatorDomains,
    coverageTtlDays: stored.coverageTtlDays
      ? Number(stored.coverageTtlDays)
      : DEFAULT_SETTINGS.coverageTtlDays,
  };
}

/**
 * Searches swept on or after this instant count as already covered. `null` when
 * the cache is switched off, which means sweep everything.
 */
export async function coverageCutoff(): Promise<Date | null> {
  const { coverageTtlDays: days } = await getSettings();
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function saveSettings(
  values: Partial<Record<keyof AppSettings, string>>,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    if (value == null) continue;
    await db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

/** User-added domains, merged into the classifier's aggregator list. */
export async function extraDomains(): Promise<string[]> {
  const { extraAggregatorDomains } = await getSettings();
  return extraAggregatorDomains
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export async function clearSetting(key: keyof AppSettings): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}
