# Agent-Spezifikationen — 14 Agenten

## Übersicht

| # | Agent | Rolle | LLM | Priorität | Status |
|---|-------|-------|-----|-----------|--------|
| 1 | Oracle | Markt-Intelligence | Sonnet | P0 | Sprint 1 |
| 2 | Publisher | Content-Erstellung | Sonnet | P0 | Sprint 1 |
| 3 | Guardian | System-Security | Haiku | P0 | Sprint 1 |
| 4 | Researcher | Produkt-Research | Sonnet | P0 | Sprint 1 |
| 5 | Broadcaster | Newsletter | Sonnet | P1 | Sprint 2 |
| 6 | Amplifier | Social Media | Haiku | P1 | Sprint 2 |
| 7 | Merchant | Digital Products | Sonnet | P1 | Sprint 2 |
| 8 | Outreach | Community Building | Sonnet | P1 | Sprint 3 |
| 9 | Optimizer | Conversion Opt. | Sonnet | P2 | Sprint 4 |
| 10 | Trader | Market Analysis | Sonnet | P2 | Sprint 3 |
| 11 | Treasurer | P&L Tracking | Haiku | P1 | Sprint 3 |
| 12 | Strategist | CEO / Allokation | Sonnet | P2 | Sprint 4 |
| 13 | Community | Engagement | Haiku | P2 | Sprint 5 |
| 14 | Localizer | DE↔EN Content | Haiku | P3 | Sprint 5 |

## Crew-Struktur

### Content Crew (Sprint 1-2)
Oracle → Publisher → Broadcaster → Amplifier
*Täglicher Cycle: Scan → Write → Mail → Post*

### Revenue Crew (Sprint 2-3)
Researcher → Merchant → Outreach → Optimizer
*Wöchentlicher Cycle: Research → Build → Distribute → Optimize*

### Ops Crew (Sprint 3-4)
Guardian → Treasurer → Strategist
*Continuous: Monitor → Report → Decide*

## Kritische Regeln

> [!danger] Guardian hat Veto über alle Agenten
> Kann jeden Agent stoppen. Darf nie deaktiviert werden.

> [!warning] Trading: Hardware Stop-Loss Pflicht
> Exchange-seitige Stop-Loss IMMER gesetzt. Nie auf Agent verlassen.

> [!info] Content: Disclaimer in jedem Output
> Siehe [[02-legal#Disclaimer-Template]]

## API-Kostenplanung
- Sonnet Tasks (~2k tokens): ~$0.009/Task
- Haiku Tasks (~1k tokens): ~$0.001/Task
- Tägliche Tasks: ~50 Sonnet + 30 Haiku = ~$0.48/Tag
- Monatlich: **~$15-20** (deutlich unter Budget)

Siehe auch: [[05-sprints]], [[01-vision]], [[03-revenue]]
