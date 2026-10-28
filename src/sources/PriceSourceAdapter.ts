import {
  ProductOffer,
  SourceSyncRun,
  ProductMatchCandidate,
  UnitType,
  ConfidenceLevel,
  DataSourceType
} from '../types';

export interface RawPriceRecord {
  rawName: string;
  barcode?: string;
  brand?: string;
  category?: string;
  price: number | string;
  originalPrice?: number | string;
  unit?: string;
  packageWeightOrVolume?: number | string;
  packageUnit?: string;
  promoDetails?: string;
  validUntil?: string;
  loyaltyCardRequired?: boolean | string;
  loyaltyCardName?: string;
}

export interface ValidatedPriceRecord {
  rawName: string;
  barcode?: string;
  brand?: string;
  category?: string;
  price: number;
  originalPrice?: number;
  packageWeightOrVolume: number;
  packageUnit: UnitType;
  normalizedUnit: 'kg' | 'l' | 'buc';
  unitPrice: number;
  unitPriceMeasure: 'lei/kg' | 'lei/l' | 'lei/buc';
  isPromo: boolean;
  promoDetails?: string;
  loyaltyCardRequired: boolean;
  loyaltyCardName?: string;
  validUntil?: string;
  isExpired: boolean;
}

export interface InvalidPriceRecord {
  record: RawPriceRecord;
  reason: string;
  rowNumber?: number;
}

export interface ValidationResult {
  valid: ValidatedPriceRecord[];
  invalid: InvalidPriceRecord[];
  duplicatesCount: number;
}

export interface SourceImportResult {
  success: boolean;
  syncRun: SourceSyncRun;
  importedOffers: ProductOffer[];
  matchCandidates: ProductMatchCandidate[];
  summaryMessage: string;
}

export interface PriceSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: 'official_file' | 'authorized_api' | 'affiliate_feed' | 'verified_receipts';

  /**
   * Check if this source is currently reachable and authorized
   */
  checkAvailability(): Promise<{ available: boolean; reason?: string }>;

  /**
   * Execute an import run
   */
  importData(payload?: any): Promise<SourceImportResult>;

  /**
   * Validate raw extracted records
   */
  validateRecords(records: RawPriceRecord[]): ValidationResult;

  /**
   * Normalize validated records into standard product offers
   */
  normalize(records: ValidatedPriceRecord[], storeId: string): {
    offers: ProductOffer[];
    matchCandidates: ProductMatchCandidate[];
  };

  /**
   * Get metadata about the last synchronization
   */
  getLastSync(): Promise<SourceSyncRun | null>;
}
