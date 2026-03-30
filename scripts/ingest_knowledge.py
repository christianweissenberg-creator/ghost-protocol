"""
Ghost Protocol — Knowledge Ingestion Pipeline
================================================
Lädt Dokumente in die Supabase Vector DB für RAG.

Workflow:
1. Dokument lesen (PDF, MD, TXT)
2. In Chunks aufteilen (512-1024 Tokens)
3. Embeddings generieren (Anthropic/OpenAI)
4. In Supabase pgvector speichern mit Tags

Usage:
    python ingest_knowledge.py --file docs/bitcoin_whitepaper.pdf --tags crypto,bitcoin,oracle
    python ingest_knowledge.py --dir knowledge/ --auto-tag
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    import anthropic
    from supabase import create_client, Client
except ImportError:
    print("Missing dependencies. Run: pip install anthropic supabase --break-system-packages")
    sys.exit(1)


# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

CHUNK_SIZE = 800          # Target tokens per chunk
CHUNK_OVERLAP = 100       # Overlap between chunks for context continuity
EMBEDDING_MODEL = "voyage-3"  # or "text-embedding-ada-002"

# Agent-to-Tag mapping: Welche Tags gehören zu welchem Agenten
AGENT_TAGS = {
    "oracle": ["crypto", "bitcoin", "ethereum", "on-chain", "macro", "sentiment", "market"],
    "trader": ["crypto", "trading", "technical-analysis", "signals", "risk-management"],
    "counsel": ["legal", "mica", "bafin", "dsgvo", "tax", "dach", "regulation", "compliance"],
    "publisher": ["marketing", "seo", "content", "social-media", "newsletter", "copywriting"],
    "amplifier": ["growth", "social-media", "community", "viral", "distribution", "algorithms"],
    "scribe": ["writing", "content", "copywriting", "storytelling", "formatting"],
    "strategist": ["strategy", "business", "leadership", "decisions", "frameworks"],
    "donna": ["orchestration", "management", "priorities", "coordination"],
    "operator": ["operations", "workflows", "sla", "efficiency", "quality"],
    "architect": ["tech", "architecture", "infrastructure", "crewai", "python", "supabase"],
    "treasurer": ["finance", "revenue", "costs", "metrics", "unit-economics", "tax"],
    "merchant": ["products", "pricing", "conversion", "gumroad", "digital-products"],
    "researcher": ["research", "analysis", "data", "trends", "competition"],
    "guardian": ["monitoring", "health", "alerts", "security", "devops"],
    "concierge": ["support", "community", "faq", "onboarding", "telegram"],
    "localizer": ["dach", "german", "translation", "culture", "localization"],
}


# ─────────────────────────────────────────────
# TEXT PROCESSING
# ─────────────────────────────────────────────

def read_file(filepath: Path) -> str:
    """Read content from various file types."""
    suffix = filepath.suffix.lower()

    if suffix in (".md", ".txt", ".text"):
        return filepath.read_text(encoding="utf-8")

    elif suffix == ".pdf":
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(str(filepath))
            text = ""
            for page in doc:
                text += page.get_text()
            doc.close()
            return text
        except ImportError:
            print(f"  ⚠️  PyMuPDF not installed. Run: pip install pymupdf --break-system-packages")
            return ""

    elif suffix == ".json":
        data = json.loads(filepath.read_text(encoding="utf-8"))
        return json.dumps(data, indent=2, ensure_ascii=False)

    elif suffix in (".html", ".htm"):
        text = filepath.read_text(encoding="utf-8")
        # Simple HTML tag removal
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    else:
        print(f"  ⚠️  Unsupported file type: {suffix}")
        return ""


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping chunks.

    Uses paragraph boundaries where possible for more natural chunks.
    Falls back to sentence boundaries, then word boundaries.
    """
    if not text.strip():
        return []

    # Split into paragraphs first
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks: list[str] = []
    current_chunk: list[str] = []
    current_length = 0

    for para in paragraphs:
        para_tokens = len(para.split())  # Rough token estimate

        if current_length + para_tokens > chunk_size and current_chunk:
            # Save current chunk
            chunk_text = "\n\n".join(current_chunk)
            chunks.append(chunk_text)

            # Keep overlap: take last paragraph(s) for context
            overlap_text = current_chunk[-1] if current_chunk else ""
            overlap_tokens = len(overlap_text.split())

            if overlap_tokens < overlap:
                current_chunk = [current_chunk[-1]] if current_chunk else []
                current_length = overlap_tokens
            else:
                current_chunk = []
                current_length = 0

        current_chunk.append(para)
        current_length += para_tokens

    # Don't forget the last chunk
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks


