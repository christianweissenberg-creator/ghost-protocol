-- ============================================
-- GHOST PROTOCOL — Supabase Schema v2.0
-- ============================================
-- Optimierte Version mit:
-- • Trades Tabelle (für TRADER)
-- • Signals Tabelle (für ORACLE)
-- • Bessere Indexes
-- • Nützliche Views fürs Dashboard
-- • Automatische Updated_at Trigger
--
-- Ausführen: Supabase Dashboard → SQL Editor → Paste & Run
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ══════════════════════════════════════════════════════════════
-- AUTO-UPDATE TRIGGER FUNCTION
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════
-- 1. AGENTS — Agent Registry
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    tier INTEGER NOT NULL DEFAULT 1,
    llm_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    status TEXT NOT NULL DEFAULT 'offline',
    channels TEXT[] DEFAULT '{}',
    last_heartbeat TIMESTAMPTZ,
    total_input_tokens BIGINT DEFAULT 0,
    total_output_tokens BIGINT DEFAULT 0,
    total_cost_usd NUMERIC(10,4) DEFAULT 0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    avg_response_time_ms INTEGER DEFAULT 0,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Seed die 16 Agenten
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
    ('trader', 'TRADER', 'Market Analyst', 3, 'claude-sonnet-4-20250514', ARRAY['#market-intel', '#trading']),
    ('guardian', 'GUARDIAN', 'Data Engineer & Monitor', 3, 'claude-haiku-4-5-20251001', ARRAY['#ops', '#emergency']),
    ('concierge', 'CONCIERGE', 'Community Support', 3, 'claude-haiku-4-5-20251001', ARRAY['#growth']),
    ('localizer', 'LOCALIZER', 'Cultural Intelligence', 3, 'claude-haiku-4-5-20251001', ARRAY['#content'])
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    tier = EXCLUDED.tier,
    llm_model = EXCLUDED.llm_model,
    channels = EXCLUDED.channels;

-- ══════════════════════════════════════════════════════════════
-- 2. MESSAGES — Message Bus
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    from_agent TEXT NOT NULL REFERENCES agents(id),
    from_role TEXT,
    to_channels TEXT[] DEFAULT '{}',
    to_agents TEXT[] DEFAULT '{}',
    message_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    content JSONB NOT NULL DEFAULT '{}',
    requires_legal_review BOOLEAN DEFAULT FALSE,
    legal_reviewed BOOLEAN DEFAULT FALSE,
    legal_approved BOOLEAN,
    confidence NUMERIC(3,2) DEFAULT 0,
    parent_message_id TEXT REFERENCES messages(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_agent);
CREATE INDEX IF NOT EXISTS idx_messages_channels ON messages USING GIN(to_channels);
CREATE INDEX IF NOT EXISTS idx_messages_agents ON messages USING GIN(to_agents);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
CREATE INDEX IF NOT EXISTS idx_messages_priority ON messages(priority);
CREATE INDEX IF NOT EXISTS idx_messages_legal_pending ON messages(requires_legal_review, legal_reviewed)
    WHERE requires_legal_review = TRUE AND legal_reviewed = FALSE;

-- ══════════════════════════════════════════════════════════════
-- 3. SIGNALS — ORACLE Market Signals
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    asset TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    confidence NUMERIC(3,2) NOT NULL,
    confidence_basis TEXT,
    direction TEXT,  -- bullish, bearish, neutral

    -- Data Sources
    data_sources JSONB DEFAULT '[]',

    -- Key Levels
    support_levels NUMERIC[] DEFAULT '{}',
    resistance_levels NUMERIC[] DEFAULT '{}',
    pivot_level NUMERIC,

    -- Risk
    risk_factors TEXT[] DEFAULT '{}',

    -- Action
    action_recommendation TEXT,
    time_horizon TEXT,

    -- Status
    status TEXT DEFAULT 'active',  -- active, expired, triggered, invalidated
    requires_legal_review BOOLEAN DEFAULT TRUE,
    legal_approved BOOLEAN DEFAULT FALSE,

    created_by TEXT REFERENCES agents(id) DEFAULT 'oracle',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER signals_updated_at
    BEFORE UPDATE ON signals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_signals_asset ON signals(asset);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_confidence ON signals(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp DESC);

-- ══════════════════════════════════════════════════════════════
-- 4. TRADES — TRADER Trade Journal
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,

    -- Trade Info
    asset TEXT NOT NULL,
    direction TEXT NOT NULL,  -- long, short
    exchange TEXT,

    -- Entry
    entry_price NUMERIC NOT NULL,
    entry_reason TEXT,
    entry_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    signal_id TEXT REFERENCES signals(id),

    -- Position
    size_usd NUMERIC NOT NULL,
    size_units NUMERIC,
    risk_percentage NUMERIC DEFAULT 2,
    leverage NUMERIC DEFAULT 1,

    -- Risk Management
    stop_loss NUMERIC,
    stop_loss_reason TEXT,
    take_profit_1 NUMERIC,
    take_profit_2 NUMERIC,
    take_profit_3 NUMERIC,
    risk_reward_ratio NUMERIC,

    -- Exit
    exit_price NUMERIC,
    exit_reason TEXT,
    exit_timestamp TIMESTAMPTZ,

    -- P&L
    pnl_usd NUMERIC,
    pnl_percentage NUMERIC,
    r_multiple NUMERIC,
    fees_usd NUMERIC DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'open',  -- open, closed_profit, closed_loss, closed_breakeven

    notes TEXT,
    lessons_learned TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trades_updated_at
    BEFORE UPDATE ON trades
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_entry ON trades(entry_timestamp DESC);

