import {
  PriceSourceAdapter,
  RawPriceRecord,
  ValidatedPriceRecord,
  ValidationResult,
  SourceImportResult
} from './PriceSourceAdapter.js';
import { SourceSyncRun, ProductOffer, ProductMatchCandidate, Receipt } from '../types.js';
import { StorageService } from '../services/StorageService.js';
import { PriceExtractor } from '../indexing/catalog/PriceExtractor.js';

export class ReceiptSourceAdapter implements PriceSourceAdapter {
  readonly id = 'src-verified-receipts';
  readonly name = 'Observații Verificate din Bonuri Fiscale';
  readonly type = 'verified_receipts' as const;

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    const receipts = StorageService.getReceipts();
    return {
      available: true,
      reason: `${receipts.length} bonuri fiscale înregistrate și verificate.`
    };
  }

  async getLastSync(): Promise<SourceSyncRun | null> {
    const runs = StorageService.getSyncRuns().filter(r => r.sourceId === this.id);
    return runs[0] || null;
  }

  validateRecords(records: RawPriceRecord[]): ValidationResult {
    const valid: ValidatedPriceRecord[] = [];
    const invalid: any[] = [];

    records.forEach((rec, idx) => {
      const price = PriceExtractor.parseExplicitPriceField(rec.price);
      if (price === null || price <= 0) {
        invalid.push({ record: rec, reason: 'Preț invalid pe bon', rowNumber: idx + 1 });
        return;
      }
      valid.push({
        rawName: rec.rawName,
        barcode: rec.barcode,
        brand: rec.brand,
        price,
        packageWeightOrVolume: 1,
        packageUnit: 'buc',
        normalizedUnit: 'buc',
        unitPrice: price,
        unitPriceMeasure: 'lei/buc',
        isPromo: false,
        loyaltyCardRequired: false,
        isExpired: false
      });
    });

    return { valid, invalid, duplicatesCount: 0 };
  }

  normalize(): { offers: ProductOffer[]; matchCandidates: ProductMatchCandidate[] } {
    return { offers: [], matchCandidates: [] };
  }

  /**
   * Private receipts must NOT automatically publish into public product_offers.
   * Requires explicit verified consent & strict validation.
   */
  async importData(options?: { explicitVerifiedConsent?: boolean }): Promise<SourceImportResult> {
    const startedAt = new Date().toISOString();
    const receipts = StorageService.getReceipts();

    if (!options?.explicitVerifiedConsent) {
      const completedAt = new Date().toISOString();
      const syncRun: SourceSyncRun = {
        id: `sync-rec-${Date.now()}`,
        sourceId: this.id,
        sourceName: this.name,
        startedAt,
        completedAt,
        status: 'success',
        recordsProcessed: 0,
        recordsImported: 0,
        duplicatesFound: 0,
        invalidRecords: 0,
        errors: [],
        summary:
          'Bonurile personale rămân private per utilizator. Publicarea automată în catalogul public este dezactivată.'
      };
      return {
        success: true,
        syncRun,
        importedOffers: [],
        matchCandidates: [],
        summaryMessage: syncRun.summary
      };
    }

    const allProducts = StorageService.getAllProducts();
    let importedCount = 0;
    const offers: ProductOffer[] = [];

    for (const receipt of receipts) {
      if (receipt.verifiedStatus !== 'confirmed' || receipt.validationStatus === 'NEEDS_REVIEW' || receipt.validationStatus === 'INVALID') {
        continue;
      }
      for (const item of receipt.items) {
        if (item.isSgr || item.isCouponOrDiscountLine || !item.matchedProductId || item.mathValid === false) {
          continue;
        }
        const prod = allProducts.find(p => p.id === item.matchedProductId);
        if (!prod) continue;

        const offer: ProductOffer = {
          id: `off-rec-${receipt.storeId}-${prod.id}`,
          productId: prod.id,
          storeId: receipt.storeId,
          sourceId: this.id,
          price: item.unitPrice,
          unitPrice: item.unitPrice,
          unitPriceMeasure: prod.normalizedUnit === 'kg' ? 'lei/kg' : prod.normalizedUnit === 'l' ? 'lei/l' : 'lei/buc',
          isPromo: item.discount > 0,
          promoDetails: item.discount > 0 ? `Reducere bon: -${item.discount.toFixed(2)} lei` : undefined,
          observationDate: receipt.date,
          source: 'user_reported',
          confidenceLevel: 'medium',
          verificationStatus: 'pending',
          lastChecked: receipt.date
        };

        offers.push(offer);
        importedCount++;
      }
    }

    const completedAt = new Date().toISOString();
    const syncRun: SourceSyncRun = {
      id: `sync-rec-${Date.now()}`,
      sourceId: this.id,
      sourceName: this.name,
      startedAt,
      completedAt,
      status: 'success',
      recordsProcessed: receipts.reduce((s, r) => s + r.items.length, 0),
      recordsImported: importedCount,
      duplicatesFound: 0,
      invalidRecords: 0,
      errors: [],
      summary: `Evaluate ${importedCount} observații candidate (status pending, fără publicare automată directă în catalog).`
    };

    StorageService.addSyncRun(syncRun);

    return {
      success: true,
      syncRun,
      importedOffers: offers,
      matchCandidates: [],
      summaryMessage: syncRun.summary
    };
  }
}

