#!/bin/bash
# Ghost Protocol — Setup Script
# Initialisiert die Entwicklungsumgebung.
set -e

echo "👻 Ghost Protocol — Setup"
echo "========================="

# Python venv erstellen
if [ ! -d "venv" ]; then
    echo "📦 Erstelle Python Virtual Environment..."
    python3 -m venv venv
    echo "✅ venv erstellt"
else
    echo "✅ venv existiert bereits"
fi

# Aktivieren
source venv/bin/activate

# Dependencies installieren
echo "📦 Installiere Dependencies..."
pip install -r requirements.txt --quiet

# .env prüfen
if [ ! -f ".env" ]; then
    echo "📋 Erstelle .env aus .env.example..."
    cp .env.example .env
    echo "⚠️  WICHTIG: Trage deine API Keys in .env ein!"
else
    echo "✅ .env existiert bereits"
fi

# Output-Verzeichnisse
mkdir -p outputs data

echo ""
echo "✅ Setup abgeschlossen!"
echo ""
echo "Nächste Schritte:"
echo "  1. API Keys in .env eintragen"
echo "  2. python -m agents.researcher  (Product Research starten)"
echo "  3. python scripts/daily_briefing.py  (Erstes Briefing)"
echo "  4. python scripts/health_check.py  (System-Check)"
