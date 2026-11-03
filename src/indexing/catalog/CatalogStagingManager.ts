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
import { ProductOffer, PriceObservation, UnitType } from '../../types';
import { PriceQualityMonitor } from '../PriceQualityMonitor';
import { CatalogSourceDiscovery } from './CatalogSourceDiscovery';

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
      ? allStaged.filter(o => offerIds.includes(o.id) && o.stagingStatus === 'VALIDATED' && o.matchedProductId)
      : allStaged.filter(o => o.stagingStatus === 'VALIDATED' && o.matchedProductId);

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
      if (!item.matchedProductId) continue;

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
   * Rulează fluxul complet pentru orice sursă de catalog activă.
   * Lidl rămâne disponibil prin metoda pilot existentă pentru compatibilitate.
   */
  static async runImportForRetailer(retailerId: string): Promise<{
    success: boolean;
    totalExtracted: number;
    autoMatched: number;
    needsReview: number;
    published: number;
    sampleOffers: CatalogExtractedOffer[];
    error?: string;
  }> {
    const source = StorageService.getCatalogSources().find(
      candidate => candidate.retailerId === retailerId && candidate.status === 'active'
    );

    if (!source) {
      return {
        success: false,
        totalExtracted: 0,
        autoMatched: 0,
        needsReview: 0,
        published: 0,
        sampleOffers: [],
        error: `Nu există o sursă activă pentru ${retailerId}. Activează sursa și verifică autorizarea înainte de indexare.`
      };
    }

    const documents = await CatalogSourceDiscovery.discoverDocumentsForSource(source);
    if (documents.length === 0) {
      return {
        success: false,
        totalExtracted: 0,
        autoMatched: 0,
        needsReview: 0,
        published: 0,
        sampleOffers: [],
        error: `Nu au fost descoperite cataloage pentru ${source.retailerName}.`
      };
    }

    let totalExtracted = 0;
    let autoMatched = 0;
    let needsReview = 0;
    let published = 0;
    const sampleOffers: CatalogExtractedOffer[] = [];
    let lastError: string | undefined;

    for (const document of documents) {
      StorageService.addCatalogDocument(document);
      const result = await this.executeImportForDocument(document, { autoPublishValidated: true });
      if (!result.run || result.run.status === 'failed') {
        lastError = result.error || `Procesarea documentului ${document.title} a eșuat.`;
        continue;
      }
      totalExtracted += result.run.totalRawExtracted;
      autoMatched += result.run.autoMatchedCount;
      needsReview += result.run.needsReviewCount;
      published += result.run.publishedCount;
      sampleOffers.push(...result.offers.slice(0, 10 - sampleOffers.length));
    }

    return {
      success: totalExtracted > 0,
      totalExtracted,
      autoMatched,
      needsReview,
      published,
      sampleOffers,
      error: totalExtracted > 0 ? undefined : lastError || 'Importul nu a extras oferte.'
    };
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
    const todayStr = new Date().toISOString().split('T')[0];
    const lidlDoc: CatalogDocument = {
      id: `doc-lidl-live-${todayStr}`,
      sourceId: 'cat-src-lidl',
      retailerId: 'lidl',
      documentUrl: 'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219',
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
        totalExtracted: 0,
        autoMatched: 0,
        needsReview: 0,
        published: 0,
        sampleOffers: [],
        error: result.error || 'Importul pilot a eșuat.'
      };
    }

    return {
      success: true,
      totalExtracted: result.run.totalRawExtracted,
      autoMatched: result.run.autoMatchedCount,
      needsReview: result.run.needsReviewCount,
      published: result.run.publishedCount,
      sampleOffers: result.offers.slice(0, 10)
    };
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
