# GHOST PROTOCOL — Claude Code Context

## Was ist Ghost Protocol?
Autonome AI-Corporation im DACH-Raum. 17 AI-Agenten in 4 Tiers, die 24/7 Revenue generieren: Crypto Intelligence Reports, digitale Produkte, AI Agency Services. Aufgebaut von Christian (Krypto-Analyst & Unternehmer, Magdeburg).

## Unternehmensphilosophie: "The Donna Protocol"
Inspiriert von Donna Paulsen (Suits). 7 Prinzipien: Antizipation statt Reaktion, Charme statt Bürokratie, jeder kennt seinen Wert, Loyalität zum System, Probleme lösen nicht delegieren, Information teilen, Menschlichkeit in der Maschine.

## Die 17 Agenten (4 Tiers)

### Tier 0 — The Brain
| Agent | Rolle | LLM |
|-------|-------|-----|
| STRATEGIST | CEO — Elon Musk meets Jeff Bezos | Sonnet |
| DONNA | Chief of Staff — Orchestrierung, Antizipation, Human Interface | Sonnet |

### Tier 1 — C-Suite
| Agent | Rolle | LLM |
|-------|-------|-----|
| OPERATOR | COO — Tim Cook, Workflow/SLA/QA Management | Sonnet |
| ORACLE | CIO — Jim Simons, On-Chain/Sentiment/Macro Intelligence | Sonnet |
| ARCHITECT | CTO — Jensen Huang, Platform/Infra/Scaling | Sonnet |
| TREASURER | CFO — Warren Buffett, P&L/Budget/Revenue Attribution | Haiku |
| PUBLISHER | CMO — Gary Vee, Content Strategy/SEO/Social Media | Sonnet |
| COUNSEL | CLO — DACH Legal, MiCA/BaFin/DSGVO/DAC8 Compliance | Sonnet |

### Tier 2 — Directors
| Agent | Rolle | LLM |
|-------|-------|-----|
| AMPLIFIER | Head of Growth — Virale Distribution, Community | Sonnet |
| MERCHANT | Head of Product — Digital Products, Pricing, Gumroad | Sonnet |
| RESEARCHER | Head of Research — Marktanalyse, Trends, Validierung | Sonnet |

### Tier 3 — Operators
| Agent | Rolle | LLM |
|-------|-------|-----|
| SCRIBE | Content Producer — Artikel, Reports, Social Posts | Sonnet |
| TRADER | Market Analyst — Charts, Signale, Risk Levels | Sonnet |
| GUARDIAN | Data Engineer — System Monitoring, Health Checks | Haiku |
| CONCIERGE | Community Support — FAQ, Onboarding, Telegram Bot | Haiku |
| LOCALIZER | Cultural Intelligence — DE↔EN, DACH-Adaptation | Haiku |

## Tech Stack
- **Framework:** CrewAI (self-hosted) + Custom BaseAgent Architecture
- **LLMs:** Claude Sonnet 4 (11 Agents) + Claude Haiku (6 Agents) via Anthropic API
- **Database:** Supabase (Postgres + pgvector + Realtime)
- **Cache/PubSub:** Redis (on VPS)
- **Hosting:** Hetzner VPS CX22 (€6/Mo)
- **Blog/Landing:** Astro + Cloudflare Pages
- **Newsletter:** Beehiiv (Free bis 2.500 Subscriber)
- **Shop:** Gumroad (€0, 10% Commission)
- **CI/CD:** GitHub Actions
- **Monitoring:** Telegram Bot + Supabase Logs

## Budget (NICHT VERHANDELBAR)
- Startup: €300-400
- Laufend: ~€55/Mo (VPS €6, Claude API ~€40, Serper €5, Domain €2)
- Jede Architektur-Entscheidung muss innerhalb dieses Budgets funktionieren

## Repo-Struktur
```
ghost-protocol/
├── agents/
│   ├── __init__.py          # Agent exports (Legacy + New)
│   ├── base_agent.py        # ⭐ BaseAgent Class (RAG, MessageBus, Logging, Cost Tracking)
│   ├── config.py            # LLM config (Legacy)
│   ├── oracle.py            # Oracle agent (Legacy CrewAI version)
│   ├── researcher.py        # Researcher agent (Legacy CrewAI version)
│   └── prompts/
│       ├── architect.md     # ⭐ CTO Elite System Prompt
│       ├── donna.md         # ⭐ Chief of Staff Elite System Prompt
│       ├── oracle.md        # ⭐ CIO Elite System Prompt
│       ├── publisher.md     # ⭐ CMO Elite System Prompt
│       └── counsel.md       # ⭐ CLO Elite System Prompt
├── crews/                   # CrewAI Crew definitions
├── tools/                   # CrewAI Tools
├── scripts/
│   ├── setup_supabase.sql   # ⭐ Komplettes DB Schema (agents, messages, knowledge, metrics, content)
│   ├── ingest_knowledge.py  # ⭐ RAG Pipeline (chunk → embed → upload)
│   ├── setup.sh
│   ├── daily_briefing.py
│   └── health_check.py
├── docs/                    # Project documentation
├── templates/               # Content templates
├── site/                    # Astro blog
├── .github/workflows/       # CI/CD
├── test_donna_live.py       # ⭐ Live Agent Communication Test (FUNKTIONIERT!)
├── .env.example             # ⭐ Alle benötigten API Keys
├── requirements.txt
└── README.md
```

