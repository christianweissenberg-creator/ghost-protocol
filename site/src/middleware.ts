import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionSecret, verifySession } from "@/lib/auth";

// Auth-Gate: ein gültiges, HMAC-signiertes Session-Cookie ist erforderlich.
// Das Passwort wird NICHT mehr hier geprüft — das übernimmt POST /api/auth/login
// (Passwort im Body statt in der URL). Diese Middleware verifiziert nur noch das
// Cookie und kennt das Passwort selbst gar nicht.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Öffentliche Pfade — keine Auth nötig
  if (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/api/health"
  ) {
    return NextResponse.next();
  }

  // Gültiges, signiertes Session-Cookie?
  const secret = getSessionSecret();
  if (secret) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (await verifySession(token, secret)) {
      return NextResponse.next();
    }
  }

  // Dev-Bypass — NUR in der Entwicklung. In Prod-Builds ist NODE_ENV="production",
  // dieser Zweig ist dann tot. Bewusst KEIN Vertrauen mehr in den (client-
  // fälschbaren) Host-Header: früher ließ "Host: localhost" jede Anfrage durch —
  // externes Risiko, falls Port 3000 je direkt exponiert wird. In Produktion kommt
  // man ausschließlich mit gültigem signierten Cookie oder über öffentliche Pfade
  // durch. Interne Server-zu-Server-Calls senden ein frisch signiertes Cookie
  // (siehe internalCookie() in den Cron-/Fleet-Routen).
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  // API-Routen → 401 statt Login-Seite
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Nicht authentifiziert → Login-Seite (Rewrite, URL bleibt erhalten)
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.rewrite(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
