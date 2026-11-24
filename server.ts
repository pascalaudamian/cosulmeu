import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

import { DatabaseService, checkDbHealth, isPostgresConfigured, getPool, invalidateCatalogOptimizationCache } from './src/db/index.ts';
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
import { PRODUCTS, STORES } from './src/data/mockData.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase.ts';
import { CatalogDownloader } from './src/indexing/catalog/CatalogDownloader.ts';
import { CatalogParserEngine } from './src/indexing/catalog/CatalogParserEngine.ts';
import { CatalogSourceDiscovery } from './src/indexing/catalog/CatalogSourceDiscovery.ts';
import { CatalogStagingManager } from './src/indexing/catalog/CatalogStagingManager.ts';
import { CatalogSource, CatalogDocument } from './src/indexing/catalog/catalogTypes.ts';
import { Product, ProductOffer, Receipt, Store, PriceAlert, InAppPriceNotification, RetailerProductRecord } from './src/types.ts';
import { createHash } from 'node:crypto';
import { createSessionToken, hashSecret, verifySecret, parseSessionCookie, sessionCookie, SESSION_TTL_SECONDS } from './src/auth.ts';
import { validatePublicHttpUrl } from './src/utils/urlSecurity.ts';
import { PriceAuditService } from './src/services/PriceAuditService.ts';
import {
  buildAnalyzedReceipt,
  buildUserPriceObservations,
  computeReceiptFingerprint,
  detectDuplicateReceipts,
  mergeMultiPageOcrTexts,
  validateReceiptMath
} from './src/services/ReceiptParserEngine.ts';
import {
  basketOptimizeRequestSchema,
  gdprAdminRequestUpdateSchema,
  gdprConsentRecordSchema,
  gdprDeleteAccountSchema,
  gdprProfileUpdateSchema,
  gdprRequestCreateSchema,
  gdprWithdrawConsentSchema,
  parseReceiptTextRequestSchema,
  priceAlertCreateSchema,
  priceAlertsFromListSchema,
  priceAlertUpdateSchema,
  priceAuditQuerySchema,
  priceAuditRemediationRequestSchema,
  priceHistoryQuerySchema,
  saveReceiptRequestSchema,
  scanReceiptRequestSchema,
  shadowMatchingPersistSchema,
  shadowMatchingQuerySchema,
  shadowReviewAuditQuerySchema,
  shadowReviewDecisionSchema,
  shadowReviewListQuerySchema,
  validateReceiptImageBuffer
} from './src/server/validation.ts';
import { ShadowReviewService, type VerifiedAdminReviewer } from './src/services/ShadowReviewService.ts';
import { BasketOptimizerService } from './src/services/BasketOptimizerService.ts';
import { PriceHistoryService } from './src/services/PriceHistoryService.ts';
import { PriceAlertService } from './src/services/PriceAlertService.ts';
import { PriceQualityClassifier } from './src/services/PriceQualityClassifier.ts';
import {
  MARKETING_CONSENT_TEXT_VERSION,
  PRIVACY_POLICY_VERSION
} from './src/config/legalConfig.ts';
import {
  assistantQueryRequestSchema,
  barcodeSuggestionCreateSchema,
  budgetSettingsUpdateSchema,
  sharedListActivityCreateSchema,
  sharedListInviteCreateSchema,
  sharedListMemberRoleUpdateSchema
} from './src/server/validation.ts';
import { BudgetService } from './src/services/BudgetService.ts';
import { ProductAlternativesService } from './src/services/ProductAlternativesService.ts';
import { lookupProductByBarcode, normalizeBarcodeCandidates } from './src/services/BarcodeService.ts';
import { ShoppingAssistantService } from './src/services/ShoppingAssistantService.ts';
import {
  buildCanonicalAliasIndex,
  type CanonicalAliasIndex,
  collectProductIdsForCanonical,
  mergeCanonicalAliasSources,
  normalizeProductReferences,
  resolveCanonicalProductDetail,
  resolveCanonicalProductId,
  resolveProductReferenceMap
} from './src/services/ProductIdentityService.ts';

function sanitizeApiImageUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl || !rawUrl.trim()) return undefined;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  const safety = validatePublicHttpUrl(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
  if (!safety.safe || !safety.normalizedUrl) return undefined;
  try {
    if (new URL(safety.normalizedUrl).pathname.toLowerCase().endsWith('.svg')) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return safety.normalizedUrl;
}


dotenv.config({ path: '.env.development.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '25mb' }));

// Canonical domain redirect: cosulmeu.vercel.app -> https://cosulmeu.online
app.use((req, res, next) => {
  const rawHost = (req.headers['x-forwarded-host'] || req.hostname || '').toString().split(',')[0].trim().toLowerCase();
  const hostOnly = rawHost.replace(/:\d+$/, '');
  if (hostOnly === 'cosulmeu.vercel.app' && (req.method === 'GET' || req.method === 'HEAD')) {
    return res.redirect(301, `https://cosulmeu.online${req.originalUrl || '/'}`);
  }
  next();
});

// Lightweight in-memory sliding-window rate limiter for public write/compute routes
function createRateLimiter(options: { windowMs: number; maxRequests: number; messageRo: string }) {
  const hits = new Map<string, number[]>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === 'test' && req.headers['x-enforce-rate-limit'] !== 'true') {
      return next();
    }
    const now = Date.now();
    const ipHeader = req.headers['x-forwarded-for'];
    const clientIp =
      (Array.isArray(ipHeader) ? ipHeader[0] : typeof ipHeader === 'string' ? ipHeader.split(',')[0] : '') ||
      req.ip ||
      'unknown';
    const key = `${clientIp.trim()}:${req.path}`;
    const windowStart = now - options.windowMs;
    const recent = (hits.get(key) || []).filter(ts => ts > windowStart);

    if (hits.size > 2000) {
      // Bound map growth deterministically
      hits.clear();
    }

    if (recent.length >= options.maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        error: options.messageRo
      });
    }

    recent.push(now);
    hits.set(key, recent);
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.maxRequests - recent.length)));
    next();
  };
}

const publicComputeLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 90,
  messageRo: 'Prea multe cereri într-un timp scurt. Reîncearcă peste câteva secunde.'
});

const publicReportLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 25,
  messageRo: 'Ai trimis prea multe raportări consecutive. Te rugăm să aștepți un minut.'
});

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

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || 'https://bwanbgbimktluajvwzsj.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3YW5iZ2JpbWt0bHVhanZ3enNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM3OTM0ODQsImV4cCI6MjEwOTM2OTQ4NH0.dHSKcUjqitbWOBmV_aG5IjWM5L7nTilVML0DOomd9gs';

async function getAuthenticatedSupabaseUser(req: express.Request) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });

  return { user: data.user, token, userClient };
}

async function loadCatalogProductsForReceipts(): Promise<Product[]> {
  try {
    const dbProducts = await DatabaseService.getProducts();
    if (Array.isArray(dbProducts) && dbProducts.length > 0) {
      return dbProducts;
    }
  } catch {
    // Fallback to static reference catalog
  }
  try {
    const { data } = await supabase
      .from('products')
      .select('id,name,brand,category,default_unit,package_weight_or_volume,package_unit,normalized_unit,barcode,image_url,is_bio,is_romanian_product,base_reference_price')
      .limit(500);
    if (Array.isArray(data) && data.length > 0) {
      return data.map((row: any) => ({
        id: row.id,
        name: row.name,
        brand: row.brand || '',
        category: row.category || 'Alte produse',
        defaultUnit: row.default_unit || 'buc',
        packageWeightOrVolume: Number(row.package_weight_or_volume || 1),
        packageUnit: row.package_unit || 'buc',
        normalizedUnit: row.normalized_unit || 'buc',
        barcode: row.barcode || undefined,
        imageUrl: row.image_url || undefined,
        isBio: Boolean(row.is_bio),
        isRomanianProduct: Boolean(row.is_romanian_product),
        baseReferencePrice: Number(row.base_reference_price || 0)
      }));
    }
  } catch {
    // Use local PRODUCTS list
  }
  return PRODUCTS;
}

// Receipt OCR & Structured Extraction 2.0 endpoint
app.post('/api/scan-receipt', publicComputeLimiter, async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const parsedReq = scanReceiptRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_REQUEST',
        error: parsedReq.error.issues[0]?.message || 'Date invalide pentru scanarea bonului.'
      });
    }

    const input = parsedReq.data;
    const rawImageList = input.images?.length
      ? input.images
      : [{ base64: input.imageBase64!, mimeType: (input.mimeType || 'image/jpeg').toLowerCase() as any }];

    const validatedImages: Array<{ base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }> = [];
    for (const imgItem of rawImageList) {
      const check = validateReceiptImageBuffer(imgItem.base64, imgItem.mimeType);
      if (!check.valid || !check.buffer || !check.detectedMime) {
        return res.status(415).json({
          success: false,
          code: 'INVALID_IMAGE_FORMAT',
          error: check.error || 'Format imagine invalid.'
        });
      }
      validatedImages.push({
        base64: check.buffer.toString('base64'),
        mimeType: check.detectedMime
      });
    }

    if (!ai) {
      return res.status(503).json({
        success: false,
        code: 'OCR_UNAVAILABLE',
        retryCapture: true,
        error: 'Serviciul OCR nu este configurat pe server (lipsește GEMINI_API_KEY). Nu putem interpreta imaginea automat.'
      });
    }

    const prompt = `Analizează cu maximă precizie această fotografie (sau aceste fotografii consecutive) a unui bon fiscal românesc (Lidl, Kaufland, Carrefour, Penny, Auchan, Profi, Mega Image, Metro etc.).

REGULI CRITICE:
1. Dacă imaginea NU este un bon fiscal, este prea neclară, tăiată sever sau supraexpusă încât prețurile nu se pot citi sigur, setează isReadable=false și explică motivul în qualityIssue. NU inventa produse sau prețuri.
2. Transcrie textul complet vizibil în rawOcrText.
3. Separă strict:
   - retailer (storeName, storeAddress, fiscalNumber, receiptNumber)
   - date (YYYY-MM-DD), time (HH:MM), paymentMethod
   - produse: rawName (exact de pe bon), eanCode (DOAR dacă este cod de bare valid 8/12/13/14 cifre, altfel null), internalCode (cod intern magazin/PLU), quantity (cantitate numerică cu zecimale pentru kg), unit ('buc'|'kg'|'g'|'l'|'ml'|'pachet'), unitPrice, totalPrice (totalul liniei înainte de reduceri), discount (reducerea aferentă liniei, >= 0), vatRate (5, 9 sau 19), isSgr (true pentru Garanție SGR / RetuRO 0,50 lei), isWeighted (true pentru produse cântărite).
4. Nu modifica totalul imprimat de pe bon (printedTotal / total) pentru a forța egalitatea cu suma produselor. Raportează separat sgrTotal, couponsTotal, vatTotal, subtotal, discountTotal și printedTotal.`;

    const parts: any[] = validatedImages.map(img => ({
      inlineData: {
        data: img.base64,
        mimeType: img.mimeType
      }
    }));
    parts.push({ text: prompt });

    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isReadable: { type: Type.BOOLEAN },
              qualityIssue: { type: Type.STRING },
              rawOcrText: { type: Type.STRING },
              storeName: { type: Type.STRING },
              storeAddress: { type: Type.STRING },
              fiscalNumber: { type: Type.STRING },
              receiptNumber: { type: Type.STRING },
              date: { type: Type.STRING },
              time: { type: Type.STRING },
              paymentMethod: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rawName: { type: Type.STRING },
                    eanCode: { type: Type.STRING },
                    internalCode: { type: Type.STRING },
                    quantity: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                    unitPrice: { type: Type.NUMBER },
                    totalPrice: { type: Type.NUMBER },
                    discount: { type: Type.NUMBER },
                    vatRate: { type: Type.NUMBER },
                    isSgr: { type: Type.BOOLEAN },
                    isWeighted: { type: Type.BOOLEAN },
                    category: { type: Type.STRING }
                  },
                  required: ['rawName', 'quantity', 'unitPrice', 'totalPrice']
                }
              },
              subtotal: { type: Type.NUMBER },
              discountTotal: { type: Type.NUMBER },
              couponsTotal: { type: Type.NUMBER },
              sgrTotal: { type: Type.NUMBER },
              vatTotal: { type: Type.NUMBER },
              total: { type: Type.NUMBER }
            },
            required: ['isReadable', 'items', 'total']
          }
        }
      });
    } catch (geminiError: any) {
      console.error('[receipt-ocr] Provider error:', geminiError?.message || 'OCR error');
      return res.status(502).json({
        success: false,
        code: 'OCR_PROVIDER_ERROR',
        retryCapture: true,
        error: 'Nu am putut interpreta imaginea bonului prin OCR. Verifică claritatea fotografiei și încearcă din nou.'
      });
    }

    const textOutput = response.text?.trim();
    if (!textOutput) {
      return res.status(422).json({
        success: false,
        code: 'UNREADABLE_IMAGE',
        retryCapture: true,
        error: 'Nu am putut extrage date lizibile din imagine. Fotografiază bonul din nou cu iluminare mai bună.'
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(textOutput);
    } catch {
      return res.status(422).json({
        success: false,
        code: 'OCR_PARSE_ERROR',
        retryCapture: true,
        error: 'Răspunsul OCR nu a putut fi structurat sigur. Te rugăm să refaci fotografia.'
      });
    }

    if (parsed.isReadable === false || (!Array.isArray(parsed.items) || (parsed.items.length === 0 && !parsed.rawOcrText))) {
      return res.status(422).json({
        success: false,
        code: 'UNREADABLE_IMAGE',
        retryCapture: true,
        error: parsed.qualityIssue || 'Imaginea este neclară, incompletă sau nu conține un bon fiscal lizibil. Te rugăm să o fotografiezi din nou.'
      });
    }

    const catalogProducts = await loadCatalogProductsForReceipts();
    const analyzed = buildAnalyzedReceipt({
      extracted: {
        ...parsed,
        printedTotal: parsed.total
      },
      rawOcrText: parsed.rawOcrText,
      availableStores: STORES,
      catalogProducts,
      ocrQuality: {
        isBlurry: input.qualityHints?.isBlurry,
        blurScore: input.qualityHints?.blurScore,
        isOverexposed: input.qualityHints?.isOverexposed,
        isUnderexposed: input.qualityHints?.isUnderexposed,
        ocrTextConfidence: input.qualityHints?.isBlurry ? 68 : 93
      }
    });

    // Privacy invariant: Never persist scanned receipt items automatically into public catalog discovery queues or product_offers.
    return res.json({
      success: true,
      source: 'gemini_ocr',
      receipt: analyzed
    });
  } catch (error) {
    console.error('[receipt-ocr] Internal error');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      error: 'Eroare internă la procesarea bonului fiscal.'
    });
  }
});

// Deterministic structured parsing endpoint for raw OCR text (including multi-page receipts)
app.post('/api/receipts/parse-text', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const parsedReq = parseReceiptTextRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
      return res.status(400).json({
        success: false,
        error: parsedReq.error.issues[0]?.message || 'Text OCR invalid.'
      });
    }

    const combinedText = parsedReq.data.pagesText?.length
      ? mergeMultiPageOcrTexts(parsedReq.data.pagesText)
      : parsedReq.data.rawOcrText;

    const catalogProducts = await loadCatalogProductsForReceipts();
    const analyzed = buildAnalyzedReceipt({
      rawOcrText: combinedText,
      availableStores: STORES,
      catalogProducts,
      ocrQuality: parsedReq.data.ocrQuality
    });

    return res.json({
      success: true,
      receipt: analyzed
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Nu am putut interpreta textul bonului.' });
  }
});

// Authenticated receipt persistence & duplicate verification
app.post('/api/receipts/save', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({
        success: false,
        error: 'Autentificare necesară pentru salvarea bonurilor în istoricul personal.'
      });
    }

    const parsedReq = saveReceiptRequestSchema.safeParse(req.body);
    if (!parsedReq.success) {
      return res.status(400).json({
        success: false,
        error: parsedReq.error.issues[0]?.message || 'Datele bonului sunt invalide.'
      });
    }

    const { receipt: inputReceipt, images, allowDuplicateOverride } = parsedReq.data;

    // Validate image buffers if provided
    const validatedBuffers: Array<{ buffer: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }> = [];
    if (images?.length) {
      for (const img of images) {
        const check = validateReceiptImageBuffer(img.base64, img.mimeType);
        if (!check.valid || !check.buffer || !check.detectedMime) {
          return res.status(415).json({
            success: false,
            error: check.error || 'Imagine atașată invalidă.'
          });
        }
        validatedBuffers.push({ buffer: check.buffer, mimeType: check.detectedMime });
      }
    }

    const validatedReceipt = validateReceiptMath({
      ...(inputReceipt as unknown as Receipt),
      currency: 'RON',
      createdAt: new Date().toISOString()
    });
    const fingerprint = validatedReceipt.contentFingerprint || computeReceiptFingerprint(validatedReceipt);

    // Check existing receipts owned by this user strictly via RLS-scoped userClient
    const { data: existingRows, error: existingErr } = await auth.userClient
      .from('receipts')
      .select('id,store_id,merchant_name,purchased_at,total_amount,extracted_data,created_at')
      .eq('user_id', auth.user.id)
      .order('purchased_at', { ascending: false })
      .limit(100);

    if (existingErr) {
      return res.status(500).json({ success: false, error: 'Nu am putut verifica istoricul de bonuri.' });
    }

    const existingReceipts: Receipt[] = (existingRows || []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id || row.extracted_data?.storeId || 'unknown',
      storeName: row.merchant_name || 'Magazin',
      date: String(row.purchased_at || row.created_at || '').slice(0, 10),
      time: row.extracted_data?.time || undefined,
      receiptNumber: row.extracted_data?.receiptNumber || undefined,
      fiscalNumber: row.extracted_data?.fiscalNumber || undefined,
      items: Array.isArray(row.extracted_data?.items) ? row.extracted_data.items : [],
      subtotal: Number(row.extracted_data?.subtotal ?? row.total_amount ?? 0),
      discountTotal: Number(row.extracted_data?.discountTotal ?? 0),
      total: Number(row.total_amount ?? 0),
      currency: 'RON',
      createdAt: row.created_at || new Date().toISOString(),
      verifiedStatus: 'confirmed',
      contentFingerprint: row.extracted_data?.contentFingerprint || undefined
    }));

    const duplicateCheck = detectDuplicateReceipts(
      { ...validatedReceipt, contentFingerprint: fingerprint },
      existingReceipts
    );
    if (duplicateCheck.isDuplicate && !allowDuplicateOverride) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_RECEIPT',
        duplicateWarning: duplicateCheck,
        error: duplicateCheck.matchReason || 'Acest bon pare a fi duplicat.'
      });
    }

    const receiptUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(validatedReceipt.id)
      ? validatedReceipt.id
      : crypto.randomUUID();

    // Upload private receipt images if bucket is available
    const uploadedPaths: string[] = [];
    for (let i = 0; i < validatedBuffers.length; i++) {
      const { buffer, mimeType } = validatedBuffers[i];
      const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const objectPath = `${auth.user.id}/${receiptUuid}/page-${i + 1}.${ext}`;
      const { error: upErr } = await auth.userClient.storage
        .from('receipt-images')
        .upload(objectPath, buffer, { contentType: mimeType, upsert: true });
      if (!upErr) {
        uploadedPaths.push(objectPath);
      }
    }

    const receiptAliasIndex = await loadServerProductAliasIndex();
    const canonicalizedReceiptItems = validatedReceipt.items.map(it => {
      const rawMatchedId = typeof it.matchedProductId === 'string' ? it.matchedProductId.trim() : '';
      if (!rawMatchedId) return it;
      const detail = resolveCanonicalProductDetail(rawMatchedId, receiptAliasIndex);
      if (detail.cycleDetected || (detail.wasAlias && !detail.found)) {
        return {
          ...it,
          matchedProductId: undefined,
          matchStatus: 'unmatched' as const,
          provenance: {
            ...(it.provenance || {}),
            originalMatchedProductId: rawMatchedId,
            ...(detail.cycleDetected
              ? { rejectedCycleMatchedProductId: true }
              : { rejectedOrphanMatchedProductId: true })
          }
        };
      }
      if (detail.found && detail.canonicalId && detail.canonicalId !== rawMatchedId) {
        return {
          ...it,
          matchedProductId: detail.canonicalId,
          provenance: {
            ...(it.provenance || {}),
            ...(it.provenance?.originalMatchedProductId ? {} : { originalMatchedProductId: rawMatchedId })
          }
        };
      }
      return it;
    });
    const canonicalValidatedReceipt: Receipt = {
      ...validatedReceipt,
      items: canonicalizedReceiptItems
    };

    const observations = buildUserPriceObservations({ ...canonicalValidatedReceipt, id: receiptUuid }, auth.user.id);
    const extractedPayload = {
      ...canonicalValidatedReceipt,
      id: receiptUuid,
      imagePaths: uploadedPaths,
      contentFingerprint: fingerprint,
      processedAt: new Date().toISOString()
    };

    const storeMatch = STORES.find(s => s.id === validatedReceipt.storeId);
    const purchasedAt = `${validatedReceipt.date}T${validatedReceipt.time || '12:00'}:00`;

    // Persist via save_receipt_v2 RPC (atomic) or base receipts table fallback
    const { error: rpcErr } = await auth.userClient.rpc('save_receipt_v2', {
      p_receipt: {
        id: receiptUuid,
        store_id: storeMatch?.id || null,
        image_path: uploadedPaths[0] || null,
        merchant_name: validatedReceipt.storeName,
        purchased_at: purchasedAt,
        total_amount: validatedReceipt.total,
        currency: 'RON',
        extracted_data: extractedPayload,
        status: validatedReceipt.verifiedStatus === 'confirmed' ? 'processed' : 'uploaded',
        receipt_number: validatedReceipt.receiptNumber || null,
        payment_method: validatedReceipt.paymentMethod || null,
        sgr_total: validatedReceipt.sgrTotal ?? 0,
        coupons_total: validatedReceipt.couponsTotal ?? 0,
        vat_total: validatedReceipt.vatTotal ?? null,
        printed_total: validatedReceipt.printedTotal ?? validatedReceipt.total,
        calculated_total: validatedReceipt.calculatedTotal ?? validatedReceipt.total,
        discrepancy_amount: validatedReceipt.discrepancyAmount ?? 0,
        validation_status: validatedReceipt.validationStatus || 'VALID',
        validation_reasons: validatedReceipt.validationReasons || [],
        confidence_scores: validatedReceipt.confidenceScores || {},
        raw_ocr_text: validatedReceipt.rawOcrText || null,
        original_extracted_data: validatedReceipt.originalExtractedData || null,
        user_corrections: validatedReceipt.userCorrections || null,
        image_paths: uploadedPaths,
        content_fingerprint: fingerprint
      },
      p_items: canonicalValidatedReceipt.items.map(it => ({
        product_id: it.matchedProductId || null,
        raw_name: it.rawName,
        normalized_name: it.normalizedName || null,
        ean_code: it.eanCode || null,
        internal_code: it.internalCode || null,
        quantity: it.quantity,
        unit: it.unit || 'buc',
        unit_price: it.unitPrice,
        total_price: it.totalPrice,
        discount: it.discount || 0,
        vat_rate: it.vatRate ?? null,
        is_weighted: Boolean(it.isWeighted),
        is_sgr: Boolean(it.isSgr),
        confidence_score: it.confidenceScore ?? null,
        confidence_details: it.confidenceDetails || null,
        math_valid: it.mathValid ?? true,
        match_status: it.matchStatus || 'unmatched',
        provenance: it.provenance || {},
        raw_line_text: it.rawLineText || null
      })),
      p_observations: observations.map(obs => ({
        product_id: obs.productId || null,
        product_name: obs.productName,
        store_id: storeMatch?.id || null,
        store_name: obs.storeName,
        purchase_date: obs.purchaseDate,
        quantity: obs.quantity,
        unit: obs.unit,
        unit_price: obs.unitPrice,
        discount: obs.discount,
        effective_paid_unit_price: obs.effectivePaidUnitPrice,
        total_paid: obs.totalPaid,
        source_receipt_label: obs.sourceReceiptLabel || null
      }))
    });

    if (rpcErr) {
      const { error: upsertErr } = await auth.userClient.from('receipts').upsert(
        {
          id: receiptUuid,
          user_id: auth.user.id,
          store_id: storeMatch?.id || null,
          image_path: uploadedPaths[0] || null,
          merchant_name: validatedReceipt.storeName,
          purchased_at: purchasedAt,
          total_amount: validatedReceipt.total,
          currency: 'RON',
          extracted_data: extractedPayload,
          status: validatedReceipt.verifiedStatus === 'confirmed' ? 'processed' : 'uploaded'
        },
        { onConflict: 'id' }
      );
      if (upsertErr) {
        return res.status(500).json({ success: false, error: 'Nu am putut salva bonul în baza de date.' });
      }
    }

    return res.status(201).json({
      success: true,
      receiptId: receiptUuid,
      validationStatus: validatedReceipt.validationStatus,
      observationsCount: observations.length
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la salvarea bonului.' });
  }
});

