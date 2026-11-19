export type ProductCategory =
  | 'Fructe și legume'
  | 'Lactate și ouă'
  | 'Carne și pește'
  | 'Panificație'
  | 'Băuturi'
  | 'Produse congelate'
  | 'Produse de bază'
  | 'Curățenie'
  | 'Igienă personală'
  | 'Alte produse';

export type UnitType = 'buc' | 'kg' | 'g' | 'l' | 'ml' | 'pachet';

export type DataSourceType = 'verified' | 'user_reported' | 'estimated' | 'demo' | 'official_feed' | 'partner_api';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type SourceStatus = 'active' | 'pending_authorization' | 'configured_manual' | 'error' | 'disabled';
export type VerificationStatus = 'verified' | 'pending' | 'rejected' | 'expired' | 'demo' | 'isolated';

export interface Store {
  id: string;
  name: string;
  slug: string;
  chain: string;
  brandColor: string;
  accentColor: string;
  logoUrl?: string;
  officialUrl?: string;
  websiteUrl?: string;
  type: 'discounter' | 'hypermarket' | 'supermarket' | 'proximity';
  rating: number;
  locationsCount: number;
  sampleAddress: string;
  isPartner?: boolean;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  category: ProductCategory;
  defaultUnit: UnitType;
  packageWeightOrVolume: number;
  packageUnit: UnitType;
  normalizedUnit: 'kg' | 'l' | 'buc';
  barcode?: string;
  imageUrl?: string;
  isBio?: boolean;
  isRomanianProduct?: boolean;
  baseReferencePrice: number;
  subcategory?: string;
  description?: string;
}

export interface ProductOffer {
  id: string;
  productId: string;
  storeId: string;
  sourceId?: string;
  price: number; // RON per packaging unit
  originalPrice?: number;
  unitPrice: number; // normalized (e.g. RON / kg, RON / l, RON / buc)
  unitPriceMeasure: 'lei/kg' | 'lei/l' | 'lei/buc';
  isPromo: boolean;
  promoDetails?: string;
  loyaltyCardRequired?: boolean;
  loyaltyCardName?: string; // ex: 'Lidl Plus', 'Kaufland Card', 'Club Carrefour', 'Penny Card'
  validUntil?: string; // YYYY-MM-DD
  observationDate: string; // YYYY-MM-DD
  source: DataSourceType;
  confidenceLevel: ConfidenceLevel;
  verificationStatus: VerificationStatus;
  lastChecked: string;
  isSponsored?: boolean;
  normalPrice?: number;
  promoPrice?: number;
  loyaltyPrice?: number;
  rawRecordId?: string;
  region?: string;
  batchId?: string;
  freshnessScore?: number;
  qualityScore?: number;
  freshnessStatus?: 'very_recent' | 'recent' | 'stale' | 'expired';
  lastCollectedAt?: string;
  lastVerifiedAt?: string;
  isFlaggedAnomaly?: boolean;
  anomalyReason?: string;
}

export interface PriceObservation {
  id: string;
  productId: string;
  storeId: string;
  sourceId?: string;
  price: number;
  date: string; // ISO format: YYYY-MM-DD
  receiptId?: string;
  loyaltyCardUsed?: boolean;
  source: DataSourceType;
  normalPrice?: number;
  promoPrice?: number;
  loyaltyPrice?: number;
  rawRecordId?: string;
  region?: string;
  batchId?: string;
}

export interface DataSource {
  id: string;
  name: string;
  type: 'official_file' | 'authorized_api' | 'affiliate_feed' | 'verified_receipts';
  status: SourceStatus;
  storeId?: string;
  format?: 'csv' | 'xml' | 'json' | 'api';
  lastSyncAt?: string;
  importedOffersCount: number;
  errorCount: number;
  requiresAuth: boolean;
  authDocumentation?: string;
  endpointUrl?: string;
  description: string;
}

