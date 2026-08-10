import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { LEAD_STATUSES, leadEvents, leads } from "@/lib/db/schema";

const patchSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  quoteAmount: z.number().nonnegative().nullable().optional(),
  demoUrl: z.string().max(500).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  nextFollowUpAt: z.number().int().nullable().optional(),
  /** Set when an outreach message is actually sent, to stamp `contactedAt`. */
  markContacted: z.boolean().optional(),
  /** Free-text note appended to the timeline alongside the change. */
  event: z.string().max(500).optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/leads/[id]">) {
  const { id } = await ctx.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) {
    return NextResponse.json({ error: "Invalid lead id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const existing = db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!existing) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const patch = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.status !== undefined) update.status = patch.status;
  if (patch.quoteAmount !== undefined) update.quoteAmount = patch.quoteAmount;
  if (patch.demoUrl !== undefined) update.demoUrl = patch.demoUrl || null;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.nextFollowUpAt !== undefined) {
    update.nextFollowUpAt = patch.nextFollowUpAt ? new Date(patch.nextFollowUpAt) : null;
  }
  if (patch.markContacted) update.contactedAt = new Date();

  db.update(leads).set(update).where(eq(leads.id, leadId)).run();

  // Status moves are the spine of the timeline, so record them explicitly.
  if (patch.status && patch.status !== existing.status) {
    db.insert(leadEvents)
      .values({
        leadId,
        type: "status_change",
        message: `${existing.status} → ${patch.status}`,
      })
      .run();
  }

  if (patch.markContacted) {
    db.insert(leadEvents)
      .values({ leadId, type: "outreach_sent", message: patch.event ?? "Outreach sent" })
      .run();
  } else if (patch.event) {
    db.insert(leadEvents).values({ leadId, type: "note", message: patch.event }).run();
  }

  const updated = db.select().from(leads).where(eq(leads.id, leadId)).get();
  return NextResponse.json({ lead: updated });
}
