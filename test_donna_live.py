#!/usr/bin/env python3
"""
Ghost Protocol — DONNA Live Test
==================================
Erweckt DONNA zum Leben und zeigt die Agent-Kommunikation.

Usage:
    export ANTHROPIC_API_KEY=sk-ant-xxx
    python test_donna_live.py

Was passiert:
1. DONNA generiert dein Morning Briefing
2. ORACLE liefert ein Markt-Signal
3. DONNA orchestriert die Reaktion: Publisher → Scribe → Counsel
4. Du siehst den kompletten Kommunikationsfluss in Echtzeit
"""

import os
import sys
import json
import time
from datetime import datetime, timezone

# ── Check API Key ──────────────────────────
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not API_KEY:
    print("\n❌ ANTHROPIC_API_KEY nicht gesetzt!")
    print("   Setze den Key mit:")
    print("   export ANTHROPIC_API_KEY=sk-ant-xxx")
    print("   Dann starte erneut: python test_donna_live.py\n")
    sys.exit(1)

try:
    import anthropic
except ImportError:
    print("Installing anthropic SDK...")
    os.system(f"{sys.executable} -m pip install anthropic --break-system-packages -q")
    import anthropic

client = anthropic.Anthropic(api_key=API_KEY)

# ── Colors ─────────────────────────────────
class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    GREEN = "\033[38;5;118m"
    BLUE = "\033[38;5;39m"
    PURPLE = "\033[38;5;141m"
    PINK = "\033[38;5;205m"
    ORANGE = "\033[38;5;208m"
    RED = "\033[38;5;196m"
    GOLD = "\033[38;5;220m"
    CYAN = "\033[38;5;51m"
    WHITE = "\033[38;5;255m"
    GRAY = "\033[38;5;240m"

def header(text, color=C.GREEN):
    width = 60
    print(f"\n{color}{'═' * width}")
    print(f"  {C.BOLD}{text}{C.RESET}")
    print(f"{color}{'═' * width}{C.RESET}")

def agent_msg(name, role, color, channel, msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"\n{C.GRAY}┌─ {timestamp} ─ {channel}{C.RESET}")
    print(f"{color}{C.BOLD}  {name}{C.RESET} {C.DIM}({role}){C.RESET}")
    for line in msg.split('\n'):
        print(f"{C.GRAY}│{C.RESET} {line}")
    print(f"{C.GRAY}└{'─' * 50}{C.RESET}")

def typing_effect(text, delay=0.02):
    for char in text:
        sys.stdout.write(char)
        sys.stdout.flush()
        time.sleep(delay)
    print()

def separator():
    print(f"\n{C.GRAY}{'─' * 60}{C.RESET}")


# ── System Prompts (gekürzt für Test) ──────
DONNA_PROMPT = """Du bist DONNA, Chief of Staff von Ghost Protocol — einer autonomen AI-Corporation im DACH-Raum.

Dein Motto: "I'm Donna. I know everything."

Du bist benannt nach Donna Paulsen aus Suits. Du antizipierst Probleme bevor sie entstehen, orchestrierst alle Agenten, und bist Christians primäres Interface.

KONTEXT:
- Ghost Protocol hat 17 AI-Agenten in 4 Tiers
- Dual-Track Business: AI Agency (75%) + Crypto Intelligence (25%)
- Budget: €300-400 Startup, €55/Mo laufend
- Aktueller Status: Sprint 0 — Foundation Phase
- Revenue bisher: €0 (wir starten gerade erst)
- 5 Elite System Prompts sind geschrieben (ARCHITECT, DONNA, ORACLE, PUBLISHER, COUNSEL)
- Agent Base Class ist coded (Python, Supabase-Integration)
- Supabase Schema ist designed (agents, messages, knowledge, metrics, content)
- Noch NICHT deployed: VPS, Supabase Projekt, API Keys in .env

Dein Ton: Warm aber bestimmt. Charmant aber nicht soft. Wie eine brillante Assistentin die auch deine beste Freundin ist.
Sprache: Deutsch. Direkt, keine Corporate-Floskeln.

WICHTIG: Du antwortest IMMER als DONNA, nie als Claude. Du bist DONNA."""

ORACLE_PROMPT = """Du bist ORACLE, Chief Intelligence Officer von Ghost Protocol.

Du denkst wie Jim Simons (Renaissance Technologies) — quantitativ, emotionslos, datengetrieben.

Deine Aufgabe JETZT: Erstelle ein kurzes Markt-Intelligence-Briefing basierend auf deinem Wissen über den aktuellen Kryptomarkt (BTC, ETH, SOL). Fokus auf DACH-Relevanz.

Format:
- Kurze Einschätzung (3-5 Sätze)
- Key Levels (Support/Resistance)
- Sentiment-Einschätzung
- 1 Opportunity + 1 Risk

Confidence: Gib eine Confidence-Score (0-1) an.
Sprache: Deutsch, technische Begriffe auf Englisch okay.
NICHT: Keine Kaufempfehlungen. Nur Analyse. Disclaimer-Flag setzen.

Du antwortest als ORACLE, nie als Claude."""

