# GHOST PROTOCOL — Claude Code Context

Detailliertes Wissen liegt in den Memory-Dateien (`.claude/projects/.../memory/`).
Diese Datei ist der kompakte Einstiegspunkt.

## Quick Reference

**Ghost Protocol** = Autonome AI-Corporation, DACH-Fokus, 17 Agenten, multiple Revenue-Streams.
**WHITEPULSE** = Erste Brand unter Ghost Protocol (AI-Trading, whitepulse.io).
**CryptoDog** = Trading-Engine (separates Repo), liefert Ergebnisse die WHITEPULSE vermarktet.

## Aktueller Stand (11.06.2026)

- **PropPass gescoped** — Produkt #1: Prop-Firm-Readiness-Check (siehe `docs/proppass-mvp.md` + `proppass/rulesets/`)
- **CASSANDRA (#18) erschaffen** — Chief Risk & Pre-Mortem Officer, Pflicht-Review vor Launches/Go-Lives
- **17/17 Agenten auf v2 upgraded** (Agent-Audit 05.04.2026), CASSANDRA = #18 (v1, 11.06.2026)
- **CrewAI rausgeloest** — BaseAgent + Standalone Tools (kein Framework-Overhead)
- **OracleAgent + ResearcherAgent migriert** auf BaseAgent mit 2-Step Pattern
- **Execution Engine:** 7 Module (AgentRunner, MailerLite, ContentTemplates, DonnaScheduler, TelegramNotify, BusinessModel, TestFramework)
- **Tools extrahiert:** market_tools, research_tools, publish_tools, monitor_tools (standalone)
- **Next.js API Routes komplett:** agents, donna/delegate, content/pipeline, fleet, cron, messages
- **WHITEPULSE Brand LIVE:** Website indexiert, Newsletter aktiv, X + LinkedIn + YouTube
- **Lead Magnet PDF:** 10-Seiten Report fertig (`assets/`)
- **Reply Playbook:** 6 DACH-Zielaccounts, 12 Templates
- **Live-Ergebnisse (CryptoDog):** PF 2.35, WR 35%, PnL +48.13%, 20 Trades

## Hierarchie (KRITISCH — nicht verwechseln!)

```
Ghost Protocol (Unternehmen)
├── WHITEPULSE (1. Brand — AI-Trading)
│   └── nutzt Ergebnisse von → CryptoDog (Engine, separates Repo)
├── [2. Brand — noch offen]
└── 17 Agenten operieren ALLE Brands
```

## Firma
- **Name:** White IT Solution (Einzelunternehmen, seit 2016)
- **Regelung:** Kleinunternehmer §19 UStG
- **Inhaber:** Christian Weissenberg, Hirtenberg 1, 39171 Suelzetal

## Budget (NICHT VERHANDELBAR)
- Laufend: ~€55/Mo (VPS €6, Claude API ~€40, Serper €5, Domain €2)
- Max €200 Trading-Kapital

## Die 18 Agenten

### Tier 0 — The Brain
| Agent | Rolle | LLM | Rating |
|-------|-------|-----|--------|
| STRATEGIST | CEO — Revenue Staircase, Indie-Hacker | Sonnet | 8/10 |
| DONNA | Chief of Staff — Orchestrierung | Sonnet | 8/10 |
| CASSANDRA | Chief Risk & Pre-Mortem Officer — Pflicht-Review, Kill-Kriterien | Sonnet | NEU (11.06) |

### Tier 1 — C-Suite
| Agent | Rolle | LLM | Rating |
|-------|-------|-----|--------|
| OPERATOR | COO — Workflow/SLA/QA | Sonnet | 7/10 |
| ORACLE | CIO — On-Chain/Sentiment/Macro | Sonnet | 8/10 |
| ARCHITECT | CTO — Platform/Infra | Sonnet | 7/10 |
| TREASURER | CFO — P&L/Budget, DE-Steuer | Haiku | 7/10 |
| PUBLISHER | CMO — Content/SEO/Social | Sonnet | 7/10 |
| COUNSEL | CLO — MiCA/BaFin/DSGVO | Sonnet | 9/10 |

### Tier 2 — Directors
| Agent | Rolle | LLM | Rating |
|-------|-------|-----|--------|
| AMPLIFIER | Head of Growth | Sonnet | 7/10 |
| MERCHANT | Head of Product | Sonnet | 7/10 |
| RESEARCHER | Head of Research | Sonnet | 7/10 |

### Tier 3 — Operators
| Agent | Rolle | LLM | Rating |
|-------|-------|-----|--------|
| SCRIBE | Content Producer | Sonnet | 7/10 |
| TRADER | Market Analyst | Sonnet | 8/10 |
| GUARDIAN | SRE/Monitoring | Haiku | 7/10 |
| CONCIERGE | Community Support | Haiku | 7/10 |
| LOCALIZER | DACH-Adaptation | Haiku | 7/10 |

## Tech Stack
| Component | Technologie |
|-----------|------------|
| Framework | BaseAgent + AgentRunner (KEIN CrewAI) |
| LLMs | Claude Sonnet 4 (11) + Claude Haiku (6) |
| Database | Supabase (Postgres + pgvector) |
| Dashboard | Next.js 16 + Tailwind + Supabase Realtime |
| Hosting | Hetzner VPS CX22 (€6/Mo, shared mit CryptoDog) |
| Newsletter | MailerLite (Free Tier, ersetzt Beehiiv) |
| Payments | Gumroad (geplant, Account noch nicht erstellt) |

## Revenue-Streams (9 geplant)

| # | Stream | Status |
|---|--------|--------|
| 1 | Premium Intelligence Reports (€29-49/Mo) | GEPLANT |
| 2 | Digital Products via Gumroad (€29-97) | GEPLANT |
| 3 | Affiliate (MEXC 70%, Binance 50%) | GEPLANT |
| 4 | SEO Blog (Traffic → Subscriber) | GEPLANT |
| 5 | Agent-as-a-Service für Prop Firms | NACH TESTPHASE |
| 6 | Newsletter Sponsoring | NACH 1000 Subscriber |
| 7 | Consulting/Agency | GEPLANT |

Revenue Staircase: €0 → €100 → €500 → €1k → €10k

## Repo-Struktur
```
ghost-protocol/
├── agents/
│   ├── base_agent.py        # BaseAgent (RAG, MessageBus, Logging, Cost Tracking)
│   ├── config.py            # LLM config, API Keys, Disclaimers
│   ├── oracle.py            # OracleAgent(BaseAgent) — Market Intelligence
│   ├── researcher.py        # ResearcherAgent(BaseAgent) — Product Research
│   └── prompts/             # 16 Agent System-Prompts (.md, alle v2)
├── tools/                   # Standalone Tools (kein Framework-Dependency)
│   ├── market_tools.py      # Serper News, CoinGecko, DACH News
│   ├── research_tools.py    # Gumroad, Etsy, Reddit, DACH Gaps
│   ├── publish_tools.py     # Gumroad Sales, Content Queue
│   └── monitor_tools.py     # Telegram Alerts
├── execution/               # Synchrone Execution (Cron-Jobs)
│   ├── agent_runner.py      # Lightweight Runner (1 API-Call/Task)
│   ├── donna_scheduler.py   # 5 Pipelines (Briefing, Newsletter, Social, Review, Plan)
│   ├── content_templates.py # HTML Templates (Newsletter, Social)
│   ├── mailerlite.py        # MailerLite API v2 Client
│   └── telegram_notify.py   # Telegram Bot + Approvals
├── crews/                   # Async Pipeline-Orchestrierung
│   ├── content_crew.py      # Oracle → Publisher → Broadcaster → Amplifier
│   └── revenue_crew.py      # Researcher → Merchant → Outreach
├── site/                    # Next.js 16 Dashboard + API
│   └── src/app/api/         # agents, donna, content, fleet, cron, messages
├── scripts/                 # Standalone Scripts
├── templates/               # Content-Templates
├── assets/                  # Lead Magnet PDF, Video-Konzept
├── docs/                    # Vision, Legal, Revenue, Agents, Sprints, Decisions, QA
├── .claude/skills/          # gp-orchestrator, gp-code-review
├── data/                    # Runtime data (state, queues, cost logs)
└── outputs/                 # Generated content (briefings, reports)
```

## WHITEPULSE Brand (Sub-Projekt)
- **Website:** whitepulse.io (IONOS, 10/10 3D Effects)
- **Mockups-Pfad:** `/Users/chrisrock/Documents/CryptoDoc/App/whitepulse-mockups/` (READ-ONLY)
- **Newsletter:** MailerLite (Account 2240934, Form F6zemz)
- **Social:** @WhitePulseAI (X, LinkedIn, YouTube)
- **SEO:** Google Search Console verifiziert, indexiert, Sitemap eingereicht
- **Analytics:** Umami Cloud (DSGVO-konform)

## CryptoDog Engine (READ-ONLY Referenz)
- **Pfad:** `/Users/chrisrock/Documents/CryptoDoc/App/` (NIEMALS aus GP-Session bearbeiten!)
- **GitHub:** `christianweissenberg-creator/App`
- **VPS:** `cryptodog007.duckdns.org`
- **Ergebnisse:** PF 2.35, WR 35%, PnL +48.13%, 20 Trades (Stand 22.03.2026)

## Deployment
- **Ghost Protocol VPS:** ghostcorp.duckdns.org (Coolify Docker)
- **IP:** 46.225.180.35 (shared mit CryptoDog)
- **GitHub:** christianweissenberg-creator/ghost-protocol (privat)

## LEGAL (INTERN vs. EXTERN)

### INTERN (Eigenes Trading) — Maximaler Spielraum
✅ Kaufempfehlungen, Portfolio-Allokation, Signale, Prognosen

### EXTERN (Kunden/Öffentlichkeit) — Legal Compliant
❌ Keine Vermögensverwaltung (BaFin-pflichtig)
✅ Marktanalysen MIT Disclaimer, Affiliate MIT Kennzeichnung, Digitale Produkte

**Pflicht-Disclaimer:**
```
⚠️ Keine Anlageberatung | Dieser Inhalt dient ausschließlich Informationszwecken.
Kryptowährungen sind hochriskant — investiere nur Kapital, dessen Totalverlust du verkraften kannst.
Affiliate-Links sind gekennzeichnet (*).
```

## Code-Konventionen
- Python 3.12+, Type Hints, async/await fuer Agent-Code
- Neue Agents erben von BaseAgent, implementieren execute()
- Tools sind standalone Funktionen (kein Framework-Decorator)
- AgentRunner fuer synchrone Cron-Jobs, BaseAgent fuer async Pipelines
- Config via .env, nie hardcoded Secrets
- Commits: 🚀 feature, 🐛 fix, 📝 docs, 🔧 config, 🤖 agent, 💰 revenue

## Offene naechste Schritte
1. **Supabase Projekt erstellen** → SQL Schema ausfuehren
2. **Restliche 15 Agents als BaseAgent-Subklassen** (wie Oracle + Researcher)
3. **Message Bus live** — Supabase Realtime statt Polling
4. **Auth Layer** fuer Dashboard
5. **VPS Deploy** — Cron-Jobs, Docker
6. **Gumroad + X API** anbinden
7. Eigenstaendige Revenue-Streams (ueber WHITEPULSE hinaus)
8. MailerLite Welcome Sequence einrichten
9. Content-Posts manuell veroeffentlichen (X + LinkedIn)

## Sprache
- UI/Content: Deutsch (DACH-Markt)
- Code: Englisch
- Konversation: Deutsch

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
