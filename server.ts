import express from 'express';
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
import { CatalogDownloader } from './src/indexing/catalog/CatalogDownloader.ts';
import { CatalogParserEngine } from './src/indexing/catalog/CatalogParserEngine.ts';
import { CatalogSourceDiscovery } from './src/indexing/catalog/CatalogSourceDiscovery.ts';
import { CatalogStagingManager } from './src/indexing/catalog/CatalogStagingManager.ts';
import { CatalogSource, CatalogDocument } from './src/indexing/catalog/catalogTypes.ts';


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
  const isValid = token === ADMIN_API_KEY || (!isProd && token === DEFAULT_DEV_ADMIN_KEY);
  if (!token || !isValid) {
    return res.status(403).json({ error: 'Acces interzis. Token administrativ invalid.' });
  }

  next();
};

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
app.post('/api/catalog/compare', (req, res) => {
  try {
    const { items = [], options = {} } = req.body;
    const comparisons = PriceComparisonService.compareBasketAcrossStores(items, options);
    res.json({ success: true, comparisons });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la calculul comparativ al coșului.' });
  }
});

// GET /api/categories - Taxonomie completă categorii și subcategorii
app.get('/api/categories', (req, res) => {
  try {
    const allProducts = StorageService.getAllProducts();
    const offers = StorageService.getProductOffers();
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
app.get('/api/products', (req, res) => {
  try {
    const {
      category,
      subcategory,
      brand,
      search,
      onlyPromo,
      onlyAvailable,
      sortBy = 'relevance',
      page = '1',
      limit = '12'
    } = req.query;

    const allProducts = StorageService.getAllProducts();
    const allOffers = StorageService.getProductOffers();

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
app.get('/api/products/:id', (req, res) => {
  try {
    const { id } = req.params;
    const comparison = PriceComparisonService.getProductComparisonDetails(id);
    if (!comparison) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit în catalog.' });
    }

    const observations = StorageService.getPriceObservations().filter(obs => obs.productId === id);

    res.json({
      success: true,
      product: comparison.product,
      comparison,
      observationsCount: observations.length,
      hasSufficientHistory: observations.length >= 2,
      observations: observations.slice(0, 50)
    });
  } catch (err: any) {
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
    const normResult = adapter.normalize(valResult.valid, storeId);

    // Prepare observations for valid matched offers (append-only timeline)
    const todayStr = new Date().toISOString().split('T')[0];
    const newObservations = normResult.offers.map(off => ({
      id: `obs-srv-${Date.now()}-${off.productId}`,
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

// 1. Statistici agregate Catalog Importer
app.get('/api/admin/catalog-importer/stats', requireAdminAuth, (req, res) => {
  try {
    const stats = StorageService.getCatalogStats();
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea statisticilor de catalog.' });
  }
});

// 2. Surse de catalog
app.get('/api/admin/catalog-importer/sources', requireAdminAuth, (req, res) => {
  try {
    const sources = StorageService.getCatalogSources();
    res.json({ success: true, sources, count: sources.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea surselor de catalog.' });
  }
});

// 3. Adăugare / editare sursă de catalog cu validare SSRF
app.post('/api/admin/catalog-importer/sources', requireAdminAuth, (req, res) => {
  try {
    const { id, retailerId, retailerName, name, catalogUrl, format = 'html', status = 'active', legalStatusNotice } = req.body;
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
      name,
      catalogUrl,
      format,
      status,
      updateFrequencyDays: 7,
      authRequired: status === 'pending_authorization',
      legalStatusNotice: legalStatusNotice || 'Sursă configurată de administrator cu verificare SSRF.'
    };

    const sources = StorageService.getCatalogSources();
    const existingIdx = sources.findIndex(s => s.id === sourceId);
    if (existingIdx !== -1) {
      sources[existingIdx] = newSource;
    } else {
      sources.push(newSource);
    }
    StorageService.saveCatalogSources(sources);

    res.json({ success: true, source: newSource, message: 'Sursa de catalog a fost salvată cu succes.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la salvarea sursei de catalog.' });
  }
});

// 4. Modificare stare sursă (activare / pauză)
app.patch('/api/admin/catalog-importer/sources/:id/status', requireAdminAuth, (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'pending_authorization', 'disabled', 'error'].includes(status)) {
      return res.status(400).json({ error: 'Status invalid.' });
    }
    const updated = StorageService.updateCatalogSource(req.params.id, { status });
    if (!updated) {
      return res.status(404).json({ error: 'Sursa nu a fost găsită.' });
    }
    res.json({ success: true, source: updated });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la actualizarea stării sursei.' });
  }
});

// 5. Documente descoperite
app.get('/api/admin/catalog-importer/documents', requireAdminAuth, (req, res) => {
  try {
    const docs = StorageService.getCatalogDocuments();
    res.json({ success: true, documents: docs, count: docs.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea documentelor de catalog.' });
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

// 9. Coadă de Staging & Validare
app.get('/api/admin/catalog-importer/staging', requireAdminAuth, (req, res) => {
  try {
    const { status, retailerId, search } = req.query;
    let offers = StorageService.getCatalogExtractedOffers();

    if (status && typeof status === 'string' && status !== 'toate') {
      offers = offers.filter(o => o.stagingStatus === status);
    }
    if (retailerId && typeof retailerId === 'string' && retailerId !== 'toate') {
      offers = offers.filter(o => o.retailerId === retailerId);
    }
    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      offers = offers.filter(o =>
        o.rawTitle.toLowerCase().includes(q) ||
        (o.rawBrand && o.rawBrand.toLowerCase().includes(q)) ||
        (o.matchedProductName && o.matchedProductName.toLowerCase().includes(q))
      );
    }

    res.json({
      success: true,
      count: offers.length,
      offers: offers.slice(0, 200)
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea cozii de staging.' });
  }
});

// 10. Aprobare sau respingere manuală ofertă din Staging
app.post('/api/admin/catalog-importer/staging/:id/review', requireAdminAuth, (req, res) => {
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
      if (!updated) return res.status(404).json({ error: 'Oferta nu a fost găsită în staging.' });

      res.json({ success: true, offer: updated, message: 'Oferta a fost validată și este pregătită pentru publicare.' });
    } else {
      const updated = StorageService.updateCatalogExtractedOffer(id, {
        stagingStatus: 'REJECTED',
        rejectionReason: rejectionReason || 'Respinsă manual de administrator.',
        reviewedBy: 'admin',
        reviewedAt: new Date().toISOString()
      });
      if (!updated) return res.status(404).json({ error: 'Oferta nu a fost găsită în staging.' });

      res.json({ success: true, offer: updated, message: 'Oferta a fost respinsă.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la revizuirea ofertei.' });
  }
});

// 10b. Aprobare sau respingere în masă
app.post('/api/admin/catalog-importer/staging/bulk-review', requireAdminAuth, (req, res) => {
  try {
    const { offerIds, action } = req.body;
    if (!Array.isArray(offerIds) || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Date invalide pentru revizuire în masă.' });
    }

    const allStaged = StorageService.getCatalogExtractedOffers();
    let updatedCount = 0;

    for (const id of offerIds) {
      const targetOffer = allStaged.find(o => o.id === id);
      if (!targetOffer) continue;

      if (action === 'approve') {
        let pId = targetOffer.matchedProductId;
        let pName = targetOffer.matchedProductName;
        if (!pId) {
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
          pId = newProd.id;
          pName = newProd.name;
        }

        StorageService.updateCatalogExtractedOffer(id, {
          stagingStatus: 'VALIDATED',
          matchedProductId: pId,
          matchedProductName: pName,
          matchMethod: 'manual',
          matchConfidence: 1.0,
          reviewedBy: 'admin',
          reviewedAt: new Date().toISOString()
        });
        updatedCount++;
      } else {
        StorageService.updateCatalogExtractedOffer(id, {
          stagingStatus: 'REJECTED',
          reviewedBy: 'admin',
          reviewedAt: new Date().toISOString()
        });
        updatedCount++;
      }
    }

    res.json({
      success: true,
      updatedCount,
      message: `${updatedCount} oferte au fost ${action === 'approve' ? 'validate' : 'respinse'} cu succes.`
    });
  } catch (err: any) {
    res.status(500).json({ error: `Eroare la revizuirea în masă: ${err.message}` });
  }
});

// 11. Publicare oferte validate în catalogul public
app.post('/api/admin/catalog-importer/publish-validated', requireAdminAuth, async (req, res) => {
  try {
    const { offerIds } = req.body;
    const pubResult = await CatalogStagingManager.publishValidatedOffers(offerIds);
    res.json({
      success: true,
      publishedCount: pubResult.publishedCount,
      errors: pubResult.errors,
      message: `Au fost publicate ${pubResult.publishedCount} oferte validate în catalogul public.`
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la publicarea ofertelor validate.' });
  }
});

// 12. Jurnal rulări import
app.get('/api/admin/catalog-importer/runs', requireAdminAuth, (req, res) => {
  try {
    const runs = StorageService.getCatalogImportRuns();
    res.json({ success: true, runs, count: runs.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea jurnalului de import.' });
  }
});

// 13. Jurnal erori catalog
app.get('/api/admin/catalog-importer/errors', requireAdminAuth, (req, res) => {
  try {
    const errors = StorageService.getCatalogImportErrors();
    res.json({ success: true, errors, count: errors.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea erorilor de catalog.' });
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

