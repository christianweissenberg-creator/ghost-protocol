-- ============================================
-- GHOST PROTOCOL — Supabase Schema Setup
-- ============================================
-- Dieses Script erstellt alle Tabellen die Ghost Protocol braucht:
-- 1. agents       — Agent Registry (alle 17 Agenten)
-- 2. messages     — Message Bus (Agent-to-Agent Communication)
-- 3. knowledge    — RAG Knowledge Base (Vector Embeddings)
-- 4. metrics      — Performance & Cost Tracking
-- 5. content      — Content Pipeline Status
--
-- Ausführen: Supabase Dashboard → SQL Editor → Paste & Run
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector für RAG
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- Trigram für Fuzzy Search

-- ──────────────────────────────────────────
-- 1. AGENTS — Agent Registry
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,                     -- z.B. "oracle", "donna"
    name TEXT NOT NULL,                      -- Display Name z.B. "ORACLE"
    role TEXT NOT NULL,                      -- z.B. "Chief Intelligence Officer"
    tier INTEGER NOT NULL DEFAULT 1,         -- 0=Brain, 1=C-Suite, 2=Director, 3=Operator
    llm_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    status TEXT NOT NULL DEFAULT 'offline',  -- online, offline, error, maintenance
    channels TEXT[] DEFAULT '{}',            -- Channels die der Agent abonniert hat
    last_heartbeat TIMESTAMPTZ,
    total_input_tokens BIGINT DEFAULT 0,
    total_output_tokens BIGINT DEFAULT 0,
    total_cost_usd NUMERIC(10,4) DEFAULT 0,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed die 17 Agenten
INSERT INTO agents (id, name, role, tier, llm_model, channels) VALUES
    ('strategist', 'STRATEGIST', 'Chief Executive Officer', 0, 'claude-sonnet-4-20250514', ARRAY['#boardroom', '#ops', '#emergency']),
    ('donna', 'DONNA', 'Chief of Staff', 0, 'claude-sonnet-4-20250514', ARRAY['#boardroom', '#ops', '#market-intel', '#content', '#legal-review', '#revenue', '#growth', '#emergency']),
    ('operator', 'OPERATOR', 'Chief Operating Officer', 1, 'claude-sonnet-4-20250514', ARRAY['#boardroom', '#ops', '#emergency']),
    ('oracle', 'ORACLE', 'Chief Intelligence Officer', 1, 'claude-sonnet-4-20250514', ARRAY['#boardroom', '#market-intel', '#ops']),
    ('architect', 'ARCHITECT', 'Chief Technology Officer', 1, 'claude-sonnet-4-20250514', ARRAY['#boardroom', '#ops', '#emergency']),
    ('treasurer', 'TREASURER', 'Chief Financial Officer', 1, 'claude-haiku-4-5-20251001', ARRAY['#boardroom', '#revenue', '#ops']),
    ('publisher', 'PUBLISHER', 'Chief Marketing Officer', 1, 'claude-sonnet-4-20250514', ARRAY['#boardroom', '#content', '#growth']),
    ('counsel', 'COUNSEL', 'Chief Legal Officer', 1, 'claude-sonnet-4-20250514', ARRAY['#boardroom', '#legal-review', '#content']),
    ('amplifier', 'AMPLIFIER', 'Head of Growth', 2, 'claude-sonnet-4-20250514', ARRAY['#growth', '#content']),
    ('merchant', 'MERCHANT', 'Head of Product', 2, 'claude-sonnet-4-20250514', ARRAY['#revenue', '#content']),
    ('researcher', 'RESEARCHER', 'Head of Research', 2, 'claude-sonnet-4-20250514', ARRAY['#market-intel', '#content']),
    ('scribe', 'SCRIBE', 'Content Producer', 3, 'claude-sonnet-4-20250514', ARRAY['#content']),
    ('trader', 'TRADER', 'Market Analyst', 3, 'claude-sonnet-4-20250514', ARRAY['#market-intel']),
    ('guardian', 'GUARDIAN', 'Data Engineer & Monitor', 3, 'claude-haiku-4-5-20251001', ARRAY['#ops', '#emergency']),
    ('concierge', 'CONCIERGE', 'Community Support', 3, 'claude-haiku-4-5-20251001', ARRAY['#growth']),
    ('localizer', 'LOCALIZER', 'Cultural Intelligence', 3, 'claude-haiku-4-5-20251001', ARRAY['#content'])
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────
-- 2. MESSAGES — Message Bus
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    from_agent TEXT NOT NULL REFERENCES agents(id),
    from_role TEXT,
    to_channels TEXT[] DEFAULT '{}',
    to_agents TEXT[] DEFAULT '{}',
    message_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    content JSONB NOT NULL DEFAULT '{}',
    requires_legal_review BOOLEAN DEFAULT FALSE,
    confidence NUMERIC(3,2) DEFAULT 0,
    parent_message_id TEXT REFERENCES messages(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes für schnelle Queries
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_agent);
CREATE INDEX IF NOT EXISTS idx_messages_channels ON messages USING GIN(to_channels);
CREATE INDEX IF NOT EXISTS idx_messages_agents ON messages USING GIN(to_agents);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
CREATE INDEX IF NOT EXISTS idx_messages_priority ON messages(priority);
CREATE INDEX IF NOT EXISTS idx_messages_legal ON messages(requires_legal_review) WHERE requires_legal_review = TRUE;

