import pg from 'pg';
import crypto from 'crypto';
import {
  Product,
  Store,
  ProductOffer,
  PriceObservation,
  DataSource,
  SourceSyncRun,
  ProductMatchCandidate,
  AdminAuditLog,
  OperationalDashboardData
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
import { ProductMatcher } from '../services/ProductMatcher.ts';
import { mapRetailerCategoryToStandard } from '../data/categories.ts';
import { supabase } from '../lib/supabase.ts';

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

  // Option 2: Supabase or Vercel Postgres connection string
  const connectionString =
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING;
  if (connectionString) {
    const rawUrl = connectionString || '';
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

  // Option 4: Supabase client is available (persistent storage via Supabase API)
  if (typeof supabase !== 'undefined' && supabase) {
    return {
      configured: true,
      type: 'supabase',
      host: 'supabase-api'
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

  const hasConnectionString = Boolean(
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  );
  const hasHostConfig = Boolean(
    (process.env.SQL_HOST && process.env.SQL_USER) ||
    (process.env.PGHOST && process.env.PGUSER)
  );

  if (!hasConnectionString && !hasHostConfig) {
    // Running in direct Supabase client mode without TCP PG connection string
    return null;
  }

  if (!global._postgresPool) {
    if (hasConnectionString) {
      const connectionString =
        process.env.SUPABASE_DB_URL ||
        process.env.POSTGRES_PRISMA_URL ||
        process.env.POSTGRES_URL ||
        process.env.DATABASE_URL ||
        process.env.POSTGRES_URL_NON_POOLING;
      const sanitizedConnectionString = connectionString?.replace(/([?&])ssl(mode|cert|key|rootcert)=[^&]*/gi, '$1').replace(/[?&]$/, '');
      global._postgresPool = new Pool({
        connectionString: sanitizedConnectionString,
        ssl: config.ssl,
        max: Number(process.env.PG_POOL_MAX || 3),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST || process.env.PGHOST,
        user: process.env.SQL_USER || process.env.PGUSER,
        password: process.env.SQL_PASSWORD || process.env.PGPASSWORD,
        database: process.env.SQL_DB_NAME || process.env.PGDATABASE,
        port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
        ssl: config.ssl,
        max: Number(process.env.PG_POOL_MAX || 3),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000
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
      message: 'PostgreSQL nu este configurat în variabilele de mediu. Se utilizează stocarea locală în memorie.',
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
      message: `Eroare conexiune PostgreSQL: ${err.message || 'Host indisponibil'}. Sistemul continuă pe stocarea locală.`,
      type: config.type
    };
  }
}

// ============================================================================
// DATA ACCESS LAYER (DAL) / REPOSITORIES CU GARANȚII DE IMUABILITATE
// ============================================================================

function latestCanonicalOffers(offers: ProductOffer[]): ProductOffer[] {
  const offersByProductAndStore = new Map<string, ProductOffer>();

  for (const offer of offers) {
    const key = `${offer.productId}__${offer.storeId}`;
    const current = offersByProductAndStore.get(key);
    const offerDate = `${offer.observationDate || ''}:${offer.lastChecked || ''}`;
    const currentDate = current ? `${current.observationDate || ''}:${current.lastChecked || ''}` : '';

    if (!current || offerDate >= currentDate) {
      offersByProductAndStore.set(key, offer);
    }
  }

  return Array.from(offersByProductAndStore.values());
}

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
  canonical_product_id VARCHAR(64) REFERENCES products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS products_canonical_product_id_idx
  ON products (canonical_product_id) WHERE canonical_product_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS products_canonical_identity_unique
  ON products (
  lower(btrim(name)),
  lower(btrim(coalesce(brand, ''))),
  package_weight_or_volume,
  lower(btrim(coalesce(package_unit, ''))),
  lower(btrim(coalesce(barcode, '')))
  ) WHERE canonical_product_id IS NULL;

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

        // Seed baseline stores, products, and sources if not present (ON CONFLICT DO NOTHING)
        for (const s of STORES) {
          await client.query(
  `INSERT INTO stores (id, name, slug, chain, brand_color, accent_color, logo_url, store_type, rating, locations_count, sample_address, is_partner)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (id) DO NOTHING`,
            [s.id, s.name, s.slug, s.chain, s.brandColor, s.accentColor, s.logoUrl || null, s.type, s.rating, s.locationsCount, s.sampleAddress, s.isPartner || false]
          );
        }

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
  ON CONFLICT DO NOTHING`,
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
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM products WHERE canonical_product_id IS NULL ORDER BY name ASC');
        if (res.rows.length > 0) {
          return res.rows.map(r => ({
            id: r.id,
            name: r.name,
            brand: r.brand,
            category: r.category,
            defaultUnit: r.default_unit || 'buc',
            packageWeightOrVolume: parseFloat(r.package_weight_or_volume) || 1,
            packageUnit: r.package_unit || 'buc',
            normalizedUnit: r.normalized_unit || 'buc',
            barcode: r.barcode || undefined,
            imageUrl: r.image_url || undefined,
            isBio: Boolean(r.is_bio),
            isRomanianProduct: Boolean(r.is_romanian_product),
            baseReferencePrice: parseFloat(r.base_reference_price) || 0
          }));
        }
      } catch (err: any) {
        console.warn('Postgres pool getProducts failed, falling back to Supabase:', err.message);
      }
    }

    try {
      const { data, error } = await supabase.from('products').select('*').is('canonical_product_id', null).order('name', { ascending: true });
      if (!error && data && data.length > 0) {
        return data.map(r => ({
          id: r.id,
          name: r.name,
          brand: r.brand,
          category: r.category,
          defaultUnit: r.default_unit || 'buc',
          packageWeightOrVolume: parseFloat(r.package_weight_or_volume) || 1,
          packageUnit: r.package_unit || 'buc',
          normalizedUnit: r.normalized_unit || 'buc',
          barcode: r.barcode || undefined,
          imageUrl: r.image_url || undefined,
          isBio: Boolean(r.is_bio),
          isRomanianProduct: Boolean(r.is_romanian_product),
          baseReferencePrice: parseFloat(r.base_reference_price) || 0
        }));
      }
    } catch (err: any) {
      console.warn('Supabase getProducts failed:', err.message);
    }

    return PRODUCTS;
  }

  static async insertProduct(product: Product): Promise<boolean> {
    const pool = getPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO products (
            id, name, brand, category, default_unit, package_weight_or_volume,
            package_unit, normalized_unit, barcode, image_url, is_bio,
            is_romanian_product, base_reference_price, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            brand = EXCLUDED.brand,
            category = EXCLUDED.category,
            default_unit = EXCLUDED.default_unit,
            package_weight_or_volume = EXCLUDED.package_weight_or_volume,
            package_unit = EXCLUDED.package_unit,
            normalized_unit = EXCLUDED.normalized_unit,
            barcode = EXCLUDED.barcode,
            image_url = EXCLUDED.image_url,
            is_bio = EXCLUDED.is_bio,
            is_romanian_product = EXCLUDED.is_romanian_product,
            base_reference_price = EXCLUDED.base_reference_price,
            updated_at = NOW()`,
          [
            product.id,
            product.name,
            product.brand,
            product.category,
            product.defaultUnit || 'buc',
            product.packageWeightOrVolume || 1,
            product.packageUnit || 'buc',
            product.normalizedUnit || 'buc',
            product.barcode || null,
            product.imageUrl || null,
            Boolean(product.isBio),
            Boolean(product.isRomanianProduct),
            product.baseReferencePrice || 0
          ]
        );
        return true;
      } catch (err: any) {
        console.warn('Postgres pool insertProduct failed, falling back to Supabase:', err.message);
      }
    }

    try {
      const { error } = await supabase.from('products').upsert({
        id: product.id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        default_unit: product.defaultUnit || 'buc',
        package_weight_or_volume: product.packageWeightOrVolume || 1,
        package_unit: product.packageUnit || 'buc',
        normalized_unit: product.normalizedUnit || 'buc',
        barcode: product.barcode || null,
        image_url: product.imageUrl || null,
        is_bio: Boolean(product.isBio),
        is_romanian_product: Boolean(product.isRomanianProduct),
        base_reference_price: product.baseReferencePrice || 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

      return !error;
    } catch (err: any) {
      console.error('Supabase insertProduct failed:', err.message);
      return false;
    }
  }

  // --- STORES ---
  static async getStores(): Promise<Store[]> {
    const pool = getPool();
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM stores ORDER BY rating DESC');
        if (res.rows.length > 0) {
          const dbStores = res.rows.map(r => {
            const fallbackStore = STORES.find(s => s.id === r.id || s.slug === r.slug);
            return {
              id: r.id,
              name: r.name,
              slug: r.slug,
              chain: r.chain,
              brandColor: r.brand_color,
              accentColor: r.accent_color,
              logoUrl: r.logo_url || undefined,
              officialUrl: r.official_url || r.website_url || fallbackStore?.officialUrl,
              websiteUrl: r.website_url || r.official_url || fallbackStore?.websiteUrl,
              type: r.store_type,
              rating: parseFloat(r.rating) || 4.0,
              locationsCount: r.locations_count || 100,
              sampleAddress: r.sample_address,
              isPartner: Boolean(r.is_partner)
            };
          });
          const existingSlugs = new Set(dbStores.map(s => (s.slug || s.id).toLowerCase()));
          const missing = STORES.filter(s => !existingSlugs.has((s.slug || s.id).toLowerCase()));
          return [...dbStores, ...missing];
        }
      } catch (err: any) {
        console.warn('Postgres pool getStores failed, falling back to Supabase:', err.message);
      }
    }

    try {
      const { data, error } = await supabase.from('stores').select('*').order('rating', { ascending: false });
      if (!error && data && data.length > 0) {
        const sbStores = data.map(r => {
          const fallbackStore = STORES.find(s => s.id === r.id || s.slug === r.slug);
          return {
            id: r.id,
            name: r.name,
            slug: r.slug,
            chain: r.chain,
            brandColor: r.brand_color,
            accentColor: r.accent_color,
            logoUrl: r.logo_url || undefined,
            officialUrl: r.official_url || r.website_url || fallbackStore?.officialUrl,
            websiteUrl: r.website_url || r.official_url || fallbackStore?.websiteUrl,
            type: r.store_type,
            rating: parseFloat(r.rating) || 4.0,
            locationsCount: r.locations_count || 100,
            sampleAddress: r.sample_address,
            isPartner: Boolean(r.is_partner)
          };
        });
        const existingSlugs = new Set(sbStores.map(s => (s.slug || s.id).toLowerCase()));
        const missing = STORES.filter(s => !existingSlugs.has((s.slug || s.id).toLowerCase()));
        return [...sbStores, ...missing];
      }
    } catch {}

    return STORES;
  }

  // --- PRODUCT OFFERS (CURRENT STATE) ---
  static async getOffers(): Promise<ProductOffer[]> {
    const pool = getPool();
    if (pool) {
      try {
  const res = await pool.query(
  `SELECT po.*, COALESCE(p.canonical_product_id, p.id) AS canonical_product_id
  FROM product_offers po
  JOIN products p ON p.id = po.product_id
  WHERE po.source != 'demo' AND po.verification_status != 'demo'
  ORDER BY po.observation_date ASC, po.last_checked ASC`
  );
  if (res.rows.length > 0) {
  const offers = res.rows.map(r => ({
  id: r.id,
  productId: r.canonical_product_id || r.product_id,
            storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
            sourceId: r.source_id || undefined,
            price: parseFloat(r.price),
            originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
            unitPrice: parseFloat(r.unit_price) || parseFloat(r.price),
            unitPriceMeasure: r.unit_price_measure || 'lei/buc',
            isPromo: Boolean(r.is_promo),
            promoDetails: r.promo_details || undefined,
            loyaltyCardRequired: Boolean(r.loyalty_card_required),
            loyaltyCardName: r.loyalty_card_name || undefined,
            validUntil: r.valid_until ? (r.valid_until.toISOString?.().split('T')[0] || String(r.valid_until).slice(0, 10)) : undefined,
            observationDate: r.observation_date ? (r.observation_date.toISOString?.().split('T')[0] || String(r.observation_date).slice(0, 10)) : new Date().toISOString().split('T')[0],
            source: r.source,
            confidenceLevel: r.confidence_level || 'high',
            verificationStatus: r.verification_status || 'verified',
            lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
  isSponsored: Boolean(r.is_sponsored)
  }));
  return latestCanonicalOffers(offers);
  }
  } catch (err: any) {
  console.warn('Postgres pool getOffers failed, falling back to Supabase:', err.message);
      }
    }

    try {
  const [{ data, error }, { data: productRows }] = await Promise.all([
  supabase.from('product_offers').select('*').neq('source', 'demo').neq('verification_status', 'demo'),
  supabase.from('products').select('id, canonical_product_id')
  ]);
  const canonicalIdByProductId = new Map(
  (productRows || []).map(product => [product.id, product.canonical_product_id || product.id])
  );

  if (!error && data && data.length > 0) {
  const offers = data.map(r => ({
  id: r.id,
  productId: canonicalIdByProductId.get(r.product_id) || r.product_id,
          storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
          sourceId: r.source_id || undefined,
          price: parseFloat(r.price),
          originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
          unitPrice: parseFloat(r.unit_price) || parseFloat(r.price),
          unitPriceMeasure: r.unit_price_measure || 'lei/buc',
          isPromo: Boolean(r.is_promo),
          promoDetails: r.promo_details || undefined,
          loyaltyCardRequired: Boolean(r.loyalty_card_required),
          loyaltyCardName: r.loyalty_card_name || undefined,
          validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : undefined,
          observationDate: r.observation_date ? String(r.observation_date).slice(0, 10) : new Date().toISOString().split('T')[0],
          source: r.source || 'verified',
          confidenceLevel: r.confidence_level || 'high',
          verificationStatus: r.verification_status || 'verified',
          lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
  isSponsored: Boolean(r.is_sponsored)
  }));
  return latestCanonicalOffers(offers);
  }
  } catch (err: any) {
  console.warn('Supabase getOffers failed:', err.message);
    }

    return [];
  }

  /**
   * Upserts current product offers into PostgreSQL.
   * Modifies current offer state without deleting previous historical observations.
   */
  static async upsertOffers(offers: ProductOffer[]): Promise<{ added: number; updated: number; persisted: boolean }> {
    const pool = getPool();
    if (pool) {
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

    // Supabase fallback upsert
    try {
      const records = offers.map(off => ({
        id: off.id,
        product_id: off.productId,
        store_id: off.storeId,
        source_id: off.sourceId || null,
        price: off.price,
        original_price: off.originalPrice || null,
        unit_price: off.unitPrice,
        unit_price_measure: off.unitPriceMeasure,
        is_promo: off.isPromo,
        promo_details: off.promoDetails || null,
        loyalty_card_required: off.loyaltyCardRequired || false,
        loyalty_card_name: off.loyaltyCardName || null,
        valid_until: off.validUntil || null,
        observation_date: off.observationDate,
        source: off.source,
        confidence_level: off.confidenceLevel,
        verification_status: off.verificationStatus,
        last_checked: new Date().toISOString(),
        is_sponsored: off.isSponsored || false,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase.from('product_offers').upsert(records, { onConflict: 'product_id,store_id' });
      if (error) {
        console.error('Supabase upsertOffers error:', error);
        return { added: 0, updated: 0, persisted: false };
      }
      return { added: offers.length, updated: 0, persisted: true };
    } catch (e: any) {
      console.error('Supabase upsertOffers exception:', e.message);
      return { added: 0, updated: 0, persisted: false };
    }
  }

  // --- PRICE OBSERVATIONS (APPEND-ONLY AUDIT TIMELINE) ---
  static async appendPriceObservations(observations: PriceObservation[]): Promise<{ inserted: number; persisted: boolean }> {
    const pool = getPool();
    if (pool) {
      let inserted = 0;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        for (const obs of observations) {
          const res = await client.query(
            `INSERT INTO price_observations (id, product_id, store_id, source_id, price, date, receipt_id, loyalty_card_used, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (id) DO NOTHING
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

    try {
      const records = observations.map(obs => ({
        id: obs.id,
        product_id: obs.productId,
        store_id: obs.storeId,
        source_id: obs.sourceId || null,
        price: obs.price,
        date: obs.date,
        receipt_id: obs.receiptId || null,
        loyalty_card_used: obs.loyaltyCardUsed || false,
        source: obs.source
      }));

      const { error } = await supabase
  .from('price_observations')
  .upsert(records, { onConflict: 'id', ignoreDuplicates: true });
      if (error) {
        console.error('Supabase appendPriceObservations error:', error);
        return { inserted: 0, persisted: false };
      }
      return { inserted: observations.length, persisted: true };
    } catch (e: any) {
      console.error('Supabase appendPriceObservations exception:', e.message);
      return { inserted: 0, persisted: false };
    }
  }

  static async getPriceObservations(productId?: string): Promise<PriceObservation[]> {
    const pool = getPool();
    if (pool) {
      try {
        const query = productId
  ? 'SELECT * FROM price_observations WHERE product_id = $1 OR product_id IN (SELECT id FROM products WHERE canonical_product_id = $1) ORDER BY date ASC, created_at ASC'
  : 'SELECT * FROM price_observations ORDER BY date DESC, created_at DESC LIMIT 200';
        const params = productId ? [productId] : [];
        const res = await pool.query(query, params);

        if (res.rows.length > 0) {
          return res.rows.map(r => ({
  id: r.id,
  productId: productId || r.product_id,
  storeId: r.store_id,
  sourceId: r.source_id || undefined,
  price: parseFloat(r.price),
  date: r.date ? (r.date.toISOString?.().split('T')[0] || String(r.date).slice(0, 10)) : '',
            receiptId: r.receipt_id || undefined,
            loyaltyCardUsed: r.loyalty_card_used,
            source: r.source
          }));
        }
      } catch (err: any) {
        console.warn('Postgres pool getPriceObservations failed, falling back to Supabase:', err.message);
      }
    }

    try {
  let query = supabase.from('price_observations').select('*');
  if (productId) {
  const { data: aliases } = await supabase
  .from('products')
  .select('id')
  .eq('canonical_product_id', productId);
  const productIds = [productId, ...(aliases || []).map(alias => alias.id)];
  query = query.in('product_id', productIds).order('date', { ascending: true });
  } else {
        query = query.order('date', { ascending: false }).limit(200);
      }
      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data.map(r => ({
  id: r.id,
  productId: productId || r.product_id,
  storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
  sourceId: r.source_id || undefined,
  price: parseFloat(r.price),
  date: r.date ? String(r.date).slice(0, 10) : '',
          receiptId: r.receipt_id || undefined,
          loyaltyCardUsed: Boolean(r.loyalty_card_used),
          source: r.source || 'verified'
        }));
      }
    } catch (err: any) {
      console.warn('Supabase getPriceObservations failed:', err.message);
    }

    return [];
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
          published_count, rejected_count, duration_ms, errors,
          new_products_count, updated_products_count, unchanged_products_count,
          new_offers_count, updated_offers_count, expired_offers_count,
          changed_prices_count, unchanged_prices_count, items_without_price_count,
          items_without_offer_count, staging_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
        ON CONFLICT (id) DO UPDATE SET
          completed_at = EXCLUDED.completed_at,
          status = EXCLUDED.status,
          total_raw_extracted = EXCLUDED.total_raw_extracted,
          auto_matched_count = EXCLUDED.auto_matched_count,
          needs_review_count = EXCLUDED.needs_review_count,
          published_count = EXCLUDED.published_count,
          rejected_count = EXCLUDED.rejected_count,
          duration_ms = EXCLUDED.duration_ms,
          errors = EXCLUDED.errors,
          new_products_count = EXCLUDED.new_products_count,
          updated_products_count = EXCLUDED.updated_products_count,
          unchanged_products_count = EXCLUDED.unchanged_products_count,
          new_offers_count = EXCLUDED.new_offers_count,
          updated_offers_count = EXCLUDED.updated_offers_count,
          expired_offers_count = EXCLUDED.expired_offers_count,
          changed_prices_count = EXCLUDED.changed_prices_count,
          unchanged_prices_count = EXCLUDED.unchanged_prices_count,
          items_without_price_count = EXCLUDED.items_without_price_count,
          items_without_offer_count = EXCLUDED.items_without_offer_count,
          staging_count = EXCLUDED.staging_count`,
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
          JSON.stringify(run.errors || []),
          run.newProductsCount || 0,
          run.updatedProductsCount || 0,
          run.unchangedProductsCount || 0,
          run.newOffersCount || 0,
          run.updatedOffersCount || 0,
          run.expiredOffersCount || 0,
          run.changedPricesCount || 0,
          run.unchangedPricesCount || 0,
          run.itemsWithoutPriceCount || 0,
          run.itemsWithoutOfferCount || 0,
          run.stagingCount || 0
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
      const res = await pool.query('SELECT * FROM catalog_extracted_offers ORDER BY created_at DESC');
      const toIso = (value: unknown) => value ? new Date(value as string | number | Date).toISOString() : undefined;
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
        validFrom: toIso(r.valid_from)?.split('T')[0],
        validUntil: toIso(r.valid_until)?.split('T')[0],
        matchedProductId: r.matched_product_id || undefined,
        matchConfidence: parseFloat(r.match_confidence || '0'),
        matchMethod: r.match_method || 'unmatched',
        stagingStatus: String(r.staging_status || 'NEEDS_REVIEW').toUpperCase() as CatalogExtractedOffer['stagingStatus'],
        validationErrors: Array.isArray(r.validation_errors) ? r.validation_errors : undefined,
        reviewedBy: r.reviewed_by || undefined,
        reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
        rejectionReason: r.rejection_reason || undefined,
        createdAt: toIso(r.created_at) || new Date(0).toISOString(),
        updatedAt: toIso(r.updated_at) || toIso(r.created_at) || new Date(0).toISOString()
      }));
    } catch {
      return [];
    }
  }

  static async deleteUnpublishedCatalogExtractedOffers(offerIds: string[]): Promise<string[]> {
    const pool = getPool();
    if (!pool || offerIds.length === 0) return [];
    const result = await pool.query(
      `DELETE FROM catalog_extracted_offers
       WHERE id = ANY($1::varchar[])
         AND UPPER(staging_status) <> 'PUBLISHED'
       RETURNING id`,
      [offerIds]
    );
    return result.rows.map(row => String(row.id));
  }

  // ==========================================================================
  // SINCRONIZARE INCREMENTALĂ ROBUSTĂ (IDEMPOTENȚĂ, LOCK-URI & PERSISTENȚĂ REALĂ)
  // ==========================================================================

  /**
   * Execută sincronizarea incrementală a ofertelor într-o tranzacție securizată cu advisory lock.
   */
  static async syncBatchIncremental(params: {
    runId: string;
    documentId?: string;
    sourceId: string;
    retailerId: string;
    offers: CatalogExtractedOffer[];
    autoPublish?: boolean;
  }): Promise<{
    stats: {
      documentId?: string;
      retailerId: string;
      totalProcessed: number;
      newProductsCount: number;
      identifiedExistingCount: number;
      updatedProductsCount: number;
      unchangedProductsCount: number;
      newOffersCount: number;
      updatedOffersCount: number;
      expiredOffersCount: number;
      changedPricesCount: number;
      unchangedPricesCount: number;
      itemsWithoutPriceCount: number;
      itemsWithoutOfferCount: number;
      stagingCount: number;
      publishedCount: number;
      durationMs: number;
      errors: string[];
    };
    success: boolean;
  }> {
    const startTime = Date.now();
    const stats = {
      documentId: params.documentId,
      retailerId: params.retailerId,
      totalProcessed: params.offers.length,
      newProductsCount: 0,
      identifiedExistingCount: 0,
      updatedProductsCount: 0,
      unchangedProductsCount: 0,
      newOffersCount: 0,
      updatedOffersCount: 0,
      expiredOffersCount: 0,
      changedPricesCount: 0,
      unchangedPricesCount: 0,
      itemsWithoutPriceCount: 0,
      itemsWithoutOfferCount: 0,
      stagingCount: params.offers.length,
      publishedCount: 0,
      durationMs: 0,
      errors: [] as string[]
    };

    const pool = getPool();
    if (!pool) {
      stats.durationMs = Date.now() - startTime;
      return { stats, success: true };
    }

    const client = await pool.connect();
    let lockAcquired = false;

    try {
      // 1. Obținere advisory lock pentru prevenirea concurenței pe același retailer
      const lockRes = await client.query(
        "SELECT pg_try_advisory_lock(hashtext('catalog_sync_' || $1)) AS acquired",
        [params.retailerId]
      );
      lockAcquired = Boolean(lockRes.rows[0]?.acquired);
      if (!lockAcquired) {
        const lockErr = `Sincronizare concurentă blocată: Retailerul "${params.retailerId}" rulează deja o operațiune de import.`;
        stats.errors.push(lockErr);
        stats.durationMs = Date.now() - startTime;
        return { stats, success: false };
      }

      await client.query('BEGIN');

      const todayStr = new Date().toISOString().split('T')[0];
      const sourceRes = await client.query(
        `SELECT ds.id
           FROM data_sources ds
           LEFT JOIN stores s ON s.id = ds.store_id
          WHERE ds.id = $1 OR ds.store_id = $1 OR s.slug = $1
          ORDER BY ds.created_at ASC
          LIMIT 1`,
        [params.retailerId]
      );
      const dbSourceId = sourceRes.rows[0]?.id || null;

      // Preluăm toate produsele existente pentru potrivire fuzzy de rezervă
      const existingProductsRes = await client.query('SELECT * FROM products');
      const dbProducts: Product[] = existingProductsRes.rows.map(r => ({
        id: r.id,
        name: r.name,
        brand: r.brand,
        category: r.category as any,
        defaultUnit: r.default_unit,
        packageWeightOrVolume: parseFloat(r.package_weight_or_volume),
        packageUnit: r.package_unit,
        normalizedUnit: r.normalized_unit,
        barcode: r.barcode || undefined,
        baseReferencePrice: parseFloat(r.base_reference_price),
        isRomanianProduct: r.is_romanian_product
      }));

      for (const item of params.offers) {
        // Validare preț
        if (!item.effectivePrice || item.effectivePrice <= 0 || isNaN(item.effectivePrice)) {
          stats.itemsWithoutPriceCount++;
          continue;
        }

        let canonicalProduct: Product | undefined = undefined;

        // Pas 1: Căutare produs canonic
        // 1.1 După matchedProductId dacă este specificat
        if (item.matchedProductId) {
          const directMatch = dbProducts.find(p => p.id === item.matchedProductId);
          if (directMatch) canonicalProduct = directMatch;
        }

        // 1.2 După cod de bare (GTIN / EAN)
        if (!canonicalProduct && item.rawBarcode && item.rawBarcode.trim().length >= 8) {
          const barcodeMatch = dbProducts.find(p => p.barcode && p.barcode.trim() === item.rawBarcode?.trim());
          if (barcodeMatch) canonicalProduct = barcodeMatch;
        }

        // 1.3 După retailer_products mapping
        if (!canonicalProduct) {
          const sku = item.rawBarcode || item.id;
          const mapRes = await client.query(
            `SELECT p.* FROM retailer_products rp 
             JOIN products p ON p.id = rp.product_id 
             WHERE rp.retailer_id = $1 AND (rp.external_sku = $2 OR (rp.barcode = $3 AND $3 IS NOT NULL)) 
             LIMIT 1`,
            [params.retailerId, sku, item.rawBarcode || null]
          );
          if (mapRes.rows.length > 0) {
            const r = mapRes.rows[0];
            canonicalProduct = {
              id: r.id,
              name: r.name,
              brand: r.brand,
              category: r.category,
              defaultUnit: r.default_unit,
              packageWeightOrVolume: parseFloat(r.package_weight_or_volume),
              packageUnit: r.package_unit,
              normalizedUnit: r.normalized_unit,
              barcode: r.barcode || undefined,
              baseReferencePrice: parseFloat(r.base_reference_price),
              isRomanianProduct: r.is_romanian_product
            };
          }
        }

        // 1.4 După similaritate text & atribute prin ProductMatcher
        if (!canonicalProduct) {
  const matchResult = ProductMatcher.matchProduct({
  rawName: item.rawTitle,
  barcode: item.rawBarcode,
  brand: item.rawBrand,
  packageWeightOrVolume: item.packageQuantity,
  packageUnit: item.packageUnit as any,
  category: item.rawCategory
  }, dbProducts);

          if (matchResult.matchedProduct && matchResult.confidence >= 0.75) {
            canonicalProduct = dbProducts.find(p => p.id === matchResult.matchedProduct!.id);
          }
        }

        // Rezolvare inserare sau asociere produs
        if (canonicalProduct) {
          stats.identifiedExistingCount++;
          // Actualizăm dacă avem informații suplimentare sigure
          let updated = false;
          if (!canonicalProduct.barcode && item.rawBarcode && item.rawBarcode.trim().length >= 8) {
            canonicalProduct.barcode = item.rawBarcode.trim();
            await client.query('UPDATE products SET barcode = $1, updated_at = NOW() WHERE id = $2', [
              canonicalProduct.barcode,
              canonicalProduct.id
            ]);
            updated = true;
          }
          if (updated) {
            stats.updatedProductsCount++;
          } else {
            stats.unchangedProductsCount++;
          }
        } else {
          // Create a canonical product, resolving concurrent or within-batch identity collisions safely.
          const { category, subcategory } = mapRetailerCategoryToStandard(item.rawCategory || item.rawTitle);
          const normUnit: 'kg' | 'l' | 'buc' = ['kg', 'g'].includes(item.packageUnit || '')
            ? 'kg'
            : ['l', 'ml'].includes(item.packageUnit || '')
            ? 'l'
            : 'buc';

          const newId = `prod-${params.retailerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const safeProdTitle = (item.rawTitle || 'Produs fără nume').trim().slice(0, 250);
          const safeBrand = (item.rawBrand || 'Marcă Magazin').trim().slice(0, 120);
          const safeCategory = String(category).slice(0, 60);
          const safeUnit = item.packageUnit ? String(item.packageUnit).slice(0, 16) : 'buc';
          const safeNormUnit = String(normUnit).slice(0, 16);
          const safeBarcode = item.rawBarcode ? item.rawBarcode.trim().slice(0, 60) : null;

          const newProd: Product = {
            id: newId,
            name: safeProdTitle,
            brand: safeBrand,
            category: category as any,
            subcategory,
            defaultUnit: safeUnit as any,
            packageWeightOrVolume: item.packageQuantity || 1,
            packageUnit: safeUnit as any,
            normalizedUnit: safeNormUnit as any,
            barcode: safeBarcode || undefined,
            baseReferencePrice: item.normalPrice || item.effectivePrice,
            isRomanianProduct: true
          };

          const insertResult = await client.query(
            `INSERT INTO products (
              id, name, brand, category, default_unit, package_weight_or_volume,
              package_unit, normalized_unit, barcode, is_romanian_product, base_reference_price
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT DO NOTHING
            RETURNING id`,
            [
              newProd.id,
              safeProdTitle,
              safeBrand,
              safeCategory,
              safeUnit,
              newProd.packageWeightOrVolume,
              safeUnit,
              safeNormUnit,
              safeBarcode,
              newProd.isRomanianProduct,
              newProd.baseReferencePrice
            ]
          );

          if (insertResult.rows.length > 0) {
            stats.newProductsCount++;
            canonicalProduct = newProd;
            dbProducts.push(newProd);
          } else {
            const existingIdentity = await client.query(
              `SELECT * FROM products
               WHERE canonical_product_id IS NULL
                 AND lower(btrim(name)) = lower(btrim($1))
                 AND lower(btrim(coalesce(brand, ''))) = lower(btrim($2))
                 AND package_weight_or_volume = $3
                 AND lower(btrim(coalesce(package_unit, ''))) = lower(btrim($4))
                 AND lower(btrim(coalesce(barcode, ''))) = lower(btrim($5))
               LIMIT 1`,
              [safeProdTitle, safeBrand, newProd.packageWeightOrVolume, safeUnit, safeBarcode || '']
            );
            const existing = existingIdentity.rows[0];
            if (!existing) throw new Error(`Nu s-a putut rezolva identitatea canonică pentru „${safeProdTitle}”.`);
            canonicalProduct = {
              id: existing.id,
              name: existing.name,
              brand: existing.brand,
              category: existing.category,
              defaultUnit: existing.default_unit,
              packageWeightOrVolume: parseFloat(existing.package_weight_or_volume),
              packageUnit: existing.package_unit,
              normalizedUnit: existing.normalized_unit,
              barcode: existing.barcode || undefined,
              baseReferencePrice: parseFloat(existing.base_reference_price),
              isRomanianProduct: existing.is_romanian_product
            };
            stats.identifiedExistingCount++;
            stats.unchangedProductsCount++;
            dbProducts.push(canonicalProduct);
          }
        }

        const canonicalId = canonicalProduct.id;
        item.matchedProductId = canonicalId;
        item.matchedProductName = canonicalProduct.name;

        // Pas 2: Asociere în retailer_products
        const rawSku = (item.rawBarcode || item.id || `sku-${Date.now()}`).trim();
        const externalSku = rawSku.slice(0, 100);
        const skuSlug = externalSku.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 40) || 'item';
        const retProdId = `rp-${params.retailerId}-${skuSlug}`.slice(0, 60);

        const safeScrapedName = (item.rawTitle || 'Produs fără nume').trim().slice(0, 250);
        const safeScrapedBrand = item.rawBrand ? item.rawBrand.trim().slice(0, 120) : null;
        const safeScrapedUnit = item.packageUnit ? String(item.packageUnit).slice(0, 16) : null;
        const safeScrapedBarcode = item.rawBarcode ? item.rawBarcode.trim().slice(0, 60) : null;

        await client.query(
          `INSERT INTO retailer_products (
            id, retailer_id, product_id, external_sku, scraped_name,
            scraped_brand, scraped_package_weight_or_volume, scraped_package_unit,
            barcode, last_scraped_at, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'active')
          ON CONFLICT (id) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            scraped_name = EXCLUDED.scraped_name,
            barcode = COALESCE(EXCLUDED.barcode, retailer_products.barcode),
            last_scraped_at = NOW(),
            updated_at = NOW()`,
          [
            retProdId,
            params.retailerId,
            canonicalId,
            externalSku,
            safeScrapedName,
            safeScrapedBrand,
            item.packageQuantity || null,
            safeScrapedUnit,
            safeScrapedBarcode
          ]
        );

        // Pas 3: Verificare ofertă curentă în product_offers
        const curOfferRes = await client.query(
          'SELECT id, price, normal_price, promo_price, loyalty_price, is_promo, valid_until FROM product_offers WHERE product_id = $1 AND store_id = $2',
          [canonicalId, params.retailerId]
        );

        const offerId = curOfferRes.rows[0]?.id || `off-${params.retailerId}-${canonicalId}`;
        const existingOffer = curOfferRes.rows[0];

        if (!existingOffer) {
          // Ofertă nouă
          stats.newOffersCount++;
          stats.changedPricesCount++;

          const safeOfferMeasure = (item.unitPriceMeasure || 'lei/buc').slice(0, 30);
          const safeLoyaltyCardName = item.loyaltyCardName ? item.loyaltyCardName.slice(0, 60) : null;
          const guaranteedPromoPrice = item.promoPrice ?? item.loyaltyPrice ?? item.effectivePrice;
          const safePromoTitle = (item.rawTitle || 'Promoție').trim().slice(0, 250);

          await client.query(
            `INSERT INTO product_offers (
              id, product_id, store_id, source_id, price, original_price,
              normal_price, promo_price, loyalty_price, unit_price, unit_price_measure,
              is_promo, promo_details, loyalty_card_required, loyalty_card_name,
              valid_until, observation_date, source, confidence_level, verification_status,
              last_checked, last_verified_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'verified', 'high', 'verified', NOW(), NOW(), NOW())`,
            [
              offerId,
              canonicalId,
              params.retailerId,
              dbSourceId,
              item.effectivePrice,
              item.normalPrice !== item.effectivePrice ? item.normalPrice : null,
              item.normalPrice || null,
              item.promoPrice || null,
              item.loyaltyPrice || null,
              item.unitPrice || item.effectivePrice,
              safeOfferMeasure,
              Boolean(item.isPromo),
              item.promoDetails || null,
              Boolean(item.loyaltyCardRequired || item.loyaltyPrice),
              safeLoyaltyCardName,
              item.validUntil || null,
              todayStr
            ]
          );

          // Inserare observație nouă în istoricul append-only
          const obsId = `obs-${crypto.createHash('sha256').update(`${params.runId}:${item.id}:${canonicalId}`).digest('hex').slice(0, 48)}`;
          await client.query(
            `INSERT INTO price_observations (
              id, product_id, store_id, source_id, price, normal_price,
              promo_price, loyalty_price, date, loyalty_card_used, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'official_feed')
            ON CONFLICT DO NOTHING`,
            [
              obsId,
              canonicalId,
              params.retailerId,
              dbSourceId,
              item.effectivePrice,
              item.normalPrice || null,
              item.promoPrice || null,
              item.loyaltyPrice || null,
              todayStr,
              Boolean(item.loyaltyCardRequired || item.loyaltyPrice)
            ]
          );

          // Înregistrare promoție
          if (item.isPromo) {
            const promoId = `prm-${params.retailerId}-${canonicalId}`;
            await client.query(
              `INSERT INTO promotions (
                id, retailer_id, product_id, title, normal_price, promo_price,
                loyalty_price, loyalty_card_name, ends_at, conditions, discovered_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
              ON CONFLICT (id) DO UPDATE SET
                normal_price = EXCLUDED.normal_price,
                promo_price = EXCLUDED.promo_price,
                loyalty_price = EXCLUDED.loyalty_price,
                ends_at = EXCLUDED.ends_at`,
              [
                promoId,
                params.retailerId,
                canonicalId,
                safePromoTitle,
                item.normalPrice || null,
                guaranteedPromoPrice,
                item.loyaltyPrice || null,
                safeLoyaltyCardName,
                item.validUntil || null,
                item.promoDetails || null
              ]
            );
          }
        } else {
          // Ofertă existentă
          stats.updatedOffersCount++;
          const oldPrice = parseFloat(existingOffer.price);
          const priceChanged = Math.abs(oldPrice - item.effectivePrice) > 0.001;

          if (priceChanged) {
            stats.changedPricesCount++;

            const safeOfferMeasure = (item.unitPriceMeasure || 'lei/buc').slice(0, 30);
            const safeLoyaltyCardName = item.loyaltyCardName ? item.loyaltyCardName.slice(0, 60) : null;
            const guaranteedPromoPrice = item.promoPrice ?? item.loyaltyPrice ?? item.effectivePrice;
            const safePromoTitle = (item.rawTitle || 'Promoție').trim().slice(0, 250);

            await client.query(
              `UPDATE product_offers SET
                price = $1,
                original_price = $2,
                normal_price = $3,
                promo_price = $4,
                loyalty_price = $5,
                unit_price = $6,
                unit_price_measure = $7,
                is_promo = $8,
                promo_details = $9,
                loyalty_card_required = $10,
                loyalty_card_name = $11,
                valid_until = $12,
                observation_date = $13,
                last_checked = NOW(),
                last_verified_at = NOW(),
                updated_at = NOW()
              WHERE id = $14`,
              [
                item.effectivePrice,
                item.normalPrice !== item.effectivePrice ? item.normalPrice : null,
                item.normalPrice || null,
                item.promoPrice || null,
                item.loyaltyPrice || null,
                item.unitPrice || item.effectivePrice,
                safeOfferMeasure,
                Boolean(item.isPromo),
                item.promoDetails || null,
                Boolean(item.loyaltyCardRequired || item.loyaltyPrice),
                safeLoyaltyCardName,
                item.validUntil || null,
                todayStr,
                offerId
              ]
            );

            // Istoric imutabil append-only: adăugare nouă observație
            const obsId = `obs-${crypto.createHash('sha256').update(`${params.runId}:${item.id}:${canonicalId}`).digest('hex').slice(0, 48)}`;
            await client.query(
              `INSERT INTO price_observations (
                id, product_id, store_id, source_id, price, normal_price,
                promo_price, loyalty_price, date, loyalty_card_used, source
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'official_feed')
  ON CONFLICT DO NOTHING`,
              [
                obsId,
                canonicalId,
                params.retailerId,
                dbSourceId,
                item.effectivePrice,
                item.normalPrice || null,
                item.promoPrice || null,
                item.loyaltyPrice || null,
                todayStr,
                Boolean(item.loyaltyCardRequired || item.loyaltyPrice)
              ]
            );

            if (item.isPromo) {
              const promoId = `prm-${params.retailerId}-${canonicalId}`;
              await client.query(
                `INSERT INTO promotions (
                  id, retailer_id, product_id, title, normal_price, promo_price,
                  loyalty_price, loyalty_card_name, ends_at, conditions, discovered_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                ON CONFLICT (id) DO UPDATE SET
                  normal_price = EXCLUDED.normal_price,
                  promo_price = EXCLUDED.promo_price,
                  loyalty_price = EXCLUDED.loyalty_price,
                  ends_at = EXCLUDED.ends_at`,
                [
                  promoId,
                  params.retailerId,
                  canonicalId,
                  safePromoTitle,
                  item.normalPrice || null,
                  guaranteedPromoPrice,
                  item.loyaltyPrice || null,
                  safeLoyaltyCardName,
                  item.validUntil || null,
                  item.promoDetails || null
                ]
              );
            } else if (existingOffer.is_promo) {
              // Promoția a expirat
              stats.expiredOffersCount++;
              await client.query(
                `UPDATE promotions SET ends_at = CURRENT_DATE 
                 WHERE retailer_id = $1 AND product_id = $2 AND (ends_at IS NULL OR ends_at >= CURRENT_DATE)`,
                [params.retailerId, canonicalId]
              );
            }
          } else {
            // Keep the current offer fresh while appending one observation for this import run.
            stats.unchangedPricesCount++;
            await client.query(
              'UPDATE product_offers SET last_checked = NOW(), last_verified_at = NOW(), updated_at = NOW() WHERE id = $1',
              [offerId]
            );

            const obsId = `obs-${crypto.createHash('sha256').update(`${params.runId}:${item.id}:${canonicalId}`).digest('hex').slice(0, 48)}`;
            await client.query(
              `INSERT INTO price_observations (
                id, product_id, store_id, source_id, price, normal_price,
                promo_price, loyalty_price, date, loyalty_card_used, source
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'official_feed')
              ON CONFLICT DO NOTHING`,
              [
                obsId,
                canonicalId,
                params.retailerId,
                dbSourceId,
                item.effectivePrice,
                item.normalPrice || null,
                item.promoPrice || null,
                item.loyaltyPrice || null,
                todayStr,
                Boolean(item.loyaltyCardRequired || item.loyaltyPrice)
              ]
            );
          }
        }

        // Marcare ca publicat în catalog_extracted_offers
        stats.publishedCount++;
        item.stagingStatus = 'PUBLISHED';
        await client.query(
          `UPDATE catalog_extracted_offers SET
            staging_status = 'PUBLISHED',
            matched_product_id = $1,
            updated_at = NOW()
          WHERE id = $2`,
          [canonicalId, item.id]
        );
      }

      stats.durationMs = Date.now() - startTime;

      // 4. Salvare raport complet de sincronizare în catalog_import_runs
      await client.query(
        `UPDATE catalog_import_runs SET
          status = 'completed',
          completed_at = NOW(),
          duration_ms = $1,
          total_raw_extracted = $2,
          published_count = $3,
          new_products_count = $4,
          updated_products_count = $5,
          unchanged_products_count = $6,
          new_offers_count = $7,
          updated_offers_count = $8,
          expired_offers_count = $9,
          changed_prices_count = $10,
          unchanged_prices_count = $11,
          items_without_price_count = $12,
          items_without_offer_count = $13,
          staging_count = $14
        WHERE id = $15`,
        [
          stats.durationMs,
          stats.totalProcessed,
          stats.publishedCount,
          stats.newProductsCount,
          stats.updatedProductsCount,
          stats.unchangedProductsCount,
          stats.newOffersCount,
          stats.updatedOffersCount,
          stats.expiredOffersCount,
          stats.changedPricesCount,
          stats.unchangedPricesCount,
          stats.itemsWithoutPriceCount,
          stats.itemsWithoutOfferCount,
          stats.stagingCount,
          params.runId
        ]
      );

      await client.query('COMMIT');
      return { stats, success: true };
    } catch (err: any) {
      await client.query('ROLLBACK');
      stats.errors.push(err.message || 'Eroare necunoscută la sincronizare incrementală');
      stats.durationMs = Date.now() - startTime;
      return { stats, success: false };
    } finally {
      if (lockAcquired) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext('catalog_sync_' || $1))", [params.retailerId]);
        } catch {}
      }
      client.release();
    }
  }

  /**
   * Înregistrează o acțiune administrativă în tabela admin_audit_logs
   */
  static async logAdminActivity(entry: {
    userEmail: string;
    userId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
  }): Promise<AdminAuditLog> {
    const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const logItem: AdminAuditLog = {
      id,
      userEmail: entry.userEmail,
      userId: entry.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: entry.details || {},
      ipAddress: entry.ipAddress,
      createdAt: new Date().toISOString()
    };

    const pool = getPool();
    if (!pool) return logItem;

    try {
      await pool.query(
        `INSERT INTO admin_audit_logs (id, user_email, user_id, action, target_type, target_id, details, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          logItem.id,
          logItem.userEmail,
          logItem.userId || null,
          logItem.action,
          logItem.targetType,
          logItem.targetId || null,
          JSON.stringify(logItem.details || {}),
          logItem.ipAddress || null
        ]
      );
    } catch (err: any) {
      console.error('Eroare la scrierea logului administrativ:', err.message);
    }

    return logItem;
  }

  /**
   * Returnează istoricul acțiunilor administrative
   */
  static async getAdminAuditLogs(limit = 50, offset = 0): Promise<AdminAuditLog[]> {
    const pool = getPool();
    if (!pool) return [];

    try {
      const res = await pool.query(
        `SELECT id, user_email AS "userEmail", user_id AS "userId", action, target_type AS "targetType",
                target_id AS "targetId", details, ip_address AS "ipAddress", created_at AS "createdAt"
         FROM admin_audit_logs
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return res.rows.map(r => ({
        ...r,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString()
      }));
    } catch (err) {
      return [];
    }
  }

  /**
   * Returnează datele și indicatorii compleți pentru noul Overview & Operational Dashboard
   */
  static async getOperationalMetrics(): Promise<OperationalDashboardData> {
    const pool = getPool();
    const startTime = Date.now();
    let latencyMs = 0;

    // Surse predefinite
    const sources = INITIAL_CATALOG_SOURCES;
    let configuredSourcesCount = sources.length;
    let activeSourcesCount = sources.filter(s => s.status === 'active').length;
    let blockedSourcesCount = sources.filter(s => s.retailerId === 'profi' || s.retailerId === 'metro').length;
    let configuredRetailersCount = 8;
    let activeRetailersCount = 6; // Lidl, Kaufland, Carrefour, PENNY, Auchan, Mega Image

    const fallbackNow = new Date().toISOString();

    if (!pool) {
      return {
        overallStatus: 'EROARE CRITICĂ',
        statusMessage: 'PostgreSQL nu este configurat sau pool-ul nu este disponibil.',
        activeRetailersCount,
        configuredRetailersCount,
        activeSourcesCount,
        configuredSourcesCount,
        blockedSourcesCount,
        runningImportsCount: 0,
        dbStatus: {
          connected: false,
          configured: false,
          persistenceMode: 'demo_memory',
          dbType: 'none',
          message: 'Baza de date PostgreSQL este deconectată.'
        },
        kpis: {
          configuredRetailers: { key: 'configuredRetailers', label: 'Retaileri Configurați', value: 8, period: 'Permanent', updatedAt: fallbackNow, status: 'positive' },
          configuredSources: { key: 'configuredSources', label: 'Surse Configurate', value: configuredSourcesCount, period: 'Permanent', updatedAt: fallbackNow, status: 'positive' },
          activeSources: { key: 'activeSources', label: 'Surse Funcționale', value: activeSourcesCount, period: 'Permanent', updatedAt: fallbackNow, status: 'positive' },
          discoveredDocuments: { key: 'discoveredDocuments', label: 'Documente Descoperite', value: 0, period: 'Total', updatedAt: fallbackNow, status: 'neutral' },
          downloadedDocuments: { key: 'downloadedDocuments', label: 'Documente Descărcate', value: 0, period: 'Total', updatedAt: fallbackNow, status: 'neutral' },
          extractedProducts: { key: 'extractedProducts', label: 'Produse Extrase', value: 0, period: 'Total', updatedAt: fallbackNow, status: 'neutral' },
          distinctProducts: { key: 'distinctProducts', label: 'Produse Distincte', value: 0, period: 'Catalog Public', updatedAt: fallbackNow, status: 'neutral' },
          newProducts: { key: 'newProducts', label: 'Produse Noi', value: 0, period: 'Ultima rulare', updatedAt: fallbackNow, status: 'neutral' },
          updatedProducts: { key: 'updatedProducts', label: 'Produse Actualizate', value: 0, period: 'Ultima rulare', updatedAt: fallbackNow, status: 'neutral' },
          extractedOffers: { key: 'extractedOffers', label: 'Oferte Extrase', value: 0, period: 'Staging', updatedAt: fallbackNow, status: 'neutral' },
          validatedOffers: { key: 'validatedOffers', label: 'Oferte Validate', value: 0, period: 'Staging', updatedAt: fallbackNow, status: 'neutral' },
          approvedOffers: { key: 'approvedOffers', label: 'Oferte Aprobate', value: 0, period: 'Staging', updatedAt: fallbackNow, status: 'neutral' },
          publishedOffers: { key: 'publishedOffers', label: 'Oferte Publicate', value: 0, period: 'Catalog Public', updatedAt: fallbackNow, status: 'neutral' },
          changedPrices: { key: 'changedPrices', label: 'Prețuri Modificate', value: 0, period: 'Istoric', updatedAt: fallbackNow, status: 'neutral' },
          itemsWithoutPrice: { key: 'itemsWithoutPrice', label: 'Produse Fără Preț', value: 0, period: 'Protecție', updatedAt: fallbackNow, status: 'neutral' },
          processingErrors: { key: 'processingErrors', label: 'Erori de Procesare', value: 0, period: 'Total', updatedAt: fallbackNow, status: 'critical' }
        },
        pipelineStages: [
          { stage: 'discovery', name: 'Descoperire', status: 'PARTIAL', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'download', name: 'Descărcare', status: 'PENDING', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'parse', name: 'Parsare', status: 'PENDING', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'validation', name: 'Validare', status: 'PENDING', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'approval', name: 'Aprobare', status: 'PENDING', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'publishing', name: 'Publicare', status: 'PENDING', processedCount: 0, pendingCount: 0, errorCount: 0 }
        ],
        activeAlerts: [
          { id: 'alt-db-down', severity: 'critical', title: 'Conexiune PostgreSQL indisponibilă', message: 'Aplicația rulează în mod limitat în memorie.', targetTab: 'settings', linkActionLabel: 'Verifică Setări Bază Date' }
        ]
      };
    }

    try {
      const countsQuery = await pool.query(`
        SELECT 
          (SELECT count(*) FROM products) AS distinct_products,
          (SELECT count(*) FROM product_offers) AS published_offers,
          (SELECT count(*) FROM price_observations) AS price_observations,
          (SELECT count(*) FROM promotions WHERE ends_at IS NULL OR ends_at >= CURRENT_DATE) AS active_promotions,
          (SELECT count(*) FROM catalog_sources) AS configured_sources,
          (SELECT count(*) FROM catalog_sources WHERE status = 'active') AS active_sources,
          (SELECT count(DISTINCT retailer_id) FROM catalog_sources) AS configured_retailers_count,
          (SELECT count(*) FROM catalog_documents) AS total_documents,
          (SELECT count(*) FROM catalog_documents WHERE download_status = 'downloaded') AS downloaded_documents,
          (SELECT count(*) FROM catalog_extracted_offers) AS total_extracted_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE staging_status = 'VALIDATED') AS validated_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE staging_status = 'NEEDS_REVIEW') AS needs_review_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE staging_status = 'PUBLISHED') AS published_staging_offers,
          (SELECT count(*) FROM catalog_import_errors) AS processing_errors,
          (SELECT count(*) FROM catalog_import_runs WHERE status = 'running' AND started_at > NOW() - interval '15 minutes') AS running_imports,
          (SELECT count(*) FROM catalog_publish_schedules WHERE enabled = true) AS active_schedules,
          (SELECT count(*) FROM catalog_publish_schedules WHERE last_status = 'running' AND updated_at > NOW() - interval '15 minutes') AS running_schedules,
          (SELECT count(*) FROM catalog_publish_schedules WHERE last_status = 'success') AS successful_schedules,
          (SELECT count(*) FROM catalog_publish_schedules WHERE last_status = 'partial') AS partial_schedules,
          (SELECT count(*) FROM catalog_publish_schedules WHERE last_status = 'failed') AS failed_schedules,
          (SELECT count(*) FROM catalog_publish_schedules) AS total_schedules,
          (SELECT min(next_run_at) FROM catalog_publish_schedules WHERE enabled = true AND next_run_at IS NOT NULL) AS next_scheduled_run,
          (SELECT max(last_run_at) FROM catalog_publish_schedules WHERE last_run_at IS NOT NULL) AS last_scheduled_run,
          (SELECT count(*) FROM admin_audit_logs WHERE action IN ('publish_validated_offers', 'scheduler_publish_completed') AND details->>'source' = 'automated_scheduler') AS automated_publishes,
          (SELECT count(*) FROM admin_audit_logs WHERE action = 'publish_validated_offers' AND (details->>'source' IS NULL OR details->>'source' != 'automated_scheduler')) AS manual_publishes
      `);

      latencyMs = Date.now() - startTime;
      const counts = countsQuery.rows[0] || {};

      if (counts.configured_sources) {
        configuredSourcesCount = parseInt(counts.configured_sources, 10);
      }
      if (counts.active_sources) {
        activeSourcesCount = parseInt(counts.active_sources, 10);
      }
      if (counts.configured_retailers_count) {
        configuredRetailersCount = parseInt(counts.configured_retailers_count, 10);
      }

      const runsQuery = await pool.query(`
        SELECT id, retailer_id AS "retailerId", status, started_at AS "startedAt", completed_at AS "completedAt",
               duration_ms AS "durationMs", total_raw_extracted AS "totalRawExtracted",
               published_count AS "publishedCount", new_products_count AS "newProductsCount",
               updated_products_count AS "updatedProductsCount", unchanged_products_count AS "unchangedProductsCount",
               new_offers_count AS "newOffersCount", updated_offers_count AS "updatedOffersCount",
               changed_prices_count AS "changedPricesCount", items_without_price_count AS "itemsWithoutPriceCount",
               errors
        FROM catalog_import_runs
        ORDER BY started_at DESC
        LIMIT 2
      `);

      const lastRun = runsQuery.rows[0] || null;
      const previousRun = runsQuery.rows[1] || null;

      const auditQuery = await pool.query(`
        SELECT id, user_email AS "userEmail", user_id AS "userId", action, target_type AS "targetType",
               target_id AS "targetId", details, ip_address AS "ipAddress", created_at AS "createdAt"
        FROM admin_audit_logs
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const lastAdminActivity = auditQuery.rows[0] ? {
        id: auditQuery.rows[0].id,
        userEmail: auditQuery.rows[0].userEmail,
        userId: auditQuery.rows[0].userId,
        action: auditQuery.rows[0].action,
        targetType: auditQuery.rows[0].targetType,
        targetId: auditQuery.rows[0].targetId,
        details: auditQuery.rows[0].details,
        ipAddress: auditQuery.rows[0].ipAddress,
        createdAt: new Date(auditQuery.rows[0].createdAt).toISOString()
      } : undefined;

      const distinctProducts = parseInt(counts.distinct_products || '0', 10);
      const publishedOffers = parseInt(counts.published_offers || '0', 10);
      const priceObservations = parseInt(counts.price_observations || '0', 10);
      const totalDocuments = parseInt(counts.total_documents || '0', 10);
      const downloadedDocuments = parseInt(counts.downloaded_documents || '0', 10);
      const totalExtractedOffers = parseInt(counts.total_extracted_offers || '0', 10);
      const validatedOffers = parseInt(counts.validated_offers || '0', 10);
      const needsReviewOffers = parseInt(counts.needs_review_offers || '0', 10);
      const publishedStagingOffers = parseInt(counts.published_staging_offers || '0', 10);
      const processingErrors = parseInt(counts.processing_errors || '0', 10);
      const runningImports = parseInt(counts.running_imports || '0', 10);

      // Metrici Scheduler de Publicare din PostgreSQL
      const activeSchedulesCount = parseInt(counts.active_schedules || '0', 10);
      const runningSchedulesCount = parseInt(counts.running_schedules || '0', 10);
      const successfulSchedulesCount = parseInt(counts.successful_schedules || '0', 10);
      const partialSchedulesCount = parseInt(counts.partial_schedules || '0', 10);
      const failedSchedulesCount = parseInt(counts.failed_schedules || '0', 10);
      const totalSchedulesCount = parseInt(counts.total_schedules || '0', 10);
      const nextScheduledRunAt = counts.next_scheduled_run ? new Date(counts.next_scheduled_run).toISOString() : undefined;
      const lastScheduledRunAt = counts.last_scheduled_run ? new Date(counts.last_scheduled_run).toISOString() : undefined;
      const automatedPublishCount = parseInt(counts.automated_publishes || '0', 10);
      const manualPublishCount = parseInt(counts.manual_publishes || '0', 10);

      // Determinare status general
      let overallStatus: OperationalDashboardData['overallStatus'] = 'TOTUL FUNCȚIONEAZĂ';
      let statusMessage = 'Toate serviciile și sursele prioritare de producție funcționează optim.';

      if (runningImports > 0) {
        overallStatus = 'IMPORT ÎN DESFĂȘURARE';
        statusMessage = `Există ${runningImports} import(uri) active în procesare concurențială.`;
      } else if (processingErrors > 0 && lastRun?.status === 'failed') {
        overallStatus = 'NECESITĂ ATENȚIE';
        statusMessage = `Au fost identificate ${processingErrors} erori de procesare ce necesită investigare.`;
      } else if (blockedSourcesCount > 0) {
        overallStatus = 'SISTEM PARȚIAL DISPONIBIL';
        statusMessage = `${activeRetailersCount} din 8 retaileri sunt complet operaționali. Profi și Metro sunt marcate BLOCKED (protecții WAF/Bot).`;
      }

      const activeAlerts: OperationalDashboardData['activeAlerts'] = [];
      if (needsReviewOffers > 0) {
        activeAlerts.push({
          id: 'alt-review',
          severity: 'warning',
          title: `${needsReviewOffers} oferte în așteptare de validare`,
          message: 'Există oferte extrase în Staging Queue care necesită verificare înainte de publicare.',
          targetTab: 'staging',
          linkActionLabel: 'Vezi Staging Queue'
        });
      }
      if (processingErrors > 0) {
        activeAlerts.push({
          id: 'alt-errors',
          severity: 'warning',
          title: `${processingErrors} erori înregistrate în jurnal`,
          message: 'Verificați secțiunea Jurnal și Erori pentru detalii și opțiuni de retry.',
          targetTab: 'logs',
          linkActionLabel: 'Vezi Jurnal Erori'
        });
      }
      if (blockedSourcesCount > 0) {
        activeAlerts.push({
          id: 'alt-blocked',
          severity: 'info',
          title: 'Surse externe cu acces restricționat',
          message: 'Profi (Cloudflare WAF 403) și METRO (Akamai Bot Sensor) sunt izolate conform eticii civice.',
          targetTab: 'retailers',
          linkActionLabel: 'Vezi Retaileri & Surse'
        });
      }

      const lastRunAt = lastRun?.startedAt ? new Date(lastRun.startedAt).toISOString() : fallbackNow;

      return {
        overallStatus,
        statusMessage,
        activeRetailersCount,
        configuredRetailersCount,
        activeSourcesCount,
        configuredSourcesCount,
        blockedSourcesCount,
        runningImportsCount: runningImports,
        lastSuccessfulSync: lastRun?.completedAt ? new Date(lastRun.completedAt).toISOString() : undefined,
        nextScheduledSync: 'Zilnic la 04:00 (Europe/Bucharest)',
        dbStatus: {
          connected: true,
          configured: true,
          persistenceMode: 'postgresql',
          dbType: 'supabase',
          message: `Conectat cu succes la PostgreSQL Supabase (${latencyMs}ms)`,
          latencyMs
        },
        lastAdminActivity,
        kpis: {
          configuredRetailers: {
            key: 'configuredRetailers',
            label: 'Retaileri Configurați',
            value: 8,
            period: 'Permanent',
            updatedAt: lastRunAt,
            status: 'positive',
            details: 'Lidl, Kaufland, Carrefour, PENNY, Auchan, Profi, Mega Image, METRO'
          },
          configuredSources: {
            key: 'configuredSources',
            label: 'Surse Configurate',
            value: configuredSourcesCount,
            period: 'Permanent',
            updatedAt: lastRunAt,
            status: 'positive',
            details: 'Surse oficiale HTML, PDF, Publitas și VTEX'
          },
          activeSources: {
            key: 'activeSources',
            label: 'Surse Funcționale',
            value: activeSourcesCount,
            period: 'Permanent',
            updatedAt: lastRunAt,
            status: 'positive',
            details: `${activeSourcesCount} din ${configuredSourcesCount} surse sunt active`
          },
          discoveredDocuments: {
            key: 'discoveredDocuments',
            label: 'Documente Descoperite',
            value: totalDocuments,
            period: 'Total indexat',
            updatedAt: lastRunAt,
            status: 'neutral'
          },
          downloadedDocuments: {
            key: 'downloadedDocuments',
            label: 'Documente Descărcate',
            value: downloadedDocuments,
            period: 'Total indexat',
            updatedAt: lastRunAt,
            status: 'positive'
          },
          extractedProducts: {
            key: 'extractedProducts',
            label: 'Produse Extrase',
            value: totalExtractedOffers,
            period: 'Pipeline & Staging',
            updatedAt: lastRunAt,
            status: 'neutral'
          },
          distinctProducts: {
            key: 'distinctProducts',
            label: 'Produse Distincte',
            value: distinctProducts,
            period: 'Tabelă canonicală products',
            updatedAt: lastRunAt,
            previousValue: previousRun?.newProductsCount ? distinctProducts - (lastRun?.newProductsCount || 0) : undefined,
            delta: lastRun?.newProductsCount || 0,
            status: 'positive',
            details: 'Produse unificate cu EAN sau identificator canonic'
          },
          newProducts: {
            key: 'newProducts',
            label: 'Produse Noi',
            value: lastRun?.newProductsCount || 0,
            period: 'Ultima rulare de import',
            updatedAt: lastRunAt,
            status: (lastRun?.newProductsCount || 0) > 0 ? 'positive' : 'neutral'
          },
          updatedProducts: {
            key: 'updatedProducts',
            label: 'Produse Actualizate',
            value: lastRun?.updatedProductsCount || 0,
            period: 'Ultima rulare de import',
            updatedAt: lastRunAt,
            status: 'neutral'
          },
          extractedOffers: {
            key: 'extractedOffers',
            label: 'Oferte Extrase',
            value: totalExtractedOffers,
            period: 'Staging catalog_extracted_offers',
            updatedAt: lastRunAt,
            status: 'neutral'
          },
          validatedOffers: {
            key: 'validatedOffers',
            label: 'Oferte Validate',
            value: validatedOffers,
            period: 'Gata de publicare în staging',
            updatedAt: lastRunAt,
            status: validatedOffers > 0 ? 'positive' : 'neutral'
          },
          approvedOffers: {
            key: 'approvedOffers',
            label: 'Oferte Aprobate',
            value: validatedOffers + publishedStagingOffers,
            period: 'Staging Queue',
            updatedAt: lastRunAt,
            status: 'positive'
          },
          publishedOffers: {
            key: 'publishedOffers',
            label: 'Oferte Publicate',
            value: publishedOffers,
            period: 'Catalog public (product_offers)',
            updatedAt: lastRunAt,
            status: 'positive',
            details: 'Oferte active vizibile în comparație prețuri'
          },
          changedPrices: {
            key: 'changedPrices',
            label: 'Prețuri Modificate',
            value: lastRun?.changedPricesCount || priceObservations,
            period: 'price_observations',
            updatedAt: lastRunAt,
            status: 'neutral'
          },
          itemsWithoutPrice: {
            key: 'itemsWithoutPrice',
            label: 'Produse Fără Preț',
            value: lastRun?.itemsWithoutPriceCount || 0,
            period: 'Izolate la import (preț 0/nul)',
            updatedAt: lastRunAt,
            status: (lastRun?.itemsWithoutPriceCount || 0) > 0 ? 'warning' : 'positive'
          },
          processingErrors: {
            key: 'processingErrors',
            label: 'Erori de Procesare',
            value: processingErrors,
            period: 'Tabelă catalog_import_errors',
            updatedAt: lastRunAt,
            status: processingErrors > 0 ? 'warning' : 'positive'
          }
        },
        pipelineStages: [
          {
            stage: 'discovery',
            name: '1. Descoperire',
            status: totalDocuments > 0 ? 'PASS' : 'PENDING',
            processedCount: totalDocuments,
            pendingCount: 0,
            errorCount: 0,
            lastExecutedAt: lastRunAt
          },
          {
            stage: 'download',
            name: '2. Descărcare',
            status: downloadedDocuments > 0 ? 'PASS' : 'PENDING',
            processedCount: downloadedDocuments,
            pendingCount: Math.max(0, totalDocuments - downloadedDocuments),
            errorCount: 0,
            lastExecutedAt: lastRunAt
          },
          {
            stage: 'parse',
            name: '3. Parsare',
            status: totalExtractedOffers > 0 ? 'PASS' : 'PENDING',
            processedCount: totalExtractedOffers,
            pendingCount: 0,
            errorCount: 0,
            lastExecutedAt: lastRunAt
          },
          {
            stage: 'validation',
            name: '4. Validare',
            status: validatedOffers > 0 || needsReviewOffers > 0 ? 'PASS' : 'PENDING',
            processedCount: validatedOffers,
            pendingCount: needsReviewOffers,
            errorCount: processingErrors,
            lastExecutedAt: lastRunAt
          },
          {
            stage: 'approval',
            name: '5. Aprobare',
            status: validatedOffers > 0 ? 'PASS' : 'PENDING',
            processedCount: validatedOffers,
            pendingCount: needsReviewOffers,
            errorCount: 0,
            lastExecutedAt: lastRunAt
          },
          {
            stage: 'publishing',
            name: '6. Publicare',
            status: publishedOffers > 0 ? 'PASS' : 'PENDING',
            processedCount: publishedOffers,
            pendingCount: validatedOffers,
            errorCount: 0,
            lastExecutedAt: lastRunAt
          }
        ],
        activeAlerts,
        scheduler: {
          activeSchedulesCount,
          runningSchedulesCount,
          successfulSchedulesCount,
          partialSchedulesCount,
          failedSchedulesCount,
          totalSchedulesCount,
          nextScheduledRunAt,
          lastScheduledRunAt,
          manualPublishCount,
          automatedPublishCount
        }
      };
    } catch (err: any) {
      console.error('Eroare getOperationalMetrics:', err);
      return {
        overallStatus: 'EROARE CRITICĂ',
        statusMessage: `Eroare interogare metrici: ${err.message}`,
        activeRetailersCount: 6,
        configuredRetailersCount: 8,
        activeSourcesCount: 9,
        configuredSourcesCount: 11,
        blockedSourcesCount: 2,
        runningImportsCount: 0,
        dbStatus: {
          connected: false,
          configured: true,
          persistenceMode: 'postgresql',
          dbType: 'supabase',
          message: err.message
        },
        kpis: {} as any,
        pipelineStages: [],
        activeAlerts: [
          { id: 'err-query', severity: 'critical', title: 'Eroare interogare PostgreSQL', message: err.message, targetTab: 'logs' }
        ]
      };
    }
  }

  /**
   * Returnează produsele canonice cu detalii de agregare (paginare, căutare, categorii)
   */
  /**
   * Returnează produsele canonice cu detalii de agregare (paginare, căutare, categorii, retaileri)
   */
  static async getProductsDetailed(params: {
    limit: number;
    offset: number;
    search?: string;
    category?: string;
    retailer?: string;
  }): Promise<{ products: any[]; total: number }> {
    const pool = getPool();
    if (!pool) {
      let all = await this.getProducts();
      if (params.search && params.search.trim()) {
        const q = params.search.toLowerCase().trim();
        all = all.filter(p =>
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.brand && p.brand.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.includes(q))
        );
      }
      if (params.category && params.category !== 'toate') {
        all = all.filter(p => p.category === params.category);
      }
      if (params.retailer && params.retailer !== 'toate') {
        const cleanRet = params.retailer.trim().toLowerCase().replace(/^store-/, '');
        const offers: ProductOffer[] = await this.getOffers();
        const matchingIds = new Set(
          offers
            .filter((o: ProductOffer) => (o.storeId || '').toLowerCase().replace(/^store-/, '') === cleanRet)
            .map((o: ProductOffer) => o.productId)
        );
        all = all.filter(p => matchingIds.has(p.id));
      }
      return { products: all.slice(params.offset, params.offset + params.limit), total: all.length };
    }

    try {
      const conditions: string[] = ['p.canonical_product_id IS NULL'];
      const values: any[] = [];
      let idx = 1;

      if (params.search && params.search.trim()) {
        conditions.push(`(p.name ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      if (params.category && params.category !== 'toate') {
        conditions.push(`p.category = $${idx}`);
        values.push(params.category);
        idx++;
      }

      if (params.retailer && params.retailer !== 'toate') {
        const cleanRet = params.retailer.trim().toLowerCase().replace(/^store-/, '');
        conditions.push(`EXISTS (
          SELECT 1 FROM product_offers po_ret
          WHERE (po_ret.product_id = p.id OR po_ret.product_id IN (SELECT alias.id FROM products alias WHERE alias.canonical_product_id = p.id))
            AND (lower(po_ret.store_id) = $${idx} OR lower(po_ret.store_id) = ('store-' || $${idx}) OR replace(lower(po_ret.store_id), 'store-', '') = $${idx})
        )`);
        values.push(cleanRet);
        idx++;
      }

      const whereClause = conditions.join(' AND ');

      const countRes = await pool.query(`SELECT count(*) FROM products p WHERE ${whereClause}`, values);
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const limitIdx = idx;
      values.push(params.limit);
      const offsetIdx = idx + 1;
      values.push(params.offset);

      const query = `
        SELECT 
          p.id, p.name, p.brand, p.category, p.default_unit AS "defaultUnit",
          p.package_weight_or_volume AS "packageWeightOrVolume", p.package_unit AS "packageUnit",
          p.normalized_unit AS "normalizedUnit", p.barcode, p.image_url AS "imageUrl",
          p.is_bio AS "isBio", p.is_romanian_product AS "isRomanianProduct",
          p.base_reference_price AS "baseReferencePrice",
          p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  (SELECT count(*) FROM (
  SELECT DISTINCT ON (po.store_id) po.store_id
  FROM product_offers po
  WHERE po.product_id = p.id OR po.product_id IN (SELECT alias.id FROM products alias WHERE alias.canonical_product_id = p.id)
  ORDER BY po.store_id, po.observation_date DESC, po.last_checked DESC
  ) current_offers) AS "offersCount",
  (SELECT min(current_offers.price) FROM (
  SELECT DISTINCT ON (po.store_id) po.store_id, po.price
  FROM product_offers po
  WHERE po.product_id = p.id OR po.product_id IN (SELECT alias.id FROM products alias WHERE alias.canonical_product_id = p.id)
  ORDER BY po.store_id, po.observation_date DESC, po.last_checked DESC
  ) current_offers) AS "minPrice",
  (SELECT max(current_offers.price) FROM (
  SELECT DISTINCT ON (po.store_id) po.store_id, po.price
  FROM product_offers po
  WHERE po.product_id = p.id OR po.product_id IN (SELECT alias.id FROM products alias WHERE alias.canonical_product_id = p.id)
  ORDER BY po.store_id, po.observation_date DESC, po.last_checked DESC
  ) current_offers) AS "maxPrice",
  (SELECT json_agg(json_build_object('storeId', current_offers.store_id, 'price', current_offers.price, 'isPromo', current_offers.is_promo, 'normalPrice', current_offers.normal_price, 'promoPrice', current_offers.promo_price, 'loyaltyPrice', current_offers.loyalty_price))
  FROM (
  SELECT DISTINCT ON (po.store_id) po.store_id, po.price, po.is_promo, po.normal_price, po.promo_price, po.loyalty_price
  FROM product_offers po
  WHERE po.product_id = p.id OR po.product_id IN (SELECT alias.id FROM products alias WHERE alias.canonical_product_id = p.id)
  ORDER BY po.store_id, po.observation_date DESC, po.last_checked DESC
  ) current_offers) AS "offers"
        FROM products p
        WHERE ${whereClause}
        ORDER BY p.updated_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const res = await pool.query(query, values);
      return { products: res.rows, total };
    } catch (err: any) {
      console.error('Eroare getProductsDetailed:', err.message);
      return { products: [], total: 0 };
    }
  }

  /**
   * Ștergere / delistare produse (individual sau în calup) cu ștergere în cascadă
   */
  static async deleteProducts(productIds: string[]): Promise<{ deletedCount: number }> {
    if (!productIds || productIds.length === 0) return { deletedCount: 0 };

    const pool = getPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Găsim toate ID-urile (inclusiv aliasuri canonice)
        const allIdsRes = await client.query(
          `SELECT id FROM products WHERE id = ANY($1) OR canonical_product_id = ANY($1)`,
          [productIds]
        );
        const targetIds = Array.from(new Set([...productIds, ...allIdsRes.rows.map(r => r.id)]));

        // Ștergere date corelate
        await client.query(`DELETE FROM price_observations WHERE product_id = ANY($1)`, [targetIds]);
        await client.query(`DELETE FROM product_offers WHERE product_id = ANY($1)`, [targetIds]);
        await client.query(`DELETE FROM promotions WHERE product_id = ANY($1)`, [targetIds]);
        await client.query(`DELETE FROM retailer_products WHERE product_id = ANY($1)`, [targetIds]);
        await client.query(`DELETE FROM product_match_candidates WHERE target_product_id = ANY($1)`, [targetIds]);

        // Ștergere aliasuri și apoi produse principale
        await client.query(`DELETE FROM products WHERE canonical_product_id = ANY($1)`, [productIds]);
        const delRes = await client.query(`DELETE FROM products WHERE id = ANY($1)`, [productIds]);

        await client.query('COMMIT');
        return { deletedCount: delRes.rowCount || productIds.length };
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('Eroare la ștergerea produselor din PostgreSQL:', err.message);
      } finally {
        client.release();
      }
    }

    // Fallback Supabase
    try {
      await supabase.from('price_observations').delete().in('product_id', productIds);
      await supabase.from('product_offers').delete().in('product_id', productIds);
      await supabase.from('promotions').delete().in('product_id', productIds);
      await supabase.from('products').delete().in('canonical_product_id', productIds);
      const { data } = await supabase.from('products').delete().in('id', productIds).select('id');
      return { deletedCount: data?.length || productIds.length };
    } catch (err: any) {
      console.warn('Eroare Supabase deleteProducts:', err.message);
    }

    return { deletedCount: productIds.length };
  }

  static async deleteProduct(productId: string): Promise<boolean> {
    const res = await this.deleteProducts([productId]);
    return res.deletedCount > 0;
  }

  /**
   * Returnează datele complete pentru un produs canonic (istoric, oferte, mapări retailer)
   */
  static async getProductDetailById(productId: string): Promise<any> {
    const pool = getPool();
    if (pool) {
      try {
  const prodRes = await pool.query(
  'SELECT * FROM products WHERE id = COALESCE((SELECT canonical_product_id FROM products WHERE id = $1), $1)',
  [productId]
  );
  if (prodRes.rows.length > 0) {
  const product = prodRes.rows[0];
  const canonicalProductId = product.id;

  const offersRes = await pool.query(`
  SELECT DISTINCT ON (po.store_id) po.*, s.name AS store_name, s.brand_color AS store_brand_color, s.logo_url AS store_logo_url
  FROM product_offers po
  LEFT JOIN stores s ON s.id = po.store_id
  WHERE po.product_id = $1 OR po.product_id IN (SELECT id FROM products WHERE canonical_product_id = $1)
  ORDER BY po.store_id, po.observation_date DESC, po.last_checked DESC
  `, [canonicalProductId]);

  const historyRes = await pool.query(`
  SELECT * FROM price_observations
  WHERE product_id = $1 OR product_id IN (SELECT id FROM products WHERE canonical_product_id = $1)
  ORDER BY date DESC, created_at DESC
  LIMIT 50
  `, [canonicalProductId]);

  const retailerMappingRes = await pool.query(`
  SELECT * FROM retailer_products
  WHERE product_id = $1 OR product_id IN (SELECT id FROM products WHERE canonical_product_id = $1)
  `, [canonicalProductId]);

  const promosRes = await pool.query(`
  SELECT * FROM promotions
  WHERE product_id = $1 OR product_id IN (SELECT id FROM products WHERE canonical_product_id = $1)
  ORDER BY ends_at DESC NULLS LAST
  `, [canonicalProductId]);

          return {
            product: {
              id: product.id,
              name: product.name,
              brand: product.brand,
              category: product.category,
              defaultUnit: product.default_unit || 'buc',
              packageWeightOrVolume: parseFloat(product.package_weight_or_volume) || 1,
              packageUnit: product.package_unit || 'buc',
              normalizedUnit: product.normalized_unit || 'buc',
              barcode: product.barcode || undefined,
              imageUrl: product.image_url || undefined,
              isBio: Boolean(product.is_bio),
              isRomanianProduct: Boolean(product.is_romanian_product),
              baseReferencePrice: parseFloat(product.base_reference_price) || 0
            },
            offers: offersRes.rows.map(r => ({
              id: r.id,
              productId: r.product_id,
              storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
              price: parseFloat(r.price),
              originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
              unitPrice: parseFloat(r.unit_price) || parseFloat(r.price),
              unitPriceMeasure: r.unit_price_measure || 'lei/buc',
              isPromo: Boolean(r.is_promo),
              promoDetails: r.promo_details || undefined,
              loyaltyCardRequired: Boolean(r.loyalty_card_required),
              loyaltyCardName: r.loyalty_card_name || undefined,
              validUntil: r.valid_until ? (r.valid_until.toISOString?.().split('T')[0] || String(r.valid_until).slice(0, 10)) : undefined,
              observationDate: r.observation_date ? (r.observation_date.toISOString?.().split('T')[0] || String(r.observation_date).slice(0, 10)) : new Date().toISOString().split('T')[0],
              source: r.source || 'verified',
              confidenceLevel: r.confidence_level || 'high',
              verificationStatus: r.verification_status || 'verified',
              lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
              isSponsored: Boolean(r.is_sponsored)
            })),
  priceHistory: historyRes.rows.map(h => ({
  id: h.id,
  productId: canonicalProductId,
              storeId: h.store_id ? h.store_id.replace(/^store-/, '') : '',
              price: parseFloat(h.price),
              date: h.date ? (h.date.toISOString?.().split('T')[0] || String(h.date).slice(0, 10)) : '',
              source: h.source || 'verified'
            })),
            retailerMappings: retailerMappingRes.rows,
            promotions: promosRes.rows
          };
        }
      } catch (err: any) {
        console.warn('Postgres pool getProductDetailById failed, falling back to Supabase:', err.message);
      }
    }

    try {
      let { data: prodData, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .maybeSingle();

      if (prodErr || !prodData) {
        return null;
      }

      if (prodData.canonical_product_id) {
        const canonicalResult = await supabase
          .from('products')
          .select('*')
          .eq('id', prodData.canonical_product_id)
          .maybeSingle();
        prodData = canonicalResult.data;
      }

      if (!prodData) return null;
      const { data: aliases } = await supabase
        .from('products')
        .select('id')
        .eq('canonical_product_id', prodData.id);
      const linkedProductIds = [prodData.id, ...(aliases || []).map(alias => alias.id)];

      const product: Product = {
        id: prodData.id,
        name: prodData.name,
        brand: prodData.brand,
        category: prodData.category,
        defaultUnit: prodData.default_unit || 'buc',
        packageWeightOrVolume: parseFloat(prodData.package_weight_or_volume) || 1,
        packageUnit: prodData.package_unit || 'buc',
        normalizedUnit: prodData.normalized_unit || 'buc',
        barcode: prodData.barcode || undefined,
        imageUrl: prodData.image_url || undefined,
        isBio: Boolean(prodData.is_bio),
        isRomanianProduct: Boolean(prodData.is_romanian_product),
        baseReferencePrice: parseFloat(prodData.base_reference_price) || 0
      };

      const { data: offersData } = await supabase
        .from('product_offers')
        .select('*')
        .in('product_id', linkedProductIds)
        .neq('source', 'demo')
        .neq('verification_status', 'demo')
        .order('observation_date', { ascending: true })
        .order('last_checked', { ascending: true });

      const { data: historyData } = await supabase
        .from('price_observations')
        .select('*')
        .in('product_id', linkedProductIds)
        .order('date', { ascending: false })
        .limit(50);

      const offers: ProductOffer[] = latestCanonicalOffers((offersData || []).map(r => ({
        id: r.id,
        productId: product.id,
        storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
        sourceId: r.source_id || undefined,
        price: parseFloat(r.price),
        originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
        unitPrice: parseFloat(r.unit_price) || parseFloat(r.price),
        unitPriceMeasure: r.unit_price_measure || 'lei/buc',
        isPromo: Boolean(r.is_promo),
        promoDetails: r.promo_details || undefined,
        loyaltyCardRequired: Boolean(r.loyalty_card_required),
        loyaltyCardName: r.loyalty_card_name || undefined,
        validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : undefined,
        observationDate: r.observation_date ? String(r.observation_date).slice(0, 10) : new Date().toISOString().split('T')[0],
        source: r.source || 'verified',
        confidenceLevel: r.confidence_level || 'high',
        verificationStatus: r.verification_status || 'verified',
        lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
        isSponsored: Boolean(r.is_sponsored)
      })));

      const priceHistory: PriceObservation[] = (historyData || []).map(h => ({
        id: h.id,
        productId: product.id,
        storeId: h.store_id ? h.store_id.replace(/^store-/, '') : '',
        sourceId: h.source_id || undefined,
        price: parseFloat(h.price),
        date: h.date ? String(h.date).slice(0, 10) : '',
        receiptId: h.receipt_id || undefined,
        loyaltyCardUsed: Boolean(h.loyalty_card_used),
        source: h.source || 'verified'
      }));

      return {
        product,
        offers,
        priceHistory,
        retailerMappings: [],
        promotions: []
      };
    } catch (err: any) {
      console.error('Eroare Supabase getProductDetailById:', err.message);
      return null;
    }
  }
  /**
   * Returnează documentele descărcate cu paginare, căutare și filtrare reală PostgreSQL
   */
  static async getCatalogDocumentsDetailed(params: {
    limit?: number;
    offset?: number;
    retailerId?: string;
    downloadStatus?: string;
    parseStatus?: string;
    search?: string;
  }): Promise<{ documents: any[]; total: number }> {
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const offset = Math.max(0, params.offset || 0);
    const pool = getPool();

    if (!pool) {
      try {
        let query = supabase.from('catalog_documents').select('*', { count: 'exact' });
        if (params.retailerId && params.retailerId !== 'toate') query = query.eq('retailer_id', params.retailerId);
        if (params.downloadStatus && params.downloadStatus !== 'toate') query = query.eq('download_status', params.downloadStatus);
        if (params.parseStatus && params.parseStatus !== 'toate') query = query.eq('parse_status', params.parseStatus);
        if (params.search && params.search.trim()) query = query.ilike('title', `%${params.search.trim()}%`);
        const { data, count, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        if (!error && data) {
          return { documents: data, total: count || data.length };
        }
      } catch {}
      return { documents: [], total: 0 };
    }

    try {
      const conditions: string[] = ['1=1'];
      const values: any[] = [];
      let idx = 1;

      if (params.retailerId && params.retailerId !== 'toate') {
        conditions.push(`d.retailer_id = $${idx}`);
        values.push(params.retailerId);
        idx++;
      }
      if (params.downloadStatus && params.downloadStatus !== 'toate') {
        conditions.push(`d.download_status = $${idx}`);
        values.push(params.downloadStatus);
        idx++;
      }
      if (params.parseStatus && params.parseStatus !== 'toate') {
        conditions.push(`d.parse_status = $${idx}`);
        values.push(params.parseStatus);
        idx++;
      }
      if (params.search && params.search.trim()) {
        conditions.push(`(d.title ILIKE $${idx} OR d.id ILIKE $${idx} OR d.retailer_id ILIKE $${idx} OR d.document_url ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      const whereClause = conditions.join(' AND ');
      const countRes = await pool.query(`SELECT count(*) FROM catalog_documents d WHERE ${whereClause}`, values);
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `SELECT 
           d.id,
           d.source_id AS "sourceId",
           d.retailer_id AS "retailerId",
           COALESCE(s.name, d.retailer_id) AS "retailerName",
           COALESCE(cs.name, d.source_id) AS "sourceName",
           d.document_url AS "documentUrl",
           d.title,
           d.format,
           d.valid_from AS "validFrom",
           d.valid_until AS "validUntil",
           d.file_size_bytes AS "fileSizeBytes",
           COALESCE(d.checksum, (d as any).sha256_checksum) AS "checksum",
           d.download_status AS "downloadStatus",
           d.download_path AS "downloadPath",
           d.download_duration_ms AS "downloadDurationMs",
           d.parse_status AS "parseStatus",
           d.raw_extracted_count AS "rawExtractedCount",
           d.matched_count AS "matchedCount",
           d.validated_count AS "validatedCount",
           d.published_count AS "publishedCount",
           d.ocr_confidence AS "ocrConfidence",
           d.error_message AS "errorMessage",
           d.created_at AS "createdAt",
           d.updated_at AS "updatedAt"
         FROM catalog_documents d
         LEFT JOIN stores s ON s.id = d.retailer_id
         LEFT JOIN catalog_sources cs ON cs.id = d.source_id
         WHERE ${whereClause}
         ORDER BY d.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        queryValues
      );

      const documents = dataRes.rows.map(r => ({
        id: r.id,
        sourceId: r.sourceId,
        retailerId: r.retailerId,
        retailerName: r.retailerName,
        sourceName: r.sourceName,
        documentUrl: r.documentUrl,
        title: r.title,
        format: r.format,
        validFrom: r.validFrom ? String(r.validFrom).slice(0, 10) : undefined,
        validUntil: r.validUntil ? String(r.validUntil).slice(0, 10) : undefined,
        fileSizeBytes: r.fileSizeBytes ? parseInt(r.fileSizeBytes, 10) : undefined,
        checksum: r.checksum || undefined,
        downloadStatus: r.downloadStatus || 'downloaded',
        downloadPath: r.downloadPath || undefined,
        downloadDurationMs: r.downloadDurationMs || undefined,
        parseStatus: r.parseStatus || 'parsed',
        rawExtractedCount: parseInt(r.rawExtractedCount || '0', 10),
        matchedCount: parseInt(r.matchedCount || '0', 10),
        validatedCount: parseInt(r.validatedCount || '0', 10),
        publishedCount: parseInt(r.publishedCount || '0', 10),
        ocrConfidence: r.ocrConfidence ? parseFloat(r.ocrConfidence) : undefined,
        errorMessage: r.errorMessage || undefined,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString()
      }));

      return { documents, total };
    } catch (err: any) {
      console.error('Eroare getCatalogDocumentsDetailed:', err.message);
      return { documents: [], total: 0 };
    }
  }

  /**
   * Paginare reală, filtrare și numărare statusuri pentru Coada de Staging din PostgreSQL
   */
  static async getStagingOffersPaginated(params: {
    page?: number;
    limit?: number;
    status?: string;
    retailerId?: string;
    search?: string;
    filterType?: string;
    documentId?: string;
  }): Promise<{
    offers: CatalogExtractedOffer[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    statusCounts: Record<string, number>;
  }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const offset = (page - 1) * limit;
    const pool = getPool();

    // Mapare sigură rând din PostgreSQL în CatalogExtractedOffer
    const mapStagingRow = (r: any): CatalogExtractedOffer => {
      const toIso = (v: unknown) => v ? new Date(v as string | number | Date).toISOString() : undefined;
      return {
        id: String(r.id),
        runId: r.run_id || undefined,
        documentId: r.document_id || undefined,
        retailerId: r.retailer_id,
        rawTitle: r.raw_title || 'Produs fără denumire',
        rawBrand: r.raw_brand || undefined,
        rawBarcode: r.raw_barcode || undefined,
        rawCategory: r.raw_category || undefined,
        normalPrice: parseFloat(r.normal_price) || 0,
        promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
        loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
        effectivePrice: parseFloat(r.effective_price) || 0,
        currency: r.currency || 'RON',
        packageQuantity: r.package_quantity ? parseFloat(r.package_quantity) : undefined,
        packageUnit: r.package_unit || undefined,
        unitPrice: r.unit_price ? parseFloat(r.unit_price) : undefined,
        unitPriceMeasure: r.unit_price_measure || undefined,
        isPromo: Boolean(r.is_promo),
        promoDetails: r.promo_details || undefined,
        loyaltyCardRequired: Boolean(r.loyalty_card_required),
        loyaltyCardName: r.loyalty_card_name || undefined,
        validFrom: toIso(r.valid_from)?.split('T')[0],
        validUntil: toIso(r.valid_until)?.split('T')[0],
        matchedProductId: r.matched_product_id || undefined,
        matchedProductName: r.matched_product_name || r.canonical_name || undefined,
        matchConfidence: parseFloat(r.match_confidence || '0'),
        matchMethod: r.match_method || 'unmatched',
        stagingStatus: String(r.staging_status || 'NEEDS_REVIEW').toUpperCase() as any,
        validationErrors: Array.isArray(r.validation_errors)
          ? r.validation_errors
          : (typeof r.validation_errors === 'string'
              ? (r.validation_errors.startsWith('[') ? JSON.parse(r.validation_errors) : [r.validation_errors])
              : undefined),
        reviewedBy: r.reviewed_by || undefined,
        reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
        rejectionReason: r.rejection_reason || undefined,
        createdAt: toIso(r.created_at) || new Date(0).toISOString(),
        updatedAt: toIso(r.updated_at) || toIso(r.created_at) || new Date(0).toISOString()
      };
    };

    if (!pool) {
      try {
        let query = supabase.from('catalog_extracted_offers').select('*', { count: 'exact' });
        if (params.status && params.status !== 'toate') {
          const targetStatus = params.status.toUpperCase();
          if (targetStatus === 'NEEDS_REVIEW' || targetStatus === 'ALL_PENDING') {
            query = query.in('staging_status', ['NEEDS_REVIEW', 'DISCOVERED', 'PARSED', 'needs_review']);
          } else {
            query = query.eq('staging_status', targetStatus);
          }
        }
        if (params.retailerId && params.retailerId !== 'toate') query = query.eq('retailer_id', params.retailerId);
        if (params.documentId && params.documentId !== 'toate') query = query.eq('document_id', params.documentId);
        if (params.search && params.search.trim()) query = query.ilike('raw_title', `%${params.search.trim()}%`);
        const { data, count, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        if (!error && data) {
          const offers = data.map(mapStagingRow);
          return {
            offers,
            total: count || offers.length,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil((count || offers.length) / limit)),
            statusCounts: {
              NEEDS_REVIEW: count || offers.length,
              VALIDATED: 0,
              APPROVED: 0,
              PUBLISHED: 0,
              REJECTED: 0,
              NO_PRICE: 0,
              ALL: count || offers.length
            }
          };
        }
      } catch {}

      return {
        offers: [],
        total: 0,
        page,
        limit,
        totalPages: 1,
        statusCounts: {
          NEEDS_REVIEW: 0,
          VALIDATED: 0,
          APPROVED: 0,
          PUBLISHED: 0,
          REJECTED: 0,
          NO_PRICE: 0,
          ALL: 0
        }
      };
    }

    try {
      // 1. Obținere status counts într-o singură interogare agregată rapidă
      const countsQuery = await pool.query(`
        SELECT 
          count(*) AS total,
          count(*) FILTER (WHERE UPPER(COALESCE(staging_status, 'NEEDS_REVIEW')) IN ('NEEDS_REVIEW', 'DISCOVERED', 'PARSED')) AS needs_review_count,
          count(*) FILTER (WHERE UPPER(staging_status) = 'VALIDATED') AS validated_count,
          count(*) FILTER (WHERE UPPER(staging_status) = 'APPROVED') AS approved_count,
          count(*) FILTER (WHERE UPPER(staging_status) = 'PUBLISHED') AS published_count,
          count(*) FILTER (WHERE UPPER(staging_status) = 'REJECTED') AS rejected_count,
          count(*) FILTER (WHERE effective_price IS NULL OR effective_price <= 0) AS no_price_count
        FROM catalog_extracted_offers
      `);
      const rowCounts = countsQuery.rows[0] || {};
      const statusCounts: Record<string, number> = {
        NEEDS_REVIEW: parseInt(rowCounts.needs_review_count || '0', 10),
        VALIDATED: parseInt(rowCounts.validated_count || '0', 10),
        APPROVED: parseInt(rowCounts.approved_count || '0', 10),
        PUBLISHED: parseInt(rowCounts.published_count || '0', 10),
        REJECTED: parseInt(rowCounts.rejected_count || '0', 10),
        NO_PRICE: parseInt(rowCounts.no_price_count || '0', 10),
        ALL: parseInt(rowCounts.total || '0', 10)
      };

      // 2. Construire clauză WHERE parametrizată pentru căutare și filtrare
      const conditions: string[] = ['1=1'];
      const values: any[] = [];
      let idx = 1;

      if (params.status && params.status !== 'toate') {
        const targetStatus = params.status.toUpperCase();
        if (targetStatus === 'NEEDS_REVIEW' || targetStatus === 'ALL_PENDING') {
          conditions.push(`UPPER(COALESCE(o.staging_status, 'NEEDS_REVIEW')) IN ('NEEDS_REVIEW', 'DISCOVERED', 'PARSED')`);
        } else {
          conditions.push(`UPPER(o.staging_status) = $${idx}`);
          values.push(targetStatus);
          idx++;
        }
      }

      if (params.retailerId && params.retailerId !== 'toate') {
        conditions.push(`o.retailer_id = $${idx}`);
        values.push(params.retailerId);
        idx++;
      }

      if (params.documentId && params.documentId !== 'toate') {
        conditions.push(`o.document_id = $${idx}`);
        values.push(params.documentId);
        idx++;
      }

      if (params.search && params.search.trim()) {
        conditions.push(`(o.raw_title ILIKE $${idx} OR o.raw_brand ILIKE $${idx} OR o.raw_barcode ILIKE $${idx} OR o.matched_product_id ILIKE $${idx} OR p.name ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      if (params.filterType) {
        if (params.filterType === 'no_price') {
          conditions.push(`(o.effective_price IS NULL OR o.effective_price <= 0)`);
        } else if (params.filterType === 'has_ean') {
          conditions.push(`(o.raw_barcode IS NOT NULL AND length(btrim(o.raw_barcode)) >= 8)`);
        } else if (params.filterType === 'no_ean') {
          conditions.push(`(o.raw_barcode IS NULL OR length(btrim(o.raw_barcode)) < 8)`);
        } else if (params.filterType === 'auto_matched') {
          conditions.push(`(o.match_confidence >= 0.7 AND o.matched_product_id IS NOT NULL)`);
        } else if (params.filterType === 'needs_manual_review') {
          conditions.push(`(o.match_confidence < 0.7 OR o.matched_product_id IS NULL)`);
        } else if (params.filterType === 'suspect_price') {
          conditions.push(`(o.effective_price < 0.50 OR o.effective_price > 500)`);
        }
      }

      const whereClause = conditions.join(' AND ');

      // 3. Calcul total înregistrări filtrate
      const countRes = await pool.query(
        `SELECT count(*) FROM catalog_extracted_offers o LEFT JOIN products p ON p.id = o.matched_product_id WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      // 4. Interogare paginată
      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `SELECT o.*, p.name AS canonical_name
         FROM catalog_extracted_offers o
         LEFT JOIN products p ON p.id = o.matched_product_id
         WHERE ${whereClause}
         ORDER BY o.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        queryValues
      );

      const offers = dataRes.rows.map(mapStagingRow);

      return {
        offers,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        statusCounts
      };
    } catch (err: any) {
      console.error('Eroare getStagingOffersPaginated:', err.message);
      return {
        offers: [],
        total: 0,
        page,
        limit,
        totalPages: 1,
        statusCounts: {
          NEEDS_REVIEW: 0,
          VALIDATED: 0,
          APPROVED: 0,
          PUBLISHED: 0,
          REJECTED: 0,
          ALL: 0
        }
      };
    }
  }

  /**
   * Returnează ofertele aprobate cu detalii complete din PostgreSQL
   */
  static async getApprovedOffersDetailed(params: {
    page?: number;
    limit?: number;
    retailerId?: string;
    search?: string;
  }): Promise<{ offers: any[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const offset = (page - 1) * limit;
    const pool = getPool();

    if (!pool) {
      try {
        let query = supabase.from('catalog_extracted_offers').select('*', { count: 'exact' }).in('staging_status', ['APPROVED', 'VALIDATED', 'approved', 'validated']);
        if (params.retailerId && params.retailerId !== 'toate') query = query.eq('retailer_id', params.retailerId);
        if (params.search && params.search.trim()) query = query.ilike('raw_title', `%${params.search.trim()}%`);
        const { data, count, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        if (!error && data) {
          return {
            offers: data.map((r: any) => ({
              id: r.id,
              rawTitle: r.raw_title,
              retailerId: r.retailer_id,
              retailerName: r.retailer_id,
              documentId: r.document_id,
              normalPrice: parseFloat(r.normal_price) || 0,
              effectivePrice: parseFloat(r.effective_price) || 0,
              matchedProductId: r.matched_product_id,
              stagingStatus: r.staging_status,
              reviewedBy: r.reviewed_by || 'admin@cosulmeu.ro',
              createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
            })),
            total: count || data.length,
            page,
            totalPages: Math.max(1, Math.ceil((count || data.length) / limit))
          };
        }
      } catch {}
      return { offers: [], total: 0, page, totalPages: 1 };
    }

    try {
      const conditions: string[] = ["UPPER(o.staging_status) IN ('APPROVED', 'VALIDATED') OR o.reviewed_by IS NOT NULL"];
      const values: any[] = [];
      let idx = 1;

      if (params.retailerId && params.retailerId !== 'toate') {
        conditions.push(`o.retailer_id = $${idx}`);
        values.push(params.retailerId);
        idx++;
      }
      if (params.search && params.search.trim()) {
        conditions.push(`(o.raw_title ILIKE $${idx} OR o.raw_brand ILIKE $${idx} OR o.raw_barcode ILIKE $${idx} OR p.name ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      const whereClause = conditions.join(' AND ');
      const countRes = await pool.query(
        `SELECT count(*) FROM catalog_extracted_offers o LEFT JOIN products p ON p.id = o.matched_product_id WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `SELECT o.*, p.name AS canonical_name, p.image_url AS canonical_image, s.name AS retailer_name, d.title AS document_title
         FROM catalog_extracted_offers o
         LEFT JOIN products p ON p.id = o.matched_product_id
         LEFT JOIN stores s ON s.id = o.retailer_id
         LEFT JOIN catalog_documents d ON d.id = o.document_id
         WHERE ${whereClause}
         ORDER BY o.reviewed_at DESC NULLS LAST, o.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        queryValues
      );

      const offers = dataRes.rows.map(r => ({
        id: r.id,
        rawTitle: r.raw_title,
        retailerId: r.retailer_id,
        retailerName: r.retailer_name || r.retailer_id,
        documentId: r.document_id,
        documentTitle: r.document_title || r.document_id,
        rawBrand: r.raw_brand,
        rawBarcode: r.raw_barcode,
        normalPrice: parseFloat(r.normal_price) || 0,
        promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
        effectivePrice: parseFloat(r.effective_price) || 0,
        discountPercent: (r.normal_price && r.effective_price && parseFloat(r.normal_price) > parseFloat(r.effective_price))
          ? Math.round(((parseFloat(r.normal_price) - parseFloat(r.effective_price)) / parseFloat(r.normal_price)) * 100)
          : undefined,
        matchedProductId: r.matched_product_id,
        canonicalName: r.canonical_name || r.raw_title,
        canonicalImage: r.canonical_image,
        stagingStatus: r.staging_status,
        reviewedBy: r.reviewed_by || 'admin@cosulmeu.ro',
        reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
        validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : undefined,
        validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : undefined,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
      }));

      return { offers, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
    } catch (err: any) {
      console.error('Eroare getApprovedOffersDetailed:', err.message);
      return { offers: [], total: 0, page, totalPages: 1 };
    }
  }

  /**
   * Returnează ofertele active publicate în catalog (product_offers)
   */
  static async getPublicOffersDetailed(params: {
    page?: number;
    limit?: number;
    retailerId?: string;
    search?: string;
  }): Promise<{ offers: any[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const offset = (page - 1) * limit;
    const pool = getPool();

    if (!pool) {
      try {
        let query = supabase.from('product_offers').select('*', { count: 'exact' });
        if (params.retailerId && params.retailerId !== 'toate') query = query.eq('store_id', params.retailerId);
        const { data, count, error } = await query.order('price', { ascending: true }).range(offset, offset + limit - 1);
        if (!error && data) {
          return {
            offers: data.map((r: any) => ({
              id: r.id,
              productId: r.product_id,
              productName: r.product_id,
              storeId: r.store_id,
              storeName: r.store_id,
              price: parseFloat(r.price) || 0,
              isPromo: Boolean(r.is_promo),
              unitPrice: parseFloat(r.unit_price) || parseFloat(r.price) || 0,
              unitPriceMeasure: r.unit_price_measure || 'lei/buc',
              lastChecked: new Date().toISOString()
            })),
            total: count || data.length,
            page,
            totalPages: Math.max(1, Math.ceil((count || data.length) / limit))
          };
        }
      } catch {}
      return { offers: [], total: 0, page, totalPages: 1 };
    }

    try {
      const conditions: string[] = ['1=1'];
      const values: any[] = [];
      let idx = 1;

      if (params.retailerId && params.retailerId !== 'toate') {
        conditions.push(`(po.store_id = $${idx} OR po.store_id = 'store-' || $${idx})`);
        values.push(params.retailerId);
        idx++;
      }
      if (params.search && params.search.trim()) {
        conditions.push(`(p.name ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      const whereClause = conditions.join(' AND ');
      const countRes = await pool.query(
        `SELECT count(*) FROM product_offers po LEFT JOIN products p ON p.id = po.product_id WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `SELECT po.*, p.name AS product_name, p.brand AS product_brand, p.category AS product_category,
                p.barcode AS product_barcode, p.image_url AS product_image, s.name AS store_name, s.brand_color AS store_brand_color
         FROM product_offers po
         LEFT JOIN products p ON p.id = po.product_id
         LEFT JOIN stores s ON s.id = po.store_id OR s.id = replace(po.store_id, 'store-', '')
         WHERE ${whereClause}
         ORDER BY po.price ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        queryValues
      );

      const offers = dataRes.rows.map(r => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name || 'Produs fără denumire',
        productBrand: r.product_brand,
        productCategory: r.product_category,
        productBarcode: r.product_barcode,
        productImage: r.product_image,
        storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
        storeName: r.store_name || r.store_id,
        price: parseFloat(r.price) || 0,
        originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
        unitPrice: parseFloat(r.unit_price) || parseFloat(r.price) || 0,
        unitPriceMeasure: r.unit_price_measure || 'lei/buc',
        isPromo: Boolean(r.is_promo),
        promoDetails: r.promo_details || undefined,
        loyaltyCardRequired: Boolean(r.loyalty_card_required),
        loyaltyCardName: r.loyalty_card_name || undefined,
        validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : undefined,
        observationDate: r.observation_date ? String(r.observation_date).slice(0, 10) : undefined,
        isExpired: r.valid_until ? new Date(r.valid_until) < new Date() : false,
        lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString()
      }));

      return { offers, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
    } catch (err: any) {
      console.error('Eroare getPublicOffersDetailed:', err.message);
      return { offers: [], total: 0, page, totalPages: 1 };
    }
  }

  /**
   * Returnează istoricul modificărilor de preț din tabela append-only price_observations
   */
  static async getPriceChangesDetailed(params: {
    page?: number;
    limit?: number;
    retailerId?: string;
    search?: string;
  }): Promise<{ changes: any[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const offset = (page - 1) * limit;
    const pool = getPool();

    if (!pool) {
      try {
        let query = supabase.from('price_observations').select('*', { count: 'exact' });
        if (params.retailerId && params.retailerId !== 'toate') query = query.eq('store_id', params.retailerId);
        const { data, count, error } = await query.order('date', { ascending: false }).range(offset, offset + limit - 1);
        if (!error && data) {
          return {
            changes: data.map((r: any) => ({
              id: r.id,
              productId: r.product_id,
              productName: r.product_id,
              storeId: r.store_id,
              storeName: r.store_id,
              price: parseFloat(r.price) || 0,
              date: r.date,
              source: r.source || 'verified'
            })),
            total: count || data.length,
            page,
            totalPages: Math.max(1, Math.ceil((count || data.length) / limit))
          };
        }
      } catch {}
      return { changes: [], total: 0, page, totalPages: 1 };
    }

    try {
      const conditions: string[] = ['1=1'];
      const values: any[] = [];
      let idx = 1;

      if (params.retailerId && params.retailerId !== 'toate') {
        conditions.push(`(po.store_id = $${idx} OR po.store_id = 'store-' || $${idx})`);
        values.push(params.retailerId);
        idx++;
      }
      if (params.search && params.search.trim()) {
        conditions.push(`(p.name ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      const whereClause = conditions.join(' AND ');
      const countRes = await pool.query(
        `SELECT count(*) FROM price_observations po LEFT JOIN products p ON p.id = po.product_id WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `SELECT po.*, p.name AS product_name, p.brand AS product_brand, p.base_reference_price,
                s.name AS store_name, s.brand_color AS store_brand_color
         FROM price_observations po
         LEFT JOIN products p ON p.id = po.product_id
         LEFT JOIN stores s ON s.id = po.store_id OR s.id = replace(po.store_id, 'store-', '')
         WHERE ${whereClause}
         ORDER BY po.date DESC, po.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        queryValues
      );

      const changes = dataRes.rows.map(r => {
        const curPrice = parseFloat(r.price) || 0;
        const normPrice = r.normal_price ? parseFloat(r.normal_price) : undefined;
        const baseRef = r.base_reference_price ? parseFloat(r.base_reference_price) : undefined;
        const prevPrice = normPrice && normPrice !== curPrice ? normPrice : baseRef;
        const delta = prevPrice !== undefined ? Math.round((curPrice - prevPrice) * 100) / 100 : undefined;
        const pctChange = prevPrice && prevPrice > 0 ? Math.round(((curPrice - prevPrice) / prevPrice) * 100) : undefined;

        return {
          id: r.id,
          productId: r.product_id,
          productName: r.product_name || 'Produs fără denumire',
          productBrand: r.product_brand,
          storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
          storeName: r.store_name || r.store_id,
          price: curPrice,
          normalPrice: normPrice,
          promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
          loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
          previousPrice: prevPrice,
          difference: delta,
          percentChange: pctChange,
          date: r.date ? String(r.date).slice(0, 10) : new Date().toISOString().split('T')[0],
          source: r.source || 'official_feed',
          loyaltyCardUsed: Boolean(r.loyalty_card_used),
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
        };
      });

      return { changes, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
    } catch (err: any) {
      console.error('Eroare getPriceChangesDetailed:', err.message);
      return { changes: [], total: 0, page, totalPages: 1 };
    }
  }

  /**
   * Returnează articolele extrase fără preț valid, cu explicația tehnică a cauzei
   */
  static async getItemsWithoutPriceDetailed(params: {
    page?: number;
    limit?: number;
    retailerId?: string;
    search?: string;
  }): Promise<{ items: any[]; total: number; page: number; totalPages: number }> {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const offset = (page - 1) * limit;
    const pool = getPool();

    if (!pool) {
      try {
        const { data, count, error } = await supabase.from('catalog_extracted_offers')
          .select('*', { count: 'exact' })
          .or('effective_price.is.null,effective_price.lte.0')
          .range(offset, offset + limit - 1);
        if (!error && data) {
          return {
            items: data.map((r: any) => ({
              id: r.id,
              rawTitle: r.raw_title,
              retailerId: r.retailer_id,
              retailerName: r.retailer_id,
              reasonTitle: 'Preț lipsă în sursă',
              reasonDescription: 'Articolul nu conține o cifră de preț validă extrasă din catalog.'
            })),
            total: count || data.length,
            page,
            totalPages: Math.max(1, Math.ceil((count || data.length) / limit))
          };
        }
      } catch {}
      return { items: [], total: 0, page, totalPages: 1 };
    }

    try {
      const conditions: string[] = ['(o.effective_price IS NULL OR o.effective_price <= 0)'];
      const values: any[] = [];
      let idx = 1;

      if (params.retailerId && params.retailerId !== 'toate') {
        conditions.push(`o.retailer_id = $${idx}`);
        values.push(params.retailerId);
        idx++;
      }
      if (params.search && params.search.trim()) {
        conditions.push(`(o.raw_title ILIKE $${idx} OR o.raw_brand ILIKE $${idx} OR o.raw_barcode ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      const whereClause = conditions.join(' AND ');
      const countRes = await pool.query(
        `SELECT count(*) FROM catalog_extracted_offers o WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `SELECT o.*, s.name AS retailer_name, d.title AS document_title
         FROM catalog_extracted_offers o
         LEFT JOIN stores s ON s.id = o.retailer_id
         LEFT JOIN catalog_documents d ON d.id = o.document_id
         WHERE ${whereClause}
         ORDER BY o.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        queryValues
      );

      const items = dataRes.rows.map(r => {
        let reasonTitle = 'Preț neidentificat în document';
        let reasonDescription = 'Documentul oficial nu conține o cifră de preț asociată în mod direct acestui titlu.';

        if (!r.normal_price && !r.effective_price) {
          reasonTitle = 'Preț lipsă în sursă';
          reasonDescription = 'Articolul a fost extras dintr-o reclamă tematică sau copertă fără mențiune de preț.';
        } else if (parseFloat(r.effective_price) === 0) {
          reasonTitle = 'Preț zero extras din catalog';
          reasonDescription = 'Parserul a întâlnit valoarea 0.00 RON (probabil articol cadou, tombolă sau eroare de tipar). Prețul nu a fost promovat în catalogul public.';
        }

        return {
          id: r.id,
          rawTitle: r.raw_title,
          retailerId: r.retailer_id,
          retailerName: r.retailer_name || r.retailer_id,
          documentId: r.document_id,
          documentTitle: r.document_title || r.document_id,
          rawBrand: r.raw_brand,
          rawBarcode: r.raw_barcode,
          rawCategory: r.raw_category,
          reasonTitle,
          reasonDescription,
          validationErrors: r.validation_errors,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString()
        };
      });

      return { items, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
    } catch (err: any) {
      console.error('Eroare getItemsWithoutPriceDetailed:', err.message);
      return { items: [], total: 0, page, totalPages: 1 };
    }
  }

  /**
   * Actualizare sau aprobare / respingere în lot a ofertelor din Staging cu tranzacție atomică și audit log
   */
  static async bulkReviewStagingOffers(params: {
    offerIds: string[];
    action: 'approve' | 'reject';
    rejectionReason?: string;
    userEmail?: string;
    ipAddress?: string;
  }): Promise<{ count: number; message: string }> {
    const { offerIds, action, rejectionReason, userEmail = 'admin@cosulmeu.ro', ipAddress } = params;
    if (!offerIds || offerIds.length === 0) return { count: 0, message: 'Nu au fost furnizate oferte.' };

    const pool = getPool();
    const newStatus = action === 'approve' ? 'VALIDATED' : 'REJECTED';

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updateRes = await client.query(
          `UPDATE catalog_extracted_offers
           SET staging_status = $1,
               reviewed_by = $2,
               reviewed_at = NOW(),
               rejection_reason = $3,
               updated_at = NOW()
           WHERE id = ANY($4::varchar[])
           RETURNING id`,
          [newStatus, userEmail, action === 'reject' ? (rejectionReason || 'Respins manual în lot de administrator.') : null, offerIds]
        );
        const updatedCount = updateRes.rows.length;

        await client.query(
          `INSERT INTO admin_audit_logs (user_email, action, target_type, target_id, details, ip_address, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            userEmail,
            action === 'approve' ? 'bulk_approve_staging_offers' : 'bulk_reject_staging_offers',
            'staging_offers',
            offerIds.slice(0, 5).join(',') + (offerIds.length > 5 ? ` (+${offerIds.length - 5} others)` : ''),
            JSON.stringify({ requestedCount: offerIds.length, updatedCount, action, rejectionReason }),
            ipAddress || null
          ]
        );

        await client.query('COMMIT');
        return {
          count: updatedCount,
          message: `${updatedCount} oferte au fost ${action === 'approve' ? 'validate' : 'respinse'} cu succes în PostgreSQL.`
        };
      } catch (err: any) {
        await client.query('ROLLBACK');
        throw new Error(`Eroare la actualizarea în lot în PostgreSQL: ${err.message}`);
      } finally {
        client.release();
      }
    }

    // Fallback Supabase
    try {
      await supabase.from('catalog_extracted_offers')
        .update({
          staging_status: newStatus,
          reviewed_by: userEmail,
          reviewed_at: new Date().toISOString()
        })
        .in('id', offerIds);
      return { count: offerIds.length, message: `${offerIds.length} oferte au fost actualizate.` };
    } catch {}
    return { count: 0, message: 'Nu s-au putut actualiza ofertele.' };
  }
}