export interface SourceSyncRun {
  id: string;
  sourceId: string;
  sourceName: string;
  startedAt: string;
  completedAt: string;
  status: 'success' | 'partial' | 'failed';
  recordsProcessed: number;
  recordsImported: number;
  duplicatesFound: number;
  invalidRecords: number;
  errors: string[];
  summary: string;
}

export interface ProductMatchCandidate {
  id: string;
  sourceRawName: string;
  sourceBarcode?: string;
  sourceBrand?: string;
  sourcePackageWeightOrVolume?: number;
  sourcePackageUnit?: UnitType;
  matchedProductId: string;
  matchedProductName: string;
  confidenceScore: number; // 0 to 1
  matchMethod: 'gtin_exact' | 'name_brand_similarity' | 'manual';
  status: 'auto_approved' | 'pending_confirmation' | 'rejected';
  createdAt: string;
}

export interface ShoppingListItem {
  id: string;
  productId?: string;
  customName?: string;
  name: string;
  brand?: string;
  category: ProductCategory;
  quantity: number;
  unit: UnitType;
  checked: boolean;
  notes?: string;
  barcode?: string;
  preferredBrand?: string;
  referencePrice?: number;
  estimatedPrice?: number;
  lastBoughtPrice?: number;
  lastBoughtStoreId?: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingListItem[];
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
}

export type ReceiptConfidenceBand =
  | 'high_confidence'   // 95-100: încredere ridicată
  | 'good_confidence'   // 80-94: încredere bună
  | 'uncertain'         // 60-79: incert
  | 'needs_correction'; // < 60: necesită corectare

export type ReceiptValidationStatus = 'VALID' | 'NEEDS_REVIEW' | 'INVALID';

export type ReceiptFieldProvenance = 'ocr' | 'calculated' | 'manual';

export interface ReceiptConfidenceBreakdown {
  overall: number;
  band: ReceiptConfidenceBand;
  retailer: number;
  date: number;
  total: number;
  itemsAverage: number;
}

export interface ReceiptVatEntry {
  code?: string;
  rate: number;
  taxableAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
}

export interface ReceiptMatchCandidate {
  productId: string;
  productName: string;
  brand?: string;
  packageWeightOrVolume?: number;
  packageUnit?: UnitType;
  score: number;
  matchMethod: 'ean_exact' | 'name_brand_quantity' | 'manual';
}

export interface ReceiptItem {
  id: string;
  rawName: string;
  normalizedName?: string;
  matchedProductId?: string;
  matchedProductName?: string;
  eanCode?: string;
  internalCode?: string;
  quantity: number;
  unit?: UnitType;
  unitPrice: number;
  totalPrice: number;
  discount: number;
  vatRate?: number;
  isWeighted?: boolean;
  isSgr?: boolean;
  isCouponOrDiscountLine?: boolean;
  confidence: ConfidenceLevel;
  confidenceScore?: number; // 0-100
  confidenceDetails?: {
    product: number;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  };
  mathValid?: boolean;
  mathDiscrepancy?: number;
  requiresManualReview?: boolean;
  manualReviewReasons?: string[];
  matchStatus?: 'matched' | 'ambiguous' | 'unmatched';
  matchCandidates?: ReceiptMatchCandidate[];
  provenance?: {
    rawName?: ReceiptFieldProvenance;
    quantity?: ReceiptFieldProvenance;
    unitPrice?: ReceiptFieldProvenance;
    totalPrice?: ReceiptFieldProvenance;
    discount?: ReceiptFieldProvenance;
    matchedProductId?: ReceiptFieldProvenance;
  };
  rawLineText?: string;
  category?: ProductCategory;
}

