import {
  PriceSourceAdapter,
  RawPriceRecord,
  ValidatedPriceRecord,
  ValidationResult,
  SourceImportResult
} from './PriceSourceAdapter';
import { SourceSyncRun, ProductOffer, ProductMatchCandidate, Receipt } from '../types';
import { StorageService } from '../services/StorageService';

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
      const price = parseFloat(String(rec.price).replace(',', '.'));
      if (isNaN(price) || price <= 0) {
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
   * Sync prices directly from confirmed receipts
   */
  async importData(): Promise<SourceImportResult> {
    const startedAt = new Date().toISOString();
    const receipts = StorageService.getReceipts();
    const allProducts = StorageService.getAllProducts();

    let importedCount = 0;
    const offers: ProductOffer[] = [];

    for (const receipt of receipts) {
      for (const item of receipt.items) {
        if (!item.matchedProductId) continue;
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
          source: 'verified',
          confidenceLevel: 'high',
          verificationStatus: 'verified',
          lastChecked: receipt.date
        };

        offers.push(offer);
        importedCount++;
      }
    }

    StorageService.addOrUpdateOffers(offers);

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
      summary: `Sincronizate cu succes ${importedCount} oferte verificate din ${receipts.length} bonuri fiscale.`
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
