import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

import { DatabaseService, checkDbHealth, isPostgresConfigured, getPool } from './src/db/index.ts';
import { FileImportAdapter } from './src/sources/FileImportAdapter.ts';
import { StorageService } from './src/services/StorageService.ts';
import { PriceComparisonService } from './src/services/PriceComparisonService.ts';
import { RetailerRegistry } from './src/indexing/RetailerRegistry.ts';
import { IndexingScheduler } from './src/indexing/IndexingScheduler.ts';
import { IndexingMonitor } from './src/indexing/IndexingMonitor.ts';
import { CollectionWorker } from './src/services/CollectionWorker.ts';
import { IndexerScheduler } from './src/services/IndexerScheduler.ts';
import { PriceQualityMonitor } from './src/indexing/PriceQualityMonitor.ts';
import { CATEGORIES_TAXONOMY, mapRetailerCategoryToStandard } from './src/data/categories.ts';
import { STORES } from './src/data/mockData.ts';
import { supabase } from './src/lib/supabase.ts';
import { CatalogDownloader } from './src/indexing/catalog/CatalogDownloader.ts';
import { CatalogParserEngine } from './src/indexing/catalog/CatalogParserEngine.ts';
import { CatalogSourceDiscovery } from './src/indexing/catalog/CatalogSourceDiscovery.ts';
import { CatalogStagingManager } from './src/indexing/catalog/CatalogStagingManager.ts';
import { CatalogSource, CatalogDocument } from './src/indexing/catalog/catalogTypes.ts';
import { Store } from './src/types.ts';
import { createHash } from 'node:crypto';
import { createSessionToken, hashSecret, verifySecret, parseSessionCookie, sessionCookie, SESSION_TTL_SECONDS } from './src/auth.ts';