// Authenticated personal price history endpoint (strictly user-scoped)
app.get('/api/receipts/personal-history', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
  }

  try {
    const [obsRes, aliasIndex] = await Promise.all([
      auth.userClient
        .from('user_price_observations')
        .select('id,receipt_id,receipt_item_id,product_id,product_name,store_id,store_name,purchase_date,quantity,unit,unit_price,discount,effective_paid_unit_price,total_paid,currency,source_receipt_label')
        .eq('user_id', auth.user.id)
        .order('purchase_date', { ascending: false })
        .limit(300),
      loadServerProductAliasIndex()
    ]);
    const { data, error } = obsRes;

    if (!error && Array.isArray(data)) {
      const normalizedObs = data.map((row: any) => {
        const rawPid = typeof row.product_id === 'string' ? row.product_id.trim() : '';
        if (!rawPid) return row;
        const detail = resolveCanonicalProductDetail(rawPid, aliasIndex);
        if (detail.cycleDetected || (detail.wasAlias && !detail.found)) {
          return { ...row, product_id: null, original_product_id: rawPid };
        }
        if (detail.found && detail.canonicalId && detail.canonicalId !== rawPid) {
          return { ...row, product_id: detail.canonicalId, original_product_id: rawPid };
        }
        return row;
      });
      return res.json({
        success: true,
        source: 'user_price_observations',
        observations: normalizedObs
      });
    }

    // Fallback: derive strictly from user's own confirmed receipts
    const { data: receiptsRows, error: recErr } = await auth.userClient
      .from('receipts')
      .select('id,store_id,merchant_name,purchased_at,total_amount,extracted_data,status,created_at')
      .eq('user_id', auth.user.id)
      .eq('status', 'processed')
      .order('purchased_at', { ascending: false })
      .limit(100);

    if (recErr) {
      return res.status(500).json({ success: false, error: 'Nu am putut încărca istoricul personal de prețuri.' });
    }

    const mappedReceipts: Receipt[] = (receiptsRows || []).map((row: any) => ({
      id: row.id,
      storeId: row.store_id || row.extracted_data?.storeId || 'unknown',
      storeName: row.merchant_name || 'Magazin',
      date: String(row.purchased_at || row.created_at || '').slice(0, 10),
      receiptNumber: row.extracted_data?.receiptNumber || undefined,
      items: Array.isArray(row.extracted_data?.items) ? row.extracted_data.items : [],
      subtotal: Number(row.extracted_data?.subtotal ?? row.total_amount ?? 0),
      discountTotal: Number(row.extracted_data?.discountTotal ?? 0),
      total: Number(row.total_amount ?? 0),
      currency: 'RON',
      createdAt: row.created_at || new Date().toISOString(),
      verifiedStatus: 'confirmed'
    }));

    const derived = mappedReceipts.flatMap(r => buildUserPriceObservations(r, auth.user.id)).map(obs => {
      const rawPid = typeof obs.productId === 'string' ? obs.productId.trim() : '';
      if (!rawPid) return obs;
      const detail = resolveCanonicalProductDetail(rawPid, aliasIndex);
      if (detail.cycleDetected || (detail.wasAlias && !detail.found)) {
        return { ...obs, productId: undefined, originalProductId: rawPid };
      }
      if (detail.found && detail.canonicalId && detail.canonicalId !== rawPid) {
        return { ...obs, productId: detail.canonicalId, originalProductId: rawPid };
      }
      return obs;
    });
    return res.json({
      success: true,
      source: 'receipts_fallback',
      observations: derived
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la citirea istoricului personal.' });
  }
});

// Private signed URL endpoint for receipt images (owner verified)
app.get('/api/receipts/:id/image', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
  }

  const receiptId = req.params.id;
  const { data: row, error } = await auth.userClient
    .from('receipts')
    .select('id,user_id,image_path,extracted_data')
    .eq('id', receiptId)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (error || !row) {
    return res.status(404).json({ success: false, error: 'Bonul nu a fost găsit sau aparține altui utilizator.' });
  }

  const paths: string[] = Array.isArray(row.extracted_data?.imagePaths) && row.extracted_data.imagePaths.length > 0
    ? row.extracted_data.imagePaths
    : row.image_path
      ? [row.image_path]
      : [];

  if (paths.length === 0) {
    return res.status(404).json({ success: false, error: 'Nu există imagini atașate acestui bon.' });
  }

  const ownedPaths = paths.filter(p => typeof p === 'string' && p.startsWith(`${auth.user.id}/`));
  if (ownedPaths.length === 0) {
    return res.status(403).json({ success: false, error: 'Acces interzis la imaginile bonului.' });
  }

  const { data: signedData, error: signErr } = await auth.userClient.storage
    .from('receipt-images')
    .createSignedUrls(ownedPaths, 300);

  if (signErr || !signedData) {
    return res.status(404).json({ success: false, error: 'Imaginile nu sunt disponibile în stocarea privată.' });
  }

  return res.json({
    success: true,
    signedUrls: signedData.map(item => item.signedUrl).filter(Boolean)
  });
});

// Authenticated owner-scoped receipt deletion (cleans up private storage images too)
app.delete('/api/receipts/:id', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
  }

  const receiptId = req.params.id;
  const { data: row } = await auth.userClient
    .from('receipts')
    .select('id,user_id,image_path,extracted_data')
    .eq('id', receiptId)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!row) {
    return res.status(404).json({ success: false, error: 'Bonul nu a fost găsit.' });
  }

  const paths: string[] = Array.isArray(row.extracted_data?.imagePaths)
    ? row.extracted_data.imagePaths
    : row.image_path
      ? [row.image_path]
      : [];
  const ownedPaths = paths.filter(p => typeof p === 'string' && p.startsWith(`${auth.user.id}/`));
  if (ownedPaths.length > 0) {
    await auth.userClient.storage.from('receipt-images').remove(ownedPaths);
  }

  const { error: delErr } = await auth.userClient
    .from('receipts')
    .delete()
    .eq('id', receiptId)
    .eq('user_id', auth.user.id);

  if (delErr) {
    return res.status(500).json({ success: false, error: 'Nu am putut șterge bonul.' });
  }

  return res.json({ success: true });
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

// =========================================================================
// GDPR & Cookie Consent Backend Endpoints (Server-Side Security & RLS)
// =========================================================================

function getSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !serviceRoleKey.trim()) {
    return null;
  }
  return createClient(SUPABASE_URL, serviceRoleKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function hashUserIdForLog(userId: string): string {
  return crypto.createHash('sha256').update(userId).digest('hex');
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Protect spreadsheets from formula injection
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const AUDIT_PII_FORBIDDEN_KEYS = new Set([
  'email',
  'phone',
  'phone_number',
  'first_name',
  'last_name',
  'full_name',
  'display_name',
  'ip',
  'ip_address',
  'user_agent',
  'password',
  'token',
  'cnp'
]);

function sanitizeAuditMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!AUDIT_PII_FORBIDDEN_KEYS.has(k.toLowerCase())) {
      clean[k] = v;
    }
  }
  return clean;
}

async function logGdprOperation(params: {
  operationType:
    | 'consent_recorded'
    | 'data_accessed'
    | 'data_exported'
    | 'data_rectified'
    | 'consent_withdrawn'
    | 'restriction_updated'
    | 'gdpr_request_created'
    | 'gdpr_request_resolved'
    | 'account_deleted';
  userId?: string | null;
  actorType: 'user' | 'admin' | 'anonymous' | 'system';
  status?: 'success' | 'partial' | 'failed';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const adminClient = getSupabaseAdminClient();
  const actorHash = params.userId ? hashUserIdForLog(params.userId) : null;
  const safeMetadata = sanitizeAuditMetadata(params.metadata);
  const status = params.status || 'success';

  if (adminClient) {
    try {
      await adminClient.from('gdpr_operation_logs').insert({
        operation_type: params.operationType,
        user_id_hash: actorHash,
        actor_type: params.actorType,
        status,
        metadata: safeMetadata
      });
    } catch {
      // ignore if migration 011 has not yet been applied
    }

    try {
      await adminClient.from('audit_log').insert({
        action: params.operationType,
        actor_hash: actorHash,
        actor_type: params.actorType,
        resource_type:
          params.operationType === 'account_deleted'
            ? 'account'
            : params.operationType === 'data_exported'
            ? 'gdpr_export'
            : params.operationType === 'consent_recorded' || params.operationType === 'consent_withdrawn'
            ? 'consent'
            : 'gdpr_requests',
        status,
        metadata: safeMetadata
      });
    } catch {
      // ignore if audit_log migration has not yet been applied
    }
  }
}

async function listUserStorageFiles(
  client: SupabaseClient<any, any, any>,
  bucket: string,
  userId: string
): Promise<string[]> {
  try {
    const { data, error } = await client.storage.from(bucket).list(userId, { limit: 200 });
    if (error || !Array.isArray(data)) return [];
    const results: string[] = [];
    for (const entry of data) {
      if (!entry.name) continue;
      if (entry.id) {
        results.push(`${userId}/${entry.name}`);
      } else {
        // Nested folder (e.g., receiptId/page.jpg)
        const { data: nested } = await client.storage
          .from(bucket)
          .list(`${userId}/${entry.name}`, { limit: 100 });
        if (Array.isArray(nested)) {
          for (const sub of nested) {
            if (sub.name) {
              results.push(`${userId}/${entry.name}/${sub.name}`);
            }
          }
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function buildUserGdprDataset(
  userClient: SupabaseClient<any, any, any>,
  user: { id: string; email?: string; created_at?: string }
) {
  const [
    profileRes,
    prefsRes,
    listsRes,
    alertsRes,
    receiptsRes,
    obsRes,
    commRes,
    cookieRes,
    requestsRes,
    receiptFiles,
    avatarFiles
  ] = await Promise.all([
    userClient.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    userClient.from('user_preferences').select('*').eq('user_id', user.id).maybeSingle(),
    userClient
      .from('shopping_lists')
      .select('*, shopping_list_items(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    userClient
      .from('price_alerts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    userClient
      .from('receipts')
      .select('*, receipt_items(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    userClient
      .from('user_price_observations')
      .select('*')
      .eq('user_id', user.id)
      .order('purchase_date', { ascending: false }),
    userClient
      .from('communication_consents')
      .select('*')
      .eq('user_id', user.id)
      .order('recorded_at', { ascending: false }),
    userClient
      .from('cookie_consents')
      .select('id,visitor_session_id,policy_version,banner_version,consent_method,categories,consent_given,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    userClient
      .from('gdpr_requests')
      .select('*')
      .eq('user_id', user.id)
      .order('requested_at', { ascending: false }),
    listUserStorageFiles(userClient, 'receipt-images', user.id),
    listUserStorageFiles(userClient, 'avatars', user.id)
  ]);

  const storageFiles = [
    ...receiptFiles.map(filePath => ({ bucket: 'receipt-images', path: filePath })),
    ...avatarFiles.map(filePath => ({ bucket: 'avatars', path: filePath }))
  ];

  return {
    exportedAt: new Date().toISOString(),
    policyVersion: PRIVACY_POLICY_VERSION,
    operatorNote:
      'Export generat pentru titularul contului din platforma Coșul Meu (operator persoană fizică, România).',
    account: {
      userId: user.id,
      email: user.email,
      createdAt: user.created_at
    },
    profile: profileRes.data || null,
    preferences: prefsRes.data || null,
    shoppingLists: listsRes.data || [],
    priceAlerts: alertsRes.data || [],
    receipts: receiptsRes.data || [],
    priceObservations: obsRes.data || [],
    storageFiles,
    communicationConsents: (commRes.data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      channel: row.channel,
      isGranted: Boolean(row.is_granted),
      consentTextVersion: row.consent_text_version,
      source: row.source,
      recordedAt: row.recorded_at
    })),
    cookieConsents: cookieRes.data || [],
    gdprRequests: (requestsRes.data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      requestType: row.request_type,
      status: row.status,
      details: row.details,
      requestedFormat: row.requested_format,
      requestedAt: row.requested_at,
      resolvedAt: row.resolved_at,
      adminResponse: row.admin_response
    }))
  };
}

function isMissingRelationError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

export interface GdprAccountDeletionSummary {
  receiptImagesDeleted: number;
  avatarFilesDeleted: number;
  tablesCleaned: string[];
  failedTables: Array<{ table: string; error: string }>;
  storageErrors: Array<{ bucket: string; error: string }>;
  retainedComplianceProofs: string[];
  authUserDeleted: boolean;
  completedFully: boolean;
  partialFailure: boolean;
  remediationSteps: string[];
  remediationRequestId?: string | null;
  warning?: string;
}

async function executeGdprAccountDeletion(params: {
  userId: string;
  cleanupClient: SupabaseClient<any, any, any>;
  adminClient: SupabaseClient<any, any, any> | null;
  reason?: string | null;
}): Promise<{ summary: GdprAccountDeletionSummary }> {
  const { userId, cleanupClient, adminClient } = params;
  const summary: GdprAccountDeletionSummary = {
    receiptImagesDeleted: 0,
    avatarFilesDeleted: 0,
    tablesCleaned: [],
    failedTables: [],
    storageErrors: [],
    retainedComplianceProofs: [
      'audit_log / gdpr_operation_logs (exclusiv hash SHA-256 al operațiunii, fără PII)',
      'cookie_consents (pseudonimizat cu user_id = NULL când tabelul este aplicat și service_role este activ)'
    ],
    authUserDeleted: false,
    completedFully: false,
    partialFailure: false,
    remediationSteps: []
  };

  // 1. Delete private receipt images & avatars, recording any storage errors
  for (const bucket of ['receipt-images', 'avatars'] as const) {
    try {
      const files = await listUserStorageFiles(cleanupClient, bucket, userId);
      if (files.length > 0) {
        const { error: removeErr } = await cleanupClient.storage.from(bucket).remove(files);
        if (removeErr) {
          summary.storageErrors.push({ bucket, error: removeErr.message || 'Eroare ștergere fișiere Storage' });
        } else if (bucket === 'receipt-images') {
          summary.receiptImagesDeleted = files.length;
        } else {
          summary.avatarFilesDeleted = files.length;
        }
      }
    } catch (err: any) {
      summary.storageErrors.push({ bucket, error: err?.message || 'Excepție ștergere Storage' });
    }
  }

  // 2. Delete user-owned rows cleanly (children first) with explicit error checking
  try {
    const { data: userLists, error: listsSelectErr } = await cleanupClient
      .from('shopping_lists')
      .select('id')
      .eq('user_id', userId);
    if (listsSelectErr && !isMissingRelationError(listsSelectErr)) {
      summary.failedTables.push({ table: 'shopping_lists', error: listsSelectErr.message });
    } else if (Array.isArray(userLists) && userLists.length > 0) {
      const { error: itemsDelErr } = await cleanupClient
        .from('shopping_list_items')
        .delete()
        .in('list_id', userLists.map((l: any) => l.id));
      if (itemsDelErr && !isMissingRelationError(itemsDelErr)) {
        summary.failedTables.push({ table: 'shopping_list_items', error: itemsDelErr.message });
      } else {
        summary.tablesCleaned.push('shopping_list_items');
      }
    }
  } catch (err: any) {
    summary.failedTables.push({ table: 'shopping_list_items', error: err?.message || 'Eroare ștergere articole liste' });
  }

  for (const table of [
    'shopping_lists',
    'price_alerts',
    'user_price_observations',
    'receipt_items',
    'receipts',
    'communication_consents',
    'gdpr_requests',
    'user_preferences'
  ]) {
    try {
      const { error: delErr } = await cleanupClient.from(table).delete().eq('user_id', userId);
      if (!delErr) {
        summary.tablesCleaned.push(table);
      } else if (!isMissingRelationError(delErr)) {
        summary.failedTables.push({ table, error: delErr.message });
      }
    } catch (err: any) {
      summary.failedTables.push({ table, error: err?.message || 'Eroare ștergere tabel' });
    }
  }

  // 3. Keep cookie consent proof pseudonymized (unlink user_id) via service_role when present
  if (adminClient) {
    try {
      const { error: ccErr } = await adminClient
        .from('cookie_consents')
        .update({ user_id: null })
        .eq('user_id', userId);
      if (ccErr && !isMissingRelationError(ccErr)) {
        summary.failedTables.push({ table: 'cookie_consents', error: ccErr.message });
      }
    } catch (err: any) {
      summary.failedTables.push({ table: 'cookie_consents', error: err?.message || 'Eroare pseudonimizare cookie_consents' });
    }
  }

  // 4. Delete profile row
  try {
    const { error: profDelErr } = await cleanupClient.from('profiles').delete().eq('id', userId);
    if (!profDelErr) {
      summary.tablesCleaned.push('profiles');
    } else if (!isMissingRelationError(profDelErr)) {
      summary.failedTables.push({ table: 'profiles', error: profDelErr.message });
    }
  } catch (err: any) {
    summary.failedTables.push({ table: 'profiles', error: err?.message || 'Eroare ștergere profiles' });
  }

  // 5. Delete Supabase Auth account (requires service_role)
  if (adminClient) {
    try {
      const { error: deleteUserErr } = await adminClient.auth.admin.deleteUser(userId);
      if (!deleteUserErr) {
        summary.authUserDeleted = true;
      } else {
        summary.remediationSteps.push(
          `Ștergerea contului din Supabase Auth a eșuat (${deleteUserErr.message}). Reîncearcă sau solicită intervenția operatorului.`
        );
      }
    } catch (err: any) {
      summary.remediationSteps.push(
        `Eroare neașteptată la ștergerea Supabase Auth (${err?.message || 'necunoscută'}).`
      );
    }
  } else {
    summary.remediationSteps.push(
      'Cheia server-side SUPABASE_SERVICE_ROLE_KEY nu este configurată în acest mediu; ștergerea înregistrării din Supabase Auth necesită configurarea cheii în Vercel sau intervenția manuală a operatorului.'
    );
  }

  if (summary.storageErrors.length > 0) {
    summary.remediationSteps.push(
      `Fișiere Storage neșterse în bucket-urile: ${summary.storageErrors.map(s => s.bucket).join(', ')}. Reîncearcă ștergerea din panoul de administrare Supabase Storage.`
    );
  }

  if (summary.failedTables.length > 0) {
    summary.remediationSteps.push(
      `Tabele cu erori la ștergere: ${summary.failedTables.map(f => f.table).join(', ')}. Verifică politicile RLS sau conexiunea la baza de date și reîncearcă.`
    );
  }

  summary.completedFully =
    summary.failedTables.length === 0 &&
    summary.storageErrors.length === 0 &&
    summary.authUserDeleted;
  summary.partialFailure = !summary.completedFully;

  if (summary.partialFailure) {
    summary.warning = summary.authUserDeleted
      ? 'Contul Auth a fost șters, dar au existat erori parțiale la curățarea unor tabele sau fișiere.'
      : 'Datele aplicației au fost curățate parțial/integral, dar contul de autentificare (auth.users) sau unele resurse necesită remediere suplimentară.';

    // Create a fallback tracking request if Auth user still exists so operator can complete Art. 17 erasure
    if (!summary.authUserDeleted) {
      try {
        const ticketClient = adminClient || cleanupClient;
        const { data: ticketRow } = await ticketClient
          .from('gdpr_requests')
          .insert({
            user_id: userId,
            request_type: 'erasure_account',
            status: 'in_verificare',
            details: `Ștergere parțială în așteptare finalizare (Auth=${summary.authUserDeleted}; erori tabele=${summary.failedTables.length}; erori storage=${summary.storageErrors.length}).`
          })
          .select('id')
          .maybeSingle();
        if (ticketRow?.id) {
          summary.remediationRequestId = ticketRow.id;
        }
      } catch {
        // non-blocking if gdpr_requests table not yet applied
      }
    }
  }

  await logGdprOperation({
    operationType: 'account_deleted',
    userId,
    actorType: 'user',
    status: summary.completedFully ? 'success' : 'partial',
    metadata: {
      receiptImagesDeleted: summary.receiptImagesDeleted,
      avatarFilesDeleted: summary.avatarFilesDeleted,
      tablesCleanedCount: summary.tablesCleaned.length,
      failedTablesCount: summary.failedTables.length,
      storageErrorsCount: summary.storageErrors.length,
      authUserDeleted: summary.authUserDeleted,
      completedFully: summary.completedFully
    }
  });

  return { summary };
}

// 1. Cookie Consent Proof Endpoint (public or authenticated)
app.post('/api/gdpr/consent', publicReportLimiter, async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const parsed = gdprConsentRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Date invalide pentru consimțământ cookie.'
    });
  }

  const auth = await getAuthenticatedSupabaseUser(req);
  const input = parsed.data;
  const client = auth ? auth.userClient : supabase;
  let persistedInDb = false;

  try {
    const { error: insertErr } = await client.from('cookie_consents').insert({
      user_id: auth ? auth.user.id : null,
      visitor_session_id: input.visitorSessionId,
      policy_version: input.policyVersion,
      banner_version: input.bannerVersion,
      consent_method: input.consentMethod,
      categories: input.categories,
      consent_given: true,
      user_agent_summary: String(req.headers['user-agent'] || '').slice(0, 180) || null
    });
    if (!insertErr) {
      persistedInDb = true;
    }

    if (auth) {
      await auth.userClient
        .from('user_preferences')
        .upsert(
          {
            user_id: auth.user.id,
            cookie_consent_version: input.policyVersion,
            cookie_preferences: input.categories,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );
    }
  } catch {
    persistedInDb = false;
  }

  await logGdprOperation({
    operationType: input.consentMethod === 'withdrawal' ? 'consent_withdrawn' : 'consent_recorded',
    userId: auth?.user.id || null,
    actorType: auth ? 'user' : 'anonymous',
    status: persistedInDb ? 'success' : 'partial',
    metadata: {
      policyVersion: input.policyVersion,
      consentMethod: input.consentMethod,
      categories: input.categories
    }
  });

  return res.json({
    success: true,
    persistedInDb,
    consent: {
      visitorSessionId: input.visitorSessionId,
      policyVersion: input.policyVersion,
      bannerVersion: input.bannerVersion,
      consentMethod: input.consentMethod,
      categories: input.categories
    }
  });
});

// 2. Read strictly own GDPR personal data summary (Auth required)
app.get('/api/gdpr/my-data', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară pentru consultarea datelor personale.' });
  }

  try {
    const dataset = await buildUserGdprDataset(auth.userClient, auth.user);
    await logGdprOperation({
      operationType: 'data_accessed',
      userId: auth.user.id,
      actorType: 'user',
      status: 'success'
    });
    return res.json({ success: true, data: dataset });
  } catch {
    return res.status(500).json({ success: false, error: 'Nu am putut prelua datele personale ale contului.' });
  }
});

// 3. Rectify own profile, contact details, communication preferences or restriction flag
app.patch('/api/gdpr/profile', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
  }

  const parsed = gdprProfileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Date invalide pentru actualizarea profilului.'
    });
  }

  const input = parsed.data;
  const now = new Date().toISOString();
  const profilePatch: Record<string, unknown> = { updated_at: now };

  if (input.firstName !== undefined) profilePatch.first_name = input.firstName || null;
  if (input.lastName !== undefined) profilePatch.last_name = input.lastName || null;
  if (input.displayName !== undefined) {
    profilePatch.display_name = input.displayName || null;
  } else if (input.firstName !== undefined || input.lastName !== undefined) {
    const combined = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
    if (combined) profilePatch.display_name = combined;
  }
  if (input.phone !== undefined) profilePatch.phone = input.phone || null;
  if (input.city !== undefined) profilePatch.city = input.city || 'București';
  if (input.preferredLanguage !== undefined) profilePatch.preferred_language = input.preferredLanguage;
  if (input.restrictionRequested !== undefined) {
    profilePatch.restriction_requested = input.restrictionRequested;
    profilePatch.restriction_reason = input.restrictionReason || null;
    profilePatch.restriction_updated_at = now;
  }

  const { error: profErr } = await auth.userClient
    .from('profiles')
    .update(profilePatch)
    .eq('id', auth.user.id);

  if (profErr) {
    return res.status(500).json({ success: false, error: 'Nu am putut actualiza profilul.' });
  }

  let emailChangePendingConfirmation = false;
  if (input.email && input.email.toLowerCase() !== (auth.user.email || '').toLowerCase()) {
    const { error: emailErr } = await auth.userClient.auth.updateUser({ email: input.email });
    if (emailErr) {
      return res.status(400).json({
        success: false,
        error: emailErr.message || 'Nu am putut iniția modificarea adresei de email.'
      });
    }
    emailChangePendingConfirmation = true;
  }

  const prefPatch: Record<string, unknown> = { user_id: auth.user.id, updated_at: now };
  let hasPrefUpdates = false;
  const commInserts: Array<Record<string, unknown>> = [];

  if (input.optionalNotificationsEnabled !== undefined) {
    prefPatch.optional_notifications_enabled = input.optionalNotificationsEnabled;
    hasPrefUpdates = true;
    commInserts.push({
      user_id: auth.user.id,
      channel: 'optional_notifications',
      is_granted: input.optionalNotificationsEnabled,
      consent_text_version: MARKETING_CONSENT_TEXT_VERSION,
      source: 'gdpr_center'
    });
  }

  if (input.marketingConsent !== undefined) {
    prefPatch.marketing_consent = input.marketingConsent;
    prefPatch.marketing_consent_updated_at = now;
    if (!input.marketingConsent) {
      prefPatch.marketing_consent_withdrawn_at = now;
    }
    hasPrefUpdates = true;
    commInserts.push({
      user_id: auth.user.id,
      channel: 'email_marketing',
      is_granted: input.marketingConsent,
      consent_text_version: MARKETING_CONSENT_TEXT_VERSION,
      source: input.marketingConsent ? 'gdpr_center' : 'withdrawal'
    });
  }

  if (hasPrefUpdates) {
    await auth.userClient.from('user_preferences').upsert(prefPatch, { onConflict: 'user_id' });
  }
  if (commInserts.length > 0) {
    try {
      await auth.userClient.from('communication_consents').insert(commInserts);
    } catch {
      // ignore if table not yet created
    }
  }

  const profileFieldsUpdated = Object.keys(profilePatch).filter(k => k !== 'updated_at');
  const withdrawnChannels: string[] = [];
  if (input.marketingConsent === false) withdrawnChannels.push('email_marketing');
  if (input.optionalNotificationsEnabled === false) withdrawnChannels.push('optional_notifications');

  if (withdrawnChannels.length > 0) {
    await logGdprOperation({
      operationType: 'consent_withdrawn',
      userId: auth.user.id,
      actorType: 'user',
      status: 'success',
      metadata: { channels: withdrawnChannels, source: 'gdpr_profile_patch' }
    });
  }

  if (input.restrictionRequested !== undefined || profileFieldsUpdated.length > 0 || emailChangePendingConfirmation) {
    await logGdprOperation({
      operationType: input.restrictionRequested !== undefined ? 'restriction_updated' : 'data_rectified',
      userId: auth.user.id,
      actorType: 'user',
      status: 'success',
      metadata: {
        fieldsUpdated: profileFieldsUpdated,
        emailChangePendingConfirmation
      }
    });
  }

  return res.json({
    success: true,
    emailChangePendingConfirmation,
    message: emailChangePendingConfirmation
      ? 'Datele au fost actualizate. Verifică noua adresă de email pentru confirmarea schimbării.'
      : 'Datele personale au fost actualizate cu succes.'
  });
});