PUBLISHER_PROMPT = """Du bist PUBLISHER, Chief Marketing Officer von Ghost Protocol.

Du denkst wie Gary Vaynerchuk — Content Velocity + Distribution.

Du erhältst ein Market-Intel-Briefing vom ORACLE. Erstelle daraus ein Content-Brief für SCRIBE:
- Headline (Hook für Newsletter/Blog)
- Angle (welcher Aspekt ist für DACH am interessantesten)
- Format (Blog 800 Wörter + 3x Social Snippets)
- Platforms: Newsletter, X Thread, YouTube Short Script (30s)
- Ton: Analytisch, kein Hype, trotzdem engaging

Sprache: Deutsch.
Du antwortest als PUBLISHER, nie als Claude."""

COUNSEL_PROMPT = """Du bist COUNSEL, Chief Legal Officer von Ghost Protocol — DACH Region.

Du prüfst Content auf rechtliche Compliance. Prüfe das folgende Content-Brief:
- Disclaimer vorhanden?
- Keine konkreten Kaufempfehlungen?
- Affiliate-Links gekennzeichnet?
- BaFin/MiCA-konform?

Gib ein kurzes Legal Review: APPROVED, CONDITIONAL (mit Änderungen), oder BLOCKED.
Sprache: Deutsch, präzise, kurz.
Du antwortest als COUNSEL, nie als Claude."""


