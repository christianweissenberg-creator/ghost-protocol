"""
Ghost Protocol — L.I.S.A. Scheduler (interner Slug: donna)
===================================
L.I.S.A.s autonome Execution-Engine. Läuft als Cron auf dem VPS.

Pipelines:
1. WEEKLY_CONTENT  — Montag: Wochenplan erstellen + Content produzieren
2. NEWSLETTER      — Mittwoch: Newsletter schreiben + Compliance + Senden
3. SOCIAL_POSTS    — Di+Do: Social Posts für X + LinkedIn
4. DAILY_BRIEFING  — Täglich 08:00: Morning Briefing an Christian via Telegram
5. WEEKLY_REVIEW   — Sonntag: KPIs + Learnings + nächste Woche planen

Usage (Cron auf VPS):
    # Täglich 08:00 CET — Morning Briefing
    0 7 * * * cd /opt/ghost-protocol && python -m execution.donna_scheduler briefing

    # Montag 09:00 CET — Wochenplan
    0 8 * * 1 cd /opt/ghost-protocol && python -m execution.donna_scheduler weekly_plan

    # Dienstag 08:00 CET — Social Post 1
    0 7 * * 2 cd /opt/ghost-protocol && python -m execution.donna_scheduler social_post

    # Mittwoch 10:00 CET — Newsletter
    0 9 * * 3 cd /opt/ghost-protocol && python -m execution.donna_scheduler newsletter

    # Donnerstag 08:00 CET — Social Post 2
    0 7 * * 4 cd /opt/ghost-protocol && python -m execution.donna_scheduler social_post

    # Sonntag 20:00 CET — Weekly Review
    0 19 * * 0 cd /opt/ghost-protocol && python -m execution.donna_scheduler weekly_review
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .agent_runner import AgentRunner
from .mailerlite import MailerLite
from .content_templates import (
    build_newsletter,
    build_x_post,
    build_linkedin_post,
    DISCLAIMERS,
    HASHTAGS,
)
from .telegram_notify import send_telegram, send_approval_request


# ── Pfade ─────────────────────────────────────────

DATA_DIR = Path(os.environ.get("GP_DATA_DIR", str(Path(__file__).parent.parent / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

STATE_FILE = DATA_DIR / "donna_state.json"
CONTENT_QUEUE_FILE = DATA_DIR / "content_queue.json"
COST_LOG_FILE = DATA_DIR / "cost_log.json"


def load_state() -> dict:
    """Lädt L.I.S.A.s persistenten State."""
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {
        "last_newsletter": None,
        "last_social_post": None,
        "last_briefing": None,
        "last_weekly_review": None,
        "newsletter_count": 1,  # #1 wurde bereits manuell gesendet
        "total_cost_usd": 0.0,
        "week_number": 15,
    }


def save_state(state: dict) -> None:
    """Speichert L.I.S.A.s State."""
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False))


def log_cost(runner: AgentRunner) -> None:
    """Kosten in persistentes Log schreiben."""
    existing = []
    if COST_LOG_FILE.exists():
        existing = json.loads(COST_LOG_FILE.read_text())
    existing.extend(runner.cost_log)
    # Max 1000 Einträge behalten
    if len(existing) > 1000:
        existing = existing[-1000:]
    COST_LOG_FILE.write_text(json.dumps(existing, indent=2))


# ═══════════════════════════════════════════════════
# PIPELINE 1: DAILY BRIEFING
# ═══════════════════════════════════════════════════

def run_daily_briefing() -> None:
    """L.I.S.A. erstellt Morning Briefing + sendet via Telegram."""
    print("🌅 L.I.S.A. — Daily Briefing Pipeline")

    runner = AgentRunner()
    state = load_state()
    today = datetime.now().strftime("%d.%m.%Y")

    # L.I.S.A. erstellt Briefing (1 API-Call, Haiku reicht)
    result = runner.run(
        "DONNA",
        task=f"""Erstelle das Morning Briefing für Christian für den {today}.

Format:
Guten Morgen Christian

[30-Sekunden-Version — 3-4 Zeilen, das Wichtigste]

Revenue Update: [Status Newsletter-Subscriber, Social Follower]
Deine Entscheidung heute: [1 konkrete Frage wenn nötig, sonst "Keine — alles läuft"]
Quick Win: [1 Aktion die heute Impact hat]
Risiko: [nur wenn relevant]