// 4. Export own GDPR data in JSON or CSV (Auth required)
app.get('/api/gdpr/export', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară pentru exportul datelor.' });
  }

  const format = String(req.query.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';

  try {
    const dataset = await buildUserGdprDataset(auth.userClient, auth.user);
    try {
      await auth.userClient.from('gdpr_requests').insert({
        user_id: auth.user.id,
        request_type: 'export_data',
        status: 'procesata',
        requested_format: format,
        details: `Export automat generat de utilizator (${format.toUpperCase()}).`,
        resolved_at: new Date().toISOString()
      });
    } catch {
      // non-blocking audit
    }

    await logGdprOperation({
      operationType: 'data_exported',
      userId: auth.user.id,
      actorType: 'user',
      status: 'success',
      metadata: { format }
    });

    if (format === 'csv') {
      const rows: string[][] = [['Categorie', 'Identificator', 'Data', 'Detalii']];
      rows.push(['Cont', dataset.account.userId, dataset.account.createdAt || '', dataset.account.email || '']);
      if (dataset.profile) {
        rows.push([
          'Profil',
          String(dataset.profile.id || ''),
          String(dataset.profile.updated_at || ''),
          JSON.stringify({
            firstName: dataset.profile.first_name,
            lastName: dataset.profile.last_name,
            displayName: dataset.profile.display_name,
            phone: dataset.profile.phone,
            city: dataset.profile.city
          })
        ]);
      }
      if (dataset.preferences) {
        rows.push(['Preferinte', String(dataset.preferences.user_id || ''), String(dataset.preferences.updated_at || ''), JSON.stringify(dataset.preferences)]);
      }
      for (const l of dataset.shoppingLists) {
        rows.push(['ListaCumparaturi', String(l.id || ''), String(l.created_at || ''), `${l.name || ''} (${Array.isArray(l.shopping_list_items) ? l.shopping_list_items.length : 0} articole)`]);
      }
      for (const a of dataset.priceAlerts) {
        rows.push(['AlertaPret', String(a.id || ''), String(a.created_at || ''), `${a.product_name || ''}: tinta ${a.target_price || ''}`]);
      }
      for (const r of dataset.receipts) {
        rows.push(['BonFiscal', String(r.id || ''), String(r.purchase_date || r.created_at || ''), `${r.store_name || ''} | Total ${r.total_amount || 0} RON`]);
      }
      for (const o of dataset.priceObservations) {
        rows.push(['ObservatiePret', String(o.id || ''), String(o.purchase_date || ''), `${o.product_name || ''} (${o.store_name || ''}): ${o.effective_paid_unit_price || 0} RON`]);
      }
      for (const c of dataset.communicationConsents) {
        rows.push(['ConsimtamantComunicari', c.id, c.recordedAt, `${c.channel}=${c.isGranted} (${c.source})`]);
      }
      for (const ck of dataset.cookieConsents) {
        rows.push(['ConsimtamantCookie', String(ck.id || ''), String(ck.created_at || ''), JSON.stringify(ck.categories)]);
      }
      for (const gr of dataset.gdprRequests) {
        rows.push(['SolicitareGDPR', gr.id, gr.requestedAt, `${gr.requestType} | status=${gr.status}`]);
      }

      const csvBody = '\uFEFF' + rows.map(line => line.map(escapeCsvCell).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cosul-meu-date-personale-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(csvBody);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cosul-meu-date-personale-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.send(JSON.stringify(dataset, null, 2));
  } catch {
    return res.status(500).json({ success: false, error: 'Exportul datelor personale a eșuat.' });
  }
});

// 5. List & Submit own GDPR Requests (Auth required, strictly isolated to auth.user.id)
app.get('/api/gdpr/requests', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
  }

  const { data, error } = await auth.userClient
    .from('gdpr_requests')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('requested_at', { ascending: false });

  if (error) {
    return res.status(500).json({ success: false, error: 'Nu am putut încărca istoricul solicitărilor GDPR.' });
  }

  return res.json({
    success: true,
    requests: (data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      requestType: row.request_type,
      status: row.status,
      details: row.details,
      requestedFormat: row.requested_format,
      requestedAt: row.requested_at,
      resolvedAt: row.resolved_at,
      adminResponse: row.admin_response
    }))
  });
});

app.post('/api/gdpr/requests', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
  }

  const parsed = gdprRequestCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Date invalide pentru solicitarea GDPR.'
    });
  }

  const input = parsed.data;
  const { data, error } = await auth.userClient
    .from('gdpr_requests')
    .insert({
      user_id: auth.user.id,
      request_type: input.requestType,
      status: 'noua',
      details: input.details || null,
      requested_format: input.requestedFormat || null
    })
    .select('*')
    .single();

  if (error || !data) {
    return res.status(500).json({ success: false, error: 'Nu am putut înregistra solicitarea GDPR.' });
  }

  if (input.requestType === 'restriction_processing') {
    await auth.userClient
      .from('profiles')
      .update({
        restriction_requested: true,
        restriction_reason: input.details || 'Solicitare restricționare prelucrare GDPR',
        restriction_updated_at: new Date().toISOString()
      })
      .eq('id', auth.user.id);
  }

  await logGdprOperation({
    operationType: 'gdpr_request_created',
    userId: auth.user.id,
    actorType: 'user',
    status: 'success',
    metadata: { requestType: input.requestType }
  });

  return res.status(201).json({
    success: true,
    request: {
      id: data.id,
      userId: data.user_id,
      requestType: data.request_type,
      status: data.status,
      details: data.details,
      requestedFormat: data.requested_format,
      requestedAt: data.requested_at,
      resolvedAt: data.resolved_at,
      adminResponse: data.admin_response
    }
  });
});

// 6. Withdraw optional consents (Auth required)
app.post('/api/gdpr/withdraw-consents', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
  }

  const parsed = gdprWithdrawConsentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Selectează cel puțin un canal pentru retragere.'
    });
  }

  const channels = parsed.data.channels;
  const now = new Date().toISOString();
  const prefPatch: Record<string, unknown> = { user_id: auth.user.id, updated_at: now };
  const commRows: Array<Record<string, unknown>> = [];

  if (channels.includes('email_marketing')) {
    prefPatch.marketing_consent = false;
    prefPatch.marketing_consent_withdrawn_at = now;
    commRows.push({
      user_id: auth.user.id,
      channel: 'email_marketing',
      is_granted: false,
      consent_text_version: MARKETING_CONSENT_TEXT_VERSION,
      source: 'withdrawal'
    });
  }
  if (channels.includes('optional_notifications')) {
    prefPatch.optional_notifications_enabled = false;
    commRows.push({
      user_id: auth.user.id,
      channel: 'optional_notifications',
      is_granted: false,
      consent_text_version: MARKETING_CONSENT_TEXT_VERSION,
      source: 'withdrawal'
    });
  }
  if (channels.includes('price_alerts')) {
    prefPatch.price_alerts_enabled = false;
    commRows.push({
      user_id: auth.user.id,
      channel: 'price_alerts',
      is_granted: false,
      consent_text_version: MARKETING_CONSENT_TEXT_VERSION,
      source: 'withdrawal'
    });
  }
  if (channels.includes('cookies_optional')) {
    prefPatch.cookie_preferences = {
      necessary: true,
      preferences: false,
      analytics: false,
      marketing: false
    };
  }

  await auth.userClient.from('user_preferences').upsert(prefPatch, { onConflict: 'user_id' });
  if (commRows.length > 0) {
    try {
      await auth.userClient.from('communication_consents').insert(commRows);
    } catch {
      // ignore if table missing
    }
  }

  await logGdprOperation({
    operationType: 'consent_withdrawn',
    userId: auth.user.id,
    actorType: 'user',
    status: 'success',
    metadata: { channels }
  });

  return res.json({
    success: true,
    withdrawnChannels: channels,
    message: 'Consimțământul pentru categoriile selectate a fost retras.'
  });
});

// 7. Permanent Account Deletion („Șterge contul”) with reauthentication & private storage cleanup
app.post('/api/gdpr/delete-account', async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const auth = await getAuthenticatedSupabaseUser(req);
  if (!auth) {
    return res.status(401).json({ success: false, error: 'Autentificare necesară pentru ștergerea contului.' });
  }

  const parsed = gdprDeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Confirmare invalidă pentru ștergerea contului.'
    });
  }

  const identities = Array.isArray(auth.user.identities) ? auth.user.identities : [];
  const hasPasswordIdentity =
    identities.some((id: any) => id?.provider === 'email') ||
    auth.user.app_metadata?.provider === 'email';

  if (hasPasswordIdentity && auth.user.email) {
    if (!parsed.data.password) {
      return res.status(403).json({
        success: false,
        code: 'REAUTH_REQUIRED',
        error: 'Pentru siguranță, introdu parola curentă a contului pentru a confirma ștergerea.'
      });
    }
    const verifyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error: reauthErr } = await verifyClient.auth.signInWithPassword({
      email: auth.user.email,
      password: parsed.data.password
    });
    if (reauthErr) {
      return res.status(403).json({
        success: false,
        code: 'REAUTH_FAILED',
        error: 'Parola curentă este incorectă. Ștergerea contului a fost blocată.'
      });
    }
  }

  const userId = auth.user.id;
  const adminClient = getSupabaseAdminClient();
  const cleanupClient = adminClient || auth.userClient;

  const deletionResult = await executeGdprAccountDeletion({
    userId,
    cleanupClient,
    adminClient,
    reason: parsed.data.reason || null
  });

  if (!deletionResult.summary.completedFully) {
    return res.status(207).json({
      success: false,
      partialFailure: true,
      completedFully: false,
      summary: deletionResult.summary,
      error:
        deletionResult.summary.warning ||
        'Ștergerea contului a fost executată doar parțial. Consultă pașii de remediere de mai jos.',
      message:
        'Ștergere parțială: unele date sau înregistrarea din Auth nu au putut fi eliminate complet.'
    });
  }

  return res.json({
    success: true,
    partialFailure: false,
    completedFully: true,
    summary: deletionResult.summary,
    message: 'Contul și toate datele personale asociate au fost șterse definitiv.'
  });
});

// 8. Admin / Operator GDPR Requests Management (protected by requireAdminAuth)
app.get('/api/admin/gdpr/requests', requireAdminAuth, async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return res.status(503).json({
      success: false,
      error: 'SUPABASE_SERVICE_ROLE_KEY nu este configurat pe server pentru listarea solicitărilor GDPR.',
      requests: []
    });
  }

  const { data, error } = await adminClient
    .from('gdpr_requests')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(200);

  if (error) {
    return res.status(500).json({ success: false, error: 'Nu am putut citi solicitările GDPR.' });
  }

  return res.json({
    success: true,
    requests: (data || []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      requestType: row.request_type,
      status: row.status,
      details: row.details,
      requestedFormat: row.requested_format,
      requestedAt: row.requested_at,
      resolvedAt: row.resolved_at,
      adminResponse: row.admin_response
    }))
  });
});

app.patch('/api/admin/gdpr/requests/:id', requireAdminAuth, async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return res.status(503).json({
      success: false,
      error: 'SUPABASE_SERVICE_ROLE_KEY nu este configurat pe server.'
    });
  }

  const parsed = gdprAdminRequestUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Date invalide pentru actualizarea solicitării GDPR.'
    });
  }

  const isResolved = parsed.data.status === 'procesata' || parsed.data.status === 'respinsa_justificat';
  const now = new Date().toISOString();

  const { data, error } = await adminClient
    .from('gdpr_requests')
    .update({
      status: parsed.data.status,
      admin_response: parsed.data.adminResponse || null,
      resolved_at: isResolved ? now : null,
      updated_at: now
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ success: false, error: 'Solicitarea GDPR nu a fost găsită.' });
  }

  await logGdprOperation({
    operationType: 'gdpr_request_resolved',
    userId: data.user_id,
    actorType: 'admin',
    status: 'success',
    metadata: { requestId: data.id, newStatus: parsed.data.status }
  });

  return res.json({
    success: true,
    request: {
      id: data.id,
      userId: data.user_id,
      requestType: data.request_type,
      status: data.status,
      details: data.details,
      requestedFormat: data.requested_format,
      requestedAt: data.requested_at,
      resolvedAt: data.resolved_at,
      adminResponse: data.admin_response
    }
  });
});

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

// Secure Image Proxy endpoint (previne SSRF, blochează SVG/MIME nevalid și limitează dimensiunea în streaming)
app.get('/api/images/proxy', async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      return res.status(400).json({ error: 'Parametrul url este obligatoriu.' });
    }
    if (rawUrl.length > 2048) {
      return res.status(400).json({ error: 'URL-ul imaginii depășește lungimea maximă permisă.' });
    }

    const safety = CatalogDownloader.validatePublicUrlSafety(rawUrl);
    if (!safety.safe) {
      return res.status(400).json({ error: safety.reason || 'URL imagine nesigur sau nepermis.' });
    }

    const imgResult = await CatalogDownloader.downloadImageSafely(rawUrl, {
      maxBytes: CatalogDownloader.MAX_IMAGE_SIZE_BYTES,
      timeoutMs: 10000,
      maxRedirects: 3
    });

    if (!imgResult.ok || !imgResult.data) {
      const statusMap: Record<string, number> = {
        SSRF_BLOCKED: 403,
        SIZE_EXCEEDED: 413,
        INVALID_MIME: 415,
        TIMEOUT: 504
      };
      const status = (imgResult.errorCode && statusMap[imgResult.errorCode]) || 502;
      return res.status(status).json({
        error: imgResult.error || 'Imaginea nu a putut fi preluată în siguranță.'
      });
    }

    res.setHeader('Content-Type', imgResult.contentType || 'image/jpeg');
    res.setHeader('Content-Length', String(imgResult.data.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(imgResult.data);
  } catch {
    return res.status(502).json({ error: 'Eroare la procesarea proxy-ului de imagini.' });
  }
});

async function loadServerProductAliasIndex(): Promise<CanonicalAliasIndex> {
  const dbIndex = await DatabaseService.getProductAliasIndex();
  if (dbIndex.parentById.size > 0 || isPostgresConfigured() || process.env.COSUL_MEU_ISOLATED_TEST === '1') {
    return dbIndex;
  }
  return buildCanonicalAliasIndex(StorageService.getAllProducts());
}

async function loadServerProductAliasMap(): Promise<Map<string, string>> {
  const dbMap = await DatabaseService.getProductAliasMap();
  if (dbMap.size > 0 || isPostgresConfigured() || process.env.COSUL_MEU_ISOLATED_TEST === '1') {
    return dbMap;
  }
  const allLocal = StorageService.getAllProducts();
  const idx = buildCanonicalAliasIndex(allLocal);
  const out = new Map<string, string>();
  for (const prod of allLocal) {
    if (!prod.canonicalProductId) continue;
    const resolved = resolveCanonicalProductId(prod.id, idx);
    if (resolved && resolved !== prod.id) {
      out.set(prod.id, resolved);
    }
  }
  return out;
}

// Catalog Products endpoint
app.get('/api/catalog/products', async (req, res) => {
  try {
    const products = await DatabaseService.getProducts();
    res.json({ success: true, count: products.length, products });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea produselor din catalog.' });
  }
});

