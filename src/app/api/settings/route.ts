import { NextResponse } from "next/server";
import { z } from "zod";

import { hasApiKey } from "@/lib/places/client";
import { getSettings, saveSettings } from "@/lib/settings";

const settingsSchema = z.object({
  myName: z.string().max(120).optional(),
  myPhone: z.string().max(40).optional(),
  defaultQuote: z.string().max(20).optional(),
  currency: z.string().max(8).optional(),
  emailSubject: z.string().max(300).optional(),
  emailTemplate: z.string().max(10_000).optional(),
  whatsappTemplate: z.string().max(4000).optional(),
  extraAggregatorDomains: z.string().max(10_000).optional(),
});

export async function GET() {
  return NextResponse.json({ settings: getSettings(), hasApiKey: hasApiKey() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid settings" },
      { status: 400 },
    );
  }

  saveSettings(parsed.data);
  return NextResponse.json({ settings: getSettings() });
}
