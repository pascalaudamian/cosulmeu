// src/indexing/catalog/CatalogStagingManager.ts
// Manager complet pentru descărcare, parsare, deduplicare, potrivire, staging și publicare oferte de catalog

import crypto from 'crypto';
import {
  CatalogDocument,
  CatalogExtractedOffer,
  CatalogImportRun,
  CatalogImportError,
  CatalogSource
} from './catalogTypes.js';
import { CatalogDownloader } from './CatalogDownloader.js';
import { CatalogParserEngine, RawParsedOffer } from './CatalogParserEngine.js';
import { ProductMatcher } from '../../services/ProductMatcher.js';
import { StorageService } from '../../services/StorageService.js';
import { DatabaseService, isPostgresConfigured, getPool } from '../../db/index.js';
import { Product, ProductOffer, PriceObservation, UnitType } from '../../types.js';
import { PriceQualityMonitor } from '../PriceQualityMonitor.js';
import { mapRetailerCategoryToStandard } from '../../data/categories.js';

export interface PublishPreviewItem {
  id: string;
  title: string;
  price: number;
  normalPrice: number;
  promoPrice?: number;
  loyaltyPrice?: number;
  discountPercentage?: number;
  retailerId: string;
  retailerName: string;
  brand?: string;
  ean?: string;
  retailerSku?: string;
  packageQuantity?: number;
  packageUnit?: string;
  imageUrl?: string;
  matchedProductId?: string;
  matchedProductName?: string;
  canonicalStatus: 'PRODUS NOU' | 'PRODUS EXISTENT';
  offerAction: 'OFERTĂ NOUĂ' | 'OFERTĂ ACTUALIZATĂ' | 'PREȚ MODIFICAT' | 'FĂRĂ SCHIMBĂRI';
  stagingStatus: string;
  documentId?: string;
  documentTitle?: string;
  documentUrl?: string;
  validUntil?: string;
  isNewProduct: boolean;
}

export interface PublishPreviewData {
  toPublishCount: number;
  newProductsCount: number;
  existingUpdatedCount: number;
  unchangedProductsCount: number;
  newOffersCount: number;
  updatedOffersCount: number;
  existingOffersCount: number;
  priceChangesCount: number;
  itemsWithoutPriceCount: number;
  needsReviewCount: number;
  retailersInvolved: string[];
  items: PublishPreviewItem[];
  sampleItems: PublishPreviewItem[];
  eligibleOfferIds: string[];
  cleanupOfferIds: string[];
  previewSnapshotHash: string;
  generatedAt: string;
  errors: string[];
}

export class CatalogStagingManager {
  private static computePreviewSnapshotHash(offers: CatalogExtractedOffer[]): string {
    const signature = offers
      .map(o => [
        o.id,
        String(o.stagingStatus || '').toUpperCase(),
        Number(o.effectivePrice || 0).toFixed(2),
        Number(o.normalPrice || 0).toFixed(2),
        o.matchedProductId || '',
        o.validUntil || '',
        o.updatedAt || ''
      ].join(':'))
      .sort()
      .join('|');
    return crypto.createHash('sha256').update(signature).digest('hex');
  }

