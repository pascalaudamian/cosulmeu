// src/indexing/catalog/catalogTypes.ts
// Tipuri de date pentru Catalog Importer: Descoperire, Descărcare, Parsare, Staging și Publicare

export type CatalogFormat = 'pdf' | 'html' | 'csv' | 'xml' | 'xlsx';

export type CatalogSourceStatus = 'active' | 'pending_authorization' | 'disabled' | 'error';

export type DocumentDownloadStatus = 'pending' | 'downloading' | 'downloaded' | 'failed' | 'skipped_duplicate';

export type DocumentParseStatus = 'pending' | 'parsing' | 'parsed' | 'partially_parsed' | 'failed';

export type StagingItemStatus =
  | 'DISCOVERED'
  | 'PARSED'
  | 'NEEDS_REVIEW'
  | 'VALIDATED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'EXPIRED';

export interface CatalogSource {
  id: string;
  retailerId: string;
  retailerName: string;
  name: string;
  catalogUrl: string;
  format: CatalogFormat;
  status: CatalogSourceStatus;
  updateFrequencyDays: number;
  lastCheckedAt?: string;
  lastDiscoveredAt?: string;
  notes?: string;
  authRequired: boolean;
  legalStatusNotice: string;
}

export interface CatalogDocument {
  id: string;
  sourceId: string;
  retailerId: string;
  documentUrl: string;
  title: string;
  format: CatalogFormat;
  validFrom?: string; // YYYY-MM-DD
  validUntil?: string; // YYYY-MM-DD
  fileSizeBytes?: number;
  sha256Checksum?: string;
  downloadStatus: DocumentDownloadStatus;
  parseStatus: DocumentParseStatus;
  rawExtractedCount: number;
  matchedCount: number;
  validatedCount: number;
  publishedCount: number;
  errorMessage?: string;
  ocrConfidence?: number; // 0 - 100 for scanned documents
  createdAt: string;
  updatedAt: string;
}

export interface CatalogImportRun {
  id: string;
  documentId?: string;
  sourceId: string;
  retailerId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  totalRawExtracted: number;
  autoMatchedCount: number;
  needsReviewCount: number;
  publishedCount: number;
  rejectedCount: number;
  durationMs?: number;
  errors: string[];
}

export interface CatalogExtractedOffer {
  id: string;
  runId: string;
  documentId: string;
  retailerId: string;
  rawTitle: string;
  rawBrand?: string;
  rawBarcode?: string;
  rawCategory?: string;
  normalPrice: number;
  promoPrice?: number;
  loyaltyPrice?: number;
  effectivePrice: number;
  currency: string;
  packageQuantity?: number;
  packageUnit?: string;
  unitPrice?: number;
  unitPriceMeasure?: string;
  isPromo: boolean;
  promoDetails?: string;
  loyaltyCardRequired?: boolean;
  loyaltyCardName?: string;
  validFrom?: string;
  validUntil?: string;
  matchedProductId?: string;
  matchedProductName?: string;
  matchConfidence: number;
  matchMethod: 'gtin_exact' | 'name_brand_similarity' | 'manual' | 'unmatched';
  stagingStatus: StagingItemStatus;
  validationErrors?: string[];
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogImportError {
  id: string;
  runId?: string;
  documentId?: string;
  retailerId: string;
  stage: 'discovery' | 'download' | 'parse' | 'matching' | 'validation' | 'publishing';
  message: string;
  errorDetail?: string;
  createdAt: string;
}

export interface CatalogImporterStats {
  totalSources: number;
  activeSources: number;
  totalDocuments: number;
  totalExtractedOffers: number;
  stagedPendingReview: number;
  stagedValidated: number;
  totalPublished: number;
  lastRunAt?: string;
}