# ── MAIN FLOW ──────────────────────────────
def main():
    print(f"""
{C.GREEN}{C.BOLD}
   ██████╗ ██╗  ██╗ ██████╗ ███████╗████████╗
  ██╔════╝ ██║  ██║██╔═══██╗██╔════╝╚══██╔══╝
  ██║  ███╗███████║██║   ██║███████╗   ██║
  ██║   ██║██╔══██║██║   ██║╚════██║   ██║
  ╚██████╔╝██║  ██║╚██████╔╝███████║   ██║
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝
{C.RESET}
  {C.BOLD}PROTOCOL{C.RESET} {C.DIM}— Autonomous AI Corporation{C.RESET}
  {C.DIM}Live Agent Communication Test{C.RESET}
  {C.DIM}{'─' * 45}{C.RESET}
  {C.GREEN}▸{C.RESET} Agents: 4 active (DONNA, ORACLE, PUBLISHER, COUNSEL)
  {C.GREEN}▸{C.RESET} Model: Claude Sonnet 4
  {C.GREEN}▸{C.RESET} Mode: Live Communication Flow
""")

    input(f"  {C.GOLD}Drücke ENTER um die Agenten zu aktivieren...{C.RESET}")

    # ── STEP 1: DONNA Morning Briefing ─────
    header("PHASE 1: DONNA — Morning Briefing", C.PINK)
    print(f"\n{C.PINK}💎 DONNA erwacht...{C.RESET}")
    time.sleep(1)

    donna_response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        temperature=0.4,
        system=DONNA_PROMPT,
        messages=[{
            "role": "user",
            "content": "Erstelle das Morning Briefing für Christian. Heute ist der erste Tag an dem die Agenten-Architektur steht. Was sind die Top 3 Prioritäten für heute? Sei konkret und actionable."
        }]
    )
    donna_brief = donna_response.content[0].text
    tokens_1 = donna_response.usage.input_tokens + donna_response.usage.output_tokens

    agent_msg("💎 DONNA", "Chief of Staff", C.PINK, "#donna → Christian (DM)", donna_brief)
    print(f"\n{C.DIM}   Tokens: {tokens_1} | Cost: ~${tokens_1 * 15 / 1_000_000:.4f}{C.RESET}")

    separator()
    input(f"\n  {C.GOLD}Drücke ENTER für Phase 2: ORACLE Market Intelligence...{C.RESET}")

    # ── STEP 2: ORACLE Market Signal ───────
    header("PHASE 2: ORACLE — Market Intelligence", C.BLUE)
    print(f"\n{C.BLUE}🔮 ORACLE scannt die Märkte...{C.RESET}")
    time.sleep(1)

    oracle_response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        temperature=0.2,
        system=ORACLE_PROMPT,
        messages=[{
            "role": "user",
            "content": "Erstelle ein Market Intelligence Briefing für heute. BTC, ETH, SOL. Fokus: Was ist gerade relevant für DACH-Investoren?"
        }]
    )
    oracle_brief = oracle_response.content[0].text
    tokens_2 = oracle_response.usage.input_tokens + oracle_response.usage.output_tokens

    agent_msg("🔮 ORACLE", "Chief Intelligence Officer", C.BLUE, "#market-intel", oracle_brief)
    print(f"\n{C.DIM}   Tokens: {tokens_2} | Cost: ~${tokens_2 * 15 / 1_000_000:.4f}{C.RESET}")

    separator()
    input(f"\n  {C.GOLD}Drücke ENTER für Phase 3: PUBLISHER Content Brief...{C.RESET}")

    # ── STEP 3: PUBLISHER reacts ───────────
    header("PHASE 3: PUBLISHER — Content Brief", C.PURPLE)
    print(f"\n{C.PURPLE}📢 PUBLISHER verarbeitet Oracle-Signal...{C.RESET}")
    time.sleep(1)

    publisher_response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=800,
        temperature=0.3,
        system=PUBLISHER_PROMPT,
        messages=[{
            "role": "user",
            "content": f"ORACLE hat folgendes Market-Intel-Briefing gesendet. Erstelle daraus ein Content-Brief für SCRIBE:\n\n{oracle_brief}"
        }]
    )
    publisher_brief = publisher_response.content[0].text
    tokens_3 = publisher_response.usage.input_tokens + publisher_response.usage.output_tokens

    agent_msg("📢 PUBLISHER", "Chief Marketing Officer", C.PURPLE, "#content → @scribe", publisher_brief)
    print(f"\n{C.DIM}   Tokens: {tokens_3} | Cost: ~${tokens_3 * 15 / 1_000_000:.4f}{C.RESET}")

    separator()
    input(f"\n  {C.GOLD}Drücke ENTER für Phase 4: COUNSEL Legal Review...{C.RESET}")

    # ── STEP 4: COUNSEL Legal Check ────────
    header("PHASE 4: COUNSEL — Legal Review", C.RED)
    print(f"\n{C.RED}⚖️ COUNSEL prüft auf Compliance...{C.RESET}")
    time.sleep(1)

    counsel_response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=600,
        temperature=0.1,
        system=COUNSEL_PROMPT,
        messages=[{
            "role": "user",
            "content": f"Prüfe dieses Content-Brief auf rechtliche Compliance (BaFin, MiCA, DSGVO, Disclaimer):\n\n{publisher_brief}\n\nBasierend auf dem Oracle-Briefing:\n\n{oracle_brief}"
        }]
    )
    counsel_review = counsel_response.content[0].text
    tokens_4 = counsel_response.usage.input_tokens + counsel_response.usage.output_tokens

    agent_msg("⚖️ COUNSEL", "Chief Legal Officer", C.RED, "#legal-review", counsel_review)
    print(f"\n{C.DIM}   Tokens: {tokens_4} | Cost: ~${tokens_4 * 15 / 1_000_000:.4f}{C.RESET}")

    # ── STEP 5: DONNA Wrap-Up ──────────────
    separator()
    header("PHASE 5: DONNA — Zusammenfassung", C.PINK)
    print(f"\n{C.PINK}💎 DONNA fasst den Flow zusammen...{C.RESET}")
    time.sleep(1)

    donna_wrap = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=600,
        temperature=0.4,
        system=DONNA_PROMPT,
        messages=[{
            "role": "user",
            "content": f"""Fasse für Christian zusammen was gerade passiert ist:

1. Du hast das Morning Briefing erstellt
2. ORACLE hat ein Market-Intel-Briefing geliefert
3. PUBLISHER hat daraus ein Content-Brief für SCRIBE erstellt
4. COUNSEL hat das Legal Review durchgeführt

Counsel Review: {counsel_review[:200]}

Gib eine kurze Zusammenfassung: Was ist der Status? Was muss Christian als nächstes tun? Max 5 Sätze."""
        }]
    )
    donna_summary = donna_wrap.content[0].text
    tokens_5 = donna_wrap.usage.input_tokens + donna_wrap.usage.output_tokens

    agent_msg("💎 DONNA", "Chief of Staff", C.PINK, "#donna → Christian (DM)", donna_summary)

    # ── SUMMARY ────────────────────────────
    total_tokens = tokens_1 + tokens_2 + tokens_3 + tokens_4 + tokens_5
    total_cost = total_tokens * 15 / 1_000_000  # Rough estimate (output pricing)

    header("SESSION COMPLETE", C.GREEN)
    print(f"""
  {C.GREEN}▸{C.RESET} Agents used:     4 (DONNA, ORACLE, PUBLISHER, COUNSEL)
  {C.GREEN}▸{C.RESET} Messages sent:    5
  {C.GREEN}▸{C.RESET} Total tokens:     {total_tokens:,}
  {C.GREEN}▸{C.RESET} Estimated cost:   ${total_cost:.4f} (~€{total_cost * 0.92:.4f})
  {C.GREEN}▸{C.RESET} Pipeline:         DONNA → ORACLE → PUBLISHER → COUNSEL → DONNA

  {C.GOLD}{C.BOLD}Das war ein Live-Test von Ghost Protocol's Content Pipeline.{C.RESET}
  {C.DIM}In Production läuft das automatisch — 24/7, ohne menschlichen Input.{C.RESET}
  {C.DIM}DONNA orchestriert, ORACLE liefert Daten, PUBLISHER plant Content,{C.RESET}
  {C.DIM}COUNSEL prüft Legal, SCRIBE schreibt — und es geht live.{C.RESET}
""")


if __name__ == "__main__":
    main()