// Canonical product alias map endpoint (aliasProductId -> canonicalRootProductId)
app.get('/api/catalog/aliases', async (_req, res) => {
  try {
    const aliasMap = await loadServerProductAliasMap();
    res.json({
      success: true,
      count: aliasMap.size,
      aliases: Object.fromEntries(aliasMap.entries())
    });
  } catch {
    res.status(500).json({ error: 'Eroare la preluarea mapării canonice de produse.' });
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

// Price History per Product endpoint (strict 30 / 90 / 180 / 365 day interval filtering)
app.get('/api/catalog/history/:productId', async (req, res) => {
  try {
    const queryCheck = priceHistoryQuerySchema.safeParse(req.query);
    if (!queryCheck.success) {
      return res.status(400).json({
        success: false,
        error: queryCheck.error.issues[0]?.message || 'Interval invalid. Acceptat: 30, 90, 180 sau 365.'
      });
    }
    const intervalDays = queryCheck.data.days;
    const requestedProductId = req.params.productId;
    const aliasIndex = await loadServerProductAliasIndex();
    const detail = resolveCanonicalProductDetail(requestedProductId, aliasIndex);
    if (detail.cycleDetected) {
      return res.status(400).json({
        success: false,
        error: 'Identificator de produs invalid (ciclu canonic sau lanț de aliasuri peste limită).'
      });
    }
    if (detail.wasAlias && !detail.found) {
      return res.status(400).json({
        success: false,
        error: 'Identificator de produs invalid (alias orfan fără produs canonic rădăcină).'
      });
    }
    if (!detail.found || !detail.canonicalId) {
      return res.status(404).json({
        success: false,
        error: 'Produsul solicitat nu a fost găsit în catalog.'
      });
    }

    const canonicalProductId = detail.canonicalId;
    const equivalentIds = new Set(collectProductIdsForCanonical(canonicalProductId, aliasIndex));
    equivalentIds.add(canonicalProductId);

    const [observations, offers, stores] = isPostgresConfigured()
      ? await Promise.all([
          DatabaseService.getPriceObservations(canonicalProductId),
          DatabaseService.getOffers(),
          DatabaseService.getStores()
        ])
      : [
          StorageService.getPriceObservations().filter(o => equivalentIds.has(o.productId)),
          StorageService.getProductOffers(),
          STORES
        ];

    const normalizedStoresMap = new Map<string, string>();
    for (const s of stores) {
      const k = (s.id || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
      if (k) normalizedStoresMap.set(k, s.name);
      if (s.slug) normalizedStoresMap.set(s.slug.toLowerCase(), s.name);
    }

    const fullStats = PriceHistoryService.getProductPriceStats(canonicalProductId, {
      observations,
      offers,
      stores,
      aliasMap: aliasIndex
    });
    const filteredPoints = PriceHistoryService.filterPointsByDays(fullStats.historyPoints, intervalDays);
    const activeIntervalStats = fullStats.intervalStats[intervalDays];
    const cutoffMs = Date.now() - intervalDays * 24 * 60 * 60 * 1000;
    const realFilteredObservations = observations
      .reduce<Array<typeof observations[number] & { storeName: string }>>((acc, o) => {
        if (!o || !Number.isFinite(o.price) || o.price <= 0) return acc;
        if (o.source === 'demo' || o.source === 'estimated') return acc;
        const obsDetail = resolveCanonicalProductDetail(o.productId, aliasIndex);
        if (obsDetail.cycleDetected || !obsDetail.found || !obsDetail.canonicalId) {
          return acc;
        }
        const ts = new Date(o.date.length === 10 ? `${o.date}T12:00:00Z` : o.date).getTime();
        if (!Number.isFinite(ts) || ts < cutoffMs || ts > Date.now() + 24 * 60 * 60 * 1000) {
          return acc;
        }
        const key = (o.storeId || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
        acc.push({
          ...o,
          productId: obsDetail.canonicalId,
          storeName: normalizedStoresMap.get(key) || o.storeId
        });
        return acc;
      }, []);

    res.json({
      success: true,
      productId: canonicalProductId,
      requestedProductId: req.params.productId,
      intervalDays,
      count: filteredPoints.length,
      totalObservationsCount: fullStats.observationsCount,
      currentLowestPrice: fullStats.currentLowestPrice,
      currentLowestStoreName: fullStats.currentLowestStoreName,
      hasSufficientHistory: activeIntervalStats.hasSufficientHistory,
      intervalStats: activeIntervalStats,
      allIntervalStats: fullStats.intervalStats,
      points: filteredPoints,
      observations: realFilteredObservations
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la preluarea istoricului de preț.' });
  }
});

// Server-side Basket Comparison endpoint
app.post('/api/catalog/compare', publicComputeLimiter, async (req, res) => {
  try {
    const { items = [], options = {} } = req.body || {};
    const [aliasMap, catalogPair] = await Promise.all([
      loadServerProductAliasIndex(),
      isPostgresConfigured()
        ? Promise.all([DatabaseService.getProducts(), DatabaseService.getOffers(), DatabaseService.getStores()])
        : Promise.resolve([StorageService.getAllProducts(), StorageService.getProductOffers(), STORES] as const)
    ]);
    const [allProducts, allOffers, allStores] = catalogPair;
    const normalizedOptions = {
      useLoyaltyCards: typeof options?.useLoyaltyCards === 'boolean' ? options.useLoyaltyCards : true,
      useCoupons: typeof options?.useCoupons === 'boolean' ? options.useCoupons : false,
      region: typeof options?.region === 'string' && options.region.trim() ? options.region.trim() : undefined,
      includeStaleOffers: typeof options?.includeStaleOffers === 'boolean' ? options.includeStaleOffers : true,
      maxOfferAgeDays:
        typeof options?.maxOfferAgeDays === 'number' && Number.isFinite(options.maxOfferAgeDays)
          ? options.maxOfferAgeDays
          : undefined,
      aliasMap
    };
    const comparisons = PriceComparisonService.compareBasketAcrossStores(
      items,
      normalizedOptions,
      allProducts,
      allOffers,
      allStores
    );
    const savingsSummary = PriceComparisonService.getPotentialSavingsForList(
      items,
      normalizedOptions,
      allProducts,
      allOffers,
      allStores
    );
    res.json({ success: true, comparisons, savingsSummary });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la calculul comparativ al coșului.' });
  }
});

const UUID_STRICT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Helper intern: încarcă articolele unei liste salvate verificând strict ownership-ul și membership-ul partajat (V2)
async function loadOwnedShoppingListItemsForOptimization(params: {
  auth: { user: { id: string; email?: string }; userClient: SupabaseClient };
  listId: string;
}): Promise<{ ok: true; listName: string; items: any[] } | { ok: false; status: number; error: string }> {
  const { auth, listId } = params;
  const access = await resolveSharedListRoleAndMeta({ auth, listId });
  if (access.ok === false) {
    return access;
  }

  const client = getSupabaseAdminClient() || auth.userClient;
  const { data: itemRows, error: itemsErr } = await client
    .from('shopping_list_items')
    .select('id, list_id, product_id, product_name, quantity, unit, notes, is_checked')
    .eq('list_id', listId)
    .order('created_at', { ascending: false });

  if (itemsErr) {
    return { ok: false, status: 500, error: 'Eroare la preluarea produselor din lista de cumpărături.' };
  }

  const mappedItems = (itemRows || []).map((r: any) => ({
    id: r.id,
    productId: r.product_id || undefined,
    name: r.product_name || 'Produs',
    category: 'Alte produse',
    quantity: Number(r.quantity) || 1,
    unit: r.unit || 'buc',
    checked: Boolean(r.is_checked),
    notes: r.notes || undefined
  }));

  return { ok: true, listName: access.list.name || 'Coșul meu', items: mappedItems };
}

// Server-side Basket Optimizer V1 endpoint (batch queries, safe catalog cache, ownership & RLS aware)
app.post('/api/basket/optimize', publicComputeLimiter, async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const parsed = basketOptimizeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_BASKET_REQUEST',
        error: parsed.error.issues[0]?.message || 'Datele coșului pentru optimizare sunt invalide.'
      });
    }

    const { listId, listName, items, options } = parsed.data;
    let resolvedListName = listName;
    let resolvedItems: any[] = Array.isArray(items) ? items : [];

    const hasBearerHeader = Boolean(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
    const auth = hasBearerHeader ? await getAuthenticatedSupabaseUser(req) : null;
    if (hasBearerHeader && !auth) {
      return res.status(401).json({
        success: false,
        error: 'Sesiune invalidă sau expirată pentru optimizarea listei.'
      });
    }

    if (listId && UUID_STRICT_RE.test(listId)) {
      if (resolvedItems.length === 0) {
        if (!auth) {
          return res.status(401).json({
            success: false,
            error: 'Autentificarea este obligatorie pentru a optimiza o listă salvată în cont.'
          });
        }
        const ownedResult = await loadOwnedShoppingListItemsForOptimization({ auth, listId });
        if (ownedResult.ok === false) {
          return res.status(ownedResult.status).json({ success: false, error: ownedResult.error });
        }
        resolvedListName = resolvedListName || ownedResult.listName;
        resolvedItems = ownedResult.items;
      } else if (auth) {
        // Previne folosirea unui listId străin chiar și când sunt transmise articole inline (permite owner/membri partajați)
        const access = await resolveSharedListRoleAndMeta({ auth, listId });
        if (access.ok === false && access.status === 403) {
          return res.status(403).json({
            success: false,
            error: 'Acces interzis: nu poți accesa lista altui utilizator.'
          });
        }
      }
    }

    const [rawAliasIndex, dataset] = await Promise.all([
      loadServerProductAliasIndex(),
      isPostgresConfigured()
        ? DatabaseService.getOptimizationDataset(resolvedItems)
        : Promise.resolve({
            products: StorageService.getAllProducts(),
            offers: StorageService.getProductOffers(),
            stores: STORES,
            cacheHit: false,
            batchQueryMode: 'isolated_memory' as const
          })
    ]);

    const aliasIndex = mergeCanonicalAliasSources(rawAliasIndex, dataset.products);
    const normalizedItems = resolvedItems.map(item =>
      item?.productId
        ? { ...item, productId: resolveCanonicalProductId(item.productId, aliasIndex) || item.productId }
        : item
    );

    const optimization = BasketOptimizerService.optimize({
      list: listId || resolvedListName ? { id: listId || 'custom', name: resolvedListName || 'Coșul meu' } : undefined,
      items: normalizedItems,
      options,
      products: dataset.products,
      offers: dataset.offers,
      stores: dataset.stores,
      aliasMap: aliasIndex
    });

    return res.json({
      success: true,
      optimization,
      meta: {
        batchQueryMode: dataset.batchQueryMode,
        catalogCacheHit: dataset.cacheHit
      }
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Eroare la optimizarea coșului de cumpărături.'
    });
  }
});

// Authenticated owner/member-scoped GET endpoint pentru optimizarea directă a unei liste din Supabase (RLS & shared-member aware)
app.get('/api/basket/optimize/:listId', publicComputeLimiter, async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }

    const { listId } = req.params;
    if (!listId || !UUID_STRICT_RE.test(listId)) {
      return res.status(400).json({ success: false, error: 'Identificator listă invalid.' });
    }

    const ownedResult = await loadOwnedShoppingListItemsForOptimization({ auth, listId });
    if (ownedResult.ok === false) {
      return res.status(ownedResult.status).json({ success: false, error: ownedResult.error });
    }

    const maxStores = Math.max(1, Math.min(8, Number(req.query.maxStores) || 3));
    const useLoyaltyCards = req.query.useLoyaltyCards !== 'false';
    const useCoupons = req.query.useCoupons === 'true';
    const includeStaleOffers = req.query.includeStaleOffers !== 'false';
    const maxOfferAgeDaysRaw = Number(req.query.maxOfferAgeDays);
    const maxOfferAgeDays =
      Number.isFinite(maxOfferAgeDaysRaw) && maxOfferAgeDaysRaw >= 1 && maxOfferAgeDaysRaw <= 90
        ? Math.floor(maxOfferAgeDaysRaw)
        : undefined;
    const region =
      typeof req.query.region === 'string' && req.query.region.trim()
        ? req.query.region.trim().slice(0, 80)
        : undefined;
    const clientRevision =
      typeof req.query.clientRevision === 'string' && req.query.clientRevision.trim()
        ? req.query.clientRevision.trim().slice(0, 160)
        : undefined;
    const excludedStoreIds =
      typeof req.query.excludedStoreIds === 'string'
        ? req.query.excludedStoreIds.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;
    const favoriteStoreIds =
      typeof req.query.favoriteStoreIds === 'string'
        ? req.query.favoriteStoreIds.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

    const [rawAliasIndex, dataset] = await Promise.all([
      loadServerProductAliasIndex(),
      isPostgresConfigured()
        ? DatabaseService.getOptimizationDataset(ownedResult.items)
        : Promise.resolve({
            products: StorageService.getAllProducts(),
            offers: StorageService.getProductOffers(),
            stores: STORES,
            cacheHit: false,
            batchQueryMode: 'isolated_memory' as const
          })
    ]);

    const aliasIndex = mergeCanonicalAliasSources(rawAliasIndex, dataset.products);
    const normalizedItems = ownedResult.items.map(item =>
      item?.productId
        ? { ...item, productId: resolveCanonicalProductId(item.productId, aliasIndex) || item.productId }
        : item
    );

    const optimization = BasketOptimizerService.optimize({
      list: { id: listId, name: ownedResult.listName },
      items: normalizedItems,
      options: {
        maxStores,
        useLoyaltyCards,
        useCoupons,
        includeStaleOffers,
        maxOfferAgeDays,
        region,
        clientRevision,
        excludedStoreIds,
        favoriteStoreIds,
        transportCostPerExtraStore: 0
      },
      products: dataset.products,
      offers: dataset.offers,
      stores: dataset.stores,
      aliasMap: aliasIndex
    });

    return res.json({
      success: true,
      optimization,
      meta: {
        batchQueryMode: dataset.batchQueryMode,
        catalogCacheHit: dataset.cacheHit
      }
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la optimizarea listei salvate.' });
  }
});

// =========================================================================
// Authenticated, RLS-enforced Price Alerts & In-App Notifications API
// =========================================================================

function mapDbAlertRow(
  row: Record<string, any>,
  productById: Map<string, Product>,
  lowestOfferByProductId: Map<string, { price: number; storeId: string }>,
  metaById: Record<string, any>,
  aliasIndex?: ReturnType<typeof buildCanonicalAliasIndex>
): PriceAlert {
  const id = String(row.id || '');
  const rawProductId = String(row.product_id || '');
  const detail = aliasIndex ? resolveCanonicalProductDetail(rawProductId, aliasIndex) : null;
  const isInvalidRef = Boolean(detail && (detail.cycleDetected || (detail.wasAlias && !detail.found)));
  const productId = !aliasIndex
    ? rawProductId
    : isInvalidRef
      ? rawProductId
      : (detail?.found && detail.canonicalId ? detail.canonicalId : rawProductId);
  const product = isInvalidRef ? undefined : (productById.get(productId) || productById.get(rawProductId));
  const meta = (metaById[id] && typeof metaById[id] === 'object' ? metaById[id] : {}) as Record<string, any>;
  const rawType = String(row.alert_type ?? meta.alertType ?? 'below_target');
  const alertType: PriceAlert['alertType'] =
    rawType === 'any_drop' || rawType === 'interval_low' ? rawType : 'below_target';
  const rawInterval = Number(row.interval_days ?? meta.intervalDays);
  const intervalDays =
    alertType === 'interval_low' && [30, 90, 180, 365].includes(rawInterval)
      ? (rawInterval as PriceAlert['intervalDays'])
      : undefined;
  const offerInfo = isInvalidRef ? undefined : (lowestOfferByProductId.get(productId) || lowestOfferByProductId.get(rawProductId));

  return {
    id,
    productId,
    productName: product ? `${product.name}${product.brand ? ` (${product.brand})` : ''}` : productId,
    targetPrice: Number(row.target_price || 0),
    currentLowestPrice: offerInfo?.price ?? 0,
    lowestStoreId: offerInfo?.storeId,
    createdAt: String(row.created_at || new Date().toISOString()).slice(0, 10),
    isActive: Boolean(row.is_active),
    alertType,
    intervalDays,
    sourceListId: (row.source_list_id || meta.sourceListId || undefined) as string | undefined,
    lastTriggeredAt: (row.last_triggered_at || meta.lastTriggeredAt || undefined) as string | undefined,
    lastTriggeredPrice:
      row.last_triggered_price != null
        ? Number(row.last_triggered_price)
        : meta.lastTriggeredPrice != null
          ? Number(meta.lastTriggeredPrice)
          : undefined,
    lastEvaluatedPrice:
      row.last_evaluated_price != null
        ? Number(row.last_evaluated_price)
        : meta.lastEvaluatedPrice != null
          ? Number(meta.lastEvaluatedPrice)
          : undefined,
    lastNotifiedKey: (row.last_notified_key || meta.lastNotifiedKey || undefined) as string | undefined
  };
}

async function fetchUserAlertsRls(userClient: SupabaseClient, userId: string) {
  const extended = await userClient
    .from('price_alerts')
    .select(
      'id,user_id,product_id,target_price,is_active,created_at,alert_type,interval_days,source_list_id,last_triggered_at,last_triggered_price,last_evaluated_price,last_notified_key'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!extended.error) return extended;
  return userClient
    .from('price_alerts')
    .select('id,user_id,product_id,target_price,is_active,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}

function normalizeNotificationsCanonicalIdentity(
  notifications: InAppPriceNotification[],
  aliasIndex?: ReturnType<typeof buildCanonicalAliasIndex>
): InAppPriceNotification[] {
  if (!aliasIndex) return notifications;
  return notifications.map(n => {
    const rawPid = String(n.productId || '').trim();
    if (!rawPid) return n;
    const detail = resolveCanonicalProductDetail(rawPid, aliasIndex);
    if (detail.found && !detail.cycleDetected && detail.canonicalId && detail.canonicalId !== rawPid) {
      return {
        ...n,
        productId: detail.canonicalId,
        originalProductId: n.originalProductId || rawPid
      };
    }
    return n;
  });
}

async function fetchUserNotificationsRls(
  userClient: SupabaseClient,
  userId: string,
  aliasIndex?: ReturnType<typeof buildCanonicalAliasIndex>
): Promise<InAppPriceNotification[]> {
  try {
    const { data, error } = await userClient
      .from('price_alert_notifications')
      .select(
        'id,alert_id,dedupe_key,product_id,product_name,alert_type,title,message,observed_price,previous_price,target_price,store_id,store_name,triggered_at,is_read'
      )
      .eq('user_id', userId)
      .order('triggered_at', { ascending: false })
      .limit(100);
    if (error || !Array.isArray(data)) return [];
    const mapped = data.map(row => ({
      id: String(row.id),
      alertId: String(row.alert_id),
      dedupeKey: String(row.dedupe_key),
      productId: String(row.product_id),
      productName: String(row.product_name || 'Produs'),
      alertType: (row.alert_type === 'any_drop' || row.alert_type === 'interval_low'
        ? row.alert_type
        : 'below_target') as PriceAlert['alertType'] & string,
      title: String(row.title || 'Alertă de preț'),
      message: String(row.message || ''),
      observedPrice: Number(row.observed_price || 0),
      previousPrice: row.previous_price != null ? Number(row.previous_price) : undefined,
      targetPrice: row.target_price != null ? Number(row.target_price) : undefined,
      storeId: String(row.store_id || 'store'),
      storeName: String(row.store_name || 'Magazin'),
      triggeredAt: String(row.triggered_at || new Date().toISOString()),
      isRead: Boolean(row.is_read)
    }));
    return normalizeNotificationsCanonicalIdentity(mapped, aliasIndex);
  } catch {
    return [];
  }
}

app.get('/api/alerts', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară pentru alertele de preț.' });
    }

    const useDbCatalog = isPostgresConfigured() || process.env.COSUL_MEU_ISOLATED_TEST === '1';
    const [alertsRes, notifications, profileRes, products, offers, aliasIndex] = await Promise.all([
      fetchUserAlertsRls(auth.userClient, auth.user.id),
      fetchUserNotificationsRls(auth.userClient, auth.user.id),
      auth.userClient.from('profiles').select('preferences').eq('id', auth.user.id).maybeSingle(),
      useDbCatalog ? DatabaseService.getProducts() : Promise.resolve(StorageService.getAllProducts()),
      useDbCatalog ? DatabaseService.getOffers() : Promise.resolve(StorageService.getProductOffers()),
      loadServerProductAliasIndex()
    ]);

    if (alertsRes.error) {
      return res.status(500).json({ success: false, error: 'Nu am putut prelua alertele utilizatorului.' });
    }
    const normalizedNotifications = normalizeNotificationsCanonicalIdentity(notifications, aliasIndex);
    const productById = new Map(products.map(p => [p.id, p]));
    const lowestOfferByProductId = new Map<string, { price: number; storeId: string }>();
    for (const offer of offers) {
      const offerDetail = resolveCanonicalProductDetail(offer.productId, aliasIndex);
      if (offerDetail.cycleDetected || (offerDetail.wasAlias && !offerDetail.found)) continue;
      const canonicalOfferPid = offerDetail.found && offerDetail.canonicalId ? offerDetail.canonicalId : offer.productId;
      const prod = productById.get(canonicalOfferPid) || productById.get(offer.productId);
      if (!PriceComparisonService.isOfferValid(offer, prod, { aliasMap: aliasIndex })) continue;
      const prev = lowestOfferByProductId.get(canonicalOfferPid);
      if (!prev || offer.price < prev.price) {
        lowestOfferByProductId.set(canonicalOfferPid, { price: offer.price, storeId: offer.storeId });
      }
    }

    const metaById =
      profileRes.data?.preferences &&
      typeof profileRes.data.preferences === 'object' &&
      profileRes.data.preferences.priceAlertMeta &&
      typeof profileRes.data.preferences.priceAlertMeta === 'object'
        ? (profileRes.data.preferences.priceAlertMeta as Record<string, any>)
        : {};

    const alerts = (alertsRes.data || []).map(row =>
      mapDbAlertRow(row, productById, lowestOfferByProductId, metaById, aliasIndex)
    );

    return res.json({ success: true, alerts, notifications: normalizedNotifications });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la preluarea alertelor.' });
  }
});

app.post('/api/alerts', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }

    const parsed = priceAlertCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Date invalide pentru alertă.'
      });
    }

    const { productId, alertType, targetPrice, intervalDays, sourceListId } = parsed.data;
    const useDbCatalog = isPostgresConfigured() || process.env.COSUL_MEU_ISOLATED_TEST === '1';
    const [products, offers, existingRes, aliasIndex] = await Promise.all([
      useDbCatalog ? DatabaseService.getProducts() : Promise.resolve(StorageService.getAllProducts()),
      useDbCatalog ? DatabaseService.getOffers() : Promise.resolve(StorageService.getProductOffers()),
      fetchUserAlertsRls(auth.userClient, auth.user.id),
      loadServerProductAliasIndex()
    ]);

    const detail = resolveCanonicalProductDetail(productId, aliasIndex);
    if (detail.cycleDetected) {
      return res.status(400).json({
        success: false,
        error: 'Referință de produs invalidă (ciclu canonic sau lanț excesiv detectat).'
      });
    }
    if (detail.wasAlias && !detail.found) {
      return res.status(400).json({
        success: false,
        error: 'Referință de produs invalidă (alias orfan fără rădăcină canonică validă).'
      });
    }

    const canonicalProductId = detail.found && detail.canonicalId ? detail.canonicalId : productId;
    const product =
      products.find(p => p.id === canonicalProductId) || products.find(p => p.id === productId);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produsul selectat nu există în catalog.' });
    }

    const existingAlerts = existingRes.data || [];
    const normalizedInterval = alertType === 'interval_low' ? (intervalDays || 90) : null;
    const isDuplicate = existingAlerts.some(row => {
      const rawRowPid = String(row.product_id || '');
      const rowDetail = resolveCanonicalProductDetail(rawRowPid, aliasIndex);
      if (rowDetail.cycleDetected || (rowDetail.wasAlias && !rowDetail.found)) return false;
      const rowCanonicalId = rowDetail.found && rowDetail.canonicalId ? rowDetail.canonicalId : rawRowPid;
      const rowType = String((row as any).alert_type || 'below_target');
      const rowInterval = (row as any).interval_days != null ? Number((row as any).interval_days) : null;
      return rowCanonicalId === canonicalProductId && rowType === alertType && (alertType !== 'interval_low' || rowInterval === normalizedInterval);
    });
    if (isDuplicate) {
      return res.status(409).json({
        success: false,
        error: 'Există deja o alertă similară configurată pentru acest produs.'
      });
    }

    const equivalentIds = new Set(collectProductIdsForCanonical(canonicalProductId, aliasIndex));
    const validOffers = offers
      .filter(o => {
        const offerDetail = resolveCanonicalProductDetail(o.productId, aliasIndex);
        if (offerDetail.cycleDetected || (offerDetail.wasAlias && !offerDetail.found)) return false;
        const offerCanonicalPid = offerDetail.found && offerDetail.canonicalId ? offerDetail.canonicalId : o.productId;
        return (
          (offerCanonicalPid === canonicalProductId || equivalentIds.has(o.productId)) &&
          PriceComparisonService.isOfferValid(o, product, { aliasMap: aliasIndex })
        );
      })
      .sort((a, b) => a.price - b.price);
    const bestOffer = validOffers[0];
    const effectiveTarget =
      alertType === 'below_target'
        ? Number(targetPrice)
        : Math.max(0.01, bestOffer?.price ?? product.baseReferencePrice ?? 1);

    const newId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const extendedInsert = {
      id: newId,
      user_id: auth.user.id,
      product_id: canonicalProductId,
      target_price: effectiveTarget,
      is_active: true,
      created_at: nowIso,
      alert_type: alertType,
      interval_days: normalizedInterval,
      source_list_id: sourceListId || null,
      last_evaluated_price: bestOffer?.price ?? null
    };

    let insertRes = await auth.userClient.from('price_alerts').insert(extendedInsert).select().single();
    if (insertRes.error) {
      insertRes = await auth.userClient
        .from('price_alerts')
        .insert({
          id: newId,
          user_id: auth.user.id,
          product_id: canonicalProductId,
          target_price: effectiveTarget,
          is_active: true,
          created_at: nowIso
        })
        .select()
        .single();
    }

    if (insertRes.error) {
      return res.status(500).json({ success: false, error: 'Nu am putut crea alerta de preț.' });
    }

    const alert: PriceAlert = {
      id: newId,
      productId: canonicalProductId,
      productName: `${product.name}${product.brand ? ` (${product.brand})` : ''}`,
      targetPrice: effectiveTarget,
      currentLowestPrice: bestOffer?.price ?? 0,
      lowestStoreId: bestOffer?.storeId,
      createdAt: nowIso.slice(0, 10),
      isActive: true,
      alertType,
      intervalDays: normalizedInterval as PriceAlert['intervalDays'],
      sourceListId,
      lastEvaluatedPrice: bestOffer?.price
    };

    return res.status(201).json({ success: true, alert });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la crearea alertei.' });
  }
});

app.post('/api/alerts/from-list/:listId', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }

    const { listId } = req.params;
    if (!listId || !UUID_STRICT_RE.test(listId)) {
      return res.status(400).json({ success: false, error: 'Identificator listă invalid.' });
    }

    const bodyCheck = priceAlertsFromListSchema.safeParse(req.body || {});
    if (!bodyCheck.success) {
      return res.status(400).json({
        success: false,
        error: bodyCheck.error.issues[0]?.message || 'Opțiuni invalide.'
      });
    }

    const ownedResult = await loadOwnedShoppingListItemsForOptimization({ auth, listId });
    if (ownedResult.ok === false) {
      return res.status(ownedResult.status).json({ success: false, error: ownedResult.error });
    }

    const useDbCatalog = isPostgresConfigured() || process.env.COSUL_MEU_ISOLATED_TEST === '1';
    const [products, offers, existingAlertsRes, aliasIndex] = await Promise.all([
      useDbCatalog ? DatabaseService.getProducts() : Promise.resolve(StorageService.getAllProducts()),
      useDbCatalog ? DatabaseService.getOffers() : Promise.resolve(StorageService.getProductOffers()),
      fetchUserAlertsRls(auth.userClient, auth.user.id),
      loadServerProductAliasIndex()
    ]);

    const productById = new Map(products.map(p => [p.id, p]));
    const existingAlerts = (existingAlertsRes.data || []).map(row =>
      mapDbAlertRow(row, productById, new Map(), {}, aliasIndex)
    );

    const { createdAlerts, skippedExistingCount, unmatchedItemNames } =
      PriceAlertService.createAlertsFromShoppingList(
        {
          id: listId,
          name: ownedResult.listName,
          items: ownedResult.items,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        existingAlerts,
        products,
        offers,
        {
          ...bodyCheck.data,
          aliasMap: aliasIndex
        }
      );

    const persistedAlerts: PriceAlert[] = [];
    for (const candidate of createdAlerts) {
      const uuid = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      let ins = await auth.userClient
        .from('price_alerts')
        .insert({
          id: uuid,
          user_id: auth.user.id,
          product_id: candidate.productId,
          target_price: candidate.targetPrice,
          is_active: true,
          created_at: nowIso,
          alert_type: candidate.alertType || 'below_target',
          interval_days: candidate.intervalDays ?? null,
          source_list_id: listId,
          last_evaluated_price: candidate.lastEvaluatedPrice ?? null
        })
        .select()
        .single();

      if (ins.error) {
        ins = await auth.userClient
          .from('price_alerts')
          .insert({
            id: uuid,
            user_id: auth.user.id,
            product_id: candidate.productId,
            target_price: candidate.targetPrice,
            is_active: true,
            created_at: nowIso
          })
          .select()
          .single();
      }
      if (!ins.error) {
        persistedAlerts.push({ ...candidate, id: uuid });
      }
    }

    return res.status(201).json({
      success: true,
      createdCount: persistedAlerts.length,
      skippedExistingCount,
      unmatchedItemNames,
      createdAlerts: persistedAlerts
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la generarea alertelor din listă.' });
  }
});

app.patch('/api/alerts/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }

    const { id } = req.params;
    if (!id || !UUID_STRICT_RE.test(id)) {
      return res.status(400).json({ success: false, error: 'Identificator alertă invalid.' });
    }

    const parsed = priceAlertUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Date invalide pentru actualizare.'
      });
    }

    const { data: ownedRow, error: ownErr } = await auth.userClient
      .from('price_alerts')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (ownErr) {
      return res.status(500).json({ success: false, error: 'Eroare la verificarea alertei.' });
    }
    if (!ownedRow) {
      const adminClient = getSupabaseAdminClient();
      if (adminClient) {
        const { data: existsElsewhere } = await adminClient
          .from('price_alerts')
          .select('id, user_id')
          .eq('id', id)
          .maybeSingle();
        if (existsElsewhere && existsElsewhere.user_id !== auth.user.id) {
          return res.status(403).json({ success: false, error: 'Acces interzis la alerta altui utilizator.' });
        }
      }
      return res.status(404).json({ success: false, error: 'Alerta nu a fost găsită.' });
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
    if (parsed.data.targetPrice !== undefined) patch.target_price = parsed.data.targetPrice;
    if (parsed.data.alertType !== undefined) patch.alert_type = parsed.data.alertType;
    if (parsed.data.intervalDays !== undefined) patch.interval_days = parsed.data.intervalDays;

    let upd = await auth.userClient
      .from('price_alerts')
      .update(patch)
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .select()
      .single();

    if (upd.error && (patch.target_price !== undefined || patch.is_active !== undefined)) {
      const basePatch: Record<string, unknown> = {};
      if (patch.target_price !== undefined) basePatch.target_price = patch.target_price;
      if (patch.is_active !== undefined) basePatch.is_active = patch.is_active;
      upd = await auth.userClient
        .from('price_alerts')
        .update(basePatch)
        .eq('id', id)
        .eq('user_id', auth.user.id)
        .select()
        .single();
    }

    if (upd.error) {
      return res.status(500).json({ success: false, error: 'Nu am putut actualiza alerta.' });
    }

    return res.json({ success: true, alert: upd.data });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la actualizarea alertei.' });
  }
});