-- ══════════════════════════════════════════════════════════════
-- 5. KNOWLEDGE — RAG Vector Store
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS knowledge (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(1536),
    source TEXT NOT NULL,
    source_type TEXT DEFAULT 'document',
    tags TEXT[] DEFAULT '{}',
    chunk_index INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER knowledge_updated_at
    BEFORE UPDATE ON knowledge
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge(source);

-- RAG Search Function
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

-- ══════════════════════════════════════════════════════════════
-- 6. METRICS — Performance & Cost Tracking
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS metrics (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    agent_id TEXT REFERENCES agents(id),
    metric_type TEXT NOT NULL,
    value NUMERIC NOT NULL,
    unit TEXT DEFAULT '',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_agent ON metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_agent_type_ts ON metrics(agent_id, metric_type, timestamp DESC);

-- ══════════════════════════════════════════════════════════════
-- 7. CONTENT — Content Pipeline Tracker
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS content (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    body TEXT,
    platform TEXT,
    language TEXT DEFAULT 'de',

    -- Pipeline
    created_by TEXT REFERENCES agents(id),
    reviewed_by TEXT REFERENCES agents(id),
    review_notes TEXT,
    published_url TEXT,
    published_at TIMESTAMPTZ,

    -- Performance
    views INTEGER DEFAULT 0,
    engagement NUMERIC DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue_usd NUMERIC DEFAULT 0,
    performance JSONB DEFAULT '{}',

    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER content_updated_at
    BEFORE UPDATE ON content
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_type ON content(content_type);
CREATE INDEX IF NOT EXISTS idx_content_platform ON content(platform);
CREATE INDEX IF NOT EXISTS idx_content_created_by ON content(created_by);

-- ══════════════════════════════════════════════════════════════
-- 8. PRODUCTS — Gumroad Products
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price_usd NUMERIC NOT NULL,
    tier TEXT,  -- lead_magnet, entry, core, premium
    gumroad_id TEXT,
    gumroad_url TEXT,

    -- Stats
    total_sales INTEGER DEFAULT 0,
    total_revenue_usd NUMERIC DEFAULT 0,
    conversion_rate NUMERIC DEFAULT 0,
    refund_rate NUMERIC DEFAULT 0,

    status TEXT DEFAULT 'draft',  -- draft, active, archived
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════════════════════════
-- VIEWS — Dashboard Analytics
-- ══════════════════════════════════════════════════════════════

-- Agent Status Overview
CREATE OR REPLACE VIEW v_agent_status AS
SELECT
    id,
    name,
    role,
    tier,
    status,
    last_heartbeat,
    CASE
        WHEN last_heartbeat > NOW() - INTERVAL '2 minutes' THEN 'healthy'
        WHEN last_heartbeat > NOW() - INTERVAL '5 minutes' THEN 'warning'
        ELSE 'offline'
    END as health,
    tasks_completed,
    tasks_failed,
    ROUND(total_cost_usd::numeric, 2) as total_cost_usd,
    updated_at
FROM agents
ORDER BY tier, name;

-- Daily Costs
CREATE OR REPLACE VIEW v_daily_costs AS
SELECT
    DATE(timestamp) as date,
    agent_id,
    SUM(CASE WHEN metric_type = 'api_cost' THEN value ELSE 0 END) as api_cost,
    SUM(CASE WHEN metric_type = 'input_tokens' THEN value ELSE 0 END) as input_tokens,
    SUM(CASE WHEN metric_type = 'output_tokens' THEN value ELSE 0 END) as output_tokens
FROM metrics
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY DATE(timestamp), agent_id
ORDER BY date DESC, agent_id;

-- Content Pipeline Status
CREATE OR REPLACE VIEW v_content_pipeline AS
SELECT
    status,
    content_type,
    COUNT(*) as count,
    ARRAY_AGG(title ORDER BY created_at DESC) as titles
FROM content
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY status, content_type
ORDER BY
    CASE status
        WHEN 'in_review' THEN 1
        WHEN 'draft' THEN 2
        WHEN 'approved' THEN 3
        WHEN 'published' THEN 4
        ELSE 5
    END;

-- Trading Performance
CREATE OR REPLACE VIEW v_trading_performance AS
SELECT
    DATE_TRUNC('week', entry_timestamp) as week,
    COUNT(*) as total_trades,
    SUM(CASE WHEN status = 'closed_profit' THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN status = 'closed_loss' THEN 1 ELSE 0 END) as losses,
    ROUND(AVG(r_multiple)::numeric, 2) as avg_r,
    SUM(pnl_usd) as total_pnl,
    ROUND((SUM(CASE WHEN status = 'closed_profit' THEN 1 ELSE 0 END)::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100), 1) as win_rate
FROM trades
WHERE status != 'open'
GROUP BY DATE_TRUNC('week', entry_timestamp)
ORDER BY week DESC;

-- ══════════════════════════════════════════════════════════════
-- REALTIME
-- ══════════════════════════════════════════════════════════════
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE content;
ALTER PUBLICATION supabase_realtime ADD TABLE signals;
ALTER PUBLICATION supabase_realtime ADD TABLE trades;

-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Service Role Policies (voller Zugriff für Backend)
CREATE POLICY "Service role full access" ON agents FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON signals FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON trades FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON knowledge FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON metrics FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON content FOR ALL USING (TRUE);
CREATE POLICY "Service role full access" ON products FOR ALL USING (TRUE);

-- ══════════════════════════════════════════════════════════════
-- DONE
-- ══════════════════════════════════════════════════════════════
-- Schema v2.0 bereit!
-- Neue Features:
-- • signals Tabelle für ORACLE
-- • trades Tabelle für TRADER
-- • products Tabelle für MERCHANT
-- • Dashboard Views
-- • Auto-update Trigger
-- • Bessere Indexes
-- ══════════════════════════════════════════════════════════════
