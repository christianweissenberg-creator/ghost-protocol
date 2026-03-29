#!/bin/bash
# Ghost Protocol — Initial Setup
# Run: chmod +x scripts/setup.sh && ./scripts/setup.sh

set -e
echo "👻 Ghost Protocol — Setup"
echo "========================="

# 1. Python venv
if [ ! -d ".venv" ]; then
    echo "Creating Python venv..."
    python3 -m venv .venv
fi
source .venv/bin/activate

# 2. Dependencies
echo "Installing dependencies..."
pip install -r requirements.txt --quiet

# 3. Environment
if [ ! -f ".env" ]; then
    echo "Creating .env from template..."
    cp .env.example .env
    echo "⚠️  Bitte API Keys in .env eintragen!"
fi

# 4. Output dirs
mkdir -p outputs data

# 5. Verify
echo ""
echo "✅ Setup complete!"
echo ""
echo "Nächste Schritte:"
echo "1. API Keys in .env eintragen"
echo "2. python -m agents.researcher  (Product Research starten)"
echo "3. python scripts/daily_briefing.py  (Erster Intelligence Report)"
echo "4. python scripts/health_check.py  (System-Check)"
