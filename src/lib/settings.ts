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
};

export function getSettings(): AppSettings {
  const rows = db.select().from(settings).all();
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
  };
}

export function saveSettings(values: Partial<Record<keyof AppSettings, string>>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value == null) continue;
    db.insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      })
      .run();
  }
}

/** User-added domains, merged into the classifier's aggregator list. */
export function extraDomains(): string[] {
  return getSettings()
    .extraAggregatorDomains.split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function clearSetting(key: keyof AppSettings): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
