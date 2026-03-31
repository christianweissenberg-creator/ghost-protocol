import { NextRequest, NextResponse } from "next/server";

// Simple auth: password sets a 7-day cookie
const AUTH_COOKIE = "gp-auth";
const AUTH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getPassword(): string {
  return process.env.GP_ACCESS_PASSWORD || "ghostprotocol2026";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths — no auth needed
  if (
    pathname === "/login" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/api/health"
  ) {
    return NextResponse.next();
  }

  // Check login attempt via query param
  const password = request.nextUrl.searchParams.get("password");
  if (password === getPassword()) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("password");
    const response = NextResponse.redirect(url);
    response.cookies.set(AUTH_COOKIE, "authenticated", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: AUTH_MAX_AGE,
      path: "/",
    });
    return response;
  }

  // Check existing cookie
  const authCookie = request.cookies.get(AUTH_COOKIE);
  if (authCookie?.value === "authenticated") {
    return NextResponse.next();
  }

  // Localhost bypass for development
  const host = request.headers.get("host") || "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    return NextResponse.next();
  }

  // API routes — return 401 instead of login page
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Not authenticated — show login page
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.rewrite(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
