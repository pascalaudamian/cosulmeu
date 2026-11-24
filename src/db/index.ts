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
  OperationalDashboardData,
  RetailerProductRecord,
  ShadowMatchCandidate,
  ShadowMatchingReport
} from '../types.ts';
import {
  CatalogSource,
  CatalogDocument,
  CatalogImportRun,
  CatalogExtractedOffer,
  CatalogImportError
} from '../indexing/catalog/catalogTypes.ts';
import { INITIAL_CATALOG_SOURCES } from '../indexing/catalog/initialCatalogSources.ts';
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
import { PriceExtractor } from '../indexing/catalog/PriceExtractor.ts';
import {
  buildCanonicalAliasIndex,
  buildCanonicalExternalSku,
  CanonicalAliasIndex,
  type CanonicalProductNode,
  collectProductIdsForCanonical,
  normalizeBarcodeCandidates,
  normalizeStoreIdKey,
  pickRetailerProductUrl,
  resolveCanonicalProductDetail,
  resolveCanonicalProductId
} from '../services/ProductIdentityService.ts';
import {
  CatalogDataQualityReport,
  generateCatalogQualityReport,
  normalizeQuantityAndMultipack
} from '../services/ProductNormalizationService.ts';
import {
  ProductShadowMatchingService,
  type ShadowMatchingOptions
} from '../services/ProductShadowMatchingService.ts';

const { Pool } = pg;

/**
 * Supabase PostgREST limitează răspunsurile la 1000 rânduri per cerere.
 * Această funcție paginează automat prin .range(from, to) pentru a prelua toate înregistrările.
 */
export async function fetchAllSupabaseRows<T = any>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<{ data: T[]; error: any }> {
  const PAGE_SIZE = 1000;
  const allRows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) {
      return { data: allRows, error };
    }
    if (!data || data.length === 0) {
      break;
    }
    allRows.push(...data);
    if (data.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  return { data: allRows, error: null };
}

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

function formatDateOnlyValue(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.toISOString().split('T')[0];
  }
  const str = String(raw).trim();
  if (!str) return undefined;
  return str.slice(0, 10);
}

function enrichOffersWithPromotionDates(
  offers: ProductOffer[],
  promoRows: any[],
  aliasIndex?: CanonicalAliasIndex
): ProductOffer[] {
  if (!offers.length) return offers;

  const promosByKey = new Map<
    string,
    Array<{ startsAt?: string; endsAt?: string; conditions?: string; discoveredAt: string }>
  >();

  for (const row of promoRows || []) {
    const rawPid = String(row.canonical_product_id || row.product_id || row.productId || '').trim();
    const rawStore = String(row.retailer_id || row.retailerId || '').trim();
    if (!rawPid || !rawStore) continue;

    const canonicalPid = aliasIndex
      ? resolveCanonicalProductId(rawPid, aliasIndex) || rawPid
      : rawPid;
    const storeKey = normalizeStoreIdKey(rawStore);
    if (!storeKey) continue;

    const startsAt = formatDateOnlyValue(row.starts_at ?? row.startsAt);
    const endsAt = formatDateOnlyValue(row.ends_at ?? row.endsAt);
    const conditions = (row.conditions ? String(row.conditions).trim() : '') || undefined;
    if (!startsAt && !endsAt && !conditions) continue;

    const key = `${canonicalPid}__${storeKey}`;
    const list = promosByKey.get(key) || [];
    list.push({
      startsAt,
      endsAt,
      conditions,
      discoveredAt: String(row.discovered_at ?? row.discoveredAt ?? '')
    });
    promosByKey.set(key, list);
  }

  return offers.map(offer => {
    const baseCurrency = offer.currency || 'RON';
    if (!offer.isPromo) {
      return offer.currency ? offer : { ...offer, currency: baseCurrency };
    }

    const key = `${offer.productId}__${normalizeStoreIdKey(offer.storeId)}`;
    const candidates = promosByKey.get(key);
    if (!candidates || candidates.length === 0) {
      return offer.currency ? offer : { ...offer, currency: baseCurrency };
    }

    const matched =
      (offer.validUntil
        ? candidates.find(c => !c.endsAt || c.endsAt === offer.validUntil)
        : undefined) || candidates[0];

    return {
      ...offer,
      currency: baseCurrency,
      validFrom: offer.validFrom || matched.startsAt,
      validUntil: offer.validUntil || matched.endsAt,
      promoDetails: offer.promoDetails || matched.conditions
    };
  });
}

// ============================================================================
// SAFE PUBLIC CATALOG CACHE (60s TTL — STRICTLY PUBLIC READ-ONLY CATALOG DATA)
// User lists, prices per basket, and preferences are NEVER cached here.
// ============================================================================
const CATALOG_OPT_CACHE_TTL_MS = 60_000;

interface PublicCatalogOptCache {
  products?: { data: Product[]; expiresAt: number };
  stores?: { data: Store[]; expiresAt: number };
  offers?: { data: ProductOffer[]; expiresAt: number };
  version: number;
}

const publicCatalogOptCache: PublicCatalogOptCache = {
  version: 1
};

export function invalidateCatalogOptimizationCache(): void {
  publicCatalogOptCache.products = undefined;
  publicCatalogOptCache.stores = undefined;
  publicCatalogOptCache.offers = undefined;
  publicCatalogOptCache.version += 1;
}

export function getCatalogOptimizationCacheStats(): { version: number; hasProducts: boolean; hasOffers: boolean; hasStores: boolean } {
  const now = Date.now();
  return {
    version: publicCatalogOptCache.version,
    hasProducts: Boolean(publicCatalogOptCache.products && publicCatalogOptCache.products.expiresAt > now),
    hasOffers: Boolean(publicCatalogOptCache.offers && publicCatalogOptCache.offers.expiresAt > now),
    hasStores: Boolean(publicCatalogOptCache.stores && publicCatalogOptCache.stores.expiresAt > now)
  };
}

export class DatabaseService {
  static invalidateCatalogCache(): void {
    invalidateCatalogOptimizationCache();
  }
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
              official_url TEXT,
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