export interface Receipt {
  id: string;
  storeId: string;
  storeName: string;
  storeAddress?: string;
  fiscalNumber?: string;
  receiptNumber?: string;
  date: string;
  time?: string;
  items: ReceiptItem[];
  subtotal: number;
  discountTotal: number;
  couponsTotal?: number;
  sgrTotal?: number;
  vatTotal?: number;
  vatBreakdown?: ReceiptVatEntry[];
  printedTotal?: number;
  calculatedTotal?: number;
  discrepancyAmount?: number;
  total: number;
  currency: 'RON';
  paymentMethod?: string;
  imageUrl?: string;
  imageUrls?: string[];
  imagePaths?: string[];
  createdAt: string;
  processedAt?: string;
  verifiedStatus: 'confirmed' | 'draft';
  validationStatus?: ReceiptValidationStatus;
  validationReasons?: string[];
  confidenceScores?: ReceiptConfidenceBreakdown;
  rawOcrText?: string;
  originalExtractedData?: Record<string, any>;
  userCorrections?: Record<string, any>;
  contentFingerprint?: string;
  duplicateWarning?: {
    isDuplicate: boolean;
    matchingReceiptId?: string;
    matchReason?: string;
  };
}

export interface UserPriceObservation {
  id: string;
  userId?: string;
  receiptId: string;
  receiptItemId?: string;
  productId?: string;
  productName: string;
  storeId?: string;
  storeName: string;
  purchaseDate: string;
  quantity: number;
  unit: UnitType;
  unitPrice: number;
  discount: number;
  effectivePaidUnitPrice: number;
  totalPaid: number;
  currency: 'RON';
  sourceReceiptLabel?: string;
  isSgr?: boolean;
}

export type PriceAlertType = 'below_target' | 'any_drop' | 'interval_low';

export interface PriceAlert {
  id: string;
  productId: string;
  productName: string;
  targetPrice: number;
  currentLowestPrice: number;
  lowestStoreId?: string;
  createdAt: string;
  isActive: boolean;
  alertType?: PriceAlertType;
  intervalDays?: 30 | 90 | 180 | 365;
  sourceListId?: string;
  lastTriggeredAt?: string;
  lastTriggeredPrice?: number;
  lastEvaluatedPrice?: number;
  lastNotifiedKey?: string;
}

export interface InAppPriceNotification {
  id: string;
  alertId: string;
  dedupeKey: string;
  productId: string;
  productName: string;
  alertType: PriceAlertType;
  title: string;
  message: string;
  observedPrice: number;
  previousPrice?: number;
  targetPrice?: number;
  storeId?: string;
  storeName?: string;
  triggeredAt: string;
  isRead: boolean;
}

export interface TrackedProduct {
  productId: string;
  addedAt: string;
  notes?: string;
  alertPrice?: number;
}

export interface BasketStoreComparison {
  store: Store;
  availableItems: {
    item: ShoppingListItem;
    offer: ProductOffer;
    calculatedPrice: number;
    unitPriceString: string;
    isLowest: boolean;
    isLoyaltyPrice?: boolean;
    loyaltyCardName?: string;
    isExpired?: boolean;
    sourceType: DataSourceType;
    verificationStatus: VerificationStatus;
  }[];
  missingItems: ShoppingListItem[];
  availableTotal: number;
  estimatedMissingTotal: number;
  grandTotal: number;
  savingsVsWorst: number;
  isWinner: boolean;
  completenessPercentage: number;
  confidenceLevel: ConfidenceLevel;
  lastUpdated: string;
  hasLoyaltyDiscount: boolean;
  loyaltySavings: number;
}

