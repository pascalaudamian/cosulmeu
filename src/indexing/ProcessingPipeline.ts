// src/indexing/ProcessingPipeline.ts
// Pipeline Modular de Procesare, Identificare, Tranzacționare și Proveniență

import {
  CollectionBatch,
  BatchProcessingResult,
  ValidatedCollectorItem
} from './types';
import { ProductMatcher } from '../services/ProductMatcher';
import { StorageService } from '../services/StorageService';
import { RetailerRegistry } from './RetailerRegistry';
import { getCollectorForRetailer } from './RetailerCollectors';
import { getPool } from '../db/index';
import { ProductOffer, PriceObservation, ProductMatchCandidate, SourceSyncRun } from '../types';

export class ProcessingPipeline {
  /**
   * Procesează un lot de colectare cap-coadă
   */
  static async processBatch(
    batch: CollectionBatch,
    options: { dryRun?: boolean } = {}
  ): Promise<BatchProcessingResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    const collector = getCollectorForRetailer(batch.retailerId);
    const { valid, invalid, duplicatesCount } = collector.validateAndNormalize(batch);

    const offers: ProductOffer[] = [];
    const observations: PriceObservation[] = [];
    const candidates: ProductMatchCandidate[] = [];
    let autoMatchedCount = 0;
    let priceChangesCount = 0;

    const observationDate = batch.collectedAt.slice(0, 10);

    // Consultăm ofertele curente din memorie/stocare pentru detecția schimbărilor de preț
    const existingOffers = StorageService.getProductOffers();
    const existingOfferMap = new Map<string, ProductOffer>(
      existingOffers.map(o => [`${o.productId}__${o.storeId}`, o])
    );

    for (const item of valid) {
      // Identificare și asociere prin ProductMatcher
      const matchResult = ProductMatcher.matchProduct({
        rawName: item.rawName,
        barcode: item.barcode,
        brand: item.brand,
        packageWeightOrVolume: item.packageWeightOrVolume,
        packageUnit: item.packageUnit,
        category: item.category
      });

      if (matchResult.candidate) {
        candidates.push(matchResult.candidate);
      }

      if (matchResult.matchedProduct) {
        autoMatchedCount++;
        const targetProd = matchResult.matchedProduct;
        const offerKey = `${targetProd.id}__${batch.retailerId}`;
        const existing = existingOfferMap.get(offerKey);

        if (existing && Math.abs(existing.price - item.effectivePrice) > 0.001) {
          priceChangesCount++;
        }

        const offer: ProductOffer = {
          id: `off-${batch.retailerId}-${targetProd.id}`,
          productId: targetProd.id,
          storeId: batch.retailerId,
          sourceId: batch.sourceId,
          price: item.effectivePrice,
          originalPrice: item.normalPrice !== item.effectivePrice ? item.normalPrice : undefined,
          normalPrice: item.normalPrice,
          promoPrice: item.promoPrice,
          loyaltyPrice: item.loyaltyPrice,
          rawRecordId: item.rawRecordId,
          region: item.region,
          batchId: batch.batchId,
          unitPrice: item.unitPrice,
          unitPriceMeasure: item.unitPriceMeasure,
          isPromo: item.isPromo,
          promoDetails: item.promoDetails,
          loyaltyCardRequired: item.loyaltyCardRequired,
          loyaltyCardName: item.loyaltyCardName,
          validUntil: item.validUntil,
          observationDate,
          source: 'official_feed',
          confidenceLevel: matchResult.confidence >= 0.9 ? 'high' : 'medium',
          verificationStatus: item.isExpired ? 'expired' : 'verified',
          lastChecked: todayStr
        };

        offers.push(offer);

        // Generăm observația istorică (pentru auditul imuabil append-only)
        const obs: PriceObservation = {
          id: `obs-${batch.batchId}-${item.rawRecordId}-${targetProd.id}`,
          productId: targetProd.id,
          storeId: batch.retailerId,
          sourceId: batch.sourceId,
          price: item.effectivePrice,
          date: observationDate,
          source: 'official_feed',
          loyaltyCardUsed: item.loyaltyCardRequired,
          normalPrice: item.normalPrice,
          promoPrice: item.promoPrice,
          loyaltyPrice: item.loyaltyPrice,
          rawRecordId: item.rawRecordId,
          region: item.region,
          batchId: batch.batchId
        };

        observations.push(obs);
      }
    }

