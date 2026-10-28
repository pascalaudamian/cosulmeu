import {
  PriceSourceAdapter,
  RawPriceRecord,
  ValidatedPriceRecord,
  ValidationResult,
  SourceImportResult
} from './PriceSourceAdapter';
import { SourceSyncRun, ProductOffer, ProductMatchCandidate, PriceObservation } from '../types';
import { FileImportAdapter } from './FileImportAdapter';
import { StorageService } from '../services/StorageService';

export class AffiliateFeedAdapter implements PriceSourceAdapter {
  readonly id = 'src-affiliate-feed';
  readonly name = 'Feed Parteneri Retail & Afiliere';
  readonly type = 'affiliate_feed' as const;

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async getLastSync(): Promise<SourceSyncRun | null> {
    const runs = StorageService.getSyncRuns().filter(r => r.sourceId === this.id);
    return runs[0] || null;
  }

  validateRecords(records: RawPriceRecord[]): ValidationResult {
    const baseAdapter = new FileImportAdapter(this.id, this.name);
    return baseAdapter.validateRecords(records);
  }

  normalize(records: ValidatedPriceRecord[], storeId: string): {
    offers: ProductOffer[];
    matchCandidates: ProductMatchCandidate[];
  } {
    const baseAdapter = new FileImportAdapter(this.id, this.name);
    const { offers, matchCandidates } = baseAdapter.normalize(records, storeId);

    // Tag affiliate offers as sponsored, but with strict non-manipulated pricing integrity
    const taggedOffers: ProductOffer[] = offers.map(off => ({
      ...off,
      sourceId: this.id,
      source: 'official_feed',
      isSponsored: true
    }));

    return { offers: taggedOffers, matchCandidates };
  }

  async importData(payload: {
    content: string;
    format: 'xml' | 'csv';
    storeId?: string;
  }): Promise<SourceImportResult> {
    const baseAdapter = new FileImportAdapter(this.id, this.name, payload.storeId || 'carrefour');
    return baseAdapter.importData(payload);
  }
}
