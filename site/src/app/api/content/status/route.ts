import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// Content-Freigabe-Aktionen: Übergänge zwischen den Status der content-Tabelle.
// Auth über die bestehende Middleware (Session-Cookie) — hier keine Zusatzprüfung.

type Aktion = "freigeben" | "ablehnen" | "gepostet" | "metriken";

interface StatusRequest {
  id: number;
  aktion: Aktion;
  published_url?: string;
  impressions?: number;
  likes?: number;
}

// Erlaubte Quellstatus je Aktion (fail-closed: alles andere → 409)
const ERLAUBTE_QUELLSTATUS: Record<Aktion, string[]> = {
  freigeben: ["zur_freigabe"],
  ablehnen: ["zur_freigabe"],
  gepostet: ["freigegeben"],
  metriken: ["gepostet"],
};

export async function POST(request: NextRequest) {
  try {
    const body: StatusRequest = await request.json();
    const { id, aktion, published_url, impressions, likes } = body;

    if (!id || !aktion || !ERLAUBTE_QUELLSTATUS[aktion]) {
      return NextResponse.json({ error: "id und gültige aktion sind erforderlich" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: eintrag, error: fetchErr } = await supabase
      .from("content")
      .select("id, status")
      .eq("id", id)
      .single();

    if (fetchErr || !eintrag) {
      return NextResponse.json({ error: `Content-Eintrag ${id} nicht gefunden` }, { status: 404 });
    }

    // Ungültiger Übergang → 409
    if (!ERLAUBTE_QUELLSTATUS[aktion].includes(eintrag.status)) {
      return NextResponse.json(
        { error: `Übergang "${aktion}" ist aus Status "${eintrag.status}" nicht erlaubt` },
        { status: 409 }
      );
    }

    let update: Record<string, unknown>;
    switch (aktion) {
      case "freigeben":
        update = { status: "freigegeben" };
        break;
      case "ablehnen":
        update = { status: "abgelehnt" };
        break;
      case "gepostet":
        update = {
          status: "gepostet",
          published_at: new Date().toISOString(),
          published_url: published_url ?? null,
        };
        break;
      case "metriken": {
        const erfasstAm = new Date().toISOString();
        update = {
          views: impressions ?? 0,
          engagement: likes ?? 0,
          performance: { impressions: impressions ?? 0, likes: likes ?? 0, erfasst_am: erfasstAm },
        };
        break;
      }
    }

    const { error: updateErr } = await supabase.from("content").update(update).eq("id", id);
    if (updateErr) {
      return NextResponse.json({ error: `Update fehlgeschlagen: ${updateErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ id, aktion, status: update.status ?? eintrag.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
