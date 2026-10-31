-- ====================================================================
-- MIGRAȚIE 004: COȘUL MEU – PRICE QUALITY MONITOR & FRESHNESS SCORE
-- Tabele: quality_anomalies, quality_recollection_queue, daily_quality_reports
-- Coloane extinse: product_offers (freshness & quality scores, anomaly flags)
-- ====================================================================

-- 1. Extindere product_offers cu metrici de prospețime și calitate
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS freshness_score NUMERIC(5,2);
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2);
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS freshness_status VARCHAR(32) DEFAULT 'very_recent';
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS last_collected_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS is_flagged_anomaly BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS anomaly_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_offers_freshness ON product_offers(freshness_status);
CREATE INDEX IF NOT EXISTS idx_offers_flagged ON product_offers(is_flagged_anomaly) WHERE is_flagged_anomaly IS TRUE;

-- 2. Tabel: Anomalii Detectate de Calitate (Audit & Alerting)
CREATE TABLE IF NOT EXISTS quality_anomalies (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    offer_id VARCHAR(64),
    anomaly_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'medium', -- 'high' | 'medium' | 'low'
    current_price NUMERIC(10,2) NOT NULL,
    previous_price NUMERIC(10,2),
    baseline_price NUMERIC(10,2),
    deviation_percentage NUMERIC(6,2),
    details TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_review', -- 'pending_review' | 'resolved_approved' | 'resolved_rejected'
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_anomalies_status ON quality_anomalies(status);
CREATE INDEX IF NOT EXISTS idx_quality_anomalies_retailer ON quality_anomalies(retailer_id);
CREATE INDEX IF NOT EXISTS idx_quality_anomalies_detected ON quality_anomalies(detected_at DESC);

-- 3. Tabel: Coadă de Sarcini pentru Recolectare și Reverificare (Priority Queue)
CREATE TABLE IF NOT EXISTS quality_recollection_queue (
    id VARCHAR(64) PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    priority SMALLINT NOT NULL DEFAULT 3, -- 1=Expired, 2=Anomalies, 3=Uncertain, 4=Popular, 5=PromoExpiry
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued', -- 'queued' | 'in_progress' | 'completed' | 'failed'
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recollection_queue_priority ON quality_recollection_queue(priority ASC, scheduled_at ASC);
CREATE INDEX IF NOT EXISTS idx_recollection_queue_status ON quality_recollection_queue(status);

-- 4. Tabel: Rapoarte Zilnice Automate de Calitate a Datelor
CREATE TABLE IF NOT EXISTS daily_quality_reports (
    id VARCHAR(64) PRIMARY KEY,
    report_date DATE NOT NULL UNIQUE,
    total_tracked_products INTEGER NOT NULL DEFAULT 0,
    total_new_prices INTEGER NOT NULL DEFAULT 0,
    total_updated_prices INTEGER NOT NULL DEFAULT 0,
    total_new_promotions INTEGER NOT NULL DEFAULT 0,
    total_expired_prices INTEGER NOT NULL DEFAULT 0,
    total_unmatched_products INTEGER NOT NULL DEFAULT 0,
    total_anomalies_count INTEGER NOT NULL DEFAULT 0,
    total_collection_errors INTEGER NOT NULL DEFAULT 0,
    overall_avg_quality_score NUMERIC(5,2) NOT NULL DEFAULT 0,
    overall_avg_freshness_score NUMERIC(5,2) NOT NULL DEFAULT 0,
    freshness_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
    retailers_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_quality_reports_date ON daily_quality_reports(report_date DESC);
