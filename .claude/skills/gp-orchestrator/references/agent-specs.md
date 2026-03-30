# Ghost Protocol — Agenten-Spezifikationen

## Übersicht (14 Agenten, 3 Crews)

### Content Crew (Sprint 1-2)
| Agent | Rolle | LLM | Prio | Schedule |
|-------|-------|-----|------|----------|
| Oracle | Market Intelligence, Trend Detection | Sonnet | P0 | Alle 4h |
| Publisher | SEO-Content-Erstellung | Sonnet | P0 | Täglich 06:00 UTC |
| Broadcaster | Newsletter-Management via Beehiiv | Sonnet | P1 | Di+Fr 07:00 |
| Amplifier | Social Media Distribution | Haiku | P1 | 3-5 Posts/Tag |

### Revenue Crew (Sprint 2-3)
| Agent | Rolle | LLM | Prio | Schedule |
|-------|-------|-----|------|----------|
| Researcher | Produkt-Research, Marktanalyse | Sonnet | P0 | Wöchentlich Mo |
| Merchant | Digital Product Management | Sonnet | P1 | 2-3 Produkte/Mo |
| Outreach | Community Building, Distribution | Sonnet | P1 | Täglich |
| Optimizer | Conversion-Optimierung | Sonnet | P2 | Wöchentlich |

### Ops Crew (Sprint 3-4)
| Agent | Rolle | LLM | Prio | Schedule |
|-------|-------|-----|------|----------|
| Guardian | System-Monitoring, Kill-Switches | Haiku | P0 | Alle 15 Min |
| Treasurer | P&L Tracking, Financial Reporting | Haiku | P1 | Täglich 22:00 UTC |
| Strategist | CEO-Entscheidungen, Ressourcen | Sonnet | P2 | Sonntags 20:00 UTC |
| Trader | Marktanalyse → Bot-Steuerung | Sonnet | P2 | Continuous + 4h Candles |
| Community | Engagement, Onboarding, FAQ | Haiku | P2 | Reaktiv |
| Localizer | DE↔EN Content-Übersetzung | Haiku | P3 | Nach Bedarf |

## API-Kosten (geschätzt)
- Sonnet Task (~2k tokens): ~$0.009
- Haiku Task (~1k tokens): ~$0.001
- Täglicher Mix (50 Sonnet + 30 Haiku): ~$0.48/Tag
- Monatlich: ~$15-20 (unter Budget)

## Kritische Regeln
1. Guardian hat VETO-Recht über alle Agenten
2. Guardian darf nie deaktiviert werden
3. Trading: Exchange-seitiger Stop-Loss IMMER gesetzt
4. Content: Disclaimer in JEDEM Output
5. Tägliches API-Budget: $3.00 max
