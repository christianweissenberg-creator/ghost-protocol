"use client"; // Fehlergrenzen müssen Client Components sein (Next 16, file convention error.js).

// Fehlergrenze für die Seiten unter dem Root-Layout — Stufe 1 (06.11.2026, Befund R9).
// Wirft eine Seite beim Rendern, ersetzt Next nur den Seiteninhalt; Sidebar und TopBar aus
// dem Root-Layout bleiben stehen (error.tsx umschließt nicht das Layout desselben Segments).
// Die Meldung wird vor der Anzeige um den geschützten Namen bereinigt. Fehler aus Server
// Components kommen in Produktion ohne Text, nur mit Kennung (digest).

import Link from "next/link";
import { maskiereGeschuetzteNamen } from "@/lib/freigabe-regeln";

export default function Fehlergrenze({
  error,
  unstable_retry,
  reset,
}: {
  error: Error & { digest?: string };
  unstable_retry?: () => void;
  reset?: () => void;
}) {
  const roh = typeof error?.message === "string" ? error.message.trim() : "";
  const meldung = maskiereGeschuetzteNamen(roh || "ohne Meldung");
  const kennung = typeof error?.digest === "string" && error.digest ? error.digest : null;
  const erneut = typeof unstable_retry === "function" ? unstable_retry : typeof reset === "function" ? reset : null;

  return (
    <div className="boot p-4 sm:p-6 lg:p-10 max-w-[900px]">
      <div className="card-ghost p-6">
        <p className="mono-label mb-2" style={{ color: "var(--gp-rose)" }}>
          ANSICHT ABGEBROCHEN
        </p>
        <h1 className="text-lg font-semibold font-[family-name:var(--font-outfit)] mb-2">
          Diese Seite konnte nicht angezeigt werden.
        </h1>
        <p className="text-sm break-words" style={{ color: "var(--gp-ink-2)" }}>
          Meldung: {meldung}
        </p>
        {kennung && (
          <p className="text-xs mt-1 font-mono" style={{ color: "var(--gp-ink-3)" }}>
            Kennung: {kennung}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {erneut && (
            <button
              onClick={() => erneut()}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-accent-violet text-white hover:bg-accent-violet/80 transition-colors"
            >
              Erneut versuchen
            </button>
          )}
          <Link href="/" className="text-xs text-accent-violet hover:underline">
            Zum Command Center
          </Link>
        </div>
      </div>
    </div>
  );
}
