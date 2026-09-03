import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth";
import { absoluteUrl } from "@/lib/http";

/** Drop the session cookie and land back on the login page. */
export async function POST(request: Request) {
  const response = NextResponse.redirect(absoluteUrl(request, "/login"), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
