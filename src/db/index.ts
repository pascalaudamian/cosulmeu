import pg from 'pg';
import {
  Product,
  Store,
  ProductOffer,
  PriceObservation,
  DataSource,
  SourceSyncRun,
  ProductMatchCandidate
} from '../types.ts';
import {
  CatalogSource,
  CatalogDocument,
  CatalogImportRun,
  CatalogExtractedOffer,
  CatalogImportError
} from '../indexing/catalog/catalogTypes.ts';
import { INITIAL_CATALOG_SOURCES } from '../indexing/catalog/CatalogSourceDiscovery.ts';
import {
  PRODUCTS,
  STORES,
  PRODUCT_OFFERS,
  PRICE_OBSERVATIONS,
  DATA_SOURCES,
  INITIAL_SYNC_RUNS,
  INITIAL_MATCH_CANDIDATES
} from '../data/mockData.ts';

const { Pool } = pg;

export interface DbConfig {
  configured: boolean;
  type: 'cloudsql' | 'supabase' | 'standard' | 'none';
  host?: string;
  database?: string;
  user?: string;
  ssl?: boolean | object;
}

declare global {
  var _postgresPool: pg.Pool | undefined;
}

/**
 * Returns whether PostgreSQL configuration is present in environment variables.
 */
export function getDbConfig(): DbConfig {
  // PostgreSQL is server-only; keep the browser bundle in demo-memory mode.
  if (typeof window !== 'undefined') {
    return { configured: false, type: 'none' };
  }

  // Option 1: Cloud SQL / Google Cloud runtime variables
  if (process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
    return {
      configured: true,
      type: 'cloudsql',
      host: process.env.SQL_HOST,
      database: process.env.SQL_DB_NAME,
      user: process.env.SQL_USER,
      ssl: false
    };
  }

  // Option 2: Supabase or Direct connection string
  if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
    const rawUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
    const isLocal = rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1') || process.env.PGSSLMODE === 'disable';
    return {
      configured: true,
      type: rawUrl.includes('supabase') ? 'supabase' : 'standard',
      host: isLocal ? 'localhost' : 'remote-url',
      ssl: isLocal ? false : { rejectUnauthorized: false }
    };
  }

  // Option 3: Standard PG* variables
  if (process.env.PGHOST && process.env.PGUSER && process.env.PGDATABASE) {
    return {
      configured: true,
      type: 'standard',
      host: process.env.PGHOST,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false
    };
  }

  return {
    configured: false,
    type: 'none'
  };
}

export function isPostgresConfigured(): boolean {
  return getDbConfig().configured;
}

/**
 * Creates or reuses a singleton pg.Pool.
 * Prohibits connection reconnect loops and startup blocking.
 */
export function getPool(): pg.Pool | null {
  const config = getDbConfig();
  if (!config.configured) {
    return null;
  }

  if (!global._postgresPool) {
    if (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL) {
      const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
      global._postgresPool = new Pool({
        connectionString,
        ssl: config.ssl,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST || process.env.PGHOST,
        user: process.env.SQL_USER || process.env.PGUSER,
        password: process.env.SQL_PASSWORD || process.env.PGPASSWORD,
        database: process.env.SQL_DB_NAME || process.env.PGDATABASE,
        port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
        ssl: config.ssl,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
      });
    }

    global._postgresPool.on('error', (err: any) => {
      console.error('Eroare client inactiv în pool-ul PostgreSQL:', err.message);
    });
  }

  return global._postgresPool;
}

/**
 * Closes the pool (used primarily in tests).
 */
export async function closePool(): Promise<void> {
  if (global._postgresPool) {
    await global._postgresPool.end();
    global._postgresPool = undefined;
  }
}

/**
 * Checks connection health without throwing unhandled exceptions.
 */