    const durationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    let executionStatus: 'complete' | 'partial' | 'failed' = 'complete';
    if (valid.length === 0 && invalid.length > 0) {
      executionStatus = 'failed';
    } else if (invalid.length > 0 || duplicatesCount > 0) {
      executionStatus = 'partial';
    }

    const errorsList = invalid.map(inv => `Rând ${inv.rawRecord.rawName || 'necunoscut'}: ${inv.reason}`);
    const summary = options.dryRun
      ? `Dry-Run finalizat: ${valid.length} rânduri valide, ${autoMatchedCount} asociate automat, ${candidates.length} candidați ambigui, ${invalid.length} erori.`
      : `${executionStatus === 'complete' ? 'Import complet' : executionStatus === 'partial' ? 'Import parțial' : 'Import eșuat'}: ${offers.length} oferte actualizate, ${observations.length} observații istorice înregistrate.`;

    // Dacă este Dry-Run, returnăm fără a scrie în stocare
    if (options.dryRun) {
      return {
        batchId: batch.batchId,
        retailerId: batch.retailerId,
        sourceId: batch.sourceId,
        startedAt,
        completedAt,
        durationMs,
        status: executionStatus,
        recordsTotal: batch.rawRecordsCount,
        recordsValid: valid.length,
        recordsInvalid: invalid.length,
        duplicatesFound: duplicatesCount,
        autoMatchedCount,
        candidatesCreatedCount: candidates.length,
        priceChangesCount,
        offersUpsertedCount: 0,
        observationsAppendedCount: 0,
        errors: errorsList,
        summary,
        persisted: false,
        persistenceMode: 'demo_memory'
      };
    }

    // Persistență în baza de date PostgreSQL (Tranzacție ACID)
    const pool = getPool();
    let persistedInDb = false;