-- Enable Realtime für Live-Dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ──────────────────────────────────────────
-- 3. KNOWLEDGE — RAG Vector Store
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,                   -- Der Textchunk
    embedding vector(1536),                  -- OpenAI ada-002 oder Anthropic Embeddings
    source TEXT NOT NULL,                    -- z.B. "bitcoin_whitepaper.pdf"
    source_type TEXT DEFAULT 'document',     -- document, whitepaper, regulation, guide, framework
    tags TEXT[] DEFAULT '{}',                -- z.B. ['crypto', 'on-chain', 'oracle']
    chunk_index INTEGER DEFAULT 0,           -- Position im Originaldokument
    metadata JSONB DEFAULT '{}',             -- Zusätzliche Infos (Autor, Datum, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector similarity search index (IVFFlat für Performance)
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge(source);

-- ──────────────────────────────────────────
-- RAG Search Function
-- ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_knowledge(
    query_text TEXT,
    match_count INT DEFAULT 5,
    filter_tags TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    source TEXT,
    source_type TEXT,
    tags TEXT[],
    similarity FLOAT,
    metadata JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
    query_embedding vector(1536);
BEGIN
    -- Generate embedding for query using Supabase Edge Function
    -- NOTE: In production, embedding is generated client-side and passed as parameter
    -- This is a simplified version that requires the embedding to be pre-computed

    RETURN QUERY
    SELECT
        k.id,
        k.content,
        k.source,
        k.source_type,
        k.tags,
        1 - (k.embedding <=> query_embedding) AS similarity,
        k.metadata
    FROM knowledge k
    WHERE
        CASE
            WHEN array_length(filter_tags, 1) > 0
            THEN k.tags && filter_tags  -- Array overlap: hat mindestens einen gemeinsamen Tag
            ELSE TRUE
        END
    ORDER BY k.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Verbesserte Version mit Text-Embedding via Edge Function
CREATE OR REPLACE FUNCTION search_knowledge(
    query_embedding vector(1536),
    match_count INT DEFAULT 5,
    filter_tags TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    source TEXT,
    source_type TEXT,
    tags TEXT[],
    similarity FLOAT,
    metadata JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id,
        k.content,
        k.source,
        k.source_type,
        k.tags,
        1 - (k.embedding <=> query_embedding) AS similarity,
        k.metadata
    FROM knowledge k
    WHERE
        CASE
            WHEN array_length(filter_tags, 1) > 0
            THEN k.tags && filter_tags
            ELSE TRUE
        END
    ORDER BY k.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ──────────────────────────────────────────
-- 4. METRICS — Performance Tracking
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    agent_id TEXT REFERENCES agents(id),
    metric_type TEXT NOT NULL,               -- 'api_call', 'content_published', 'revenue', 'error', 'subscriber'
    value NUMERIC NOT NULL,
    unit TEXT DEFAULT '',                    -- 'usd', 'tokens', 'count', 'ms'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_agent ON metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);

-- ──────────────────────────────────────────
-- 5. CONTENT — Content Pipeline Tracker
-- ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content_type TEXT NOT NULL,              -- 'daily_report', 'weekly_report', 'deep_dive', 'social_post', 'newsletter', 'product'
    status TEXT NOT NULL DEFAULT 'draft',    -- draft, in_review, approved, published, rejected
    body TEXT,                               -- Der Content selbst
    platform TEXT,                           -- 'blog', 'newsletter', 'twitter', 'youtube', 'tiktok', 'instagram', 'linkedin', 'telegram', 'reddit', 'facebook'
    created_by TEXT REFERENCES agents(id),
    reviewed_by TEXT REFERENCES agents(id),  -- Normalerweise COUNSEL
    review_notes TEXT,
    published_at TIMESTAMPTZ,
    performance JSONB DEFAULT '{}',          -- Views, Engagement, Conversions etc.
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_type ON content(content_type);
CREATE INDEX IF NOT EXISTS idx_content_platform ON content(platform);

-- Enable Realtime für Content-Pipeline Dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE content;

-- ──────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS)
-- ──────────────────────────────────────────
-- Für MVP: Service Role Key hat vollen Zugriff
-- Bei Skalierung: Feinere Policies pro Agent

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;

-- Service Role Policy (voller Zugriff für Backend)
CREATE POLICY "Service role full access" ON agents FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON knowledge FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON metrics FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON content FOR ALL USING (TRUE);

-- ──────────────────────────────────────────
-- DONE
-- ──────────────────────────────────────────
-- Schema bereit. Nächster Schritt:
-- 1. Supabase Projekt erstellen (supabase.com)
-- 2. Dieses SQL im Dashboard ausführen
-- 3. API Keys in .env eintragen
-- 4. Knowledge Ingestion Pipeline starten
