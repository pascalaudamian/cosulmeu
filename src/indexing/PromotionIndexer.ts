// src/indexing/PromotionIndexer.ts
// Modul pentru indexarea, validarea și asocierea promoțiilor și reducerilor de la retaileri

import { PromotionRecord } from './types';
import { ProductMatcher } from '../services/ProductMatcher';
import { StorageService } from '../services/StorageService';
import { getPool } from '../db/index';

export interface PromotionIndexingResult {
  promotionsIndexedCount: number;
  matchedToCatalogCount: number;
  expiredSkippedCount: number;
  promotions: PromotionRecord[];
}

export class PromotionIndexer {
  /**
   * Verifică dacă o promoție este expirată pe baza datei curente
   */
  static isExpired(endsAt?: string): boolean {
    if (!endsAt) return false;
    const today = new Date().toISOString().split('T')[0];
    return endsAt < today;
  }

  /**
   * Calculează procentul reducerii dacă sunt disponibile prețurile normal și promoțional
   */
  static calculateDiscountPercentage(normalPrice?: number, promoPrice?: number): number | undefined {
    if (!normalPrice || !promoPrice || normalPrice <= promoPrice) return undefined;
    return Math.round(((normalPrice - promoPrice) / normalPrice) * 100);
  }

  /**
   * Indexează un set de promoții colectate din paginile web sau feed-urile magazinelor
   */
  static async indexPromotions(
    rawPromos: PromotionRecord[],
    options: { dryRun?: boolean; skipExpired?: boolean } = {}
  ): Promise<PromotionIndexingResult> {
    const validPromotions: PromotionRecord[] = [];
    let matchedToCatalogCount = 0;
    let expiredSkippedCount = 0;

    for (const promo of rawPromos) {
      if (options.skipExpired && this.isExpired(promo.endsAt)) {
        expiredSkippedCount++;
        continue;
      }

      // Încercăm asocierea cu un produs de referință din catalog dacă nu are deja productId
      let finalProductId = promo.productId;
      if (!finalProductId) {
        const match = ProductMatcher.matchProduct({
          rawName: promo.title,
          barcode: promo.barcode,
          brand: promo.brand
        });
        if (match.matchedProduct) {
          finalProductId = match.matchedProduct.id;
          matchedToCatalogCount++;
        }
      } else {
        matchedToCatalogCount++;
      }


      validPromotions.push({
        ...promo,
        productId: finalProductId
      });
    }

    if (options.dryRun) {
      return {
        promotionsIndexedCount: validPromotions.length,
        matchedToCatalogCount,
        expiredSkippedCount,
        promotions: validPromotions
      };
    }

    // Persistență în baza de date PostgreSQL dacă este conectată
    const pool = getPool();
    if (pool && validPromotions.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const p of validPromotions) {
          await client.query(
            `INSERT INTO promotions (
              id, retailer_id, product_id, retailer_product_id, title, description,
              normal_price, promo_price, loyalty_price, loyalty_card_name,
              starts_at, ends_at, conditions, source_url, discovered_at, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
            ON CONFLICT (id) DO UPDATE SET
              promo_price = EXCLUDED.promo_price,
              normal_price = EXCLUDED.normal_price,
              loyalty_price = EXCLUDED.loyalty_price,
              ends_at = EXCLUDED.ends_at,
              conditions = EXCLUDED.conditions`,
            [
              p.id,
              p.retailerId,
              p.productId || null,
              p.retailerProductId || null,
              p.title,
              p.description || null,
              p.normalPrice || null,
              p.promoPrice,
              p.loyaltyPrice || null,
              p.loyaltyCardName || null,
              p.startsAt || null,
              p.endsAt || null,
              p.conditions || null,
              p.sourceUrl || null,
              p.discoveredAt
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.warn('Eroare persistență DB în PromotionIndexer, continuăm cu StorageService:', err);
      } finally {
        client.release();
      }
    }

    // Salvare în stocarea locală / memorie
    StorageService.addPromotions(validPromotions);

    return {
      promotionsIndexedCount: validPromotions.length,
      matchedToCatalogCount,
      expiredSkippedCount,
      promotions: validPromotions
    };
  }
}
