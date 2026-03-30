# 👻 GHOST PROTOCOL

**Autonomous AI Corporation — 14 Agenten, 1 Ziel: Revenue 24/7**

> Eine vollständig autonome Firma, betrieben von spezialisierten AI-Agenten, die multiple Revenue-Streams parallel operieren — ohne täglichen manuellen Eingriff.

## Status: 🟡 Phase 0 — Foundation

| Metrik | Wert |
|---|---|
| Startup-Budget | €300-400 |
| Ziel Monat 1 | €800-1.500 |
| Ziel Monat 3 | €2.000-5.000 |
| Automation Level | 95%+ |
| Dein Zeitaufwand | 2-5h/Woche Oversight |

## Architektur

```
┌─────────────────────────────────────────────────┐
│              THE STRATEGIST (CEO)                │
│         Wöchentliche Ressourcen-Allokation       │
└──────────────────────┬──────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ CONTENT  │  │ REVENUE  │  │   OPS    │
  │  CREW    │  │  CREW    │  │  CREW    │
  ├──────────┤  ├──────────┤  ├──────────┤
  │ Oracle   │  │ Merchant │  │ Guardian │
  │ Publisher│  │ Outreach │  │Treasurer │
  │Amplifier │  │ Optimizer│  │Strategist│
  │Broadcast.│  │ Trader   │  │          │
  └──────────┘  └──────────┘  └──────────┘
        │              │              │
        ▼              ▼              ▼
   SEO Blog      Digital Products   P&L Reports
   Newsletter    Affiliate Rev.     Health Alerts
   Social Posts  Premium Subs       Strategy Memos
```

## Quick Start

```bash
# 1. Repo klonen
git clone git@github.com:YOUR_USER/ghost-protocol.git
cd ghost-protocol

# 2. Python Environment
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt

# 3. Environment Variables
cp .env.example .env
# → API Keys eintragen

# 4. Ersten Agent testen
python -m agents.researcher
```

## Projektstruktur

```
ghost-protocol/
├── docs/               # Obsidian Vault — Knowledge Base
│   ├── 00-INDEX.md     # Projekt-Übersicht + Links
│   ├── 01-vision.md    # Vision & Strategie
│   ├── 02-legal.md     # Rechtliche Findings (DE)
│   ├── 03-revenue.md   # Revenue Model & Projektion
│   ├── 04-agents.md    # Agent-Spezifikationen
│   ├── 05-sprints.md   # Sprint-Plan & Tracking
│   ├── 06-decisions.md # Entscheidungslog
│   └── 07-qa.md        # 50 kritische Fragen
├── agents/             # CrewAI Agent-Definitionen
├── crews/              # Crew-Orchestrierung
├── tools/              # Custom Agent-Tools
├── scripts/            # Automation & Cron
├── templates/          # Content-Templates
└── .github/workflows/  # CI/CD & Scheduled Jobs
```

## Docs als Obsidian Vault

Der `docs/` Ordner ist ein vollständiger Obsidian Vault. Öffne ihn direkt in Obsidian:
1. Obsidian → "Open folder as vault"
2. Wähle `ghost-protocol/docs/`
3. Alle Notes sind interlinked via `[[wikilinks]]`

## Legal Disclaimer

Dieses Projekt ist für Bildungszwecke. Keine Anlageberatung. Krypto-Investments sind risikoreich. Alle Trading-Aktivitäten erfolgen auf eigenes Risiko. Siehe `docs/02-legal.md` für vollständige rechtliche Analyse.

---

*Ghost Protocol v0.1 — Built with Claude + CrewAI*