app.delete('/api/alerts/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }

    const { id } = req.params;
    if (!id || !UUID_STRICT_RE.test(id)) {
      return res.status(400).json({ success: false, error: 'Identificator alertă invalid.' });
    }

    const { data: ownedRow, error: ownErr } = await auth.userClient
      .from('price_alerts')
      .select('id, user_id')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (ownErr) {
      return res.status(500).json({ success: false, error: 'Eroare la verificarea alertei.' });
    }
    if (!ownedRow) {
      const adminClient = getSupabaseAdminClient();
      if (adminClient) {
        const { data: existsElsewhere } = await adminClient
          .from('price_alerts')
          .select('id, user_id')
          .eq('id', id)
          .maybeSingle();
        if (existsElsewhere && existsElsewhere.user_id !== auth.user.id) {
          return res.status(403).json({ success: false, error: 'Acces interzis la ștergerea alertei altui utilizator.' });
        }
      }
      return res.status(404).json({ success: false, error: 'Alerta nu a fost găsită.' });
    }

    const { error: delErr } = await auth.userClient
      .from('price_alerts')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.user.id);

    if (delErr) {
      return res.status(500).json({ success: false, error: 'Nu am putut șterge alerta.' });
    }

    return res.json({ success: true, deletedId: id });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la ștergerea alertei.' });
  }
});

app.post('/api/alerts/evaluate', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }

    const useDbCatalog = isPostgresConfigured() || process.env.COSUL_MEU_ISOLATED_TEST === '1';
    const [alertsRes, existingNotifs, products, offers, stores, aliasIndex] = await Promise.all([
      fetchUserAlertsRls(auth.userClient, auth.user.id),
      fetchUserNotificationsRls(auth.userClient, auth.user.id),
      useDbCatalog ? DatabaseService.getProducts() : Promise.resolve(StorageService.getAllProducts()),
      useDbCatalog ? DatabaseService.getOffers() : Promise.resolve(StorageService.getProductOffers()),
      useDbCatalog ? DatabaseService.getStores() : Promise.resolve(STORES),
      loadServerProductAliasIndex()
    ]);

    if (alertsRes.error) {
      return res.status(500).json({ success: false, error: 'Nu am putut evalua alertele.' });
    }
    const normalizedExistingNotifs = normalizeNotificationsCanonicalIdentity(existingNotifs, aliasIndex);
    const productById = new Map(products.map(p => [p.id, p]));
    const currentAlerts = (alertsRes.data || []).map(row => mapDbAlertRow(row, productById, new Map(), {}, aliasIndex));
    const observationsByProduct = await Promise.all(
      Array.from(
        new Set(
          currentAlerts
            .filter(a => a.alertType === 'interval_low')
            .map(a => {
              const d = resolveCanonicalProductDetail(a.productId, aliasIndex);
              if (d.cycleDetected || (d.wasAlias && !d.found)) return null;
              return d.found && d.canonicalId ? d.canonicalId : a.productId;
            })
            .filter((cid): cid is string => Boolean(cid))
        )
      ).map(canonicalPid => {
        if (isPostgresConfigured()) {
          return DatabaseService.getPriceObservations(canonicalPid);
        }
        const equiv = new Set(collectProductIdsForCanonical(canonicalPid, aliasIndex));
        return Promise.resolve(StorageService.getPriceObservations().filter(o => equiv.has(o.productId)));
      })
    );
    const observations = observationsByProduct.flat();

    const { updatedAlerts, newNotifications } = PriceAlertService.evaluateAlerts({
      alerts: currentAlerts,
      offers,
      products,
      observations,
      stores,
      existingNotifications: normalizedExistingNotifs,
      aliasMap: aliasIndex
    });

    for (const notif of newNotifications) {
      const notifId = crypto.randomUUID();
      await auth.userClient.from('price_alert_notifications').upsert(
        {
          id: notifId,
          user_id: auth.user.id,
          alert_id: notif.alertId,
          dedupe_key: notif.dedupeKey,
          product_id: notif.productId,
          product_name: notif.productName,
          alert_type: notif.alertType,
          title: notif.title,
          message: notif.message,
          observed_price: notif.observedPrice,
          previous_price: notif.previousPrice ?? null,
          target_price: notif.targetPrice ?? null,
          store_id: notif.storeId,
          store_name: notif.storeName,
          triggered_at: notif.triggeredAt,
          is_read: false
        },
        { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }
      );
    }

    for (const nextAlert of updatedAlerts) {
      await auth.userClient
        .from('price_alerts')
        .update({
          last_triggered_at: nextAlert.lastTriggeredAt || null,
          last_triggered_price: nextAlert.lastTriggeredPrice ?? null,
          last_evaluated_price: nextAlert.lastEvaluatedPrice ?? null,
          last_notified_key: nextAlert.lastNotifiedKey || null
        })
        .eq('id', nextAlert.id)
        .eq('user_id', auth.user.id);
    }

    return res.json({
      success: true,
      evaluatedCount: updatedAlerts.length,
      newNotificationsCount: newNotifications.length,
      newNotifications
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la evaluarea alertelor.' });
  }
});

app.patch('/api/alerts/notifications/:id/read', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const { id } = req.params;
    if (!id || !UUID_STRICT_RE.test(id)) {
      return res.status(400).json({ success: false, error: 'Identificator notificare invalid.' });
    }
    const { data, error } = await auth.userClient
      .from('price_alert_notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .select('id')
      .maybeSingle();

    if (error) {
      return res.status(500).json({ success: false, error: 'Nu am putut actualiza notificarea.' });
    }
    if (!data) {
      return res.status(404).json({ success: false, error: 'Notificarea nu a fost găsită.' });
    }
    return res.json({ success: true, id });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la marcarea notificării.' });
  }
});

app.post('/api/alerts/notifications/read-all', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const { error } = await auth.userClient
      .from('price_alert_notifications')
      .update({ is_read: true })
      .eq('user_id', auth.user.id)
      .eq('is_read', false);
    if (error) {
      return res.status(500).json({ success: false, error: 'Nu am putut marca notificările.' });
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la actualizarea notificărilor.' });
  }
});

// Helper canonic pentru catalogul public (/api/categories & /api/products)
async function loadCanonicalCatalogForPublicRoutes(): Promise<{
  products: Product[];
  offers: ProductOffer[];
}> {
  if (isPostgresConfigured() || process.env.COSUL_MEU_ISOLATED_TEST === '1') {
    const [products, offers] = await Promise.all([
      DatabaseService.getProducts(),
      DatabaseService.getOffers()
    ]);
    return { products, offers };
  }
  const rawProducts = StorageService.getAllProducts();
  const rawOffers = StorageService.getProductOffers();
  const aliasMap = await loadServerProductAliasIndex();
  const refMap = resolveProductReferenceMap(rawProducts, aliasMap);
  const canonicalProductsMap = new Map<string, Product>();
  for (const prod of refMap.values()) {
    if (!prod.canonicalProductId && !canonicalProductsMap.has(prod.id)) {
      canonicalProductsMap.set(prod.id, prod);
    }
  }
  const canonicalProducts = Array.from(canonicalProductsMap.values());
  const canonicalIds = new Set(canonicalProducts.map(p => p.id));
  const normalizedOffers = normalizeProductReferences(rawOffers as unknown as Record<string, unknown>[], aliasMap, {
    fields: ['productId'],
    knownProductIds: new Set(rawProducts.map(p => p.id))
  }) as unknown as ProductOffer[];
  const filteredOffers = normalizedOffers.filter(o => canonicalIds.has(o.productId));
  return { products: canonicalProducts, offers: filteredOffers };
}

