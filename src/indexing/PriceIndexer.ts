// src/indexing/PriceIndexer.ts
// Modul pentru indexarea prețurilor, detecția anomaliilor și persistența append-only

import { ProductOffer, PriceObservation } from '../types';
import { RetailerProductRecord } from './types';
import { StorageService } from '../services/StorageService';
import { getPool } from '../db/index';

export interface PriceIndexingResult {
  acceptedOffersCount: number;
  anomaliesDetectedCount: number;
  observationsAppendedCount: number;
  anomalies: { productId: string; storeId: string; currentPrice: number; previousPrice?: number; reason: string }[];
}

export class PriceIndexer {
  private static readonly MAX_PRICE_DEVIATION_RATIO = 0.50; // Variație maximă permisă (50%) fără recenzare

  /**
   * Verifică dacă un preț reprezintă o anomalie suspectă
   */
  static isPriceAnomaly(
    newPrice: number,
    previousPrice?: number,
    referencePrice?: number
  ): { isAnomaly: boolean; reason?: string } {
    if (newPrice <= 0) {
      return { isAnomaly: true, reason: 'Prețul este mai mic sau egal cu zero.' };
    }

    if (newPrice > 5000) {
      return { isAnomaly: true, reason: 'Preț extrem de ridicat pentru un produs alimentar/uz casnic (> 5000 RON).' };
    }

    const baseline = previousPrice || referencePrice;
    if (baseline && baseline > 0) {
      const diffRatio = Math.abs(newPrice - baseline) / baseline;
      if (diffRatio > this.MAX_PRICE_DEVIATION_RATIO) {
        return {
          isAnomaly: true,
          reason: `Variație suspectă de preț (${(diffRatio * 100).toFixed(1)}% față de reperul de ${baseline.toFixed(2)} RON).`
        };
      }
    }

    return { isAnomaly: false };
  }

  /**
   * Indexează un set de oferte și înregistrează observațiile istorice în mod append-only
   */
  static async indexPrices(
    offers: ProductOffer[],
    options: { dryRun?: boolean; bypassAnomalyCheck?: boolean } = {}
  ): Promise<PriceIndexingResult> {
    const existingOffers = StorageService.getProductOffers();
    const existingMap = new Map<string, ProductOffer>(
      existingOffers.map(o => [`${o.productId}__${o.storeId}`, o])
    );

    const validOffers: ProductOffer[] = [];
    const newObservations: PriceObservation[] = [];
    const anomalies: { productId: string; storeId: string; currentPrice: number; previousPrice?: number; reason: string }[] = [];

    const todayStr = new Date().toISOString().split('T')[0];

    for (const off of offers) {
      const key = `${off.productId}__${off.storeId}`;
      const existing = existingMap.get(key);

      if (!options.bypassAnomalyCheck) {
        const anomalyCheck = this.isPriceAnomaly(off.price, existing?.price);
        if (anomalyCheck.isAnomaly) {
          anomalies.push({
            productId: off.productId,
            storeId: off.storeId,
            currentPrice: off.price,
            previousPrice: existing?.price,
            reason: anomalyCheck.reason || 'Anomalie de preț detectată'
          });
          continue;
        }
      }

      validOffers.push(off);

      // Adăugăm observația în jurnalul append-only
      newObservations.push({
        id: `obs-${Date.now()}-${off.storeId}-${off.productId}`,
        productId: off.productId,
        storeId: off.storeId,
        sourceId: off.sourceId,
        price: off.price,
        date: off.observationDate || todayStr,
        source: off.source,
        normalPrice: off.normalPrice,
        promoPrice: off.promoPrice,
        loyaltyPrice: off.loyaltyPrice,
        rawRecordId: off.rawRecordId,
        region: off.region,
        batchId: off.batchId,
        loyaltyCardUsed: off.loyaltyCardRequired
      });
    }

    if (options.dryRun) {
      return {
        acceptedOffersCount: validOffers.length,
        anomaliesDetectedCount: anomalies.length,
        observationsAppendedCount: newObservations.length,
        anomalies
      };
    }

    // Persistență în PostgreSQL dacă este disponibil
    const pool = getPool();
    if (pool && validOffers.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const off of validOffers) {
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
              off.batchId || null,
              off.unitPrice,
              off.unitPriceMeasure,
              off.isPromo,
              off.promoDetails || null,
              off.loyaltyCardRequired || false,
              off.loyaltyCardName || null,
              off.validUntil || null,
              off.observationDate || todayStr,
              off.source,
              off.confidenceLevel,
              off.verificationStatus
            ]
          );
        }

        // Observații append-only (cu clauză ON CONFLICT DO NOTHING pentru idempotență)
        for (const obs of newObservations) {
          await client.query(
            `INSERT INTO price_observations (
              id, product_id, store_id, source_id, price, normal_price, promo_price, loyalty_price,
              raw_record_id, region, batch_id, date, receipt_id, loyalty_card_used, source, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
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
              obs.batchId || null,
              obs.date,
              obs.receiptId || null,
              obs.loyaltyCardUsed || false,
              obs.source
            ]
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.warn('Eroare persistență DB în PriceIndexer, continuăm cu StorageService:', err);
      } finally {
        client.release();
      }
    }

    // Actualizăm permanent stocarea locală / memorie
    StorageService.addOrUpdateOffers(validOffers);
    StorageService.addPriceObservations(newObservations);

    return {
      acceptedOffersCount: validOffers.length,
      anomaliesDetectedCount: anomalies.length,
      observationsAppendedCount: newObservations.length,
      anomalies
    };
  }
}