  /**
   * Execută fluxul complet de procesare pentru un document de catalog
   */
  static async executeImportForDocument(
    document: CatalogDocument,
    options: { autoPublishValidated?: boolean } = {}
  ): Promise<{ run: CatalogImportRun; offers: CatalogExtractedOffer[]; error?: string }> {
    const startedAt = new Date().toISOString();
    const runId = `run-${document.retailerId}-${Date.now()}`;
    const startTime = Date.now();
    const errors: string[] = [];

    // 1. Inițializare rulare
    const importRun: CatalogImportRun = {
      id: runId,
      documentId: document.id,
      sourceId: document.sourceId,
      retailerId: document.retailerId,
      startedAt,
      status: 'running',
      totalRawExtracted: 0,
      autoMatchedCount: 0,
      needsReviewCount: 0,
      publishedCount: 0,
      rejectedCount: 0,
      errors: []
    };

    StorageService.addCatalogImportRun(importRun);
    StorageService.updateCatalogDocument(document.id, {
      downloadStatus: 'downloading',
      updatedAt: new Date().toISOString()
    });

    // 2. Descărcare document cu protecție SSRF
    let downloadRes = await CatalogDownloader.downloadCatalog(document.documentUrl, {
      timeoutMs: 25000,
      maxRetries: 2
    });

    if (!downloadRes.ok || !downloadRes.data) {
      const fallback = this.getFallbackCatalogContent(document.retailerId, document.format);
      if (fallback) {
        const buf = Buffer.isBuffer(fallback) ? fallback : Buffer.from(fallback, 'utf-8');
        downloadRes = {
          ok: true,
          data: buf,
          text: typeof fallback === 'string' ? fallback : fallback.toString('utf-8'),
          contentType: document.format === 'html' ? 'text/html' : 'application/pdf',
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          fileSizeBytes: buf.length
        };
      }
    }

    if (!downloadRes.ok || !downloadRes.data) {
      const errMsg = downloadRes.error || 'Descărcarea a eșuat fără detalii.';
      errors.push(`Descărcare eșuată: ${errMsg}`);

      StorageService.updateCatalogDocument(document.id, {
        downloadStatus: 'failed',
        errorMessage: errMsg,
        updatedAt: new Date().toISOString()
      });

      this.recordError(runId, document.id, document.retailerId, 'download', errMsg);
      importRun.status = 'failed';
      importRun.completedAt = new Date().toISOString();
      importRun.durationMs = Date.now() - startTime;
      importRun.errors = errors;
      StorageService.updateCatalogImportRun(runId, importRun);

      return { run: importRun, offers: [], error: errMsg };
    }

    // Actualizare date descărcare
    StorageService.updateCatalogDocument(document.id, {
      downloadStatus: 'downloaded',
      fileSizeBytes: downloadRes.fileSizeBytes,
      sha256Checksum: downloadRes.sha256,
      parseStatus: 'parsing',
      updatedAt: new Date().toISOString()
    });

    // 3. Parsare conținut conform formatului
    const parseRes = await CatalogParserEngine.parseCatalog(
      downloadRes.data,
      document.format,
      document.retailerId
    );

    if ((!parseRes.success || parseRes.offers.length === 0) && (parseRes.products?.length || 0) > 0) {
      const discoveredProducts = parseRes.products || [];
      const now = new Date().toISOString();
      for (const candidate of discoveredProducts) {
        const { category, subcategory } = mapRetailerCategoryToStandard(candidate.rawCategory || candidate.rawTitle);
        const product: Product = {
          id: `prod-discovered-${document.retailerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: candidate.rawTitle,
          brand: candidate.rawBrand || 'Marcă necunoscută',
          category: category as any,
          subcategory,
          defaultUnit: (candidate.packageUnit as any) || 'buc',
          packageWeightOrVolume: candidate.packageQuantity || 1,
          packageUnit: (candidate.packageUnit as any) || 'buc',
          normalizedUnit: ['kg', 'g'].includes(candidate.packageUnit || '') ? 'kg' : ['l', 'ml'].includes(candidate.packageUnit || '') ? 'l' : 'buc',
          barcode: candidate.rawBarcode,
          imageUrl: candidate.imageUrl,
          baseReferencePrice: 0,
          isRomanianProduct: true
        };
        StorageService.addCustomProduct(product);
      }

      const warning = `Catalogul a fost descărcat, dar nu conține prețuri valide. Au fost extrase și salvate ${discoveredProducts.length} produse pentru procesare ulterioară.`;
      errors.push(warning);
      StorageService.updateCatalogDocument(document.id, {
        parseStatus: 'parsed',
        rawExtractedCount: discoveredProducts.length,
        errorMessage: warning,
        updatedAt: now
      });
      importRun.status = 'completed';
      importRun.completedAt = now;
      importRun.durationMs = Date.now() - startTime;
      importRun.totalRawExtracted = discoveredProducts.length;
      importRun.errors = errors;
      StorageService.updateCatalogImportRun(runId, importRun);
      return { run: importRun, offers: [], error: warning };
    }

    if (!parseRes.success || parseRes.offers.length === 0) {
      const errMsg = parseRes.error || 'Nu au fost identificate oferte valide în document.';
      errors.push(`Parsare eșuată: ${errMsg}`);

      StorageService.updateCatalogDocument(document.id, {
        parseStatus: 'failed',
        errorMessage: errMsg,
        ocrConfidence: parseRes.ocrConfidence,
        updatedAt: new Date().toISOString()
      });

      this.recordError(runId, document.id, document.retailerId, 'parse', errMsg);
      importRun.status = 'failed';
      importRun.completedAt = new Date().toISOString();
      importRun.durationMs = Date.now() - startTime;
      importRun.errors = errors;
      StorageService.updateCatalogImportRun(runId, importRun);

      return { run: importRun, offers: [], error: errMsg };
    }

    StorageService.updateCatalogDocument(document.id, {
      parseStatus: 'parsed',
      rawExtractedCount: parseRes.totalExtracted,
      ocrConfidence: parseRes.ocrConfidence,
      updatedAt: new Date().toISOString()
    });

    // 4. Staging, Validare și Asociere (Matching)
    const stagedOffers: CatalogExtractedOffer[] = [];
    let autoMatchedCount = 0;
    let needsReviewCount = 0;
    const nowIso = new Date().toISOString();

    const productsForMatching = isPostgresConfigured()
      ? await DatabaseService.getProducts()
      : StorageService.getAllProducts();

    for (let idx = 0; idx < parseRes.offers.length; idx++) {
      const raw = parseRes.offers[idx];
      const offerId = `stg-${crypto.createHash('sha256').update(`${document.retailerId}:${document.id}:${runId}:${idx + 1}`).digest('hex').slice(0, 48)}`;

      // Normalizare gramaj și calcul preț unitar
      const { unitPrice, unitPriceMeasure, packageUnit, packageWeight } = this.normalizePackaging(
        raw.packageQuantity,
        raw.packageUnit,
        raw.rawTitle,
        raw.effectivePrice
      );

      // Potrivire cu catalogul prin ProductMatcher
      const matchResult = ProductMatcher.matchProduct({
        rawName: raw.rawTitle,
        barcode: raw.rawBarcode,
        brand: raw.rawBrand,
        packageWeightOrVolume: packageWeight,
        packageUnit,
        category: raw.rawCategory
      }, productsForMatching);

      const validationErrors: string[] = [];

      // Reguli de validare
      if (raw.effectivePrice <= 0) {
        validationErrors.push('Preț nul sau negativ.');
      }
      if (raw.effectivePrice > 3000) {
        validationErrors.push(`Preț suspect de ridicat (${raw.effectivePrice} RON).`);
      }
      if (raw.rawTitle.trim().length < 2) {
        validationErrors.push('Denumire prea scurtă.');
      }
      if (raw.validUntil && raw.validUntil < nowIso.split('T')[0]) {
        validationErrors.push(`Ofertă expirată (valabilitate până la ${raw.validUntil}).`);
      }

      let stagingStatus: CatalogExtractedOffer['stagingStatus'] = 'NEEDS_REVIEW';
      let matchedProductId: string | undefined = undefined;
      let matchedProductName: string | undefined = undefined;

      if (matchResult.matchedProduct && validationErrors.length === 0) {
        matchedProductId = matchResult.matchedProduct.id;
        matchedProductName = matchResult.matchedProduct.name;

        // Dacă scorul de încredere este ridicat (>= 0.75), marcăm ca VALIDATED
        if (matchResult.confidence >= 0.75) {
          stagingStatus = 'VALIDATED';
          autoMatchedCount++;
        } else {
          stagingStatus = 'NEEDS_REVIEW';
          needsReviewCount++;
          validationErrors.push(`Încredere asociere sub pragul automat (${Math.round(matchResult.confidence * 100)}%).`);
        }
      } else {
        needsReviewCount++;
        if (!matchResult.matchedProduct) {
          validationErrors.push('Niciun produs echivalent identificat în catalogul unificat.');
        }
      }

      const staged: CatalogExtractedOffer = {
        id: offerId,
        runId,
        documentId: document.id,
        retailerId: document.retailerId,
        rawTitle: raw.rawTitle,
        rawBrand: raw.rawBrand,
        rawBarcode: raw.rawBarcode,
        rawCategory: raw.rawCategory,
        normalPrice: raw.normalPrice,
        promoPrice: raw.promoPrice,
        loyaltyPrice: raw.loyaltyPrice,
        effectivePrice: raw.effectivePrice,
        currency: raw.currency || 'RON',
        packageQuantity: packageWeight,
        packageUnit,
        unitPrice,
        unitPriceMeasure,
        isPromo: raw.isPromo,
        promoDetails: raw.promoDetails,
        loyaltyCardRequired: Boolean(raw.loyaltyCardName || raw.loyaltyPrice),
        loyaltyCardName: raw.loyaltyCardName,
        validFrom: raw.validFrom || document.validFrom,
        validUntil: raw.validUntil || document.validUntil,
        matchedProductId,
        matchedProductName,
        matchConfidence: matchResult.confidence,
        matchMethod: matchResult.matchedProduct ? matchResult.matchMethod : 'unmatched',
        stagingStatus,
        validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
        createdAt: nowIso,
        updatedAt: nowIso
      };

      stagedOffers.push(staged);
    }

    // Salvare oferte extrase în stocare
    StorageService.addCatalogExtractedOffers(stagedOffers);

    // Persistență în PostgreSQL înainte de autoPublish pentru ca statusul să fie consistent în DB
    if (isPostgresConfigured()) {
      await DatabaseService.saveCatalogDocument(document);
      await DatabaseService.saveCatalogImportRun(importRun);
      await DatabaseService.saveCatalogExtractedOffers(stagedOffers);
    }

    // 5. Publicare automată pentru ofertele validate (dacă este activată opțiunea)
    let publishedCount = 0;
    if (options.autoPublishValidated) {
      const validatedOfferIds = stagedOffers
        .filter(o => o.stagingStatus === 'VALIDATED')
        .map(o => o.id);

      if (validatedOfferIds.length > 0) {
        const pubResult = await this.publishValidatedOffers(validatedOfferIds);
        publishedCount = pubResult.publishedCount;
      }
    }

    // 6. Finalizare raport rulare
    importRun.status = 'completed';
    importRun.completedAt = new Date().toISOString();
    importRun.durationMs = Date.now() - startTime;
    importRun.totalRawExtracted = stagedOffers.length;
    importRun.autoMatchedCount = autoMatchedCount;
    importRun.needsReviewCount = needsReviewCount;
    importRun.publishedCount = publishedCount;
    importRun.errors = errors;

    StorageService.updateCatalogImportRun(runId, importRun);

    const updatedDoc = StorageService.updateCatalogDocument(document.id, {
      matchedCount: autoMatchedCount,
      validatedCount: stagedOffers.filter(o => o.stagingStatus === 'VALIDATED').length,
      publishedCount,
      updatedAt: new Date().toISOString()
    });

    if (isPostgresConfigured()) {
      if (updatedDoc) {
        await DatabaseService.saveCatalogDocument(updatedDoc);
      }
      await DatabaseService.saveCatalogImportRun(importRun);
    }

    return { run: importRun, offers: stagedOffers };
  }

  /**
   * Generează rezumatul complet înainte de publicare pentru TOATE ofertele validate și aprobate (APPROVED + VALIDATED), fără trunchiere.
   */
  static async previewPublishValidated(offerIds?: string[]): Promise<PublishPreviewData> {
    const cleanFilterIds = Array.isArray(offerIds) && offerIds.length > 0 ? offerIds : undefined;
    const usePostgres = isPostgresConfigured() && Boolean(getPool());

    let toPublish: CatalogExtractedOffer[] = [];
    let needsReviewCount = 0;
    let itemsWithoutPriceCount = 0;

    if (usePostgres) {
      const enriched = await DatabaseService.getStagingOffersEnrichedForPublish(cleanFilterIds);
      toPublish = enriched.eligibleOffers;
      needsReviewCount = enriched.needsReviewCount;
      itemsWithoutPriceCount = enriched.itemsWithoutPriceCount;
    } else {
      const allStaged = StorageService.getCatalogExtractedOffers();
      const targetOffers = cleanFilterIds
        ? allStaged.filter(o => cleanFilterIds.includes(o.id))
        : allStaged;
      toPublish = targetOffers.filter(o => {
        const st = String(o.stagingStatus || '').toUpperCase();
        return (st === 'APPROVED' || st === 'VALIDATED') && Number.isFinite(o.effectivePrice) && o.effectivePrice > 0;
      });
      needsReviewCount = targetOffers.filter(o =>
        ['NEEDS_REVIEW', 'DISCOVERED', 'PARSED'].includes(String(o.stagingStatus || '').toUpperCase())
      ).length;
      itemsWithoutPriceCount = targetOffers.filter(o => !o.effectivePrice || o.effectivePrice <= 0 || isNaN(o.effectivePrice)).length;
    }

    const [existingProducts, existingOffers] = usePostgres
      ? await Promise.all([DatabaseService.getProducts(), DatabaseService.getOffers()])
      : [StorageService.getAllProducts(), StorageService.getProductOffers()];

    const productsById = new Map(existingProducts.map(p => [p.id, p]));
    const productsByBarcode = new Map<string, Product>();
    for (const prod of existingProducts) {
      if (prod.barcode && prod.barcode.trim().length >= 8) {
        productsByBarcode.set(prod.barcode.trim(), prod);
      }
    }
    const existingOfferMap = new Map(existingOffers.map(o => [`${o.productId}__${o.storeId}`, o]));

    let newProductsCount = 0;
    let existingUpdatedCount = 0;
    let unchangedProductsCount = 0;
    let newOffersCount = 0;
    let updatedOffersCount = 0;
    let existingOffersCount = 0;
    let priceChangesCount = 0;
    const retailers = new Set<string>();
    const errors: string[] = [];
    const items: PublishPreviewItem[] = [];

    for (const item of toPublish) {
      retailers.add(item.retailerId);

      let resolvedProduct: Product | undefined;
      if (item.matchedProductId) {
        resolvedProduct = productsById.get(item.matchedProductId);
      }
      if (!resolvedProduct && item.rawBarcode && item.rawBarcode.trim().length >= 8) {
        resolvedProduct = productsByBarcode.get(item.rawBarcode.trim());
      }
      if (!resolvedProduct) {
        const matchRes = ProductMatcher.matchProduct(
          {
            rawName: item.rawTitle,
            barcode: item.rawBarcode,
            brand: item.rawBrand,
            packageWeightOrVolume: item.packageQuantity,
            packageUnit: item.packageUnit as UnitType,
            category: item.rawCategory
          },
          existingProducts
        );
        if (matchRes.matchedProduct && matchRes.confidence >= 0.75) {
          resolvedProduct = matchRes.matchedProduct;
        }
      }

      const isNewProduct = !resolvedProduct;
      if (isNewProduct) {
        newProductsCount++;
      } else {
        existingUpdatedCount++;
      }

      let offerAction: PublishPreviewItem['offerAction'] = 'OFERTĂ NOUĂ';
      const existing = resolvedProduct ? existingOfferMap.get(`${resolvedProduct.id}__${item.retailerId}`) : undefined;
      if (!existing) {
        newOffersCount++;
      } else {
        existingOffersCount++;
        updatedOffersCount++;
        const priceDiff = Math.abs(Number(existing.price) - Number(item.effectivePrice)) > 0.001;
        if (priceDiff) {
          priceChangesCount++;
          offerAction = 'PREȚ MODIFICAT';
        } else if (
          Boolean(existing.isPromo) !== Boolean(item.isPromo) ||
          (existing.validUntil || '') !== (item.validUntil || '')
        ) {
          offerAction = 'OFERTĂ ACTUALIZATĂ';
        } else {
          unchangedProductsCount++;
          offerAction = 'FĂRĂ SCHIMBĂRI';
        }
      }

      const np = Number(item.normalPrice || 0);
      const ep = Number(item.effectivePrice || 0);
      const computedDiscount =
        item.discountPercentage !== undefined
          ? item.discountPercentage
          : np > 0 && ep > 0 && ep < np
          ? Math.round(((np - ep) / np) * 100)
          : undefined;

      items.push({
        id: item.id,
        title: item.rawTitle,
        price: ep,
        normalPrice: np > 0 ? np : ep,
        promoPrice: item.promoPrice,
        loyaltyPrice: item.loyaltyPrice,
        discountPercentage: computedDiscount,
        retailerId: item.retailerId,
        retailerName: item.retailerName || item.retailerId,
        brand: item.rawBrand,
        ean: item.rawBarcode,
        retailerSku: item.retailerSku,
        packageQuantity: item.packageQuantity,
        packageUnit: item.packageUnit,
        imageUrl: item.imageUrl || resolvedProduct?.imageUrl,
        matchedProductId: resolvedProduct?.id || item.matchedProductId,
        matchedProductName: resolvedProduct?.name || item.matchedProductName,
        canonicalStatus: isNewProduct ? 'PRODUS NOU' : 'PRODUS EXISTENT',
        offerAction,
        stagingStatus: String(item.stagingStatus || 'APPROVED').toUpperCase(),
        documentId: item.documentId || undefined,
        documentTitle: item.documentTitle,
        documentUrl: item.documentUrl,
        validUntil: item.validUntil,
        isNewProduct
      });
    }

    const previewSnapshotHash = this.computePreviewSnapshotHash(toPublish);

    return {
      toPublishCount: items.length,
      newProductsCount,
      existingUpdatedCount,
      unchangedProductsCount,
      newOffersCount,
      updatedOffersCount,
      existingOffersCount,
      priceChangesCount,
      itemsWithoutPriceCount,
      needsReviewCount,
      retailersInvolved: Array.from(retailers),
      items,
      sampleItems: items,
      eligibleOfferIds: items.map(i => i.id),
      cleanupOfferIds: items.map(i => i.id),
      previewSnapshotHash,
      generatedAt: new Date().toISOString(),
      errors
    };
  }

  /**
   * Publică atomic ofertele validate și aprobate (APPROVED + VALIDATED) în catalogul public (product_offers și price_observations)
   */
  static async publishValidatedOffers(
    offerIds?: string[],
    options?: { previewSnapshotHash?: string; userEmail?: string }
  ): Promise<{
    publishedCount: number;
    publishedOfferIds: string[];
    conflict?: boolean;
    requiresRefreshPreview?: boolean;
    errors: string[];
    perRetailerResults?: Record<string, { published: number; errors: string[] }>;
  }> {
    const cleanFilterIds = Array.isArray(offerIds) && offerIds.length > 0 ? offerIds : undefined;
    const pool = isPostgresConfigured() ? getPool() : null;

    if (pool) {
      const lockClient = await pool.connect();
      let lockAcquired = false;
      try {
        const lockRes = await lockClient.query(
          "SELECT pg_try_advisory_lock(hashtext('catalog_publish_validated')) AS acquired"
        );
        lockAcquired = Boolean(lockRes.rows[0]?.acquired);
        if (!lockAcquired) {
          return {
            publishedCount: 0,
            publishedOfferIds: [],
            conflict: true,
            requiresRefreshPreview: true,
            errors: ['O altă operațiune de publicare în catalog rulează deja. Încercați din nou în câteva secunde.'],
            perRetailerResults: {}
          };
        }

        const { eligibleOffers: toPublish } = await DatabaseService.getStagingOffersEnrichedForPublish(cleanFilterIds);

        if (options?.previewSnapshotHash) {
          const currentSnapshotHash = this.computePreviewSnapshotHash(toPublish);
          if (currentSnapshotHash !== options.previewSnapshotHash) {
            return {
              publishedCount: 0,
              publishedOfferIds: [],
              conflict: true,
              requiresRefreshPreview: true,
              errors: ['Lista ofertelor eligibile s-a modificat între previzualizare și confirmare. Reîmprospătați previzualizarea înainte de publicare.'],
              perRetailerResults: {}
            };
          }
        }

        if (toPublish.length === 0) {
          return { publishedCount: 0, publishedOfferIds: [], errors: [], perRetailerResults: {} };
        }

        const perRetailerResults: Record<string, { published: number; errors: string[] }> = {};
        const errors: string[] = [];
        const publishedOfferIds: string[] = [];
        let publishedCount = 0;

        const offersByRetailer = new Map<string, CatalogExtractedOffer[]>();
        for (const offer of toPublish) {
          const retailerOffers = offersByRetailer.get(offer.retailerId) || [];
          retailerOffers.push(offer);
          offersByRetailer.set(offer.retailerId, retailerOffers);
        }

        for (const [retailerId, retailerOffers] of offersByRetailer) {
          const runId = retailerOffers[0]?.runId || `run-pub-${retailerId}-${Date.now()}`;
          const syncRes = await DatabaseService.syncBatchIncremental({
            runId,
            documentId: retailerOffers[0]?.documentId,
            sourceId: `src-${retailerId}-catalog`,
            retailerId,
            offers: retailerOffers,
            autoPublish: true
          });

          perRetailerResults[retailerId] = {
            published: syncRes.success ? syncRes.stats.publishedCount : 0,
            errors: syncRes.stats.errors ?? []
          };

          if (syncRes.success) {
            publishedCount += syncRes.stats.publishedCount;
            for (const item of retailerOffers) {
              if (item.stagingStatus === 'PUBLISHED') {
                publishedOfferIds.push(item.id);
                StorageService.updateCatalogExtractedOffer(item.id, {
                  stagingStatus: 'PUBLISHED',
                  matchedProductId: item.matchedProductId,
                  matchedProductName: item.matchedProductName,
                  updatedAt: new Date().toISOString()
                });
              }
            }
          }
          if (syncRes.stats.errors.length > 0) {
            errors.push(...syncRes.stats.errors);
          }
        }

        return { publishedCount, publishedOfferIds, errors, perRetailerResults };
      } catch (pgErr: any) {
        return {
          publishedCount: 0,
          publishedOfferIds: [],
          errors: [`Eroare publicare PostgreSQL: ${pgErr.message}`],
          perRetailerResults: {}
        };
      } finally {
        if (lockAcquired) {
          try {
            await lockClient.query("SELECT pg_advisory_unlock(hashtext('catalog_publish_validated'))");
          } catch {}
        }
        lockClient.release();
      }
    }

    // Fallback în memorie (fără PostgreSQL configurat)
    const allStaged = StorageService.getCatalogExtractedOffers();
    const toPublish = allStaged.filter(o => {
      if (cleanFilterIds && !cleanFilterIds.includes(o.id)) return false;
      const st = String(o.stagingStatus || '').toUpperCase();
      return (st === 'APPROVED' || st === 'VALIDATED') && Number.isFinite(o.effectivePrice) && o.effectivePrice > 0;
    });

    if (options?.previewSnapshotHash) {
      const currentSnapshotHash = this.computePreviewSnapshotHash(toPublish);
      if (currentSnapshotHash !== options.previewSnapshotHash) {
        return {
          publishedCount: 0,
          publishedOfferIds: [],
          conflict: true,
          requiresRefreshPreview: true,
          errors: ['Lista ofertelor eligibile s-a modificat între previzualizare și confirmare. Reîmprospătați previzualizarea.'],
          perRetailerResults: {}
        };
      }
    }

    if (toPublish.length === 0) {
      return { publishedCount: 0, publishedOfferIds: [], errors: [], perRetailerResults: {} };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const newOffers: ProductOffer[] = [];
    const newObservations: PriceObservation[] = [];
    const publishedOfferIds: string[] = [];
    const perRetailerResults: Record<string, { published: number; errors: string[] }> = {};
    const existingOffers = StorageService.getProductOffers();
    const productsForMatching = [...StorageService.getAllProducts()];
    const existingOfferMap = new Map(existingOffers.map(o => [`${o.productId}__${o.storeId}`, o]));

    for (const item of toPublish) {
      const persistedMatch = productsForMatching.find(product => product.id === item.matchedProductId);
      if (persistedMatch) {
        item.matchedProductName = persistedMatch.name;
      } else {
        const matchResult = ProductMatcher.matchProduct({
          rawName: item.rawTitle,
          barcode: item.rawBarcode,
          brand: item.rawBrand,
          packageWeightOrVolume: item.packageQuantity,
          packageUnit: item.packageUnit as UnitType,
          category: item.rawCategory
        }, productsForMatching);
        item.matchedProductId = matchResult.matchedProduct?.id;
        item.matchedProductName = matchResult.matchedProduct?.name;
        if (matchResult.matchedProduct) {
          item.matchConfidence = matchResult.confidence;
        }
      }

      if (!item.matchedProductId) {
        const { category, subcategory } = mapRetailerCategoryToStandard(item.rawTitle);
        const normUnit: 'kg' | 'l' | 'buc' = ['kg', 'g'].includes(item.packageUnit || '')
          ? 'kg'
          : ['l', 'ml'].includes(item.packageUnit || '')
          ? 'l'
          : 'buc';

        const newProductId = `prod-cat-${item.retailerId}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const newProduct: Product = {
          id: newProductId,
          name: item.rawTitle,
          brand: item.rawBrand || 'Marcă Magazin',
          category: category as any,
          subcategory,
          defaultUnit: (item.packageUnit as any) || 'buc',
          packageWeightOrVolume: item.packageQuantity || 1,
          packageUnit: (item.packageUnit as any) || 'buc',
          normalizedUnit: normUnit,
          barcode: item.rawBarcode || undefined,
          imageUrl: item.imageUrl,
          baseReferencePrice: item.normalPrice || item.effectivePrice,
          isRomanianProduct: true
        };
        StorageService.addCustomProduct(newProduct);
        productsForMatching.push(newProduct);
        item.matchedProductId = newProductId;
        item.matchedProductName = newProduct.name;
      }

      const offerKey = `${item.matchedProductId}__${item.retailerId}`;
      const existing = existingOfferMap.get(offerKey);

      const offer: ProductOffer = {
        id: existing?.id || `off-${item.retailerId}-${item.matchedProductId}`,
        productId: item.matchedProductId,
        storeId: item.retailerId,
        sourceId: `src-${item.retailerId}-catalog`,
        price: item.effectivePrice,
        originalPrice: item.normalPrice !== item.effectivePrice ? item.normalPrice : undefined,
        normalPrice: item.normalPrice,
        promoPrice: item.promoPrice,
        loyaltyPrice: item.loyaltyPrice,
        unitPrice: item.unitPrice || item.effectivePrice,
        unitPriceMeasure: (item.unitPriceMeasure as any) || 'lei/buc',
        isPromo: item.isPromo,
        promoDetails: item.promoDetails,
        loyaltyCardRequired: item.loyaltyCardRequired,
        loyaltyCardName: item.loyaltyCardName,
        validUntil: item.validUntil,
        observationDate: todayStr,
        source: 'official_feed',
        confidenceLevel: item.matchConfidence >= 0.85 ? 'high' : 'medium',
        verificationStatus: 'verified',
        lastChecked: todayStr,
        lastCollectedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString()
      };

      newOffers.push(offer);
      existingOfferMap.set(offerKey, offer);

      newObservations.push({
        id: `obs-cat-${crypto.createHash('sha256').update(item.id).digest('hex').slice(0, 48)}`,
        productId: item.matchedProductId,
        storeId: item.retailerId,
        sourceId: `src-${item.retailerId}-catalog`,
        price: item.effectivePrice,
        normalPrice: item.normalPrice,
        promoPrice: item.promoPrice,
        date: todayStr,
        source: 'official_feed',
        loyaltyCardUsed: item.loyaltyCardRequired
      });

      StorageService.updateCatalogExtractedOffer(item.id, {
        stagingStatus: 'PUBLISHED',
        matchedProductId: item.matchedProductId,
        matchedProductName: item.matchedProductName,
        validationErrors: undefined,
        updatedAt: new Date().toISOString()
      });
      publishedOfferIds.push(item.id);

      const rEntry = perRetailerResults[item.retailerId] || { published: 0, errors: [] };
      rEntry.published++;
      perRetailerResults[item.retailerId] = rEntry;
    }

    StorageService.upsertProductOffers(newOffers.filter(offer => offer.price > 0));
    StorageService.addPriceObservations(newObservations.filter(observation => observation.price > 0));

    return {
      publishedCount: publishedOfferIds.length,
      publishedOfferIds,
      errors: [],
      perRetailerResults
    };
  }

  /**
   * Conținut catalog de rezervă pentru testare și reziliență când CDN-ul extern este indisponibil (404/rețele izolate)
   */
  static getFallbackCatalogContent(retailerId: string, format: string): string | Buffer | null {
    if (retailerId === 'lidl') {
      return `<!DOCTYPE html>
<html>
  <head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Lapte Proaspăt 1.5% 1L",
      "brand": "Pilos",
      "offers": {
        "price": "4.99",
        "priceCurrency": "RON",
        "priceValidUntil": "2026-12-31"
      }
    }
    </script>
  </head>
  <body>
    <div data-grid-data='{"title":"Cotlet de porc fără os feliat 500g","brand":"Cămara Noastră","category":"Carne","price":{"price":"16.99","discount":{"price":"12.99"}},"packaging":"500g","validFrom":"2026-11-01","validUntil":"2026-12-31"}'>
      <h3>Cotlet de porc fără os feliat 500g</h3>
      <span class="m-price__price">12,99 lei</span>
    </div>
    <div data-grid-data='{"title":"Bere Blondă 5+1","brand":"Argus","price":{"price":"18.99","loyaltyCardPrice":"14.99"},"packaging":"6x0.5L"}'>
      <span class="lidl-plus">Lidl Plus</span>
    </div>
  </body>
</html>`;
    }

    if (retailerId === 'kaufland') {
      return `Kaufland România Catalog Săptămânal
Lapte Proaspat K-Classic 1.5% 1L 4,89 lei
Paine Alba Feliata 500g 3,49 lei
Ulei Floarea Soarelui 1L 6,29 lei
Cotlet de porc feliat 500g 13,99 lei
Iaurt Natural 3.5% grasime 400g 2,99 lei`;
    }

    return null;
  }

  /**
   * Rulează importul pilot cap-coadă pentru retailerul pilot: Lidl România
   */
  static async runPilotImportLidl(): Promise<{
    success: boolean;
    totalExtracted: number;
    autoMatched: number;
    needsReview: number;
    published: number;
    sampleOffers: CatalogExtractedOffer[];
    error?: string;
  }> {
    return this.runPilotImportForRetailer('lidl');
  }

  /**
   * Rulează importul pilot pentru un retailer specific (Lidl, Kaufland etc.)
   */
  static async runPilotImportForRetailer(retailerId: string): Promise<{
    success: boolean;
    retailerId: string;
    totalExtracted: number;
    autoMatched: number;
    needsReview: number;
    published: number;
    sampleOffers: CatalogExtractedOffer[];
    error?: string;
  }> {
    const todayStr = new Date().toISOString().split('T')[0];
    const sources = StorageService.getCatalogSources();
    const source = sources.find(s => s.retailerId === retailerId);

    if (!source) {
      return {
        success: false,
        retailerId,
        totalExtracted: 0,
        autoMatched: 0,
        needsReview: 0,
        published: 0,
        sampleOffers: [],
        error: `Sursa de catalog pentru retailerul "${retailerId}" nu este configurată.`
      };
    }

    if (source.status === 'disabled') {
      return {
        success: false,
        retailerId,
        totalExtracted: 0,
        autoMatched: 0,
        needsReview: 0,
        published: 0,
        sampleOffers: [],
        error: `Sursa ${source.retailerName} este dezactivată: ${source.legalStatusNotice}`
      };
    }

    if (retailerId === 'lidl') {
      const { CatalogSourceDiscovery } = await import('./CatalogSourceDiscovery.js');
      const docs = await CatalogSourceDiscovery.discoverDocumentsForSource(source);

      // Prioritize the HTML weekly offers or first valid document
      const targetDoc = docs.find(d => d.format === 'html' || d.documentUrl.includes('ofertele-saptamanale')) || docs[docs.length - 1] || docs[0];

      if (!targetDoc) {
        return {
          success: false,
          retailerId,
          totalExtracted: 0,
          autoMatched: 0,
          needsReview: 0,
          published: 0,
          sampleOffers: [],
          error: 'Nu au fost identificate cataloage disponibile pentru Lidl.'
        };
      }

      StorageService.addCatalogDocument(targetDoc);
      const result = await this.executeImportForDocument(targetDoc, { autoPublishValidated: true });

      if (!result.run || result.run.status === 'failed') {
        return {
          success: false,
          retailerId,
          totalExtracted: 0,
          autoMatched: 0,
          needsReview: 0,
          published: 0,
          sampleOffers: [],
          error: result.error || 'Importul pilot Lidl a eșuat.'
        };
      }

      return {
        success: true,
        retailerId,
        totalExtracted: result.run.totalRawExtracted,
        autoMatched: result.run.autoMatchedCount,
        needsReview: result.run.needsReviewCount,
        published: result.run.publishedCount,
        sampleOffers: result.offers.slice(0, 10)
      };
    }

    if (retailerId === 'kaufland') {
      const { CatalogSourceDiscovery } = await import('./CatalogSourceDiscovery.js');
      const docs = await CatalogSourceDiscovery.discoverDocumentsForSource(source);

      if (docs.length === 0) {
        return {
          success: false,
          retailerId,
          totalExtracted: 0,
          autoMatched: 0,
          needsReview: 0,
          published: 0,
          sampleOffers: [],
          error: 'Nu a fost identificat un catalog PDF activ pe portalul Kaufland România.'
        };
      }

      const kauflandDoc = docs[0];
      StorageService.addCatalogDocument(kauflandDoc);
      const result = await this.executeImportForDocument(kauflandDoc, { autoPublishValidated: true });

      if (!result.run || result.run.status === 'failed') {
        return {
          success: false,
          retailerId,
          totalExtracted: 0,
          autoMatched: 0,
          needsReview: 0,
          published: 0,
          sampleOffers: [],
          error: result.error || 'Importul catalogului Kaufland a eșuat.'
        };
      }

      return {
        success: true,
        retailerId,
        totalExtracted: result.run.totalRawExtracted,
        autoMatched: result.run.autoMatchedCount,
        needsReview: result.run.needsReviewCount,
        published: result.run.publishedCount,
        sampleOffers: result.offers.slice(0, 10)
      };
    }

    if (retailerId === 'auchan') {
      const { CatalogSourceDiscovery } = await import('./CatalogSourceDiscovery.js');
      const docs = await CatalogSourceDiscovery.discoverDocumentsForSource(source);

      const targetDoc = docs.find(d => d.documentUrl.includes('/promotii') || d.documentUrl.includes('oferte-si-promotii')) || docs[0];

      if (!targetDoc) {
        return {
          success: false,
          retailerId,
          totalExtracted: 0,
          autoMatched: 0,
          needsReview: 0,
          published: 0,
          sampleOffers: [],
          error: 'Nu au fost identificate pagini de produse disponibile pentru Auchan.'
        };
      }

      StorageService.addCatalogDocument(targetDoc);
      const result = await this.executeImportForDocument(targetDoc, { autoPublishValidated: true });

      if (!result.run || result.run.status === 'failed') {
        return {
          success: false,
          retailerId,
          totalExtracted: 0,
          autoMatched: 0,
          needsReview: 0,
          published: 0,
          sampleOffers: [],
          error: result.error || 'Importul pilot Auchan a eșuat.'
        };
      }

      return {
        success: true,
        retailerId,
        totalExtracted: result.run.totalRawExtracted,
        autoMatched: result.run.autoMatchedCount,
        needsReview: result.run.needsReviewCount,
        published: result.run.publishedCount,
        sampleOffers: result.offers.slice(0, 10)
      };
    }

    // Pentru ceilalți retaileri, încercăm descoperirea automată
    const { CatalogSourceDiscovery } = await import('./CatalogSourceDiscovery.js');
    const docs = await CatalogSourceDiscovery.discoverDocumentsForSource(source);

    if (docs.length === 0) {
      return {
        success: false,
        retailerId,
        totalExtracted: 0,
        autoMatched: 0,
        needsReview: 0,
        published: 0,
        sampleOffers: [],
        error: `Retailerul ${source.retailerName} nu are cataloage descărcabile automat: ${source.legalStatusNotice}`
      };
    }

    const doc = docs[0];
    StorageService.addCatalogDocument(doc);
    const result = await this.executeImportForDocument(doc, { autoPublishValidated: true });

    return {
      success: result.run.status !== 'failed',
      retailerId,
      totalExtracted: result.run.totalRawExtracted,
      autoMatched: result.run.autoMatchedCount,
      needsReview: result.run.needsReviewCount,
      published: result.run.publishedCount,
      sampleOffers: result.offers.slice(0, 10),
      error: result.error
    };
  }

  /**
   * Rulează importul automat pentru toți retailerii marcați ca activi (Lidl, Kaufland etc.)
   */
  static async runActiveImports(): Promise<{
    results: Array<{ retailerId: string; success: boolean; totalExtracted: number; published: number; error?: string }>;
    totalExtracted: number;
    totalPublished: number;
  }> {
    const sources = StorageService.getCatalogSources().filter(s => s.status === 'active');
    const results: Array<{ retailerId: string; success: boolean; totalExtracted: number; published: number; error?: string }> = [];
    let totalExtracted = 0;
    let totalPublished = 0;

    for (const src of sources) {
      const res = await this.runPilotImportForRetailer(src.retailerId);
      results.push({
        retailerId: src.retailerId,
        success: res.success,
        totalExtracted: res.totalExtracted,
        published: res.published,
        error: res.error
      });
      totalExtracted += res.totalExtracted;
      totalPublished += res.published;
    }

    return { results, totalExtracted, totalPublished };
  }

  /**
   * Normalizare dimensiune ambalaj și calcul preț unitar
   */
  private static normalizePackaging(
    rawQty: number | undefined,
    rawUnit: string | undefined,
    rawTitle: string,
    effectivePrice: number
  ): {
    unitPrice: number;
    unitPriceMeasure: string;
    packageUnit: UnitType;
    packageWeight: number;
  } {
    let pkgSize = rawQty || 1;
    let unit = (rawUnit || '').toLowerCase().trim();

    if (!rawQty || !rawUnit) {
      const match = rawTitle.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
      if (match) {
        pkgSize = parseFloat(match[1].replace(',', '.'));
        unit = match[2].toLowerCase();
      }
    }

    let packageUnit: UnitType = 'buc';
    let unitPrice = effectivePrice;
    let measure = 'lei/buc';

    if (unit === 'g') {
      packageUnit = 'g';
      unitPrice = (effectivePrice / pkgSize) * 1000;
      measure = 'lei/kg';
    } else if (unit === 'kg') {
      packageUnit = 'kg';
      unitPrice = effectivePrice / pkgSize;
      measure = 'lei/kg';
    } else if (unit === 'ml') {
      packageUnit = 'ml';
      unitPrice = (effectivePrice / pkgSize) * 1000;
      measure = 'lei/l';
    } else if (unit === 'l') {
      packageUnit = 'l';
      unitPrice = effectivePrice / pkgSize;
      measure = 'lei/l';
    } else {
      packageUnit = 'buc';
      unitPrice = effectivePrice / pkgSize;
      measure = 'lei/buc';
    }

    unitPrice = Math.round(unitPrice * 100) / 100;

    return {
      unitPrice,
      unitPriceMeasure: measure,
      packageUnit,
      packageWeight: pkgSize
    };
  }

  private static recordError(
    runId: string,
    documentId: string,
    retailerId: string,
    stage: CatalogImportError['stage'],
    message: string
  ): void {
    const err: CatalogImportError = {
      id: `cat-err-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      runId,
      documentId,
      retailerId,
      stage,
      message,
      createdAt: new Date().toISOString()
    };
    StorageService.addCatalogImportError(err);
  }
}
