// src/db/migrations/supabase-sync.js
import pg from 'pg';
const { Pool } = pg;

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  'postgres://postgres.bwanbgbimktluajvwzsj:JmpyZ55DR5f0oIVq@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString: connectionString.replace(/([?&])ssl(mode|cert|key|rootcert)=[^&]*/gi, '$1').replace(/[?&]$/, ''),
  ssl: { rejectUnauthorized: false }
});

export async function runSupabaseSyncMigration() {
  const client = await pool.connect();
  try {
    console.log('Connecting to PostgreSQL for synchronization setup...');
    await client.query('BEGIN');

    // 1. Ensure all 8 stores exist in stores table
    const stores = [
      { id: 'lidl', name: 'Lidl România', slug: 'lidl-chain', chain: 'Lidl România', brand_color: 'bg-blue-600', accent_color: 'text-yellow-500' },
      { id: 'kaufland', name: 'Kaufland România', slug: 'kaufland-chain', chain: 'Kaufland România', brand_color: 'bg-red-600', accent_color: 'text-red-600' },
      { id: 'carrefour', name: 'Carrefour România', slug: 'carrefour-chain', chain: 'Carrefour România', brand_color: 'bg-blue-700', accent_color: 'text-blue-600' },
      { id: 'penny', name: 'Penny România', slug: 'penny-chain', chain: 'Penny România', brand_color: 'bg-yellow-600', accent_color: 'text-red-600' },
      { id: 'auchan', name: 'Auchan România', slug: 'auchan-chain', chain: 'Auchan România', brand_color: 'bg-red-700', accent_color: 'text-red-700' },
      { id: 'profi', name: 'Profi Rom Food', slug: 'profi-chain', chain: 'Profi Rom Food', brand_color: 'bg-yellow-500', accent_color: 'text-yellow-600' },
      { id: 'mega-image', name: 'Mega Image', slug: 'mega-image-chain', chain: 'Mega Image', brand_color: 'bg-red-600', accent_color: 'text-blue-800' },
      { id: 'metro', name: 'Metro Cash & Carry România', slug: 'metro-chain', chain: 'Metro Cash & Carry România', brand_color: 'bg-yellow-600', accent_color: 'text-blue-900' }
    ];

    for (const s of stores) {
      await client.query(
        `INSERT INTO stores (id, name, slug, chain, brand_color, accent_color, sample_address, rating, locations_count)
         VALUES ($1, $2, $3, $4, $5, $6, 'România', 4.5, 200)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           chain = EXCLUDED.chain`,
        [s.id, s.name, s.slug, s.chain, s.brand_color, s.accent_color]
      );
    }

    // 2. Add Unique Constraints & Indexes
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_retailer_products_sku 
      ON retailer_products (retailer_id, external_sku) 
      WHERE external_sku IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_retailer_products_barcode 
      ON retailer_products (retailer_id, barcode) 
      WHERE barcode IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode 
      ON products (barcode) 
      WHERE barcode IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_promotions_source_url 
      ON promotions (retailer_id, source_url) 
      WHERE source_url IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_promotions_product 
      ON promotions (retailer_id, product_id) 
      WHERE product_id IS NOT NULL;
    `);

    // 3. Ensure sync metrics columns in catalog_import_runs
    await client.query(`
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS new_products_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS updated_products_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS unchanged_products_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS new_offers_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS updated_offers_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS expired_offers_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS changed_prices_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS unchanged_prices_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS items_without_price_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS items_without_offer_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS staging_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE catalog_import_runs ADD COLUMN IF NOT EXISTS error_details JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    // 4. Seed data_sources
    const dataSources = [
      { id: 'cat-src-lidl', name: 'Catalog Lidl România', store_id: 'lidl' },
      { id: 'cat-src-kaufland', name: 'Catalog Kaufland România', store_id: 'kaufland' },
      { id: 'cat-src-carrefour', name: 'Catalog Carrefour România', store_id: 'carrefour' },
      { id: 'cat-src-penny', name: 'Catalog Penny România', store_id: 'penny' },
      { id: 'cat-src-auchan', name: 'Catalog & Magazin Auchan România', store_id: 'auchan' },
      { id: 'cat-src-profi', name: 'Catalog Profi Rom Food', store_id: 'profi' },
      { id: 'cat-src-mega-image', name: 'Catalog Mega Image', store_id: 'mega-image' },
      { id: 'cat-src-metro', name: 'Catalog Metro Cash & Carry', store_id: 'metro' }
    ];
    for (const ds of dataSources) {
      await client.query(
        `INSERT INTO data_sources (id, name, type, status, store_id, format, requires_auth, description)
         VALUES ($1, $2, 'catalog_importer', 'active', $3, 'json', false, 'Sursă oficială integrată')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, store_id = EXCLUDED.store_id, status = 'active'`,
        [ds.id, ds.name, ds.store_id]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Supabase synchronization tables and constraints migrated successfully!');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run directly if script entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runSupabaseSyncMigration().catch(() => process.exit(1));
}