Halte dich KURZ. Max 10 Zeilen. Christian hat wenig Zeit.""",
        context={
            "newsletter_count": state["newsletter_count"],
            "last_newsletter": state["last_newsletter"],
            "total_api_cost": state["total_cost_usd"],
        },
    )

    # Via Telegram senden
    briefing_text = f"🌅 L.I.S.A. — Morning Briefing\n\n{result['output']}\n\n💰 API-Kosten: ${result['cost_usd']:.4f}"
    send_telegram(briefing_text)

    state["last_briefing"] = datetime.now(timezone.utc).isoformat()
    state["total_cost_usd"] = round(state["total_cost_usd"] + result["cost_usd"], 4)
    save_state(state)
    log_cost(runner)

    print(f"✅ Briefing gesendet (${result['cost_usd']:.4f})")


# ═══════════════════════════════════════════════════
# PIPELINE 2: NEWSLETTER
# ═══════════════════════════════════════════════════

def run_newsletter_pipeline() -> None:
    """SCRIBE schreibt → COUNSEL prüft → PUBLISHER sendet via MailerLite."""
    print("📧 L.I.S.A. — Newsletter Pipeline")

    runner = AgentRunner()
    state = load_state()
    next_num = state["newsletter_count"] + 1

    # Step 1: SCRIBE schreibt den Newsletter-Inhalt
    scribe_result = runner.run(
        "SCRIBE",
        task=f"""Schreibe den Inhalt für WHITEPULSE Newsletter #{next_num}.

Thema: Wähle das relevanteste Thema der Woche aus dem Krypto/AI-Trading-Bereich.

Liefere NUR den Hauptinhalt als HTML-Fragmente (keine vollständige HTML-Seite):
- <h2> für Überschriften
- <p> für Text
- <strong> für Highlights
- Inline-Styles: color:#22d3ee für Akzente, color:#e5e7eb für normalen Text

Struktur:
1. Markt-Update (3-4 Sätze mit Zahlen)
2. Hauptthema der Woche (was passiert, warum relevant)
3. WHITEPULSE System-Update (Performance, neue Features)
4. Tipp/Insight (1 konkreter Mehrwert)

Ton: Minimalistisch, technisch, selbstbewusst. Wie ein Freund der zufällig Weltklasse-Analyst ist.
Max 300 Wörter. DACH-Fokus (Deutsch).""",
        context={"newsletter_number": next_num},
    )

    # Step 2: COUNSEL prüft auf Compliance
    counsel_result = runner.run(
        "COUNSEL",
        task=f"""Prüfe diesen Newsletter-Inhalt auf DACH-Compliance.

Checkliste:
- Keine Anlageberatung (§2 Abs.6 Nr.1 WpHG)
- Disclaimer vorhanden
- Keine Garantie-Versprechen
- Performance-Angaben mit Zeitraum und n=Trades
- MiCA Art. 27 konform
- DSGVO-Abmeldelink erwähnt

Antworte NUR mit:
APPROVED — wenn alles ok
REVISION_NEEDED — mit konkreten Änderungen die nötig sind

