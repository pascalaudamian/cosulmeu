// src/indexing/catalog/CatalogStagingManager.ts
// Manager complet pentru descărcare, parsare, deduplicare, potrivire, staging și publicare oferte de catalog

import {
  CatalogDocument,
  CatalogExtractedOffer,
  CatalogImportRun,
  CatalogImportError,
  CatalogSource
} from './catalogTypes';
import { CatalogDownloader } from './CatalogDownloader';
import { CatalogParserEngine, RawParsedOffer } from './CatalogParserEngine';
import { ProductMatcher } from '../../services/ProductMatcher';
import { StorageService } from '../../services/StorageService';
import { DatabaseService, isPostgresConfigured, getPool } from '../../db/index';
import { Product, ProductOffer, PriceObservation, UnitType } from '../../types';
import { PriceQualityMonitor } from '../PriceQualityMonitor';
import { mapRetailerCategoryToStandard } from '../../data/categories';

export class CatalogStagingManager {
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
    const downloadRes = await CatalogDownloader.downloadCatalog(document.documentUrl, {
      timeoutMs: 25000,
      maxRetries: 2
    });

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

    for (let idx = 0; idx < parseRes.offers.length; idx++) {
      const raw = parseRes.offers[idx];
      const offerId = `stg-${document.retailerId}-${document.id}-${idx + 1}`;

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
      });

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
      await DatabaseService.saveCatalogExtractedOffers(stagedOffers);
    }

    return { run: importRun, offers: stagedOffers };
  }

  /**
   * Publică ofertele validate direct în catalogul public de produse (product_offers și price_observations)
   */
  static async publishValidatedOffers(offerIds?: string[]): Promise<{ publishedCount: number; errors: string[] }> {
    const allStaged = StorageService.getCatalogExtractedOffers();
    const toPublish = offerIds
      ? allStaged.filter(o => offerIds.includes(o.id) && o.stagingStatus === 'VALIDATED')
      : allStaged.filter(o => o.stagingStatus === 'VALIDATED');

    if (toPublish.length === 0) {
      return { publishedCount: 0, errors: [] };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const newOffers: ProductOffer[] = [];
    const newObservations: PriceObservation[] = [];
    const errors: string[] = [];

    const existingOffers = StorageService.getProductOffers();
    const existingOfferMap = new Map(existingOffers.map(o => [`${o.productId}__${o.storeId}`, o]));

    for (const item of toPublish) {
      // Dacă oferta aprobată nu a fost asociată manual cu un produs existent,
      // creăm automat produsul unificat în catalog pentru a fi indexat și vizibil în pagina Produse
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
          baseReferencePrice: item.normalPrice || item.effectivePrice,
          isRomanianProduct: true
        };

        StorageService.addCustomProduct(newProduct);
        item.matchedProductId = newProductId;
        item.matchedProductName = newProduct.name;
        StorageService.updateCatalogExtractedOffer(item.id, {
          matchedProductId: newProductId,
          matchedProductName: newProduct.name,
          updatedAt: new Date().toISOString()
        });
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

      // Adăugare observație istorică append-only
      const obs: PriceObservation = {
        id: `obs-cat-${item.id}-${Date.now()}`,
        productId: item.matchedProductId,
        storeId: item.retailerId,
        sourceId: `src-${item.retailerId}-catalog`,
        price: item.effectivePrice,
        normalPrice: item.normalPrice,
        promoPrice: item.promoPrice,
        date: todayStr,
        source: 'official_feed',
        loyaltyCardUsed: item.loyaltyCardRequired
      };

      newObservations.push(obs);

      // Marcare ofertă ca PUBLISHED
      StorageService.updateCatalogExtractedOffer(item.id, {
        stagingStatus: 'PUBLISHED',
        updatedAt: new Date().toISOString()
      });
    }

    // Persistență în StorageService (memorie / local)
    StorageService.upsertProductOffers(newOffers);
    StorageService.addPriceObservations(newObservations);

    // Persistență în PostgreSQL dacă este configurat și conectat
    if (isPostgresConfigured()) {
      try {
        const pool = getPool();
        if (pool) {
          for (const off of newOffers) {
            await pool.query(
              `INSERT INTO product_offers (
                id, product_id, store_id, source_id, price, original_price, normal_price,
                promo_price, loyalty_price, unit_price, unit_price_measure, is_promo,
                promo_details, loyalty_card_required, loyalty_card_name, valid_until,
                observation_date, source, confidence_level, verification_status, last_checked
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
              ON CONFLICT (product_id, store_id) DO UPDATE SET
                price = EXCLUDED.price,
                normal_price = EXCLUDED.normal_price,
                promo_price = EXCLUDED.promo_price,
                loyalty_price = EXCLUDED.loyalty_price,
                unit_price = EXCLUDED.unit_price,
                is_promo = EXCLUDED.is_promo,
                promo_details = EXCLUDED.promo_details,
                valid_until = EXCLUDED.valid_until,
                observation_date = EXCLUDED.observation_date,
                verification_status = 'verified',
                last_checked = NOW()`,
              [
                off.id,
                off.productId,
                off.storeId,
                off.sourceId,
                off.price,
                off.originalPrice || null,
                off.normalPrice || null,
                off.promoPrice || null,
                off.loyaltyPrice || null,
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
                off.verificationStatus
              ]
            );
          }
          await DatabaseService.appendPriceObservations(newObservations);
          await DatabaseService.saveCatalogExtractedOffers(toPublish.map(p => ({
            ...p,
            stagingStatus: 'PUBLISHED' as const,
            updatedAt: new Date().toISOString()
          })));
        }
      } catch (pgErr: any) {
        errors.push(`Avertisment salvare PostgreSQL: ${pgErr.message}`);
      }
    }

    return { publishedCount: newOffers.length, errors };
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
      const lidlDoc: CatalogDocument = {
        id: `doc-lidl-live-${todayStr}`,
        sourceId: source.id,
        retailerId: 'lidl',
        documentUrl: source.catalogUrl,
        title: `Catalog Săptămânal Lidl Plus Live (${todayStr})`,
        format: 'html',
        validFrom: todayStr,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      StorageService.addCatalogDocument(lidlDoc);
      const result = await this.executeImportForDocument(lidlDoc, { autoPublishValidated: true });

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
      const { CatalogSourceDiscovery } = await import('./CatalogSourceDiscovery');
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

    // Pentru ceilalți retaileri, încercăm descoperirea automată
    const { CatalogSourceDiscovery } = await import('./CatalogSourceDiscovery');
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