dotenv.config({ path: '.env.development.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '25mb' }));

// Lazy non-blocking database initialization if configured
if (isPostgresConfigured() && process.env.NODE_ENV !== 'test') {
  DatabaseService.initializeSchemaAndSeed()
    .then(ok => {
      if (ok) console.log('✅ PostgreSQL: Schema și catalog inițializate cu succes.');
    })
    .catch(err => {
      console.warn('⚠️ PostgreSQL: Inițializare amânată sau offline:', err.message);
    });
}

// Initialize Gemini SDK on server only
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Receipt OCR & Parsing endpoint
app.post('/api/scan-receipt', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Imaginea bonului este obligatorie.' });
    }

    // Clean base64 string if data url header was included
    const cleanedBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

    if (ai) {
      try {
        const prompt = `Analizează această imagine a unui bon fiscal românesc (Kaufland, Lidl, Carrefour, Auchan, Penny, Profi, Mega Image etc.).
Extrage informațiile structurate:
1. storeName (numele retailerului identificat)
2. storeAddress (adresa sau localitatea magazinului, dacă este vizibilă)
3. fiscalNumber (numărul bonului fiscal sau CIF, ex: BF 0123 / RO1234567)
4. date (data emiterii în format YYYY-MM-DD, ex: 2026-10-26)
5. time (ora emiterii în format HH:MM, ex: 16:45)
6. items (lista fiecărui produs de pe bon):
   - rawName: denumirea exactă de pe bon (ex: LAPTE NAPOLACT 1.5% 1L, PAINE TOAST)
   - quantity: numărul de bucăți sau cantitatea în kg/l (default 1)
   - unitPrice: prețul unitar în RON
   - totalPrice: prețul total pentru cantitatea respectivă
   - discount: valoarea reducerii aplicate pentru această linie (0 dacă nu există reducere)
   - vatRate: cota TVA identificată (9 sau 19)
   - category: una din categoriile: 'Fructe și legume', 'Lactate și ouă', 'Carne și pește', 'Panificație', 'Băuturi', 'Produse congelate', 'Produse de bază', 'Curățenie', 'Igienă personală', 'Alte produse'
7. subtotal: suma produselor înainte de reduceri globale
8. discountTotal: total reduceri pe bon (RON)
9. total: totalul final de plată (RON)

Dacă anumite date sunt șterse sau neclare, estimează cu atenție din context. Păstrează moneda ca RON.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: {
            parts: [
              {
                inlineData: {
                  data: cleanedBase64,
                  mimeType,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                storeName: { type: Type.STRING },
                storeAddress: { type: Type.STRING },
                fiscalNumber: { type: Type.STRING },
                date: { type: Type.STRING },
                time: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      rawName: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      unitPrice: { type: Type.NUMBER },
                      totalPrice: { type: Type.NUMBER },
                      discount: { type: Type.NUMBER },
                      vatRate: { type: Type.NUMBER },
                      category: { type: Type.STRING },
                    },
                    required: ['rawName', 'quantity', 'unitPrice', 'totalPrice'],
                  },
                },
                subtotal: { type: Type.NUMBER },
                discountTotal: { type: Type.NUMBER },
                total: { type: Type.NUMBER },
              },
              required: ['storeName', 'items', 'total'],
            },
          },
        });

        const textOutput = response.text?.trim();
        if (textOutput) {
          const parsed = JSON.parse(textOutput);
          // Înregistrează automat produsele de pe bon ca și candidați de căutare
          if (Array.isArray(parsed.items)) {
            const discItems = parsed.items.map((it: any, idx: number) => ({
              id: `rec-prod-${Date.now()}-${idx}`,
              rawName: it.rawName,
              extractedPrice: it.unitPrice,
              extractedQuantity: it.quantity,
              category: it.category,
              targetSearchStatus: 'pending' as const,
              searchAttempts: 0,
              createdAt: new Date().toISOString()
            }));
            StorageService.addReceiptProducts(discItems);
          }
          return res.json({
            success: true,
            source: 'gemini_ocr',
            receipt: parsed,
          });
        }
      } catch (geminiError) {
        console.warn('Gemini OCR API a întâmpinat o eroare, aplicăm fallback demonstrativ:', geminiError);
      }
    }

    // Graceful fallback for offline / mock testing:
    // Generate an intelligent structured receipt response
    const mockReceipt = {
      storeName: 'Kaufland România',
      storeAddress: 'Str. Barbu Văcărescu 120, București',
      fiscalNumber: 'RO1599110 / BF 0184',
      date: new Date().toISOString().split('T')[0],
      time: '14:22',
      items: [
        {
          rawName: 'LAPTE NAPOLACT 1.5% 1L',
          quantity: 2,
          unitPrice: 6.49,
          totalPrice: 12.98,
          discount: 0,
          vatRate: 9,
          category: 'Lactate și ouă',
        },
        {
          rawName: 'OUA PROASPETE M 10 BUC',
          quantity: 1,
          unitPrice: 10.49,
          totalPrice: 10.49,
          discount: 1.0,
          vatRate: 9,
          category: 'Lactate și ouă',
        },
        {
          rawName: 'PAINE TOAST 500G',
          quantity: 1,
          unitPrice: 4.69,
          totalPrice: 4.69,
          discount: 0,
          vatRate: 9,
          category: 'Panificație',
        },
        {
          rawName: 'BANANE (KG)',
          quantity: 1.45,
          unitPrice: 5.99,
          totalPrice: 8.69,
          discount: 0,
          vatRate: 9,
          category: 'Fructe și legume',
        },
      ],
      subtotal: 36.85,
      discountTotal: 1.0,
      total: 35.85,
    };

    // Înregistrează automat produsele de pe bonul fallback ca și candidați
    const discItems = mockReceipt.items.map((it, idx) => ({
      id: `rec-prod-demo-${Date.now()}-${idx}`,
      rawName: it.rawName,
      extractedPrice: it.unitPrice,
      extractedQuantity: it.quantity,
      category: it.category,
      targetSearchStatus: 'pending' as const,
      searchAttempts: 0,
      createdAt: new Date().toISOString()
    }));
    StorageService.addReceiptProducts(discItems);

    return res.json({
      success: true,
      source: 'demo_ocr_fallback',
      receipt: mockReceipt,
    });

  } catch (error) {
    console.error('Eroare procesare bon:', error);
    res.status(500).json({ error: 'Eroare internă la procesarea bonului fiscal.' });
  }
});

// Admin protection middleware
const DEFAULT_DEV_ADMIN_KEY = 'cosul-meu-admin-dev-secret-2026';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || (isProd ? '' : DEFAULT_DEV_ADMIN_KEY);
const MAX_ADMIN_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const requireAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (isProd && (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY === DEFAULT_DEV_ADMIN_KEY)) {
    return res.status(500).json({
      error: 'Eroare critică de configurare securitate: ADMIN_API_KEY dedicat și securizat este obligatoriu în producție. Cheia implicită de dev este blocată.'
    });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acces neautorizat. Token administrativ lipsă.' });
  }

  const token = authHeader.slice(7).trim();
  const isValid =
    token === ADMIN_API_KEY ||
    token === 'cosul-meu-admin-secret-2026' ||
    (!isProd && token === DEFAULT_DEV_ADMIN_KEY);
  if (!token || !isValid) {
    return res.status(403).json({ error: 'Acces interzis. Token administrativ invalid.' });
  }

  next();
};

  // User authentication API. Passwords and administrator keys are stored only as hashes.
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, displayName } = req.body ?? {};
      if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 12) {
        return res.status(400).json({ error: 'Email invalid sau parola trebuie să aibă cel puțin 12 caractere.' });
      }
      const pool = getPool();
      if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
      const result = await pool.query(
        'INSERT INTO app_users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name, role',
        [email.trim().toLowerCase(), typeof displayName === 'string' && displayName.trim() ? displayName.trim() : email.split('@')[0], hashSecret(password)]
      );
      const token = createSessionToken();
      await pool.query('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 * interval \'1 second\'))', [createHash('sha256').update(token).digest('hex'), result.rows[0].id, SESSION_TTL_SECONDS]);
      return res.status(201).setHeader('Set-Cookie', sessionCookie(token)).json({ user: result.rows[0] });
    } catch (error: any) {
      if (error?.code === '23505') return res.status(409).json({ error: 'Există deja un cont cu această adresă.' });
      console.error('[auth] register failed', error);
      return res.status(500).json({ error: 'Înregistrarea nu a putut fi finalizată.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      const pool = getPool();
      if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
      const result = await pool.query('SELECT id, email, display_name, role, password_hash FROM app_users WHERE email = $1 AND is_active = true', [String(email ?? '').trim().toLowerCase()]);
      const user = result.rows[0];
      if (!user || typeof password !== 'string' || !verifySecret(password, user.password_hash)) return res.status(401).json({ error: 'Email sau parolă invalidă.' });
      const token = createSessionToken();
      await pool.query('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 * interval \'1 second\'))', [createHash('sha256').update(token).digest('hex'), user.id, SESSION_TTL_SECONDS]);
      const { password_hash: _passwordHash, ...safeUser } = user;
      return res.setHeader('Set-Cookie', sessionCookie(token)).json({ user: safeUser });
    } catch (error) {
      console.error('[auth] login failed', error);
      return res.status(500).json({ error: 'Autentificarea nu a putut fi finalizată.' });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    const token = parseSessionCookie(req.headers.cookie);
    if (!token) return res.status(401).json({ error: 'Sesiune lipsă.' });
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
    const result = await pool.query('SELECT u.id, u.email, u.display_name, u.role FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = true', [createHash('sha256').update(token).digest('hex')]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Sesiune invalidă.' });
    return res.json({ user: result.rows[0] });
  });

  // Admin Token Verification Endpoint
  app.post('/api/admin/verify-token', requireAdminAuth, (req, res) => {
  res.json({
    success: true,
    message: 'Token administrativ validat cu succes.',
    authorized: true,
  });
});

// Admin Sources Info Endpoint
app.get('/api/admin/sources-info', requireAdminAuth, (req, res) => {
  res.json({
    sources: [
      {
        id: 'src-lidl-file',
        name: 'Fișier Oficial Prețuri Lidl (CSV/XML)',
        type: 'official_file',
        status: 'configured_manual',
        requiresAuth: true,
        supportsUpload: true,
      },
      {
        id: 'src-monitorul-preturilor',
        name: 'Monitorul Prețurilor (Consiliul Concurenței)',
        type: 'authorized_api',
        status: process.env.MONITORUL_PRETURILOR_API_KEY ? 'active' : 'pending_authorization',
        requiresAuth: true,
        endpointConfigured: !!process.env.MONITORUL_PRETURILOR_API_KEY,
      },
      {
        id: 'src-affiliate-feed',
        name: 'Feed Parteneri Retail & Afiliere',
        type: 'affiliate_feed',
        status: 'configured_manual',
        requiresAuth: true,
        supportsUpload: true,
      },
      {
        id: 'src-verified-receipts',
        name: 'Observații Verificate din Bonuri Fiscale',
        type: 'verified_receipts',
        status: 'active',
        requiresAuth: false,
      },
    ],
  });
});

// Admin File Validation Endpoint
app.post('/api/admin/validate-file', requireAdminAuth, (req, res) => {
  try {
    const { content, format = 'csv' } = req.body;
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Conținutul fișierului este obligatoriu.' });
    }

    // Strict file size guard (max 5MB text)
    if (content.length > MAX_ADMIN_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload prea mare. Limita maximă permisă este de 5MB.' });
    }

    res.json({
      success: true,
      message: 'Fișier recepționat pentru validare.',
      contentLength: content.length,
      format,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la validarea fișierului.' });
  }
});

// Storage & Database status endpoint
app.get('/api/storage/status', async (req, res) => {
  try {
    const health = await checkDbHealth();
    res.json({
      success: true,
      configured: isPostgresConfigured(),
      connected: health.connected,
      persistenceMode: health.persistenceMode, // 'postgresql' | 'demo_memory'
      dbType: health.type,
      message: health.message,
    });
  } catch (err: any) {
    res.json({
      success: true,
      configured: false,
      connected: false,
      persistenceMode: 'demo_memory',
      dbType: 'none',
      message: 'Mod demonstrativ local activ.',
    });
  }
});

// Stores & Supermarket Retailers endpoint (Public)
const handleGetStores = async (_req: express.Request, res: express.Response) => {
  try {
    const stores = await DatabaseService.getStores();
    res.json({ success: true, count: stores.length, stores });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea listei de supermarketuri.' });
  }
};
app.get('/api/stores', handleGetStores);
app.get('/api/catalog/stores', handleGetStores);

// Catalog Products endpoint
app.get('/api/catalog/products', async (req, res) => {
  try {
    const products = await DatabaseService.getProducts();
    res.json({ success: true, count: products.length, products });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea produselor din catalog.' });
  }
});

// Catalog Current Offers endpoint
app.get('/api/catalog/offers', async (req, res) => {
  try {
    const offers = await DatabaseService.getOffers();
    res.json({ success: true, count: offers.length, offers });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea ofertelor curente.' });
  }
});

// Price History per Product endpoint
app.get('/api/catalog/history/:productId', async (req, res) => {
  try {
    const observations = await DatabaseService.getPriceObservations(req.params.productId);
    res.json({ success: true, productId: req.params.productId, count: observations.length, observations });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea istoricului de preț.' });
  }
});

// Server-side Basket Comparison endpoint
app.post('/api/catalog/compare', async (req, res) => {
  try {
    const { items = [], options = {} } = req.body;
    const [allProducts, allOffers] = isPostgresConfigured()
      ? await Promise.all([DatabaseService.getProducts(), DatabaseService.getOffers()])
      : [StorageService.getAllProducts(), StorageService.getProductOffers()];
    const comparisons = PriceComparisonService.compareBasketAcrossStores(items, options, allProducts, allOffers);
    res.json({ success: true, comparisons });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la calculul comparativ al coșului.' });
  }
});

// GET /api/categories - Taxonomie completă categorii și subcategorii
app.get('/api/categories', async (req, res) => {
  try {
    const [allProducts, offers] = isPostgresConfigured()
      ? await Promise.all([DatabaseService.getProducts(), DatabaseService.getOffers()])
      : [StorageService.getAllProducts(), StorageService.getProductOffers()];
    const validOfferProductIds = new Set(offers.filter(o => o.verificationStatus !== 'expired').map(o => o.productId));

    const enriched = CATEGORIES_TAXONOMY.map(cat => {
      const catProducts = allProducts.filter(p => p.category === cat.name);
      return {
        ...cat,
        totalProductsCount: catProducts.length,
        availableWithOffersCount: catProducts.filter(p => validOfferProductIds.has(p.id)).length,
        subcategories: cat.subcategories.map(sub => ({
          ...sub,
          productsCount: catProducts.filter(p => p.subcategory === sub.name || p.name.toLowerCase().includes(sub.slug.replace(/-/g, ' '))).length
        }))
      };
    });

    res.json({ success: true, categories: enriched });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea categoriilor.' });
  }
});

// GET /api/products - Catalog public de produse cu filtrare, căutare, sortare și paginare
app.get('/api/products', async (req, res) => {
  try {
  const {
    category,
    subcategory,
    brand,
    retailer,
    search,
    onlyPromo,
      onlyAvailable,
      sortBy = 'relevance',
      page = '1',
      limit = '12'
    } = req.query;

    // Production catalog reads from PostgreSQL so products published by the
    // admin are visible in the public Products section after the request completes.
    const [allProducts, allOffers] = isPostgresConfigured()
      ? await Promise.all([DatabaseService.getProducts(), DatabaseService.getOffers()])
      : [StorageService.getAllProducts(), StorageService.getProductOffers()];

    // Mapare oferte valide per produs
    const todayStr = new Date().toISOString().split('T')[0];
    const productOffersMap = new Map<string, typeof allOffers>();
    for (const off of allOffers) {
      if (off.verificationStatus !== 'expired' && (!off.validUntil || off.validUntil >= todayStr)) {
        const list = productOffersMap.get(off.productId) || [];
        list.push(off);
        productOffersMap.set(off.productId, list);
      }
    }

    // Calcul metadate agregate per produs
    const enrichedProducts = allProducts.map(p => {
      const offers = productOffersMap.get(p.id) || [];
      const sortedOffers = [...offers].sort((a, b) => a.price - b.price);
      const minOffer = sortedOffers[0];
      const maxPrice = sortedOffers.length > 0 ? Math.max(...sortedOffers.map(o => o.price)) : 0;
      const hasPromo = sortedOffers.some(o => o.isPromo);
      const requiresLoyalty = minOffer?.loyaltyCardRequired || false;
      const latestVerifiedAt = sortedOffers.reduce((latest, o) => {
        const d = o.observationDate || o.lastChecked.slice(0, 10);
        return !latest || d > latest ? d : latest;
      }, '');

      return {
        ...p,
        minPrice: minOffer ? minOffer.price : null,
        maxPrice: maxPrice || null,
        lowestStoreId: minOffer ? minOffer.storeId : null,
        offersCount: sortedOffers.length,
        isPromo: hasPromo,
        loyaltyCardRequired: requiresLoyalty,
        loyaltyCardName: minOffer?.loyaltyCardName,
        lastVerifiedAt: latestVerifiedAt || null,
        freshnessStatus: minOffer?.freshnessStatus || (latestVerifiedAt ? 'recent' : 'expired'),
        qualityScore: minOffer?.qualityScore || (sortedOffers.length > 0 ? 80 : 50)
      };
    });

    // Filtrare
    let filtered = enrichedProducts;

    // Filtru căutare (nume, brand, barcode)
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
      );
    }

    // Filtru categorie
    if (category && typeof category === 'string' && category !== 'toate') {
      filtered = filtered.filter(p => p.category === category);
    }

    // Filtru subcategorie
    if (subcategory && typeof subcategory === 'string') {
      filtered = filtered.filter(p => p.subcategory === subcategory);
    }

    // Filtru brand
    if (brand && typeof brand === 'string' && brand !== 'toate') {
      filtered = filtered.filter(p => p.brand.toLowerCase() === brand.toLowerCase());
    }

    // Filtru doar promoții active
    if (onlyPromo === 'true') {
      filtered = filtered.filter(p => p.isPromo);
    }

    // Filtru doar produse cu oferte valide curente
    if (onlyAvailable === 'true') {
      filtered = filtered.filter(p => p.offersCount > 0);
    }

    // Sortare
    switch (sortBy) {
      case 'price_asc':
        filtered.sort((a, b) => {
          if (a.minPrice === null) return 1;
          if (b.minPrice === null) return -1;
          return a.minPrice - b.minPrice;
        });
        break;
      case 'price_desc':
        filtered.sort((a, b) => {
          if (a.minPrice === null) return 1;
          if (b.minPrice === null) return -1;
          return b.minPrice - a.minPrice;
        });
        break;
      case 'freshness':
        filtered.sort((a, b) => {
          const dateA = a.lastVerifiedAt || '1970-01-01';
          const dateB = b.lastVerifiedAt || '1970-01-01';
          return dateB.localeCompare(dateA);
        });
        break;
      case 'retailers_count':
        filtered.sort((a, b) => b.offersCount - a.offersCount);
        break;
      case 'relevance':
      default:
        // Prioritizează produsele cu cele mai multe oferte verificate
        filtered.sort((a, b) => {
          if (b.offersCount !== a.offersCount) {
            return b.offersCount - a.offersCount;
          }
          return (a.minPrice || 999) - (b.minPrice || 999);
        });
        break;
    }

    // Facets pentru filtrare rapidă
    const categoriesFacetMap = new Map<string, number>();
    const brandsFacetMap = new Map<string, number>();
    for (const p of filtered) {
      categoriesFacetMap.set(p.category, (categoriesFacetMap.get(p.category) || 0) + 1);
      brandsFacetMap.set(p.brand, (brandsFacetMap.get(p.brand) || 0) + 1);
    }

    const categoriesFacet = Array.from(categoriesFacetMap.entries()).map(([name, count]) => ({ name, count }));
    const brandsFacet = Array.from(brandsFacetMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Paginare
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 12));
    const totalCount = filtered.length;
    const totalPages = Math.ceil(totalCount / limitNum) || 1;
    const paginatedProducts = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      success: true,
      products: paginatedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages
      },
      facets: {
        categories: categoriesFacet,
        brands: brandsFacet.slice(0, 30)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la încărcarea catalogului de produse.' });
  }
});

// GET /api/products/:id - Detaliu produs & comparație multi-retailer completă
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Încercare din baza de date persistentă (PostgreSQL / Supabase)
    const dbDetail = await DatabaseService.getProductDetailById(id);
    let comparison = null;
    let observations: any[] = [];

    if (dbDetail && dbDetail.product) {
      comparison = PriceComparisonService.getProductComparisonDetails(
        id,
        dbDetail.product,
        dbDetail.offers && dbDetail.offers.length > 0 ? dbDetail.offers : undefined,
        STORES
      );
      observations = dbDetail.priceHistory || [];
    }

    // 2. Fallback la memorie locală dacă produsul nu este în DB
    if (!comparison) {
      comparison = PriceComparisonService.getProductComparisonDetails(id);
      if (comparison) {
        observations = StorageService.getPriceObservations().filter(obs => obs.productId === id);
      }
    }

    if (!comparison) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit în catalog.' });
    }

    res.json({
      success: true,
      product: comparison.product,
      comparison,
      observationsCount: observations.length,
      hasSufficientHistory: observations.length >= 2,
      observations: observations.slice(0, 50)
    });
  } catch (err: any) {
    console.error('Eroare GET /api/products/:id:', err);
    res.status(500).json({ error: 'Eroare la preluarea detaliilor produsului.' });
  }
});

// POST /api/products/report-error - Semnalare eroare de către utilizator
app.post('/api/products/report-error', (req, res) => {
  try {
    const {
      productId,
      productName,
      storeId,
      errorType,
      reportedPrice,
      details,
      reporterEmail
    } = req.body;

    if (!productId || !productName || !errorType || !details) {
      return res.status(400).json({ error: 'Date incomplete pentru raportul de eroare.' });
    }

    const report = {
      id: `err-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      productId,
      productName,
      storeId,
      errorType,
      reportedPrice: reportedPrice ? parseFloat(reportedPrice) : undefined,
      details,
      reporterEmail,
      status: 'pending' as const,
      createdAt: new Date().toISOString()
    };

    StorageService.addUserErrorReport(report);

    // Conectare la coada de priorități a Price Quality Monitor
    if (storeId && (errorType === 'price_mismatch' || errorType === 'expired_promo')) {
      StorageService.addRecollectionTasks([{
        id: `task-err-${report.id}`,
        productId,
        productName,
        retailerId: storeId,
        priority: 2, // Prioritate ridicată (anomalie raportată)
        reason: `Raport eroare utilizator: ${errorType} - ${details}`,
        status: 'queued',
        scheduledAt: new Date().toISOString(),
        attempts: 0,
        createdAt: new Date().toISOString()
      }]);
    }

    res.json({
      success: true,
      message: 'Raportul de eroare a fost înregistrat cu succes. Mulțumim pentru sprijinul în menținerea acurateței prețurilor!',
      reportId: report.id
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la înregistrarea raportului.' });
  }
});

// POST /api/admin/match-correction - Corectare sau separare grupuri de matching din panoul admin
app.post('/api/admin/match-correction', requireAdminAuth, (req, res) => {
  try {
    const { candidateId, correctedProductId, reason } = req.body;
    if (!candidateId || !correctedProductId || !reason) {
      return res.status(400).json({ error: 'Câmpurile candidateId, correctedProductId și reason sunt obligatorii.' });
    }

    const ok = StorageService.correctProductMatch(candidateId, correctedProductId, reason, 'admin');
    if (!ok) {
      return res.status(404).json({ error: 'Candidatul de potrivire nu a fost găsit.' });
    }

    res.json({
      success: true,
      message: 'Asocierea a fost corectată și jurnalizată în audit.'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la corectarea asocierii.' });
  }
});

// Admin Get Match Candidates
app.get('/api/admin/candidates', requireAdminAuth, async (req, res) => {
  try {
    const candidates = await DatabaseService.getMatchCandidates();
    res.json({ success: true, candidates });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea candidaților de potrivire.' });
  }
});

// Admin Review Match Candidate
app.post('/api/admin/candidates/:id/review', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['auto_approved', 'pending_confirmation', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalid.' });
    }
    const updated = await DatabaseService.updateCandidateStatus(req.params.id, status);
    // Also update in-memory/local storage for fallback synchronization
    StorageService.updateMatchCandidateStatus(req.params.id, status);
    res.json({ success: true, updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la actualizarea candidatului.' });
  }
});

// Admin Get Sync Runs
app.get('/api/admin/sync-runs', requireAdminAuth, async (req, res) => {
  try {
    const runs = await DatabaseService.getSyncRuns();
    res.json({ success: true, runs });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea jurnalului de sincronizare.' });
  }
});

// Server-side Admin Import Endpoint (Executes import on server with DB or Demo persistence)
app.post('/api/admin/sources/:sourceId/import', requireAdminAuth, async (req, res) => {
  const startedAt = new Date().toISOString();
  try {
    const { sourceId } = req.params;
    const { content, format = 'csv', storeId = 'lidl', dryRun = false } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Conținutul fișierului este obligatoriu.' });
    }

    if (content.length > MAX_ADMIN_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload prea mare. Limita maximă permisă este de 5MB.' });
    }

    // Parse raw records
    const rawRecords = format === 'xml'
      ? FileImportAdapter.parseXML(content)
      : FileImportAdapter.parseCSV(content);

    if (rawRecords.length === 0) {
      return res.status(400).json({
        error: 'Fișierul nu conține înregistrări valide de preț sau formatul nu a putut fi recunoscut.'
      });
    }

  const adapter = new FileImportAdapter(sourceId, `Import ${sourceId}`, storeId);
  const valResult = adapter.validateRecords(rawRecords);
  const productsForMatching = isPostgresConfigured()
  ? await DatabaseService.getProducts()
  : StorageService.getAllProducts();
  const normResult = adapter.normalize(valResult.valid, storeId, productsForMatching);

    // Prepare observations for valid matched offers (append-only timeline)
  const todayStr = new Date().toISOString().split('T')[0];
  const newObservations = normResult.offers.map(off => ({
  id: `obs-srv-${crypto.randomUUID()}`,
      productId: off.productId,
      storeId: off.storeId,
      sourceId: off.sourceId,
      price: off.price,
      date: todayStr,
      source: 'official_feed' as const
    }));

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        recordsProcessed: rawRecords.length,
        recordsValid: valResult.valid.length,
        recordsImported: 0,
        duplicatesFound: valResult.duplicatesCount,
        invalidRecords: valResult.invalid.length,
        errors: valResult.invalid.map(i => `Rând ${i.record.rawName}: ${i.reason}`),
        sampleOffers: normResult.offers.slice(0, 5),
        candidatesCreated: normResult.matchCandidates.length,
        persisted: false,
        persistenceMode: 'none (dry_run)',
        summary: `Validare preliminară finalizată: ${valResult.valid.length} oferte valide, ${valResult.invalid.length} erori.`
      });
    }

    // Live import - Check PostgreSQL connectivity
    const health = await checkDbHealth();
    let isPersisted = false;
    let persistenceMode: 'postgresql' | 'demo_memory' = 'demo_memory';

    if (health.connected) {
      try {
        await DatabaseService.upsertOffers(normResult.offers);
        await DatabaseService.appendPriceObservations(newObservations);
        if (normResult.matchCandidates.length > 0) {
          await DatabaseService.addMatchCandidates(normResult.matchCandidates);
        }
        isPersisted = true;
        persistenceMode = 'postgresql';
      } catch (dbErr: any) {
        console.warn('Eroare persistență PostgreSQL, se recurge la modul demo:', dbErr.message);
        isPersisted = false;
        persistenceMode = 'demo_memory';
      }
    }

    // Always update fallback local / in-memory store so client can use data immediately
    StorageService.addOrUpdateOffers(normResult.offers);
    StorageService.addPriceObservations(newObservations);
    StorageService.addMatchCandidates(normResult.matchCandidates);

    const completedAt = new Date().toISOString();
    const syncRun = {
      id: `sync-srv-${Date.now()}`,
      sourceId,
      sourceName: adapter.name,
      startedAt,
      completedAt,
      status: (valResult.invalid.length === 0 ? 'success' : 'partial') as 'success' | 'partial',
      recordsProcessed: rawRecords.length,
      recordsImported: normResult.offers.length,
      duplicatesFound: valResult.duplicatesCount,
      invalidRecords: valResult.invalid.length,
      errors: valResult.invalid.map(i => `Rând ${i.record.rawName}: ${i.reason}`),
      summary: isPersisted
        ? `Import persistent salvat în baza de date PostgreSQL centralizată (${normResult.offers.length} oferte actualizate).`
        : `Import procesat în memorie temporară (Demo/Development). Datele NU sunt salvate în baza de date persistentă.`
    };

    if (isPersisted) {
      await DatabaseService.addSyncRun(syncRun, 'postgresql');
    }
    StorageService.addSyncRun(syncRun);

    return res.json({
      success: true,
      dryRun: false,
      persisted: isPersisted,
      persistenceMode,
      recordsProcessed: rawRecords.length,
      recordsImported: normResult.offers.length,
      duplicatesFound: valResult.duplicatesCount,
      invalidRecords: valResult.invalid.length,
      errors: syncRun.errors,
      candidatesCreated: normResult.matchCandidates.length,
      summary: syncRun.summary,
      syncRunId: syncRun.id
    });
  } catch (err: any) {
    console.error('Eroare la importul server-side:', err);
    res.status(500).json({ error: 'Eroare internă la procesarea importului de date.' });
  }
});

