import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  getSessionSecret,
  signSession,
  safePasswordEqual,
} from "@/lib/auth";

// POST /api/auth/login  { password }
// Prüft das Zugangspasswort und setzt bei Erfolg ein HMAC-signiertes Session-Cookie.
// Das Passwort kommt im Request-Body (nicht in der URL) → landet nicht in Server-,
// Proxy- oder Browser-History-Logs.

// Einfaches In-Memory-Rate-Limit (Single-Container-Deployment ist ausreichend):
// max. 10 Fehlversuche pro IP in einem 10-Minuten-Fenster.
const MAX_FAILS = 10;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000; // Hard-Cap gegen Memory-DoS
const fails = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  // Hinter dem Reverse-Proxy (Coolify/Traefik) setzt der Proxy x-real-ip auf die
  // ECHTE Client-IP und überschreibt Client-Werte → vertrauenswürdig. Nur als
  // Fallback das RECHTESTE (proxy-angehängte) x-forwarded-for-Token nehmen, NIE das
  // linke — das ist client-kontrollierbar und würde das Limit umgehbar machen.
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return "unknown";
}

function isBlocked(ip: string): boolean {
  const rec = fails.get(ip);
  if (!rec || Date.now() > rec.resetAt) return false;
  return rec.count >= MAX_FAILS;
}

function recordFail(ip: string): void {
  const now = Date.now();
  const rec = fails.get(ip);
  if (rec && now <= rec.resetAt) {
    rec.count += 1;
    return;
  }
  // Neuer Eintrag — vorher abgelaufene Einträge aufräumen und hart deckeln,
  // damit die Map auch bei IP-Rotation nicht unbegrenzt wächst.
  if (fails.size >= MAX_ENTRIES) {
    for (const [k, v] of fails) if (now > v.resetAt) fails.delete(k);
    if (fails.size >= MAX_ENTRIES) return; // Cap erreicht → Tracking überspringen
  }
  fails.set(ip, { count: 1, resetAt: now + WINDOW_MS });
}

export async function POST(request: NextRequest) {
  const expected = process.env.GP_ACCESS_PASSWORD;
  const secret = getSessionSecret();

  // Fail-closed: ohne gesetztes Passwort ODER Signing-Secret ist kein Login möglich.
  if (!expected || !secret) {
    return NextResponse.json(
      { error: "Auth nicht konfiguriert (GP_ACCESS_PASSWORD / Session-Secret fehlt)" },
      { status: 500 },
    );
  }

  const ip = clientIp(request);
  if (isBlocked(ip)) {
    return NextResponse.json(
      { error: "Zu viele Fehlversuche. Bitte einige Minuten warten." },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const ok = await safePasswordEqual(password, expected, secret);
  if (!ok) {
    recordFail(ip);
    return NextResponse.json({ error: "Falsches Passwort" }, { status: 401 });
  }

  // Erfolg → Fehlversuche zurücksetzen und signiertes Cookie setzen.
  fails.delete(ip);
  const token = await signSession(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
