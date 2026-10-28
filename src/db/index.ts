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
    return {
      configured: true,
      type: rawUrl.includes('supabase') ? 'supabase' : 'standard',
      host: 'remote-url',
      ssl: { rejectUnauthorized: false }
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
        ssl: { rejectUnauthorized: false },
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
}