// GET /api/categories - Taxonomie completă categorii și subcategorii
app.get('/api/categories', async (req, res) => {
  try {
    const { products: allProducts, offers } = await loadCanonicalCatalogForPublicRoutes();
    const productById = new Map(allProducts.map(p => [p.id, p]));
    const validOfferProductIds = new Set(
      offers.filter(o => PriceComparisonService.isOfferValid(o, productById.get(o.productId))).map(o => o.productId)
    );

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

    // Production & isolated catalog reads resolve strictly canonical roots & normalized offers.
    const { products: allProducts, offers: allOffers } = await loadCanonicalCatalogForPublicRoutes();
    const productById = new Map(allProducts.map(p => [p.id, p]));

    // Mapare oferte valide per produs (exclude isolated, rejected, demo, flagged, expired, <= 0)
    const productOffersMap = new Map<string, typeof allOffers>();
    for (const off of allOffers) {
      if (PriceComparisonService.isOfferValid(off, productById.get(off.productId))) {
        const list = productOffersMap.get(off.productId) || [];
        list.push(off);
        productOffersMap.set(off.productId, list);
      }
    }

    // Calcul metadate agregate per produs + clasificare transparentă a calității datelor
    const enrichedProducts = allProducts.map(p => {
      const offers = productOffersMap.get(p.id) || [];
      const sortedOffers = [...offers].sort((a, b) => a.price - b.price);
      const minOffer = sortedOffers[0];
      const maxPrice = sortedOffers.length > 0 ? Math.max(...sortedOffers.map(o => o.price)) : 0;
      const hasPromo = sortedOffers.some(o => o.isPromo);
      const requiresLoyalty = minOffer?.loyaltyCardRequired || false;
      const latestVerifiedAt = sortedOffers.reduce((latest, o) => {
        const d = o.lastVerifiedAt || o.observationDate || o.lastChecked.slice(0, 10);
        return !latest || d > latest ? d : latest;
      }, '');

      const qualityAssessment = minOffer
        ? PriceQualityClassifier.classifyOffer(minOffer, { product: p, confirmationsCount: sortedOffers.length })
        : null;

      return {
        ...p,
        imageUrl: sanitizeApiImageUrl(p.imageUrl),
        minPrice: minOffer ? minOffer.price : null,
        maxPrice: maxPrice || null,
        lowestStoreId: minOffer ? minOffer.storeId : null,
        offersCount: sortedOffers.length,
        isPromo: hasPromo,
        loyaltyCardRequired: requiresLoyalty,
        loyaltyCardName: minOffer?.loyaltyCardName,
        lastVerifiedAt: latestVerifiedAt ? latestVerifiedAt.slice(0, 10) : null,
        freshnessStatus: minOffer?.freshnessStatus || (latestVerifiedAt ? 'recent' : 'expired'),
        qualityScore: qualityAssessment ? qualityAssessment.score : null,
        qualityStatus: qualityAssessment ? qualityAssessment.status : 'UNVERIFIED',
        qualityLabelRo: qualityAssessment ? qualityAssessment.labelRo : 'Fără oferte active'
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

    // Filtru retailer
    if (retailer && typeof retailer === 'string' && retailer !== 'toate') {
      const normalizedRetailer = retailer.toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
      filtered = filtered.filter(p => {
        const prodOffers = productOffersMap.get(p.id) || [];
        return prodOffers.some(o => {
          const offerStore = (o.storeId || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
          return o.storeId === retailer || offerStore === normalizedRetailer;
        });
      });
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

    // 1. Încercare din baza de date persistentă (PostgreSQL / Supabase) cu rezolvare multi-hop canonică
    const dbDetail = await DatabaseService.getProductDetailById(id);
    let comparison = null;
    let observations: any[] = [];

    if (dbDetail && dbDetail.product) {
      const canonicalProductId = dbDetail.product.id;
      comparison = PriceComparisonService.getProductComparisonDetails(
        canonicalProductId,
        dbDetail.product,
        Array.isArray(dbDetail.offers) ? dbDetail.offers : [],
        STORES
      );
      observations = dbDetail.priceHistory || [];
    }

    // 2. Fallback la memorie locală (cu rezolvare canonică și agregare observații across aliasuri)
    if (!comparison) {
      const localProducts = StorageService.getAllProducts();
      const rawAliasIndex = await loadServerProductAliasIndex();
      const aliasIndex = mergeCanonicalAliasSources(rawAliasIndex, localProducts);
      const canonicalProductId = resolveCanonicalProductId(id, aliasIndex) || id;
      comparison = PriceComparisonService.getProductComparisonDetails(
        canonicalProductId,
        undefined,
        undefined,
        undefined,
        aliasIndex
      );
      if (comparison) {
        const equivalentIds = new Set(collectProductIdsForCanonical(comparison.product.id, aliasIndex));
        observations = StorageService.getPriceObservations()
          .filter(obs => equivalentIds.has(obs.productId))
          .map(obs => ({
            ...obs,
            productId: comparison!.product.id
          }));
      }
    }

    if (!comparison) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit în catalog.' });
    }

    const sanitizedProduct = {
      ...comparison.product,
      imageUrl: sanitizeApiImageUrl(comparison.product?.imageUrl)
    };

    const rawOffers = comparison.offers.map(o => o.offer);
    const offerQualityByOfferId = Object.fromEntries(
      rawOffers.map(off => [
        off.id,
        PriceQualityClassifier.classifyOffer(off, {
          product: comparison.product,
          confirmationsCount: rawOffers.length
        })
      ])
    );

    const sanitizedObservations = observations.filter(
      o => o && Number.isFinite(o.price) && o.price > 0 && o.source !== 'demo' && o.source !== 'estimated'
    );

    const historyStats = PriceHistoryService.getProductPriceStats(sanitizedProduct.id, {
      offers: rawOffers,
      observations: sanitizedObservations,
      stores: STORES
    });

    res.json({
      success: true,
      product: sanitizedProduct,
      canonicalProductId: sanitizedProduct.id,
      requestedProductId: id,
      redirectedFromAlias: id !== sanitizedProduct.id,
      comparison: {
        ...comparison,
        product: sanitizedProduct
      },
      offerQualityByOfferId,
      observationsCount: historyStats.observationsCount,
      distinctDaysCount: historyStats.distinctDaysCount,
      hasSufficientHistory: historyStats.hasSufficientHistory,
      intervalStats: historyStats.intervalStats,
      allIntervalStats: historyStats.intervalStats,
      observations: sanitizedObservations.slice(0, 200)
    });
  } catch (err: any) {
    console.error('Eroare GET /api/products/:id:', err);
    res.status(500).json({ error: 'Eroare la preluarea detaliilor produsului.' });
  }
});

// POST /api/products/report-error - Semnalare eroare de către utilizator
app.post('/api/products/report-error', publicReportLimiter, async (req, res) => {
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

    const rawProductId = String(productId).trim();
    const rawAliasIndex = await loadServerProductAliasIndex();
    const effectiveAliasIndex =
      !isPostgresConfigured() && rawAliasIndex.parentById.size === 0
        ? mergeCanonicalAliasSources(rawAliasIndex, StorageService.getAllProducts())
        : rawAliasIndex;
    const detail = resolveCanonicalProductDetail(rawProductId, effectiveAliasIndex);
    if (detail.cycleDetected) {
      return res.status(400).json({ error: 'Referință de produs invalidă (ciclu canonic detectat).' });
    }
    if (detail.wasAlias && !detail.found) {
      return res.status(400).json({ error: 'Referință de produs invalidă (alias orfan fără rădăcină canonică).' });
    }
    const canonicalProductId = detail.found && detail.canonicalId ? detail.canonicalId : rawProductId;
    const wasAlias = canonicalProductId !== rawProductId;

    const report = {
      id: `err-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      productId: canonicalProductId,
      ...(wasAlias ? { originalProductId: rawProductId } : {}),
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

    // Conectare la coada de priorități a Price Quality Monitor (strict pe ID canonic)
    if (storeId && (errorType === 'price_mismatch' || errorType === 'expired_promo')) {
      StorageService.addRecollectionTasks([{
        id: `task-err-${report.id}`,
        productId: canonicalProductId,
        productName,
        retailerId: storeId,
        priority: 2, // Prioritate ridicată (anomalie raportată)
        reason: `Raport eroare utilizator: ${errorType} - ${details}${wasAlias ? ` (raportat inițial pe alias ${rawProductId})` : ''}`,
        status: 'queued',
        scheduledAt: new Date().toISOString(),
        attempts: 0,
        createdAt: new Date().toISOString()
      }]);
    }

    res.json({
      success: true,
      canonicalProductId,
      message: 'Raportul de eroare a fost înregistrat cu succes. Mulțumim pentru sprijinul în menținerea acurateței prețurilor!',
      reportId: report.id
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la înregistrarea raportului.' });
  }
});

// POST /api/admin/match-correction - Corectare sau separare grupuri de matching din panoul admin (DB tranzacțional + audit fără alterarea price_observations)
app.post('/api/admin/match-correction', requireAdminAuth, async (req, res) => {
  try {
    const { candidateId, correctedProductId, reason } = req.body || {};
    if (!candidateId || !correctedProductId || !reason) {
      return res.status(400).json({ error: 'Câmpurile candidateId, correctedProductId și reason sunt obligatorii.' });
    }

    const result = await DatabaseService.correctProductMatch({
      candidateId: String(candidateId),
      correctedProductId: String(correctedProductId),
      reason: String(reason),
      performedBy: 'admin',
      ipAddress: req.ip
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        error: result.error || 'Corectarea asocierii nu a putut fi finalizată.'
      });
    }

    res.json({
      success: true,
      mode: result.persistedIn,
      candidateId: result.candidateId,
      previousProductId: result.previousProductId,
      correctedProductId: result.correctedProductId,
      message: 'Asocierea a fost corectată, persistată și jurnalizată în audit.'
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
      const [operationalData, stagingSnapshot] = await Promise.all([
        DatabaseService.getOperationalMetrics(),
        DatabaseService.getStagingOffersPaginated({ page: 1, limit: 1 })
      ]);
      const stats = {
        totalSources: operationalData.configuredSourcesCount,
        activeSources: operationalData.activeSourcesCount,
        totalDocuments: operationalData.kpis.discoveredDocuments.value,
        totalExtractedOffers: operationalData.kpis.extractedOffers.value,
        stagedPendingReview: stagingSnapshot.statusCounts.NEEDS_REVIEW ?? 0,
        stagedValidated: stagingSnapshot.statusCounts.VALIDATED ?? operationalData.kpis.validatedOffers.value,
        stagedApproved: stagingSnapshot.statusCounts.APPROVED ?? 0,
        readyToPublish: stagingSnapshot.statusCounts.READY_TO_PUBLISH ?? ((stagingSnapshot.statusCounts.APPROVED ?? 0) + (stagingSnapshot.statusCounts.VALIDATED ?? 0)),
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

    // 4. Extragere strictă a ofertelor eligibile (APPROVED sau VALIDATED, preț pozitiv > 0)
    // Condiție strictă: ofertele NEEDS_REVIEW nu sunt atinse sau convertite automat!
    const result = await client.query(
      `SELECT id FROM catalog_extracted_offers
       WHERE UPPER(staging_status) IN ('APPROVED', 'VALIDATED')
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

app.get('/api/admin/auth-check', requireAdminAuth, (_req, res) => res.sendStatus(204));

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
    const dbStores = await DatabaseService.getStores();
    const localStores = StorageService.getStores();
    const mergedById = new Map<string, Store>();
    for (const s of dbStores) {
      if (s?.id) mergedById.set(s.id, s);
    }
    for (const ls of localStores) {
      if (!ls?.id) continue;
      const existing = mergedById.get(ls.id);
      if (existing) {
        mergedById.set(ls.id, {
          ...ls,
          ...existing,
          officialUrl: existing.officialUrl || existing.websiteUrl || ls.officialUrl || ls.websiteUrl,
          websiteUrl: existing.websiteUrl || existing.officialUrl || ls.websiteUrl || ls.officialUrl
        });
      } else {
        mergedById.set(ls.id, ls);
      }
    }

    const mapped = Array.from(mergedById.values()).map(s => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      chain: s.chain,
      officialUrl: s.officialUrl || s.websiteUrl,
      format: s.chain?.includes('PDF') ? 'PDF' : 'HTML & PDF',
      defaultStatus: 'ACTIVE',
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
      officialUrl,
      websiteUrl,
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

    let resolvedOfficialUrl = typeof officialUrl === 'string' && officialUrl.trim()
      ? officialUrl.trim()
      : (typeof websiteUrl === 'string' && websiteUrl.trim() ? websiteUrl.trim() : '');

    let officialDomain: string | undefined;
    if (resolvedOfficialUrl) {
      const siteSafety = CatalogDownloader.validatePublicUrlSafety(resolvedOfficialUrl);
      if (!siteSafety.safe) {
        return res.status(400).json({ error: `Adresă pagină web oficială nesigură: ${siteSafety.reason}` });
      }
      officialDomain = siteSafety.hostname;
    }

    if (catalogUrl && catalogUrl.trim()) {
      const catalogSafety = officialDomain
        ? CatalogDownloader.validateUrlSafety(catalogUrl.trim(), [officialDomain])
        : CatalogDownloader.validatePublicUrlSafety(catalogUrl.trim());
      if (!catalogSafety.safe) {
        return res.status(400).json({ error: `Adresă URL catalog nesigură: ${catalogSafety.reason}` });
      }
      if (!resolvedOfficialUrl) {
        try {
          resolvedOfficialUrl = new URL(catalogUrl.trim()).origin;
          officialDomain = new URL(resolvedOfficialUrl).hostname.toLowerCase();
        } catch {}
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
      officialUrl: resolvedOfficialUrl || undefined,
      websiteUrl: resolvedOfficialUrl || undefined,
      type: (['discounter', 'hypermarket', 'supermarket', 'proximity'].includes(storeType) ? storeType : 'supermarket') as any,
      rating: 4.5,
      locationsCount: 1,
      sampleAddress: 'România',
      isPartner: false
    };

    const pool = getPool();
    let persistedOfficialUrl: string | undefined = newStore.officialUrl;

    if (pool) {
      const insertWithOfficialSql = `INSERT INTO stores (id, name, slug, chain, brand_color, accent_color, official_url, store_type, rating, locations_count, sample_address, is_partner)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
      const insertParams = [
        newStore.id,
        newStore.name,
        newStore.slug,
        newStore.chain,
        newStore.brandColor,
        newStore.accentColor,
        newStore.officialUrl || null,
        newStore.type,
        newStore.rating,
        newStore.locationsCount,
        newStore.sampleAddress,
        newStore.isPartner
      ];

      try {
        await pool.query(insertWithOfficialSql, insertParams);
      } catch (insertErr: any) {
        if (insertErr?.code === '42703') {
          await pool.query('ALTER TABLE stores ADD COLUMN IF NOT EXISTS official_url TEXT');
          await pool.query(insertWithOfficialSql, insertParams);
        } else {
          throw insertErr;
        }
      }

      const readBack = await pool.query(
        `SELECT id, name, slug, chain, brand_color, accent_color, store_type, official_url
         FROM stores WHERE id = $1`,
        [newStore.id]
      );
      const savedRow = readBack.rows[0];
      if (!savedRow) {
        throw new Error('Retailerul inserat nu a putut fi verificat la recitirea din PostgreSQL.');
      }
      if ((newStore.officialUrl || null) !== (savedRow.official_url || null)) {
        throw new Error('Persistența câmpului official_url nu a putut fi confirmată în PostgreSQL.');
      }
      persistedOfficialUrl = savedRow.official_url || undefined;
    } else {
      const { error: storeError } = await supabase.from('stores').insert({
        id: newStore.id,
        name: newStore.name,
        slug: newStore.slug,
        chain: newStore.chain,
        brand_color: newStore.brandColor,
        accent_color: newStore.accentColor,
        official_url: newStore.officialUrl || null,
        store_type: newStore.type,
        rating: newStore.rating,
        locations_count: newStore.locationsCount,
        sample_address: newStore.sampleAddress,
        is_partner: newStore.isPartner
      });
      if (storeError) throw storeError;

      const { data: savedRow, error: readBackError } = await supabase
        .from('stores')
        .select('id, name, slug, chain, brand_color, accent_color, store_type, official_url')
        .eq('id', newStore.id)
        .single();
      if (readBackError || !savedRow) {
        throw readBackError || new Error('Retailerul inserat nu a putut fi verificat la recitirea din Supabase.');
      }
      if ((newStore.officialUrl || null) !== (savedRow.official_url || null)) {
        throw new Error('Persistența câmpului official_url nu a putut fi confirmată în Supabase.');
      }
      persistedOfficialUrl = savedRow.official_url || undefined;
    }

    newStore.officialUrl = persistedOfficialUrl;
    newStore.websiteUrl = persistedOfficialUrl;
    StorageService.saveCustomStore(newStore);

    // Configurare opțională a primei surse de catalog (sau a paginii web oficiale ca sursă HTML)
    let createdSource: CatalogSource | null = null;
    const effectiveSourceUrl = (catalogUrl && catalogUrl.trim()) || resolvedOfficialUrl;
    if (effectiveSourceUrl) {
      const isWebsiteFallbackOnly = !(catalogUrl && catalogUrl.trim()) && Boolean(resolvedOfficialUrl);
      const sourceId = isWebsiteFallbackOnly ? `cat-src-${cleanId}-web` : `cat-src-${cleanId}-${Date.now()}`;
      createdSource = {
        id: sourceId,
        retailerId: cleanId,
        retailerName: name.trim(),
        name: sourceName?.trim() || (isWebsiteFallbackOnly ? `Pagină Web Oficială ${name.trim()}` : `Catalog Online ${name.trim()}`),
        catalogUrl: effectiveSourceUrl,
        format: isWebsiteFallbackOnly
          ? 'html'
          : (['html', 'pdf', 'api'].includes(sourceFormat) ? sourceFormat : (format.toLowerCase().includes('pdf') ? 'pdf' : 'html')),
        status: defaultStatus === 'ACTIVE' ? 'active' : 'disabled',
        updateFrequencyDays: 7,
        authRequired: false,
        legalStatusNotice: isWebsiteFallbackOnly
          ? `Import direct de pe pagina web oficială ${name.trim()} atunci când catalogul dedicat nu este disponibil.`
          : `Catalog oficial ${name.trim()}; configurat manual de administrator.`
      };

      const sourceSaved = await DatabaseService.saveCatalogSource(createdSource);
      if (!sourceSaved) {
        throw new Error('Sursa inițială de catalog nu a putut fi salvată în baza de date.');
      }

      const sources = StorageService.getCatalogSources();
      if (!sources.some(s => s.id === createdSource!.id)) {
        sources.push(createdSource);
        StorageService.saveCatalogSources(sources);
      }
    }

    res.json({
      success: true,
      retailer: {
        id: cleanId,
        name: name.trim(),
        chain: newStore.chain,
        officialUrl: newStore.officialUrl,
        format,
        defaultStatus,
        color,
        type: newStore.type
      },
      source: createdSource,
      message: `Retailerul "${name.trim()}" a fost salvat cu succes.`
    });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Există deja un retailer cu acest identificator sau slug.' });
    }
    console.error('Eroare adăugare retailer:', err);
    res.status(500).json({ error: err?.message || 'Eroare la adăugarea retailerului.' });
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
    const rawOfficialUrl = typeof req.body?.officialUrl === 'string'
      ? req.body.officialUrl.trim()
      : (typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl.trim() : undefined);
    const allowedStoreTypes = ['discounter', 'hypermarket', 'supermarket', 'proximity'];
    const allowedColors = ['blue', 'red', 'sky', 'amber', 'rose', 'emerald', 'purple', 'yellow', 'indigo', 'slate'];

    if (!name) return res.status(400).json({ error: 'Numele retailerului este obligatoriu.' });
    if (!retailerId) return res.status(400).json({ error: 'Identificatorul retailerului este obligatoriu.' });
    if (!allowedStoreTypes.includes(storeType)) return res.status(400).json({ error: 'Tipul magazinului nu este valid.' });
    if (!allowedColors.includes(color)) return res.status(400).json({ error: 'Culoarea retailerului nu este validă.' });

    if (rawOfficialUrl) {
      const siteSafety = CatalogDownloader.validatePublicUrlSafety(rawOfficialUrl);
      if (!siteSafety.safe) {
        return res.status(400).json({ error: `Adresă pagină web oficială nesigură: ${siteSafety.reason}` });
      }
    }

    const brandColor = `bg-${color}-600`;
    const accentColor = `text-${color}-600`;
    const pool = getPool();
    let updatedStore: any;

    if (pool) {
      const runPgUpdate = async () => {
        const result = rawOfficialUrl !== undefined
          ? await pool.query(
              `UPDATE stores
               SET name = $1, chain = $2, brand_color = $3, accent_color = $4, store_type = $5, official_url = $6
               WHERE id = $7
               RETURNING id, name, slug, chain, brand_color, accent_color, store_type, official_url`,
              [name, chain, brandColor, accentColor, storeType, rawOfficialUrl || null, retailerId]
            )
          : await pool.query(
              `UPDATE stores
               SET name = $1, chain = $2, brand_color = $3, accent_color = $4, store_type = $5
               WHERE id = $6
               RETURNING id, name, slug, chain, brand_color, accent_color, store_type, official_url`,
              [name, chain, brandColor, accentColor, storeType, retailerId]
            );
        return result.rows[0];
      };

      try {
        updatedStore = await runPgUpdate();
      } catch (pgErr: any) {
        if (pgErr?.code === '42703') {
          await pool.query('ALTER TABLE stores ADD COLUMN IF NOT EXISTS official_url TEXT');
          updatedStore = await runPgUpdate();
        } else {
          throw pgErr;
        }
      }

      if (updatedStore) {
        const readBack = await pool.query(
          `SELECT id, name, slug, chain, brand_color, accent_color, store_type, official_url
           FROM stores WHERE id = $1`,
          [retailerId]
        );
        const verifiedRow = readBack.rows[0];
        if (!verifiedRow) {
          throw new Error('Retailerul actualizat nu a putut fi verificat la recitirea din PostgreSQL.');
        }
        if (rawOfficialUrl !== undefined && (rawOfficialUrl || null) !== (verifiedRow.official_url || null)) {
          throw new Error('Actualizarea câmpului official_url nu a putut fi confirmată în PostgreSQL.');
        }
        updatedStore = verifiedRow;
      }
    } else {
      const updatePayload: Record<string, any> = {
        name,
        chain,
        brand_color: brandColor,
        accent_color: accentColor,
        store_type: storeType
      };
      if (rawOfficialUrl !== undefined) {
        updatePayload.official_url = rawOfficialUrl || null;
      }

      const { data, error } = await supabase
        .from('stores')
        .update(updatePayload)
        .eq('id', retailerId)
        .select('id, name, slug, chain, brand_color, accent_color, store_type, official_url')
        .maybeSingle();
      if (error) throw error;
      updatedStore = data;

      if (updatedStore) {
        const { data: verifiedRow, error: readBackError } = await supabase
          .from('stores')
          .select('id, name, slug, chain, brand_color, accent_color, store_type, official_url')
          .eq('id', retailerId)
          .maybeSingle();
        if (readBackError || !verifiedRow) {
          throw readBackError || new Error('Retailerul actualizat nu a putut fi verificat la recitirea din Supabase.');
        }
        if (rawOfficialUrl !== undefined && (rawOfficialUrl || null) !== (verifiedRow.official_url || null)) {
          throw new Error('Actualizarea câmpului official_url nu a putut fi confirmată în Supabase.');
        }
        updatedStore = verifiedRow;
      }
    }

    const existingLocal = StorageService.getStores().find(s => s.id === retailerId);
    if (!updatedStore && !existingLocal) {
      return res.status(404).json({ error: 'Retailerul nu a fost găsit.' });
    }

    const resolvedOfficialUrl = rawOfficialUrl !== undefined
      ? (updatedStore ? (updatedStore.official_url || undefined) : (rawOfficialUrl || undefined))
      : (updatedStore?.official_url || existingLocal?.officialUrl || existingLocal?.websiteUrl);

    StorageService.saveCustomStore({
      id: retailerId,
      name: updatedStore?.name || name,
      slug: updatedStore?.slug || retailerId,
      chain: updatedStore?.chain || chain,
      brandColor: updatedStore?.brand_color || brandColor,
      accentColor: updatedStore?.accent_color || accentColor,
      officialUrl: resolvedOfficialUrl,
      websiteUrl: resolvedOfficialUrl,
      type: (updatedStore?.store_type || storeType) as any,
      rating: existingLocal?.rating || 4.5,
      locationsCount: existingLocal?.locationsCount || 1,
      sampleAddress: existingLocal?.sampleAddress || 'România',
      isPartner: existingLocal?.isPartner || false
    });

    const retailer = {
      id: updatedStore?.id || retailerId,
      name: updatedStore?.name || name,
      slug: updatedStore?.slug || retailerId,
      chain: updatedStore?.chain || chain,
      officialUrl: resolvedOfficialUrl,
      format: (updatedStore?.chain || chain)?.toUpperCase().includes('PDF') ? 'PDF' : 'HTML & PDF',
      defaultStatus: 'ACTIVE',
      color,
      brandColor: updatedStore?.brand_color || brandColor,
      accentColor: updatedStore?.accent_color || accentColor,
      type: updatedStore?.store_type || storeType
    };

    return res.json({ success: true, retailer, message: `Retailerul "${name}" a fost actualizat cu succes.` });
  } catch (err: any) {
    console.error('Eroare actualizare retailer:', err);
    return res.status(500).json({ error: err?.message || 'Eroare la actualizarea retailerului.' });
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

    const additionalAllowedDomains: string[] = [];
    const registeredStores = [
      ...(await DatabaseService.getStores().catch(() => [] as Store[])),
      ...StorageService.getStores()
    ];
    const targetStore = registeredStores.find(s => s.id === retailerId);
    const storeUrl = targetStore?.officialUrl || targetStore?.websiteUrl;
    if (storeUrl) {
      try {
        additionalAllowedDomains.push(new URL(storeUrl).hostname.replace(/^www\./, '').toLowerCase());
      } catch {}
    }

    const safety = CatalogDownloader.validateUrlSafety(catalogUrl, additionalAllowedDomains);
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

// 6. Declanșare descoperire documente noi (inclusiv fallback pe pagina web oficială)
app.post('/api/admin/catalog-importer/discover', requireAdminAuth, async (req, res) => {
  try {
    const { retailerId } = req.body || {};
    let sources: CatalogSource[] = [];
    let websiteUrlOverride: string | undefined;

    if (retailerId) {
      const ctx = await CatalogStagingManager.resolveRetailerImportContext(retailerId);
      sources = ctx.activeSources;
      websiteUrlOverride = ctx.websiteUrl;
    } else {
      const localSources = StorageService.getCatalogSources();
      const dbSources = await DatabaseService.getCatalogSources().catch(() => [] as CatalogSource[]);
      const mergedById = new Map<string, CatalogSource>();
      for (const s of localSources) mergedById.set(s.id, s);
      for (const s of dbSources) mergedById.set(s.id, s);
      sources = Array.from(mergedById.values()).filter(s => s.status !== 'disabled');
    }

    const allStores = [
      ...(await DatabaseService.getStores().catch(() => [] as Store[])),
      ...StorageService.getStores()
    ];

    const discoveredTotal: CatalogDocument[] = [];
    for (const src of sources) {
      const storeMatch = allStores.find(s => s.id === src.retailerId);
      const docs = await CatalogSourceDiscovery.discoverDocumentsForSource(src, {
        websiteUrl: websiteUrlOverride || storeMatch?.officialUrl || storeMatch?.websiteUrl
      });
      for (const d of docs) {
        StorageService.addCatalogDocument(d);
        discoveredTotal.push(d);
      }
    }

    res.json({
      success: true,
      message: `Au fost descoperite ${discoveredTotal.length} documente / pagini web de catalog.`,
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

// 7b. Previzualizare exactă a surselor care pot fi rulate
app.get('/api/admin/catalog-importer/active-sources', requireAdminAuth, async (req, res) => {
  try {
    const sources = await CatalogStagingManager.getActiveCatalogSources();
    res.json({ success: true, sources, count: sources.length });
  } catch (err: any) {
    res.status(500).json({ error: `Eroare la obținerea surselor active: ${err.message}` });
  }
});

// 7c. Rulare Import pentru toate sursele active
app.post('/api/admin/catalog-importer/run-active', requireAdminAuth, async (req, res) => {
  try {
    const sourceIds = req.body?.sourceIds;
    if (sourceIds !== undefined && (!Array.isArray(sourceIds) || sourceIds.some((id: unknown) => typeof id !== 'string'))) {
      return res.status(400).json({ error: 'Lista surselor active selectate este invalidă.' });
    }
    const result = await CatalogStagingManager.runActiveImports(sourceIds);
    res.json({
      success: true,
      message: `Rularea celor ${result.totalSourcesProcessed} surse active a fost finalizată: ${result.totalExtracted} oferte extrase, ${result.totalPublished} publicate.`,
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
    const retailerId = (req.query.retailerId as string) || (req.query.retailer as string) || 'toate';
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

// 9.1. Aprobare & Validare sau respingere în masă a ofertelor din Staging (Bulk Review)
app.post('/api/admin/catalog-importer/staging/bulk-review', requireAdminAuth, async (req, res) => {
  try {
    const { offerIds, action, rejectionReason } = req.body;
    if (!Array.isArray(offerIds) || offerIds.length === 0) {
      return res.status(400).json({ error: 'Selectați cel puțin o ofertă pentru procesare.' });
    }
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Acțiunea trebuie să fie "approve" sau "reject".' });
    }

    const userEmail = (req.body?.userEmail as string) || 'admin@cosulmeu.ro';
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;

    if (isPostgresConfigured() && getPool()) {
      const result = await DatabaseService.bulkReviewStagingOffers({
        offerIds,
        action,
        rejectionReason,
        userEmail,
        ipAddress
      });

      if (action === 'approve') {
        for (const approvedId of result.approvedIds) {
          StorageService.updateCatalogExtractedOffer(approvedId, {
            stagingStatus: 'APPROVED',
            validationErrors: undefined,
            rejectionReason: undefined,
            reviewedBy: userEmail,
            reviewedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
        for (const failed of result.failedItems) {
          StorageService.updateCatalogExtractedOffer(failed.id, {
            validationErrors: failed.errors,
            updatedAt: new Date().toISOString()
          });
        }

        if (result.approvedIds.length === 0 && result.failedCount > 0) {
          return res.status(422).json({
            success: false,
            partial: false,
            updatedCount: 0,
            approvedIds: [],
            failedCount: result.failedCount,
            failedItems: result.failedItems,
            error: result.message,
            message: result.message
          });
        }
      } else {
        for (const oid of offerIds) {
          const existing = StorageService.getCatalogExtractedOffers().find(o => o.id === oid);
          if (existing && String(existing.stagingStatus).toUpperCase() !== 'PUBLISHED') {
            StorageService.updateCatalogExtractedOffer(oid, {
              stagingStatus: 'REJECTED',
              rejectionReason: rejectionReason || 'Respins manual în lot de administrator.',
              reviewedBy: userEmail,
              reviewedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          }
        }
      }

      return res.json({
        success: true,
        partial: result.failedCount > 0,
        updatedCount: result.count,
        approvedIds: result.approvedIds,
        failedCount: result.failedCount,
        failedItems: result.failedItems,
        message: result.message
      });
    }

    // Fallback în memorie când PostgreSQL nu este activ
    const allStaged = StorageService.getCatalogExtractedOffers();
    const todayStr = new Date().toISOString().split('T')[0];
    const approvedIds: string[] = [];
    const failedItems: Array<{ id: string; rawTitle: string; errors: string[] }> = [];
    let rejectedCount = 0;

    for (const oid of offerIds) {
      const target = allStaged.find(o => o.id === oid);
      if (!target) continue;
      const statusUpper = String(target.stagingStatus || 'NEEDS_REVIEW').toUpperCase();
      if (statusUpper === 'PUBLISHED') {
        failedItems.push({
          id: oid,
          rawTitle: target.rawTitle || oid,
          errors: ['Oferta este deja publicată în catalogul public.']
        });
        continue;
      }

      if (action === 'reject') {
        StorageService.updateCatalogExtractedOffer(oid, {
          stagingStatus: 'REJECTED',
          rejectionReason: rejectionReason || 'Respins manual în lot de administrator.',
          reviewedBy: userEmail,
          reviewedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        rejectedCount++;
      } else {
        const errs: string[] = [];
        if (!target.rawTitle || target.rawTitle.trim().length < 2) errs.push('Denumirea produsului lipsește.');
        if (!Number.isFinite(target.effectivePrice) || target.effectivePrice <= 0) errs.push('Prețul efectiv trebuie să fie pozitiv (> 0).');
        if (target.normalPrice > 0 && target.effectivePrice > target.normalPrice + 0.01) errs.push('Prețul efectiv depășește prețul normal.');
        if (target.rawBarcode && !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(target.rawBarcode.trim())) errs.push('Cod EAN invalid.');
        if (target.validUntil && target.validUntil < todayStr) errs.push(`Ofertă expirată (${target.validUntil}).`);

        if (errs.length > 0) {
          StorageService.updateCatalogExtractedOffer(oid, {
            stagingStatus: 'NEEDS_REVIEW',
            validationErrors: errs,
            updatedAt: new Date().toISOString()
          });
          failedItems.push({ id: oid, rawTitle: target.rawTitle || oid, errors: errs });
        } else {
          StorageService.updateCatalogExtractedOffer(oid, {
            stagingStatus: 'APPROVED',
            validationErrors: undefined,
            rejectionReason: undefined,
            reviewedBy: userEmail,
            reviewedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          approvedIds.push(oid);
        }
      }
    }

    if (action === 'approve' && approvedIds.length === 0 && failedItems.length > 0) {
      return res.status(422).json({
        success: false,
        partial: false,
        updatedCount: 0,
        approvedIds: [],
        failedCount: failedItems.length,
        failedItems,
        error: `Nicio ofertă nu a trecut validarea (${failedItems.length} cu erori).`,
        message: `Nicio ofertă nu a trecut validarea (${failedItems.length} cu erori).`
      });
    }

    const updatedCount = action === 'approve' ? approvedIds.length : rejectedCount;
    res.json({
      success: true,
      partial: failedItems.length > 0,
      updatedCount,
      approvedIds,
      failedCount: failedItems.length,
      failedItems,
      message: action === 'approve'
        ? `${approvedIds.length} oferte au fost validate și aprobate.${failedItems.length > 0 ? ` ${failedItems.length} au rămas cu erori de validare.` : ''}`
        : `${rejectedCount} oferte au fost respinse.`
    });
  } catch (err: any) {
    console.error('Eroare bulk-review staging:', err.message);
    res.status(500).json({ error: err.message || 'Eroare la procesarea în lot a ofertelor.' });
  }
});

// 9.2. Drill-down: Oferte Aprobate
app.get('/api/admin/catalog-importer/approved-offers', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const retailerId = (req.query.retailerId as string) || (req.query.retailer as string);
    const search = req.query.search as string;

    const result = await DatabaseService.getApprovedOffersDetailed({ page, limit, retailerId, search });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea ofertelor aprobate.' });
  }
});

// 9.3. Drill-down: Oferte Publicate
app.get('/api/admin/catalog-importer/public-offers', requireAdminAuth, async (req, res) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const retailerId = (req.query.retailerId as string) || (req.query.retailer as string);
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
    const retailerId = (req.query.retailerId as string) || (req.query.retailer as string);
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
    const retailerId = (req.query.retailerId as string) || (req.query.retailer as string);
    const search = req.query.search as string;

    const result = await DatabaseService.getItemsWithoutPriceDetailed({ page, limit, retailerId, search });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la obținerea produselor fără preț.' });
  }
});

// 10. Validare, aprobare sau respingere manuală ofertă individuală din Staging
app.post('/api/admin/catalog-importer/staging/:id/review', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, matchedProductId, rejectionReason } = req.body;
    const userEmail = (req.body?.userEmail as string) || 'admin@cosulmeu.ro';
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Acțiune invalidă. Este necesar "approve" sau "reject".' });
    }

    if (isPostgresConfigured() && getPool()) {
      const result = await DatabaseService.reviewSingleStagingOffer({
        offerId: id,
        action,
        matchedProductId,
        rejectionReason,
        userEmail,
        ipAddress
      });

      if (result.notFound) {
        return res.status(404).json({ success: false, error: result.message });
      }
      if (!result.success) {
        StorageService.updateCatalogExtractedOffer(id, {
          validationErrors: result.validationErrors,
          updatedAt: new Date().toISOString()
        });
        return res.status(422).json({
          success: false,
          error: result.message,
          validationErrors: result.validationErrors || [result.message],
          message: result.message
        });
      }

      if (result.offer) {
        StorageService.updateCatalogExtractedOffer(id, result.offer);
      }

      return res.json({
        success: true,
        offer: result.offer,
        message: result.message
      });
    }

    // Fallback în memorie când PostgreSQL nu este configurat
    const existingOffers = StorageService.getCatalogExtractedOffers();
    const targetOffer = existingOffers.find(o => o.id === id);
    if (!targetOffer) {
      return res.status(404).json({ error: 'Oferta nu a fost găsită în staging.' });
    }

    if (action === 'approve') {
      const todayStr = new Date().toISOString().split('T')[0];
      const errs: string[] = [];
      if (String(targetOffer.stagingStatus || '').toUpperCase() === 'PUBLISHED') {
        errs.push('Oferta este deja publicată în catalogul public.');
      }
      if (!targetOffer.rawTitle || targetOffer.rawTitle.trim().length < 2) {
        errs.push('Denumirea produsului lipsește sau are mai puțin de 2 caractere.');
      }
      if (!Number.isFinite(targetOffer.effectivePrice) || targetOffer.effectivePrice <= 0) {
        errs.push('Prețul efectiv trebuie să fie pozitiv (> 0).');
      }
      if (targetOffer.normalPrice > 0 && targetOffer.effectivePrice > targetOffer.normalPrice + 0.01) {
        errs.push('Prețul efectiv nu poate depăși prețul normal.');
      }
      if (targetOffer.rawBarcode && !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(targetOffer.rawBarcode.trim())) {
        errs.push(`Codul de bare EAN „${targetOffer.rawBarcode}” este invalid.`);
      }
      if (targetOffer.validUntil && targetOffer.validUntil < todayStr) {
        errs.push(`Oferta este expirată (valabilă până la ${targetOffer.validUntil}).`);
      }

      if (errs.length > 0) {
        StorageService.updateCatalogExtractedOffer(id, {
          stagingStatus: String(targetOffer.stagingStatus).toUpperCase() === 'PUBLISHED' ? 'PUBLISHED' : 'NEEDS_REVIEW',
          validationErrors: errs,
          updatedAt: new Date().toISOString()
        });
        return res.status(422).json({
          success: false,
          error: `Oferta nu a trecut validarea: ${errs.join(' ')}`,
          validationErrors: errs,
          message: `Oferta nu a trecut validarea: ${errs.join(' ')}`
        });
      }

      const updateData: any = {
        stagingStatus: 'APPROVED',
        validationErrors: undefined,
        rejectionReason: undefined,
        reviewedBy: userEmail,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (matchedProductId) {
        updateData.matchedProductId = matchedProductId;
        const prod = StorageService.getAllProducts().find(p => p.id === matchedProductId);
        if (prod) updateData.matchedProductName = prod.name;
        updateData.matchMethod = 'manual';
        updateData.matchConfidence = 1.0;
      }

      const updated = StorageService.updateCatalogExtractedOffer(id, updateData);
      return res.json({
        success: true,
        offer: updated || { id, ...updateData },
        message: 'Oferta a fost validată, aprobată și adăugată în lista de publicare.'
      });
    } else {
      const rejectionUpdates = {
        stagingStatus: 'REJECTED' as const,
        rejectionReason: rejectionReason || 'Respinsă manual de administrator.',
        reviewedBy: userEmail,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const updated = StorageService.updateCatalogExtractedOffer(id, rejectionUpdates);
      return res.json({
        success: true,
        offer: updated || { id, ...rejectionUpdates },
        message: 'Oferta a fost respinsă și exclusă de la publicare.'
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Eroare la revizuirea ofertei.' });
  }
});

// 11. Publicare atomică a ofertelor validate și aprobate în catalogul public
app.post('/api/admin/catalog-importer/publish-validated', requireAdminAuth, async (req, res) => {
  try {
    const { offerIds, previewSnapshotHash, userEmail } = req.body || {};
    const actorEmail = (userEmail as string) || 'admin@cosulmeu.ro';
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;

    const pubResult = await CatalogStagingManager.publishValidatedOffers(offerIds, {
      previewSnapshotHash,
      userEmail: actorEmail
    });

    if (pubResult.conflict) {
      await DatabaseService.logAdminActivity({
        userEmail: actorEmail,
        action: 'publish_validated_conflict',
        targetType: 'staging_offers',
        targetId: Array.isArray(offerIds) ? offerIds.slice(0, 5).join(',') : 'all_ready_to_publish',
        details: {
          conflict: true,
          errors: pubResult.errors
        },
        ipAddress
      });

      return res.status(409).json({
        success: false,
        conflict: true,
        requiresRefreshPreview: Boolean(pubResult.requiresRefreshPreview),
        publishedCount: 0,
        publishedOfferIds: [],
        errors: pubResult.errors,
        error: pubResult.errors[0] || 'Lista ofertelor s-a modificat între previzualizare și confirmare.',
        message: pubResult.errors[0] || 'Lista ofertelor s-a modificat între previzualizare și confirmare. Reîmprospătați previzualizarea.'
      });
    }

    const persistedProductCount = isPostgresConfigured()
      ? (await DatabaseService.getProducts()).length
      : StorageService.getAllProducts().length;
    const persistedOfferCount = isPostgresConfigured()
      ? (await DatabaseService.getOffers()).length
      : StorageService.getProductOffers().length;
    const persisted = pubResult.errors.length === 0;

    await DatabaseService.logAdminActivity({
      userEmail: actorEmail,
      action: 'publish_validated_offers',
      targetType: 'staging_offers',
      targetId: offerIds ? (Array.isArray(offerIds) ? offerIds.slice(0, 5).join(',') : String(offerIds)) : 'all_validated',
      details: {
        publishedCount: pubResult.publishedCount,
        publishedOfferIds: pubResult.publishedOfferIds.slice(0, 20),
        persistedProductCount,
        persistedOfferCount,
        errorsCount: pubResult.errors.length,
        result: persisted ? 'SUCCESS' : 'WARNINGS'
      },
      ipAddress
    });

    res.json({
      success: persisted,
      publishedCount: pubResult.publishedCount,
      publishedOfferIds: pubResult.publishedOfferIds,
      persistedProductCount,
      persistedOfferCount,
      errors: pubResult.errors,
      message: persisted
        ? `Au fost publicate ${pubResult.publishedCount} oferte validate în catalogul public. Produsele sunt salvate și indexate.`
        : `Publicarea a fost finalizată cu avertismente: ${pubResult.errors.join('; ')}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Eroare la publicarea ofertelor validate.' });
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

// 13.2 Ștergere / Delistare produs individual (fail-safe: nu șterge și nu modifică price_observations)
app.delete('/api/admin/products/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID-ul produsului este obligatoriu.' });
    const result = await DatabaseService.deleteProducts([id]);
    if (result.partialModification) {
      return res.status(500).json({
        success: false,
        deletedCount: result.deletedCount,
        blockedCount: result.blockedCount || 0,
        blockedIds: result.blockedIds || [],
        partialModification: true,
        partialDeletions: result.partialDeletions || [],
        error: result.error || 'Ștergerea a eșuat parțial după mutații anterioare.'
      });
    }
    if ((result.blockedCount || 0) > 0) {
      return res.status(409).json({
        success: false,
        deletedCount: 0,
        blockedCount: result.blockedCount,
        blockedIds: result.blockedIds,
        partialModification: false,
        error: result.error || 'Produsul are observații istorice protejate în price_observations și nu poate fi șters.'
      });
    }
    if (result.error) {
      return res.status(500).json({
        success: false,
        deletedCount: result.deletedCount,
        blockedCount: result.blockedCount || 0,
        blockedIds: result.blockedIds || [],
        partialModification: false,
        error: result.error
      });
    }
    if (!isPostgresConfigured() && process.env.COSUL_MEU_ISOLATED_TEST !== '1') {
      StorageService.deleteProducts([id]);
    }
    res.json({
      success: result.deletedCount > 0,
      deletedCount: result.deletedCount,
      partialModification: false,
      message: result.deletedCount > 0
        ? 'Produsul a fost delistat și șters cu succes din catalog.'
        : 'Produsul nu a putut fi șters sau nu există în catalog.'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la ștergerea produsului.' });
  }
});

// 13.3 Ștergere / Delistare produse în masă (Bulk Delete fail-safe)
app.post('/api/admin/products/bulk-delete', requireAdminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Lista de ID-uri de produse este obligatorie.' });
    }
    const result = await DatabaseService.deleteProducts(ids);
    if (result.partialModification) {
      return res.status(500).json({
        success: false,
        count: result.deletedCount,
        deletedCount: result.deletedCount,
        blockedCount: result.blockedCount || 0,
        blockedIds: result.blockedIds || [],
        partialModification: true,
        partialDeletions: result.partialDeletions || [],
        error: result.error || 'Ștergerea în masă a eșuat parțial după mutații anterioare.'
      });
    }
    if ((result.blockedCount || 0) > 0 && result.deletedCount === 0) {
      return res.status(409).json({
        success: false,
        count: 0,
        deletedCount: 0,
        blockedCount: result.blockedCount,
        blockedIds: result.blockedIds,
        partialModification: false,
        error: result.error || 'Ștergerea a fost blocată deoarece produsele selectate au observații istorice protejate.'
      });
    }
    if (result.error && (result.blockedCount || 0) === 0) {
      return res.status(500).json({
        success: false,
        count: result.deletedCount,
        deletedCount: result.deletedCount,
        blockedCount: 0,
        blockedIds: [],
        partialModification: false,
        error: result.error
      });
    }
    const blockedSet = new Set(result.blockedIds || []);
    if (!isPostgresConfigured() && process.env.COSUL_MEU_ISOLATED_TEST !== '1' && !result.error) {
      const eligibleIds = ids.filter((id: string) => !blockedSet.has(id));
      if (eligibleIds.length > 0) {
        StorageService.deleteProducts(eligibleIds);
      }
    }
    res.json({
      success: true,
      count: result.deletedCount,
      deletedCount: result.deletedCount,
      blockedCount: result.blockedCount || 0,
      blockedIds: result.blockedIds || [],
      partialModification: false,
      ...(result.error ? { warning: result.error } : {}),
      message: `Au fost delistate și șterse ${result.deletedCount} produse din catalog.`
    });
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

// 13.4.0 Faza 1A: Raport read-only de calitate a datelor catalog (brand, cantitate/multipack, titlu, barcode GS1)
app.get('/api/admin/catalog-quality/report', requireAdminAuth, async (req, res) => {
  try {
    const rawLimit = req.query.sampleLimit;
    const parsedLimit = rawLimit !== undefined ? Number.parseInt(String(rawLimit), 10) : 15;
    if (Number.isNaN(parsedLimit) || parsedLimit < 5 || parsedLimit > 50) {
      return res.status(400).json({ error: 'Parametrul sampleLimit trebuie să fie între 5 și 50.' });
    }
    const report = await DatabaseService.getCatalogQualityAuditReport({ sampleLimit: parsedLimit });
    res.json({ success: true, report });
  } catch {
    res.status(500).json({ error: 'Eroare la generarea raportului read-only de calitate a datelor.' });
  }
});

// 13.4.0-B Faza 1B: Raport read-only Shadow Matching & detectare produse duplicate cross-retailer (zero mutații)
app.get('/api/admin/shadow-matching/report', requireAdminAuth, async (req, res) => {
  try {
    const parsed = shadowMatchingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Parametri invalizi pentru raportul Shadow Matching.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const report = await DatabaseService.getShadowMatchingReport(parsed.data);
    res.json({ success: true, report });
  } catch {
    res.status(500).json({ error: 'Eroare la generarea raportului read-only Shadow Matching.' });
  }
});

// 13.4.0-C Faza 1B: Persistență explicită și idempotentă a candidaților Shadow în `product_match_candidates` (strict pending_confirmation, fără auto-merge)
app.post('/api/admin/shadow-matching/persist', requireAdminAuth, async (req, res) => {
  try {
    const parsed = shadowMatchingPersistSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Date invalide pentru salvarea candidaților Shadow Matching.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const report = await DatabaseService.getShadowMatchingReport({
      maxReportCandidates: parsed.data.maxCandidates
    });
    const result = await DatabaseService.saveShadowMatchCandidatesToExistingSchema(
      report.candidates.slice(0, parsed.data.maxCandidates),
      { allowCategories: parsed.data.allowCategories }
    );
    res.json({
      success: true,
      autoMergeExecuted: false,
      result
    });
  } catch {
    res.status(500).json({ error: 'Eroare la salvarea explicită a candidaților Shadow Matching.' });
  }
});

// 13.4.0-D Faza 2: Human Review Panel — Listare candidați cu filtrare, sortare, paginare și sumar
function extractVerifiedAdminReviewer(req: express.Request): VerifiedAdminReviewer {
  return {
    reviewerId: 'admin-bearer-authenticated',
    reviewerEmail: 'admin@system.local',
    authSource: 'admin_bearer_token',
    ipAddress: req.ip || 'unknown'
  };
}

app.get('/api/admin/shadow-matching/reviews', requireAdminAuth, async (req, res) => {
  try {
    const parsed = shadowReviewListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Parametri invalizi pentru listarea candidaților Shadow Review.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const result = await ShadowReviewService.listCandidates(parsed.data);
    res.json({ success: true, ...result });
  } catch {
    res.status(500).json({ error: 'Eroare la încărcarea listei de Human Review pentru candidații Shadow Matching.' });
  }
});

// 13.4.0-E Faza 2: Human Review Panel — Detaliu side-by-side candidat + istoric review
app.get('/api/admin/shadow-matching/reviews/:candidateId', requireAdminAuth, async (req, res) => {
  try {
    const candidateId = String(req.params.candidateId || '').trim();
    if (!candidateId || candidateId.length > 80) {
      return res.status(400).json({ error: 'ID candidat invalid.' });
    }
    const detail = await ShadowReviewService.getCandidateDetail(candidateId);
    if (!detail.found) {
      return res.status(404).json({ error: detail.error });
    }
    res.json({ success: true, ...detail });
  } catch {
    res.status(500).json({ error: 'Eroare la încărcarea detaliilor candidatului Shadow Matching.' });
  }
});

// 13.4.0-F Faza 2: Human Review Panel — Trimitere decizie human review (strict fără merge)
app.post('/api/admin/shadow-matching/reviews/:candidateId/decision', requireAdminAuth, async (req, res) => {
  try {
    const candidateId = String(req.params.candidateId || '').trim();
    if (!candidateId || candidateId.length > 80) {
      return res.status(400).json({ error: 'ID candidat invalid.' });
    }

    const parsed = shadowReviewDecisionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Date invalide pentru decizia de Human Review.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }

    const result = await ShadowReviewService.submitDecision({
      candidateId,
      status: parsed.data.status,
      reason: parsed.data.reason,
      notes: parsed.data.notes ?? null,
      expectedVersion: parsed.data.expectedVersion,
      reviewer: extractVerifiedAdminReviewer(req)
    });

    if (!result.ok) {
      return res.status(result.statusCode).json({
        success: false,
        code: result.code,
        error: result.error,
        currentVersion: result.currentVersion,
        currentDecision: result.currentDecision
      });
    }

    res.json({
      success: true,
      idempotentReplay: result.idempotentReplay,
      autoMergeExecuted: false,
      candidate: result.candidate,
      decision: result.decision,
      auditEntry: result.auditEntry
    });
  } catch {
    res.status(500).json({ error: 'Eroare la salvarea deciziei de Human Review.' });
  }
});

// 13.4.0-G Faza 2: Human Review Panel — Jurnal audit decizii (append-only)
app.get('/api/admin/shadow-matching/audit', requireAdminAuth, async (req, res) => {
  try {
    const parsed = shadowReviewAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Parametri invalizi pentru istoricul de audit Shadow Review.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const audit = await ShadowReviewService.listAuditEntries(parsed.data);
    res.json({ success: true, autoMergeExecuted: false, ...audit });
  } catch {
    res.status(500).json({ error: 'Eroare la încărcarea jurnalului de audit Shadow Review.' });
  }
});

// 13.4.1 Audit Prețuri vs Cantitate și Corectare Importuri
app.get('/api/admin/price-audit', requireAdminAuth, async (req, res) => {
  try {
    const parsed = priceAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Parametri de filtrare audit invalizi.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const result = await PriceAuditService.getPriceAuditData(parsed.data);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la încărcarea datelor de audit prețuri.' });
  }
});

// 13.4.2 Previzualizare lot remediere prețuri (dry-run)
app.post('/api/admin/price-audit/preview-batch', requireAdminAuth, async (req, res) => {
  try {
    const parsed = priceAuditRemediationRequestSchema.safeParse({ ...req.body, dryRun: true });
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Date invalide pentru previzualizarea remedierii.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const workItems = parsed.data.items ?? [
      {
        offerId: parsed.data.offerId!,
        action: parsed.data.action!,
        newPrice: parsed.data.newPrice,
        newNormalPrice: parsed.data.newNormalPrice,
        newPromoPrice: parsed.data.newPromoPrice,
        reason: parsed.data.reason
      }
    ];
    const result = await PriceAuditService.remediateOffers({
      items: workItems,
      dryRun: true,
      userEmail: parsed.data.userEmail || 'admin@cosulmeu.ro',
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la generarea previzualizării de remediere.' });
  }
});

// 13.4.3 Aplicare remediere prețuri / izolare oferte / validare manuală
app.post('/api/admin/price-audit/remediate', requireAdminAuth, async (req, res) => {
  try {
    const parsed = priceAuditRemediationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Date invalide pentru remedierea prețurilor.',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      });
    }
    const workItems = parsed.data.items ?? [
      {
        offerId: parsed.data.offerId!,
        action: parsed.data.action!,
        newPrice: parsed.data.newPrice,
        newNormalPrice: parsed.data.newNormalPrice,
        newPromoPrice: parsed.data.newPromoPrice,
        reason: parsed.data.reason
      }
    ];
    const result = await PriceAuditService.remediateOffers({
      items: workItems,
      dryRun: parsed.data.dryRun,
      userEmail: parsed.data.userEmail || 'admin@cosulmeu.ro',
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });
    if (!result.success && result.affectedOffersCount === 0 && !parsed.data.dryRun) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Eroare la aplicarea remedierii de prețuri.' });
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
    invalidateCatalogOptimizationCache();

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
        usedWebsiteFallback: Boolean(result.usedWebsiteFallback),
        documentUrl: result.documentUrl,
        error: result.error
      },
      ipAddress: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress
    });

    const entityLabel = result.sampleOffers.length === 0 && result.totalExtracted > 0 ? 'produse' : 'oferte';
    const message = result.success
      ? result.usedWebsiteFallback
        ? `Catalogul dedicat a fost indisponibil; import executat de pe pagina web a retailerului (${result.documentUrl || retailerId}): ${result.totalExtracted} ${entityLabel} extrase, ${result.autoMatched} potrivite, ${result.published} publicate.`
        : `Import finalizat pentru ${retailerId.toUpperCase()}: ${result.totalExtracted} ${entityLabel} extrase, ${result.autoMatched} potrivite, ${result.published} publicate.`
      : (result.error || `Importul pentru ${retailerId.toUpperCase()} nu a putut extrage oferte.`);

    res.json({ success: result.success, result, message });
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
    invalidateCatalogOptimizationCache();
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Eroare la declanșarea colectării.' });
  }
});

// =========================================================================
// V2 PERSONAL SHOPPING ASSISTANT ENDPOINTS
// =========================================================================

const inMemoryBarcodeSuggestions: Array<Record<string, any>> = [];

async function loadV2CatalogDataset(includeObservations = false): Promise<{
  products: Product[];
  offers: ProductOffer[];
  stores: Store[];
  observations: any[];
  aliasMap: CanonicalAliasIndex;
  retailerProducts: RetailerProductRecord[];
}> {
  if (isPostgresConfigured()) {
    try {
      const [products, offers, stores, observations, aliasMap, retailerProducts] = await Promise.all([
        DatabaseService.getProducts(),
        DatabaseService.getOffers(),
        DatabaseService.getStores(),
        includeObservations ? DatabaseService.getPriceObservations() : Promise.resolve([]),
        DatabaseService.getProductAliasIndex(),
        DatabaseService.getRetailerProductsWithBarcodes()
      ]);
      if (products.length > 0) {
        return { products, offers, stores, observations, aliasMap, retailerProducts };
      }
    } catch {
      // Fallback to local catalog
    }
  }
  if (process.env.COSUL_MEU_ISOLATED_TEST === '1') {
    const [products, offers, aliasMap] = await Promise.all([
      DatabaseService.getProducts(),
      DatabaseService.getOffers(),
      DatabaseService.getProductAliasIndex()
    ]);
    const retailerProducts = StorageService.getRetailerProducts();
    return {
      products,
      offers,
      stores: STORES,
      observations: includeObservations ? StorageService.getPriceObservations() : [],
      aliasMap,
      retailerProducts
    };
  }
  const rawProducts = StorageService.getAllProducts();
  const dbAliasIndex = await DatabaseService.getProductAliasIndex().catch(() => buildCanonicalAliasIndex([]));
  const aliasMap =
    dbAliasIndex.parentById.size > 0
      ? mergeCanonicalAliasSources(dbAliasIndex, rawProducts)
      : buildCanonicalAliasIndex(rawProducts);
  const refMap = resolveProductReferenceMap(rawProducts, aliasMap);
  const canonicalProducts = Array.from(new Set(Array.from(refMap.values()))).filter(p => !p.canonicalProductId);
  const canonicalIds = new Set(canonicalProducts.map(p => p.id));
  const rawOffers = StorageService.getProductOffers();
  const normalizedOffers = (normalizeProductReferences(rawOffers as unknown as Record<string, unknown>[], aliasMap, {
    fields: ['productId'],
    knownProductIds: new Set(rawProducts.map(p => p.id))
  }) as unknown as ProductOffer[]).filter(o => canonicalIds.has(o.productId));
  const retailerProducts = StorageService.getRetailerProducts();
  return {
    products: canonicalProducts,
    offers: normalizedOffers,
    stores: STORES,
    observations: includeObservations ? StorageService.getPriceObservations() : [],
    aliasMap,
    retailerProducts
  };
}

function mapSupabaseReceiptRowForBudget(row: any): Receipt {
  const ext = (row?.extracted_data && typeof row.extracted_data === 'object') ? row.extracted_data : {};
  const rawItems = Array.isArray(ext.items) ? ext.items : [];
  const rawDate = row?.purchased_at
    ? String(row.purchased_at).slice(0, 10)
    : typeof ext.date === 'string'
    ? ext.date
    : String(row?.created_at || new Date().toISOString()).slice(0, 10);

  return {
    id: String(row.id),
    storeId: String(row.store_id || ext.storeId || 'unknown'),
    storeName: String(row.merchant_name || ext.storeName || 'Magazin'),
    date: rawDate,
    items: rawItems.map((it: any, idx: number) => ({
      id: String(it.id || `item-${idx}`),
      rawName: String(it.rawName || it.raw_name || 'Produs'),
      matchedProductId: it.matchedProductId || it.matched_product_id || undefined,
      quantity: Number(it.quantity) || 1,
      unit: it.unit || 'buc',
      unitPrice: Number(it.unitPrice ?? it.unit_price) || 0,
      totalPrice: Number(it.totalPrice ?? it.total_price) || 0,
      discount: Number(it.discount) || 0,
      isSgr: Boolean(it.isSgr ?? it.is_sgr),
      isCouponOrDiscountLine: Boolean(it.isCouponOrDiscountLine),
      confidence: it.confidence || 'medium',
      category: it.category || undefined
    })),
    subtotal: Number(ext.subtotal ?? row.total_amount) || 0,
    discountTotal: Number(ext.discountTotal) || 0,
    total: Number(row.total_amount ?? ext.total) || 0,
    currency: 'RON',
    createdAt: String(row.created_at || new Date().toISOString()),
    verifiedStatus: row.status === 'processed' || ext.verifiedStatus === 'confirmed' ? 'confirmed' : 'draft',
    validationStatus: ext.validationStatus || 'VALID',
    ...(row.status === 'failed' ? { status: 'failed' } : {})
  } as Receipt;
}

function maskEmailAddress(email?: string | null): string | undefined {
  if (!email || !email.includes('@')) return undefined;
  const [local, domain] = email.split('@');
  const prefix = local.slice(0, Math.min(2, local.length));
  return `${prefix}***@${domain}`;
}

function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

async function resolveSharedListRoleAndMeta(params: {
  auth: { user: { id: string; email?: string }; userClient: SupabaseClient };
  listId: string;
}): Promise<
  | { ok: true; role: 'owner' | 'editor' | 'viewer'; list: { id: string; name: string; user_id: string } }
  | { ok: false; status: number; error: string }
> {
  const { auth, listId } = params;
  if (!UUID_STRICT_RE.test(listId)) {
    return { ok: false, status: 400, error: 'Identificator listă invalid.' };
  }

  const adminClient = getSupabaseAdminClient();
  const lookupClient = adminClient || auth.userClient;

  const { data: listRow, error: listErr } = await lookupClient
    .from('shopping_lists')
    .select('id, user_id, name')
    .eq('id', listId)
    .maybeSingle();

  if (listErr) {
    return { ok: false, status: 500, error: 'Eroare la verificarea listei partajate.' };
  }
  if (!listRow) {
    return { ok: false, status: 404, error: 'Lista de cumpărături nu a fost găsită.' };
  }

  if (listRow.user_id === auth.user.id) {
    return { ok: true, role: 'owner', list: listRow };
  }

  const { data: memberRow, error: membErr } = await lookupClient
    .from('shopping_list_members')
    .select('role')
    .eq('list_id', listId)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (membErr) {
    return { ok: false, status: 500, error: 'Eroare la verificarea permisiunilor pe listă.' };
  }

  if (!memberRow || !['owner', 'editor', 'viewer'].includes(memberRow.role)) {
    return { ok: false, status: 403, error: 'Acces interzis: nu ai permisiuni pe această listă.' };
  }

  return { ok: true, role: memberRow.role as 'owner' | 'editor' | 'viewer', list: listRow };
}

// 1. V2 Personal Budget Summary & Settings
app.get('/api/budget/summary', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară pentru bugetul personal.' });
    }

    const [receiptsRes, prefRes, profileRes, catalogData] = await Promise.all([
      auth.userClient
        .from('receipts')
        .select('id, store_id, merchant_name, purchased_at, total_amount, extracted_data, status, created_at')
        .eq('user_id', auth.user.id)
        .order('purchased_at', { ascending: false, nullsFirst: false })
        .limit(500),
      auth.userClient
        .from('user_preferences')
        .select('monthly_budget, weekly_budget, budget_alert_threshold_pct')
        .eq('user_id', auth.user.id)
        .maybeSingle(),
      auth.userClient
        .from('profiles')
        .select('preferences')
        .eq('id', auth.user.id)
        .maybeSingle(),
      loadV2CatalogDataset(false)
    ]);

    if (receiptsRes.error) {
      return res.status(500).json({ success: false, error: 'Nu am putut citi bonurile contului.' });
    }

    const profilePrefs = (profileRes.data?.preferences && typeof profileRes.data.preferences === 'object')
      ? profileRes.data.preferences
      : {};
    const settings = {
      monthlyBudget:
        prefRes.data?.monthly_budget != null
          ? Number(prefRes.data.monthly_budget)
          : profilePrefs.monthlyBudget != null
          ? Number(profilePrefs.monthlyBudget)
          : null,
      weeklyBudget:
        prefRes.data?.weekly_budget != null
          ? Number(prefRes.data.weekly_budget)
          : profilePrefs.weeklyBudget != null
          ? Number(profilePrefs.weeklyBudget)
          : null,
      alertThresholdPct:
        Number(prefRes.data?.budget_alert_threshold_pct ?? profilePrefs.budgetAlertThresholdPct ?? 80) || 80
    };

    const receipts = (receiptsRes.data || []).map(mapSupabaseReceiptRowForBudget);
    const summary = BudgetService.calculateSummary({
      receipts,
      settings,
      catalogProducts: catalogData.products,
      aliasMap: catalogData.aliasMap
    });

    return res.json({ success: true, summary });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la calcularea bugetului personal.' });
  }
});

app.patch('/api/budget/settings', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară pentru salvarea bugetului.' });
    }

    const parsed = budgetSettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Date invalide pentru configurarea bugetului.'
      });
    }

    const { data: existingPrefs } = await auth.userClient
      .from('user_preferences')
      .select('monthly_budget, weekly_budget, budget_alert_threshold_pct')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    const { data: profileRow } = await auth.userClient
      .from('profiles')
      .select('preferences')
      .eq('id', auth.user.id)
      .maybeSingle();
    const currentProfilePrefs =
      profileRow?.preferences && typeof profileRow.preferences === 'object' ? profileRow.preferences : {};

    const nextSettings = {
      monthlyBudget:
        parsed.data.monthlyBudget !== undefined
          ? parsed.data.monthlyBudget
          : existingPrefs?.monthly_budget != null
          ? Number(existingPrefs.monthly_budget)
          : currentProfilePrefs.monthlyBudget ?? null,
      weeklyBudget:
        parsed.data.weeklyBudget !== undefined
          ? parsed.data.weeklyBudget
          : existingPrefs?.weekly_budget != null
          ? Number(existingPrefs.weekly_budget)
          : currentProfilePrefs.weeklyBudget ?? null,
      alertThresholdPct:
        parsed.data.alertThresholdPct !== undefined
          ? parsed.data.alertThresholdPct
          : Number(existingPrefs?.budget_alert_threshold_pct ?? currentProfilePrefs.budgetAlertThresholdPct ?? 80) || 80
    };

    const { error: upsertErr } = await auth.userClient.from('user_preferences').upsert(
      {
        user_id: auth.user.id,
        monthly_budget: nextSettings.monthlyBudget,
        weekly_budget: nextSettings.weeklyBudget,
        budget_alert_threshold_pct: nextSettings.alertThresholdPct,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );

    if (upsertErr) {
      // Fallback safely to profiles.preferences if migration 013 hasn't added columns yet
      await auth.userClient
        .from('profiles')
        .upsert(
          {
            id: auth.user.id,
            preferences: {
              ...currentProfilePrefs,
              monthlyBudget: nextSettings.monthlyBudget,
              weeklyBudget: nextSettings.weeklyBudget,
              budgetAlertThresholdPct: nextSettings.alertThresholdPct
            },
            updated_at: new Date().toISOString()
          },
          { onConflict: 'id' }
        );
    }

    return res.json({ success: true, settings: nextSettings });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la actualizarea bugetului personal.' });
  }
});

