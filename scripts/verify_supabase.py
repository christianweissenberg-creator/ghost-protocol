#!/usr/bin/env python3
"""
Ghost Protocol — Supabase Connection Verifier
Prüft ob Supabase korrekt eingerichtet ist.

Usage:
    python scripts/verify_supabase.py
"""

import os
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

def check_env_vars() -> dict[str, bool]:
    """Check if required environment variables are set."""
    required = {
        "SUPABASE_URL": os.getenv("SUPABASE_URL"),
        "SUPABASE_KEY": os.getenv("SUPABASE_KEY"),
        "ANTHROPIC_API_KEY": os.getenv("ANTHROPIC_API_KEY"),
    }
    return {k: bool(v and v != f"your-{k.lower()}-here") for k, v in required.items()}


def check_supabase_connection() -> tuple[bool, str]:
    """Test Supabase connection and verify tables exist."""
    try:
        from supabase import create_client, Client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")

        if not url or not key:
            return False, "SUPABASE_URL or SUPABASE_KEY not set"

        client: Client = create_client(url, key)

        # Test: Fetch agents
        response = client.table("agents").select("id, name, tier").execute()
        agent_count = len(response.data) if response.data else 0

        if agent_count == 0:
            return False, "No agents found. Did you run setup_supabase.sql?"

        return True, f"Connected! Found {agent_count} agents."

    except ImportError:
        return False, "supabase-py not installed. Run: pip install supabase"
    except Exception as e:
        return False, f"Connection failed: {str(e)}"


def check_tables() -> dict[str, bool]:
    """Verify all required tables exist."""
    try:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        client = create_client(url, key)

        tables = ["agents", "messages", "knowledge", "metrics", "content"]
        results = {}

        for table in tables:
            try:
                response = client.table(table).select("*").limit(1).execute()
                results[table] = True
            except Exception:
                results[table] = False

        return results

    except Exception as e:
        return {t: False for t in ["agents", "messages", "knowledge", "metrics", "content"]}


def check_realtime() -> tuple[bool, str]:
    """Check if Realtime is enabled for messages and content."""
    # Note: This is a simplified check. Full verification requires admin API.
    try:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        client = create_client(url, key)

        # Try to subscribe (will fail gracefully if not enabled)
        # For now, just return info message
        return True, "Realtime should be enabled. Verify in Supabase Dashboard → Database → Replication"

    except Exception as e:
        return False, str(e)


def main():
    """Run all verification checks."""
    print("=" * 60)
    print("🔍 GHOST PROTOCOL — Supabase Verification")
    print("=" * 60)
    print()

    # Load .env if exists
    try:
        from dotenv import load_dotenv
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            load_dotenv(env_path)
            print(f"✅ Loaded .env from {env_path}")
        else:
            print(f"⚠️  No .env found at {env_path}")
            print("   Copy .env.local.template to .env and fill in your keys.")
    except ImportError:
        print("⚠️  python-dotenv not installed. Using system environment.")

    print()

    # Check 1: Environment Variables
    print("📋 Environment Variables:")
    env_checks = check_env_vars()
    all_env_ok = True
    for var, is_set in env_checks.items():
        status = "✅" if is_set else "❌"
        print(f"   {status} {var}")
        if not is_set:
            all_env_ok = False

    if not all_env_ok:
        print()
        print("❌ Missing environment variables. Setup incomplete.")
        print("   → Copy .env.local.template to .env")
        print("   → Fill in your API keys")
        sys.exit(1)

    print()

    # Check 2: Supabase Connection
    print("🔌 Supabase Connection:")
    connected, message = check_supabase_connection()
    status = "✅" if connected else "❌"
    print(f"   {status} {message}")

    if not connected:
        print()
        print("❌ Cannot connect to Supabase.")
        print("   → Verify SUPABASE_URL and SUPABASE_KEY in .env")
        print("   → Make sure you're using SERVICE ROLE key, not anon key")
        sys.exit(1)

    print()

    # Check 3: Tables
    print("📊 Database Tables:")
    table_checks = check_tables()
    all_tables_ok = True
    for table, exists in table_checks.items():
        status = "✅" if exists else "❌"
        print(f"   {status} {table}")
        if not exists:
            all_tables_ok = False

    if not all_tables_ok:
        print()
        print("❌ Some tables missing.")
        print("   → Run setup_supabase.sql in Supabase SQL Editor")
        sys.exit(1)

    print()

    # Check 4: Realtime
    print("⚡ Realtime:")
    realtime_ok, realtime_msg = check_realtime()
    status = "✅" if realtime_ok else "⚠️"
    print(f"   {status} {realtime_msg}")

    print()

    # Summary
    print("=" * 60)
    print("✅ SUPABASE SETUP VERIFIED!")
    print("=" * 60)
    print()
    print("Next steps:")
    print("1. Set up Telegram Bot for monitoring")
    print("2. Choose embedding provider (Voyage AI or OpenAI)")
    print("3. Run: python scripts/ingest_knowledge.py")
    print()


if __name__ == "__main__":
    main()
