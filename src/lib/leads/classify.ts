import {
  AGGREGATOR_DOMAINS,
  BUILDER_SUBDOMAIN_DOMAINS,
  GOOGLE_SITE_DOMAINS,
  SOCIAL_DOMAINS,
} from "@/config/domains";
import type { WebsiteClass } from "@/lib/db/schema";

export type DomainLists = {
  social: string[];
  google: string[];
  aggregator: string[];
  builder: string[];
};

export const DEFAULT_DOMAIN_LISTS: DomainLists = {
  social: SOCIAL_DOMAINS,
  google: GOOGLE_SITE_DOMAINS,
  aggregator: AGGREGATOR_DOMAINS,
  builder: BUILDER_SUBDOMAIN_DOMAINS,
};

/**
 * Lowercased hostname without a leading `www.`, or null if the value isn't a
 * usable http(s) URL. Bare hosts like `example.com` are accepted.
 */
export function extractHost(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (!host || !host.includes(".")) return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * True when `host` is the domain itself or a subdomain of it. Deliberately not a
 * substring test: `notfacebook.com` must not match `facebook.com`.
 */
export function matchesDomain(host: string, domains: string[]): boolean {
  return domains.some((domain) => {
    const d = domain.toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
}

export type Classification = {
  websiteClass: WebsiteClass;
  host: string | null;
};

/**
 * Decide whether a business really has a website of its own. Everything except
 * `has_website` is a sellable lead.
 */
export function classifyWebsite(
  websiteUri: string | null | undefined,
  lists: DomainLists = DEFAULT_DOMAIN_LISTS,
): Classification {
  const host = extractHost(websiteUri);
  if (!host) return { websiteClass: "none", host: null };

  if (matchesDomain(host, lists.google)) return { websiteClass: "google_site", host };
  if (matchesDomain(host, lists.social)) return { websiteClass: "social_only", host };
  if (matchesDomain(host, lists.aggregator)) return { websiteClass: "aggregator_only", host };
  if (matchesDomain(host, lists.builder)) return { websiteClass: "builder_subdomain", host };

  return { websiteClass: "has_website", host };
}

/** Every class except `has_website` is worth pitching. */
export function isLead(websiteClass: WebsiteClass): boolean {
  return websiteClass !== "has_website";
}

const CLASS_BASE_SCORE: Record<WebsiteClass, number> = {
  none: 40,
  google_site: 38,
  dead: 36,
  social_only: 32,
  aggregator_only: 28,
  builder_subdomain: 16,
  has_website: 0,
};

export type ScoreInput = {
  websiteClass: WebsiteClass;
  rating?: number | null;
  userRatingCount?: number | null;
  phone?: string | null;
  businessStatus?: string | null;
};

/**
 * 0-100 priority score, used to sort the lead list so you start with the
 * prospects most likely to pay. Weighted toward businesses that are visibly
 * busy (review volume), well-liked (rating) and actually reachable (phone).
 */
export function scoreLead(input: ScoreInput): number {
  if (input.websiteClass === "has_website") return 0;

  let score = CLASS_BASE_SCORE[input.websiteClass];

  const reviews = input.userRatingCount ?? 0;
  score += Math.min(30, Math.round(reviews / 5));

  // A rating from a handful of reviews isn't signal, so require a few first.
  if (reviews >= 5 && input.rating != null) {
    if (input.rating >= 4.5) score += 15;
    else if (input.rating >= 4.0) score += 12;
    else if (input.rating >= 3.5) score += 7;
  }

  if (input.phone) score += 10;

  // Closed or temporarily closed businesses aren't buying a website.
  if (input.businessStatus && input.businessStatus !== "OPERATIONAL") {
    score = Math.round(score * 0.25);
  }

  return Math.max(0, Math.min(100, score));
}

export const WEBSITE_CLASS_LABELS: Record<WebsiteClass, string> = {
  none: "No website",
  google_site: "Dead Google site",
  social_only: "Social only",
  aggregator_only: "Marketplace only",
  builder_subdomain: "Free subdomain",
  dead: "Broken website",
  has_website: "Has website",
};

export const WEBSITE_CLASS_HINTS: Record<WebsiteClass, string> = {
  none: "Nothing listed on Google. The strongest pitch you can get.",
  google_site:
    "Points at a Google Business Profile site — Google shut those down, so the link is effectively dead.",
  social_only: "Only a social or link-in-bio page. No site they own.",
  aggregator_only:
    "Only listed on a marketplace or booking platform they pay commission to.",
  builder_subdomain:
    "A site on a free builder subdomain. Real, but rented and weak on search.",
  dead: "Has a domain, but it failed to respond when checked.",
  has_website: "Has a working site of their own.",
};