          ALTER TABLE stores ADD COLUMN IF NOT EXISTS official_url TEXT;
          ALTER TABLE catalog_extracted_offers ADD COLUMN IF NOT EXISTS image_url TEXT;
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
    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      const allProducts = StorageService.getAllProducts();
      const aliasIndex = buildCanonicalAliasIndex(allProducts);
      return allProducts.filter(
        p => !p.canonicalProductId && resolveCanonicalProductId(p.id, aliasIndex) === p.id
      );
    }
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
      const { data, error } = await fetchAllSupabaseRows((from, to) =>
        supabase
          .from('products')
          .select('*')
          .is('canonical_product_id', null)
          .order('name', { ascending: true })
          .range(from, to)
      );
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

  /**
   * Returnează graful complet și brut de identitate canonică din baza de date (toate nodurile și muchiile,
   * inclusiv auto-referințe, cicluri, lanțuri adânci și aliasuri orfane), fără pre-filtrare.
   */
  static async getProductAliasIndex(options?: {
    nodesOverride?: ReadonlyArray<CanonicalProductNode>;
    supabaseClient?: any;
  }): Promise<CanonicalAliasIndex> {
    if (options?.nodesOverride) {
      return buildCanonicalAliasIndex(options.nodesOverride);
    }

    if (process.env.COSUL_MEU_ISOLATED_TEST === '1' && !options?.supabaseClient) {
      const { StorageService } = await import('../services/StorageService.ts');
      return buildCanonicalAliasIndex(StorageService.getAllProducts());
    }

    const pool = options?.supabaseClient ? null : getPool();
    if (pool) {
      try {
        const res = await pool.query('SELECT id, canonical_product_id FROM products');
        return buildCanonicalAliasIndex(res.rows);
      } catch (err: any) {
        console.warn('Postgres pool getProductAliasIndex failed, falling back to Supabase:', err.message);
      }
    }

    const client = options?.supabaseClient || supabase;
    try {
      const { data, error } = await fetchAllSupabaseRows((from, to) =>
        client.from('products').select('id, canonical_product_id').range(from, to)
      );
      if (!error && Array.isArray(data)) {
        return buildCanonicalAliasIndex(data);
      }
    } catch {
      // Fallback sigur fără aliasuri ascunse
    }

    return buildCanonicalAliasIndex([]);
  }

  /**
   * Returnează harta completă alias_id -> canonical_product_id (rezolvată tranzitiv, exclusiv mapări valide non-ciclice).
   */
  static async getProductAliasMap(): Promise<Map<string, string>> {
    const index = await this.getProductAliasIndex();
    const out = new Map<string, string>();
    for (const [id, parentId] of index.parentById.entries()) {
      if (!parentId) continue;
      const resolved = resolveCanonicalProductId(id, index);
      if (resolved && resolved !== id) {
        out.set(id, resolved);
      }
    }
    return out;
  }

  /**
   * Returnează mapările retailer_products cu coduri de bare (rezolvate canonic) pentru scanerul de coduri de bare.
   */
  static async getRetailerProductsWithBarcodes(options?: {
    poolOverride?: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> } | null;
    supabaseClientOverride?: any;
    aliasIndexOverride?: CanonicalAliasIndex;
  }): Promise<RetailerProductRecord[]> {
    const resolveSafeProductId = (
      rawProductId: unknown,
      aliasIndex: CanonicalAliasIndex
    ): string | null => {
      const candidate =
        typeof rawProductId === 'string'
          ? rawProductId.trim()
          : String(rawProductId ?? '').trim();
      if (!candidate) return null;
      const detail = resolveCanonicalProductDetail(candidate, aliasIndex);
      if (!detail.found || detail.cycleDetected || !detail.canonicalId) {
        return null;
      }
      return detail.canonicalId;
    };

    const loadAliasIndex = async (): Promise<CanonicalAliasIndex> => {
      if (options?.aliasIndexOverride) {
        return options.aliasIndexOverride;
      }
      if (options?.poolOverride) {
        const aliasRes = await options.poolOverride.query(
          'SELECT id, canonical_product_id FROM products'
        );
        return buildCanonicalAliasIndex(aliasRes.rows);
      }
      if (options?.supabaseClientOverride) {
        return this.getProductAliasIndex({ supabaseClient: options.supabaseClientOverride });
      }
      return this.getProductAliasIndex();
    };

    const readLocalRetailerProducts = async (): Promise<RetailerProductRecord[]> => {
      const [{ StorageService }, aliasIndex] = await Promise.all([
        import('../services/StorageService.ts'),
        loadAliasIndex()
      ]);
      return StorageService.getRetailerProducts()
        .filter(r => Boolean(r?.barcode && r?.productId))
        .map(r => ({
          ...r,
          productId: resolveSafeProductId(r.productId, aliasIndex)
        }));
    };

    if (
      process.env.COSUL_MEU_ISOLATED_TEST === '1' &&
      !options?.poolOverride &&
      !options?.supabaseClientOverride
    ) {
      return readLocalRetailerProducts();
    }

    const pool =
      options?.poolOverride !== undefined
        ? options.poolOverride
        : options?.supabaseClientOverride
        ? null
        : getPool();
    if (pool) {
      try {
        const [rpRes, aliasIndex] = await Promise.all([
          pool.query(
            `SELECT id, retailer_id, product_id, external_sku, url, scraped_name, scraped_brand, barcode, status
             FROM retailer_products
             WHERE barcode IS NOT NULL AND product_id IS NOT NULL`
          ),
          loadAliasIndex()
        ]);
        return rpRes.rows.map(r => ({
          id: String(r.id),
          retailerId: String(r.retailer_id),
          productId: resolveSafeProductId(r.product_id, aliasIndex),
          externalSku: r.external_sku || undefined,
          url: r.url || undefined,
          scrapedName: r.scraped_name || 'Produs',
          scrapedBrand: r.scraped_brand || undefined,
          barcode: r.barcode || undefined,
          status: r.status || 'active'
        }));
      } catch (err: any) {
        console.warn('Postgres pool getRetailerProductsWithBarcodes failed:', err.message);
      }
    }

    const client = options?.supabaseClientOverride || supabase;
    try {
      const [rpRes, aliasIndex] = await Promise.all([
        fetchAllSupabaseRows((from, to) =>
          client
            .from('retailer_products')
            .select('id, retailer_id, product_id, external_sku, url, scraped_name, scraped_brand, barcode, status')
            .not('barcode', 'is', null)
            .not('product_id', 'is', null)
            .range(from, to)
        ),
        loadAliasIndex()
      ]);
      if (!rpRes.error && Array.isArray(rpRes.data)) {
        return rpRes.data.map(r => ({
          id: String(r.id),
          retailerId: String(r.retailer_id),
          productId: resolveSafeProductId(r.product_id, aliasIndex),
          externalSku: r.external_sku || undefined,
          url: r.url || undefined,
          scrapedName: r.scraped_name || 'Produs',
          scrapedBrand: r.scraped_brand || undefined,
          barcode: r.barcode || undefined,
          status: r.status || 'active'
        }));
      }
    } catch {
      // Non-blocking fallback
    }
    return readLocalRetailerProducts();
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
        invalidateCatalogOptimizationCache();
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

      if (!error) invalidateCatalogOptimizationCache();
      return !error;
    } catch (err: any) {
      console.error('Supabase insertProduct failed:', err.message);
      return false;
    }
  }

  // --- STORES ---
  static async getStores(): Promise<Store[]> {
    const normalizeStoreKey = (value: string): string =>
      value.toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();

    const findFallbackStore = (id: string, slug?: string): Store | undefined => {
      const normalizedId = normalizeStoreKey(id || '');
      const normalizedSlug = normalizeStoreKey(slug || '');
      return STORES.find(
        s =>
          s.id === id ||
          (slug && s.slug === slug) ||
          normalizeStoreKey(s.id) === normalizedId ||
          (normalizedSlug && normalizeStoreKey(s.slug) === normalizedSlug)
      );
    };

    const mergeWithFallbackStores = (rawStores: Store[]): Store[] => {
      const uniqueByKey = new Map<string, Store>();
      for (const store of rawStores) {
        if (!store?.id || store.id === 'validation-only-retailer' || store.slug === 'validation-only-retailer') {
          continue;
        }
        const key = normalizeStoreKey(store.slug || store.id) || store.id.toLowerCase();
        const existing = uniqueByKey.get(key);
        if (!existing || (existing.id !== key && store.id === key)) {
          uniqueByKey.set(key, store);
        }
      }

      const deduplicated = Array.from(uniqueByKey.values());
      const existingIds = new Set(deduplicated.map(s => s.id.toLowerCase()));
      const existingSlugs = new Set(deduplicated.map(s => (s.slug || s.id).toLowerCase()));
      const existingKeys = new Set(
        deduplicated
          .flatMap(s => [normalizeStoreKey(s.id), normalizeStoreKey(s.slug || '')])
          .filter(Boolean)
      );

      const missing = STORES.filter(s => {
        const idLower = s.id.toLowerCase();
        const slugLower = (s.slug || s.id).toLowerCase();
        const key = normalizeStoreKey(s.id);
        return !existingIds.has(idLower) && !existingSlugs.has(slugLower) && !existingKeys.has(key);
      });

      return [...deduplicated, ...missing];
    };

    const pool = getPool();
    if (pool) {
      try {
        const res = await pool.query('SELECT * FROM stores ORDER BY rating DESC');
        if (res.rows.length > 0) {
          const dbStores = res.rows.map(r => {
            const fallbackStore = findFallbackStore(r.id, r.slug);
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
          return mergeWithFallbackStores(dbStores);
        }
      } catch (err: any) {
        console.warn('Postgres pool getStores failed, falling back to Supabase:', err.message);
      }
    }

    try {
      const { data, error } = await supabase.from('stores').select('*').order('rating', { ascending: false });
      if (!error && data && data.length > 0) {
        const sbStores = data.map(r => {
          const fallbackStore = findFallbackStore(r.id, r.slug);
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
        return mergeWithFallbackStores(sbStores);
      }
    } catch {}

    return STORES;
  }

  // --- PRODUCT OFFERS (CURRENT STATE) ---
  static async getOffers(): Promise<ProductOffer[]> {
    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      const allProducts = StorageService.getAllProducts();
      const aliasIndex = buildCanonicalAliasIndex(allProducts);
      const normalizedOffers: ProductOffer[] = [];
      for (const o of StorageService.getProductOffers()) {
        if (
          !(o.price > 0) ||
          o.isFlaggedAnomaly ||
          ['demo', 'isolated', 'rejected'].includes(o.verificationStatus || 'verified')
        ) {
          continue;
        }
        const detail = resolveCanonicalProductDetail(o.productId, aliasIndex);
        if (detail.cycleDetected) continue;
        if (aliasIndex.parentById.has(o.productId)) {
          if (!detail.found || !detail.canonicalId) continue;
          normalizedOffers.push(
            detail.canonicalId !== o.productId ? { ...o, productId: detail.canonicalId } : o
          );
        } else {
          normalizedOffers.push(o);
        }
      }
        const normalized = latestCanonicalOffers(normalizedOffers);
        return enrichOffersWithPromotionDates(normalized, StorageService.getPromotions(), aliasIndex);
    }
    const pool = getPool();
    if (pool) {
      try {
        const res = await pool.query(
          `WITH RECURSIVE canonical_map AS (
             SELECT id AS node_id, id AS current_id, canonical_product_id, ARRAY[id::text]::text[] AS path, 0 AS depth
             FROM products
             UNION ALL
             SELECT cm.node_id, p.id AS current_id, p.canonical_product_id, (cm.path || p.id::text)::text[], cm.depth + 1
             FROM canonical_map cm
             JOIN products p ON p.id = cm.canonical_product_id
             WHERE cm.canonical_product_id IS NOT NULL
               AND NOT (p.id::text = ANY(cm.path))
               AND cm.depth < 16
           ),
           resolved_root AS (
             SELECT node_id, current_id AS canonical_product_id
             FROM canonical_map
             WHERE canonical_product_id IS NULL
           )
           SELECT po.*, rr.canonical_product_id
           FROM product_offers po
           JOIN resolved_root rr ON rr.node_id = po.product_id
           WHERE po.source != 'demo'
             AND COALESCE(po.verification_status, 'verified') NOT IN ('demo', 'isolated', 'rejected')
             AND COALESCE(po.is_flagged_anomaly, false) = false
             AND po.price > 0
           ORDER BY po.observation_date ASC, po.last_checked ASC`
        );
        if (res.rows.length > 0) {
          const offers: ProductOffer[] = res.rows.map(r => ({
            id: r.id,
            productId: r.canonical_product_id || r.product_id,
            storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
            sourceId: r.source_id || undefined,
            currency: r.currency || 'RON',
            price: parseFloat(r.price),
            originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
            normalPrice: r.normal_price ? parseFloat(r.normal_price) : undefined,
            promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
            loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
            unitPrice: parseFloat(r.unit_price) || parseFloat(r.price),
            unitPriceMeasure: r.unit_price_measure || 'lei/buc',
            isPromo: Boolean(r.is_promo),
            promoDetails: r.promo_details || undefined,
            loyaltyCardRequired: Boolean(r.loyalty_card_required),
            loyaltyCardName: r.loyalty_card_name || undefined,
            validFrom: r.valid_from ? (r.valid_from.toISOString?.().split('T')[0] || String(r.valid_from).slice(0, 10)) : undefined,
            validUntil: r.valid_until ? (r.valid_until.toISOString?.().split('T')[0] || String(r.valid_until).slice(0, 10)) : undefined,
            observationDate: r.observation_date ? (r.observation_date.toISOString?.().split('T')[0] || String(r.observation_date).slice(0, 10)) : new Date().toISOString().split('T')[0],
            source: r.source,
            confidenceLevel: r.confidence_level || 'high',
            verificationStatus: r.verification_status || 'verified',
            lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
            lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at).toISOString() : undefined,
            region: r.region || undefined,
            isSponsored: Boolean(r.is_sponsored),
            isFlaggedAnomaly: Boolean(r.is_flagged_anomaly),
            anomalyReason: r.anomaly_reason || undefined
          }));
          const latest = latestCanonicalOffers(offers);
          if (latest.some(o => o.isPromo && !o.validFrom)) {
            const [promoRes, aliasIndex] = await Promise.all([
              pool
                .query(
                  `SELECT product_id, retailer_id, starts_at, ends_at, conditions, discovered_at
                   FROM promotions
                   WHERE product_id IS NOT NULL
                   ORDER BY discovered_at DESC`
                )
                .catch(() => ({ rows: [] })),
              this.getProductAliasIndex().catch(() => undefined)
            ]);
            return enrichOffersWithPromotionDates(latest, promoRes.rows, aliasIndex);
          }
          return latest;
        }
      } catch (err: any) {
        console.warn('Postgres pool getOffers failed, falling back to Supabase:', err.message);
      }
    }

    try {
      const [offersRes, productsRes] = await Promise.all([
        fetchAllSupabaseRows((from, to) =>
          supabase
            .from('product_offers')
            .select('*')
            .neq('source', 'demo')
            .not('verification_status', 'in', '("demo","isolated","rejected")')
            .gt('price', 0)
            .range(from, to)
        ),
        fetchAllSupabaseRows((from, to) =>
          supabase.from('products').select('id, canonical_product_id').range(from, to)
        )
      ]);
      const data = offersRes.data.filter(r => !r.is_flagged_anomaly && Number(r.price) > 0);
      const aliasIndex = buildCanonicalAliasIndex(productsRes.data || []);

      if (!offersRes.error && data.length > 0) {
        const offers: ProductOffer[] = [];
        for (const r of data) {
          const detail = resolveCanonicalProductDetail(r.product_id, aliasIndex);
          if (!detail.found || !detail.canonicalId || detail.cycleDetected) continue;
          offers.push({
            id: r.id,
            productId: detail.canonicalId,
            storeId: r.store_id ? r.store_id.replace(/^store-/, '') : '',
            sourceId: r.source_id || undefined,
            currency: r.currency || 'RON',
            price: parseFloat(r.price),
            originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
            normalPrice: r.normal_price ? parseFloat(r.normal_price) : undefined,
            promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
            loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
            unitPrice: parseFloat(r.unit_price) || parseFloat(r.price),
            unitPriceMeasure: r.unit_price_measure || 'lei/buc',
            isPromo: Boolean(r.is_promo),
            promoDetails: r.promo_details || undefined,
            loyaltyCardRequired: Boolean(r.loyalty_card_required),
            loyaltyCardName: r.loyalty_card_name || undefined,
            validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : undefined,
            validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : undefined,
            observationDate: r.observation_date ? String(r.observation_date).slice(0, 10) : new Date().toISOString().split('T')[0],
            source: r.source || 'verified',
            confidenceLevel: r.confidence_level || 'high',
            verificationStatus: r.verification_status || 'verified',
            lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
            lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at).toISOString() : undefined,
            region: r.region || undefined,
            isSponsored: Boolean(r.is_sponsored),
            isFlaggedAnomaly: Boolean(r.is_flagged_anomaly),
            anomalyReason: r.anomaly_reason || undefined
          });
        }
        const latest = latestCanonicalOffers(offers);
        if (latest.some(o => o.isPromo && !o.validFrom)) {
          try {
            const promoRes = await supabase
              .from('promotions')
              .select('product_id, retailer_id, starts_at, ends_at, conditions, discovered_at')
              .not('product_id', 'is', null)
              .order('discovered_at', { ascending: false })
              .limit(1000);
            if (!promoRes.error && promoRes.data) {
              return enrichOffersWithPromotionDates(latest, promoRes.data, aliasIndex);
            }
          } catch {
            // Optional promo enrichment failure must not break getOffers
          }
        }
        return latest;
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
        invalidateCatalogOptimizationCache();
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
      if (!error) invalidateCatalogOptimizationCache();
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
        if (productId) {
          const allNodesRes = await pool.query('SELECT id, canonical_product_id FROM products');
          const aliasIndex = buildCanonicalAliasIndex(allNodesRes.rows);
          const resolvedDetail = resolveCanonicalProductDetail(productId, aliasIndex);
          if (resolvedDetail.cycleDetected || !resolvedDetail.found || !resolvedDetail.canonicalId) {
            return [];
          }
          const canonicalProductId = resolvedDetail.canonicalId;
          const allEquivalentIds = collectProductIdsForCanonical(canonicalProductId, aliasIndex);
          const res = await pool.query(
            `SELECT * FROM price_observations
             WHERE product_id = ANY($1::varchar[])
             ORDER BY date ASC, created_at ASC`,
            [allEquivalentIds]
          );
          return res.rows.map(r => ({
            id: r.id,
            productId: canonicalProductId,
            storeId: normalizeStoreIdKey(r.store_id),
            sourceId: r.source_id || undefined,
            price: parseFloat(r.price),
            date: r.date ? (r.date.toISOString?.().split('T')[0] || String(r.date).slice(0, 10)) : '',
            receiptId: r.receipt_id || undefined,
            loyaltyCardUsed: r.loyalty_card_used,
            source: r.source
          }));
        }

        const res = await pool.query('SELECT * FROM price_observations ORDER BY date DESC, created_at DESC LIMIT 200');
        if (res.rows.length > 0) {
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
        }
      } catch (err: any) {
        console.warn('Postgres pool getPriceObservations failed, falling back to Supabase:', err.message);
      }
    }

    try {
      let query = supabase.from('price_observations').select('*');
      let resolvedCanonicalId: string | undefined = productId;
      if (productId) {
        const { data: prodNodes } = await fetchAllSupabaseRows((from, to) =>
          supabase.from('products').select('id, canonical_product_id').range(from, to)
        );
        const aliasIndex = buildCanonicalAliasIndex(prodNodes || []);
        const resolvedDetail = resolveCanonicalProductDetail(productId, aliasIndex);
        if (resolvedDetail.cycleDetected || (prodNodes && prodNodes.length > 0 && (!resolvedDetail.found || !resolvedDetail.canonicalId))) {
          return [];
        }
        resolvedCanonicalId = resolvedDetail.canonicalId || productId;
        const productIds = collectProductIdsForCanonical(resolvedCanonicalId, aliasIndex);
        query = query.in('product_id', productIds.length > 0 ? productIds : [resolvedCanonicalId]).order('date', { ascending: true });
      } else {
        query = query.order('date', { ascending: false }).limit(200);
      }
      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data.map(r => ({
          id: r.id,
          productId: resolvedCanonicalId || r.product_id,
          storeId: normalizeStoreIdKey(r.store_id),
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

  /**
   * Corectează manual asocierea unui candidat către un produs canonic valid.
   * Rulează atomic în tranzacție PG (sau fallback Supabase / StorageService),
   * fără a șterge sau modifica istoricul imutabil `price_observations` și fără auto-merging.
   */
  static async correctProductMatch(params: {
    candidateId: string;
    correctedProductId: string;
    reason: string;
    performedBy?: string;
    ipAddress?: string;
  }): Promise<{
    success: boolean;
    statusCode: number;
    error?: string;
    candidateId: string;
    previousProductId?: string;
    correctedProductId?: string;
    auditId?: string;
    persistedIn?: 'postgresql' | 'supabase' | 'memory';
  }> {
    const candidateId = (params.candidateId || '').trim();
    const requestedTargetId = (params.correctedProductId || '').trim();
    const reason = (params.reason || '').trim();
    const performedBy = (params.performedBy || 'admin').trim() || 'admin';
    const ipAddress = (params.ipAddress || 'unknown').trim().slice(0, 64);

    if (!candidateId || !requestedTargetId || !reason) {
      return {
        success: false,
        statusCode: 400,
        error: 'Câmpurile candidateId, correctedProductId și reason sunt obligatorii.',
        candidateId
      };
    }

    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';
    const pool = isIsolated ? null : getPool();

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const candRes = await client.query(
          `SELECT id, source_raw_name, matched_product_id, matched_product_name, status
           FROM product_match_candidates
           WHERE id = $1
           FOR UPDATE`,
          [candidateId]
        );
        if (candRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return {
            success: false,
            statusCode: 404,
            error: `Candidatul '${candidateId}' nu există.`,
            candidateId
          };
        }

        const cand = candRes.rows[0];
        const prodRes = await client.query(
          'SELECT id, name, canonical_product_id FROM products'
        );
        const prodNodes = prodRes.rows.map(r => ({
          id: r.id,
          name: r.name,
          canonicalProductId: r.canonical_product_id || null
        }));
        const resolution = resolveCanonicalProductDetail(requestedTargetId, prodNodes);

        if (resolution.cycleDetected) {
          await client.query('ROLLBACK');
          return {
            success: false,
            statusCode: 409,
            error: `Referință circulară detectată pentru produsul '${requestedTargetId}'.`,
            candidateId
          };
        }

        if (!resolution.found || !resolution.canonicalId) {
          await client.query('ROLLBACK');
          return {
            success: false,
            statusCode: 404,
            error: `Produsul țintă '${requestedTargetId}' nu există în catalogul canonic.`,
            candidateId
          };
        }

        const canonicalTarget = prodNodes.find(p => p.id === resolution.canonicalId);
        if (!canonicalTarget) {
          await client.query('ROLLBACK');
          return {
            success: false,
            statusCode: 404,
            error: `Produsul canonic '${resolution.canonicalId}' nu există în catalog.`,
            candidateId
          };
        }

        const canonicalProductId = canonicalTarget.id;
        const previousProductId = cand.matched_product_id;

        await client.query(
          `UPDATE product_match_candidates
           SET matched_product_id = $1,
               matched_product_name = $2,
               status = 'auto_approved'
           WHERE id = $3`,
          [canonicalProductId, canonicalTarget.name, candidateId]
        );

        const matchRowId = `pm-${crypto.randomUUID().slice(0, 16)}`;
        await client.query(
          `INSERT INTO product_matches (
            id, candidate_id, raw_name, product_id, retailer_id,
            confidence, match_type, status, reviewed_by, reviewed_at
          ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, NOW())`,
          [
            matchRowId,
            candidateId,
            cand.source_raw_name,
            canonicalProductId,
            1.0,
            'manual_correction',
            'approved',
            performedBy
          ]
        );

        const auditId = `audit-${crypto.randomUUID().slice(0, 16)}`;
        await client.query(
          `INSERT INTO admin_audit_logs (
            id, user_email, action, target_type, target_id, details, ip_address, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [
            auditId,
            performedBy,
            'match_correction',
            'product_match_candidate',
            candidateId,
            JSON.stringify({
              candidateId,
              rawName: cand.source_raw_name,
              previousProductId,
              requestedProductId: requestedTargetId,
              correctedProductId: canonicalProductId,
              action: previousProductId === canonicalProductId ? 'approved' : 'reassigned',
              reason
            }),
            ipAddress
          ]
        );

        await client.query('COMMIT');
        invalidateCatalogOptimizationCache();

        return {
          success: true,
          statusCode: 200,
          candidateId,
          previousProductId,
          correctedProductId: canonicalProductId,
          auditId,
          persistedIn: 'postgresql'
        };
      } catch (err: any) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        return {
          success: false,
          statusCode: 500,
          error: err?.message || 'Eroare internă la salvarea corecției de asociere.',
          candidateId
        };
      } finally {
        client.release();
      }
    }

    // Fallback Supabase (dacă nu există PG pool direct și nu suntem în mod izolat)
    if (!isIsolated && supabase) {
      try {
        const { data: candRow, error: candErr } = await supabase
          .from('product_match_candidates')
          .select('id, source_raw_name, matched_product_id, matched_product_name, status')
          .eq('id', candidateId)
          .maybeSingle();

        if (!candErr && candRow) {
          const { data: prodRows, error: prodErr } = await fetchAllSupabaseRows((from, to) =>
            supabase.from('products').select('id, name, canonical_product_id').range(from, to)
          );
          if (!prodErr && prodRows.length > 0) {
            const prodNodes = prodRows.map((r: any) => ({
              id: r.id,
              name: r.name,
              canonicalProductId: r.canonical_product_id || null
            }));
            const resolution = resolveCanonicalProductDetail(requestedTargetId, prodNodes);
            if (resolution.cycleDetected) {
              return {
                success: false,
                statusCode: 409,
                error: `Referință circulară detectată pentru produsul '${requestedTargetId}'.`,
                candidateId
              };
            }
            if (!resolution.found || !resolution.canonicalId) {
              return {
                success: false,
                statusCode: 404,
                error: `Produsul țintă '${requestedTargetId}' nu există în catalog.`,
                candidateId
              };
            }
            const canonicalTarget = prodNodes.find((p: any) => p.id === resolution.canonicalId);
            const canonicalId = canonicalTarget?.id || resolution.canonicalId;

            const { error: updErr } = await supabase
              .from('product_match_candidates')
              .update({
                matched_product_id: canonicalId,
                matched_product_name: canonicalTarget?.name || candRow.matched_product_name,
                status: 'auto_approved'
              })
              .eq('id', candidateId);

            if (updErr) {
              return {
                success: false,
                statusCode: 500,
                error: updErr.message,
                candidateId
              };
            }

            const auditId = `audit-${crypto.randomUUID().slice(0, 16)}`;
            await supabase.from('product_matches').insert({
              id: `pm-${crypto.randomUUID().slice(0, 16)}`,
              candidate_id: candidateId,
              raw_name: candRow.source_raw_name,
              product_id: canonicalId,
              retailer_id: null,
              confidence: 1.0,
              match_type: 'manual_correction',
              status: 'approved',
              reviewed_by: performedBy,
              reviewed_at: new Date().toISOString()
            });
            await supabase.from('admin_audit_logs').insert({
              id: auditId,
              user_email: performedBy,
              action: 'match_correction',
              target_type: 'product_match_candidate',
              target_id: candidateId,
              details: {
                candidateId,
                rawName: candRow.source_raw_name,
                previousProductId: candRow.matched_product_id,
                requestedProductId: requestedTargetId,
                correctedProductId: canonicalId,
                reason
              },
              ip_address: ipAddress,
              created_at: new Date().toISOString()
            });

            invalidateCatalogOptimizationCache();
            return {
              success: true,
              statusCode: 200,
              candidateId,
              previousProductId: candRow.matched_product_id,
              correctedProductId: canonicalId,
              auditId,
              persistedIn: 'supabase'
            };
          }
        }
      } catch {
        // Fallback spre StorageService dacă nu s-a putut rezolva prin Supabase
      }
    }

    // Fallback StorageService (mod demo/local sau teste de integrare fără PG)
    const { StorageService } = await import('../services/StorageService.ts');
    const allLocalProducts = StorageService.getAllProducts();
    const resolution = resolveCanonicalProductDetail(requestedTargetId, allLocalProducts);
    if (resolution.cycleDetected) {
      return {
        success: false,
        statusCode: 409,
        error: `Referință circulară detectată pentru produsul '${requestedTargetId}'.`,
        candidateId
      };
    }
    if (!resolution.found || !resolution.canonicalId) {
      return {
        success: false,
        statusCode: 404,
        error: `Produsul țintă '${requestedTargetId}' nu există în catalog.`,
        candidateId
      };
    }

    const candidates = StorageService.getMatchCandidates();
    const existingCand = candidates.find(c => c.id === candidateId);
    if (!existingCand) {
      return {
        success: false,
        statusCode: 404,
        error: `Candidatul '${candidateId}' nu există.`,
        candidateId
      };
    }

    const previousProductId = existingCand.matchedProductId;
    const ok = StorageService.correctProductMatch(candidateId, resolution.canonicalId, reason, performedBy);
    if (!ok) {
      return {
        success: false,
        statusCode: 404,
        error: `Nu s-a putut actualiza candidatul '${candidateId}'.`,
        candidateId
      };
    }
    invalidateCatalogOptimizationCache();

    return {
      success: true,
      statusCode: 200,
      candidateId,
      previousProductId,
      correctedProductId: resolution.canonicalId,
      persistedIn: 'memory'
    };
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

  static async getCatalogSources(retailerId?: string): Promise<CatalogSource[]> {
    const pool = getPool();
    if (pool) {
      try {
        const res = retailerId
          ? await pool.query(
              `SELECT cs.id, cs.retailer_id AS "retailerId", COALESCE(s.name, UPPER(cs.retailer_id)) AS "retailerName", cs.name, cs.catalog_url AS "catalogUrl", cs.format, cs.status, cs.update_frequency_days AS "updateFrequencyDays", cs.auth_required AS "authRequired", cs.legal_status_notice AS "legalStatusNotice"
               FROM catalog_sources cs
               LEFT JOIN stores s ON s.id = cs.retailer_id
               WHERE cs.retailer_id = $1
               ORDER BY cs.name`,
              [retailerId]
            )
          : await pool.query(
              `SELECT cs.id, cs.retailer_id AS "retailerId", COALESCE(s.name, UPPER(cs.retailer_id)) AS "retailerName", cs.name, cs.catalog_url AS "catalogUrl", cs.format, cs.status, cs.update_frequency_days AS "updateFrequencyDays", cs.auth_required AS "authRequired", cs.legal_status_notice AS "legalStatusNotice"
               FROM catalog_sources cs
               LEFT JOIN stores s ON s.id = cs.retailer_id
               ORDER BY cs.retailer_id, cs.name`
            );
        return res.rows.map(r => ({
          id: r.id,
          retailerId: r.retailerId,
          retailerName: r.retailerName || r.retailerId.toUpperCase(),
          name: r.name,
          catalogUrl: r.catalogUrl,
          format: r.format || 'html',
          status: r.status || 'active',
          updateFrequencyDays: Number(r.updateFrequencyDays) || 7,
          authRequired: Boolean(r.authRequired),
          legalStatusNotice: r.legalStatusNotice || ''
        }));
      } catch {
        // Fallback la Supabase
      }
    }

    try {
      let query = supabase.from('catalog_sources').select('*');
      if (retailerId) query = query.eq('retailer_id', retailerId);
      const { data, error } = await query.order('retailer_id', { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map(r => ({
          id: r.id,
          retailerId: r.retailer_id,
          retailerName: String(r.retailer_id || '').toUpperCase(),
          name: r.name,
          catalogUrl: r.catalog_url,
          format: r.format || 'html',
          status: r.status || 'active',
          updateFrequencyDays: r.update_frequency_days || 7,
          authRequired: Boolean(r.auth_required),
          legalStatusNotice: r.legal_status_notice || ''
        }));
      }
    } catch {}

    return [];
  }

  static async saveCatalogSource(source: CatalogSource): Promise<boolean> {
    const pool = getPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO catalog_sources (id, retailer_id, name, catalog_url, format, status, update_frequency_days, auth_required, legal_status_notice)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             retailer_id = EXCLUDED.retailer_id,
             name = EXCLUDED.name,
             catalog_url = EXCLUDED.catalog_url,
             format = EXCLUDED.format,
             status = EXCLUDED.status,
             update_frequency_days = EXCLUDED.update_frequency_days,
             auth_required = EXCLUDED.auth_required,
             legal_status_notice = EXCLUDED.legal_status_notice`,
          [
            source.id,
            source.retailerId,
            source.name,
            source.catalogUrl,
            source.format,
            source.status,
            source.updateFrequencyDays || 7,
            Boolean(source.authRequired),
            source.legalStatusNotice || ''
          ]
        );
        return true;
      } catch {
        return false;
      }
    }

    try {
      const { error } = await supabase.from('catalog_sources').upsert({
        id: source.id,
        retailer_id: source.retailerId,
        name: source.name,
        catalog_url: source.catalogUrl,
        format: source.format,
        status: source.status,
        update_frequency_days: source.updateFrequencyDays || 7,
        auth_required: Boolean(source.authRequired),
        legal_status_notice: source.legalStatusNotice || ''
      }, { onConflict: 'id' });
      return !error;
    } catch {
      return false;
    }
  }

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
            valid_from, valid_until, image_url, matched_product_id, match_confidence, match_method,
            staging_status, validation_errors, reviewed_by, reviewed_at, rejection_reason,
            created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
          ON CONFLICT (id) DO UPDATE SET
            normal_price = EXCLUDED.normal_price,
            promo_price = EXCLUDED.promo_price,
            loyalty_price = EXCLUDED.loyalty_price,
            effective_price = EXCLUDED.effective_price,
            image_url = COALESCE(EXCLUDED.image_url, catalog_extracted_offers.image_url),
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
            o.imageUrl || null,
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
        imageUrl: r.image_url || undefined,
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

      // Preluăm produsele canonice (canonical_product_id IS NULL) și indexul complet de aliasuri
      const existingProductsRes = await client.query('SELECT * FROM products');
      const aliasIndex = buildCanonicalAliasIndex(existingProductsRes.rows);
      const dbProducts: Product[] = [];
      const canonicalProductsById = new Map<string, Product>();
      const allProductBarcodes = new Map<string, string>(); // barcode -> resolved canonical ID

      for (const r of existingProductsRes.rows) {
        const mappedProd: Product = {
          id: r.id,
          name: r.name,
          brand: r.brand,
          category: r.category as any,
          defaultUnit: r.default_unit,
          packageWeightOrVolume: parseFloat(r.package_weight_or_volume),
          packageUnit: r.package_unit,
          normalizedUnit: r.normalized_unit,
          barcode: r.barcode || undefined,
          imageUrl: r.image_url || undefined,
          baseReferencePrice: parseFloat(r.base_reference_price),
          isRomanianProduct: r.is_romanian_product,
          canonicalProductId: r.canonical_product_id || null
        };
        if (!r.canonical_product_id) {
          dbProducts.push(mappedProd);
          canonicalProductsById.set(mappedProd.id, mappedProd);
        }
        if (mappedProd.barcode && mappedProd.barcode.trim().length >= 8) {
          const resolvedRootId = resolveCanonicalProductId(mappedProd.id, aliasIndex);
          if (resolvedRootId) {
            for (const bc of normalizeBarcodeCandidates(mappedProd.barcode)) {
              if (!allProductBarcodes.has(bc) || !r.canonical_product_id) {
                allProductBarcodes.set(bc, resolvedRootId);
              }
            }
          }
        }
      }

      const publishedDocumentIds = new Set<string>();

      for (const item of params.offers) {
        // Verificare atomică status curent în staging (protecție la dublă publicare sau oferte neaprobate)
        const rowStateRes = await client.query(
          'SELECT staging_status, document_id FROM catalog_extracted_offers WHERE id = $1 FOR UPDATE',
          [item.id]
        );
        const dbStagingStatus = rowStateRes.rows[0]?.staging_status
          ? String(rowStateRes.rows[0].staging_status).toUpperCase()
          : null;
        if (dbStagingStatus === 'PUBLISHED') {
          continue;
        }
        if (dbStagingStatus && params.autoPublish && dbStagingStatus !== 'APPROVED' && dbStagingStatus !== 'VALIDATED') {
          stats.errors.push(`Oferta "${item.rawTitle}" (${item.id}) are status ${dbStagingStatus} și nu este eligibilă pentru publicare.`);
          continue;
        }

        // Validare strictă preț vs cantitate înainte de publicare
        if (!item.effectivePrice || item.effectivePrice <= 0 || isNaN(item.effectivePrice)) {
          stats.itemsWithoutPriceCount++;
          continue;
        }
        const prePublishPriceCheck = PriceExtractor.validateOfferPrice({
          title: item.rawTitle,
          normalPrice: item.normalPrice,
          promoPrice: item.promoPrice,
          loyaltyPrice: item.loyaltyPrice,
          effectivePrice: item.effectivePrice,
          unitPrice: item.unitPrice,
          packageQuantity: item.packageQuantity,
          packageUnit: item.packageUnit,
          proofType: (item.priceProofType as any) || undefined,
          isVerifiedOverride: dbStagingStatus === 'APPROVED' && Boolean(item.reviewedBy)
        });
        if (prePublishPriceCheck.status !== 'VALID') {
          stats.itemsWithoutPriceCount++;
          stats.errors.push(`Ofertă blocată la publicare (${item.rawTitle}): ${prePublishPriceCheck.reasons.join(' ')}`);
          continue;
        }

        const deterministicSku = buildCanonicalExternalSku({
          retailerId: params.retailerId,
          retailerSku: item.retailerSku,
          barcode: item.rawBarcode,
          catalogUrl: item.catalogUrl,
          sourcePageUrl: item.sourcePageUrl,
          documentUrl: item.documentUrl,
          title: item.rawTitle,
          packageQuantity: item.packageQuantity,
          packageUnit: item.packageUnit
        });
        const productPageUrl = pickRetailerProductUrl({
          catalogUrl: item.catalogUrl,
          sourcePageUrl: item.sourcePageUrl,
          documentUrl: item.documentUrl
        });
        const barcodeVariants = item.rawBarcode ? normalizeBarcodeCandidates(item.rawBarcode) : [];

        let canonicalProduct: Product | undefined = undefined;
        const knownCanonicalIds = new Set(canonicalProductsById.keys());

        // Pas 1: Căutare produs canonic (rezolvând strict eventualele aliasuri până la rădăcina canonică)
        // 1.1 După matchedProductId dacă este specificat -> fără fallback dacă referința explicită e invalidă
        if (item.matchedProductId) {
          const matchDetail = resolveCanonicalProductDetail(item.matchedProductId, aliasIndex, {
            knownProductIds: knownCanonicalIds
          });
          if (matchDetail.cycleDetected || !matchDetail.found || !matchDetail.canonicalId) {
            stats.errors.push(
              `Ofertă blocată la publicare (${item.rawTitle} / ${item.id}): referință canonică invalidă (${item.matchedProductId}).`
            );
            continue;
          }
          canonicalProduct = canonicalProductsById.get(matchDetail.canonicalId);
        }

        // 1.2 După cod de bare (GTIN / EAN, inclusiv variante UPC-A/EAN-13 și aliasuri)
        if (!item.matchedProductId && !canonicalProduct && barcodeVariants.length > 0) {
          for (const bc of barcodeVariants) {
            const matchedRootId = allProductBarcodes.get(bc);
            if (matchedRootId && canonicalProductsById.has(matchedRootId)) {
              canonicalProduct = canonicalProductsById.get(matchedRootId);
              break;
            }
          }
        }

        // 1.3 După retailer_products mapping (rezolvând orice alias spre rădăcina canonică)
        if (!item.matchedProductId && !canonicalProduct) {
          const mapRes = await client.query(
            `SELECT rp.product_id
             FROM retailer_products rp
             WHERE rp.retailer_id = $1
               AND rp.product_id IS NOT NULL
               AND (
                 rp.external_sku = $2
                 OR ($3::text[] IS NOT NULL AND rp.barcode = ANY($3::text[]))
               )
             LIMIT 1`,
            [params.retailerId, deterministicSku, barcodeVariants.length > 0 ? barcodeVariants : null]
          );
          if (mapRes.rows.length > 0 && mapRes.rows[0].product_id) {
            const rpDetail = resolveCanonicalProductDetail(String(mapRes.rows[0].product_id), aliasIndex, {
              knownProductIds: knownCanonicalIds
            });
            if (rpDetail.found && !rpDetail.cycleDetected && rpDetail.canonicalId) {
              canonicalProduct = canonicalProductsById.get(rpDetail.canonicalId);
            }
          }
        }

        // 1.4 După similaritate text & atribute prin ProductMatcher (strict pe produse canonice)
        if (!item.matchedProductId && !canonicalProduct) {
          const matchResult = ProductMatcher.matchProduct({
            rawName: item.rawTitle,
            barcode: item.rawBarcode,
            brand: item.rawBrand,
            packageWeightOrVolume: item.packageQuantity,
            packageUnit: item.packageUnit as any,
            category: item.rawCategory
          }, dbProducts);

          if (matchResult.matchedProduct && matchResult.confidence >= 0.75) {
            canonicalProduct = canonicalProductsById.get(matchResult.matchedProduct.id);
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
            for (const bc of normalizeBarcodeCandidates(canonicalProduct.barcode)) {
              allProductBarcodes.set(bc, canonicalProduct.id);
            }
            updated = true;
          }
          if (!canonicalProduct.imageUrl && item.imageUrl) {
            canonicalProduct.imageUrl = item.imageUrl;
            await client.query('UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2', [
              item.imageUrl,
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
            imageUrl: item.imageUrl || undefined,
            baseReferencePrice: item.normalPrice || item.effectivePrice,
            isRomanianProduct: true,
            canonicalProductId: null
          };

          const insertResult = await client.query(
            `INSERT INTO products (
              id, name, brand, category, default_unit, package_weight_or_volume,
              package_unit, normalized_unit, barcode, image_url, is_romanian_product, base_reference_price
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
              item.imageUrl || null,
              newProd.isRomanianProduct,
              newProd.baseReferencePrice
            ]
          );

          if (insertResult.rows.length > 0) {
            stats.newProductsCount++;
            canonicalProduct = newProd;
            dbProducts.push(newProd);
            canonicalProductsById.set(newProd.id, newProd);
            aliasIndex.parentById.set(newProd.id, null);
            if (safeBarcode) {
              for (const bc of normalizeBarcodeCandidates(safeBarcode)) {
                allProductBarcodes.set(bc, newProd.id);
              }
            }
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
              imageUrl: existing.image_url || undefined,
              baseReferencePrice: parseFloat(existing.base_reference_price),
              isRomanianProduct: existing.is_romanian_product,
              canonicalProductId: null
            };
            stats.identifiedExistingCount++;
            if (!canonicalProduct.imageUrl && item.imageUrl) {
              canonicalProduct.imageUrl = item.imageUrl;
              await client.query('UPDATE products SET image_url = $1, updated_at = NOW() WHERE id = $2', [
                item.imageUrl,
                canonicalProduct.id
              ]);
              stats.updatedProductsCount++;
            } else {
              stats.unchangedProductsCount++;
            }
            if (!canonicalProductsById.has(canonicalProduct.id)) {
              dbProducts.push(canonicalProduct);
              canonicalProductsById.set(canonicalProduct.id, canonicalProduct);
              aliasIndex.parentById.set(canonicalProduct.id, null);
            }
          }
        }

        const canonicalId = canonicalProduct.id;
        item.matchedProductId = canonicalId;
        item.matchedProductName = canonicalProduct.name;

        // Pas 2: Asociere idempotentă în retailer_products (external_sku determinist + url produs)
        const externalSku = deterministicSku.slice(0, 120);
        const skuSlug = externalSku.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 40) || 'item';
        const fallbackRpId = `rp-${params.retailerId}-${skuSlug}`.slice(0, 60);

        const safeScrapedName = (item.rawTitle || 'Produs fără nume').trim().slice(0, 250);
        const safeScrapedBrand = item.rawBrand ? item.rawBrand.trim().slice(0, 120) : null;
        const safeScrapedUnit = item.packageUnit ? String(item.packageUnit).slice(0, 16) : null;
        const safeScrapedBarcode = item.rawBarcode ? item.rawBarcode.trim().slice(0, 60) : null;

        const existingRpRes = await client.query(
          `SELECT id FROM retailer_products
           WHERE retailer_id = $1
             AND (
               external_sku = $2
               OR ($3::varchar IS NOT NULL AND barcode = $3)
             )
           ORDER BY last_scraped_at DESC
           LIMIT 1`,
          [params.retailerId, externalSku, safeScrapedBarcode]
        );

        if (existingRpRes.rows.length > 0) {
          await client.query(
            `UPDATE retailer_products
             SET product_id = $2,
                 external_sku = COALESCE($3, external_sku),
                 url = COALESCE($4, url),
                 scraped_name = $5,
                 scraped_brand = COALESCE($6, scraped_brand),
                 scraped_package_weight_or_volume = COALESCE($7, scraped_package_weight_or_volume),
                 scraped_package_unit = COALESCE($8, scraped_package_unit),
                 barcode = COALESCE($9, barcode),
                 last_scraped_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [
              existingRpRes.rows[0].id,
              canonicalId,
              externalSku,
              productPageUrl || null,
              safeScrapedName,
              safeScrapedBrand,
              item.packageQuantity || null,
              safeScrapedUnit,
              safeScrapedBarcode
            ]
          );
        } else {
          await client.query(
            `INSERT INTO retailer_products (
              id, retailer_id, product_id, external_sku, url, scraped_name,
              scraped_brand, scraped_package_weight_or_volume, scraped_package_unit,
              barcode, last_scraped_at, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'active')
            ON CONFLICT (id) DO UPDATE SET
              product_id = EXCLUDED.product_id,
              external_sku = COALESCE(EXCLUDED.external_sku, retailer_products.external_sku),
              url = COALESCE(EXCLUDED.url, retailer_products.url),
              scraped_name = EXCLUDED.scraped_name,
              scraped_brand = COALESCE(EXCLUDED.scraped_brand, retailer_products.scraped_brand),
              barcode = COALESCE(EXCLUDED.barcode, retailer_products.barcode),
              last_scraped_at = NOW(),
              updated_at = NOW()`,
            [
              fallbackRpId,
              params.retailerId,
              canonicalId,
              externalSku,
              productPageUrl || null,
              safeScrapedName,
              safeScrapedBrand,
              item.packageQuantity || null,
              safeScrapedUnit,
              safeScrapedBarcode
            ]
          );
        }

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
        const effectiveDocId = item.documentId || rowStateRes.rows[0]?.document_id;
        if (effectiveDocId) {
          publishedDocumentIds.add(String(effectiveDocId));
        }
        await client.query(
          `UPDATE catalog_extracted_offers SET
            staging_status = 'PUBLISHED',
            matched_product_id = $1,
            validation_errors = NULL,
            updated_at = NOW()
          WHERE id = $2`,
          [canonicalId, item.id]
        );
      }

      for (const docId of publishedDocumentIds) {
        await client.query(
          `UPDATE catalog_documents d
           SET published_count = (
                 SELECT count(*) FROM catalog_extracted_offers o
                 WHERE o.document_id = d.id AND UPPER(o.staging_status) = 'PUBLISHED'
               ),
               updated_at = NOW()
           WHERE d.id = $1`,
          [docId]
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
      invalidateCatalogOptimizationCache();
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
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';

    if (isIsolated) {
      const [{ StorageService }, canonicalProds, canonicalOffers] = await Promise.all([
        import('../services/StorageService.ts'),
        this.getProducts(),
        this.getOffers()
      ]);
      const extractedOffers = StorageService.getCatalogExtractedOffers();
      const observations = StorageService.getPriceObservations();
      return {
        overallStatus: 'TOTUL FUNCȚIONEAZĂ',
        statusMessage: 'Metrici calculate în modul izolat din produse canonice distincte.',
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
          message: 'Rulează în mod izolat în memorie.'
        },
        kpis: {
          configuredRetailers: { key: 'configuredRetailers', label: 'Retaileri Configurați', value: 8, period: 'Permanent', updatedAt: fallbackNow, status: 'positive' },
          configuredSources: { key: 'configuredSources', label: 'Surse Configurate', value: configuredSourcesCount, period: 'Permanent', updatedAt: fallbackNow, status: 'positive' },
          activeSources: { key: 'activeSources', label: 'Surse Funcționale', value: activeSourcesCount, period: 'Permanent', updatedAt: fallbackNow, status: 'positive' },
          discoveredDocuments: { key: 'discoveredDocuments', label: 'Documente Descoperite', value: StorageService.getCatalogDocuments().length, period: 'Total', updatedAt: fallbackNow, status: 'neutral' },
          downloadedDocuments: { key: 'downloadedDocuments', label: 'Documente Descărcate', value: 0, period: 'Total', updatedAt: fallbackNow, status: 'neutral' },
          extractedProducts: { key: 'extractedProducts', label: 'Produse Extrase', value: extractedOffers.length, period: 'Total', updatedAt: fallbackNow, status: 'neutral' },
          distinctProducts: { key: 'distinctProducts', label: 'Produse Distincte', value: canonicalProds.length, period: 'Catalog Public', updatedAt: fallbackNow, status: 'positive' },
          newProducts: { key: 'newProducts', label: 'Produse Noi', value: 0, period: 'Ultima rulare', updatedAt: fallbackNow, status: 'neutral' },
          updatedProducts: { key: 'updatedProducts', label: 'Produse Actualizate', value: 0, period: 'Ultima rulare', updatedAt: fallbackNow, status: 'neutral' },
          extractedOffers: { key: 'extractedOffers', label: 'Oferte Extrase', value: extractedOffers.length, period: 'Staging', updatedAt: fallbackNow, status: 'neutral' },
          validatedOffers: { key: 'validatedOffers', label: 'Oferte Validate', value: extractedOffers.filter(o => o.stagingStatus === 'VALIDATED').length, period: 'Staging', updatedAt: fallbackNow, status: 'neutral' },
          approvedOffers: { key: 'approvedOffers', label: 'Oferte Aprobate', value: extractedOffers.filter(o => o.stagingStatus === 'APPROVED').length, period: 'Staging', updatedAt: fallbackNow, status: 'neutral' },
          publishedOffers: { key: 'publishedOffers', label: 'Oferte Publicate', value: canonicalOffers.length, period: 'Catalog Public', updatedAt: fallbackNow, status: 'positive' },
          changedPrices: { key: 'changedPrices', label: 'Prețuri Modificate', value: observations.length, period: 'Istoric', updatedAt: fallbackNow, status: 'neutral' },
          itemsWithoutPrice: { key: 'itemsWithoutPrice', label: 'Produse Fără Preț', value: 0, period: 'Protecție', updatedAt: fallbackNow, status: 'neutral' },
          processingErrors: { key: 'processingErrors', label: 'Erori de Procesare', value: 0, period: 'Total', updatedAt: fallbackNow, status: 'neutral' }
        },
        pipelineStages: [
          { stage: 'discovery', name: 'Descoperire', status: 'PASS', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'download', name: 'Descărcare', status: 'PASS', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'parse', name: 'Parsare', status: 'PASS', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'validation', name: 'Validare', status: 'PASS', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'approval', name: 'Aprobare', status: 'PASS', processedCount: 0, pendingCount: 0, errorCount: 0 },
          { stage: 'publishing', name: 'Publicare', status: 'PASS', processedCount: 0, pendingCount: 0, errorCount: 0 }
        ],
        activeAlerts: []
      };
    }

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
          (SELECT count(*) FROM products WHERE canonical_product_id IS NULL) AS distinct_products,
          (SELECT count(*) FROM product_offers) AS published_offers,
          (SELECT count(*) FROM price_observations) AS price_observations,
          (SELECT count(*) FROM promotions WHERE ends_at IS NULL OR ends_at >= CURRENT_DATE) AS active_promotions,
          (SELECT count(*) FROM catalog_sources) AS configured_sources,
          (SELECT count(*) FROM catalog_sources WHERE status = 'active') AS active_sources,
          (SELECT count(DISTINCT retailer_id) FROM catalog_sources) AS configured_retailers_count,
          (SELECT count(*) FROM catalog_documents) AS total_documents,
          (SELECT count(*) FROM catalog_documents WHERE download_status = 'downloaded') AS downloaded_documents,
          (SELECT count(*) FROM catalog_extracted_offers) AS total_extracted_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE UPPER(staging_status) = 'VALIDATED') AS validated_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE UPPER(staging_status) = 'APPROVED') AS approved_only_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE UPPER(staging_status) IN ('APPROVED', 'VALIDATED') AND effective_price > 0) AS ready_to_publish_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE UPPER(COALESCE(staging_status, 'NEEDS_REVIEW')) IN ('NEEDS_REVIEW', 'DISCOVERED', 'PARSED')) AS needs_review_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE UPPER(staging_status) = 'PUBLISHED') AS published_staging_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE UPPER(staging_status) = 'REJECTED') AS rejected_offers,
          (SELECT count(*) FROM catalog_extracted_offers WHERE effective_price IS NULL OR effective_price <= 0) AS items_without_price,
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
      const approvedOnlyOffers = parseInt(counts.approved_only_offers || '0', 10);
      const readyToPublishOffers = parseInt(counts.ready_to_publish_offers || '0', 10);
      const approvedAndValidatedOffers = approvedOnlyOffers + validatedOffers;
      const needsReviewOffers = parseInt(counts.needs_review_offers || '0', 10);
      const publishedStagingOffers = parseInt(counts.published_staging_offers || '0', 10);
      const itemsWithoutPrice = parseInt(counts.items_without_price || '0', 10);
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
            period: 'Validate automat în staging',
            updatedAt: lastRunAt,
            status: validatedOffers > 0 ? 'positive' : 'neutral'
          },
          approvedOffers: {
            key: 'approvedOffers',
            label: 'Oferte Aprobate & Pregătite',
            value: approvedAndValidatedOffers,
            period: 'Pregătite pentru publicare',
            updatedAt: lastRunAt,
            status: approvedAndValidatedOffers > 0 ? 'positive' : 'neutral'
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
            value: itemsWithoutPrice,
            period: 'Izolate în staging (preț 0/nul)',
            updatedAt: lastRunAt,
            status: itemsWithoutPrice > 0 ? 'warning' : 'positive'
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
            status: (validatedOffers + approvedOnlyOffers + publishedStagingOffers) > 0 || needsReviewOffers > 0 ? 'PASS' : 'PENDING',
            processedCount: validatedOffers + approvedOnlyOffers + publishedStagingOffers,
            pendingCount: needsReviewOffers,
            errorCount: processingErrors,
            lastExecutedAt: lastRunAt
          },
          {
            stage: 'approval',
            name: '5. Aprobare',
            status: readyToPublishOffers > 0 || publishedStagingOffers > 0 ? 'PASS' : 'PENDING',
            processedCount: readyToPublishOffers,
            pendingCount: needsReviewOffers,
            errorCount: 0,
            lastExecutedAt: lastRunAt
          },
          {
            stage: 'publishing',
            name: '6. Publicare',
            status: publishedOffers > 0 ? 'PASS' : 'PENDING',
            processedCount: publishedOffers,
            pendingCount: readyToPublishOffers,
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
    if (process.env.COSUL_MEU_ISOLATED_TEST === '1' || !pool) {
      let all = await this.getProducts();
      const offers: ProductOffer[] = await this.getOffers();

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

      const offersByProduct = new Map<string, Map<string, ProductOffer>>();
      for (const off of offers) {
        const storeKey = normalizeStoreIdKey(off.storeId);
        let storeMap = offersByProduct.get(off.productId);
        if (!storeMap) {
          storeMap = new Map<string, ProductOffer>();
          offersByProduct.set(off.productId, storeMap);
        }
        const prev = storeMap.get(storeKey);
        const curDate = `${off.observationDate || ''}:${off.lastChecked || ''}`;
        const prevDate = prev ? `${prev.observationDate || ''}:${prev.lastChecked || ''}` : '';
        if (!prev || curDate >= prevDate) {
          storeMap.set(storeKey, off);
        }
      }

      if (params.retailer && params.retailer !== 'toate') {
        const cleanRet = normalizeStoreIdKey(params.retailer);
        all = all.filter(p => offersByProduct.get(p.id)?.has(cleanRet));
      }

      const total = all.length;
      const paged = all.slice(params.offset, params.offset + params.limit).map(p => {
        const storeOffers = Array.from(offersByProduct.get(p.id)?.values() || []);
        const prices = storeOffers.map(o => o.price);
        return {
          ...p,
          offersCount: storeOffers.length,
          minPrice: prices.length > 0 ? Math.min(...prices) : null,
          maxPrice: prices.length > 0 ? Math.max(...prices) : null,
          offers: storeOffers.map(o => ({
            storeId: o.storeId,
            price: o.price,
            isPromo: o.isPromo,
            normalPrice: o.normalPrice,
            promoPrice: o.promoPrice,
            loyaltyPrice: o.loyaltyPrice
          }))
        };
      });
      return { products: paged, total };
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
          JOIN resolved_root rr_ret ON rr_ret.node_id = po_ret.product_id
          WHERE rr_ret.root_id = p.id
            AND COALESCE(po_ret.verification_status, 'verified') NOT IN ('demo', 'isolated', 'rejected')
            AND COALESCE(po_ret.is_flagged_anomaly, false) = false
            AND po_ret.price > 0
            AND (lower(po_ret.store_id) = $${idx} OR lower(po_ret.store_id) = ('store-' || $${idx}) OR replace(lower(po_ret.store_id), 'store-', '') = $${idx})
        )`);
        values.push(cleanRet);
        idx++;
      }

      const whereClause = conditions.join(' AND ');

      const countRes = await pool.query(
        `WITH RECURSIVE canonical_map AS (
           SELECT id AS node_id, id AS current_id, canonical_product_id, ARRAY[id::text]::text[] AS path, 0 AS depth
           FROM products
           UNION ALL
           SELECT cm.node_id, p2.id AS current_id, p2.canonical_product_id, (cm.path || p2.id::text)::text[], cm.depth + 1
           FROM canonical_map cm
           JOIN products p2 ON p2.id = cm.canonical_product_id
           WHERE cm.canonical_product_id IS NOT NULL
             AND NOT (p2.id::text = ANY(cm.path))
             AND cm.depth < 16
         ),
         resolved_root AS (
           SELECT node_id, current_id AS root_id
           FROM canonical_map
           WHERE canonical_product_id IS NULL
         )
         SELECT count(*) FROM products p WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const limitIdx = idx;
      values.push(params.limit);
      const offsetIdx = idx + 1;
      values.push(params.offset);

      const query = `
        WITH RECURSIVE canonical_map AS (
          SELECT id AS node_id, id AS current_id, canonical_product_id, ARRAY[id::text]::text[] AS path, 0 AS depth
          FROM products
          UNION ALL
          SELECT cm.node_id, p2.id AS current_id, p2.canonical_product_id, (cm.path || p2.id::text)::text[], cm.depth + 1
          FROM canonical_map cm
          JOIN products p2 ON p2.id = cm.canonical_product_id
          WHERE cm.canonical_product_id IS NOT NULL
            AND NOT (p2.id::text = ANY(cm.path))
            AND cm.depth < 16
        ),
        resolved_root AS (
          SELECT node_id, current_id AS root_id
          FROM canonical_map
          WHERE canonical_product_id IS NULL
        ),
        paged_products AS (
          SELECT p.*
          FROM products p
          WHERE ${whereClause}
          ORDER BY p.updated_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        ),
        latest_offers_per_root AS (
          SELECT DISTINCT ON (rr.root_id, po.store_id)
            rr.root_id,
            po.store_id,
            po.price,
            po.is_promo,
            po.normal_price,
            po.promo_price,
            po.loyalty_price
          FROM product_offers po
          JOIN resolved_root rr ON rr.node_id = po.product_id
          JOIN paged_products pp ON pp.id = rr.root_id
          WHERE COALESCE(po.verification_status, 'verified') NOT IN ('demo', 'isolated', 'rejected')
            AND COALESCE(po.is_flagged_anomaly, false) = false
            AND po.price > 0
          ORDER BY rr.root_id, po.store_id, po.observation_date DESC, po.last_checked DESC
        ),
        agg_offers AS (
          SELECT
            root_id,
            count(*)::int AS "offersCount",
            min(price) AS "minPrice",
            max(price) AS "maxPrice",
            json_agg(json_build_object(
              'storeId', store_id,
              'price', price,
              'isPromo', is_promo,
              'normalPrice', normal_price,
              'promoPrice', promo_price,
              'loyaltyPrice', loyalty_price
            )) AS "offers"
          FROM latest_offers_per_root
          GROUP BY root_id
        )
        SELECT 
          p.id, p.name, p.brand, p.category, p.default_unit AS "defaultUnit",
          p.package_weight_or_volume AS "packageWeightOrVolume", p.package_unit AS "packageUnit",
          p.normalized_unit AS "normalizedUnit", p.barcode, p.image_url AS "imageUrl",
          p.is_bio AS "isBio", p.is_romanian_product AS "isRomanianProduct",
          p.base_reference_price AS "baseReferencePrice",
          p.created_at AS "createdAt", p.updated_at AS "updatedAt",
          COALESCE(ao."offersCount", 0) AS "offersCount",
          ao."minPrice",
          ao."maxPrice",
          ao."offers"
        FROM paged_products p
        LEFT JOIN agg_offers ao ON ao.root_id = p.id
        ORDER BY p.updated_at DESC
      `;

      const res = await pool.query(query, values);
      return { products: res.rows, total };
    } catch (err: any) {
      console.error('Eroare getProductsDetailed:', err.message);
      return { products: [], total: 0 };
    }
  }

  /**
   * Ștergere / delistare sigură a produselor (blochează ștergerea dacă există istoric append-only în price_observations)
   */
  static async deleteProducts(productIds: string[]): Promise<{
    deletedCount: number;
    blockedCount?: number;
    blockedIds?: string[];
    partialModification?: boolean;
    partialDeletions?: Array<{ table: string; targetIdsCount: number }>;
    error?: string;
  }> {
    if (!productIds || productIds.length === 0) return { deletedCount: 0, blockedCount: 0, blockedIds: [] };

    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      return StorageService.deleteProducts(productIds);
    }

    const pool = getPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Colectare descendenți multi-hop cu protecție împotriva ciclurilor
        const treeRes = await client.query(
          `WITH RECURSIVE descendants AS (
             SELECT id AS root_req_id, id AS node_id, ARRAY[id::text]::text[] AS path, 0 AS depth
             FROM products
             WHERE id = ANY($1::varchar[])
             UNION ALL
             SELECT d.root_req_id, p.id AS node_id, (d.path || p.id::text)::text[], d.depth + 1
             FROM products p
             JOIN descendants d ON p.canonical_product_id = d.node_id
             WHERE NOT (p.id::text = ANY(d.path))
               AND d.depth < 16
           )
           SELECT root_req_id, node_id FROM descendants`,
          [productIds]
        );

        const subtreeByReqId = new Map<string, Set<string>>();
        for (const reqId of productIds) {
          subtreeByReqId.set(reqId, new Set([reqId]));
        }
        for (const row of treeRes.rows) {
          const set = subtreeByReqId.get(String(row.root_req_id)) || new Set<string>();
          set.add(String(row.node_id));
          subtreeByReqId.set(String(row.root_req_id), set);
        }

        const allCandidateIds = Array.from(
          new Set(Array.from(subtreeByReqId.values()).flatMap(s => Array.from(s)))
        );

        // Verificare strictă: NU ștergem niciodată price_observations (tabel protejat append-only)
        const obsCheckRes = await client.query(
          `SELECT DISTINCT product_id FROM price_observations WHERE product_id = ANY($1::varchar[])`,
          [allCandidateIds]
        );
        const obsProtectedIds = new Set(obsCheckRes.rows.map(r => String(r.product_id)));

        const blockedIds: string[] = [];
        const eligibleSubtreeIds = new Set<string>();

        for (const reqId of Array.from(new Set(productIds))) {
          const subtree = subtreeByReqId.get(reqId) || new Set([reqId]);
          const hasObs = Array.from(subtree).some(nid => obsProtectedIds.has(nid));
          if (hasObs) {
            blockedIds.push(reqId);
          } else {
            for (const nid of subtree) eligibleSubtreeIds.add(nid);
          }
        }

        const targetIds = Array.from(eligibleSubtreeIds);
        let deletedCount = 0;

        if (targetIds.length > 0) {
          await client.query(`DELETE FROM product_offers WHERE product_id = ANY($1)`, [targetIds]);
          await client.query(`DELETE FROM promotions WHERE product_id = ANY($1)`, [targetIds]);
          await client.query(`DELETE FROM retailer_products WHERE product_id = ANY($1)`, [targetIds]);
          await client.query(`DELETE FROM product_match_candidates WHERE matched_product_id = ANY($1)`, [targetIds]);
          await client.query(`DELETE FROM product_matches WHERE product_id = ANY($1)`, [targetIds]);
          const delRes = await client.query(`DELETE FROM products WHERE id = ANY($1)`, [targetIds]);
          deletedCount = delRes.rowCount || 0;
        }

        await client.query('COMMIT');
        invalidateCatalogOptimizationCache();

        const error =
          blockedIds.length > 0
            ? `Ștergerea a fost blocată pentru ${blockedIds.length} produs(e) deoarece au observații istorice protejate în price_observations.`
            : undefined;
        return {
          deletedCount,
          blockedCount: blockedIds.length,
          blockedIds,
          ...(error ? { error } : {})
        };
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('Eroare la ștergerea produselor din PostgreSQL:', err.message);
        return {
          deletedCount: 0,
          blockedCount: productIds.length,
          blockedIds: productIds,
          error: `Ștergerea nu a putut fi finalizată sigur: ${err.message}`
        };
      } finally {
        client.release();
      }
    }

    // Fallback Supabase fail-closed (verifică price_observations exhaustiv, fără a executa DELETE asupra tabelului append-only)
    return this.deleteProductsViaSupabase(productIds);
  }

  /**
   * Execuție fail-closed pentru ștergerea produselor prin clientul Supabase:
   * - Verifică `error` și forma validă a răspunsului pe fiecare interogare de protecție și pe fiecare `DELETE`.
   * - Verifică exhaustiv toate observațiile din `price_observations` fără `.limit(1000)` și fără a presupune o limită fixă de pagină.
   * - La orice eroare sau rezultat ambiguu înainte de prima ștergere oprește operația cu `deletedCount: 0` și ZERO apeluri `DELETE`.
   * - Deoarece Supabase REST nu oferă tranzacții multi-tabel, raportează explicit modificările parțiale dacă o ștergere eșuează pe parcurs.
   */
  static async deleteProductsViaSupabase(
    productIds: string[],
    supabaseClientOverride?: any
  ): Promise<{
    deletedCount: number;
    blockedCount?: number;
    blockedIds?: string[];
    partialModification?: boolean;
    partialDeletions?: Array<{ table: string; targetIdsCount: number }>;
    error?: string;
  }> {
    const uniqueRequestedIds = Array.from(
      new Set((productIds || []).map(id => String(id || '').trim()).filter(Boolean))
    );
    if (uniqueRequestedIds.length === 0) {
      return { deletedCount: 0, blockedCount: 0, blockedIds: [], partialModification: false, partialDeletions: [] };
    }

    const client = supabaseClientOverride || supabase;
    const partialDeletions: Array<{ table: string; targetIdsCount: number }> = [];
    const deletedProductIds = new Set<string>();
    let deletedCount = 0;

    try {
      const prodNodes: CanonicalProductNode[] = [];
      const PROD_PAGE_SIZE = 1000;
      let prodOffset = 0;

      while (true) {
        const { data: prodPage, error: prodNodesError } = await client
          .from('products')
          .select('id, canonical_product_id')
          .range(prodOffset, prodOffset + PROD_PAGE_SIZE - 1);

        if (prodNodesError || !Array.isArray(prodPage)) {
          return {
            deletedCount: 0,
            blockedCount: uniqueRequestedIds.length,
            blockedIds: uniqueRequestedIds,
            partialModification: false,
            partialDeletions: [],
            error: `Ștergerea a fost oprită: nu am putut verifica arborele produselor (${prodNodesError?.message || 'răspuns invalid sau ambiguu la products'}).`
          };
        }

        if (prodPage.length === 0) {
          break;
        }

        for (const r of prodPage) {
          if (!r || typeof r.id !== 'string' || !r.id.trim()) {
            return {
              deletedCount: 0,
              blockedCount: uniqueRequestedIds.length,
              blockedIds: uniqueRequestedIds,
              partialModification: false,
              partialDeletions: [],
              error: 'Ștergerea a fost oprită: rând ambiguu fără id valid returnat de products.'
            };
          }
          prodNodes.push({
            id: r.id,
            canonical_product_id: r.canonical_product_id ?? null
          });
        }

        prodOffset += prodPage.length;
      }

      const aliasIdx = buildCanonicalAliasIndex(prodNodes);
      const collectSubtree = (rootId: string): string[] => {
        const visited = new Set<string>([rootId]);
        const q = [rootId];
        while (q.length > 0) {
          const cur = q.shift()!;
          const ch = aliasIdx.childrenByCanonicalId.get(cur);
          if (!ch) continue;
          for (const c of ch) {
            if (!visited.has(c)) {
              visited.add(c);
              q.push(c);
            }
          }
        }
        return Array.from(visited);
      };

      const candidateAll = Array.from(new Set(uniqueRequestedIds.flatMap(collectSubtree)));
      const obsProtected = new Set<string>();
      const OBS_CHUNK_SIZE = 100;
      const OBS_PAGE_SIZE = 1000;

      for (let i = 0; i < candidateAll.length; i += OBS_CHUNK_SIZE) {
        let remaining = candidateAll.slice(i, i + OBS_CHUNK_SIZE);
        let offset = 0;

        while (remaining.length > 0) {
          const { data: obsRows, error: obsError } = await client
            .from('price_observations')
            .select('product_id')
            .in('product_id', remaining)
            .range(offset, offset + OBS_PAGE_SIZE - 1);

          if (obsError || !Array.isArray(obsRows)) {
            return {
              deletedCount: 0,
              blockedCount: uniqueRequestedIds.length,
              blockedIds: uniqueRequestedIds,
              partialModification: false,
              partialDeletions: [],
              error: `Ștergerea a fost oprită înainte de orice mutație: verificarea protecției price_observations a eșuat sau a returnat un rezultat ambiguu (${obsError?.message || 'răspuns non-array'}).`
            };
          }

          if (obsRows.length === 0) {
            break;
          }

          let addedNew = 0;
          for (const r of obsRows) {
            if (!r || typeof r.product_id !== 'string' || !r.product_id.trim()) {
              return {
                deletedCount: 0,
                blockedCount: uniqueRequestedIds.length,
                blockedIds: uniqueRequestedIds,
                partialModification: false,
                partialDeletions: [],
                error: 'Ștergerea a fost oprită: rând ambiguu fără product_id valid returnat de price_observations.'
              };
            }
            const pid = r.product_id.trim();
            if (!obsProtected.has(pid)) {
              obsProtected.add(pid);
              addedNew++;
            }
          }

          const nextRemaining = remaining.filter(id => !obsProtected.has(id));
          if (nextRemaining.length === 0) {
            break;
          }
          if (nextRemaining.length < remaining.length || addedNew > 0) {
            remaining = nextRemaining;
            offset = 0;
          } else {
            offset += obsRows.length;
          }
        }
      }

      const blockedIds: string[] = [];
      const eligibleSubtrees: Array<{ reqId: string; ids: string[] }> = [];
      for (const reqId of uniqueRequestedIds) {
        const sub = collectSubtree(reqId);
        if (sub.some(nid => obsProtected.has(nid))) {
          blockedIds.push(reqId);
        } else {
          eligibleSubtrees.push({ reqId, ids: sub });
        }
      }

      const targetIds = Array.from(new Set(eligibleSubtrees.flatMap(entry => entry.ids)));

      if (targetIds.length > 0) {
        const DELETE_CHUNK_SIZE = 100;
        const childTables: Array<{ table: string; column: string }> = [
          { table: 'product_offers', column: 'product_id' },
          { table: 'promotions', column: 'product_id' },
          { table: 'retailer_products', column: 'product_id' },
          { table: 'product_match_candidates', column: 'matched_product_id' },
          { table: 'product_matches', column: 'product_id' }
        ];

        for (let i = 0; i < targetIds.length; i += DELETE_CHUNK_SIZE) {
          const chunk = targetIds.slice(i, i + DELETE_CHUNK_SIZE);

          for (const { table, column } of childTables) {
            const { error: delChildErr } = await client
              .from(table)
              .delete()
              .in(column, chunk);
            if (delChildErr) {
              const notDeletedRequestedIds = uniqueRequestedIds.filter(id => !deletedProductIds.has(id));
              const hasPartial = partialDeletions.length > 0 || deletedCount > 0;
              const tablesList = Array.from(new Set(partialDeletions.map(p => p.table))).join(', ');
              return {
                deletedCount,
                blockedCount: notDeletedRequestedIds.length,
                blockedIds: notDeletedRequestedIds,
                partialModification: hasPartial,
                partialDeletions: [...partialDeletions],
                error: hasPartial
                  ? `Ștergerea a eșuat parțial la ${table} (${delChildErr.message || 'eroare DELETE'}). Atenție: ștergeri anterioare non-tranzacționale au fost deja aplicate pe [${tablesList}].`
                  : `Ștergerea nu a putut fi finalizată sigur la ${table}: ${delChildErr.message || 'eroare DELETE'}`
              };
            }
            partialDeletions.push({ table, targetIdsCount: chunk.length });
          }

          const { data: deletedRows, error: delProdErr } = await client
            .from('products')
            .delete()
            .in('id', chunk)
            .select('id');
          if (delProdErr || !Array.isArray(deletedRows)) {
            const notDeletedRequestedIds = uniqueRequestedIds.filter(id => !deletedProductIds.has(id));
            const hasPartial = partialDeletions.length > 0 || deletedCount > 0;
            const tablesList = Array.from(new Set(partialDeletions.map(p => p.table))).join(', ');
            return {
              deletedCount,
              blockedCount: notDeletedRequestedIds.length,
              blockedIds: notDeletedRequestedIds,
              partialModification: hasPartial,
              partialDeletions: [...partialDeletions],
              error: `Ștergerea produselor a eșuat (${delProdErr?.message || 'răspuns invalid DELETE products'}). Ștergeri parțiale anterioare aplicate pe [${tablesList}].`
            };
          }

          for (const row of deletedRows) {
            if (row?.id) deletedProductIds.add(String(row.id));
          }
          deletedCount += deletedRows.length;
          partialDeletions.push({ table: 'products', targetIdsCount: deletedRows.length });
        }

        if (deletedCount > 0) {
          invalidateCatalogOptimizationCache();
        }
      }

      const error =
        blockedIds.length > 0
          ? `Ștergerea a fost blocată pentru ${blockedIds.length} produs(e) deoarece au observații istorice protejate în price_observations.`
          : undefined;
      return {
        deletedCount,
        blockedCount: blockedIds.length,
        blockedIds,
        partialModification: false,
        partialDeletions: [],
        ...(error ? { error } : {})
      };
    } catch (err: any) {
      console.warn('Eroare Supabase deleteProducts:', err.message);
      const hasPartial = partialDeletions.length > 0 || deletedCount > 0;
      const notDeletedIds = uniqueRequestedIds.filter(id => !deletedProductIds.has(id));
      return {
        deletedCount,
        blockedCount: notDeletedIds.length,
        blockedIds: notDeletedIds,
        partialModification: hasPartial,
        partialDeletions: [...partialDeletions],
        error: `Ștergerea nu a putut fi finalizată sigur: ${err.message}`
      };
    }
  }

  static async deleteProduct(productId: string): Promise<boolean> {
    const res = await this.deleteProducts([productId]);
    return res.deletedCount > 0 && (res.blockedCount || 0) === 0;
  }

  /**
   * Returnează datele complete pentru un produs canonic (istoric, oferte, mapări retailer),
   * rezolvând multi-hop și sigur împotriva ciclurilor orice alias până la produsul canonic rădăcină.
   */
  static async getProductDetailById(productId: string): Promise<any> {
    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      const allProducts = StorageService.getAllProducts();
      const aliasIndex = buildCanonicalAliasIndex(allProducts);
      const resolved = resolveCanonicalProductDetail(productId, aliasIndex);
      if (!resolved.found || !resolved.canonicalId || resolved.cycleDetected) {
        return null;
      }
      const canonicalId = resolved.canonicalId;
      const prod = allProducts.find(p => p.id === canonicalId && !p.canonicalProductId) || allProducts.find(p => p.id === canonicalId);
      if (!prod) return null;
      const equivalentIds = new Set(collectProductIdsForCanonical(canonicalId, aliasIndex));
      const validOffers = latestCanonicalOffers(
        StorageService.getProductOffers()
          .filter(
            o =>
              equivalentIds.has(o.productId) &&
              o.price > 0 &&
              !o.isFlaggedAnomaly &&
              !['demo', 'isolated', 'rejected'].includes(o.verificationStatus || 'verified')
          )
          .map(o => ({ ...o, productId: canonicalId }))
      );
      const priceHistory = StorageService.getPriceObservations()
        .filter(obs => equivalentIds.has(obs.productId))
        .map(obs => ({ ...obs, productId: canonicalId }));
      return {
        product: prod,
        offers: validOffers,
        priceHistory,
        retailerMappings: [],
        promotions: []
      };
    }

    const pool = getPool();
    if (pool) {
      try {
        // Rezolvare multi-hop sigură împotriva ciclurilor către rădăcina canonică (canonical_product_id IS NULL)
        const prodRes = await pool.query(
          `WITH RECURSIVE chain AS (
             SELECT id, canonical_product_id, ARRAY[id]::varchar[] AS path, 0 AS depth
             FROM products
             WHERE id = $1
             UNION ALL
             SELECT p.id, p.canonical_product_id, (c.path || p.id)::varchar[], c.depth + 1
             FROM products p
             JOIN chain c ON c.canonical_product_id = p.id
             WHERE c.canonical_product_id IS NOT NULL
               AND NOT (p.id = ANY(c.path))
               AND c.depth < 16
           )
           SELECT p.*
           FROM chain c
           JOIN products p ON p.id = c.id
           WHERE c.canonical_product_id IS NULL
           ORDER BY c.depth ASC
           LIMIT 1`,
          [productId]
        );

        if (prodRes.rows.length > 0) {
          const product = prodRes.rows[0];
          const canonicalProductId = String(product.id);

          // Colectare tranzitivă a tuturor aliasurilor descendente (protecție împotriva ciclurilor)
          const descRes = await pool.query(
            `WITH RECURSIVE descendants AS (
               SELECT id, ARRAY[id]::varchar[] AS path
               FROM products
               WHERE id = $1
               UNION ALL
               SELECT p.id, (d.path || p.id)::varchar[]
               FROM products p
               JOIN descendants d ON p.canonical_product_id = d.id
               WHERE NOT (p.id = ANY(d.path))
                 AND array_length(d.path, 1) < 16
             )
             SELECT id FROM descendants`,
            [canonicalProductId]
          );
          const allEquivalentIds = Array.from(
            new Set([canonicalProductId, ...descRes.rows.map(r => String(r.id))])
          );

          const [offersRes, historyRes, retailerMappingRes, promosRes] = await Promise.all([
            pool.query(
              `SELECT po.*, s.name AS store_name, s.brand_color AS store_brand_color, s.logo_url AS store_logo_url
               FROM product_offers po
               LEFT JOIN stores s ON s.id = po.store_id
               WHERE po.product_id = ANY($1::varchar[])
                 AND po.source != 'demo'
                 AND COALESCE(po.verification_status, 'verified') NOT IN ('demo', 'isolated', 'rejected')
                 AND COALESCE(po.is_flagged_anomaly, false) = false
                 AND po.price > 0
               ORDER BY po.observation_date ASC, po.last_checked ASC`,
              [allEquivalentIds]
            ),
            pool.query(
              `SELECT * FROM price_observations
               WHERE product_id = ANY($1::varchar[])
               ORDER BY date DESC, created_at DESC
               LIMIT 500`,
              [allEquivalentIds]
            ),
            pool.query(
              `SELECT * FROM retailer_products
               WHERE product_id = ANY($1::varchar[])`,
              [allEquivalentIds]
            ),
            pool.query(
              `SELECT * FROM promotions
               WHERE product_id = ANY($1::varchar[])
               ORDER BY ends_at DESC NULLS LAST`,
              [allEquivalentIds]
            )
          ]);

          const normalizedOffers: ProductOffer[] = latestCanonicalOffers(
            offersRes.rows.map(r => ({
              id: r.id,
              productId: canonicalProductId,
              storeId: normalizeStoreIdKey(r.store_id),
              sourceId: r.source_id || undefined,
              price: parseFloat(r.price),
              originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
              normalPrice: r.normal_price ? parseFloat(r.normal_price) : undefined,
              promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
              loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
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
              lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at).toISOString() : undefined,
              region: r.region || undefined,
              isSponsored: Boolean(r.is_sponsored),
              isFlaggedAnomaly: Boolean(r.is_flagged_anomaly),
              anomalyReason: r.anomaly_reason || undefined
            }))
          );

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
              baseReferencePrice: parseFloat(product.base_reference_price) || 0,
              canonicalProductId: null
            },
            offers: normalizedOffers,
            priceHistory: historyRes.rows.map(h => ({
              id: h.id,
              productId: canonicalProductId,
              storeId: normalizeStoreIdKey(h.store_id),
              sourceId: h.source_id || undefined,
              price: parseFloat(h.price),
              date: h.date ? (h.date.toISOString?.().split('T')[0] || String(h.date).slice(0, 10)) : '',
              receiptId: h.receipt_id || undefined,
              loyaltyCardUsed: Boolean(h.loyalty_card_used),
              source: h.source || 'verified'
            })),
            retailerMappings: retailerMappingRes.rows,
            promotions: promosRes.rows
          };
        }
        return null;
      } catch (err: any) {
        console.warn('Postgres pool getProductDetailById failed, falling back to Supabase:', err.message);
      }
    }

    try {
      // Rezolvare iterativă multi-hop cu protecție de ciclu în Supabase fallback
      const visited = new Set<string>([productId]);
      let currentId = productId;
      let prodData: any = null;

      for (let hop = 0; hop < 16; hop++) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', currentId)
          .maybeSingle();

        if (error || !data) {
          return null;
        }

        if (!data.canonical_product_id) {
          prodData = data;
          break;
        }

        const nextId = String(data.canonical_product_id).trim();
        if (!nextId || visited.has(nextId)) {
          return null;
        }
        visited.add(nextId);
        currentId = nextId;
      }

      if (!prodData) return null;

      const { data: allProdNodes } = await fetchAllSupabaseRows((from, to) =>
        supabase.from('products').select('id, canonical_product_id').range(from, to)
      );
      const aliasIndex = buildCanonicalAliasIndex(allProdNodes || []);
      const linkedProductIds = collectProductIdsForCanonical(prodData.id, aliasIndex);
      const queryProductIds = linkedProductIds.length > 0 ? linkedProductIds : [prodData.id];

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
        baseReferencePrice: parseFloat(prodData.base_reference_price) || 0,
        canonicalProductId: null
      };

      const { data: rawOffersData } = await supabase
        .from('product_offers')
        .select('*')
        .in('product_id', queryProductIds)
        .neq('source', 'demo')
        .not('verification_status', 'in', '("demo","isolated","rejected")')
        .gt('price', 0)
        .order('observation_date', { ascending: true })
        .order('last_checked', { ascending: true });

      const offersData = (rawOffersData || []).filter(r => !r.is_flagged_anomaly && Number(r.price) > 0);

      const { data: historyData } = await supabase
        .from('price_observations')
        .select('*')
        .in('product_id', queryProductIds)
        .order('date', { ascending: false })
        .limit(500);

      const offers: ProductOffer[] = latestCanonicalOffers(offersData.map(r => ({
        id: r.id,
        productId: product.id,
        storeId: normalizeStoreIdKey(r.store_id),
        sourceId: r.source_id || undefined,
        price: parseFloat(r.price),
        originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
        normalPrice: r.normal_price ? parseFloat(r.normal_price) : undefined,
        promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
        loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
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
        storeId: normalizeStoreIdKey(h.store_id),
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
           d.sha256_checksum AS "checksum",
           d.download_status AS "downloadStatus",
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
        retailerName: r.retailer_name || r.retailer_id,
        rawTitle: r.raw_title || 'Produs fără denumire',
        rawBrand: r.raw_brand || undefined,
        rawBarcode: r.raw_barcode || undefined,
        retailerSku: r.retailer_sku || undefined,
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
        imageUrl: r.image_url || r.canonical_image || undefined,
        documentTitle: r.document_title || undefined,
        documentUrl: r.document_url || undefined,
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
          count(*) FILTER (WHERE UPPER(staging_status) IN ('APPROVED', 'VALIDATED') AND effective_price > 0) AS ready_to_publish_count,
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
        READY_TO_PUBLISH: parseInt(rowCounts.ready_to_publish_count || '0', 10),
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
        } else if (targetStatus === 'READY_TO_PUBLISH') {
          conditions.push(`UPPER(o.staging_status) IN ('APPROVED', 'VALIDATED') AND o.effective_price > 0`);
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
        `SELECT o.*,
                p.name AS canonical_name,
                p.image_url AS canonical_image,
                s.name AS retailer_name,
                d.title AS document_title,
                d.document_url AS document_url,
                rp.external_sku AS retailer_sku
         FROM catalog_extracted_offers o
         LEFT JOIN products p ON p.id = o.matched_product_id
         LEFT JOIN stores s ON s.id = o.retailer_id
         LEFT JOIN catalog_documents d ON d.id = o.document_id
         LEFT JOIN LATERAL (
           SELECT rp_inner.external_sku
           FROM retailer_products rp_inner
           WHERE rp_inner.retailer_id = o.retailer_id
             AND (
               (o.matched_product_id IS NOT NULL AND rp_inner.product_id = o.matched_product_id)
               OR (o.raw_barcode IS NOT NULL AND rp_inner.barcode = o.raw_barcode)
             )
           ORDER BY rp_inner.last_scraped_at DESC
           LIMIT 1
         ) rp ON true
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
          READY_TO_PUBLISH: 0,
          PUBLISHED: 0,
          REJECTED: 0,
          NO_PRICE: 0,
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
      const conditions: string[] = ["UPPER(o.staging_status) IN ('APPROVED', 'VALIDATED')"];
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
   * Returnează ofertele active publicate în catalog (product_offers), agregate canonic per (produs canonic, retailer)
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

    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      const allProducts = StorageService.getAllProducts();
      const aliasIndex = buildCanonicalAliasIndex(allProducts);
      const prodById = new Map(allProducts.map(p => [p.id, p]));
      const storeById = new Map(
        StorageService.getStores().map(s => [normalizeStoreIdKey(s.id), s.name])
      );

      const dedupMap = new Map<string, { offer: ProductOffer; canonicalId: string; originalId?: string }>();
      for (const r of StorageService.getProductOffers()) {
        if (!r || r.price <= 0) continue;
        if (r.source === 'demo') continue;
        if (r.verificationStatus === 'demo' || r.verificationStatus === 'isolated' || r.verificationStatus === 'rejected') continue;
        if (r.isFlaggedAnomaly) continue;
        const detail = resolveCanonicalProductDetail(r.productId, aliasIndex);
        if (!detail.found || !detail.canonicalId || detail.cycleDetected) continue;
        const canonicalId = detail.canonicalId;
        if (!prodById.has(canonicalId)) continue;
        const cleanStore = normalizeStoreIdKey(r.storeId);
        const key = `${canonicalId}::${cleanStore}`;
        const existing = dedupMap.get(key);
        const currObs = r.observationDate || '';
        const prevObs = existing?.offer.observationDate || '';
        const currChecked = r.lastChecked || '';
        const prevChecked = existing?.offer.lastChecked || '';
        if (!existing || currObs > prevObs || (currObs === prevObs && currChecked > prevChecked)) {
          dedupMap.set(key, {
            offer: r,
            canonicalId,
            originalId: canonicalId !== r.productId ? r.productId : undefined
          });
        }
      }

      let mapped = Array.from(dedupMap.values())
        .map(({ offer: r, canonicalId, originalId }) => {
          const prod = prodById.get(canonicalId);
          const cleanStore = normalizeStoreIdKey(r.storeId);
          return {
            id: r.id,
            productId: canonicalId,
            ...(originalId ? { originalProductId: originalId } : {}),
            productName: prod?.name || 'Produs fără denumire',
            productBrand: prod?.brand,
            productCategory: prod?.category,
            productBarcode: prod?.barcode,
            productImage: prod?.imageUrl,
            storeId: cleanStore,
            storeName: storeById.get(cleanStore) || r.storeId,
            price: r.price,
            originalPrice: r.originalPrice,
            unitPrice: r.unitPrice || r.price,
            unitPriceMeasure: r.unitPriceMeasure || 'lei/buc',
            isPromo: Boolean(r.isPromo),
            promoDetails: r.promoDetails,
            loyaltyCardRequired: Boolean(r.loyaltyCardRequired),
            loyaltyCardName: r.loyaltyCardName,
            validUntil: r.validUntil,
            observationDate: r.observationDate,
            isExpired: r.validUntil ? new Date(r.validUntil) < new Date() : false,
            lastChecked: r.lastChecked
          };
        })
        .sort((a, b) => a.price - b.price);

      if (params.retailerId && params.retailerId !== 'toate') {
        const cleanRet = normalizeStoreIdKey(params.retailerId);
        mapped = mapped.filter(o => o.storeId === cleanRet);
      }
      if (params.search && params.search.trim()) {
        const q = params.search.toLowerCase().trim();
        mapped = mapped.filter(
          o =>
            o.productName.toLowerCase().includes(q) ||
            (o.productBrand && o.productBrand.toLowerCase().includes(q)) ||
            (o.productBarcode && o.productBarcode.includes(q))
        );
      }

      const total = mapped.length;
      return {
        offers: mapped.slice(offset, offset + limit),
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit))
      };
    }

    const pool = getPool();

    if (!pool) {
      try {
        const [offersRes, productsRes, storesRes] = await Promise.all([
          fetchAllSupabaseRows((from, to) =>
            supabase
              .from('product_offers')
              .select('*')
              .neq('source', 'demo')
              .not('verification_status', 'in', '("demo","isolated","rejected")')
              .gt('price', 0)
              .range(from, to)
          ),
          fetchAllSupabaseRows((from, to) =>
            supabase.from('products').select('id, canonical_product_id, name, brand, category, barcode, image_url').range(from, to)
          ),
          supabase.from('stores').select('id, name')
        ]);
        if (!offersRes.error && offersRes.data) {
          const aliasIndex = buildCanonicalAliasIndex(productsRes.data || []);
          const prodById = new Map((productsRes.data || []).map((p: any) => [p.id, p]));
          const storeById = new Map(
            (storesRes.data || []).map((s: any) => [normalizeStoreIdKey(s.id), s.name])
          );

          const deduped = new Map<string, any>();
          for (const r of offersRes.data) {
            if (r.is_flagged_anomaly || !(Number(r.price) > 0)) continue;
            const detail = resolveCanonicalProductDetail(r.product_id, aliasIndex);
            if (!detail.found || !detail.canonicalId || detail.cycleDetected) continue;
            const cleanStore = normalizeStoreIdKey(r.store_id);
            const key = `${detail.canonicalId}__${cleanStore}`;
            const curTs = `${r.observation_date || ''}:${r.last_checked || ''}`;
            const prev = deduped.get(key);
            if (!prev || curTs >= prev._ts) {
              const prod = prodById.get(detail.canonicalId);
              deduped.set(key, {
                _ts: curTs,
                id: r.id,
                productId: detail.canonicalId,
                productName: prod?.name || 'Produs fără denumire',
                productBrand: prod?.brand,
                productCategory: prod?.category,
                productBarcode: prod?.barcode,
                productImage: prod?.image_url,
                storeId: cleanStore,
                storeName: storeById.get(cleanStore) || r.store_id,
                price: parseFloat(r.price) || 0,
                originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
                isPromo: Boolean(r.is_promo),
                unitPrice: parseFloat(r.unit_price) || parseFloat(r.price) || 0,
                unitPriceMeasure: r.unit_price_measure || 'lei/buc',
                lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString()
              });
            }
          }

          let list = Array.from(deduped.values())
            .map(({ _ts, ...rest }) => rest)
            .sort((a, b) => a.price - b.price);
          if (params.retailerId && params.retailerId !== 'toate') {
            const cleanRet = normalizeStoreIdKey(params.retailerId);
            list = list.filter(o => o.storeId === cleanRet);
          }
          if (params.search && params.search.trim()) {
            const q = params.search.toLowerCase().trim();
            list = list.filter(
              o =>
                o.productName.toLowerCase().includes(q) ||
                (o.productBrand && o.productBrand.toLowerCase().includes(q)) ||
                (o.productBarcode && o.productBarcode.includes(q))
            );
          }
          const total = list.length;
          return {
            offers: list.slice(offset, offset + limit),
            total,
            page,
            totalPages: Math.max(1, Math.ceil(total / limit))
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
        conditions.push(`(co.store_id = $${idx} OR co.store_id = 'store-' || $${idx} OR replace(lower(co.store_id), 'store-', '') = replace(lower($${idx}), 'store-', ''))`);
        values.push(params.retailerId);
        idx++;
      }
      if (params.search && params.search.trim()) {
        conditions.push(`(p.name ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      const whereClause = conditions.join(' AND ');
      const ctePrefix = `
        WITH RECURSIVE canonical_map AS (
          SELECT id AS node_id, id AS current_id, canonical_product_id, ARRAY[id::text]::text[] AS path, 0 AS depth
          FROM products
          UNION ALL
          SELECT cm.node_id, p2.id AS current_id, p2.canonical_product_id, (cm.path || p2.id::text)::text[], cm.depth + 1
          FROM canonical_map cm
          JOIN products p2 ON p2.id = cm.canonical_product_id
          WHERE cm.canonical_product_id IS NOT NULL
            AND NOT (p2.id::text = ANY(cm.path))
            AND cm.depth < 16
        ),
        resolved_root AS (
          SELECT node_id, current_id AS root_id
          FROM canonical_map
          WHERE canonical_product_id IS NULL
        ),
        canonical_offers AS (
          SELECT DISTINCT ON (rr.root_id, replace(lower(po.store_id), 'store-', ''))
            po.*,
            rr.root_id AS canonical_product_id,
            po.product_id AS raw_product_id
          FROM product_offers po
          JOIN resolved_root rr ON rr.node_id = po.product_id
          WHERE po.source != 'demo'
            AND COALESCE(po.verification_status, 'verified') NOT IN ('demo', 'isolated', 'rejected')
            AND COALESCE(po.is_flagged_anomaly, false) = false
            AND po.price > 0
          ORDER BY rr.root_id, replace(lower(po.store_id), 'store-', ''), po.observation_date DESC, po.last_checked DESC
        )
      `;

      const countRes = await pool.query(
        `${ctePrefix}
         SELECT count(*)
         FROM canonical_offers co
         JOIN products p ON p.id = co.canonical_product_id
         WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `${ctePrefix}
         SELECT co.*, p.name AS product_name, p.brand AS product_brand, p.category AS product_category,
                p.barcode AS product_barcode, p.image_url AS product_image, s.name AS store_name, s.brand_color AS store_brand_color
         FROM canonical_offers co
         JOIN products p ON p.id = co.canonical_product_id
         LEFT JOIN stores s ON s.id = co.store_id OR s.id = replace(co.store_id, 'store-', '')
         WHERE ${whereClause}
         ORDER BY co.price ASC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        queryValues
      );

      const offers = dataRes.rows.map(r => ({
        id: r.id,
        productId: r.canonical_product_id || r.product_id,
        ...(r.raw_product_id && r.canonical_product_id && r.raw_product_id !== r.canonical_product_id
          ? { originalProductId: r.raw_product_id }
          : {}),
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
   * Returnează istoricul modificărilor de preț din tabela append-only price_observations,
   * cu agregare multi-hop pe identitatea produsului canonic fără a șterge sau muta observațiile.
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

    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      const allProducts = StorageService.getAllProducts();
      const aliasIndex = buildCanonicalAliasIndex(allProducts);
      const prodById = new Map(allProducts.map(p => [p.id, p]));
      const storeById = new Map(
        StorageService.getStores().map(s => [normalizeStoreIdKey(s.id), s.name])
      );

      let changes = StorageService.getPriceObservations()
        .map(obs => {
          const detail = resolveCanonicalProductDetail(obs.productId, aliasIndex);
          const resolvedId = detail.found && detail.canonicalId && !detail.cycleDetected ? detail.canonicalId : obs.productId;
          const prod = !detail.cycleDetected ? prodById.get(resolvedId) : undefined;
          const cleanStore = normalizeStoreIdKey(obs.storeId);
          return {
            id: obs.id,
            productId: resolvedId,
            ...(resolvedId !== obs.productId ? { originalProductId: obs.productId } : {}),
            productName: prod?.name || 'Produs fără denumire',
            productBrand: prod?.brand,
            productBarcode: prod?.barcode,
            storeId: cleanStore,
            storeName: storeById.get(cleanStore) || obs.storeId,
            price: obs.price,
            previousPrice: prod?.baseReferencePrice,
            date: obs.date,
            source: obs.source || 'verified',
            loyaltyCardUsed: Boolean(obs.loyaltyCardUsed)
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date));

      if (params.retailerId && params.retailerId !== 'toate') {
        const cleanRet = normalizeStoreIdKey(params.retailerId);
        changes = changes.filter(c => c.storeId === cleanRet);
      }
      if (params.search && params.search.trim()) {
        const q = params.search.toLowerCase().trim();
        changes = changes.filter(
          c =>
            c.productName.toLowerCase().includes(q) ||
            (c.productBrand && c.productBrand.toLowerCase().includes(q)) ||
            (c.productBarcode && c.productBarcode.includes(q))
        );
      }

      const total = changes.length;
      return {
        changes: changes.slice(offset, offset + limit),
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit))
      };
    }

    const pool = getPool();

    if (!pool) {
      try {
        const [obsRes, productsRes, storesRes] = await Promise.all([
          fetchAllSupabaseRows((from, to) =>
            supabase.from('price_observations').select('*').order('date', { ascending: false }).range(from, to)
          ),
          fetchAllSupabaseRows((from, to) =>
            supabase.from('products').select('id, canonical_product_id, name, brand, barcode, base_reference_price').range(from, to)
          ),
          supabase.from('stores').select('id, name')
        ]);
        if (!obsRes.error && obsRes.data) {
          const aliasIndex = buildCanonicalAliasIndex(productsRes.data || []);
          const prodById = new Map((productsRes.data || []).map((p: any) => [p.id, p]));
          const storeById = new Map(
            (storesRes.data || []).map((s: any) => [normalizeStoreIdKey(s.id), s.name])
          );

          let list = obsRes.data.map((r: any) => {
            const detail = resolveCanonicalProductDetail(r.product_id, aliasIndex);
            const resolvedId = detail.found && detail.canonicalId && !detail.cycleDetected ? detail.canonicalId : r.product_id;
            const prod = !detail.cycleDetected ? prodById.get(resolvedId) : undefined;
            const cleanStore = normalizeStoreIdKey(r.store_id);
            return {
              id: r.id,
              productId: resolvedId,
              ...(resolvedId !== r.product_id ? { originalProductId: r.product_id } : {}),
              productName: prod?.name || 'Produs fără denumire',
              productBrand: prod?.brand,
              productBarcode: prod?.barcode,
              storeId: cleanStore,
              storeName: storeById.get(cleanStore) || r.store_id,
              price: parseFloat(r.price) || 0,
              date: r.date,
              source: r.source || 'verified'
            };
          });
          if (params.retailerId && params.retailerId !== 'toate') {
            const cleanRet = normalizeStoreIdKey(params.retailerId);
            list = list.filter(c => c.storeId === cleanRet);
          }
          if (params.search && params.search.trim()) {
            const q = params.search.toLowerCase().trim();
            list = list.filter(
              c =>
                c.productName.toLowerCase().includes(q) ||
                (c.productBrand && c.productBrand.toLowerCase().includes(q)) ||
                (c.productBarcode && c.productBarcode.includes(q))
            );
          }
          const total = list.length;
          return {
            changes: list.slice(offset, offset + limit),
            total,
            page,
            totalPages: Math.max(1, Math.ceil(total / limit))
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
        conditions.push(`(po.store_id = $${idx} OR po.store_id = 'store-' || $${idx} OR replace(lower(po.store_id), 'store-', '') = replace(lower($${idx}), 'store-', ''))`);
        values.push(params.retailerId);
        idx++;
      }
      if (params.search && params.search.trim()) {
        conditions.push(`(p.name ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
        values.push(`%${params.search.trim()}%`);
        idx++;
      }

      const whereClause = conditions.join(' AND ');
      const ctePrefix = `
        WITH RECURSIVE canonical_map AS (
          SELECT id AS node_id, id AS current_id, canonical_product_id, ARRAY[id::text]::text[] AS path, 0 AS depth
          FROM products
          UNION ALL
          SELECT cm.node_id, p2.id AS current_id, p2.canonical_product_id, (cm.path || p2.id::text)::text[], cm.depth + 1
          FROM canonical_map cm
          JOIN products p2 ON p2.id = cm.canonical_product_id
          WHERE cm.canonical_product_id IS NOT NULL
            AND NOT (p2.id::text = ANY(cm.path))
            AND cm.depth < 16
        ),
        resolved_root AS (
          SELECT node_id, current_id AS root_id
          FROM canonical_map
          WHERE canonical_product_id IS NULL
        )
      `;

      const countRes = await pool.query(
        `${ctePrefix}
         SELECT count(*)
         FROM price_observations po
         LEFT JOIN resolved_root rr ON rr.node_id = po.product_id
         LEFT JOIN products p ON p.id = rr.root_id
         WHERE ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0]?.count || '0', 10);

      const queryValues = [...values, limit, offset];
      const dataRes = await pool.query(
        `${ctePrefix}
         SELECT po.*, rr.root_id AS canonical_product_id, p.name AS product_name, p.brand AS product_brand, p.base_reference_price,
                s.name AS store_name, s.brand_color AS store_brand_color
         FROM price_observations po
         LEFT JOIN resolved_root rr ON rr.node_id = po.product_id
         LEFT JOIN products p ON p.id = rr.root_id
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
        const resolvedProductId = r.canonical_product_id || r.product_id;

        return {
          id: r.id,
          productId: resolvedProductId,
          ...(r.canonical_product_id && r.canonical_product_id !== r.product_id
            ? { originalProductId: r.product_id }
            : {}),
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
   * Returnează ofertele eligibile (APPROVED / VALIDATED, preț > 0) îmbogățite cu detalii retailer, document și imagine pentru previzualizare/publicare.
   */
  static async getStagingOffersEnrichedForPublish(offerIds?: string[]): Promise<{
    eligibleOffers: CatalogExtractedOffer[];
    needsReviewCount: number;
    itemsWithoutPriceCount: number;
  }> {
    const pool = getPool();
    if (!pool) {
      return { eligibleOffers: [], needsReviewCount: 0, itemsWithoutPriceCount: 0 };
    }

    const toIso = (value: unknown) => value ? new Date(value as string | number | Date).toISOString() : undefined;
    const hasFilterIds = Array.isArray(offerIds) && offerIds.length > 0;

    const [eligibleRes, countsRes] = await Promise.all([
      pool.query(
        `SELECT o.*,
                p.name AS canonical_name,
                p.image_url AS canonical_image,
                s.name AS retailer_name,
                d.title AS document_title,
                d.document_url AS document_url,
                rp.external_sku AS retailer_sku
         FROM catalog_extracted_offers o
         LEFT JOIN products p ON p.id = o.matched_product_id
         LEFT JOIN stores s ON s.id = o.retailer_id
         LEFT JOIN catalog_documents d ON d.id = o.document_id
         LEFT JOIN LATERAL (
           SELECT rp_inner.external_sku
           FROM retailer_products rp_inner
           WHERE rp_inner.retailer_id = o.retailer_id
             AND (
               (o.matched_product_id IS NOT NULL AND rp_inner.product_id = o.matched_product_id)
               OR (o.raw_barcode IS NOT NULL AND rp_inner.barcode = o.raw_barcode)
             )
           ORDER BY rp_inner.last_scraped_at DESC
           LIMIT 1
         ) rp ON true
         WHERE UPPER(o.staging_status) IN ('APPROVED', 'VALIDATED')
           AND o.effective_price > 0
           ${hasFilterIds ? 'AND o.id = ANY($1::varchar[])' : ''}
         ORDER BY o.reviewed_at DESC NULLS LAST, o.created_at DESC`,
        hasFilterIds ? [offerIds] : []
      ),
      pool.query(
        `SELECT
           count(*) FILTER (WHERE UPPER(COALESCE(staging_status, 'NEEDS_REVIEW')) IN ('NEEDS_REVIEW', 'DISCOVERED', 'PARSED')) AS needs_review_count,
           count(*) FILTER (WHERE effective_price IS NULL OR effective_price <= 0) AS items_without_price_count
         FROM catalog_extracted_offers
         ${hasFilterIds ? 'WHERE id = ANY($1::varchar[])' : ''}`,
        hasFilterIds ? [offerIds] : []
      )
    ]);

    const eligibleOffers: CatalogExtractedOffer[] = eligibleRes.rows.map(r => ({
      id: String(r.id),
      runId: r.run_id || '',
      documentId: r.document_id || '',
      retailerId: r.retailer_id,
      retailerName: r.retailer_name || r.retailer_id,
      rawTitle: r.raw_title || 'Produs fără denumire',
      rawBrand: r.raw_brand || undefined,
      rawBarcode: r.raw_barcode || undefined,
      retailerSku: r.retailer_sku || undefined,
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
      imageUrl: r.image_url || r.canonical_image || undefined,
      documentTitle: r.document_title || undefined,
      documentUrl: r.document_url || undefined,
      matchedProductId: r.matched_product_id || undefined,
      matchedProductName: r.canonical_name || undefined,
      matchConfidence: parseFloat(r.match_confidence || '0'),
      matchMethod: r.match_method || 'unmatched',
      stagingStatus: String(r.staging_status || 'APPROVED').toUpperCase() as CatalogExtractedOffer['stagingStatus'],
      validationErrors: Array.isArray(r.validation_errors) ? r.validation_errors : undefined,
      reviewedBy: r.reviewed_by || undefined,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : undefined,
      rejectionReason: r.rejection_reason || undefined,
      createdAt: toIso(r.created_at) || new Date(0).toISOString(),
      updatedAt: toIso(r.updated_at) || toIso(r.created_at) || new Date(0).toISOString()
    }));

    return {
      eligibleOffers,
      needsReviewCount: parseInt(countsRes.rows[0]?.needs_review_count || '0', 10),
      itemsWithoutPriceCount: parseInt(countsRes.rows[0]?.items_without_price_count || '0', 10)
    };
  }

  /**
   * Validează complet o ofertă din staging înainte de aprobare (verificare prețuri, retailer, document, produs canonic, duplicate, EAN/SKU, cantitate/unitate, valabilitate)
   */
  static validateStagingOfferCandidate(params: {
    offer: {
      id: string;
      retailerId: string;
      documentId?: string | null;
      rawTitle: string;
      rawBrand?: string | null;
      rawBarcode?: string | null;
      retailerSku?: string | null;
      rawCategory?: string | null;
      normalPrice: number;
      promoPrice?: number | null;
      loyaltyPrice?: number | null;
      effectivePrice: number;
      packageQuantity?: number | null;
      packageUnit?: string | null;
      validUntil?: string | null;
      matchedProductId?: string | null;
      matchMethod?: 'gtin_exact' | 'name_brand_similarity' | 'manual' | 'unmatched' | string | null;
      matchConfidence?: number | null;
      stagingStatus: string;
    };
    validStoreIds: Set<string>;
    validDocumentIds: Set<string>;
    productsById: Map<string, Product>;
    allProducts: Product[];
    batchSignatures: Set<string>;
    existingApprovedSignatures: Map<string, string>;
    requestedMatchedProductId?: string;
    aliasIndex?: CanonicalAliasIndex;
    todayStr: string;
  }): {
    valid: boolean;
    errors: string[];
    resolvedProductId?: string;
    resolvedProductName?: string;
    resolvedMatchMethod?: 'gtin_exact' | 'name_brand_similarity' | 'manual' | 'unmatched';
    resolvedMatchConfidence?: number;
  } {
    const {
      offer,
      validStoreIds,
      validDocumentIds,
      productsById,
      allProducts,
      batchSignatures,
      existingApprovedSignatures,
      requestedMatchedProductId,
      aliasIndex,
      todayStr
    } = params;

    const errors: string[] = [];
    const titleTrimmed = (offer.rawTitle || '').trim();
    const currentStatus = String(offer.stagingStatus || 'NEEDS_REVIEW').toUpperCase();
    if (currentStatus === 'PUBLISHED') {
      errors.push('Oferta este deja publicată în catalogul public.');
    }

    const priceCheck = PriceExtractor.validateOfferPrice({
      title: titleTrimmed,
      normalPrice: offer.normalPrice,
      promoPrice: offer.promoPrice,
      loyaltyPrice: offer.loyaltyPrice,
      effectivePrice: offer.effectivePrice,
      packageQuantity: offer.packageQuantity,
      packageUnit: offer.packageUnit
    });
    if (priceCheck.status !== 'VALID') {
      errors.push(...priceCheck.reasons);
    }

    if (!offer.retailerId || !validStoreIds.has(offer.retailerId)) {
      errors.push(`Retailerul „${offer.retailerId || 'nespecificat'}” nu este înregistrat în baza de date.`);
    }

    if (offer.documentId && !validDocumentIds.has(offer.documentId)) {
      errors.push(`Documentul sursă „${offer.documentId}” nu există în arhiva de cataloage.`);
    }

    // EAN & SKU verification
    const cleanBarcode = offer.rawBarcode ? offer.rawBarcode.trim() : '';
    if (cleanBarcode.length > 0 && !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(cleanBarcode)) {
      errors.push(`Codul de bare EAN „${cleanBarcode}” este invalid (trebuie să conțină 8, 12, 13 sau 14 cifre).`);
    }

    if (offer.retailerSku && offer.retailerSku.trim().length > 128) {
      errors.push('Codul SKU al retailerului depășește lungimea maximă permisă (128 caractere).');
    }

    // Quantity & unit verification
    if (offer.packageQuantity !== null && offer.packageQuantity !== undefined) {
      if (!Number.isFinite(offer.packageQuantity) || offer.packageQuantity <= 0) {
        errors.push(`Cantitatea ambalajului (${offer.packageQuantity}) trebuie să fie pozitivă.`);
      }
    }
    const allowedUnits = new Set(['kg', 'g', 'l', 'ml', 'buc', 'pachet', 'set', 'cutie', 'sticla', 'sticlă', 'doza', 'doză', 'rola', 'rolă', 'role', 'capsule', 'tablete', 'plicuri']);
    if (offer.packageUnit && offer.packageUnit.trim().length > 0) {
      const normalizedUnit = offer.packageUnit.trim().toLowerCase();
      if (!allowedUnits.has(normalizedUnit)) {
        errors.push(`Unitatea de măsură „${offer.packageUnit}” nu este recunoscută.`);
      }
    }

    // Expiry check
    if (offer.validUntil && offer.validUntil < todayStr) {
      errors.push(`Oferta este expirată (valabilă până la ${offer.validUntil}).`);
    }

    // Canonical product resolution (promovează aliasurile multi-hop la produsul canonic rădăcină, blochează ciclurile și orfanii)
    let resolvedProductId: string | undefined;
    let resolvedProductName: string | undefined;
    let resolvedMatchMethod: 'gtin_exact' | 'name_brand_similarity' | 'manual' | 'unmatched' = 'unmatched';
    let resolvedMatchConfidence = 0;

    const canonicalPool = allProducts.filter(p => !p.canonicalProductId);
    const knownProductIds = new Set(productsById.keys());
    const hasExplicitRequestedMatch = Boolean(requestedMatchedProductId && requestedMatchedProductId.trim().length > 0);
    const targetProductId = hasExplicitRequestedMatch
      ? requestedMatchedProductId!.trim()
      : offer.matchedProductId
      ? offer.matchedProductId.trim()
      : undefined;

    if (targetProductId) {
      const detail = aliasIndex
        ? resolveCanonicalProductDetail(targetProductId, aliasIndex, { knownProductIds })
        : null;
      if (detail?.cycleDetected) {
        errors.push(`Produsul asociat (${targetProductId}) face parte dintr-un lanț canonic ciclic invalid.`);
      } else if (detail && detail.wasAlias && !detail.found) {
        errors.push(`Produsul asociat (${targetProductId}) este un alias orfan fără rădăcină canonică validă.`);
      } else if (detail && !detail.found) {
        errors.push(`Produsul canonic asociat (${targetProductId}) nu a fost găsit ca rădăcină validă în catalog.`);
      } else {
        const canonicalTargetId =
          detail && detail.found && detail.canonicalId ? detail.canonicalId : targetProductId;
        const existingProd = productsById.get(canonicalTargetId);
        if (!existingProd || existingProd.canonicalProductId) {
          errors.push(`Produsul canonic asociat (${targetProductId}) nu a fost găsit ca rădăcină validă în catalog.`);
        } else {
          resolvedProductId = existingProd.id;
          resolvedProductName = existingProd.name;

          const offerBarcodeSet =
            cleanBarcode.length >= 8 ? new Set(normalizeBarcodeCandidates(cleanBarcode)) : null;
          const prodBarcodeCandidates = existingProd.barcode
            ? normalizeBarcodeCandidates(existingProd.barcode)
            : [];
          const hasVerifiableGtinProof = Boolean(
            offerBarcodeSet &&
              prodBarcodeCandidates.length > 0 &&
              prodBarcodeCandidates.some(bc => offerBarcodeSet.has(bc))
          );

          if (hasExplicitRequestedMatch) {
            resolvedMatchMethod = 'manual';
            resolvedMatchConfidence = 1.0;
          } else if (offer.matchMethod === 'manual') {
            resolvedMatchMethod = 'manual';
            resolvedMatchConfidence =
              typeof offer.matchConfidence === 'number' && Number.isFinite(offer.matchConfidence) && offer.matchConfidence > 0
                ? offer.matchConfidence
                : 1.0;
          } else if (offer.matchMethod === 'name_brand_similarity') {
            resolvedMatchMethod = 'name_brand_similarity';
            resolvedMatchConfidence =
              typeof offer.matchConfidence === 'number' && Number.isFinite(offer.matchConfidence) && offer.matchConfidence > 0
                ? offer.matchConfidence
                : 0.75;
          } else if (hasVerifiableGtinProof) {
            resolvedMatchMethod = 'gtin_exact';
            resolvedMatchConfidence =
              offer.matchMethod === 'gtin_exact' &&
              typeof offer.matchConfidence === 'number' &&
              Number.isFinite(offer.matchConfidence) &&
              offer.matchConfidence > 0
                ? offer.matchConfidence
                : 1.0;
          } else {
            // Fără dovadă verificabilă GTIN NU promovăm niciodată la gtin_exact / confidence 1.0
            resolvedMatchMethod = 'name_brand_similarity';
            if (
              offer.matchMethod !== 'gtin_exact' &&
              typeof offer.matchConfidence === 'number' &&
              Number.isFinite(offer.matchConfidence) &&
              offer.matchConfidence > 0 &&
              offer.matchConfidence < 1.0
            ) {
              resolvedMatchConfidence = offer.matchConfidence;
            } else {
              const simCheck = titleTrimmed.length >= 2
                ? ProductMatcher.matchProduct(
                    {
                      rawName: titleTrimmed,
                      brand: offer.rawBrand || undefined,
                      packageWeightOrVolume: offer.packageQuantity || undefined,
                      packageUnit: (offer.packageUnit as any) || undefined,
                      category: offer.rawCategory || undefined
                    },
                    [existingProd]
                  )
                : null;
              resolvedMatchConfidence =
                simCheck && simCheck.matchedProduct?.id === existingProd.id && simCheck.confidence > 0
                  ? Math.min(0.95, simCheck.confidence)
                  : 0.75;
            }
          }
        }
      }
    } else if (titleTrimmed.length >= 2) {
      const matchRes = ProductMatcher.matchProduct(
        {
          rawName: titleTrimmed,
          barcode: cleanBarcode || undefined,
          brand: offer.rawBrand || undefined,
          packageWeightOrVolume: offer.packageQuantity || undefined,
          packageUnit: (offer.packageUnit as any) || undefined,
          category: offer.rawCategory || undefined
        },
        canonicalPool
      );
      if (matchRes.matchedProduct && matchRes.confidence >= 0.75) {
        const safeDetail = aliasIndex
          ? resolveCanonicalProductDetail(matchRes.matchedProduct.id, aliasIndex, { knownProductIds })
          : null;
        if (!safeDetail || (safeDetail.found && !safeDetail.cycleDetected && safeDetail.canonicalId)) {
          const safeCanonId = safeDetail?.canonicalId || matchRes.matchedProduct.id;
          const canonicalMatch = productsById.get(safeCanonId) || matchRes.matchedProduct;
          if (!canonicalMatch.canonicalProductId) {
            resolvedProductId = canonicalMatch.id;
            resolvedProductName = canonicalMatch.name;
            resolvedMatchMethod = matchRes.matchMethod;
            resolvedMatchConfidence = matchRes.confidence;
          }
        }
      }
    }

    // Duplicate detection within same batch or against already approved staging rows
    const sigPrice = Number.isFinite(offer.effectivePrice) ? offer.effectivePrice.toFixed(2) : '0.00';
    const sigKey = [
      offer.retailerId,
      cleanBarcode || titleTrimmed.toLowerCase(),
      sigPrice,
      offer.packageQuantity || '',
      (offer.packageUnit || '').toLowerCase()
    ].join('::');

    if (batchSignatures.has(sigKey)) {
      errors.push('Ofertă duplicat detectată în același lot (același retailer, produs și preț).');
    } else {
      const existingApprovedId = existingApprovedSignatures.get(sigKey);
      if (existingApprovedId && existingApprovedId !== offer.id) {
        errors.push(`Există deja o ofertă identică pregătită pentru publicare (${existingApprovedId}).`);
      }
    }

    if (errors.length === 0) {
      batchSignatures.add(sigKey);
    }

    return {
      valid: errors.length === 0,
      errors,
      resolvedProductId,
      resolvedProductName,
      resolvedMatchMethod,
      resolvedMatchConfidence
    };
  }

  /**
   * Validare și aprobare / respingere individuală a unei oferte din Staging cu persistență tranzacțională și audit log
   */
  static async reviewSingleStagingOffer(params: {
    offerId: string;
    action: 'approve' | 'reject';
    matchedProductId?: string;
    rejectionReason?: string;
    userEmail?: string;
    ipAddress?: string;
  }): Promise<{
    success: boolean;
    notFound?: boolean;
    offer?: CatalogExtractedOffer;
    validationErrors?: string[];
    message: string;
  }> {
    const { offerId, action, matchedProductId, rejectionReason, userEmail = 'admin@cosulmeu.ro', ipAddress } = params;
    const pool = getPool();
    if (!pool) {
      return { success: false, message: 'PostgreSQL nu este configurat.' };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const offerRes = await client.query('SELECT * FROM catalog_extracted_offers WHERE id = $1 FOR UPDATE', [offerId]);
      if (offerRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, notFound: true, message: 'Oferta nu a fost găsită în staging.' };
      }

      const row = offerRes.rows[0];
      const currentStatus = String(row.staging_status || 'NEEDS_REVIEW').toUpperCase();

      if (action === 'reject') {
        if (currentStatus === 'PUBLISHED') {
          await client.query('ROLLBACK');
          return {
            success: false,
            validationErrors: ['Oferta este deja publicată și nu poate fi respinsă din staging.'],
            message: 'Oferta este deja publicată și nu poate fi respinsă din staging.'
          };
        }

        const reason = rejectionReason || 'Respinsă manual de administrator.';
        await client.query(
          `UPDATE catalog_extracted_offers
           SET staging_status = 'REJECTED',
               rejection_reason = $2,
               reviewed_by = $3,
               reviewed_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [offerId, reason, userEmail]
        );

        await client.query(
          `INSERT INTO admin_audit_logs (id, user_email, action, target_type, target_id, details, ip_address, created_at)
           VALUES ($1, $2, 'reject_staging_offer', 'staging_offer', $3, $4, $5, NOW())`,
          [
            `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            userEmail,
            offerId,
            JSON.stringify({ previousStatus: currentStatus, newStatus: 'REJECTED', rejectionReason: reason }),
            ipAddress || null
          ]
        );

        await client.query('COMMIT');
        return {
          success: true,
          offer: {
            id: String(row.id),
            runId: row.run_id || '',
            documentId: row.document_id || '',
            retailerId: row.retailer_id,
            rawTitle: row.raw_title,
            normalPrice: parseFloat(row.normal_price) || 0,
            effectivePrice: parseFloat(row.effective_price) || 0,
            currency: row.currency || 'RON',
            isPromo: Boolean(row.is_promo),
            matchConfidence: parseFloat(row.match_confidence || '0'),
            matchMethod: row.match_method || 'unmatched',
            stagingStatus: 'REJECTED',
            rejectionReason: reason,
            reviewedBy: userEmail,
            reviewedAt: new Date().toISOString(),
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date().toISOString()
          },
          message: 'Oferta a fost respinsă și exclusă de la publicare.'
        };
      }

      // Acțiune: approve -> validare completă
      const [storesRes, docsRes, productsRes, existingApprovedRes] = await Promise.all([
        client.query('SELECT id FROM stores'),
        client.query('SELECT id FROM catalog_documents'),
        client.query('SELECT * FROM products'),
        client.query(
          `SELECT id, retailer_id, raw_title, raw_barcode, effective_price, package_quantity, package_unit
           FROM catalog_extracted_offers
           WHERE UPPER(staging_status) IN ('APPROVED', 'VALIDATED') AND id <> $1`,
          [offerId]
        )
      ]);

      const validStoreIds = new Set(storesRes.rows.map(r => String(r.id)));
      const validDocumentIds = new Set(docsRes.rows.map(r => String(r.id)));
      const stagingAliasIndex = buildCanonicalAliasIndex(
        productsRes.rows.map(r => ({ id: r.id, canonicalProductId: r.canonical_product_id || null }))
      );
      const allProducts: Product[] = productsRes.rows
        .filter(r => !r.canonical_product_id && resolveCanonicalProductId(r.id, stagingAliasIndex) === r.id)
        .map(r => ({
          id: r.id,
          name: r.name,
          brand: r.brand,
          category: r.category as any,
          defaultUnit: r.default_unit,
          packageWeightOrVolume: parseFloat(r.package_weight_or_volume),
          packageUnit: r.package_unit,
          normalizedUnit: r.normalized_unit,
          barcode: r.barcode || undefined,
          imageUrl: r.image_url || undefined,
          baseReferencePrice: parseFloat(r.base_reference_price),
          isRomanianProduct: r.is_romanian_product,
          canonicalProductId: null
        }));
      const productsById = new Map(allProducts.map(p => [p.id, p]));

      const existingApprovedSignatures = new Map<string, string>();
      for (const er of existingApprovedRes.rows) {
        const key = [
          er.retailer_id,
          (er.raw_barcode || '').trim() || (er.raw_title || '').trim().toLowerCase(),
          Number.isFinite(parseFloat(er.effective_price)) ? parseFloat(er.effective_price).toFixed(2) : '0.00',
          er.package_quantity ? parseFloat(er.package_quantity) : '',
          (er.package_unit || '').toLowerCase()
        ].join('::');
        existingApprovedSignatures.set(key, String(er.id));
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const validUntilStr = row.valid_until ? new Date(row.valid_until).toISOString().split('T')[0] : null;
      const validation = this.validateStagingOfferCandidate({
        offer: {
          id: String(row.id),
          retailerId: row.retailer_id,
          documentId: row.document_id,
          rawTitle: row.raw_title,
          rawBrand: row.raw_brand,
          rawBarcode: row.raw_barcode,
          retailerSku: row.retailer_sku,
          rawCategory: row.raw_category,
          normalPrice: parseFloat(row.normal_price),
          promoPrice: row.promo_price ? parseFloat(row.promo_price) : null,
          loyaltyPrice: row.loyalty_price ? parseFloat(row.loyalty_price) : null,
          effectivePrice: parseFloat(row.effective_price),
          packageQuantity: row.package_quantity ? parseFloat(row.package_quantity) : null,
          packageUnit: row.package_unit,
          validUntil: validUntilStr,
          matchedProductId: row.matched_product_id,
          matchMethod: row.match_method,
          matchConfidence: row.match_confidence != null ? parseFloat(row.match_confidence) : null,
          stagingStatus: row.staging_status
        },
        validStoreIds,
        validDocumentIds,
        productsById,
        allProducts,
        batchSignatures: new Set<string>(),
        existingApprovedSignatures,
        requestedMatchedProductId: matchedProductId,
        aliasIndex: stagingAliasIndex,
        todayStr
      });

      if (!validation.valid) {
        await client.query(
          `UPDATE catalog_extracted_offers
           SET staging_status = CASE WHEN UPPER(staging_status) = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'NEEDS_REVIEW' END,
               validation_errors = $2::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [offerId, JSON.stringify(validation.errors)]
        );
        await client.query('COMMIT');
        return {
          success: false,
          validationErrors: validation.errors,
          message: `Oferta nu a trecut validarea: ${validation.errors.join(' ')}`
        };
      }

      const finalMatchedId = validation.resolvedProductId || row.matched_product_id || null;
      const finalMethod = validation.resolvedProductId ? (validation.resolvedMatchMethod || row.match_method) : row.match_method;
      const finalConfidence = validation.resolvedProductId ? (validation.resolvedMatchConfidence ?? row.match_confidence) : row.match_confidence;

      await client.query(
        `UPDATE catalog_extracted_offers
         SET staging_status = 'APPROVED',
             matched_product_id = $2,
             match_method = $3,
             match_confidence = $4,
             validation_errors = NULL,
             rejection_reason = NULL,
             reviewed_by = $5,
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [offerId, finalMatchedId, finalMethod || 'unmatched', finalConfidence || 0, userEmail]
      );

      await client.query(
        `INSERT INTO admin_audit_logs (id, user_email, action, target_type, target_id, details, ip_address, created_at)
         VALUES ($1, $2, 'approve_staging_offer', 'staging_offer', $3, $4, $5, NOW())`,
        [
          `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          userEmail,
          offerId,
          JSON.stringify({ previousStatus: currentStatus, newStatus: 'APPROVED', matchedProductId: finalMatchedId }),
          ipAddress || null
        ]
      );

      await client.query('COMMIT');
      return {
        success: true,
        offer: {
          id: String(row.id),
          runId: row.run_id || '',
          documentId: row.document_id || '',
          retailerId: row.retailer_id,
          rawTitle: row.raw_title,
          rawBrand: row.raw_brand || undefined,
          rawBarcode: row.raw_barcode || undefined,
          normalPrice: parseFloat(row.normal_price) || 0,
          promoPrice: row.promo_price ? parseFloat(row.promo_price) : undefined,
          effectivePrice: parseFloat(row.effective_price) || 0,
          currency: row.currency || 'RON',
          isPromo: Boolean(row.is_promo),
          matchedProductId: finalMatchedId || undefined,
          matchedProductName: validation.resolvedProductName || undefined,
          matchConfidence: Number(finalConfidence || 0),
          matchMethod: (finalMethod as any) || 'unmatched',
          stagingStatus: 'APPROVED',
          reviewedBy: userEmail,
          reviewedAt: new Date().toISOString(),
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date().toISOString()
        },
        message: 'Oferta a fost validată, aprobată și adăugată în lista de publicare.'
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw new Error(`Eroare la validarea ofertei în PostgreSQL: ${err.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Actualizare sau aprobare / respingere în lot a ofertelor din Staging cu validare strictă, tranzacție atomică și audit log
   */
  static async bulkReviewStagingOffers(params: {
    offerIds: string[];
    action: 'approve' | 'reject';
    rejectionReason?: string;
    userEmail?: string;
    ipAddress?: string;
  }): Promise<{
    count: number;
    approvedIds: string[];
    failedCount: number;
    failedItems: Array<{ id: string; rawTitle: string; errors: string[] }>;
    message: string;
  }> {
    const { offerIds, action, rejectionReason, userEmail = 'admin@cosulmeu.ro', ipAddress } = params;
    if (!offerIds || offerIds.length === 0) {
      return { count: 0, approvedIds: [], failedCount: 0, failedItems: [], message: 'Nu au fost furnizate oferte.' };
    }

    const pool = getPool();

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (action === 'reject') {
          const reason = rejectionReason || 'Respins manual în lot de administrator.';
          const updateRes = await client.query(
            `UPDATE catalog_extracted_offers
             SET staging_status = 'REJECTED',
                 reviewed_by = $1,
                 reviewed_at = NOW(),
                 rejection_reason = $2,
                 updated_at = NOW()
             WHERE id = ANY($3::varchar[])
               AND UPPER(staging_status) <> 'PUBLISHED'
             RETURNING id`,
            [userEmail, reason, offerIds]
          );
          const updatedIds = updateRes.rows.map(r => String(r.id));
          await client.query(
            `INSERT INTO admin_audit_logs (id, user_email, action, target_type, target_id, details, ip_address, created_at)
             VALUES ($1, $2, 'bulk_reject_staging_offers', 'staging_offers', $3, $4, $5, NOW())`,
            [
              `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              userEmail,
              `bulk:${offerIds.length}`,
              JSON.stringify({ requestedCount: offerIds.length, updatedCount: updatedIds.length, action, rejectionReason: reason, sampleOfferIds: updatedIds.slice(0, 5) }),
              ipAddress || null
            ]
          );
          await client.query('COMMIT');
          return {
            count: updatedIds.length,
            approvedIds: [],
            failedCount: Math.max(0, offerIds.length - updatedIds.length),
            failedItems: [],
            message: `${updatedIds.length} oferte au fost respinse cu succes în PostgreSQL.`
          };
        }

        // Acțiune: approve -> blocăm și validăm fiecare ofertă selectată
        const [selectedRes, storesRes, docsRes, productsRes, existingApprovedRes] = await Promise.all([
          client.query('SELECT * FROM catalog_extracted_offers WHERE id = ANY($1::varchar[]) FOR UPDATE', [offerIds]),
          client.query('SELECT id FROM stores'),
          client.query('SELECT id FROM catalog_documents'),
          client.query('SELECT * FROM products'),
          client.query(
            `SELECT id, retailer_id, raw_title, raw_barcode, effective_price, package_quantity, package_unit
             FROM catalog_extracted_offers
             WHERE UPPER(staging_status) IN ('APPROVED', 'VALIDATED') AND NOT (id = ANY($1::varchar[]))`,
            [offerIds]
          )
        ]);

        const validStoreIds = new Set(storesRes.rows.map(r => String(r.id)));
        const validDocumentIds = new Set(docsRes.rows.map(r => String(r.id)));
        const bulkAliasIndex = buildCanonicalAliasIndex(
          productsRes.rows.map(r => ({ id: r.id, canonicalProductId: r.canonical_product_id || null }))
        );
        const allProducts: Product[] = productsRes.rows
          .filter(r => !r.canonical_product_id && resolveCanonicalProductId(r.id, bulkAliasIndex) === r.id)
          .map(r => ({
            id: r.id,
            name: r.name,
            brand: r.brand,
            category: r.category as any,
            defaultUnit: r.default_unit,
            packageWeightOrVolume: parseFloat(r.package_weight_or_volume),
            packageUnit: r.package_unit,
            normalizedUnit: r.normalized_unit,
            barcode: r.barcode || undefined,
            imageUrl: r.image_url || undefined,
            baseReferencePrice: parseFloat(r.base_reference_price),
            isRomanianProduct: r.is_romanian_product,
            canonicalProductId: null
          }));
        const productsById = new Map(allProducts.map(p => [p.id, p]));

        const existingApprovedSignatures = new Map<string, string>();
        for (const er of existingApprovedRes.rows) {
          const key = [
            er.retailer_id,
            (er.raw_barcode || '').trim() || (er.raw_title || '').trim().toLowerCase(),
            Number.isFinite(parseFloat(er.effective_price)) ? parseFloat(er.effective_price).toFixed(2) : '0.00',
            er.package_quantity ? parseFloat(er.package_quantity) : '',
            (er.package_unit || '').toLowerCase()
          ].join('::');
          existingApprovedSignatures.set(key, String(er.id));
        }

        const batchSignatures = new Set<string>();
        const todayStr = new Date().toISOString().split('T')[0];
        const approvedIds: string[] = [];
        const failedItems: Array<{ id: string; rawTitle: string; errors: string[] }> = [];

        for (const row of selectedRes.rows) {
          const validUntilStr = row.valid_until ? new Date(row.valid_until).toISOString().split('T')[0] : null;
          const validation = this.validateStagingOfferCandidate({
            offer: {
              id: String(row.id),
              retailerId: row.retailer_id,
              documentId: row.document_id,
              rawTitle: row.raw_title,
              rawBrand: row.raw_brand,
              rawBarcode: row.raw_barcode,
              retailerSku: row.retailer_sku,
              rawCategory: row.raw_category,
              normalPrice: parseFloat(row.normal_price),
              promoPrice: row.promo_price ? parseFloat(row.promo_price) : null,
              loyaltyPrice: row.loyalty_price ? parseFloat(row.loyalty_price) : null,
              effectivePrice: parseFloat(row.effective_price),
              packageQuantity: row.package_quantity ? parseFloat(row.package_quantity) : null,
              packageUnit: row.package_unit,
              validUntil: validUntilStr,
              matchedProductId: row.matched_product_id,
              matchMethod: row.match_method,
              matchConfidence: row.match_confidence != null ? parseFloat(row.match_confidence) : null,
              stagingStatus: row.staging_status
            },
            validStoreIds,
            validDocumentIds,
            productsById,
            allProducts,
            batchSignatures,
            existingApprovedSignatures,
            aliasIndex: bulkAliasIndex,
            todayStr
          });

          if (validation.valid) {
            const finalMatchedId = validation.resolvedProductId || row.matched_product_id || null;
            const finalMethod = validation.resolvedProductId ? (validation.resolvedMatchMethod || row.match_method) : row.match_method;
            const finalConfidence = validation.resolvedProductId ? (validation.resolvedMatchConfidence ?? row.match_confidence) : row.match_confidence;

            await client.query(
              `UPDATE catalog_extracted_offers
               SET staging_status = 'APPROVED',
                   matched_product_id = $2,
                   match_method = $3,
                   match_confidence = $4,
                   validation_errors = NULL,
                   rejection_reason = NULL,
                   reviewed_by = $5,
                   reviewed_at = NOW(),
                   updated_at = NOW()
               WHERE id = $1`,
              [row.id, finalMatchedId, finalMethod || 'unmatched', finalConfidence || 0, userEmail]
            );
            approvedIds.push(String(row.id));
          } else {
            await client.query(
              `UPDATE catalog_extracted_offers
               SET staging_status = CASE WHEN UPPER(staging_status) = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'NEEDS_REVIEW' END,
                   validation_errors = $2::jsonb,
                   updated_at = NOW()
               WHERE id = $1`,
              [row.id, JSON.stringify(validation.errors)]
            );
            failedItems.push({
              id: String(row.id),
              rawTitle: row.raw_title || 'Produs fără denumire',
              errors: validation.errors
            });
          }
        }

        await client.query(
          `INSERT INTO admin_audit_logs (id, user_email, action, target_type, target_id, details, ip_address, created_at)
           VALUES ($1, $2, 'bulk_approve_staging_offers', 'staging_offers', $3, $4, $5, NOW())`,
          [
            `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            userEmail,
            `bulk:${offerIds.length}`,
            JSON.stringify({
              requestedCount: offerIds.length,
              approvedCount: approvedIds.length,
              failedCount: failedItems.length,
              sampleApprovedIds: approvedIds.slice(0, 5),
              sampleFailedIds: failedItems.slice(0, 5).map(f => ({ id: f.id, errors: f.errors }))
            }),
            ipAddress || null
          ]
        );

        await client.query('COMMIT');

        let message = `${approvedIds.length} oferte au fost validate, aprobate și pregătite pentru publicare.`;
        if (failedItems.length > 0 && approvedIds.length > 0) {
          message = `${approvedIds.length} oferte aprobate; ${failedItems.length} oferte au rămas nepublicate din cauza erorilor de validare.`;
        } else if (failedItems.length > 0 && approvedIds.length === 0) {
          message = `Nicio ofertă nu a trecut validarea (${failedItems.length} respinse de regulile de validare).`;
        }

        return {
          count: approvedIds.length,
          approvedIds,
          failedCount: failedItems.length,
          failedItems,
          message
        };
      } catch (err: any) {
        await client.query('ROLLBACK');
        throw new Error(`Eroare la actualizarea în lot în PostgreSQL: ${err.message}`);
      } finally {
        client.release();
      }
    }

    // Fallback fără pool PostgreSQL
    return {
      count: 0,
      approvedIds: [],
      failedCount: offerIds.length,
      failedItems: [],
      message: 'Baza de date PostgreSQL nu este disponibilă.'
    };
  }

  /**
   * Încarcă setul minim necesar pentru optimizarea coșului folosind exclusiv
   * interogări batch (zero N+1) și cache sigur pe datele publice de catalog.
   */
  static async getOptimizationDataset(
    items: Array<{ productId?: string; barcode?: string; name?: string }>
  ): Promise<{
    products: Product[];
    offers: ProductOffer[];
    stores: Store[];
    cacheHit: boolean;
    batchQueryMode: 'targeted_batch' | 'cached_catalog' | 'isolated_memory';
  }> {
    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const [products, offers] = await Promise.all([this.getProducts(), this.getOffers()]);
      return {
        products,
        offers,
        stores: STORES,
        cacheHit: false,
        batchQueryMode: 'isolated_memory'
      };
    }

    const now = Date.now();
    const getCachedStores = async (): Promise<{ stores: Store[]; hit: boolean }> => {
      if (publicCatalogOptCache.stores && publicCatalogOptCache.stores.expiresAt > now) {
        return { stores: publicCatalogOptCache.stores.data, hit: true };
      }
      const stores = await this.getStores();
      publicCatalogOptCache.stores = { data: stores, expiresAt: now + CATALOG_OPT_CACHE_TTL_MS };
      return { stores, hit: false };
    };

    const activeIdentifiers = (items || []).filter(i => (i.productId && i.productId.trim()) || (i.barcode && i.barcode.trim()));
    const allHaveDirectIdsOrEan = (items || []).length > 0 && activeIdentifiers.length === items.length;
    const pool = getPool();

    // Fast path: 100% of items carry productId or barcode AND Postgres pool is available -> batch SQL queries with multi-hop cycle-safe CTE
    if (allHaveDirectIdsOrEan && pool) {
      try {
        const productIds = Array.from(new Set(items.map(i => i.productId?.trim()).filter((v): v is string => Boolean(v))));
        const barcodes = Array.from(
          new Set(
            items.flatMap(i => (i.barcode?.trim() ? normalizeBarcodeCandidates(i.barcode.trim()) : []))
          )
        );

        const [storesRes, prodRes] = await Promise.all([
          getCachedStores(),
          pool.query(
            `WITH RECURSIVE upward AS (
               SELECT id, canonical_product_id, ARRAY[id]::text[] AS path, 0 AS depth
               FROM products
               WHERE ($1::text[] IS NOT NULL AND id = ANY($1::text[]))
                  OR ($2::text[] IS NOT NULL AND (
                        barcode = ANY($2::text[])
                        OR id IN (
                          SELECT rp.product_id
                          FROM retailer_products rp
                          WHERE rp.barcode = ANY($2::text[]) AND rp.product_id IS NOT NULL
                        )
                      ))
               UNION ALL
               SELECT parent.id, parent.canonical_product_id, u.path || parent.id, u.depth + 1
               FROM products parent
               JOIN upward u ON u.canonical_product_id = parent.id
               WHERE u.depth < 16 AND NOT (parent.id = ANY(u.path))
             ),
             roots AS (
               SELECT DISTINCT id
               FROM upward
               WHERE canonical_product_id IS NULL
             ),
             family AS (
               SELECT id, ARRAY[id]::text[] AS path, 0 AS depth
               FROM roots
               UNION ALL
               SELECT child.id, f.path || child.id, f.depth + 1
               FROM products child
               JOIN family f ON child.canonical_product_id = f.id
               WHERE f.depth < 16 AND NOT (child.id = ANY(f.path))
             )
             SELECT p.*
             FROM products p
             JOIN (SELECT DISTINCT id FROM family) fam ON fam.id = p.id`,
            [productIds.length > 0 ? productIds : null, barcodes.length > 0 ? barcodes : null]
          )
        ]);

        if (prodRes.rows.length > 0) {
          const allProdRows = prodRes.rows;
          const aliasIndex = buildCanonicalAliasIndex(
            allProdRows.map(r => ({ id: r.id, canonicalProductId: r.canonical_product_id || null }))
          );

          const allTargetProductIds = Array.from(new Set(allProdRows.map(r => r.id)));
          const [offersRes, promoRes, rpRes] = await Promise.all([
            pool.query(
              `SELECT po.*
               FROM product_offers po
               WHERE po.product_id = ANY($1::text[])
                 AND po.source != 'demo'
                 AND COALESCE(po.verification_status, 'verified') NOT IN ('demo', 'isolated', 'rejected')
                 AND COALESCE(po.is_flagged_anomaly, false) = false
                 AND po.price > 0
               ORDER BY po.observation_date ASC, po.last_checked ASC`,
              [allTargetProductIds]
            ),
            pool
              .query(
                `SELECT product_id, retailer_id, starts_at, ends_at, conditions, discovered_at
                 FROM promotions
                 WHERE product_id = ANY($1::text[])
                 ORDER BY discovered_at DESC`,
                [allTargetProductIds]
              )
              .catch(() => ({ rows: [] })),
            barcodes.length > 0
              ? pool
                  .query(
                    `SELECT product_id, barcode
                     FROM retailer_products
                     WHERE barcode = ANY($1::text[])
                       AND product_id = ANY($2::text[])
                       AND COALESCE(status, 'active') = 'active'`,
                    [barcodes, allTargetProductIds]
                  )
                  .catch(() => ({ rows: [] }))
              : Promise.resolve({ rows: [] })
          ]);

          const rpBarcodeByRootId = new Map<string, string>();
          for (const rp of rpRes.rows || []) {
            if (!rp.product_id || !rp.barcode) continue;
            const rootId = resolveCanonicalProductId(String(rp.product_id), aliasIndex) || String(rp.product_id);
            if (!rpBarcodeByRootId.has(rootId)) {
              rpBarcodeByRootId.set(rootId, String(rp.barcode).trim());
            }
          }

          const canonicalProducts: Product[] = [];
          const seenProdIds = new Set<string>();
          for (const r of allProdRows) {
            if (r.canonical_product_id || seenProdIds.has(r.id)) continue;
            seenProdIds.add(r.id);
            canonicalProducts.push({
              id: r.id,
              name: r.name,
              brand: r.brand,
              category: r.category,
              defaultUnit: r.default_unit || 'buc',
              packageWeightOrVolume: parseFloat(r.package_weight_or_volume) || 1,
              packageUnit: r.package_unit || 'buc',
              normalizedUnit: r.normalized_unit || 'buc',
              barcode: r.barcode || rpBarcodeByRootId.get(r.id) || undefined,
              imageUrl: r.image_url || undefined,
              isBio: Boolean(r.is_bio),
              isRomanianProduct: Boolean(r.is_romanian_product),
              baseReferencePrice: parseFloat(r.base_reference_price) || 0,
              canonicalProductId: null
            });
          }

          const mappedOffers: ProductOffer[] = offersRes.rows.map(r => ({
            id: r.id,
            productId: resolveCanonicalProductId(r.product_id, aliasIndex) || r.product_id,
            storeId: normalizeStoreIdKey(r.store_id),
            sourceId: r.source_id || undefined,
            currency: r.currency || 'RON',
            price: parseFloat(r.price),
            originalPrice: r.original_price ? parseFloat(r.original_price) : undefined,
            normalPrice: r.normal_price ? parseFloat(r.normal_price) : undefined,
            promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
            loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
            unitPrice: parseFloat(r.unit_price) || parseFloat(r.price),
            unitPriceMeasure: r.unit_price_measure || 'lei/buc',
            isPromo: Boolean(r.is_promo),
            promoDetails: r.promo_details || undefined,
            loyaltyCardRequired: Boolean(r.loyalty_card_required),
            loyaltyCardName: r.loyalty_card_name || undefined,
            validFrom: r.valid_from ? (r.valid_from.toISOString?.().split('T')[0] || String(r.valid_from).slice(0, 10)) : undefined,
            validUntil: r.valid_until ? (r.valid_until.toISOString?.().split('T')[0] || String(r.valid_until).slice(0, 10)) : undefined,
            observationDate: r.observation_date ? (r.observation_date.toISOString?.().split('T')[0] || String(r.observation_date).slice(0, 10)) : new Date().toISOString().split('T')[0],
            source: r.source,
            confidenceLevel: r.confidence_level || 'high',
            verificationStatus: r.verification_status || 'verified',
            lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : new Date().toISOString(),
            lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at).toISOString() : undefined,
            region: r.region || undefined,
            isSponsored: Boolean(r.is_sponsored),
            isFlaggedAnomaly: Boolean(r.is_flagged_anomaly),
            anomalyReason: r.anomaly_reason || undefined
          }));

          return {
            products: canonicalProducts,
            offers: enrichOffersWithPromotionDates(
              latestCanonicalOffers(mappedOffers),
              promoRes.rows || [],
              aliasIndex
            ),
            stores: storesRes.stores,
            cacheHit: storesRes.hit,
            batchQueryMode: 'targeted_batch'
          };
        }
      } catch (err: any) {
        console.warn('Targeted batch getOptimizationDataset failed, falling back to cached catalog:', err.message);
      }
    }

    // Safe public catalog cache path (batch fetch once per TTL window, no N+1)
    let hit = true;
    let products: Product[];
    if (publicCatalogOptCache.products && publicCatalogOptCache.products.expiresAt > now) {
      products = publicCatalogOptCache.products.data;
    } else {
      hit = false;
      products = await this.getProducts();
      publicCatalogOptCache.products = { data: products, expiresAt: now + CATALOG_OPT_CACHE_TTL_MS };
    }

    let offers: ProductOffer[];
    if (publicCatalogOptCache.offers && publicCatalogOptCache.offers.expiresAt > now) {
      offers = publicCatalogOptCache.offers.data;
    } else {
      hit = false;
      offers = await this.getOffers();
      publicCatalogOptCache.offers = { data: offers, expiresAt: now + CATALOG_OPT_CACHE_TTL_MS };
    }

    const storesRes = await getCachedStores();

    return {
      products,
      offers,
      stores: storesRes.stores,
      cacheHit: hit && storesRes.hit,
      batchQueryMode: 'cached_catalog'
    };
  }

  /**
   * FAZA 1A (STRICTLY READ-ONLY): Audit calitate date catalog (brand, cantitate/multipack, titlu, EAN/GS1)
   * Fără INSERT/UPDATE/DELETE, fără modificări de canonical_product_id sau price_observations.
   */
  static async getCatalogQualityAuditReport(options?: {
    sampleLimit?: number;
  }): Promise<CatalogDataQualityReport> {
    const sampleLimit = Math.min(Math.max(Number(options?.sampleLimit) || 15, 5), 50);

    const mapDbProductRow = (r: any): Product => ({
      id: String(r.id),
      name: String(r.name || ''),
      brand: String(r.brand || ''),
      category: (r.category || 'Alte produse') as Product['category'],
      defaultUnit: (r.default_unit || 'buc') as Product['defaultUnit'],
      packageWeightOrVolume: parseFloat(r.package_weight_or_volume) || 1,
      packageUnit: (r.package_unit || 'buc') as Product['packageUnit'],
      normalizedUnit: (r.normalized_unit || 'buc') as Product['normalizedUnit'],
      barcode: r.barcode || undefined,
      imageUrl: r.image_url || undefined,
      isBio: Boolean(r.is_bio),
      isRomanianProduct: Boolean(r.is_romanian_product),
      isSoldByWeight: Boolean(r.is_sold_by_weight),
      baseReferencePrice: parseFloat(r.base_reference_price) || 0,
      canonicalProductId: r.canonical_product_id || null
    });

    const mapDbRetailerProductRow = (r: any): RetailerProductRecord => ({
      id: String(r.id),
      retailerId: String(r.retailer_id || ''),
      productId: r.product_id ? String(r.product_id) : null,
      externalSku: r.external_sku || undefined,
      url: r.url || undefined,
      scrapedName: String(r.scraped_name || ''),
      scrapedBrand: r.scraped_brand || undefined,
      barcode: r.barcode || undefined,
      status: (r.status || 'active') as RetailerProductRecord['status']
    });

    const mapDbStagingRow = (r: any): CatalogExtractedOffer => ({
      id: String(r.id),
      runId: r.run_id || undefined,
      documentId: r.document_id || undefined,
      retailerId: String(r.retailer_id || ''),
      rawTitle: String(r.raw_title || ''),
      rawBrand: r.raw_brand || undefined,
      rawBarcode: r.raw_barcode || undefined,
      rawCategory: r.raw_category || undefined,
      normalPrice: parseFloat(r.normal_price) || 0,
      promoPrice: r.promo_price ? parseFloat(r.promo_price) : undefined,
      loyaltyPrice: r.loyalty_price ? parseFloat(r.loyalty_price) : undefined,
      effectivePrice: parseFloat(r.effective_price) || 0,
      currency: 'RON',
      packageQuantity: r.package_quantity ? parseFloat(r.package_quantity) : undefined,
      packageUnit: r.package_unit || undefined,
      unitPrice: r.unit_price ? parseFloat(r.unit_price) : undefined,
      unitPriceMeasure: r.unit_price_measure || undefined,
      isPromo: Boolean(r.is_promo),
      promoDetails: r.promo_details || undefined,
      loyaltyCardRequired: Boolean(r.loyalty_card_required),
      loyaltyCardName: r.loyalty_card_name || undefined,
      matchedProductId: r.matched_product_id || undefined,
      matchConfidence: parseFloat(r.match_confidence || '0'),
      matchMethod: (r.match_method || 'unmatched') as CatalogExtractedOffer['matchMethod'],
      stagingStatus: String(r.staging_status || 'NEEDS_REVIEW').toUpperCase() as CatalogExtractedOffer['stagingStatus'],
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date(0).toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date(0).toISOString()
    });

    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      return generateCatalogQualityReport({
        products: StorageService.getAllProducts(),
        retailerProducts: StorageService.getRetailerProducts(),
        stagingOffers: StorageService.getCatalogExtractedOffers(),
        dataSource: 'storage_service',
        sampleLimit
      });
    }

    const pool = getPool();
    if (pool) {
      try {
        const [prodRes, rpRes, stRes] = await Promise.all([
          pool.query(
            `SELECT id, name, brand, category, default_unit, package_weight_or_volume, package_unit, normalized_unit,
                    barcode, image_url, is_bio, is_romanian_product, is_sold_by_weight, base_reference_price, canonical_product_id
             FROM products`
          ),
          pool.query(
            `SELECT id, retailer_id, product_id, external_sku, url, scraped_name, scraped_brand, barcode, status
             FROM retailer_products`
          ).catch(() => ({ rows: [] as any[] })),
          pool.query(
            `SELECT id, run_id, document_id, retailer_id, raw_title, raw_brand, raw_barcode, raw_category,
                    normal_price, promo_price, loyalty_price, effective_price, package_quantity, package_unit,
                    unit_price, unit_price_measure, is_promo, promo_details, loyalty_card_required, loyalty_card_name,
                    matched_product_id, match_confidence, match_method, staging_status, created_at, updated_at
             FROM catalog_extracted_offers`
          ).catch(() => ({ rows: [] as any[] }))
        ]);

        if (prodRes.rows.length > 0) {
          return generateCatalogQualityReport({
            products: prodRes.rows.map(mapDbProductRow),
            retailerProducts: rpRes.rows.map(mapDbRetailerProductRow),
            stagingOffers: stRes.rows.map(mapDbStagingRow),
            dataSource: 'postgresql',
            sampleLimit
          });
        }
      } catch (err: any) {
        console.warn('Postgres pool getCatalogQualityAuditReport failed, falling back to Supabase:', err.message);
      }
    }

    try {
      const [prodRes, rpRes, stRes] = await Promise.all([
        fetchAllSupabaseRows((from, to) =>
          supabase
            .from('products')
            .select('id, name, brand, category, default_unit, package_weight_or_volume, package_unit, normalized_unit, barcode, image_url, is_bio, is_romanian_product, base_reference_price, canonical_product_id')
            .range(from, to)
        ),
        fetchAllSupabaseRows((from, to) =>
          supabase
            .from('retailer_products')
            .select('id, retailer_id, product_id, external_sku, url, scraped_name, scraped_brand, barcode, status')
            .range(from, to)
        ),
        fetchAllSupabaseRows((from, to) =>
          supabase
            .from('catalog_extracted_offers')
            .select('id, run_id, document_id, retailer_id, raw_title, raw_brand, raw_barcode, raw_category, normal_price, promo_price, loyalty_price, effective_price, package_quantity, package_unit, unit_price, unit_price_measure, is_promo, promo_details, loyalty_card_required, loyalty_card_name, matched_product_id, match_confidence, match_method, staging_status, created_at, updated_at')
            .range(from, to)
        )
      ]);

      if (!prodRes.error && Array.isArray(prodRes.data) && prodRes.data.length > 0) {
        return generateCatalogQualityReport({
          products: prodRes.data.map(mapDbProductRow),
          retailerProducts: !rpRes.error && Array.isArray(rpRes.data) ? rpRes.data.map(mapDbRetailerProductRow) : undefined,
          stagingOffers: !stRes.error && Array.isArray(stRes.data) ? stRes.data.map(mapDbStagingRow) : undefined,
          dataSource: 'supabase_readonly',
          sampleLimit
        });
      }
    } catch (err: any) {
      console.warn('Supabase getCatalogQualityAuditReport failed, falling back to memory:', err.message);
    }

    const { StorageService } = await import('../services/StorageService.ts');
    return generateCatalogQualityReport({
      products: StorageService.getAllProducts(),
      retailerProducts: StorageService.getRetailerProducts(),
      stagingOffers: StorageService.getCatalogExtractedOffers(),
      dataSource: 'storage_service',
      sampleLimit
    });
  }

  /**
   * FAZA 1B (STRICTLY READ-ONLY): Shadow Matching & Duplicate Detection pe catalogul curent.
   * ZERO INSERT/UPDATE/DELETE, ZERO modificări de canonical_product_id, oferte sau price_observations.
   */
  static async getShadowMatchingReport(options?: ShadowMatchingOptions): Promise<ShadowMatchingReport> {
    const mapDbProductRow = (r: any): Product => ({
      id: String(r.id),
      name: String(r.name || ''),
      brand: String(r.brand || ''),
      category: (r.category || 'Alte produse') as Product['category'],
      defaultUnit: (r.default_unit || 'buc') as Product['defaultUnit'],
      packageWeightOrVolume: parseFloat(r.package_weight_or_volume) || 1,
      packageUnit: (r.package_unit || 'buc') as Product['packageUnit'],
      normalizedUnit: (r.normalized_unit || 'buc') as Product['normalizedUnit'],
      barcode: r.barcode || undefined,
      imageUrl: r.image_url || undefined,
      isBio: Boolean(r.is_bio),
      isRomanianProduct: Boolean(r.is_romanian_product),
      isSoldByWeight: Boolean(r.is_sold_by_weight),
      baseReferencePrice: parseFloat(r.base_reference_price) || 0,
      canonicalProductId: r.canonical_product_id || null
    });

    const mapDbRetailerProductRow = (r: any): RetailerProductRecord => ({
      id: String(r.id),
      retailerId: String(r.retailer_id || ''),
      productId: r.product_id ? String(r.product_id) : null,
      externalSku: r.external_sku || undefined,
      url: r.url || undefined,
      scrapedName: String(r.scraped_name || ''),
      scrapedBrand: r.scraped_brand || undefined,
      barcode: r.barcode || undefined,
      status: (r.status || 'active') as RetailerProductRecord['status']
    });

    const mapDbOfferRow = (r: any): ProductOffer => ({
      id: String(r.id),
      productId: String(r.product_id),
      storeId: normalizeStoreIdKey(r.store_id),
      sourceId: r.source_id || undefined,
      price: parseFloat(r.price) || 0,
      unitPrice: parseFloat(r.unit_price) || parseFloat(r.price) || 0,
      unitPriceMeasure: (r.unit_price_measure || 'lei/buc') as ProductOffer['unitPriceMeasure'],
      isPromo: Boolean(r.is_promo),
      observationDate: r.observation_date ? String(r.observation_date).slice(0, 10) : '',
      source: (r.source || 'verified') as ProductOffer['source'],
      confidenceLevel: (r.confidence_level || 'high') as ProductOffer['confidenceLevel'],
      verificationStatus: (r.verification_status || 'verified') as ProductOffer['verificationStatus'],
      lastChecked: r.last_checked ? new Date(r.last_checked).toISOString() : ''
    });

    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      return ProductShadowMatchingService.generateShadowMatchingReport({
        products: StorageService.getAllProducts(),
        retailerProducts: StorageService.getRetailerProducts(),
        offers: StorageService.getProductOffers(),
        options: { ...options, dataSource: 'storage_service' }
      });
    }

    const pool = getPool();
    if (pool) {
      try {
        const [prodRes, rpRes, offRes] = await Promise.all([
          pool.query(
            `SELECT id, name, brand, category, default_unit, package_weight_or_volume, package_unit, normalized_unit,
                    barcode, image_url, is_bio, is_romanian_product, is_sold_by_weight, base_reference_price, canonical_product_id
             FROM products`
          ),
          pool.query(
            `SELECT id, retailer_id, product_id, external_sku, url, scraped_name, scraped_brand, barcode, status
             FROM retailer_products`
          ).catch(() => ({ rows: [] as any[] })),
          pool.query(
            `SELECT id, product_id, store_id, source_id, price, unit_price, unit_price_measure,
                    is_promo, observation_date, source, confidence_level, verification_status, last_checked
             FROM product_offers`
          ).catch(() => ({ rows: [] as any[] }))
        ]);

        if (prodRes.rows.length > 0) {
          return ProductShadowMatchingService.generateShadowMatchingReport({
            products: prodRes.rows.map(mapDbProductRow),
            retailerProducts: rpRes.rows.map(mapDbRetailerProductRow),
            offers: offRes.rows.map(mapDbOfferRow),
            options: { ...options, dataSource: 'postgresql' }
          });
        }
      } catch (err: any) {
        console.warn('Postgres pool getShadowMatchingReport failed, falling back to Supabase:', err.message);
      }
    }

    try {
      const [prodRes, rpRes, offRes] = await Promise.all([
        fetchAllSupabaseRows((from, to) =>
          supabase
            .from('products')
            .select('id, name, brand, category, default_unit, package_weight_or_volume, package_unit, normalized_unit, barcode, image_url, is_bio, is_romanian_product, base_reference_price, canonical_product_id')
            .range(from, to)
        ),
        fetchAllSupabaseRows((from, to) =>
          supabase
            .from('retailer_products')
            .select('id, retailer_id, product_id, external_sku, url, scraped_name, scraped_brand, barcode, status')
            .range(from, to)
        ),
        fetchAllSupabaseRows((from, to) =>
          supabase
            .from('product_offers')
            .select('id, product_id, store_id, source_id, price, unit_price, unit_price_measure, is_promo, observation_date, source, confidence_level, verification_status, last_checked')
            .range(from, to)
        )
      ]);

      if (!prodRes.error && Array.isArray(prodRes.data) && prodRes.data.length > 0) {
        return ProductShadowMatchingService.generateShadowMatchingReport({
          products: prodRes.data.map(mapDbProductRow),
          retailerProducts: !rpRes.error && Array.isArray(rpRes.data) ? rpRes.data.map(mapDbRetailerProductRow) : undefined,
          offers: !offRes.error && Array.isArray(offRes.data) ? offRes.data.map(mapDbOfferRow) : undefined,
          options: { ...options, dataSource: 'supabase_readonly' }
        });
      }
    } catch (err: any) {
      console.warn('Supabase getShadowMatchingReport failed, falling back to memory:', err.message);
    }

    const { StorageService } = await import('../services/StorageService.ts');
    return ProductShadowMatchingService.generateShadowMatchingReport({
      products: StorageService.getAllProducts(),
      retailerProducts: StorageService.getRetailerProducts(),
      offers: StorageService.getProductOffers(),
      options: { ...options, dataSource: 'storage_service' }
    });
  }

  /**
   * FAZA 1B (EXPLICIT & IDEMPOTENT ONLY):
   * Mapează și salvează candidații Shadow Matching (numai HIGH_CONFIDENCE / REVIEW)
   * în tabelul existent `product_match_candidates` cu status strict `'pending_confirmation'`.
   * NU modifică `products`, `canonical_product_id`, `product_offers`, `price_observations` sau `product_matches`.
   */
  static async saveShadowMatchCandidatesToExistingSchema(
    shadowCandidates: ShadowMatchCandidate[],
    options?: { allowCategories?: Array<'HIGH_CONFIDENCE' | 'REVIEW'> }
  ): Promise<{
    attempted: number;
    added: number;
    skippedBlockedOrLow: number;
    persisted: boolean;
    storageBackend: 'postgresql' | 'storage_service' | 'skipped_no_write';
  }> {
    const allowed = new Set(options?.allowCategories || ['HIGH_CONFIDENCE', 'REVIEW']);
    const eligible = (shadowCandidates || []).filter(c => allowed.has(c.decisionCategory as 'HIGH_CONFIDENCE' | 'REVIEW'));
    const skippedBlockedOrLow = (shadowCandidates || []).length - eligible.length;

    const mappedRows: ProductMatchCandidate[] = eligible.map(c => {
      const pkg = normalizeQuantityAndMultipack({ rawTitle: c.sourceTitle });
      return {
        id: c.candidateId.slice(0, 64),
        sourceRawName: (c.sourceTitle || 'Produs sursă').slice(0, 255),
        sourceBarcode: c.sourceBarcode ? c.sourceBarcode.slice(0, 64) : undefined,
        sourceBrand: c.sourceBrand ? c.sourceBrand.slice(0, 128) : undefined,
        sourcePackageWeightOrVolume: pkg.totalQuantity ?? undefined,
        sourcePackageUnit: pkg.totalUnit ?? undefined,
        matchedProductId: c.targetProductId.slice(0, 64),
        matchedProductName: (c.targetTitle || 'Produs țintă').slice(0, 255),
        confidenceScore: Number(Math.max(0, Math.min(1, c.matchingScore)).toFixed(3)),
        matchMethod: c.matchingMethod === 'gs1_exact' ? 'gtin_exact' : 'name_brand_similarity',
        status: 'pending_confirmation', // STRICT: NEVER auto_approved in Faza 1B
        createdAt: c.generatedAt || new Date().toISOString(),
        sourceProductId: c.sourceProductId,
        sourceRetailer: c.sourceRetailer,
        targetRetailer: c.targetRetailer,
        decisionCategory: c.decisionCategory,
        shadowMetadata: {
          matchingMethod: c.matchingMethod,
          recommendedAction: c.recommendedAction,
          normalizationVersion: c.normalizationVersion,
          sourcePackagingStructure: c.sourcePackagingStructure,
          targetPackagingStructure: c.targetPackagingStructure,
          differentStructureSameTotal: c.differentStructureSameTotal
        }
      };
    });

    if (mappedRows.length === 0) {
      return {
        attempted: 0,
        added: 0,
        skippedBlockedOrLow,
        persisted: false,
        storageBackend: 'skipped_no_write'
      };
    }

    if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
      const { StorageService } = await import('../services/StorageService.ts');
      const before = StorageService.getMatchCandidates().length;
      StorageService.addMatchCandidates(mappedRows);
      const after = StorageService.getMatchCandidates().length;
      return {
        attempted: mappedRows.length,
        added: Math.max(0, after - before),
        skippedBlockedOrLow,
        persisted: true,
        storageBackend: 'storage_service'
      };
    }

    const pool = getPool();
    if (!pool) {
      return {
        attempted: mappedRows.length,
        added: 0,
        skippedBlockedOrLow,
        persisted: false,
        storageBackend: 'skipped_no_write'
      };
    }

    const result = await this.addMatchCandidates(mappedRows);
    return {
      attempted: mappedRows.length,
      added: result.added,
      skippedBlockedOrLow,
      persisted: result.persisted,
      storageBackend: result.persisted ? 'postgresql' : 'skipped_no_write'
    };
  }
}