// 2. V2 Product Alternatives Endpoint
app.get('/api/products/:id/alternatives', publicComputeLimiter, async (req, res) => {
  try {
    const productId = String(req.params.id || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'ID-ul produsului este obligatoriu.' });
    }
    const useLoyaltyCards = req.query.useLoyaltyCards !== 'false';
    const dataset = await loadV2CatalogDataset(false);
    const aliasIndex = buildCanonicalAliasIndex(dataset.aliasMap);
    const canonicalProductId = resolveCanonicalProductId(productId, aliasIndex) || productId;
    const targetProduct =
      dataset.products.find(p => p.id === canonicalProductId) ||
      dataset.products.find(p => p.id === productId);
    if (!targetProduct) {
      return res.status(404).json({ success: false, error: 'Produsul nu a fost găsit în catalog.' });
    }

    const result = ProductAlternativesService.getAlternatives({
      targetProduct,
      allProducts: dataset.products,
      allOffers: dataset.offers,
      stores: dataset.stores,
      useLoyaltyCards,
      aliasMap: dataset.aliasMap
    });

    return res.json({ success: true, alternatives: result, ...result });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la calcularea produselor alternative.' });
  }
});

// 3. V2 Barcode Lookup & Moderation-first Suggestions Endpoints
app.get('/api/catalog/barcode/:code', publicComputeLimiter, async (req, res) => {
  try {
    const rawCode = String(req.params.code || '').trim();
    const candidates = normalizeBarcodeCandidates(rawCode);
    if (candidates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Codul de bare trebuie să conțină între 6 și 14 cifre (EAN/UPC).'
      });
    }

    const dataset = await loadV2CatalogDataset(true);
    const lookup = lookupProductByBarcode({
      barcode: rawCode,
      products: dataset.products,
      offers: dataset.offers,
      stores: dataset.stores,
      observations: dataset.observations,
      retailerProducts: dataset.retailerProducts,
      aliasMap: dataset.aliasMap
    });

    return res.json({ success: true, ...lookup });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la căutarea codului de bare în catalog.' });
  }
});

