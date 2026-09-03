import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Liveness probe for Docker and Coolify.
 *
 * Reachable without signing in (see the allowlist in `src/proxy.ts`), so it
 * deliberately reveals nothing beyond up or down — no version, no host, no
 * counts. Docker's healthcheck has no credentials to offer, and a probe that
 * needed them would report the container unhealthy forever.
 *
 * It touches the database on purpose: a container that is listening but cannot
 * reach Postgres is no use, and during a deploy that is exactly the window
 * Coolify should wait through before switching traffic over.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