export interface MultiStoreOptimization {
  singleStoreWinner: BasketStoreComparison | null;
  multiStorePlan: {
    store: Store;
    items: {
      item: ShoppingListItem;
      offer: ProductOffer;
      calculatedPrice: number;
    }[];
    subtotal: number;
  }[];
  multiStoreTotal: number;
  grossSavings: number;
  transportCost: number;
  netSavings: number;
  isSplitRecommended: boolean;
  explanation: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type CookieConsentCategory = 'necessary' | 'preferences' | 'analytics' | 'marketing';

export type CookieConsentMethod = 'banner_accept_all' | 'banner_reject_optional' | 'custom_preferences' | 'withdrawal';

export interface CookieConsentCategoriesState {
  necessary: true;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
}

export interface CookieConsentState {
  visitorSessionId: string;
  policyVersion: string;
  bannerVersion: string;
  consentGiven: boolean;
  consentMethod: CookieConsentMethod;
  categories: CookieConsentCategoriesState;
  updatedAt: string;
}

export type GdprRequestType =
  | 'access_data'
  | 'export_data'
  | 'rectification'
  | 'erasure_account'
  | 'erasure_optional_data'
  | 'restriction_processing'
  | 'objection'
  | 'withdraw_consent'
  | 'other';

export type GdprRequestStatus = 'noua' | 'in_verificare' | 'procesata' | 'respinsa_justificat';

export interface GdprRequestRecord {
  id: string;
  userId?: string;
  requestType: GdprRequestType;
  status: GdprRequestStatus;
  details?: string | null;
  requestedFormat?: 'json' | 'csv' | null;
  requestedAt: string;
  resolvedAt?: string | null;
  adminResponse?: string | null;
}

export interface CommunicationConsentRecord {
  id: string;
  userId?: string;
  channel: 'email_marketing' | 'optional_notifications' | 'price_alerts' | 'essential_account';
  isGranted: boolean;
  consentTextVersion: string;
  source: 'signup' | 'profile' | 'gdpr_center' | 'withdrawal';
  recordedAt: string;
}

export interface GdprDataExportPayload {
  exportedAt: string;
  policyVersion: string;
  operatorNote: string;
  account: {
    userId: string;
    email?: string;
    createdAt?: string;
  };
  profile: Record<string, any> | null;
  preferences: Record<string, any> | null;
  shoppingLists: Array<Record<string, any>>;
  priceAlerts: Array<Record<string, any>>;
  receipts: Array<Record<string, any>>;
  priceObservations: Array<Record<string, any>>;
  storageFiles: Array<{ bucket: string; path: string }>;
  communicationConsents: CommunicationConsentRecord[];
  cookieConsents: Array<Record<string, any>>;
  gdprRequests: GdprRequestRecord[];
}

export interface UserProfile {
  id?: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  username?: string;
  avatarUrl?: string;
  avatar_url?: string;
  phone?: string;
  phoneNumber?: string;
  phone_number?: string;
  city: string;
  preferredStores: string[];
  preferredStoreId?: string;
  preferredLanguage?: string;
  theme?: ThemeMode;
  role?: 'user' | 'admin';
  monthlySavingsGoal: number;
  notificationsEnabled: boolean;
  optionalNotificationsEnabled?: boolean;
  marketingConsent?: boolean;
  marketingConsentUpdatedAt?: string;
  marketingConsentWithdrawnAt?: string;
  restrictionRequested?: boolean;
  restrictionReason?: string;
  restrictionUpdatedAt?: string;
  defaultTransportCostEstimate: number;
  useLoyaltyCards: boolean; // whether user has supermarket loyalty cards
  createdAt?: string;
  created_at?: string;
}

export interface SavingsSummary {
  totalSavedToDate: number;
  potentialCurrentBasketSavings: number;
  scannedReceiptsCount: number;
  trackedProductsCount: number;
  lastMonthSavings: number;
}

export interface UserErrorReport {
  id: string;
  productId: string;
  productName: string;
  storeId?: string;
  errorType: 'price_mismatch' | 'wrong_product' | 'expired_promo' | 'wrong_category' | 'other';
  reportedPrice?: number;
  details: string;
  reporterEmail?: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
}

export interface MatchAuditEntry {
  id: string;
  candidateId?: string;
  rawName: string;
  previousProductId?: string;
  correctedProductId: string;
  action: 'approved' | 'separated' | 'reassigned';
  reason: string;
  performedBy: string;
  timestamp: string;
}

export interface AdminAuditLog {
  id: string;
  userEmail: string;
  userId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  createdAt: string;
}

export type OverallSystemStatus =
  | 'TOTUL FUNCȚIONEAZĂ'
  | 'IMPORT ÎN DESFĂȘURARE'
  | 'NECESITĂ ATENȚIE'
  | 'SISTEM PARȚIAL DISPONIBIL'
  | 'EROARE CRITICĂ';

export interface OperationalKpiMetric {
  key: string;
  label: string;
  value: number;
  unit?: string;
  period: string;
  updatedAt: string;
  previousValue?: number;
  delta?: number;
  status: 'positive' | 'neutral' | 'warning' | 'critical';
  details?: string;
}

export interface OperationalDashboardData {
  overallStatus: OverallSystemStatus;
  statusMessage: string;
  activeRetailersCount: number;
  configuredRetailersCount: number;
  activeSourcesCount: number;
  configuredSourcesCount: number;
  blockedSourcesCount: number;
  runningImportsCount: number;
  lastSuccessfulSync?: string;
  nextScheduledSync?: string;
  dbStatus: {
    connected: boolean;
    configured: boolean;
    persistenceMode: 'postgresql' | 'demo_memory';
    dbType: string;
    message: string;
    latencyMs?: number;
  };
  lastAdminActivity?: AdminAuditLog;
  kpis: {
    configuredRetailers: OperationalKpiMetric;
    configuredSources: OperationalKpiMetric;
    activeSources: OperationalKpiMetric;
    discoveredDocuments: OperationalKpiMetric;
    downloadedDocuments: OperationalKpiMetric;
    extractedProducts: OperationalKpiMetric;
    distinctProducts: OperationalKpiMetric;
    newProducts: OperationalKpiMetric;
    updatedProducts: OperationalKpiMetric;
    extractedOffers: OperationalKpiMetric;
    validatedOffers: OperationalKpiMetric;
    approvedOffers: OperationalKpiMetric;
    publishedOffers: OperationalKpiMetric;
    changedPrices: OperationalKpiMetric;
    itemsWithoutPrice: OperationalKpiMetric;
    processingErrors: OperationalKpiMetric;
  };
  pipelineStages: {
    stage: 'discovery' | 'download' | 'parse' | 'validation' | 'approval' | 'publishing';
    name: string;
    status: 'PASS' | 'PROCESSING' | 'PENDING' | 'PARTIAL' | 'BLOCKED' | 'FAILED';
    processedCount: number;
    pendingCount: number;
    errorCount: number;
    lastExecutedAt?: string;
    durationMs?: number;
  }[];
  activeAlerts: {
    id: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    targetTab: string;
    linkActionLabel?: string;
  }[];
  scheduler?: SchedulerMetrics;
}

export interface SchedulerMetrics {
  activeSchedulesCount: number;
  runningSchedulesCount: number;
  successfulSchedulesCount: number;
  partialSchedulesCount: number;
  failedSchedulesCount: number;
  totalSchedulesCount: number;
  nextScheduledRunAt?: string;
  lastScheduledRunAt?: string;
  manualPublishCount: number;
  automatedPublishCount: number;
}

export type PriceAuditCategory =
  | 'anomalies'
  | 'confirmed_wrong'
  | 'suspect_unverified'
  | 'valid_verified'
  | 'isolated'
  | 'all';

export interface PriceAuditItem {
  offerId: string;
  productId: string;
  productName: string;
  brand: string;
  storeId: string;
  storeName: string;
  packageWeightOrVolume: number;
  packageUnit: UnitType | string;
  currentPrice: number;
  normalPrice?: number | null;
  promoPrice?: number | null;
  originalPrice?: number | null;
  unitPrice: number;
  unitPriceMeasure: string;
  isPromo: boolean;
  promoDetails?: string;
  verificationStatus: VerificationStatus;
  isFlaggedAnomaly: boolean;
  anomalyReason?: string;
  auditCategory: Exclude<PriceAuditCategory, 'all' | 'anomalies'>;
  auditReason: string;
  sourceDocumentId?: string;
  sourceDocumentTitle?: string;
  sourceDocumentUrl?: string;
  extractedRawTitle?: string;
  extractedNormalPrice?: number | null;
  extractedPromoPrice?: number | null;
  extractedEffectivePrice?: number | null;
  lastVerifiedAt?: string;
  observationDate: string;
}

export interface PriceAuditSummary {
  totalPublishedOffers: number;
  suspectCount: number;
  quantityConfusedCount: number;
  isolatedCount: number;
  verifiedCount: number;
  lowPriceValidCount: number;
  retailersAffected: { storeId: string; storeName: string; count: number }[];
}

export interface PriceAuditBatchPreviewItem {
  offerId: string;
  productName: string;
  storeId: string;
  action: 'fix_price' | 'isolate' | 'verify';
  oldPrice: number;
  newPrice?: number;
  oldVerificationStatus: VerificationStatus;
  newVerificationStatus: VerificationStatus;
  reason: string;
}

export interface PriceAuditTransactionLog {
  id: string;
  userEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, any>;
  ipAddress?: string;
  createdAt: string;
  persistedInDb: boolean;
  storageBackend: 'postgresql' | 'supabase' | 'memory_fallback';
}

export interface PriceAuditRemediationResult {
  success: boolean;
  dryRun: boolean;
  affectedOffersCount: number;
  updatedProductsCount: number;
  updatedStagingCount: number;
  updatedPromotionsCount: number;
  auditLogRecorded: boolean;
  auditLogId?: string;
  auditLogStorage?: 'postgresql' | 'supabase' | 'memory_fallback';
  previews: PriceAuditBatchPreviewItem[];
  errors: string[];
}

// =========================================================================
// V1 Roadmap: Centralized Price Quality Classification
// =========================================================================

export type PriceDataQualityStatus =
  | 'VERIFIED_RECENTLY'
  | 'VERIFIED'
  | 'STALE'
  | 'UNVERIFIED'
  | 'EXPIRED'
  | 'SUSPICIOUS';

export interface PriceQualityFactor {
  key: 'age' | 'source' | 'promo_validity' | 'product_validity' | 'unit_consistency' | 'anomaly' | 'confirmations';
  labelRo: string;
  score: number; // 0..100
  weight: number; // fraction summing to 1.0
  contribution: number;
  detailRo: string;
}

export interface PriceQualityClassifierConfig {
  recentlyVerifiedMaxHours: number;
  verifiedMaxHours: number;
  staleMaxHours: number;
  suspiciousDeviationHighRatio: number;
  suspiciousDropNoPromoRatio: number;
  minPlausiblePrice: number;
  maxPlausiblePrice: number;
  weights: {
    age: number;
    source: number;
    promoValidity: number;
    productValidity: number;
    unitConsistency: number;
    anomaly: number;
    confirmations: number;
  };
}

export interface PriceDataQualityAssessment {
  status: PriceDataQualityStatus;
  labelRo: string;
  descriptionRo: string;
  score: number; // 0..100 transparent weighted sum
  methodologyVersion: string;
  ageHours: number | null;
  lastVerifiedAt: string | null;
  isUsableForComparison: boolean;
  isReliableForOptimization: boolean;
  factors: PriceQualityFactor[];
  reasons: string[];
}

// =========================================================================
// V1 Roadmap: Basket Optimizer (1-Store & Multi-Store)
// =========================================================================

export type BasketMatchConfidence = 'exact_id' | 'exact_ean' | 'exact_name' | 'high_token';

export interface BasketItemAllocation {
  item: ShoppingListItem;
  aggregatedQuantity: number;
  mergedOccurrencesCount: number;
  product: Product;
  matchConfidence: BasketMatchConfidence;
  offer: ProductOffer;
  qualityAssessment: PriceDataQualityAssessment;
  store: Store;
  effectiveUnitPrice: number;
  calculatedPrice: number;
  unitPriceDisplay: string;
  loyaltyApplied: boolean;
  loyaltyCardName?: string;
}

export interface BasketUnconfidentMatch {
  item: ShoppingListItem;
  reasonRo: string;
  candidateProducts?: Array<{ id: string; name: string; brand: string }>;
}

export interface BasketUnitConflict {
  item: ShoppingListItem;
  product: Product;
  reasonRo: string;
}

export interface BasketMissingPriceItem {
  item: ShoppingListItem;
  product?: Product;
  reasonRo: string;
}

export interface BasketSingleStorePlan {
  store: Store;
  isFavorite: boolean;
  allocations: BasketItemAllocation[];
  missingItems: BasketMissingPriceItem[];
  coveredItemsCount: number;
  totalComparableItemsCount: number;
  completenessPercentage: number;
  isComplete: boolean;
  isEstimative: boolean;
  totalPrice: number;
  loyaltySavings: number;
  lastVerifiedAt: string | null;
  oldestVerifiedAt: string | null;
  savingsVsWorstStore: number | null;
}

export interface BasketMultiStoreStop {
  store: Store;
  isFavorite: boolean;
  allocations: BasketItemAllocation[];
  subtotal: number;
  itemsCount: number;
  lastVerifiedAt: string | null;
}

export interface BasketMultiStorePlan {
  storeCount: number;
  maxStoresLimit: number;
  stops: BasketMultiStoreStop[];
  coveredItemsCount: number;
  totalComparableItemsCount: number;
  missingItems: BasketMissingPriceItem[];
  isComplete: boolean;
  isEstimative: boolean;
  productsTotal: number;
  transportCost: number;
  includesTransportCost: boolean;
  totalWithTransport: number;
  baselineSingleStore: BasketSingleStorePlan | null;
  comparableItemsCountWithBaseline: number;
  hasValidSavingsBaseline: boolean;
  savingsVsBestSingleStore: number | null;
  savingsPercentVsBestSingleStore: number | null;
  lastVerifiedAt: string | null;
  oldestVerifiedAt: string | null;
  explanationRo: string;
}

export interface BasketOptimizationOptions {
  useLoyaltyCards?: boolean;
  maxStores?: number; // 1, 2, 3, or higher
  excludedStoreIds?: string[];
  favoriteStoreIds?: string[];
  includeStaleOffers?: boolean;
  transportCostPerExtraStore?: number; // Default 0 - never invent transport costs
  now?: Date;
}

export interface BasketOptimizationResult {
  listId?: string;
  listName?: string;
  totalRequestedLines: number;
  distinctNormalizedItemsCount: number;
  duplicateLinesMergedCount: number;
  comparableCatalogItemsCount: number;
  unconfidentMatches: BasketUnconfidentMatch[];
  unitConflicts: BasketUnitConflict[];
  itemsWithoutAnyValidPrice: BasketMissingPriceItem[];
  singleStoreRankings: BasketSingleStorePlan[];
  bestSingleStore: BasketSingleStorePlan | null;
  bestTwoStores: BasketMultiStorePlan | null;
  bestThreeStores: BasketMultiStorePlan | null;
  recommendedMultiStore: BasketMultiStorePlan | null;
  maxStoresApplied: number;
  excludedStoreIds: string[];
  favoriteStoreIds: string[];
  hasValidSavingsBaseline: boolean;
  isEstimative: boolean;
  lastPriceVerificationAt: string | null;
  oldestPriceVerificationAt: string | null;
  limitations: string[];
  calculatedAt: string;
}

// =========================================================================
// V1 Roadmap: Price History Intervals (30 / 90 / 180 / 365 days)
// =========================================================================

export type PriceHistoryInterval = 30 | 90 | 180 | 365;

export interface PriceHistoryIntervalStats {
  intervalDays: PriceHistoryInterval;
  observationsCount: number;
  distinctDaysCount: number;
  minPrice: number | null;
  minPriceDate: string | null;
  minPriceStoreId: string | null;
  minPriceStoreName: string | null;
  maxPrice: number | null;
  avgPrice: number | null;
  lastObservation: {
    price: number;
    date: string;
    storeId: string;
    storeName: string;
    source: string;
  } | null;
  hasSufficientHistory: boolean;
  noticeRo?: string;
}



