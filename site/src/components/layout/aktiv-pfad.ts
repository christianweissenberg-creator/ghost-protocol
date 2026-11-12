"use client";

import { usePathname, useSelectedLayoutSegment } from "next/navigation";

// Pfad, nach dem die Sidebar den aktiven Eintrag und die TopBar die Brotkrume wählen.
//
// React #418 auf / ohne Sitzung (gemessen 11.11.2026, Produktions-Build): Ohne gültiges Cookie
// schreibt die Middleware jede Seite per Rewrite auf /login um, die URL bleibt (middleware.ts).
// Ausgeliefert wird die vorgerenderte Login-Seite; ihr HTML entstand für den Pfad /login.
// usePathname() liest im Browser aber die URL (/, /agents …). Beim Hydrieren setzte die Sidebar
// deshalb die Aktivmarke (zusätzliches <span>, #418 „HTML“), die TopBar eine andere Brotkrume
// (#418 „text“), und React verwarf das Server-HTML. Vgl. die Next-Doku zu usePathname,
// „Avoid hydration mismatch with rewrites“.
// Der gewählte Abschnitt (useSelectedLayoutSegment) kommt aus dem Routenbaum, den der Server
// mitschickt, und ist auf Server und Client gleich. Zeigt die Seite die Anmeldung, gilt deshalb
// /login, wie beim direkten Aufruf von /login. Sonst bleibt es bei usePathname().
export function aktivPfad(pathname: string, segment: string | null): string {
  return segment === "login" ? "/login" : pathname;
}

export function useAktivPfad(): string {
  return aktivPfad(usePathname(), useSelectedLayoutSegment());
}
