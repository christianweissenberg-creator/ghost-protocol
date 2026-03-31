#!/bin/bash
# Ghost Protocol — VPS Cron Setup
# Richtet dauerhafte Cron-Jobs auf dem Hetzner VPS ein
#
# Usage: ssh root@46.225.180.35 'bash -s' < scripts/setup-vps-crons.sh

SITE_URL="https://ghostcorp.duckdns.org"
CRON_SECRET="ghost-cron-2026"
LOG_DIR="/var/log/ghost-protocol"

mkdir -p "$LOG_DIR"

# Bestehende Ghost-Protocol-Crons entfernen
crontab -l 2>/dev/null | grep -v "ghost-protocol" | crontab -

# Neue Crons hinzufuegen
(crontab -l 2>/dev/null; cat <<CRON
# === Ghost Protocol Automated Loops ===

# Morning Briefing (Mo-Fr 08:03 CET) — ORACLE + DONNA
3 8 * * 1-5 curl -s "${SITE_URL}/api/cron/briefing?type=morning&secret=${CRON_SECRET}" >> ${LOG_DIR}/briefing.log 2>&1 # ghost-protocol

# Evening Summary (Mo-Fr 18:03 CET) — TREASURER + STRATEGIST
3 18 * * 1-5 curl -s "${SITE_URL}/api/cron/briefing?type=evening&secret=${CRON_SECRET}" >> ${LOG_DIR}/briefing.log 2>&1 # ghost-protocol

# Content Auto-Produce (Mo-Fr 09:07 CET) — Taegliches Content-Piece
7 9 * * 1-5 curl -s "${SITE_URL}/api/content/auto-produce?secret=${CRON_SECRET}" >> ${LOG_DIR}/content.log 2>&1 # ghost-protocol

CRON
) | crontab -

echo "=== Ghost Protocol Crons eingerichtet ==="
crontab -l | grep "ghost-protocol"
echo ""
echo "Logs: ${LOG_DIR}/briefing.log + ${LOG_DIR}/content.log"