def auto_detect_tags(filepath: Path, content: str) -> list[str]:
    """Auto-detect relevant tags based on filename and content keywords."""
    tags: set[str] = set()

    filename = filepath.stem.lower()
    content_lower = content[:2000].lower()  # Check first 2000 chars

    # Keyword-based tag detection
    keyword_map = {
        "bitcoin": ["crypto", "bitcoin"],
        "ethereum": ["crypto", "ethereum"],
        "whitepaper": ["crypto"],
        "mica": ["legal", "mica", "regulation"],
        "bafin": ["legal", "bafin", "regulation"],
        "dsgvo": ["legal", "dsgvo"],
        "gdpr": ["legal", "dsgvo"],
        "dac8": ["legal", "tax", "dach"],
        "steuer": ["tax", "dach"],
        "tax": ["tax"],
        "seo": ["seo", "marketing", "content"],
        "marketing": ["marketing", "content"],
        "trading": ["trading", "crypto"],
        "on-chain": ["on-chain", "crypto"],
        "glassnode": ["on-chain", "crypto"],
        "defi": ["crypto", "defi"],
        "staking": ["crypto", "tax"],
        "youtube": ["social-media", "growth"],
        "tiktok": ["social-media", "growth"],
        "instagram": ["social-media", "growth"],
        "newsletter": ["newsletter", "content"],
        "copywriting": ["copywriting", "content"],
        "hormozi": ["marketing", "business", "strategy"],
        "buffett": ["finance", "strategy"],
        "dalio": ["strategy", "macro"],
    }

    for keyword, associated_tags in keyword_map.items():
        if keyword in filename or keyword in content_lower:
            tags.update(associated_tags)

    # Add source type tag
    if filepath.suffix == ".pdf":
        tags.add("document")
    elif filepath.suffix == ".md":
        tags.add("guide")

    return sorted(tags) if tags else ["general"]


# ─────────────────────────────────────────────
# EMBEDDING
# ─────────────────────────────────────────────

def generate_embeddings_anthropic(texts: list[str]) -> list[list[float]]:
    """Generate embeddings using Anthropic's embedding model.

    Falls back to a simple hash-based embedding for development/testing
    when API is not available.
    """
    # NOTE: As of 2026, Anthropic offers embeddings via Voyage AI partnership
    # For MVP, we use a lightweight approach
    try:
        # Try Voyage AI (Anthropic's embedding partner)
        import voyageai
        client = voyageai.Client(api_key=os.environ.get("VOYAGE_API_KEY", ""))
        result = client.embed(texts, model="voyage-3", input_type="document")
        return result.embeddings
    except (ImportError, Exception):
        pass

    try:
        # Fallback: OpenAI embeddings
        import openai
        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        embeddings = []
        # Batch in groups of 20
        for i in range(0, len(texts), 20):
            batch = texts[i:i+20]
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=batch,
            )
            embeddings.extend([item.embedding for item in response.data])
        return embeddings
    except (ImportError, Exception) as e:
        print(f"  ⚠️  No embedding API available: {e}")
        print("  ℹ️  Set VOYAGE_API_KEY or OPENAI_API_KEY in .env")
        print("  ℹ️  Storing chunks WITHOUT embeddings (text-search only)")
        return []


# ─────────────────────────────────────────────
# SUPABASE UPLOAD
# ─────────────────────────────────────────────