export async function checkDbHealth(): Promise<{
  connected: boolean;
  persistenceMode: 'postgresql' | 'demo_memory';
  message: string;
  type: string;
}> {
  const config = getDbConfig();
  if (!config.configured) {
    return {
      connected: false,
      persistenceMode: 'demo_memory',
      message: 'PostgreSQL nu este configurat în variabilele de mediu. Se utilizează modul demonstrativ.',
      type: 'none'
    };
  }

  const pool = getPool();
  if (!pool) {
    return {
      connected: false,
      persistenceMode: 'demo_memory',
      message: 'Nu s-a putut inițializa pool-ul de conexiuni.',
      type: config.type
    };
  }

  try {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT NOW() as current_time, current_database() as db_name');
      return {
        connected: true,
        persistenceMode: 'postgresql',
        message: `Conectat cu succes la PostgreSQL (${res.rows[0]?.db_name || 'default'})`,
        type: config.type
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return {
      connected: false,
      persistenceMode: 'demo_memory',
      message: `Eroare conexiune PostgreSQL: ${err.message || 'Host indisponibil'}. Sistemul continuă în mod demonstrativ izolat.`,
      type: config.type
    };
  }
}

// ============================================================================
// DATA ACCESS LAYER (DAL) / REPOSITORIES CU GARANȚII DE IMUABILITATE
// ============================================================================

export class DatabaseService {
  /**
   * Initializes PostgreSQL tables if they don't exist and seeds default catalog if empty.
   */
  static async initializeSchemaAndSeed(): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;

    try {
      const client = await pool.connect();
      try {
        // Run DDL statements
        await client.query(`
          CREATE TABLE IF NOT EXISTS stores (
              id VARCHAR(64) PRIMARY KEY,
              name VARCHAR(128) NOT NULL,
              slug VARCHAR(64) NOT NULL UNIQUE,
              chain VARCHAR(128) NOT NULL,
              brand_color VARCHAR(32) NOT NULL,
              accent_color VARCHAR(32) NOT NULL,
              logo_url TEXT,
              store_type VARCHAR(32) NOT NULL DEFAULT 'supermarket',
              rating NUMERIC(3,2) NOT NULL DEFAULT 4.0,
              locations_count INTEGER NOT NULL DEFAULT 1,
              sample_address TEXT NOT NULL,
              is_partner BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS products (
              id VARCHAR(64) PRIMARY KEY,
              name VARCHAR(255) NOT NULL,
              brand VARCHAR(128) NOT NULL,
              category VARCHAR(64) NOT NULL,
              default_unit VARCHAR(16) NOT NULL,
              package_weight_or_volume NUMERIC(10,3) NOT NULL,
              package_unit VARCHAR(16) NOT NULL,
              normalized_unit VARCHAR(16) NOT NULL,
              barcode VARCHAR(64),
              image_url TEXT,
              is_bio BOOLEAN NOT NULL DEFAULT FALSE,
              is_romanian_product BOOLEAN NOT NULL DEFAULT FALSE,
              base_reference_price NUMERIC(10,2) NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS data_sources (
              id VARCHAR(64) PRIMARY KEY,
              name VARCHAR(128) NOT NULL,
              type VARCHAR(32) NOT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'configured_manual',
              store_id VARCHAR(64),
              format VARCHAR(16) DEFAULT 'csv',
              last_sync_at TIMESTAMPTZ,
              imported_offers_count INTEGER NOT NULL DEFAULT 0,
              error_count INTEGER NOT NULL DEFAULT 0,
              requires_auth BOOLEAN NOT NULL DEFAULT FALSE,
              auth_documentation TEXT,
              endpoint_url TEXT,
              description TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS product_offers (
              id VARCHAR(64) PRIMARY KEY,
              product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
              store_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
              source_id VARCHAR(64),
              price NUMERIC(10,2) NOT NULL CHECK (price > 0),
              original_price NUMERIC(10,2),
              unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),
              unit_price_measure VARCHAR(32) NOT NULL,
              is_promo BOOLEAN NOT NULL DEFAULT FALSE,
              promo_details TEXT,
              loyalty_card_required BOOLEAN NOT NULL DEFAULT FALSE,
              loyalty_card_name VARCHAR(64),
              valid_until DATE,
              observation_date DATE NOT NULL,
              source VARCHAR(32) NOT NULL DEFAULT 'verified',
              confidence_level VARCHAR(16) NOT NULL DEFAULT 'high',
              verification_status VARCHAR(32) NOT NULL DEFAULT 'verified',
              last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              is_sponsored BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              CONSTRAINT uq_product_store UNIQUE (product_id, store_id)
          );

          CREATE TABLE IF NOT EXISTS price_observations (
              id VARCHAR(64) PRIMARY KEY,
              product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
              store_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
              source_id VARCHAR(64),
              price NUMERIC(10,2) NOT NULL CHECK (price > 0),
              date DATE NOT NULL,
              receipt_id VARCHAR(64),
              loyalty_card_used BOOLEAN NOT NULL DEFAULT FALSE,
              source VARCHAR(32) NOT NULL DEFAULT 'official_feed',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              CONSTRAINT uq_daily_price_obs UNIQUE (product_id, store_id, date, price)
          );

          CREATE TABLE IF NOT EXISTS product_match_candidates (
              id VARCHAR(64) PRIMARY KEY,
              source_raw_name VARCHAR(255) NOT NULL,
              source_barcode VARCHAR(64),
              source_brand VARCHAR(128),
              source_package_weight_or_volume NUMERIC(10,3),
              source_package_unit VARCHAR(16),
              matched_product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
              matched_product_name VARCHAR(255) NOT NULL,
              confidence_score NUMERIC(4,3) NOT NULL,
              match_method VARCHAR(32) NOT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'pending_confirmation',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS source_sync_runs (
              id VARCHAR(64) PRIMARY KEY,
              source_id VARCHAR(64) NOT NULL,
              source_name VARCHAR(128) NOT NULL,
              started_at TIMESTAMPTZ NOT NULL,
              completed_at TIMESTAMPTZ NOT NULL,
              status VARCHAR(16) NOT NULL,
              records_processed INTEGER NOT NULL DEFAULT 0,
              records_imported INTEGER NOT NULL DEFAULT 0,
              duplicates_found INTEGER NOT NULL DEFAULT 0,
              invalid_records INTEGER NOT NULL DEFAULT 0,
              errors JSONB NOT NULL DEFAULT '[]'::jsonb,
              summary TEXT NOT NULL,
              persistence_mode VARCHAR(32) NOT NULL DEFAULT 'postgresql',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS freshness_score NUMERIC(5,2);
          ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2);
          ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS freshness_status VARCHAR(32) DEFAULT 'very_recent';
          ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS last_collected_at TIMESTAMPTZ DEFAULT NOW();
          ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
          ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS is_flagged_anomaly BOOLEAN NOT NULL DEFAULT FALSE;
          ALTER TABLE product_offers ADD COLUMN IF NOT EXISTS anomaly_reason TEXT;

          CREATE TABLE IF NOT EXISTS quality_anomalies (
              id VARCHAR(64) PRIMARY KEY,
              product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
              product_name VARCHAR(255) NOT NULL,
              retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
              offer_id VARCHAR(64),
              anomaly_type VARCHAR(64) NOT NULL,
              severity VARCHAR(16) NOT NULL DEFAULT 'medium',
              current_price NUMERIC(10,2) NOT NULL,
              previous_price NUMERIC(10,2),
              baseline_price NUMERIC(10,2),
              deviation_percentage NUMERIC(6,2),
              details TEXT NOT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
              detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              reviewed_at TIMESTAMPTZ,
              reviewed_by VARCHAR(64),
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE TABLE IF NOT EXISTS quality_recollection_queue (
              id VARCHAR(64) PRIMARY KEY,
              product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
              product_name VARCHAR(255) NOT NULL,
              retailer_id VARCHAR(64) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
              priority SMALLINT NOT NULL DEFAULT 3,
              reason TEXT NOT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'queued',
              scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              attempts INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

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
        `);

        // Check if products exist; seed if empty
        const countRes = await client.query('SELECT COUNT(*) FROM products');
        if (parseInt(countRes.rows[0].count, 10) === 0) {
          // Seed stores
          for (const s of STORES) {
            await client.query(
              `INSERT INTO stores (id, name, slug, chain, brand_color, accent_color, logo_url, store_type, rating, locations_count, sample_address, is_partner)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (id) DO NOTHING`,
              [s.id, s.name, s.slug, s.chain, s.brandColor, s.accentColor, s.logoUrl || null, s.type, s.rating, s.locationsCount, s.sampleAddress, s.isPartner || false]
            );
          }

          // Seed products
          for (const p of PRODUCTS) {
            await client.query(
              `INSERT INTO products (id, name, brand, category, default_unit, package_weight_or_volume, package_unit, normalized_unit, barcode, image_url, is_bio, is_romanian_product, base_reference_price)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
               ON CONFLICT (id) DO NOTHING`,
              [p.id, p.name, p.brand, p.category, p.defaultUnit, p.packageWeightOrVolume, p.packageUnit, p.normalizedUnit, p.barcode || null, p.imageUrl || null, p.isBio || false, p.isRomanianProduct || false, p.baseReferencePrice]
            );
          }

          // Seed initial offers
          for (const o of PRODUCT_OFFERS) {
            await client.query(
              `INSERT INTO product_offers (id, product_id, store_id, price, original_price, unit_price, unit_price_measure, is_promo, promo_details, loyalty_card_required, loyalty_card_name, valid_until, observation_date, source, confidence_level, verification_status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
               ON CONFLICT (product_id, store_id) DO NOTHING`,
              [o.id, o.productId, o.storeId, o.price, o.originalPrice || null, o.unitPrice, o.unitPriceMeasure, o.isPromo, o.promoDetails || null, o.loyaltyCardRequired || false, o.loyaltyCardName || null, o.validUntil || null, o.observationDate, o.source, o.confidenceLevel, o.verificationStatus]
            );
          }

          // Seed initial price observations (Append-only)
          for (const obs of PRICE_OBSERVATIONS) {
            await client.query(
              `INSERT INTO price_observations (id, product_id, store_id, price, date, receipt_id, loyalty_card_used, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (product_id, store_id, date, price) DO NOTHING`,
              [obs.id, obs.productId, obs.storeId, obs.price, obs.date, obs.receiptId || null, obs.loyaltyCardUsed || false, obs.source]
            );
          }

          // Seed data sources
          for (const src of DATA_SOURCES) {
            await client.query(
              `INSERT INTO data_sources (id, name, type, status, store_id, format, requires_auth, auth_documentation, endpoint_url, description)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (id) DO NOTHING`,
              [src.id, src.name, src.type, src.status, src.storeId || null, src.format || 'csv', src.requiresAuth, src.authDocumentation || null, src.endpointUrl || null, src.description]
            );
          }

          // Seed catalog sources
          for (const csrc of INITIAL_CATALOG_SOURCES) {
            await client.query(
              `INSERT INTO catalog_sources (id, retailer_id, name, catalog_url, format, status, update_frequency_days, auth_required, legal_status_notice)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (id) DO NOTHING`,
              [csrc.id, csrc.retailerId, csrc.name, csrc.catalogUrl, csrc.format, csrc.status, csrc.updateFrequencyDays, csrc.authRequired, csrc.legalStatusNotice]
            );
          }
        }

        return true;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn('Eroare inițializare schema PostgreSQL:', err.message);
      return false;
    }
  }

  // --- PRODUCTS ---
  static async getProducts(): Promise<Product[]> {
    const pool = getPool();
    if (!pool) return PRODUCTS;

    try {
      const res = await pool.query('SELECT * FROM products ORDER BY name ASC');
      if (res.rows.length === 0) return PRODUCTS;
      return res.rows.map(r => ({
        id: r.id,
        name: r.name,
        brand: r.brand,
        category: r.category,
        defaultUnit: r.default_unit,
        packageWeightOrVolume: parseFloat(r.package_weight_or_volume),
        packageUnit: r.package_unit,
        normalizedUnit: r.normalized_unit,
        barcode: r.barcode || undefined,
        imageUrl: r.image_url || undefined,
        isBio: r.is_bio,
        isRomanianProduct: r.is_romanian_product,
        baseReferencePrice: parseFloat(r.base_reference_price)
      }));
    } catch {
      return PRODUCTS;
    }
  }

  // --- STORES ---
  static async getStores(): Promise<Store[]> {
    const pool = getPool();
    if (!pool) return STORES;

    try {
      const res = await pool.query('SELECT * FROM stores ORDER BY rating DESC');
      if (res.rows.length === 0) return STORES;
      return res.rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        chain: r.chain,
        brandColor: r.brand_color,
        accentColor: r.accent_color,
        logoUrl: r.logo_url || undefined,
        type: r.store_type,
        rating: parseFloat(r.rating),
        locationsCount: r.locations_count,
        sampleAddress: r.sample_address,
        isPartner: r.is_partner
      }));
    } catch {
      return STORES;
    }
  }

  // --- PRODUCT OFFERS (CURRENT STATE) ---
  static async getOffers(): Promise<ProductOffer[]> {
    const pool = getPool();
    if (!pool) return PRODUCT_OFFERS;

    try {
      const res = await pool.query('SELECT * FROM product_offers');
      if (res.rows.length === 0) return PRODUCT_OFFERS;
      return res.rows.map(r => ({
        id: r.id,
        productId: r.product_id,
        storeId: r.store_id,
        sourceId: r.source_id || undefined,
        price: parseFloat(r.price),
        originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
        unitPrice: parseFloat(r.unit_price),
        unitPriceMeasure: r.unit_price_measure,
        isPromo: r.is_promo,
        promoDetails: r.promo_details || undefined,
        loyaltyCardRequired: r.loyalty_card_required,
        loyaltyCardName: r.loyalty_card_name || undefined,
        validUntil: r.valid_until ? r.valid_until.toISOString?.().split('T')[0] || String(r.valid_until).slice(0, 10) : undefined,
        observationDate: r.observation_date ? r.observation_date.toISOString?.().split('T')[0] || String(r.observation_date).slice(0, 10) : new Date().toISOString().split('T')[0],
        source: r.source,
        confidenceLevel: r.confidence_level,
        verificationStatus: r.verification_status,
        lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
        isSponsored: r.is_sponsored
      }));
    } catch {
      return PRODUCT_OFFERS;
    }
  }

  /**
   * Upserts current product offers into PostgreSQL.
   * Modifies current offer state without deleting previous historical observations.
   */
  static async upsertOffers(offers: ProductOffer[]): Promise<{ added: number; updated: number; persisted: boolean }> {
    const pool = getPool();
    if (!pool) {
      return { added: 0, updated: 0, persisted: false };
    }

    let added = 0;
    let updated = 0;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const off of offers) {
        const query = `
          INSERT INTO product_offers (
            id, product_id, store_id, source_id, price, original_price,
            unit_price, unit_price_measure, is_promo, promo_details,
            loyalty_card_required, loyalty_card_name, valid_until,
            observation_date, source, confidence_level, verification_status,
            last_checked, is_sponsored, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18, NOW())
          ON CONFLICT (product_id, store_id) DO UPDATE SET
            price = EXCLUDED.price,
            original_price = EXCLUDED.original_price,
            unit_price = EXCLUDED.unit_price,
            unit_price_measure = EXCLUDED.unit_price_measure,
            is_promo = EXCLUDED.is_promo,
            promo_details = EXCLUDED.promo_details,
            loyalty_card_required = EXCLUDED.loyalty_card_required,
            loyalty_card_name = EXCLUDED.loyalty_card_name,
            valid_until = EXCLUDED.valid_until,
            observation_date = EXCLUDED.observation_date,
            source = EXCLUDED.source,
            confidence_level = EXCLUDED.confidence_level,
            verification_status = EXCLUDED.verification_status,
            last_checked = NOW(),
            updated_at = NOW()
          RETURNING (xmax = 0) AS is_inserted;
        `;

        const res = await client.query(query, [
          off.id,
          off.productId,
          off.storeId,
          off.sourceId || null,
          off.price,
          off.originalPrice || null,
          off.unitPrice,
          off.unitPriceMeasure,
          off.isPromo,
          off.promoDetails || null,
          off.loyaltyCardRequired || false,
          off.loyaltyCardName || null,
          off.validUntil || null,
          off.observationDate,
          off.source,
          off.confidenceLevel,
          off.verificationStatus,
          off.isSponsored || false
        ]);

        if (res.rows[0]?.is_inserted) {
          added++;
        } else {
          updated++;
        }
      }

      await client.query('COMMIT');
      return { added, updated, persisted: true };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Eroare tranzacție upsert oferte în PostgreSQL:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  // --- PRICE OBSERVATIONS (APPEND-ONLY AUDIT TIMELINE) ---
  /**
   * Appends new price observations.
   * Guarantees that historical entries are strictly preserved and never mutated or deleted.
   */
  static async appendPriceObservations(observations: PriceObservation[]): Promise<{ inserted: number; persisted: boolean }> {
    const pool = getPool();
    if (!pool) {
      return { inserted: 0, persisted: false };
    }

    let inserted = 0;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const obs of observations) {
        const res = await client.query(
          `INSERT INTO price_observations (id, product_id, store_id, source_id, price, date, receipt_id, loyalty_card_used, source)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (product_id, store_id, date, price) DO NOTHING
           RETURNING id`,
          [
            obs.id,
            obs.productId,
            obs.storeId,
            obs.sourceId || null,
            obs.price,
            obs.date,
            obs.receiptId || null,
            obs.loyaltyCardUsed || false,
            obs.source
          ]
        );

        if (res.rowCount && res.rowCount > 0) {
          inserted++;
        }
      }

      await client.query('COMMIT');
      return { inserted, persisted: true };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Eroare append istoric observații în PostgreSQL:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  static async getPriceObservations(productId?: string): Promise<PriceObservation[]> {
    const pool = getPool();
    if (!pool) return PRICE_OBSERVATIONS;

    try {
      const query = productId
        ? 'SELECT * FROM price_observations WHERE product_id = $1 ORDER BY date ASC'
        : 'SELECT * FROM price_observations ORDER BY date DESC LIMIT 200';
      const params = productId ? [productId] : [];
      const res = await pool.query(query, params);

      if (res.rows.length === 0) return PRICE_OBSERVATIONS;
      return res.rows.map(r => ({
        id: r.id,
        productId: r.product_id,
        storeId: r.store_id,
        sourceId: r.source_id || undefined,
        price: parseFloat(r.price),
        date: r.date ? (r.date.toISOString?.().split('T')[0] || String(r.date).slice(0, 10)) : '',
        receiptId: r.receipt_id || undefined,
        loyaltyCardUsed: r.loyalty_card_used,
        source: r.source
      }));
    } catch {
      return PRICE_OBSERVATIONS;
    }
  }

  // --- MATCH CANDIDATES ---
  static async getMatchCandidates(): Promise<ProductMatchCandidate[]> {
    const pool = getPool();
    if (!pool) return INITIAL_MATCH_CANDIDATES;

    try {
      const res = await pool.query('SELECT * FROM product_match_candidates ORDER BY created_at DESC');
      if (res.rows.length === 0) return INITIAL_MATCH_CANDIDATES;
      return res.rows.map(r => ({
        id: r.id,
        sourceRawName: r.source_raw_name,
        sourceBarcode: r.source_barcode || undefined,
        sourceBrand: r.source_brand || undefined,
        sourcePackageWeightOrVolume: r.source_package_weight_or_volume ? parseFloat(r.source_package_weight_or_volume) : undefined,
        sourcePackageUnit: r.source_package_unit || undefined,
        matchedProductId: r.matched_product_id,
        matchedProductName: r.matched_product_name,
        confidenceScore: parseFloat(r.confidence_score),
        matchMethod: r.match_method,
        status: r.status,
        createdAt: new Date(r.created_at).toISOString()
      }));
    } catch {
      return INITIAL_MATCH_CANDIDATES;
    }
  }

  static async addMatchCandidates(candidates: ProductMatchCandidate[]): Promise<{ added: number; persisted: boolean }> {
    const pool = getPool();
    if (!pool) return { added: 0, persisted: false };

    let added = 0;
    const client = await pool.connect();
    try {
      for (const c of candidates) {
        const res = await client.query(
          `INSERT INTO product_match_candidates (
            id, source_raw_name, source_barcode, source_brand,
            source_package_weight_or_volume, source_package_unit,
            matched_product_id, matched_product_name, confidence_score,
            match_method, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING
          RETURNING id`,
          [
            c.id,
            c.sourceRawName,
            c.sourceBarcode || null,
            c.sourceBrand || null,
            c.sourcePackageWeightOrVolume || null,
            c.sourcePackageUnit || null,
            c.matchedProductId,
            c.matchedProductName,
            c.confidenceScore,
            c.matchMethod,
            c.status
          ]
        );
        if (res.rowCount && res.rowCount > 0) added++;
      }
      return { added, persisted: true };
    } finally {
      client.release();
    }
  }

  static async updateCandidateStatus(id: string, status: 'auto_approved' | 'pending_confirmation' | 'rejected'): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;

    try {
      const res = await pool.query('UPDATE product_match_candidates SET status = $1 WHERE id = $2', [status, id]);
      return (res.rowCount || 0) > 0;
    } catch {
      return false;
    }
  }

  // --- SYNC RUNS ---
  static async addSyncRun(run: SourceSyncRun, persistenceMode: string = 'postgresql'): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;

    try {
      await pool.query(
        `INSERT INTO source_sync_runs (
          id, source_id, source_name, started_at, completed_at, status,
          records_processed, records_imported, duplicates_found, invalid_records,
          errors, summary, persistence_mode
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          run.id,
          run.sourceId,
          run.sourceName,
          run.startedAt,
          run.completedAt,
          run.status,
          run.recordsProcessed,
          run.recordsImported,
          run.duplicatesFound,
          run.invalidRecords,
          JSON.stringify(run.errors),
          run.summary,
          persistenceMode
        ]
      );
      return true;
    } catch (err) {
      console.warn('Nu s-a putut salva jurnalul de sincronizare în DB:', err);
      return false;
    }
  }

  static async getSyncRuns(): Promise<SourceSyncRun[]> {
    const pool = getPool();
    if (!pool) return INITIAL_SYNC_RUNS;

    try {
      const res = await pool.query('SELECT * FROM source_sync_runs ORDER BY started_at DESC LIMIT 50');
      if (res.rows.length === 0) return INITIAL_SYNC_RUNS;
      return res.rows.map(r => ({
        id: r.id,
        sourceId: r.source_id,
        sourceName: r.source_name,
        startedAt: new Date(r.started_at).toISOString(),
        completedAt: new Date(r.completed_at).toISOString(),
        status: r.status,
        recordsProcessed: r.records_processed,
        recordsImported: r.records_imported,
        duplicatesFound: r.duplicates_found,
        invalidRecords: r.invalid_records,
        errors: Array.isArray(r.errors) ? r.errors : [],
        summary: r.summary
      }));
    } catch {
      return INITIAL_SYNC_RUNS;
    }
  }

  // ==========================================
  // CATALOG IMPORTER DATABASE METHODS
  // ==========================================

  static async getCatalogDocuments(): Promise<CatalogDocument[]> {
    const pool = getPool();
    if (!pool) return [];
    try {
      const res = await pool.query('SELECT * FROM catalog_documents ORDER BY created_at DESC LIMIT 100');
      return res.rows.map(r => ({
        id: r.id,
        sourceId: r.source_id,
        retailerId: r.retailer_id,
        documentUrl: r.document_url,
        title: r.title,
        format: r.format,
        validFrom: r.valid_from ? new Date(r.valid_from).toISOString().split('T')[0] : undefined,
        validUntil: r.valid_until ? new Date(r.valid_until).toISOString().split('T')[0] : undefined,
        fileSizeBytes: r.file_size_bytes ? parseInt(r.file_size_bytes, 10) : undefined,
        sha256Checksum: r.sha256_checksum,
        downloadStatus: r.download_status,
        parseStatus: r.parse_status,
        rawExtractedCount: r.raw_extracted_count || 0,
        matchedCount: r.matched_count || 0,
        validatedCount: r.validated_count || 0,
        publishedCount: r.published_count || 0,
        ocrConfidence: r.ocr_confidence ? parseFloat(r.ocr_confidence) : undefined,
        errorMessage: r.error_message,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString()
      }));
    } catch {
      return [];
    }
  }

  static async saveCatalogDocument(doc: CatalogDocument): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;
    try {
      await pool.query(
        `INSERT INTO catalog_documents (
          id, source_id, retailer_id, document_url, title, format,
          valid_from, valid_until, file_size_bytes, sha256_checksum,
          download_status, parse_status, raw_extracted_count, matched_count,
          validated_count, published_count, ocr_confidence, error_message,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (id) DO UPDATE SET
          download_status = EXCLUDED.download_status,
          parse_status = EXCLUDED.parse_status,
          file_size_bytes = EXCLUDED.file_size_bytes,
          sha256_checksum = EXCLUDED.sha256_checksum,
          raw_extracted_count = EXCLUDED.raw_extracted_count,
          matched_count = EXCLUDED.matched_count,
          validated_count = EXCLUDED.validated_count,
          published_count = EXCLUDED.published_count,
          ocr_confidence = EXCLUDED.ocr_confidence,
          error_message = EXCLUDED.error_message,
          updated_at = NOW()`,
        [
          doc.id, doc.sourceId, doc.retailerId, doc.documentUrl, doc.title, doc.format,
          doc.validFrom || null, doc.validUntil || null, doc.fileSizeBytes || null, doc.sha256Checksum || null,
          doc.downloadStatus, doc.parseStatus, doc.rawExtractedCount, doc.matchedCount,
          doc.validatedCount, doc.publishedCount, doc.ocrConfidence || null, doc.errorMessage || null,
          doc.createdAt, doc.updatedAt
        ]
      );
      return true;
    } catch (err) {
      console.warn('Nu s-a putut salva documentul catalog în DB:', err);
      return false;
    }
  }

  static async saveCatalogImportRun(run: CatalogImportRun): Promise<boolean> {
    const pool = getPool();
    if (!pool) return false;
    try {
      await pool.query(
        `INSERT INTO catalog_import_runs (
          id, document_id, source_id, retailer_id, started_at, completed_at,
          status, total_raw_extracted, auto_matched_count, needs_review_count,
          published_count, rejected_count, duration_ms, errors
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
          completed_at = EXCLUDED.completed_at,
          status = EXCLUDED.status,
          total_raw_extracted = EXCLUDED.total_raw_extracted,
          auto_matched_count = EXCLUDED.auto_matched_count,
          needs_review_count = EXCLUDED.needs_review_count,
          published_count = EXCLUDED.published_count,
          rejected_count = EXCLUDED.rejected_count,
          duration_ms = EXCLUDED.duration_ms,
          errors = EXCLUDED.errors`,
        [
          run.id,
          run.documentId || null,
          run.sourceId,
          run.retailerId,
          run.startedAt,
          run.completedAt || null,
          run.status,
          run.totalRawExtracted,
          run.autoMatchedCount,
          run.needsReviewCount,
          run.publishedCount,
          run.rejectedCount,
          run.durationMs || null,
          JSON.stringify(run.errors || [])
        ]
      );
      return true;
    } catch (err) {
      console.warn('Nu s-a putut salva catalog_import_runs în DB:', err);
      return false;
    }
  }

  static async saveCatalogExtractedOffers(offers: CatalogExtractedOffer[]): Promise<{ inserted: number; persisted: boolean }> {
    const pool = getPool();
    if (!pool) return { inserted: 0, persisted: false };

    let inserted = 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const o of offers) {
        await client.query(
          `INSERT INTO catalog_extracted_offers (
            id, run_id, document_id, retailer_id, raw_title, raw_brand, raw_barcode,
            raw_category, normal_price, promo_price, loyalty_price, effective_price,
            currency, package_quantity, package_unit, unit_price, unit_price_measure,
            is_promo, promo_details, loyalty_card_required, loyalty_card_name,
            valid_from, valid_until, matched_product_id, match_confidence, match_method,
            staging_status, validation_errors, reviewed_by, reviewed_at, rejection_reason,
            created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
          ON CONFLICT (id) DO UPDATE SET
            normal_price = EXCLUDED.normal_price,
            promo_price = EXCLUDED.promo_price,
            loyalty_price = EXCLUDED.loyalty_price,
            effective_price = EXCLUDED.effective_price,
            staging_status = EXCLUDED.staging_status,
            matched_product_id = EXCLUDED.matched_product_id,
            match_confidence = EXCLUDED.match_confidence,
            match_method = EXCLUDED.match_method,
            validation_errors = EXCLUDED.validation_errors,
            updated_at = NOW()`,
          [
            o.id,
            o.runId || null,
            o.documentId || null,
            o.retailerId,
            o.rawTitle,
            o.rawBrand || null,
            o.rawBarcode || null,
            o.rawCategory || null,
            o.normalPrice,
            o.promoPrice || null,
            o.loyaltyPrice || null,
            o.effectivePrice,
            o.currency || 'RON',
            o.packageQuantity || null,
            o.packageUnit || null,
            o.unitPrice || null,
            o.unitPriceMeasure || null,
            o.isPromo || false,
            o.promoDetails || null,
            o.loyaltyCardRequired || false,
            o.loyaltyCardName || null,
            o.validFrom || null,
            o.validUntil || null,
            o.matchedProductId || null,
            o.matchConfidence || 0,
            o.matchMethod || 'unmatched',
            o.stagingStatus,
            o.validationErrors ? JSON.stringify(o.validationErrors) : null,
            o.reviewedBy || null,
            o.reviewedAt || null,
            o.rejectionReason || null,
            o.createdAt,
            o.updatedAt
          ]
        );
        inserted++;
      }
      await client.query('COMMIT');
      return { inserted, persisted: true };
    } catch (err) {
      await client.query('ROLLBACK');
      console.warn('Eroare la salvarea catalog_extracted_offers în PostgreSQL:', err);
      return { inserted: 0, persisted: false };
    } finally {
      client.release();
    }
  }

  static async getCatalogExtractedOffers(): Promise<CatalogExtractedOffer[]> {
    const pool = getPool();
    if (!pool) return [];
    try {
      const res = await pool.query('SELECT * FROM catalog_extracted_offers ORDER BY created_at DESC LIMIT 500');
      return res.rows.map(r => ({
        id: r.id,
        runId: r.run_id || undefined,
        documentId: r.document_id || undefined,
        retailerId: r.retailer_id,
        rawTitle: r.raw_title,
        rawBrand: r.raw_brand || undefined,
        rawBarcode: r.raw_barcode || undefined,
        rawCategory: r.raw_category || undefined,
        normalPrice: parseFloat(r.normal_price),
        promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
        loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
        effectivePrice: parseFloat(r.effective_price),
        currency: r.currency || 'RON',
        packageQuantity: r.package_quantity ? parseFloat(r.package_quantity) : undefined,
        packageUnit: r.package_unit || undefined,
        unitPrice: r.unit_price ? parseFloat(r.unit_price) : undefined,
        unitPriceMeasure: r.unit_price_measure || undefined,
        isPromo: r.is_promo,
        promoDetails: r.promo_details || undefined,
        loyaltyCardRequired: r.loyalty_card_required,
        loyaltyCardName: r.loyalty_card_name || undefined,
        validFrom: r.valid_from ? new Date(r.valid_from).toISOString().split('T')[0] : undefined,
        validUntil: r.valid_until ? new Date(r.valid_until).toISOString().split('T')[0] : undefined,
        matchedProductId: r.matched_product_id || undefined,
        matchConfidence: parseFloat(r.match_confidence || '0'),
        matchMethod: r.match_method || 'unmatched',
        stagingStatus: r.staging_status,
        validationErrors: Array.isArray(r.validation_errors) ? r.validation_errors : undefined,
        reviewedBy: r.reviewed_by || undefined,
        reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
        rejectionReason: r.rejection_reason || undefined,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString()
      }));
    } catch {
      return [];
    }
  }
}