    if (pool && offers.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Upsert oferte curente
        for (const off of offers) {
          await client.query(
            `INSERT INTO product_offers (
              id, product_id, store_id, source_id, price, original_price,
              normal_price, promo_price, loyalty_price, raw_record_id, region, batch_id,
              unit_price, unit_price_measure, is_promo, promo_details,
              loyalty_card_required, loyalty_card_name, valid_until,
              observation_date, source, confidence_level, verification_status,
              last_checked, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW(), NOW())
            ON CONFLICT (product_id, store_id) DO UPDATE SET
              price = EXCLUDED.price,
              original_price = EXCLUDED.original_price,
              normal_price = EXCLUDED.normal_price,
              promo_price = EXCLUDED.promo_price,
              loyalty_price = EXCLUDED.loyalty_price,
              raw_record_id = EXCLUDED.raw_record_id,
              region = EXCLUDED.region,
              batch_id = EXCLUDED.batch_id,
              unit_price = EXCLUDED.unit_price,
              unit_price_measure = EXCLUDED.unit_price_measure,
              is_promo = EXCLUDED.is_promo,
              promo_details = EXCLUDED.promo_details,
              loyalty_card_required = EXCLUDED.loyalty_card_required,
              loyalty_card_name = EXCLUDED.loyalty_card_name,
              valid_until = EXCLUDED.valid_until,
              observation_date = EXCLUDED.observation_date,
              verification_status = EXCLUDED.verification_status,
              last_checked = NOW(),
              updated_at = NOW()`,
            [
              off.id,
              off.productId,
              off.storeId,
              off.sourceId || null,
              off.price,
              off.originalPrice || null,
              off.normalPrice || null,
              off.promoPrice || null,
              off.loyaltyPrice || null,
              off.rawRecordId || null,
              off.region || 'Național',
              off.batchId || batch.batchId,
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

        // 2. Append-only în price_observations (niciun UPDATE/DELETE nu este permis)
        for (const obs of observations) {
          await client.query(
            `INSERT INTO price_observations (
              id, product_id, store_id, source_id, price, normal_price, promo_price, loyalty_price,
              raw_record_id, region, batch_id, date, loyalty_card_used, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (product_id, store_id, date, price) DO NOTHING`,
            [
              obs.id,
              obs.productId,
              obs.storeId,
              obs.sourceId || null,
              obs.price,
              obs.normalPrice || null,
              obs.promoPrice || null,
              obs.loyaltyPrice || null,
              obs.rawRecordId || null,
              obs.region || 'Național',
              obs.batchId || batch.batchId,
              obs.date,
              obs.loyaltyCardUsed || false,
              obs.source
            ]
          );
        }

        // 3. Salvare candidați de potrivire ambigui
        for (const cand of candidates) {
          await client.query(
            `INSERT INTO product_match_candidates (
              id, source_raw_name, source_barcode, source_brand,
              source_package_weight_or_volume, source_package_unit,
              matched_product_id, matched_product_name, confidence_score,
              match_method, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO NOTHING`,
            [
              cand.id,
              cand.sourceRawName,
              cand.sourceBarcode || null,
              cand.sourceBrand || null,
              cand.sourcePackageWeightOrVolume || null,
              cand.sourcePackageUnit || null,
              cand.matchedProductId,
              cand.matchedProductName,
              cand.confidenceScore,
              cand.matchMethod,
              cand.status
            ]
          );
        }

        // 4. Jurnalizare sincronizare
        await client.query(
          `INSERT INTO source_sync_runs (
            id, source_id, source_name, started_at, completed_at, status,
            records_processed, records_imported, duplicates_found, invalid_records,
            errors, summary, persistence_mode
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            `sync-${batch.batchId}`,
            batch.sourceId,
            batch.sourceName,
            startedAt,
            completedAt,
            executionStatus,
            batch.rawRecordsCount,
            offers.length,
            duplicatesCount,
            invalid.length,
            JSON.stringify(errorsList),
            summary,
            'postgresql'
          ]
        );

        await client.query('COMMIT');
        persistedInDb = true;
      } catch (dbError: any) {
        await client.query('ROLLBACK');
        console.warn('Eroare tranzacție PostgreSQL, se aplică fallback în memorie:', dbError.message);
      } finally {
        client.release();
      }
    }

    // Actualizare în stocarea în memorie / locală pentru sincronizare imediată
    StorageService.addOrUpdateOffers(offers);
    StorageService.addPriceObservations(observations);
    if (candidates.length > 0) {
      StorageService.addMatchCandidates(candidates);
    }

    const syncRunRecord: SourceSyncRun = {
      id: `sync-${batch.batchId}`,
      sourceId: batch.sourceId,
      sourceName: batch.sourceName,
      startedAt,
      completedAt,
        status: executionStatus === 'complete' ? 'success' : executionStatus,
        recordsProcessed: batch.rawRecordsCount,
      recordsImported: offers.length,
      duplicatesFound: duplicatesCount,
      invalidRecords: invalid.length,
      errors: errorsList,
      summary
    };

    StorageService.addSyncRun(syncRunRecord);

    const result: BatchProcessingResult = {
      batchId: batch.batchId,
      retailerId: batch.retailerId,
      sourceId: batch.sourceId,
      startedAt,
      completedAt,
      durationMs,
      status: executionStatus,
      recordsTotal: batch.rawRecordsCount,
      recordsValid: valid.length,
      recordsInvalid: invalid.length,
      duplicatesFound: duplicatesCount,
      autoMatchedCount,
      candidatesCreatedCount: candidates.length,
      priceChangesCount,
      offersUpsertedCount: offers.length,
      observationsAppendedCount: observations.length,
      errors: errorsList,
      summary,
      persisted: persistedInDb,
      persistenceMode: persistedInDb ? 'postgresql' : 'demo_memory'
    };

    // Înregistrăm statistica în registrul retailerilor
    RetailerRegistry.recordExecution(batch.retailerId, result);

    return result;
  }
}
