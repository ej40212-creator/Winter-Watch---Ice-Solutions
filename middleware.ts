import { NextResponse } from "next/server";
import { readRuntimeEnv } from "./lib/access-auth.ts";
import { guardRequest } from "./lib/request-guard.ts";

export async function middleware(request: Request) {
  const blocked = await guardRequest(request, readRuntimeEnv());
  if (blocked) return blocked;
  const response = NextResponse.next();
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|favicon.ico|favicon.svg|ice-solutions-logo.png|winter-watch-share-v1.png).*)"],
};