app.post('/api/products/suggestions', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const parsed = barcodeSuggestionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Date invalide pentru sugestia de produs.'
      });
    }

    const hasBearerHeader = Boolean(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
    const auth = hasBearerHeader ? await getAuthenticatedSupabaseUser(req) : null;
    if (hasBearerHeader && !auth) {
      return res.status(401).json({ success: false, error: 'Sesiune invalidă.' });
    }

    const data = parsed.data;
    const suggestionRecord = {
      id: crypto.randomUUID(),
      user_id: auth?.user.id || null,
      barcode: data.barcode,
      proposed_name: data.proposedName,
      proposed_brand: data.proposedBrand || null,
      category: data.category,
      package_weight_or_volume: data.packageWeightOrVolume ?? null,
      package_unit: data.packageUnit || null,
      observed_store_id: data.observedStoreId || null,
      observed_price: data.observedPrice ?? null,
      notes: data.notes || null,
      status: 'pending' as const,
      created_at: new Date().toISOString()
    };

    const writeClient = auth?.userClient || getSupabaseAdminClient();
    let persistedInDb = false;
    if (writeClient) {
      const { error: insertErr } = await writeClient
        .from('product_barcode_suggestions')
        .insert(suggestionRecord);
      if (!insertErr) {
        persistedInDb = true;
      }
    }

    if (!persistedInDb) {
      inMemoryBarcodeSuggestions.push(suggestionRecord);
    }

    // IMPORTANT: Never auto-publish barcode suggestions directly into public products catalog!
    return res.status(201).json({
      success: true,
      persistedInDb,
      autoPublished: false,
      suggestion: {
        id: suggestionRecord.id,
        barcode: suggestionRecord.barcode,
        proposedName: suggestionRecord.proposed_name,
        proposedBrand: suggestionRecord.proposed_brand || undefined,
        category: suggestionRecord.category,
        packageWeightOrVolume: suggestionRecord.package_weight_or_volume ?? undefined,
        packageUnit: suggestionRecord.package_unit || undefined,
        observedStoreId: suggestionRecord.observed_store_id || undefined,
        observedPrice: suggestionRecord.observed_price ?? undefined,
        notes: suggestionRecord.notes || undefined,
        status: 'pending',
        createdAt: suggestionRecord.created_at
      },
      messageRo: 'Sugestia a fost salvată în coada de moderare și va fi verificată înainte de publicarea în catalog.'
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la înregistrarea sugestiei de produs.' });
  }
});

// 4. V2 Shared Shopping Lists, Invites, Roles & Activity History Endpoints
app.get('/api/lists/:listId/collaboration', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const listId = req.params.listId;
    const access = await resolveSharedListRoleAndMeta({ auth, listId });
    if (access.ok === false) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const adminClient = getSupabaseAdminClient();
    const client = adminClient || auth.userClient;

    const [membersRes, activityRes, invitesRes] = await Promise.all([
      client
        .from('shopping_list_members')
        .select('id, list_id, user_id, role, display_name, email_masked, joined_at')
        .eq('list_id', listId)
        .order('joined_at', { ascending: true }),
      client
        .from('shopping_list_activity')
        .select('id, list_id, actor_user_id, actor_name, action_type, target_name, details, created_at')
        .eq('list_id', listId)
        .order('created_at', { ascending: false })
        .limit(40),
      access.role === 'owner'
        ? client
            .from('shopping_list_invites')
            .select('id, list_id, role, invited_email, expires_at, max_uses, uses_count, revoked_at, created_at')
            .eq('list_id', listId)
            .is('revoked_at', null)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null })
    ]);

    return res.json({
      success: true,
      listId,
      listName: access.list.name,
      myRole: access.role,
      members: (membersRes.data || []).map((m: any) => ({
        id: m.id,
        listId: m.list_id,
        userId: m.user_id,
        role: m.role,
        displayName: m.display_name || 'Colaborator',
        emailMasked: m.email_masked || undefined,
        joinedAt: m.joined_at
      })),
      invites: (invitesRes.data || []).map((inv: any) => ({
        id: inv.id,
        listId: inv.list_id,
        role: inv.role,
        invitedEmail: inv.invited_email || null,
        expiresAt: inv.expires_at,
        maxUses: inv.max_uses,
        usesCount: inv.uses_count,
        revokedAt: inv.revoked_at || null,
        createdAt: inv.created_at
      })),
      activity: (activityRes.data || []).map((act: any) => ({
        id: act.id,
        listId: act.list_id,
        actorUserId: act.actor_user_id || undefined,
        actorName: act.actor_name || 'Utilizator',
        actionType: act.action_type,
        targetName: act.target_name || undefined,
        details: act.details || {},
        createdAt: act.created_at
      }))
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la încărcarea colaboratorilor listei.' });
  }
});

app.post('/api/lists/:listId/invites', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const listId = req.params.listId;
    const access = await resolveSharedListRoleAndMeta({ auth, listId });
    if (access.ok === false) {
      return res.status(access.status).json({ success: false, error: access.error });
    }
    if (access.role !== 'owner') {
      return res.status(403).json({
        success: false,
        error: 'Doar proprietarul listei poate genera invitații de partajare.'
      });
    }

    const parsed = sharedListInviteCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Parametri de invitație invalizi.'
      });
    }

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 3600 * 1000).toISOString();

    const adminClient = getSupabaseAdminClient();
    const writeClient = adminClient || auth.userClient;

    // Ensure owner record exists in shopping_list_members
    await writeClient.from('shopping_list_members').upsert(
      {
        list_id: listId,
        user_id: auth.user.id,
        role: 'owner',
        display_name: auth.user.user_metadata?.display_name || auth.user.email?.split('@')[0] || 'Proprietar',
        email_masked: maskEmailAddress(auth.user.email) || null,
        invited_by: auth.user.id
      },
      { onConflict: 'list_id,user_id' }
    );

    const { data: createdInvite, error: invErr } = await writeClient
      .from('shopping_list_invites')
      .insert({
        list_id: listId,
        created_by: auth.user.id,
        role: parsed.data.role,
        token_hash: tokenHash,
        invited_email: parsed.data.invitedEmail ? parsed.data.invitedEmail.toLowerCase() : null,
        expires_at: expiresAt,
        max_uses: parsed.data.maxUses
      })
      .select('id, list_id, role, invited_email, expires_at, max_uses, uses_count, created_at')
      .single();

    if (invErr || !createdInvite) {
      return res.status(500).json({
        success: false,
        error: 'Nu am putut salva invitația în baza de date (verifică migrarea 013).'
      });
    }

    await writeClient.from('shopping_list_activity').insert({
      list_id: listId,
      actor_user_id: auth.user.id,
      actor_name: auth.user.user_metadata?.display_name || auth.user.email?.split('@')[0] || 'Proprietar',
      action_type: 'list_shared',
      target_name: parsed.data.invitedEmail || `Link rol ${parsed.data.role}`,
      details: { role: parsed.data.role, expiresAt }
    });

    const inviteUrl = `/?tab=shopping-list&invite=${encodeURIComponent(rawToken)}`;
    return res.status(201).json({
      success: true,
      token: rawToken,
      inviteUrl,
      invite: {
        id: createdInvite.id,
        listId: createdInvite.list_id,
        role: createdInvite.role,
        invitedEmail: createdInvite.invited_email || null,
        expiresAt: createdInvite.expires_at,
        maxUses: createdInvite.max_uses,
        usesCount: createdInvite.uses_count,
        createdAt: createdInvite.created_at,
        inviteUrl
      }
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la crearea invitației.' });
  }
});

app.post('/api/lists/invites/:token/accept', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentifică-te pentru a accepta invitația la listă.' });
    }

    const rawToken = String(req.params.token || '').trim();
    if (!rawToken || rawToken.length < 16) {
      return res.status(400).json({ success: false, error: 'Codul de invitație este invalid.' });
    }

    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return res.status(503).json({
        success: false,
        error: 'Acceptarea invitațiilor securizate necesită configurarea serviciului pe server.'
      });
    }

    const tokenHash = hashInviteToken(rawToken);
    const { data: invite, error: lookupErr } = await adminClient
      .from('shopping_list_invites')
      .select('id, list_id, role, invited_email, expires_at, max_uses, uses_count, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupErr) {
      return res.status(500).json({ success: false, error: 'Eroare la verificarea invitației.' });
    }
    if (!invite || invite.revoked_at) {
      return res.status(404).json({ success: false, error: 'Invitația nu există sau a fost revocată.' });
    }
    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ success: false, error: 'Această invitație a expirat.' });
    }
    if (Number(invite.uses_count) >= Number(invite.max_uses)) {
      return res.status(410).json({ success: false, error: 'Această invitație a atins numărul maxim de utilizări.' });
    }
    if (invite.invited_email && auth.user.email?.toLowerCase() !== invite.invited_email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: 'Această invitație este destinată unei alte adrese de email.'
      });
    }

    const { data: listRow } = await adminClient
      .from('shopping_lists')
      .select('id, user_id, name')
      .eq('id', invite.list_id)
      .maybeSingle();
    if (!listRow) {
      return res.status(404).json({ success: false, error: 'Lista partajată nu mai există.' });
    }

    if (listRow.user_id === auth.user.id) {
      return res.json({
        success: true,
        listId: invite.list_id,
        listName: listRow.name,
        role: 'owner',
        alreadyOwner: true
      });
    }

    const displayName =
      auth.user.user_metadata?.display_name || auth.user.email?.split('@')[0] || 'Colaborator';

    const { error: memberErr } = await adminClient.from('shopping_list_members').upsert(
      {
        list_id: invite.list_id,
        user_id: auth.user.id,
        role: invite.role,
        display_name: displayName,
        email_masked: maskEmailAddress(auth.user.email) || null,
        invited_by: listRow.user_id,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'list_id,user_id' }
    );

    if (memberErr) {
      return res.status(500).json({ success: false, error: 'Nu am putut adăuga accesul la listă.' });
    }

    await adminClient
      .from('shopping_list_invites')
      .update({ uses_count: Number(invite.uses_count) + 1 })
      .eq('id', invite.id);

    await adminClient.from('shopping_list_activity').insert({
      list_id: invite.list_id,
      actor_user_id: auth.user.id,
      actor_name: displayName,
      action_type: 'member_joined',
      target_name: displayName,
      details: { role: invite.role }
    });

    return res.json({
      success: true,
      listId: invite.list_id,
      listName: listRow.name,
      role: invite.role
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la acceptarea invitației.' });
  }
});

app.patch('/api/lists/:listId/members/:memberUserId', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const { listId, memberUserId } = req.params;
    if (!UUID_STRICT_RE.test(memberUserId)) {
      return res.status(400).json({ success: false, error: 'Identificator membru invalid.' });
    }

    const access = await resolveSharedListRoleAndMeta({ auth, listId });
    if (access.ok === false) {
      return res.status(access.status).json({ success: false, error: access.error });
    }
    if (access.role !== 'owner') {
      return res.status(403).json({
        success: false,
        error: 'Doar proprietarul listei poate modifica rolurile colaboratorilor.'
      });
    }
    if (memberUserId === access.list.user_id) {
      return res.status(400).json({ success: false, error: 'Rolul proprietarului principal nu poate fi retrogradat.' });
    }

    const parsed = sharedListMemberRoleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Rol invalid.' });
    }

    const writeClient = getSupabaseAdminClient() || auth.userClient;
    const { data: updated, error: updErr } = await writeClient
      .from('shopping_list_members')
      .update({ role: parsed.data.role, updated_at: new Date().toISOString() })
      .eq('list_id', listId)
      .eq('user_id', memberUserId)
      .select('id, display_name, role')
      .maybeSingle();

    if (updErr || !updated) {
      return res.status(404).json({ success: false, error: 'Colaboratorul nu a fost găsit pe această listă.' });
    }

    await writeClient.from('shopping_list_activity').insert({
      list_id: listId,
      actor_user_id: auth.user.id,
      actor_name: auth.user.user_metadata?.display_name || auth.user.email?.split('@')[0] || 'Proprietar',
      action_type: 'member_role_changed',
      target_name: updated.display_name || 'Colaborator',
      details: { newRole: parsed.data.role }
    });

    return res.json({ success: true, member: updated });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la modificarea rolului colaboratorului.' });
  }
});

app.delete('/api/lists/:listId/members/:memberUserId', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const { listId, memberUserId } = req.params;
    if (!UUID_STRICT_RE.test(memberUserId)) {
      return res.status(400).json({ success: false, error: 'Identificator membru invalid.' });
    }

    const access = await resolveSharedListRoleAndMeta({ auth, listId });
    if (access.ok === false) {
      return res.status(access.status).json({ success: false, error: access.error });
    }
    const isSelfLeave = memberUserId === auth.user.id;
    if (access.role !== 'owner' && !isSelfLeave) {
      return res.status(403).json({
        success: false,
        error: 'Doar proprietarul poate revoca accesul altor membri.'
      });
    }
    if (memberUserId === access.list.user_id) {
      return res.status(400).json({ success: false, error: 'Proprietarul principal nu poate fi revocat.' });
    }

    const writeClient = getSupabaseAdminClient() || auth.userClient;
    const { data: removed } = await writeClient
      .from('shopping_list_members')
      .delete()
      .eq('list_id', listId)
      .eq('user_id', memberUserId)
      .select('display_name')
      .maybeSingle();

    await writeClient.from('shopping_list_activity').insert({
      list_id: listId,
      actor_user_id: auth.user.id,
      actor_name: auth.user.user_metadata?.display_name || auth.user.email?.split('@')[0] || 'Utilizator',
      action_type: 'member_revoked',
      target_name: removed?.display_name || 'Colaborator',
      details: { selfLeave: isSelfLeave }
    });

    return res.json({ success: true, revokedUserId: memberUserId });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la revocarea accesului.' });
  }
});

app.get('/api/lists/:listId/activity', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const listId = req.params.listId;
    const access = await resolveSharedListRoleAndMeta({ auth, listId });
    if (access.ok === false) {
      return res.status(access.status).json({ success: false, error: access.error });
    }

    const client = getSupabaseAdminClient() || auth.userClient;
    const { data, error } = await client
      .from('shopping_list_activity')
      .select('id, list_id, actor_user_id, actor_name, action_type, target_name, details, created_at')
      .eq('list_id', listId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ success: false, error: 'Nu am putut prelua istoricul modificărilor.' });
    }
    return res.json({
      success: true,
      activity: (data || []).map((a: any) => ({
        id: a.id,
        listId: a.list_id,
        actorUserId: a.actor_user_id || undefined,
        actorName: a.actor_name || 'Utilizator',
        actionType: a.action_type,
        targetName: a.target_name || undefined,
        details: a.details || {},
        createdAt: a.created_at
      }))
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la citirea istoricului.' });
  }
});

app.post('/api/lists/:listId/activity', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const auth = await getAuthenticatedSupabaseUser(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Autentificare necesară.' });
    }
    const listId = req.params.listId;
    const access = await resolveSharedListRoleAndMeta({ auth, listId });
    if (access.ok === false) {
      return res.status(access.status).json({ success: false, error: access.error });
    }
    if (access.role === 'viewer') {
      return res.status(403).json({
        success: false,
        error: 'Rolul Viewer permite doar vizualizarea listei, nu modificarea ei.'
      });
    }

    const parsed = sharedListActivityCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Date invalide pentru jurnalul de activitate.' });
    }

    const writeClient = getSupabaseAdminClient() || auth.userClient;
    const actorName =
      auth.user.user_metadata?.display_name || auth.user.email?.split('@')[0] || 'Utilizator';

    const { data: inserted, error: insErr } = await writeClient
      .from('shopping_list_activity')
      .insert({
        list_id: listId,
        actor_user_id: auth.user.id,
        actor_name: actorName,
        action_type: parsed.data.actionType,
        target_name: parsed.data.targetName || null,
        details: parsed.data.details || {}
      })
      .select('id, list_id, actor_user_id, actor_name, action_type, target_name, details, created_at')
      .single();

    if (insErr) {
      return res.status(500).json({ success: false, error: 'Nu am putut înregistra modificarea în istoric.' });
    }

    return res.status(201).json({
      success: true,
      entry: {
        id: inserted.id,
        listId: inserted.list_id,
        actorUserId: inserted.actor_user_id || undefined,
        actorName: inserted.actor_name,
        actionType: inserted.action_type,
        targetName: inserted.target_name || undefined,
        details: inserted.details || {},
        createdAt: inserted.created_at
      }
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare la salvarea activității.' });
  }
});

// 5. V2 Grounded AI Shopping Assistant Endpoint (Gemini server-side + deterministic math)
app.post('/api/assistant/query', publicComputeLimiter, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const parsed = assistantQueryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Cerere invalidă către asistent.'
      });
    }

    const hasBearerHeader = Boolean(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
    const auth = hasBearerHeader ? await getAuthenticatedSupabaseUser(req) : null;
    if (hasBearerHeader && !auth) {
      return res.status(401).json({ success: false, error: 'Sesiune invalidă pentru accesarea asistentului.' });
    }

    const input = parsed.data;
    let activeListItems = input.items || [];
    let resolvedListName = 'Coșul meu';

    if (auth && input.listId && UUID_STRICT_RE.test(input.listId) && activeListItems.length === 0) {
      const access = await resolveSharedListRoleAndMeta({ auth, listId: input.listId });
      if (access.ok === false) {
        return res.status(access.status).json({ success: false, error: access.error });
      }
      resolvedListName = access.list.name;
      const client = getSupabaseAdminClient() || auth.userClient;
      const { data: itemRows } = await client
        .from('shopping_list_items')
        .select('id, product_id, product_name, quantity, unit, is_checked')
        .eq('list_id', input.listId);
      activeListItems = (itemRows || []).map((r: any) => ({
        id: r.id,
        productId: r.product_id || undefined,
        name: r.product_name || 'Produs',
        category: 'Alte produse',
        quantity: Number(r.quantity) || 1,
        unit: r.unit || 'buc',
        checked: Boolean(r.is_checked)
      }));
    }

    const dataset = await loadV2CatalogDataset(false);
    const assistantAliasIndex = buildCanonicalAliasIndex(dataset.aliasMap);
    if (input.selectedProductId) {
      const selDetail = resolveCanonicalProductDetail(input.selectedProductId, assistantAliasIndex);
      if (selDetail.cycleDetected) {
        return res.status(400).json({
          success: false,
          error: 'Referință de produs invalidă pentru produsul selectat (ciclu canonic sau lanț excesiv detectat).'
        });
      }
      if (selDetail.wasAlias && !selDetail.found) {
        return res.status(400).json({
          success: false,
          error: 'Referință de produs invalidă pentru produsul selectat (alias orfan fără rădăcină canonică validă).'
        });
      }
    }
    const normalizedSelectedProductId = input.selectedProductId
      ? resolveCanonicalProductId(input.selectedProductId, assistantAliasIndex) || input.selectedProductId
      : undefined;
    const normalizedActiveListItems = activeListItems.map((it: any) => {
      if (!it?.productId) return it;
      const detail = resolveCanonicalProductDetail(it.productId, assistantAliasIndex);
      if (detail.cycleDetected || (detail.wasAlias && !detail.found)) {
        return it;
      }
      return {
        ...it,
        productId: detail.found && detail.canonicalId ? detail.canonicalId : it.productId
      };
    });

    const activeList =
      normalizedActiveListItems.length > 0
        ? {
            id: input.listId || 'active',
            name: resolvedListName,
            items: normalizedActiveListItems,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        : null;

    const plan = ShoppingAssistantService.buildDeterministicPlan({
      prompt: input.prompt,
      explicitIntent: input.intent,
      budgetLei: input.budgetLei,
      days: input.days,
      activeList: activeList as any,
      selectedProductId: normalizedSelectedProductId,
      allProducts: dataset.products,
      allOffers: dataset.offers,
      allStores: dataset.stores,
      useLoyaltyCards: input.useLoyaltyCards,
      aliasMap: dataset.aliasMap
    });

    if (plan.items.length === 0) {
      const honest = ShoppingAssistantService.formatDeterministicAnswer(plan);
      return res.json({
        success: true,
        intent: plan.intent,
        answerRo: honest.answerRo,
        highlights: honest.highlights,
        recommendedItems: [],
        totalEstimatedCost: 0,
        remainingBudgetLei: plan.remainingBudgetLei,
        estimatedSavingsLei: plan.estimatedSavingsLei,
        limitations: plan.limitations,
        groundedSourceCount: plan.validOffersCount,
        generatedWithAi: false
      });
    }

    if (!ai) {
      return res.status(503).json({
        success: false,
        code: 'AI_UNAVAILABLE',
        error: 'Asistentul AI nu este configurat pe server (lipsește GEMINI_API_KEY).',
        deterministicPlan: plan
      });
    }

    const groundingContextJson = JSON.stringify({
      intent: plan.intent,
      titleRo: plan.titleRo,
      budgetRequestedLei: plan.budgetRequestedLei ?? null,
      daysRequested: plan.daysRequested ?? null,
      totalEstimatedCost: plan.totalEstimatedCost,
      remainingBudgetLei: plan.remainingBudgetLei ?? null,
      estimatedSavingsLei: plan.estimatedSavingsLei ?? null,
      optimizationSummary: plan.optimizationSummary ?? null,
      limitations: plan.limitations,
      verifiedItems: plan.items.map(it => ({
        productId: it.productId,
        productName: it.productName,
        brand: it.brand,
        category: it.category,
        storeName: it.storeName,
        quantity: it.quantity,
        unit: it.unit,
        price: it.price,
        unitPrice: it.unitPrice,
        unitPriceMeasure: it.unitPriceMeasure,
        isPromo: it.isPromo,
        dayLabel: it.dayLabel ?? null,
        noteRo: it.noteRo ?? null
      }))
    });

    const systemPrompt = `Ești asistentul de cumpărături Coșul Meu pentru piața din România.
REGULI STRICTE (ANTI-HALUCINAȚIE):
1. Folosește EXCLUSIV produsele, ID-urile (productId), magazinele, prețurile și totalurile furnizate în JSON-ul verificat de mai jos.
2. NU inventa niciun produs, preț, promoție, disponibilitate sau economie care nu există explicit în datele verificate.
3. Nu modifica sumele calculate determinist.
4. Răspunde concis, prietenos și util în limba română, menționând eventualele limitări.
5. În citedProductIds include DOAR productId-urile reale din verifiedItems pe care le menționezi.

Întrebarea utilizatorului: ${JSON.stringify(input.prompt)}
Date verificate determinist: ${groundingContextJson}`;

    let geminiResp;
    try {
      geminiResp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: systemPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answerRo: { type: Type.STRING },
              highlights: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              citedProductIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ['answerRo', 'highlights', 'citedProductIds']
          }
        }
      });
    } catch (geminiErr: any) {
      console.error('[assistant-ai] Provider error:', geminiErr?.message || 'AI error');
      return res.status(502).json({
        success: false,
        code: 'AI_PROVIDER_ERROR',
        error: 'Serviciul Gemini AI nu a putut răspunde în acest moment.',
        deterministicPlan: plan
      });
    }

    let rawAiPayload: unknown = null;
    try {
      const txt = geminiResp.text?.trim();
      if (txt) rawAiPayload = JSON.parse(txt);
    } catch {
      rawAiPayload = null;
    }

    const validated = ShoppingAssistantService.validateAiOutputAgainstPlan({
      plan,
      aiPayload: rawAiPayload
    });

    return res.json({
      success: true,
      intent: plan.intent,
      answerRo: validated.answerRo,
      highlights: validated.highlights,
      recommendedItems: plan.items,
      totalEstimatedCost: plan.totalEstimatedCost,
      remainingBudgetLei: plan.remainingBudgetLei,
      estimatedSavingsLei: plan.estimatedSavingsLei,
      limitations: plan.limitations,
      groundedSourceCount: plan.validOffersCount,
      generatedWithAi: validated.valid && !validated.hallucinationDetected,
      model: 'gemini-4-hydrogen'
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Eroare internă la procesarea cererii de asistent.' });
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

export { app, ADMIN_API_KEY, executeGdprAccountDeletion };

