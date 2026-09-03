import type { WebsiteStatus } from "@/lib/db/schema";

/**
 * Turning an HTTP response into a verdict on a business's website.
 *
 * The only finding worth acting on is "the site is gone" — that is the whole
 * pitch. A server that answers at all is not gone, even when it answers by
 * refusing us: 403 is bot protection, 401 an auth wall, 429 rate limiting, 405
 * a method it dislikes. Those sites load perfectly for a customer, and treating
 * them as broken means telling an owner their working website is down. That is
 * the most expensive mistake this tool can make, so the benefit of the doubt
 * goes to the site.
 */

export type ProbeVerdict = Extract<WebsiteStatus, "ok" | "dead" | "blocked" | "error">;

/** Statuses that mean the listed URL genuinely leads nowhere. */
const GONE = new Set([
  404, // not found
  410, // gone, explicitly
  402, // hosted shops return this once the account lapses
]);

export function judgeStatus(code: number): ProbeVerdict {
  if (code < 400) return "ok";
  if (GONE.has(code)) return "dead";
  // Alive but erroring. Could be a deploy or a blip; one probe is not proof,
  // and an owner mid-outage does not need to hear their site is dead.
  if (code >= 500) return "error";
  // 401, 403, 405, 429 and friends: the server is up and talking to us.
  return "blocked";
}

/** Only `dead` is worth pitching. Everything else is noise or uncertainty. */
export function isSellableFinding(status: ProbeVerdict): boolean {
  return status === "dead";
}

export const WEBSITE_STATUS_LABELS: Record<WebsiteStatus, string> = {
  unchecked: "Not checked",
  ok: "Working",
  dead: "Not responding",
  blocked: "Blocked our check",
  error: "Server error",
};