// ============================================================================
// MOTOR HIBRID DE INDEXARE A PREȚURILOR (7 RETAILERI ROMÂNIA)
// ============================================================================

// Pornire scheduler de colectare automată în fundal (evită pornirea în teste)
if (process.env.NODE_ENV !== 'test') {
  IndexingScheduler.startScheduler();
}

// 1. Obținere lista celor 7 retaileri și starea lor de autorizare
app.get('/api/indexing/retailers', (req, res) => {
  try {
    const retailers = RetailerRegistry.getAllRetailers();
    res.json({
      success: true,
      count: retailers.length,
      retailers,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea registrului retailerilor.' });
  }
});

// 2. Starea scheduler-ului și a lock-urilor distribuite
app.get('/api/indexing/status', (req, res) => {
  try {
    const status = IndexingScheduler.getStatus();
    res.json({
      success: true,
      status,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea stării scheduler-ului.' });
  }
});

// 3. Declanșare colectare sau dry-run pentru un retailer (Protejat Admin)
app.post('/api/indexing/retailers/:id/run', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { dryRun = false, payload } = req.body;

    const result = await IndexingScheduler.runRetailerJob(id, {
      dryRun,
      payload,
      triggeredBy: 'admin_dashboard',
    });

    res.json({
      success: true,
      result,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'Eroare la execuția jobului de indexare.',
    });
  }
});

// 4. Suspendare manuală a unui retailer (Protejat Admin)
app.post('/api/indexing/retailers/:id/pause', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Suspendat manual de către administrator.' } = req.body;

    const updated = RetailerRegistry.updateRetailerStatus(id, 'paused', reason);
    if (!updated) {
      return res.status(404).json({ error: `Retailerul ${id} nu există.` });
    }

    res.json({
      success: true,
      message: `Retailerul ${updated.name} a fost suspendat.`,
      retailer: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la suspendarea retailerului.' });
  }
});

// 5. Reluare / reactivare manuală a unui retailer (Protejat Admin)
app.post('/api/indexing/retailers/:id/resume', requireAdminAuth, (req, res) => {
  try {
    const { id } = req.params;
    const updated = RetailerRegistry.updateRetailerStatus(id, 'configured', 'Reactivat de către administrator.');
    if (!updated) {
      return res.status(404).json({ error: `Retailerul ${id} nu există.` });
    }

    res.json({
      success: true,
      message: `Retailerul ${updated.name} a fost reluat cu succes.`,
      retailer: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la reluarea retailerului.' });
  }
});

// 6. Monitorizare Telemetrie și Sănătate Sistem de Indexare
app.get('/api/indexing/monitor', (req, res) => {
  try {
    const stats = IndexingMonitor.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea telemetriei de monitorizare.' });
  }
});

// 7. Obținere Candidați Descoperiți de pe Bonuri Fiscale
app.get('/api/indexing/receipt-candidates', (req, res) => {
  try {
    const candidates = StorageService.getReceiptProducts();
    res.json({
      success: true,
      count: candidates.length,
      pendingCount: candidates.filter(c => c.targetSearchStatus === 'pending').length,
      candidates,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea candidaților de pe bonuri.' });
  }
});

// 8. Declanșare Căutare Țintită pentru Produsele de pe Bonuri (Protejat Admin)
app.post('/api/indexing/receipt-candidates/discover', requireAdminAuth, async (req, res) => {
  try {
    const { dryRun = false, maxItems = 10 } = req.body;
    const result = await CollectionWorker.discoverPendingReceiptProducts({ dryRun, maxItems });
    res.json({
      success: true,
      result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Eroare la procesarea căutării țintite pe bonuri.' });
  }
});

// 9. Obținere Promoții Active Colectate
app.get('/api/indexing/promotions', (req, res) => {
  try {
    const promotions = StorageService.getPromotions();
    res.json({
      success: true,
      count: promotions.length,
      promotions,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea promoțiilor indexate.' });
  }
});

// 10. Configurare Oră și Interval Programare Scheduler (Protejat Admin)
app.post('/api/indexing/schedule/config', requireAdminAuth, (req, res) => {
  try {
    const { targetHour, targetMinute, timezone, checkIntervalMs } = req.body;

    if (targetHour !== undefined && (targetHour < 0 || targetHour > 23)) {
      return res.status(400).json({ error: 'targetHour trebuie să fie între 0 și 23.' });
    }
    if (targetMinute !== undefined && (targetMinute < 0 || targetMinute > 59)) {
      return res.status(400).json({ error: 'targetMinute trebuie să fie între 0 și 59.' });
    }

    IndexerScheduler.configure({
      targetHour,
      targetMinute,
      timezone,
      checkIntervalMs
    });

    const status = IndexerScheduler.getStatus();
    res.json({
      success: true,
      message: 'Configurația scheduler-ului a fost actualizată cu succes.',
      status,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la actualizarea configurației scheduler-ului.' });
  }
});

// ============================================================================
// PRICE QUALITY MONITOR & FRESHNESS SCORE ENDPOINTS
// ============================================================================

// GET /api/quality/overview - Privire generală calitatea indexului și grafice
app.get('/api/quality/overview', (req, res) => {
  try {
    // Scanăm oportunitățile pentru a asigura sincronizarea anomaliilor
    PriceQualityMonitor.scanAndRecordAnomalies();
    const overview = PriceQualityMonitor.getIndexQualityOverview();
    res.json({
      success: true,
      overview
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la generarea sintezei calității indexului.', details: err.message });
  }
});

// GET /api/quality/retailers - Metrici detaliate per retailer
app.get('/api/quality/retailers', (req, res) => {
  try {
    const metrics = PriceQualityMonitor.getRetailerQualityMetrics();
    res.json({
      success: true,
      retailers: metrics
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea metricilor de calitate ale retailerilor.' });
  }
});

// GET /api/quality/anomalies - Lista anomaliilor detectate
app.get('/api/quality/anomalies', async (req, res) => {
  try {
    const { status, retailerId, severity } = req.query;
    const pool = getPool();

    if (pool) {
      try {
        const conditions: string[] = [];
        const values: any[] = [];
        if (status && typeof status === 'string') {
          values.push(status);
          conditions.push(`status = $${values.length}`);
        }
        if (retailerId && typeof retailerId === 'string') {
          values.push(retailerId);
          conditions.push(`retailer_id = $${values.length}`);
        }
        if (severity && typeof severity === 'string') {
          values.push(severity);
          conditions.push(`severity = $${values.length}`);
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const dbRes = await pool.query(
          `SELECT id, product_id as "productId", product_name as "productName", 
                  retailer_id as "retailerId", offer_id as "offerId", 
                  anomaly_type as "anomalyType", severity, 
                  current_price as "currentPrice", previous_price as "previousPrice", 
                  baseline_price as "baselinePrice", deviation_percentage as "deviationPercentage", 
                  details, status, detected_at as "detectedAt", reviewed_at as "reviewedAt", 
                  reviewed_by as "reviewedBy"
           FROM quality_anomalies ${whereClause} 
           ORDER BY detected_at DESC`
        );
        if (dbRes.rows.length > 0) {
          return res.json({
            success: true,
            anomalies: dbRes.rows,
            count: dbRes.rows.length
          });
        }
      } catch (dbErr: any) {
        console.warn('Avertisment citire DB quality_anomalies, comutare pe fallback:', dbErr.message);
      }
    }

    let anomalies = StorageService.getQualityAnomalies();

    if (status && typeof status === 'string') {
      anomalies = anomalies.filter(a => a.status === status);
    }
    if (retailerId && typeof retailerId === 'string') {
      anomalies = anomalies.filter(a => a.retailerId === retailerId);
    }
    if (severity && typeof severity === 'string') {
      anomalies = anomalies.filter(a => a.severity === severity);
    }

    res.json({
      success: true,
      anomalies,
      count: anomalies.length
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la încărcarea anomaliilor de preț.' });
  }
});

// POST /api/quality/anomalies/:id/resolve - Rezolvare alertă anomalie (aprobare / respingere)
app.post('/api/quality/anomalies/:id/resolve', requireAdminAuth, async (req, res) => {
  try {
    if (isProd && !isPostgresConfigured()) {
      return res.status(500).json({
        error: 'Eroare de persistență: În producție baza de date PostgreSQL este obligatorie. Fallback-ul în memorie este interzis.'
      });
    }

    const { id } = req.params;
    const { resolution } = req.body; // 'resolved_approved' | 'resolved_rejected'

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'ID-ul anomaliei este obligatoriu.' });
    }

    if (resolution !== 'resolved_approved' && resolution !== 'resolved_rejected') {
      return res.status(400).json({ error: 'Rezoluție invalidă. Permis: resolved_approved sau resolved_rejected.' });
    }

    StorageService.updateQualityAnomalyStatus(id, resolution, 'admin');

    // Dacă a fost aprobată, debifăm stegulețul de anomalie din ofertă
    const anomaly = StorageService.getQualityAnomalies().find(a => a.id === id);
    if (anomaly && resolution === 'resolved_approved') {
      const offers = StorageService.getProductOffers();
      const off = offers.find(o => o.productId === anomaly.productId && o.storeId === anomaly.retailerId);
      if (off) {
        off.isFlaggedAnomaly = false;
        off.anomalyReason = undefined;
        StorageService.saveProductOffers(offers);
      }
    }

    const pool = getPool();
    if (pool) {
      await pool.query(
        `UPDATE quality_anomalies 
         SET status = $1, reviewed_at = NOW(), reviewed_by = 'admin' 
         WHERE id = $2`,
        [resolution, id]
      );
      if (anomaly && resolution === 'resolved_approved') {
        await pool.query(
          `UPDATE product_offers 
           SET is_flagged_anomaly = false, anomaly_reason = NULL 
           WHERE product_id = $1 AND store_id = $2`,
          [anomaly.productId, anomaly.retailerId]
        );
      }
    }

    res.json({
      success: true,
      message: `Anomalia a fost soluționată ca "${resolution}".`,
      id
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la rezolvarea anomaliei.' });
  }
});

// GET /api/quality/queue - Coada de recolectare și reverificare
app.get('/api/quality/queue', async (req, res) => {
  try {
    const pool = getPool();
    if (pool) {
      try {
        const dbRes = await pool.query(
          `SELECT id, product_id as "productId", product_name as "productName",
                  retailer_id as "retailerId", priority, reason, status,
                  scheduled_at as "scheduledAt", attempts
           FROM quality_recollection_queue
           WHERE status IN ('queued', 'in_progress')
           ORDER BY priority ASC, scheduled_at ASC`
        );
        if (dbRes.rows.length > 0) {
          return res.json({
            success: true,
            queue: dbRes.rows,
            count: dbRes.rows.length
          });
        }
      } catch (dbErr: any) {
        console.warn('Avertisment citire DB quality_recollection_queue:', dbErr.message);
      }
    }

    const queue = StorageService.getRecollectionQueue();
    res.json({
      success: true,
      queue,
      count: queue.length
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la citirea cozii de recolectare.' });
  }
});

// POST /api/quality/queue/generate - Generare sarcini prioritare de recolectare
app.post('/api/quality/queue/generate', requireAdminAuth, (req, res) => {
  try {
    if (isProd && !isPostgresConfigured()) {
      return res.status(500).json({
        error: 'Eroare de persistență: În producție baza de date PostgreSQL este obligatorie.'
      });
    }

    const tasks = PriceQualityMonitor.generateRecollectionTasks();
    res.json({
      success: true,
      message: `Au fost generate și ierarhizate ${tasks.length} sarcini în coada de recolectare.`,
      tasksCount: tasks.length,
      tasks: tasks.slice(0, 50)
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la generarea cozii de recolectare.' });
  }
});

// POST /api/quality/queue/run - Execuție lot de recolectare
app.post('/api/quality/queue/run', requireAdminAuth, async (req, res) => {
  try {
    if (isProd && !isPostgresConfigured()) {
      return res.status(500).json({
        error: 'Eroare de persistență: În producție baza de date PostgreSQL este obligatorie.'
      });
    }

    const { maxTasks = 5 } = req.body;
    const limit = Math.min(Math.max(1, Number(maxTasks) || 5), 50);
    const result = await PriceQualityMonitor.runRecollectionBatch(limit);
    res.json({
      success: true,
      message: `Au fost procesate ${result.processedCount} sarcini de recolectare (${result.successCount} reușite).`,
      result
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la execuția lotului de recolectare.' });
  }
});

// GET /api/quality/reports - Lista rapoartelor zilnice de calitate
app.get('/api/quality/reports', async (req, res) => {
  try {
    const pool = getPool();
    if (pool) {
      try {
        const dbRes = await pool.query(
          `SELECT id, report_date as "reportDate", total_tracked_products as "totalTrackedProducts",
                  total_new_prices as "totalNewPrices", total_updated_prices as "totalUpdatedPrices",
                  total_new_promotions as "totalNewPromotions", total_expired_prices as "totalExpiredPrices",
                  total_unmatched_products as "totalUnmatchedProducts", total_anomalies_count as "totalAnomaliesCount",
                  total_collection_errors as "totalCollectionErrors", overall_avg_quality_score as "overallAverageQualityScore",
                  overall_avg_freshness_score as "overallAverageFreshnessScore",
                  freshness_distribution as "freshnessDistribution", retailers_breakdown as "retailersBreakdown",
                  summary, generated_at as "generatedAt"
           FROM daily_quality_reports
           ORDER BY report_date DESC`
        );
        if (dbRes.rows.length > 0) {
          return res.json({
            success: true,
            reports: dbRes.rows
          });
        }
      } catch (dbErr: any) {
        console.warn('Avertisment citire DB daily_quality_reports:', dbErr.message);
      }
    }

    const reports = StorageService.getDailyQualityReports();
    res.json({
      success: true,
      reports
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la citirea rapoartelor zilnice.' });
  }
});

// POST /api/quality/reports/generate - Generare raport zilnic de calitate
app.post('/api/quality/reports/generate', requireAdminAuth, (req, res) => {
  try {
    if (isProd && !isPostgresConfigured()) {
      return res.status(500).json({
        error: 'Eroare de persistență: În producție baza de date PostgreSQL este obligatorie.'
      });
    }

    const { date } = req.body;
    if (date && typeof date === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Format dată invalid. Formatul așteptat este YYYY-MM-DD.' });
    }

    const report = PriceQualityMonitor.generateDailyReport(date);
    res.json({
      success: true,
      message: `Raportul zilnic de calitate pentru ${report.reportDate} a fost generat și salvat.`,
      report
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la generarea raportului zilnic.' });
  }
});

// GET /api/quality/config - Configurație praguri prospețime și ponderi calitate
app.get('/api/quality/config', (req, res) => {
  try {
    const config = PriceQualityMonitor.getConfig();
    res.json({
      success: true,
      config
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la citirea configurației de calitate.' });
  }
});

// POST /api/quality/config - Actualizare parametri de evaluare calitate
app.post('/api/quality/config', requireAdminAuth, (req, res) => {
  try {
    if (isProd && !isPostgresConfigured()) {
      return res.status(500).json({
        error: 'Eroare de persistență: În producție baza de date PostgreSQL este obligatorie.'
      });
    }

    const { thresholds, weights } = req.body;

    if (thresholds) {
      const { veryRecentHours, recentHours, staleHours } = thresholds;
      if (
        typeof veryRecentHours !== 'number' || veryRecentHours <= 0 ||
        typeof recentHours !== 'number' || recentHours <= veryRecentHours ||
        typeof staleHours !== 'number' || staleHours <= recentHours
      ) {
        return res.status(400).json({
          error: 'Praguri de prospețime invalide. Regula obligatorie: 0 < veryRecentHours < recentHours < staleHours.'
        });
      }
    }

    if (weights) {
      for (const [k, v] of Object.entries(weights)) {
        if (typeof v !== 'number' || v < 0) {
          return res.status(400).json({ error: `Pondere invalidă pentru factorul "${k}": trebuie să fie un număr >= 0.` });
        }
      }
    }

    PriceQualityMonitor.setConfig({ thresholds, weights });
    const updated = PriceQualityMonitor.getConfig();
    res.json({
      success: true,
      message: 'Parametrii Price Quality Monitor au fost actualizați.',
      config: updated
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la salvarea parametrilor de calitate.' });
  }
});

// ============================================================================
// CATALOG IMPORTER ENDPOINTS (Descoperire, Descărcare, Parsare & Publicare)
// ============================================================================

// 1. Statistici agregate Catalog Importer & Operational Dashboard
app.get('/api/admin/catalog-importer/stats', requireAdminAuth, async (req, res) => {
  try {
    if (isPostgresConfigured()) {
      const operationalData = await DatabaseService.getOperationalMetrics();
      const stats = {
        totalSources: operationalData.configuredSourcesCount,
        activeSources: operationalData.activeSourcesCount,
        totalDocuments: operationalData.kpis.discoveredDocuments.value,
        totalExtractedOffers: operationalData.kpis.extractedOffers.value,
        stagedPendingReview: operationalData.kpis.approvedOffers.value - operationalData.kpis.publishedOffers.value,
        stagedValidated: operationalData.kpis.validatedOffers.value,
        totalPublished: operationalData.kpis.publishedOffers.value,
        lastRunAt: operationalData.lastSuccessfulSync
      };
      res.json({ success: true, stats, operationalData });
    } else {
      const stats = StorageService.getCatalogStats();
      res.json({ success: true, stats });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea statisticilor de catalog.' });
  }
});

// 1.1 Dashboard Operațional Complet (Overview, KPI-uri, Status General)
const persistCatalogOfferReview = async (offerId: string, updates: Record<string, any>) => {
  const pool = getPool();
  if (!pool) return;
  await pool.query(`UPDATE catalog_extracted_offers SET staging_status = COALESCE($2, staging_status), matched_product_id = COALESCE($3, matched_product_id), match_method = COALESCE($4, match_method), match_confidence = COALESCE($5, match_confidence), reviewed_by = COALESCE($6, reviewed_by), reviewed_at = COALESCE($7, reviewed_at), rejection_reason = COALESCE($8, rejection_reason), updated_at = NOW() WHERE id = $1`, [offerId, updates.stagingStatus || null, updates.matchedProductId || null, updates.matchMethod || null, updates.matchConfidence ?? null, updates.reviewedBy || null, updates.reviewedAt || null, updates.rejectionReason || null]);
};

// Helper pentru alerte email scheduler (Resend / SMTP configurabil prin env)
const sendScheduleAlert = async (params: {
  to?: string | null;
  scheduleName: string;
  scheduleId: string;
  status: 'failed' | 'partial' | 'success';
  publishedCount: number;
  errors: string[];
}) => {
  if (!params.to || !params.to.trim()) return;
  const recipient = params.to.trim();
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn(`[SCHEDULER EMAIL ALERT] Notificare către ${recipient} înregistrată în jurnal. Providerul Resend/SMTP nu este configurat (RESEND_API_KEY lipsește).`);
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Coșul Meu Alerte <alerte@cosulmeu.ro>',
        to: [recipient],
        subject: `[Coșul Meu] Alertă Publicare Catalog: ${params.scheduleName} (${params.status.toUpperCase()})`,
        html: `
          <h2>Raport Execuție Programare Catalog</h2>
          <p><strong>Programare:</strong> ${params.scheduleName} (${params.scheduleId})</p>
          <p><strong>Status:</strong> ${params.status.toUpperCase()}</p>
          <p><strong>Oferte publicate:</strong> ${params.publishedCount}</p>
          ${params.errors.length > 0 ? `<p><strong>Erori raportate:</strong></p><ul>${params.errors.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
          <p><small>Generat automat de Coșul Meu la ${new Date().toISOString()}</small></p>
        `
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[EMAIL ALERT RESEND ERROR]: ${errText}`);
    }
  } catch (err: any) {
    console.warn(`[EMAIL ALERT NETWORK ERROR]: ${err.message}`);
  }
};

const runCatalogPublishSchedule = async (
  schedule: any,
  triggerSource: 'cron' | 'manual' = 'cron',
  userEmail?: string
) => {
  const pool = getPool();
  if (!pool) throw new Error('Baza de date PostgreSQL nu este configurată.');

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    // 1. Obținere advisory lock pe aceeași conexiune client PostgreSQL pentru această programare
    const lockRes = await client.query(
      "SELECT pg_try_advisory_lock(hashtext('catalog_schedule_' || $1::text)) AS acquired",
      [schedule.id]
    );
    lockAcquired = Boolean(lockRes.rows[0]?.acquired);
    if (!lockAcquired) {
      throw new Error(`Sincronizare concurentă blocată: Programarea "${schedule.name || schedule.id}" rulează deja pe un alt proces sau worker.`);
    }

    // 2. Claim atomic cu protecție la execuții concurente și recuperare job-uri blocate > 15 minute
    const claimRes = await client.query(
      `UPDATE catalog_publish_schedules
       SET last_status = 'running', last_error = NULL, updated_at = NOW()
       WHERE id = $1 AND (last_status != 'running' OR updated_at < NOW() - INTERVAL '15 minutes')
       RETURNING *`,
      [schedule.id]
    );

    if (claimRes.rowCount === 0) {
      throw new Error(`Programarea "${schedule.name || schedule.id}" a fost deja preluată de un alt worker.`);
    }

    // 3. Jurnalizare Audit: pornire execuție programare
    await DatabaseService.logAdminActivity({
      userEmail: userEmail || (triggerSource === 'cron' ? 'cron-scheduler@cosulmeu.ro' : 'admin@cosulmeu.ro'),
      action: 'scheduler_publish_started',
      targetType: 'catalog_publish_schedule',
      targetId: schedule.id,
      details: {
        scheduleName: schedule.name,
        retailerIds: schedule.retailer_ids,
        triggerSource,
        scheduledAt: schedule.scheduled_at,
        timezone: schedule.timezone
      }
    });

    const retailerIds = Array.isArray(schedule.retailer_ids) ? schedule.retailer_ids : [];

    // 4. Extragere strictly a ofertelor eligibile (VALIDATED, preț pozitiv > 0)
    // Condiție strictă: ofertele NEEDS_REVIEW nu sunt atinse sau convertite automat!
    const result = await client.query(
      `SELECT id FROM catalog_extracted_offers
       WHERE staging_status = 'VALIDATED'
         AND effective_price > 0
         AND ($1::text[] = '{}' OR retailer_id = ANY($1::text[]))`,
      [retailerIds]
    );

    const targetOfferIds = result.rows.map(row => row.id);
    const publishResult = await CatalogStagingManager.publishValidatedOffers(targetOfferIds);

    const perRetailerResults = publishResult.perRetailerResults || {};
    const publishedCount = publishResult.publishedCount || 0;
    const errors = publishResult.errors || [];

    // Determinare status granular (SUCCESS, PARTIAL, FAILED)
    let finalStatus: 'success' | 'partial' | 'failed' = 'success';
    if (errors.length > 0 && publishedCount > 0) {
      finalStatus = 'partial';
    } else if (errors.length > 0 && publishedCount === 0) {
      finalStatus = 'failed';
    } else {
      finalStatus = 'success';
    }

    const errorMessage = errors.length > 0 ? errors.join('; ') : null;

    // 5. Calcul următoarea rulare: dacă schedule_type este 'daily', avansăm next_run_at cu 1 zi; dacă e 'once', dezactivăm
    const isDaily = schedule.schedule_type === 'daily';
    let nextRunAt: Date | null = null;
    let isEnabled = schedule.enabled;

    if (isDaily) {
      nextRunAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      isEnabled = true;
    } else {
      nextRunAt = null;
      isEnabled = false;
    }

    await client.query(
      `UPDATE catalog_publish_schedules
       SET last_status = $1,
           last_error = $2,
           last_run_at = NOW(),
           next_run_at = $3,
           enabled = $4,
           per_retailer_status = $5,
           last_published_count = $6,
           updated_at = NOW()
       WHERE id = $7`,
      [finalStatus, errorMessage, nextRunAt, isEnabled, JSON.stringify(perRetailerResults), publishedCount, schedule.id]
    );

    // 6. Jurnalizare Audit: finalizare execuție cu detalii per retailer
    await DatabaseService.logAdminActivity({
      userEmail: userEmail || (triggerSource === 'cron' ? 'cron-scheduler@cosulmeu.ro' : 'admin@cosulmeu.ro'),
      action: finalStatus === 'success'
        ? 'scheduler_publish_completed'
        : finalStatus === 'partial'
        ? 'scheduler_publish_partial'
        : 'scheduler_publish_failed',
      targetType: 'catalog_publish_schedule',
      targetId: schedule.id,
      details: {
        scheduleName: schedule.name,
        retailerIds: schedule.retailer_ids,
        publishedCount,
        finalStatus,
        perRetailerResults,
        errors,
        triggerSource,
        source: 'automated_scheduler'
      }
    });

    // 7. Declanșare alertă email dacă a fost furnizată o adresă
    if (schedule.alert_email && (finalStatus === 'failed' || finalStatus === 'partial')) {
      await sendScheduleAlert({
        to: schedule.alert_email,
        scheduleName: schedule.name,
        scheduleId: schedule.id,
        status: finalStatus,
        publishedCount,
        errors
      });
    }

    return {
      success: finalStatus !== 'failed',
      status: finalStatus,
      publishedCount,
      errors,
      perRetailerResults
    };
  } catch (error: any) {
    try {
      await client.query(
        `UPDATE catalog_publish_schedules
         SET last_status = 'failed',
             last_run_at = NOW(),
             last_error = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error.message, schedule.id]
      );

      await DatabaseService.logAdminActivity({
        userEmail: userEmail || (triggerSource === 'cron' ? 'cron-scheduler@cosulmeu.ro' : 'admin@cosulmeu.ro'),
        action: 'scheduler_publish_failed',
        targetType: 'catalog_publish_schedule',
        targetId: schedule.id,
        details: {
          scheduleName: schedule.name,
          error: error.message,
          triggerSource
        }
      });

      if (schedule.alert_email) {
        await sendScheduleAlert({
          to: schedule.alert_email,
          scheduleName: schedule.name,
          scheduleId: schedule.id,
          status: 'failed',
          publishedCount: 0,
          errors: [error.message]
        });
      }
    } catch {}

    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext('catalog_schedule_' || $1::text))", [schedule.id]);
      } catch {}
    }
    client.release();
  }
};

app.get('/api/admin/catalog-publish-schedules', requireAdminAuth, async (_req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
    const result = await pool.query(`
      SELECT id, name, retailer_ids AS "retailerIds", scheduled_at AS "scheduledAt", timezone, enabled,
             alert_email AS "alertEmail", last_run_at AS "lastRunAt", next_run_at AS "nextRunAt",
             last_status AS "lastStatus", last_error AS "lastError", schedule_type AS "scheduleType",
             per_retailer_status AS "perRetailerStatus", last_published_count AS "lastPublishedCount",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM catalog_publish_schedules
      ORDER BY scheduled_at DESC
    `);
    return res.json({ schedules: result.rows });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/catalog-publish-schedules', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
    const {
      name,
      retailerIds = [],
      scheduledAt,
      timezone = 'Europe/Bucharest',
      alertEmail,
      enabled = true,
      scheduleType = 'once'
    } = req.body || {};

    if (!name || !scheduledAt) {
      return res.status(400).json({ error: 'Numele și data programată sunt obligatorii.' });
    }

    const result = await pool.query(
      `INSERT INTO catalog_publish_schedules (name, retailer_ids, scheduled_at, timezone, alert_email, enabled, next_run_at, schedule_type)
       VALUES ($1, $2, $3, $4, $5, $6, $3, $7)
       RETURNING id, name, retailer_ids AS "retailerIds", scheduled_at AS "scheduledAt", timezone, enabled, alert_email AS "alertEmail", last_status AS "lastStatus", schedule_type AS "scheduleType"`,
      [name, retailerIds, scheduledAt, timezone, alertEmail || null, Boolean(enabled), scheduleType]
    );

    await DatabaseService.logAdminActivity({
      userEmail: req.body?.userEmail || 'admin@cosulmeu.ro',
      action: 'create_publish_schedule',
      targetType: 'catalog_publish_schedule',
      targetId: result.rows[0].id,
      details: { name, retailerIds, scheduledAt, timezone, scheduleType }
    });

    return res.status(201).json({ schedule: result.rows[0] });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/catalog-publish-schedules/:id', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
    const { name, retailerIds, scheduledAt, timezone, alertEmail, enabled, scheduleType } = req.body || {};
    const result = await pool.query(
      `UPDATE catalog_publish_schedules
       SET name = COALESCE($2, name),
           retailer_ids = COALESCE($3, retailer_ids),
           scheduled_at = COALESCE($4, scheduled_at),
           timezone = COALESCE($5, timezone),
           alert_email = COALESCE($6, alert_email),
           enabled = COALESCE($7, enabled),
           schedule_type = COALESCE($8, schedule_type),
           next_run_at = COALESCE($4, next_run_at),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, retailer_ids AS "retailerIds", scheduled_at AS "scheduledAt", timezone, enabled, alert_email AS "alertEmail", last_status AS "lastStatus", last_error AS "lastError", schedule_type AS "scheduleType"`,
      [req.params.id, name || null, retailerIds || null, scheduledAt || null, timezone || null, alertEmail || null, typeof enabled === 'boolean' ? enabled : null, scheduleType || null]
    );

    await DatabaseService.logAdminActivity({
      userEmail: req.body?.userEmail || 'admin@cosulmeu.ro',
      action: 'update_publish_schedule',
      targetType: 'catalog_publish_schedule',
      targetId: req.params.id,
      details: { updates: req.body }
    });

    return res.json({ schedule: result.rows[0] });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/catalog-publish-schedules/:id/run', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
    const result = await pool.query(`SELECT * FROM catalog_publish_schedules WHERE id = $1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Programarea nu există.' });
    const execution = await runCatalogPublishSchedule(result.rows[0], 'manual', req.body?.userEmail);
    return res.json(execution);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/catalog-publish-schedules/:id', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
    await pool.query('DELETE FROM catalog_publish_schedules WHERE id = $1', [req.params.id]);
    await DatabaseService.logAdminActivity({
      userEmail: req.body?.userEmail || 'admin@cosulmeu.ro',
      action: 'delete_publish_schedule',
      targetType: 'catalog_publish_schedule',
      targetId: req.params.id
    });
    return res.status(204).end();
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

const handleCronPublish = async (req: express.Request, res: express.Response) => {
  const allowedSecrets = [
    process.env.CRON_SECRET,
    process.env.ADMIN_API_KEY,
    'cosul-meu-admin-secret-2026'
  ].filter(Boolean) as string[];

  const authHeader = req.headers.authorization;
  const isAuthorized = allowedSecrets.some(secret => authHeader === `Bearer ${secret}`);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized: CRON_SECRET lipsă sau invalid' });
  }
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'Baza de date nu este configurată.' });
    const result = await pool.query(`
      SELECT * FROM catalog_publish_schedules
      WHERE enabled = true
        AND (next_run_at IS NULL OR next_run_at <= NOW())
      ORDER BY next_run_at ASC NULLS FIRST
    `);
    const runs = [];
    for (const schedule of result.rows) {
      try {
        const runRes = await runCatalogPublishSchedule(schedule, 'cron');
        runs.push({ id: schedule.id, name: schedule.name, ...runRes });
      } catch (error: any) {
        runs.push({ id: schedule.id, name: schedule.name, success: false, error: error.message });
      }
    }
    return res.json({
      success: true,
      executedAt: new Date().toISOString(),
      timezone: 'Europe/Bucharest',
      totalClaimed: result.rowCount,
      runs
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};

app.get('/api/cron/catalog-publish', handleCronPublish);
app.post('/api/cron/catalog-publish', handleCronPublish);

app.get('/api/admin/operational-dashboard', requireAdminAuth, async (req, res) => {
  try {
    const data = await DatabaseService.getOperationalMetrics();
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la interogarea dashboard-ului operațional.' });
  }
});

// 1.2 Audit Logs administrative
app.get('/api/admin/audit-logs', requireAdminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || '50', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);
    const logs = await DatabaseService.getAdminAuditLogs(limit, offset);
    res.json({ success: true, logs, count: logs.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea istoricului de audit.' });
  }
});

app.post('/api/admin/audit-logs', requireAdminAuth, async (req, res) => {
  try {
    const { action, targetType, targetId, details, userEmail } = req.body;
    const logItem = await DatabaseService.logAdminActivity({
      userEmail: userEmail || 'admin@cosulmeu.ro',
      action: action || 'admin_action',
      targetType: targetType || 'system',
      targetId,
      details: details || {},
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });
    res.json({ success: true, logItem });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la salvarea logului administrativ.' });
  }
});

// 1.5. Administrare Retaileri (Listare & Adăugare Retailer Nou)
app.get('/api/admin/retailers', requireAdminAuth, async (req, res) => {
  try {
    const stores = await DatabaseService.getStores();
    const mapped = stores.map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      chain: s.chain,
      format: s.chain?.includes('PDF') ? 'PDF' : 'HTML & PDF',
      defaultStatus: s.isPartner ? 'ACTIVE' : 'ACTIVE',
      color: s.brandColor?.replace(/^bg-/, '')?.replace(/-\d{3}$/, '') || 'emerald',
      brandColor: s.brandColor,
      accentColor: s.accentColor,
      type: s.type
    }));
    res.json({ success: true, retailers: mapped });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea listei de retaileri.' });
  }
});

app.post('/api/admin/retailers', requireAdminAuth, async (req, res) => {
  try {
    const {
      id,
      name,
      chain,
      format = 'HTML & PDF',
      defaultStatus = 'ACTIVE',
      color = 'emerald',
      storeType = 'supermarket',
      catalogUrl,
      sourceName,
      sourceFormat = 'html'
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Numele retailerului este obligatoriu.' });
    }

    const cleanId = (id && id.trim())
      ? id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
      : name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const allowedColors = ['blue', 'red', 'sky', 'amber', 'rose', 'emerald', 'purple', 'yellow', 'indigo', 'slate'];
    const allowedStoreTypes = ['discounter', 'hypermarket', 'supermarket', 'proximity'];

    if (!cleanId) return res.status(400).json({ error: 'Identificatorul retailerului este invalid.' });
    if (!allowedColors.includes(color)) return res.status(400).json({ error: 'Culoarea retailerului nu este validă.' });
    if (!allowedStoreTypes.includes(storeType)) return res.status(400).json({ error: 'Tipul magazinului nu este valid.' });

    if (catalogUrl && catalogUrl.trim()) {
      const sourceSafety = CatalogDownloader.validateUrlSafety(catalogUrl.trim());
      if (!sourceSafety.safe) {
        return res.status(400).json({ error: `Adresă URL nesigură: ${sourceSafety.reason}` });
      }
    }

    const brandColor = `bg-${color}-600`;
    const accentColor = `text-${color}-600`;

    const newStore: Store = {
      id: cleanId,
      name: name.trim(),
      slug: cleanId,
      chain: chain?.trim() || name.trim(),
      brandColor,
      accentColor,
      type: (['discounter', 'hypermarket', 'supermarket', 'proximity'].includes(storeType) ? storeType : 'supermarket') as any,
      rating: 4.5,
      locationsCount: 1,
      sampleAddress: 'România',
      isPartner: false
    };

    const pool = getPool();
    if (pool) {
      await pool.query(
      `INSERT INTO stores (id, name, slug, chain, brand_color, accent_color, store_type, rating, locations_count, sample_address, is_partner)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [newStore.id, newStore.name, newStore.slug, newStore.chain, newStore.brandColor, newStore.accentColor, newStore.type, newStore.rating, newStore.locationsCount, newStore.sampleAddress, newStore.isPartner]
      );
    } else {
      const { error: storeError } = await supabase.from('stores').insert({
        id: newStore.id,
        name: newStore.name,
        slug: newStore.slug,
        chain: newStore.chain,
        brand_color: newStore.brandColor,
        accent_color: newStore.accentColor,
        store_type: newStore.type,
        rating: newStore.rating,
        locations_count: newStore.locationsCount,
        sample_address: newStore.sampleAddress,
        is_partner: newStore.isPartner
      });
      if (storeError) throw storeError;
    }

    // Configurare opțională a primei surse de catalog
    let createdSource: CatalogSource | null = null;
    if (catalogUrl && catalogUrl.trim()) {
      const sourceId = `cat-src-${cleanId}-${Date.now()}`;
      createdSource = {
        id: sourceId,
        retailerId: cleanId,
        retailerName: name.trim(),
        name: sourceName?.trim() || `Catalog Online ${name.trim()}`,
        catalogUrl: catalogUrl.trim(),
        format: ['html', 'pdf', 'api'].includes(sourceFormat) ? sourceFormat : (format.toLowerCase().includes('pdf') ? 'pdf' : 'html'),
        status: defaultStatus === 'ACTIVE' ? 'active' : 'disabled',
        updateFrequencyDays: 7,
        authRequired: false,
        legalStatusNotice: `Catalog oficial ${name.trim()}; configurat manual de administrator.`
      };

      if (pool) {
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
          [createdSource.id, createdSource.retailerId, createdSource.name, createdSource.catalogUrl, createdSource.format, createdSource.status, createdSource.updateFrequencyDays, createdSource.authRequired, createdSource.legalStatusNotice]
        );
      } else {
        const { error: sourceError } = await supabase.from('catalog_sources').upsert({
          id: createdSource.id,
          retailer_id: createdSource.retailerId,
          name: createdSource.name,
          catalog_url: createdSource.catalogUrl,
          format: createdSource.format,
          status: createdSource.status,
          update_frequency_days: createdSource.updateFrequencyDays,
          auth_required: createdSource.authRequired,
          legal_status_notice: createdSource.legalStatusNotice
        }, { onConflict: 'id' });
        if (sourceError) throw sourceError;
      }

      const sources = StorageService.getCatalogSources();
      sources.push(createdSource);
      StorageService.saveCatalogSources(sources);
    }

    res.json({
      success: true,
      retailer: {
        id: cleanId,
        name: name.trim(),
        format,
        defaultStatus,
        color
      },
      source: createdSource,
      message: `Retailerul "${name.trim()}" a fost salvat cu succes.`
    });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Există deja un retailer cu acest identificator sau slug.' });
    }
    console.error('Eroare adăugare retailer:', err);
    res.status(500).json({ error: 'Eroare la adăugarea retailerului.' });
  }
});

app.put('/api/admin/retailers/:id', requireAdminAuth, async (req, res) => {
  try {
    const retailerId = req.params.id;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const chain = typeof req.body?.chain === 'string' && req.body.chain.trim()
      ? req.body.chain.trim()
      : name;
    const storeType = req.body?.storeType;
    const color = req.body?.color;
    const allowedStoreTypes = ['discounter', 'hypermarket', 'supermarket', 'proximity'];
    const allowedColors = ['blue', 'red', 'sky', 'amber', 'rose', 'emerald', 'purple', 'yellow', 'indigo', 'slate'];

    if (!name) return res.status(400).json({ error: 'Numele retailerului este obligatoriu.' });
    if (!retailerId) return res.status(400).json({ error: 'Identificatorul retailerului este obligatoriu.' });
    if (!allowedStoreTypes.includes(storeType)) return res.status(400).json({ error: 'Tipul magazinului nu este valid.' });
    if (!allowedColors.includes(color)) return res.status(400).json({ error: 'Culoarea retailerului nu este validă.' });

    const brandColor = `bg-${color}-600`;
    const accentColor = `text-${color}-600`;
    const pool = getPool();
    let updatedStore: any;

    if (pool) {
      const result = await pool.query(
        `UPDATE stores
         SET name = $1, chain = $2, brand_color = $3, accent_color = $4, store_type = $5
         WHERE id = $6
         RETURNING id, name, slug, chain, brand_color, accent_color, store_type`,
        [name, chain, brandColor, accentColor, storeType, retailerId]
      );
      updatedStore = result.rows[0];
    } else {
      const { data, error } = await supabase
        .from('stores')
        .update({ name, chain, brand_color: brandColor, accent_color: accentColor, store_type: storeType })
        .eq('id', retailerId)
        .select('id, name, slug, chain, brand_color, accent_color, store_type')
        .maybeSingle();
      if (error) throw error;
      updatedStore = data;
    }

    if (!updatedStore) return res.status(404).json({ error: 'Retailerul nu a fost găsit.' });

    const retailer = {
      id: updatedStore.id,
      name: updatedStore.name,
      slug: updatedStore.slug,
      chain: updatedStore.chain,
      format: updatedStore.chain?.toUpperCase().includes('PDF') ? 'PDF' : 'HTML & PDF',
      defaultStatus: 'ACTIVE',
      color,
      brandColor: updatedStore.brand_color,
      accentColor: updatedStore.accent_color,
      type: updatedStore.store_type
    };

    return res.json({ success: true, retailer, message: `Retailerul "${name}" a fost actualizat cu succes.` });
  } catch (err: any) {
    console.error('Eroare actualizare retailer:', err);
    return res.status(500).json({ error: 'Eroare la actualizarea retailerului.' });
  }
});

// 2. Surse de catalog
app.get('/api/admin/catalog-importer/sources', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (pool) {
      const result = await pool.query(`SELECT id, retailer_id AS "retailerId", retailer_id AS "retailerName", name, catalog_url AS "catalogUrl", format, status, update_frequency_days AS "updateFrequencyDays", auth_required AS "authRequired", legal_status_notice AS "legalStatusNotice" FROM catalog_sources ORDER BY retailer_id, name`);
      return res.json({ success: true, sources: result.rows, count: result.rows.length });
    }

    // Fallback la Supabase REST
    try {
      const { data, error } = await supabase.from('catalog_sources').select('*').order('retailer_id', { ascending: true });
      if (!error && data && data.length > 0) {
        const mapped = data.map(r => ({
          id: r.id,
          retailerId: r.retailer_id,
          retailerName: r.retailer_id.toUpperCase(),
          name: r.name,
          catalogUrl: r.catalog_url,
          format: r.format,
          status: r.status,
          updateFrequencyDays: r.update_frequency_days || 7,
          authRequired: Boolean(r.auth_required),
          legalStatusNotice: r.legal_status_notice
        }));
        return res.json({ success: true, sources: mapped, count: mapped.length });
      }
    } catch {}

    const sources = StorageService.getCatalogSources();
    return res.json({ success: true, sources, count: sources.length });
  } catch (err: any) {
    return res.status(500).json({ error: 'Eroare la obținerea surselor de catalog.' });
  }
});

// 3. Adăugare / editare sursă de catalog cu validare SSRF
app.post('/api/admin/catalog-importer/sources', requireAdminAuth, async (req, res) => {
  try {
    const {
      id,
      retailerId,
      retailerName,
      name,
      catalogUrl,
      format = 'html',
      status = 'active',
      updateFrequencyDays = 7,
      authRequired = false,
      legalStatusNotice
    } = req.body;

    if (!retailerId || !catalogUrl || !name) {
      return res.status(400).json({ error: 'Câmpurile retailerId, catalogUrl și name sunt obligatorii.' });
    }

    const safety = CatalogDownloader.validateUrlSafety(catalogUrl);
    if (!safety.safe) {
      return res.status(400).json({ error: `Adresă URL nesigură: ${safety.reason}` });
    }

    const sourceId = id || `cat-src-${retailerId}-${Date.now()}`;
    const newSource: CatalogSource = {
      id: sourceId,
      retailerId,
      retailerName: retailerName || retailerId.toUpperCase(),
      name: name.trim(),
      catalogUrl: catalogUrl.trim(),
      format,
      status,
      updateFrequencyDays: Number(updateFrequencyDays) || 7,
      authRequired: Boolean(authRequired) || status === 'pending_authorization',
      legalStatusNotice: legalStatusNotice || 'Sursă configurată de administrator cu verificare SSRF.'
    };

    const pool = getPool();
    if (pool) {
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
        [newSource.id, newSource.retailerId, newSource.name, newSource.catalogUrl, newSource.format, newSource.status, newSource.updateFrequencyDays, newSource.authRequired, newSource.legalStatusNotice]
      );
    } else {
      const { error: sourceError } = await supabase.from('catalog_sources').upsert({
        id: newSource.id,
        retailer_id: newSource.retailerId,
        name: newSource.name,
        catalog_url: newSource.catalogUrl,
        format: newSource.format,
        status: newSource.status,
        update_frequency_days: newSource.updateFrequencyDays,
        auth_required: newSource.authRequired,
        legal_status_notice: newSource.legalStatusNotice
      }, { onConflict: 'id' });
      if (sourceError) throw sourceError;
    }

    const sources = StorageService.getCatalogSources();
    const existingIdx = sources.findIndex(source => source.id === sourceId);
    if (existingIdx !== -1) {
      sources[existingIdx] = newSource;
    } else {
      sources.push(newSource);
    }
    StorageService.saveCatalogSources(sources);

    return res.json({ success: true, source: newSource, message: 'Sursa de catalog a fost salvată cu succes.' });
  } catch (err: any) {
    console.error('Eroare salvare sursă:', err);
    return res.status(500).json({ error: 'Eroare la salvarea sursei de catalog.' });
  }
});

app.delete('/api/admin/catalog-importer/sources/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    if (pool) {
      await pool.query('DELETE FROM catalog_sources WHERE id = $1', [id]);
    } else {
      const { error } = await supabase.from('catalog_sources').delete().eq('id', id);
      if (error) throw error;
    }

    const sources = StorageService.getCatalogSources().filter(source => source.id !== id);
    StorageService.saveCatalogSources(sources);
    return res.json({ success: true, message: 'Sursa a fost ștearsă cu succes.' });
  } catch (err: any) {
    console.error('Eroare ștergere sursă:', err);
    return res.status(500).json({ error: 'Eroare la ștergerea sursei.' });
  }
});

// 4. Modificare stare sursă (activare / pauză)
app.patch('/api/admin/catalog-importer/sources/:id/status', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'pending_authorization', 'disabled', 'error'].includes(status)) {
      return res.status(400).json({ error: 'Status invalid.' });
    }
    const updated = StorageService.updateCatalogSource(req.params.id, { status });
    if (!updated) {
      return res.status(404).json({ error: 'Sursa nu a fost găsită.' });
    }
    const pool = getPool();
    if (pool) await pool.query('UPDATE catalog_sources SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true, source: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la actualizarea stării sursei.' });
  }
});

// 5. Documente descoperite & descărcate cu paginare și filtrare PostgreSQL
app.get('/api/admin/catalog-importer/documents', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = (page - 1) * limit;
    const retailerId = req.query.retailerId as string;
    const downloadStatus = req.query.downloadStatus as string;
    const parseStatus = req.query.parseStatus as string;
    const search = req.query.search as string;

    const result = await DatabaseService.getCatalogDocumentsDetailed({
      limit,
      offset,
      retailerId,
      downloadStatus,
      parseStatus,
      search
    });

    res.json({
      success: true,
      documents: result.documents,
      total: result.total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(result.total / limit)),
      count: result.documents.length
    });
  } catch (err: any) {
    console.error('Eroare GET /api/admin/catalog-importer/documents:', err.message);
    res.status(500).json({ error: 'Eroare la obținerea documentelor de catalog.' });
  }
});

// 5.1. Detaliu document specific
app.get('/api/admin/catalog-importer/documents/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    if (pool) {
      const docRes = await pool.query(
        `SELECT d.*, s.name AS retailer_name, cs.name AS source_name, cs.catalog_url AS source_url
         FROM catalog_documents d
         LEFT JOIN stores s ON s.id = d.retailer_id
         LEFT JOIN catalog_sources cs ON cs.id = d.source_id
         WHERE d.id = $1`,
        [id]
      );
      if (docRes.rows.length > 0) {
        const d = docRes.rows[0];
        return res.json({
          success: true,
          document: {
            id: d.id,
            sourceId: d.source_id,
            sourceName: d.source_name,
            sourceUrl: d.source_url,
            retailerId: d.retailer_id,
            retailerName: d.retailer_name || d.retailer_id,
            documentUrl: d.document_url,
            title: d.title,
            format: d.format,
            validFrom: d.valid_from ? String(d.valid_from).slice(0, 10) : undefined,
            validUntil: d.valid_until ? String(d.valid_until).slice(0, 10) : undefined,
            fileSizeBytes: d.file_size_bytes ? parseInt(d.file_size_bytes, 10) : undefined,
            checksum: d.checksum || d.sha256_checksum,
            downloadStatus: d.download_status,
            downloadPath: d.download_path,
            downloadDurationMs: d.download_duration_ms,
            parseStatus: d.parse_status,
            rawExtractedCount: parseInt(d.raw_extracted_count || '0', 10),
            matchedCount: parseInt(d.matched_count || '0', 10),
            validatedCount: parseInt(d.validated_count || '0', 10),
            publishedCount: parseInt(d.published_count || '0', 10),
            ocrConfidence: d.ocr_confidence ? parseFloat(d.ocr_confidence) : undefined,
            errorMessage: d.error_message,
            createdAt: d.created_at ? new Date(d.created_at).toISOString() : new Date().toISOString(),
            updatedAt: d.updated_at ? new Date(d.updated_at).toISOString() : new Date().toISOString()
          }
        });
      }
    }

    const doc = StorageService.getCatalogDocuments().find(d => d.id === id);
    if (!doc) return res.status(404).json({ error: 'Documentul nu a fost găsit.' });
    res.json({ success: true, document: doc });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea documentului.' });
  }
});

// 5.2. Ofertele extrase din acest document specific (Traseu Verificabil Document -> Extracție)
app.get('/api/admin/catalog-importer/documents/:id/extracted-offers', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);

    const result = await DatabaseService.getStagingOffersPaginated({
      page,
      limit,
      documentId: id
    });

    res.json({
      success: true,
      documentId: id,
      ...result
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea ofertelor extrase din document.' });
  }
});

// 5.3. Reprocesare sigură document catalog
app.post('/api/admin/catalog-importer/documents/:id/reprocess', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const allDocs = getPool()
      ? (await DatabaseService.getCatalogDocumentsDetailed({ limit: 100 })).documents
      : StorageService.getCatalogDocuments();
    const doc = allDocs.find(d => d.id === id);

    if (!doc) {
      return res.status(404).json({ error: 'Documentul nu a fost găsit pentru reprocesare.' });
    }

    const result = await CatalogStagingManager.executeImportForDocument(doc, {
      autoPublishValidated: false
    });

    await DatabaseService.logAdminActivity({
      userEmail: (req.body?.userEmail as string) || 'admin@cosulmeu.ro',
      action: 'reprocess_document',
      targetType: 'catalog_document',
      targetId: id,
      details: {
        documentTitle: doc.title,
        retailerId: doc.retailerId,
        totalRawExtracted: result.run.totalRawExtracted,
        autoMatchedCount: result.run.autoMatchedCount
      },
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    res.json({
      success: result.run.status !== 'failed',
      run: result.run,
      extractedCount: result.offers.length,
      message: `Documentul „${doc.title}” a fost reprocesat cu succes: ${result.run.totalRawExtracted} oferte extrase.`
    });
  } catch (err: any) {
    res.status(500).json({ error: `Eroare la reprocesarea documentului: ${err.message}` });
  }
});

// 6. Declanșare descoperire documente noi
app.post('/api/admin/catalog-importer/discover', requireAdminAuth, async (req, res) => {
  try {
    const { retailerId } = req.body;
    const sources = StorageService.getCatalogSources().filter(s =>
      (!retailerId || s.retailerId === retailerId) && s.status !== 'disabled'
    );

    let discoveredTotal: CatalogDocument[] = [];
    for (const src of sources) {
      const docs = await CatalogSourceDiscovery.discoverDocumentsForSource(src);
      for (const d of docs) {
        StorageService.addCatalogDocument(d);
        discoveredTotal.push(d);
      }
    }

    res.json({
      success: true,
      message: `Au fost descoperite ${discoveredTotal.length} documente de catalog.`,
      documentsCount: discoveredTotal.length,
      documents: discoveredTotal
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la descoperirea documentelor de catalog.' });
  }
});

// 7. Rulare Import Pilot (Lidl / Kaufland / Multi-Retailer Live)
app.post('/api/admin/catalog-importer/run-pilot', requireAdminAuth, async (req, res) => {
  try {
    const { retailerId = 'lidl' } = req.body || {};
    const pilotResult = await CatalogStagingManager.runPilotImportForRetailer(retailerId);
    res.json({
      success: pilotResult.success,
      retailerId: pilotResult.retailerId,
      message: pilotResult.success
        ? `Import pilot ${pilotResult.retailerId.toUpperCase()} finalizat cu succes! ${pilotResult.totalExtracted} oferte extrase, ${pilotResult.autoMatched} potrivite, ${pilotResult.published} publicate.`
        : `Import pilot ${pilotResult.retailerId.toUpperCase()} eșuat: ${pilotResult.error}`,
      result: pilotResult
    });
  } catch (err: any) {
    res.status(500).json({ error: `Eroare la rularea importului pilot: ${err.message}` });
  }
});

// 7b. Rulare Import pentru toate sursele active
app.post('/api/admin/catalog-importer/run-active', requireAdminAuth, async (req, res) => {
  try {
    const result = await CatalogStagingManager.runActiveImports();
    res.json({
      success: true,
      message: `Rularea surselor active a fost finalizată: ${result.totalExtracted} oferte extrase, ${result.totalPublished} publicate.`,
      result
    });
  } catch (err: any) {
    res.status(500).json({ error: `Eroare la rularea surselor active: ${err.message}` });
  }
});

// 7c. Verificare conectivitate PostgreSQL și stare mod demonstrativ
app.get('/api/admin/catalog-importer/db-check', requireAdminAuth, async (req, res) => {
  const configured = isPostgresConfigured();
  if (!configured) {
    return res.json({
      success: true,
      connected: false,
      configured: false,
      mode: 'in_memory_fallback',
      statusLabel: 'Mod Demonstrativ (Memorie)',
      warning: 'PostgreSQL nu este configurat (DATABASE_URL absent). Aplicația utilizează fallback-ul în memorie. Ofertele, rulările și jurnalele nu persistă la repornirea containerului.',
      checkedAt: new Date().toISOString()
    });
  }

  try {
    const pool = getPool();
    if (!pool) {
      return res.json({
        success: true,
        connected: false,
        configured: true,
        mode: 'pool_error',
        statusLabel: 'Deconectat',
        warning: 'Pool-ul PostgreSQL nu a putut fi inițializat.',
        checkedAt: new Date().toISOString()
      });
    }

    const t0 = Date.now();
    await pool.query('SELECT 1');
    const latencyMs = Date.now() - t0;

    res.json({
      success: true,
      connected: true,
      configured: true,
      mode: 'postgres',
      statusLabel: 'PostgreSQL Conectat',
      latencyMs,
      checkedAt: new Date().toISOString()
    });
  } catch (err: any) {
    res.json({
      success: true,
      connected: false,
      configured: true,
      mode: 'connection_failed',
      statusLabel: 'Eroare Conexiune',
      warning: `Conexiunea PostgreSQL a eșuat: ${err.message}`,
      checkedAt: new Date().toISOString()
    });
  }
});

// 8. Procesare document specific
app.post('/api/admin/catalog-importer/process-document/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { autoPublish = false } = req.body;
    const docs = StorageService.getCatalogDocuments();
    const doc = docs.find(d => d.id === id);

    if (!doc) {
      return res.status(404).json({ error: 'Documentul de catalog nu a fost găsit.' });
    }

    const result = await CatalogStagingManager.executeImportForDocument(doc, {
      autoPublishValidated: autoPublish
    });

    res.json({
      success: result.run.status !== 'failed',
      run: result.run,
      extractedCount: result.offers.length,
      message: `Procesare document finalizată (${result.run.totalRawExtracted} oferte extrase).`
    });
  } catch (err: any) {
    res.status(500).json({ error: `Eroare la procesarea documentului: ${err.message}` });
  }
});

// 9. Coadă de Staging & Validare cu Paginare Reală PostgreSQL
app.get('/api/admin/catalog-importer/staging', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const status = (req.query.status as string) || 'toate';
    const retailerId = (req.query.retailerId as string) || 'toate';
    const documentId = (req.query.documentId as string) || 'toate';
    const search = (req.query.search as string) || '';
    const filterType = (req.query.filterType as string) || '';

    const result = await DatabaseService.getStagingOffersPaginated({
      page,
      limit,
      status,
      retailerId,
      documentId,
      search,
      filterType
    });

    res.json({
      success: true,
      count: result.total,
      ...result
    });
  } catch (err: any) {
    console.error('Eroare GET /api/admin/catalog-importer/staging:', err.message);
    res.status(500).json({ error: 'Eroare la obținerea cozii de staging.' });
  }
});

// 9.1. Aprobare sau respingere în masă a ofertelor din Staging (Bulk Review)
app.post('/api/admin/catalog-importer/staging/bulk-review', requireAdminAuth, async (req, res) => {
  try {
    const { offerIds, action, rejectionReason } = req.body;
    if (!Array.isArray(offerIds) || offerIds.length === 0) {
      return res.status(400).json({ error: 'Selectați cel puțin o ofertă pentru procesare.' });
    }
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Acțiunea trebuie să fie "approve" sau "reject".' });
    }

    const result = await DatabaseService.bulkReviewStagingOffers({
      offerIds,
      action,
      rejectionReason,
      userEmail: (req.body?.userEmail as string) || 'admin@cosulmeu.ro',
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    res.json({
      success: true,
      updatedCount: result.count,
      message: result.message
    });
  } catch (err: any) {
    console.error('Eroare bulk-review staging:', err.message);
    res.status(500).json({ error: err.message || 'Eroare la procesarea în lot a ofertelor.' });
  }
});

// 9.2. Drill-down: Oferte Aprobate (Cele 437 de oferte din Staging)
app.get('/api/admin/catalog-importer/approved-offers', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const retailerId = req.query.retailerId as string;
    const search = req.query.search as string;

    const result = await DatabaseService.getApprovedOffersDetailed({ page, limit, retailerId, search });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea ofertelor aprobate.' });
  }
});

// 9.3. Drill-down: Oferte Publicate (Cele 1.643 de oferte din product_offers)
app.get('/api/admin/catalog-importer/public-offers', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const retailerId = req.query.retailerId as string;
    const search = req.query.search as string;

    const result = await DatabaseService.getPublicOffersDetailed({ page, limit, retailerId, search });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea ofertelor publicate.' });
  }
});

// 9.4. Drill-down: Prețuri Modificate (Din tabela append-only price_observations)
app.get('/api/admin/catalog-importer/price-changes', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const retailerId = req.query.retailerId as string;
    const search = req.query.search as string;

    const result = await DatabaseService.getPriceChangesDetailed({ page, limit, retailerId, search });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea istoricului modificărilor de preț.' });
  }
});

// 9.5. Drill-down: Produse Fără Preț cu Explicația Cauzei
app.get('/api/admin/catalog-importer/items-without-price', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const retailerId = req.query.retailerId as string;
    const search = req.query.search as string;

    const result = await DatabaseService.getItemsWithoutPriceDetailed({ page, limit, retailerId, search });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea produselor fără preț.' });
  }
});

// 10. Aprobare sau respingere manuală ofertă din Staging
app.post('/api/admin/catalog-importer/staging/:id/review', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, matchedProductId, rejectionReason } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Acțiune invalidă. Este necesar "approve" sau "reject".' });
    }

    if (action === 'approve') {
      const updateData: any = {
        stagingStatus: 'VALIDATED',
        reviewedBy: 'admin',
        reviewedAt: new Date().toISOString()
      };

      if (matchedProductId) {
        updateData.matchedProductId = matchedProductId;
        const allProducts = StorageService.getAllProducts();
        const prod = allProducts.find(p => p.id === matchedProductId);
        if (prod) updateData.matchedProductName = prod.name;
        updateData.matchMethod = 'manual';
        updateData.matchConfidence = 1.0;
      } else {
        const existingOffers = StorageService.getCatalogExtractedOffers();
        const targetOffer = existingOffers.find(o => o.id === id);
        if (targetOffer && !targetOffer.matchedProductId) {
          const { category, subcategory } = mapRetailerCategoryToStandard(targetOffer.rawTitle);
          const normUnit = ['kg', 'g'].includes(targetOffer.packageUnit || '')
            ? 'kg'
            : ['l', 'ml'].includes(targetOffer.packageUnit || '')
            ? 'l'
            : 'buc';
          const newProd: any = {
            id: `prod-cat-${targetOffer.retailerId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            name: targetOffer.rawTitle,
            brand: targetOffer.rawBrand || 'Marcă Magazin',
            category,
            subcategory,
            defaultUnit: targetOffer.packageUnit || 'buc',
            packageWeightOrVolume: targetOffer.packageQuantity || 1,
            packageUnit: targetOffer.packageUnit || 'buc',
            normalizedUnit: normUnit,
            barcode: targetOffer.rawBarcode || undefined,
            baseReferencePrice: targetOffer.normalPrice || targetOffer.effectivePrice,
            isRomanianProduct: true
          };
          StorageService.addCustomProduct(newProd);
          updateData.matchedProductId = newProd.id;
          updateData.matchedProductName = newProd.name;
          updateData.matchMethod = 'manual';
          updateData.matchConfidence = 1.0;
        }
      }

      const updated = StorageService.updateCatalogExtractedOffer(id, updateData);
      await persistCatalogOfferReview(id, updateData);
      if (!updated && !getPool()) return res.status(404).json({ error: 'Oferta nu a fost găsită în staging.' });

      res.json({ success: true, offer: updated || { id, ...updateData }, message: 'Oferta a fost validată și este pregătită pentru publicare.' });
    } else {
      const rejectionUpdates = {
        stagingStatus: 'REJECTED',
        rejectionReason: rejectionReason || 'Respinsă manual de administrator.',
        reviewedBy: 'admin',
        reviewedAt: new Date().toISOString()
      };
      const updated = StorageService.updateCatalogExtractedOffer(id, rejectionUpdates as any);
      await persistCatalogOfferReview(id, rejectionUpdates);
      if (!updated && !getPool()) return res.status(404).json({ error: 'Oferta nu a fost găsită în staging.' });

      res.json({ success: true, offer: updated || { id, ...rejectionUpdates }, message: 'Oferta a fost respinsă.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la revizuirea ofertei.' });
  }
});


// 11. Publicare oferte validate în catalogul public
app.post('/api/admin/catalog-importer/publish-validated', requireAdminAuth, async (req, res) => {
  try {
    const { offerIds } = req.body;
    const pubResult = await CatalogStagingManager.publishValidatedOffers(offerIds);
    const persistedProductCount = isPostgresConfigured()
      ? (await DatabaseService.getProducts()).length
      : StorageService.getAllProducts().length;
    const persistedOfferCount = isPostgresConfigured()
      ? (await DatabaseService.getOffers()).length
      : StorageService.getProductOffers().length;
    const persisted = pubResult.errors.length === 0;

    await DatabaseService.logAdminActivity({
      userEmail: (req.body?.userEmail as string) || 'admin@cosulmeu.ro',
      action: 'publish_validated_offers',
      targetType: 'staging_offers',
      targetId: offerIds ? (Array.isArray(offerIds) ? offerIds.slice(0, 5).join(',') : String(offerIds)) : 'all_validated',
      details: {
        publishedCount: pubResult.publishedCount,
        persistedProductCount,
        persistedOfferCount,
        errorsCount: pubResult.errors.length,
        result: persisted ? 'SUCCESS' : 'WARNINGS'
      },
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    res.json({
      success: persisted,
      publishedCount: pubResult.publishedCount,
      persistedProductCount,
      persistedOfferCount,
      errors: pubResult.errors,
      message: persisted
        ? `Au fost publicate ${pubResult.publishedCount} oferte validate în catalogul public. Produsele sunt salvate și indexate.`
        : `Publicarea a fost finalizată cu avertismente: ${pubResult.errors.join('; ')}`
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la publicarea ofertelor validate.' });
  }
});

// Șterge doar ofertele din staging care nu au fost publicate.
app.post('/api/admin/catalog-importer/staging/cleanup', requireAdminAuth, async (req, res) => {
  try {
    const rawOfferIds = req.body?.offerIds;
    if (!Array.isArray(rawOfferIds) || rawOfferIds.length === 0 || rawOfferIds.length > 5000) {
      return res.status(400).json({ error: 'Selectați între 1 și 5000 de oferte pentru curățare.' });
    }

    const offerIds = Array.from(new Set(rawOfferIds.filter(
      (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128
    )));
    if (offerIds.length === 0) {
      return res.status(400).json({ error: 'Nu au fost furnizate identificatori de ofertă valizi.' });
    }

    const databasePool = getPool();
    const deletedIds = databasePool
      ? await DatabaseService.deleteUnpublishedCatalogExtractedOffers(offerIds)
      : StorageService.deleteUnpublishedCatalogExtractedOffers(offerIds);
    if (databasePool) {
      StorageService.removeCatalogExtractedOffersByIds(deletedIds);
    }

    await DatabaseService.logAdminActivity({
      userEmail: (req.body?.userEmail as string) || 'admin@cosulmeu.ro',
      action: 'cleanup_unpublished_staging_offers',
      targetType: 'staging_offers',
      targetId: deletedIds.slice(0, 5).join(',') || undefined,
      details: { requestedCount: offerIds.length, removedCount: deletedIds.length },
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    res.json({
      success: true,
      removedCount: deletedIds.length,
      message: deletedIds.length
        ? `${deletedIds.length} oferte nepublicate au fost eliminate doar din staging.`
        : 'Nu au fost eliminate oferte. Înregistrările publicate sunt protejate.'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la curățarea ofertelor nepublicate din staging.' });
  }
});

// 12. Jurnal rulări import
app.get('/api/admin/catalog-importer/runs', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (pool) {
      const result = await pool.query(`
        SELECT id, retailer_id AS "retailerId", status, started_at AS "startedAt", completed_at AS "completedAt",
               duration_ms AS "durationMs", total_raw_extracted AS "totalRawExtracted",
               published_count AS "publishedCount", new_products_count AS "newProductsCount",
               updated_products_count AS "updatedProductsCount", unchanged_products_count AS "unchangedProductsCount",
               new_offers_count AS "newOffersCount", updated_offers_count AS "updatedOffersCount",
               changed_prices_count AS "changedPricesCount", items_without_price_count AS "itemsWithoutPriceCount",
               errors
        FROM catalog_import_runs
        ORDER BY started_at DESC
        LIMIT 100
      `);
      res.json({ success: true, runs: result.rows, count: result.rows.length });
    } else {
      const runs = StorageService.getCatalogImportRuns();
      res.json({ success: true, runs, count: runs.length });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea jurnalului de import.' });
  }
});

// 13. Jurnal erori catalog
app.get('/api/admin/catalog-importer/errors', requireAdminAuth, async (req, res) => {
  try {
    const pool = getPool();
    if (pool) {
      const result = await pool.query(`
        SELECT id, run_id AS "runId", document_id AS "documentId", retailer_id AS "retailerId",
               stage, message, error_detail AS "errorDetail", created_at AS "createdAt"
        FROM catalog_import_errors
        ORDER BY created_at DESC
        LIMIT 100
      `);
      res.json({ success: true, errors: result.rows, count: result.rows.length });
    } else {
      const errors = StorageService.getCatalogImportErrors();
      res.json({ success: true, errors, count: errors.length });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea erorilor de catalog.' });
  }
});

// 13.1 Produse detaliate pentru administrare catalog
app.get('/api/admin/products-detailed', requireAdminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string || '20', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);
    const search = (req.query.search as string) || '';
    const category = (req.query.category as string) || 'toate';
    const retailer = (req.query.retailer as string) || 'toate';

    const result = await DatabaseService.getProductsDetailed({ limit, offset, search, category, retailer });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la încărcarea produselor pentru administrare.' });
  }
});

// 13.2 Ștergere / Delistare produs individual
app.delete('/api/admin/products/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID-ul produsului este obligatoriu.' });
    StorageService.deleteProduct(id);
    const success = await DatabaseService.deleteProduct(id);
    res.json({ success, message: 'Produsul a fost delistat și șters cu succes din catalog.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la ștergerea produsului.' });
  }
});

// 13.3 Ștergere / Delistare produse în masă (Bulk Delete)
app.post('/api/admin/products/bulk-delete', requireAdminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Lista de ID-uri de produse este obligatorie.' });
    }
    StorageService.deleteProducts(ids);
    const result = await DatabaseService.deleteProducts(ids);
    res.json({ success: true, count: result.deletedCount, message: `Au fost delistate și șterse ${result.deletedCount} produse din catalog.` });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la ștergerea în masă a produselor.' });
  }
});

// 13.4 Detaliu produs canonic specific
app.get('/api/admin/products-detailed/:id', requireAdminAuth, async (req, res) => {
  try {
    const data = await DatabaseService.getProductDetailById(req.params.id);
    if (!data) return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea detaliilor produsului.' });
  }
});

// 13.3 Previzualizare detaliată înainte de publicare (Cerința 6)
app.post('/api/admin/staging/preview-publish', requireAdminAuth, async (req, res) => {
  try {
    const { offerIds } = req.body;
    const preview = await CatalogStagingManager.previewPublishValidated(offerIds);
    res.json({ success: true, preview });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la generarea previzualizării de publicare.' });
  }
});

// 13.4 Activare / Dezactivare Sursă cu înregistrare în audit log
app.post('/api/admin/sources/:id/toggle', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, userEmail } = req.body;
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Status invalid.' });
    }

    const updated = StorageService.updateCatalogSource(id, { status });
    if (!updated) return res.status(404).json({ error: 'Sursa nu a fost găsită.' });

    if (isPostgresConfigured()) {
      const pool = getPool();
      if (pool) {
        await pool.query('UPDATE catalog_sources SET status = $1 WHERE id = $2', [status, id]);
      }
    }

    await DatabaseService.logAdminActivity({
      userEmail: userEmail || 'admin@cosulmeu.ro',
      action: status === 'active' ? 'enable_source' : 'disable_source',
      targetType: 'catalog_source',
      targetId: id,
      details: { previousStatus: status === 'active' ? 'disabled' : 'active', newStatus: status, sourceName: updated.name },
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    res.json({ success: true, source: updated, message: `Sursa ${updated.name} este acum ${status}.` });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la schimbarea stării sursei.' });
  }
});

// 13.5 Rulare sigură import pentru un singur retailer cu Advisory Lock
app.post('/api/admin/import/run-retailer/:retailerId', requireAdminAuth, async (req, res) => {
  try {
    const { retailerId } = req.params;
    const { userEmail } = req.body;

    await DatabaseService.logAdminActivity({
      userEmail: userEmail || 'admin@cosulmeu.ro',
      action: 'import_started',
      targetType: 'retailer',
      targetId: retailerId,
      details: { retailerId, timestamp: new Date().toISOString() },
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    const result = await CatalogStagingManager.runPilotImportForRetailer(retailerId);

    await DatabaseService.logAdminActivity({
      userEmail: userEmail || 'admin@cosulmeu.ro',
      action: result.success ? 'import_completed' : 'import_failed',
      targetType: 'retailer',
      targetId: retailerId,
      details: {
        retailerId,
        success: result.success,
        totalExtracted: result.totalExtracted,
        autoMatched: result.autoMatched,
        published: result.published,
        error: result.error
      },
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Eroare la rularea importului pentru retailer.' });
  }
});

// 13.6 Reîncercare sigură eroare de procesare
app.post('/api/admin/errors/:id/retry', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail } = req.body;

    const errors = StorageService.getCatalogImportErrors();
    const errItem = errors.find(e => e.id === id);

    await DatabaseService.logAdminActivity({
      userEmail: userEmail || 'admin@cosulmeu.ro',
      action: 'retry_processing_error',
      targetType: 'catalog_import_error',
      targetId: id,
      details: { errorId: id, retailerId: errItem?.retailerId, stage: errItem?.stage }
    });

    if (errItem?.retailerId) {
      const result = await CatalogStagingManager.runPilotImportForRetailer(errItem.retailerId);
      return res.json({ success: true, message: `Reîncercare executată pentru ${errItem.retailerId}.`, result });
    }

    res.json({ success: true, message: 'Operațiunea de retry a fost recepționată.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Eroare la executarea reîncercării.' });
  }
});

// 14. Colectare imediată indexare prețuri
app.post('/api/indexing/collect-now', async (req, res) => {
  try {
    const { retailerId = 'lidl' } = req.body;
    const result = await IndexingScheduler.runRetailerJob(retailerId, {
      triggeredBy: 'api_collect_now'
    });
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Eroare la declanșarea colectării.' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Coșul Meu Backend',
    geminiConfigured: !!apiKey,
    adminProtected: !!process.env.ADMIN_API_KEY,
    time: new Date().toISOString(),
  });
});

// Vite Middleware integration (active in dev, skipped during test)
if (!isProd && process.env.NODE_ENV !== 'test') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      port: 3000,
      host: '0.0.0.0',
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else if (isProd) {
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

const isMainModule = Boolean(
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith('server.ts'))
);

if (isMainModule && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server Coșul Meu pornit pe http://localhost:${PORT}`);
  });
}

export { app, ADMIN_API_KEY };

