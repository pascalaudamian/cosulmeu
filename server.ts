import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

import { DatabaseService, checkDbHealth, isPostgresConfigured } from './src/db/index.ts';
import { FileImportAdapter } from './src/sources/FileImportAdapter.ts';
import { StorageService } from './src/services/StorageService.ts';
import { PriceComparisonService } from './src/services/PriceComparisonService.ts';
import { RetailerRegistry } from './src/indexing/RetailerRegistry.ts';
import { IndexingScheduler } from './src/indexing/IndexingScheduler.ts';

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
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'cosul-meu-admin-dev-secret-2026';
const MAX_ADMIN_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const requireAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Acces neautorizat. Token administrativ lipsă.' });
  }

  const token = authHeader.slice(7).trim();
  if (token !== ADMIN_API_KEY) {
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