Newsletter-Inhalt:
{scribe_result['output'][:3000]}""",
    )

    # Check ob Approval oder Revision nötig
    if "REVISION_NEEDED" in counsel_result["output"].upper():
        # An Christian eskalieren
        send_telegram(
            f"⚠️ COUNSEL — Newsletter #{next_num} braucht Revision:\n\n"
            f"{counsel_result['output'][:500]}\n\n"
            f"💰 Bisherige Kosten: ${runner.get_total_cost():.4f}"
        )
        log_cost(runner)
        print(f"⚠️ Newsletter benötigt Revision — Christian benachrichtigt")
        return

    # Step 3: HTML zusammenbauen
    newsletter_html = build_newsletter(
        edition=f"Newsletter #{next_num} | {datetime.now().strftime('%B %Y')}",
        intro=f"WHITEPULSE Newsletter #{next_num} — dein wöchentliches Update.",
        main_content_html=scribe_result["output"],
        cta_text="Mehr auf whitepulse.io",
    )

    # Step 4: Approval anfordern bevor wir senden
    send_approval_request(
        task=f"Newsletter #{next_num} senden",
        details=f"Subject: WHITEPULSE #{next_num}\nCOUNSEL: APPROVED\nKosten bisher: ${runner.get_total_cost():.4f}",
        callback_data=f"send_newsletter_{next_num}",
    )

    # Newsletter in Queue speichern (wird nach Approval gesendet)
    queue = []
    if CONTENT_QUEUE_FILE.exists():
        queue = json.loads(CONTENT_QUEUE_FILE.read_text())

    queue.append({
        "type": "newsletter",
        "number": next_num,
        "subject": f"WHITEPULSE #{next_num}",
        "html": newsletter_html,
        "status": "awaiting_approval",
        "created": datetime.now(timezone.utc).isoformat(),
        "cost_usd": runner.get_total_cost(),
    })
    CONTENT_QUEUE_FILE.write_text(json.dumps(queue, indent=2, ensure_ascii=False))

    state["total_cost_usd"] = round(state["total_cost_usd"] + runner.get_total_cost(), 4)
    save_state(state)
    log_cost(runner)

    print(f"✅ Newsletter #{next_num} erstellt + Approval angefragt (${runner.get_total_cost():.4f})")


def send_approved_newsletter(newsletter_number: int) -> None:
    """Sendet einen approved Newsletter via MailerLite."""
    queue = []
    if CONTENT_QUEUE_FILE.exists():
        queue = json.loads(CONTENT_QUEUE_FILE.read_text())

    # Finde den Newsletter in der Queue
    nl = next((q for q in queue if q["type"] == "newsletter" and q["number"] == newsletter_number), None)
    if not nl:
        send_telegram(f"❌ Newsletter #{newsletter_number} nicht in der Queue gefunden")
        return

    try:
        ml = MailerLite()
        result = ml.create_and_send(
            name=f"WHITEPULSE Newsletter #{newsletter_number}",
            subject=nl["subject"],
            html_content=nl["html"],
        )

        # Status updaten
        nl["status"] = "sent"
        nl["sent_at"] = datetime.now(timezone.utc).isoformat()
        nl["mailerlite_campaign_id"] = result.get("campaign_id")
        CONTENT_QUEUE_FILE.write_text(json.dumps(queue, indent=2, ensure_ascii=False))

        # State updaten
        state = load_state()
        state["newsletter_count"] = newsletter_number
        state["last_newsletter"] = datetime.now(timezone.utc).isoformat()
        save_state(state)

        send_telegram(f"✅ Newsletter #{newsletter_number} GESENDET via MailerLite!")

    except Exception as e:
        send_telegram(f"❌ Newsletter #{newsletter_number} Fehler: {e}")


# ═══════════════════════════════════════════════════
# PIPELINE 3: SOCIAL POSTS
# ═══════════════════════════════════════════════════

def run_social_post_pipeline() -> None:
    """SCRIBE schreibt Social Posts → AMPLIFIER wählt Timing → Queue."""
    print("📱 L.I.S.A. — Social Post Pipeline")

    runner = AgentRunner()
    state = load_state()

    # SCRIBE erstellt Posts für X + LinkedIn
    result = runner.run(
        "SCRIBE",
        task="""Erstelle ZWEI Social-Media-Posts für WHITEPULSE:

POST 1 — X/Twitter (max 280 Zeichen):
- Hook in der ersten Zeile
- 1-2 Metriken oder Insights
- CTA: whitepulse.io
- Disclaimer: "Eigenhandel, keine Anlageberatung."

POST 2 — LinkedIn (max 1300 Zeichen):
- Professioneller Ton
- Mehr Kontext als Twitter
- Performance-Daten mit n= und Zeitraum
- CTA + Disclaimer

Trenne die Posts mit ---POST_SEPARATOR---

Themen-Ideen:
- System-Update / neue Features
- Performance-Einblick
- AI-Trading vs manuelles Trading
- Marktbeobachtung der Woche
- Technologie hinter WHITEPULSE

Ton: Minimalistisch, technisch, selbstbewusst. DACH-Fokus (Deutsch).""",
    )

    # Posts in Queue speichern
    queue = []
    if CONTENT_QUEUE_FILE.exists():
        queue = json.loads(CONTENT_QUEUE_FILE.read_text())

    posts = result["output"].split("---POST_SEPARATOR---")
    for i, post_text in enumerate(posts):
        platform = "x" if i == 0 else "linkedin"
        queue.append({
            "type": "social_post",
            "platform": platform,
            "content": post_text.strip(),
            "status": "ready",  # Social Posts brauchen kein Approval
            "created": datetime.now(timezone.utc).isoformat(),
            "cost_usd": result["cost_usd"] / max(len(posts), 1),
        })

    CONTENT_QUEUE_FILE.write_text(json.dumps(queue, indent=2, ensure_ascii=False))

    # Telegram-Benachrichtigung mit Posts
    x_post = posts[0].strip() if posts else "—"
    li_post = posts[1].strip() if len(posts) > 1 else "—"

    send_telegram(
        f"📱 Social Posts erstellt\n\n"
        f"🐦 X:\n{x_post[:200]}...\n\n"
        f"💼 LinkedIn:\n{li_post[:200]}...\n\n"
        f"Status: READY (manuell posten bis API aktiv)\n"
        f"💰 Kosten: ${result['cost_usd']:.4f}"
    )

    state["last_social_post"] = datetime.now(timezone.utc).isoformat()
    state["total_cost_usd"] = round(state["total_cost_usd"] + result["cost_usd"], 4)
    save_state(state)
    log_cost(runner)

    print(f"✅ 2 Social Posts erstellt (${result['cost_usd']:.4f})")


# ═══════════════════════════════════════════════════
# PIPELINE 4: WEEKLY REVIEW
# ═══════════════════════════════════════════════════

def run_weekly_review() -> None:
    """L.I.S.A. + TREASURER: Wochenrückblick + KPIs + nächste Woche planen."""
    print("📊 L.I.S.A. — Weekly Review Pipeline")

    runner = AgentRunner()
    state = load_state()

    result = runner.run(
        "DONNA",
        task=f"""Erstelle den Weekly Review für Ghost Protocol KW{state.get('week_number', '?')}.