## Was bereits funktioniert (getestet!)
- `test_donna_live.py` — 4 Agenten (DONNA, ORACLE, PUBLISHER, COUNSEL) kommunizieren live
- Pipeline: DONNA Briefing → ORACLE Signal → PUBLISHER Content Brief → COUNSEL Legal Review → DONNA Summary
- Elite System Prompts für 5 Core Agents geschrieben
- BaseAgent Class mit MessageBus, RAG, Logging, Cost Tracking
- Supabase SQL Schema komplett designed

## Was als nächstes gebaut werden muss (Roadmap)
1. **Supabase Projekt erstellen** → SQL Schema ausführen
2. **Restliche 12 Agent-Prompts schreiben** (OPERATOR, STRATEGIST, AMPLIFIER, MERCHANT, RESEARCHER, SCRIBE, TRADER, GUARDIAN, CONCIERGE, LOCALIZER, TREASURER)
3. **Concrete Agent Classes** implementieren (jeder Agent erbt von BaseAgent)
4. **Knowledge Base füllen** — MiCA, BaFin, Bitcoin Whitepaper, SEO Guides etc.
5. **Message Bus live schalten** — Supabase Realtime
6. **Content Pipeline automatisieren** — Oracle → Publisher → Scribe → Counsel → Live
7. **Social Media Integration** — YouTube, TikTok, Instagram, X, LinkedIn, Telegram, Reddit
8. **VPS Deploy** — Hetzner CX22, Docker, GitHub Actions
9. **Dashboard** — Live Agent Communication Monitoring

## Dual-Track Business Model
- **Track A (75%):** AI Agency — Ghost Protocol's Architektur als Service. €5-15k/Projekt.
- **Track B (25%):** Crypto Intelligence — Reports, Produkte, Affiliate. DACH-Markt.

## LEGAL REGELN (INTERN vs. EXTERN)

### INTERN (Christian ↔ Agenten) — Maximaler Spielraum
Die Agenten sind Christians privates Research- & Trading-Tool. Hier gilt:
- ✅ Explizite Kaufempfehlungen ("Kauf ETH bei $3.200, SL $2.900, TP $3.800")
- ✅ Portfolio-Allokation & Rebalancing-Vorschläge
- ✅ Trading-Signale mit Entry/Exit/Risk-Levels
- ✅ Marktprognosen & Price Targets
- ✅ On-Chain Analysen mit konkreten Handlungsempfehlungen
- ✅ Sentiment-basierte Strategien
- ✅ Eigenes Trading auf regulierten CEXs

### EXTERN (Output an Kunden/Öffentlichkeit) — Legal Compliant
Bei JEDEM öffentlichen Output gelten die DACH-Regularien:
- ❌ KEINE Vermögensverwaltung für Dritte (BaFin-pflichtig)
- ❌ KEINE Garantie-Versprechen bei Affiliate-Werbung
- ⚠️ Marktanalysen & Einschätzungen NUR MIT Disclaimer
- ✅ Affiliate-Marketing MIT Werbekennzeichnung (*)
- ✅ Newsletter/Content MIT Disclaimer
- ✅ Digitale Produkte verkaufen (Reports, Kurse, Templates)
- ✅ Bildungsinhalte über Krypto, Trading, AI

**Pflicht-Disclaimer in JEDEM öffentlichen Output:**
```
⚠️ Keine Anlageberatung | Dieser Inhalt dient ausschließlich Informationszwecken und stellt keine Anlageberatung, Empfehlung oder Aufforderung zum Kauf oder Verkauf von Finanzinstrumenten dar. Kryptowährungen sind hochriskant — investiere nur Kapital, dessen Totalverlust du verkraften kannst. Affiliate-Links sind gekennzeichnet (*).
```

## Steuerregeln DE (Stand 2026)
- Haltefrist >12 Monate = steuerfrei
- Haltefrist <12 Monate + Gewinn >€1.000/Jahr = Einkommensteuer (14-45%)
- Staking/Mining/Airdrops: €256 Freigrenze
- DAC8: Exchanges melden automatisch ans Finanzamt
- FIFO-Methode = Pflicht

## Code-Konventionen
- Python 3.12+, Type Hints überall, Docstrings in jedem Modul
- Config via .env, nie hardcoded Secrets
- Commit-Messages: 🚀 feature, 🐛 fix, 📝 docs, 🔧 config, 🤖 agent, 💰 revenue
- Branch-Namen: sprint-X/feature-name

## GitHub
- Repo: christianweissenberg-creator/ghost-protocol (Private)
- 37+ Dateien auf main Branch

## Vorbilder & Inspiration
- NVIDIA (Jensen Huang): Platform = Produkt
- Elon Musk: First Principles + Velocity
- Donna Paulsen (Suits): Antizipation + Charme
- Jim Simons (Renaissance): Quantitativ + Emotionslos
- Gary Vaynerchuk: Content Velocity + Distribution
- Tim Cook: Operations Excellence