def upload_to_supabase(
    supabase: Client,
    chunks: list[str],
    embeddings: list[list[float]],
    source: str,
    source_type: str,
    tags: list[str],
    metadata: dict[str, Any] | None = None,
) -> int:
    """Upload chunks with embeddings to Supabase knowledge table.

    Returns number of chunks uploaded.
    """
    rows = []
    for i, chunk in enumerate(chunks):
        row: dict[str, Any] = {
            "content": chunk,
            "source": source,
            "source_type": source_type,
            "tags": tags,
            "chunk_index": i,
            "metadata": json.dumps(metadata or {}),
        }
        if embeddings and i < len(embeddings):
            row["embedding"] = embeddings[i]
        rows.append(row)

    # Batch insert (Supabase supports up to 1000 rows per insert)
    batch_size = 500
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        try:
            supabase.table("knowledge").insert(batch).execute()
            total += len(batch)
        except Exception as e:
            print(f"  ❌ Upload error at batch {i//batch_size}: {e}")

    return total


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def ingest_file(
    supabase: Client,
    filepath: Path,
    tags: list[str] | None = None,
    source_type: str = "document",
    auto_tag: bool = True,
) -> dict[str, Any]:
    """Ingest a single file into the knowledge base.

    Returns summary of the ingestion.
    """
    print(f"\n📄 Processing: {filepath.name}")

    # 1. Read
    content = read_file(filepath)
    if not content:
        return {"file": str(filepath), "status": "error", "reason": "empty or unreadable"}

    print(f"   📏 Content: {len(content)} chars, ~{len(content.split())} words")

    # 2. Chunk
    chunks = chunk_text(content)
    print(f"   🔪 Chunks: {len(chunks)}")

    # 3. Auto-tag if no tags provided
    if not tags and auto_tag:
        tags = auto_detect_tags(filepath, content)
    tags = tags or ["general"]
    print(f"   🏷️  Tags: {', '.join(tags)}")

    # 4. Embed
    embeddings = generate_embeddings_anthropic(chunks)
    if embeddings:
        print(f"   🧬 Embeddings: {len(embeddings)} vectors generated")
    else:
        print(f"   ⚠️  No embeddings — text-search only mode")

    # 5. Upload
    uploaded = upload_to_supabase(
        supabase=supabase,
        chunks=chunks,
        embeddings=embeddings,
        source=filepath.name,
        source_type=source_type,
        tags=tags,
        metadata={
            "original_path": str(filepath),
            "file_size": filepath.stat().st_size,
            "word_count": len(content.split()),
        },
    )

    print(f"   ✅ Uploaded: {uploaded} chunks to Supabase")

    return {
        "file": str(filepath),
        "status": "success",
        "chunks": len(chunks),
        "embeddings": len(embeddings),
        "uploaded": uploaded,
        "tags": tags,
    }


def main():
    parser = argparse.ArgumentParser(description="Ghost Protocol Knowledge Ingestion")
    parser.add_argument("--file", type=str, help="Single file to ingest")
    parser.add_argument("--dir", type=str, help="Directory to ingest (all supported files)")
    parser.add_argument("--tags", type=str, help="Comma-separated tags (e.g., crypto,bitcoin,oracle)")
    parser.add_argument("--type", type=str, default="document", help="Source type: document, whitepaper, regulation, guide, framework")
    parser.add_argument("--auto-tag", action="store_true", default=True, help="Auto-detect tags from content")
    args = parser.parse_args()

    if not args.file and not args.dir:
        parser.print_help()
        print("\n❌ Specify --file or --dir")
        sys.exit(1)

    # Init Supabase
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("❌ Set SUPABASE_URL and SUPABASE_KEY in .env")
        sys.exit(1)

    supabase = create_client(url, key)
    print("✅ Supabase connected")

    tags = args.tags.split(",") if args.tags else None
    results: list[dict] = []

    if args.file:
        filepath = Path(args.file)
        if not filepath.exists():
            print(f"❌ File not found: {filepath}")
            sys.exit(1)
        result = ingest_file(supabase, filepath, tags, args.type, args.auto_tag)
        results.append(result)

    elif args.dir:
        dirpath = Path(args.dir)
        if not dirpath.is_dir():
            print(f"❌ Directory not found: {dirpath}")
            sys.exit(1)

        supported = {".md", ".txt", ".pdf", ".json", ".html"}
        files = sorted([f for f in dirpath.rglob("*") if f.suffix.lower() in supported])
        print(f"📂 Found {len(files)} files in {dirpath}")

        for filepath in files:
            result = ingest_file(supabase, filepath, tags, args.type, args.auto_tag)
            results.append(result)

    # Summary
    print("\n" + "=" * 50)
    print("📊 INGESTION SUMMARY")
    print("=" * 50)
    success = sum(1 for r in results if r["status"] == "success")
    total_chunks = sum(r.get("chunks", 0) for r in results)
    print(f"   Files processed: {len(results)}")
    print(f"   Successful: {success}")
    print(f"   Total chunks: {total_chunks}")
    print(f"   Failed: {len(results) - success}")

    all_tags = set()
    for r in results:
        all_tags.update(r.get("tags", []))
    print(f"   Unique tags: {', '.join(sorted(all_tags))}")
    print("=" * 50)


if __name__ == "__main__":
    main()