Analysiere:
1. Content-Output: Wie viele Newsletter/Posts wurden erstellt?
2. API-Kosten: Gesamtkosten bisher ${state.get('total_cost_usd', 0):.2f}
3. Was hat funktioniert, was nicht?
4. Plan für nächste Woche (max 3 Prioritäten)

Format: Knapp, actionable, mit Zahlen. Max 15 Zeilen.""",
        context={
            "state": state,
            "newsletter_count": state.get("newsletter_count", 1),
            "total_cost": state.get("total_cost_usd", 0),
        },
    )

    send_telegram(f"📊 Weekly Review KW{state.get('week_number', '?')}\n\n{result['output']}")

    state["last_weekly_review"] = datetime.now(timezone.utc).isoformat()
    state["week_number"] = state.get("week_number", 15) + 1
    state["total_cost_usd"] = round(state["total_cost_usd"] + result["cost_usd"], 4)
    save_state(state)
    log_cost(runner)

    print(f"✅ Weekly Review gesendet (${result['cost_usd']:.4f})")


# ═══════════════════════════════════════════════════
# PIPELINE 5: WEEKLY PLAN
# ═══════════════════════════════════════════════════

def run_weekly_plan() -> None:
    """L.I.S.A. erstellt den Wochenplan Montag morgens."""
    print("📋 DONNA — Weekly Plan Pipeline")

    runner = AgentRunner()
    state = load_state()

    result = runner.run(
        "DONNA",
        task=f"""Erstelle den Wochenplan für Ghost Protocol KW{state.get('week_number', 15)}.

Du managst die autonome Content-Maschine für WHITEPULSE:
- Newsletter: 1x/Woche (Mittwoch)
- Social Posts: 2x/Woche (Di + Do)
- Daily Briefing: Mo-Fr 08:00

Entscheide:
1. Newsletter-Thema diese Woche (basierend auf Krypto/AI-Markt)
2. Social-Post-Themen (2 verschiedene Winkel)
3. Spezial-Aktionen (z.B. Subscriber-Kampagne, neues Produkt)

Liefere einen konkreten Plan als JSON:
{{
    "newsletter_topic": "...",
    "social_post_1_topic": "...",
    "social_post_2_topic": "...",
    "special_actions": ["..."],
    "priority": "..."
}}""",
    )

    send_telegram(
        f"📋 Wochenplan KW{state.get('week_number', 15)}\n\n"
        f"{result['output']}\n\n"
        f"💰 Kosten: ${result['cost_usd']:.4f}"
    )

    state["total_cost_usd"] = round(state["total_cost_usd"] + result["cost_usd"], 4)
    save_state(state)
    log_cost(runner)

    print(f"✅ Wochenplan erstellt (${result['cost_usd']:.4f})")


# ═══════════════════════════════════════════════════
# CLI ENTRY POINT
# ═══════════════════════════════════════════════════

COMMANDS = {
    "briefing": run_daily_briefing,
    "newsletter": run_newsletter_pipeline,
    "social_post": run_social_post_pipeline,
    "weekly_review": run_weekly_review,
    "weekly_plan": run_weekly_plan,
    "send_newsletter": lambda: send_approved_newsletter(
        int(sys.argv[3]) if len(sys.argv) > 3 else 2
    ),
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("Usage: python -m execution.donna_scheduler <command>")
        print(f"Commands: {', '.join(COMMANDS.keys())}")
        sys.exit(1)

    command = sys.argv[1]
    print(f"\n{'='*50}")
    print(f"  DONNA SCHEDULER — {command.upper()}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*50}\n")

    try:
        COMMANDS[command]()
    except Exception as e:
        error_msg = f"❌ DONNA Scheduler Error [{command}]: {e}"
        print(error_msg)
        try:
            send_telegram(error_msg)
        except Exception:
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
