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
  isSoldByWeight?: boolean;
  isIndivisiblePackage?: boolean;
  baseReferencePrice: number;
  canonicalProductId?: string | null;
  subcategory?: string;
  description?: string;
}

export interface RetailerProductRecord {
  id: string;
  retailerId: string;
  productId?: string | null;
  externalSku?: string;
  url?: string;
  scrapedName: string;
  scrapedBrand?: string;
  barcode?: string;
  status?: string;
}

export interface ProductOffer {
  id: string;
  productId: string;
  storeId: string;
  sourceId?: string;
  price: number; // RON per packaging unit
  currency?: string; // Expected 'RON'
  originalPrice?: number;
  unitPrice: number; // normalized (e.g. RON / kg, RON / l, RON / buc)
  unitPriceMeasure: 'lei/kg' | 'lei/l' | 'lei/buc';
  isPromo: boolean;
  promoDetails?: string;
  loyaltyCardRequired?: boolean;
  loyaltyCardName?: string; // ex: 'Lidl Plus', 'Kaufland Card', 'Club Carrefour', 'Penny Card'
  couponRequired?: boolean;
  couponCode?: string;
  minQuantityForPromo?: number;
  validFrom?: string; // YYYY-MM-DD
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
  originalProductId?: string;
  storeId: string;
  sourceId?: string;
  price: number;
  currency?: string;
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
  sourceProductId?: string;
  sourceRetailer?: string;
  targetRetailer?: string;
  decisionCategory?: ShadowMatchDecisionCategory;
  shadowMetadata?: Record<string, unknown>;
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

export type SharedListRole = 'owner' | 'editor' | 'viewer';

export interface SharedListMember {
  id: string;
  listId: string;
  userId: string;
  role: SharedListRole;
  displayName: string;
  emailMasked?: string;
  joinedAt: string;
}

export interface SharedListInvite {
  id: string;
  listId: string;
  role: Exclude<SharedListRole, 'owner'>;
  invitedEmail?: string | null;
  expiresAt: string;
  maxUses: number;
  usesCount: number;
  revokedAt?: string | null;
  createdAt: string;
  inviteUrl?: string;
}

export type SharedListActivityAction =
  | 'list_shared'
  | 'member_joined'
  | 'member_role_changed'
  | 'member_revoked'
  | 'item_added'
  | 'item_updated'
  | 'item_checked'
  | 'item_unchecked'
  | 'item_removed'
  | 'list_renamed';

export interface SharedListActivityEntry {
  id: string;
  listId: string;
  actorUserId?: string;
  actorName: string;
  actionType: SharedListActivityAction;
  targetName?: string;
  details?: Record<string, any>;
  createdAt: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingListItem[];
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
  ownerId?: string;
  myRole?: SharedListRole;
  isShared?: boolean;
  members?: SharedListMember[];
  recentActivity?: SharedListActivityEntry[];
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
    originalMatchedProductId?: string;
    rejectedCycleMatchedProductId?: boolean;
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

export type PriceAlertType = 'below_target' | 'any_drop' | 'interval_low' | 'product_watch';

export type PriceAlertRearmState = 'armed' | 'triggered_locked';

export type PriceAlertEvaluationOutcome =
  | 'triggered'
  | 'skipped_duplicate'
  | 'skipped_cooldown'
  | 'skipped_cycle_locked'
  | 'skipped_price_not_met'
  | 'skipped_ineligible_price'
  | 'skipped_canonical_invalid'
  | 'rearmed_price_recovered'
  | 'rearmed_offer_expired';

export interface PriceAlertTriggerEvent {
  id: string;
  alertId: string;
  productId: string;
  outcome: PriceAlertEvaluationOutcome;
  evaluatedAt: string;
  observedPrice?: number;
  targetPrice?: number;
  previousPrice?: number;
  storeId?: string;
  storeName?: string;
  sourceOfferId?: string;
  sourceObservationId?: string;
  qualityStatus?: PriceDataQualityStatus;
  idempotencyKey?: string;
  reasonRo: string;
}

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
  minDropPercent?: number;
  cooldownHours?: number;
  rearmState?: PriceAlertRearmState;
  triggerCycle?: number;
  sourceListId?: string;
  lastTriggeredAt?: string;
  lastTriggeredPrice?: number;
  lastEvaluatedPrice?: number;
  lastNotifiedKey?: string;
  lastTriggerReasonRo?: string;
  lastSourceOfferId?: string;
  lastSourceQualityStatus?: PriceDataQualityStatus;
  lastRearmedAt?: string;
  lastSkippedReasonRo?: string;
  triggerHistory?: PriceAlertTriggerEvent[];
}

export interface InAppPriceNotification {
  id: string;
  alertId: string;
  dedupeKey: string;
  idempotencyKey?: string;
  productId: string;
  originalProductId?: string;
  productName: string;
  alertType: PriceAlertType;
  title: string;
  message: string;
  reasonRo?: string;
  observedPrice: number;
  previousPrice?: number;
  targetPrice?: number;
  storeId?: string;
  storeName?: string;
  sourceOfferId?: string;
  sourceObservationId?: string;
  qualityStatus?: PriceDataQualityStatus;
  qualityLabelRo?: string;
  observedIntervalDays?: PriceHistoryInterval;
  observedObservationsCount?: number;
  triggerCycle?: number;
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
  isCompleteBasket?: boolean;
  isCheapestCompleteBasket?: boolean;
  rankingBucket?: 'complete' | 'partial' | 'no_offers';
  hasValidOffers?: boolean;
  totalItemsCount?: number;
  coveredItemsCount?: number;
  unpricedItemsCount?: number;
  comparableDiffVsCompleteWinner?: number | null;
  comparableDiffVsSameCoverageLeader?: number | null;
  oldestVerifiedAt?: string | null;
  completenessPercentage: number;
  confidenceLevel: ConfidenceLevel;
  lastUpdated: string;
  hasLoyaltyDiscount: boolean;
  loyaltySavings: number;
}

export interface BasketSavingsSummary {
  status: 'determined' | 'undetermined';
  cheapestTotal: number;
  availableSubtotal: number;
  mostExpensiveTotal: number;
  maxSavings: number;
  bestStoreName: string;
  mostExpensiveStoreName?: string;
  hasLoyaltyDiscount: boolean;
  hasCompleteComparableBaskets: boolean;
  isCompleteBasket: boolean;
  pricedItemsCount: number;
  unpricedItemsCount: number;
  totalItemsCount: number;
  comparableStoresCount: number;
  comparedStoreNames: string[];
  comparableItemsCount: number;
  savingsExplanationRo: string;
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
  monthlyBudget?: number | null;
  weeklyBudget?: number | null;
  budgetAlertThresholdPct?: number;
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
  originalProductId?: string;
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
  originalProductId?: string;
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
  expiredMaxHours?: number;
  observationRecentlyVerifiedMaxDays?: number;
  observationVerifiedMaxDays?: number;
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
  hasEnoughDataForScore?: boolean;
  subjectType?: 'offer' | 'observation';
  methodologyVersion: string;
  ageHours: number | null;
  lastVerifiedAt: string | null;
  isUsableForComparison: boolean;
  isReliableForOptimization: boolean;
  historicalContextNoteRo?: string;
  canonicalProductId?: string;
  originalProductId?: string;
  factors: PriceQualityFactor[];
  reasons: string[];
}

export interface PriceObservationQualityInput extends Partial<Omit<PriceObservation, 'source'>> {
  id: string;
  productId: string;
  storeId: string;
  price: number;
  date: string;
  source: DataSourceType | string;
  unit?: UnitType | string;
  normalizedUnit?: string;
  unitPriceMeasure?: string;
  packageWeightOrVolume?: number;
  packageUnit?: UnitType | string;
  expectedUnit?: UnitType | string;
  expectedPackageWeightOrVolume?: number;
  expectedPackageUnit?: UnitType | string;
  isPromo?: boolean;
  verificationStatus?: VerificationStatus | string;
  validFrom?: string;
  validUntil?: string;
  offerValidUntil?: string;
  isFlaggedAnomaly?: boolean;
  anomalyReason?: string;
}

export interface FlaggedPriceObservation {
  id: string;
  productId: string;
  originalProductId?: string;
  storeId: string;
  storeName: string;
  price: number;
  currency?: string;
  date: string;
  source: DataSourceType | string;
  sourceLabel: string;
  qualityAssessment: PriceDataQualityAssessment;
}

// =========================================================================
// V1 Roadmap: Basket Optimizer (1-Store & Multi-Store)
// =========================================================================

export type BasketMatchConfidence =
  | 'exact_id'
  | 'exact_ean'
  | 'exact_brand_name_weight'
  | 'exact_name'
  | 'high_token';

export type ConditionalPromoType = 'none' | 'loyalty_card' | 'coupon' | 'min_quantity';

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
  requestedQuantity?: number;
  requestedUnit?: UnitType;
  packagesCount?: number;
  packageSizeLabel?: string;
  purchasedQuantity?: number;
  purchasedUnit?: UnitType;
  surplusQuantity?: number;
  surplusUnit?: UnitType;
  isIndivisiblePackage?: boolean;
  conditionalPromoType?: ConditionalPromoType;
  conditionalPromoApplied?: boolean;
  conditionalPromoNoteRo?: string;
  regionMatched?: string;
  currency?: 'RON';
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
  totalSurplusItemsCount?: number;
  staleItemsCount?: number;
  hasIncompleteData?: boolean;
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
  completenessPercentage?: number;
  coverageStatusRo?: 'COMPLET' | 'PARȚIAL' | 'INDISPONIBIL';
  unconfidentMatchesCount?: number;
  unitConflictsCount?: number;
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
  totalSurplusItemsCount?: number;
  savingsBasisRo?: string;
}

export interface BasketOptimizationOptions {
  useLoyaltyCards?: boolean;
  useCoupons?: boolean;
  maxStores?: number; // 1, 2, 3, or higher
  excludedStoreIds?: string[];
  favoriteStoreIds?: string[];
  includeStaleOffers?: boolean;
  maxOfferAgeDays?: number;
  region?: string;
  transportCostPerExtraStore?: number; // Default 0 - never invent transport costs
  clientRevision?: string;
  now?: Date;
}

export interface BasketSolverMetadata {
  strategy: 'exact_branch_and_bound' | 'deterministic_heuristic';
  isProvenGlobalOptimum: boolean;
  evaluatedSubsetsCount: number;
  eligibleUsefulStoresCount: number;
  itemCount: number;
  executionTimeMs: number;
  noteRo: string;
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
  appliedRegion?: string | null;
  maxOfferAgeDaysApplied?: number | null;
  useCouponsApplied?: boolean;
  revisionToken?: string;
  savingsMethodNoteRo?: string;
  solverMetadata?: BasketSolverMetadata;
}

// =========================================================================
// V1 Roadmap: Price History Intervals (30 / 90 / 180 / 365 days)
// =========================================================================

export type PriceHistoryInterval = 30 | 90 | 180 | 365;

export interface PriceHistoryStoreBreakdown {
  storeId: string;
  storeName: string;
  observationsCount: number;
  distinctDaysCount: number;
  minPrice: number;
  minPriceDate: string;
  avgPrice: number;
  maxPrice: number;
  lastPrice: number;
  lastDate: string;
  lastSource: string;
  lastSourceType: DataSourceType | string;
  sources: string[];
  hasMixedSources: boolean;
  latestQualityStatus?: PriceDataQualityStatus;
  latestQualityLabelRo?: string;
  latestQualityReasonRo?: string;
  verifiedCount?: number;
  staleCount?: number;
  unverifiedCount?: number;
}

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
    sourceType?: DataSourceType | string;
  } | null;
  hasSufficientHistory: boolean;
  noticeRo?: string;
  storeBreakdown?: PriceHistoryStoreBreakdown[];
  excludedForeignCurrencyCount?: number;
  invalidObservationsCount?: number;
}

// =========================================================================
// V2 Personal Shopping Assistant: Budget, Alternatives, Barcode, AI Grounding
// =========================================================================

export interface PersonalBudgetSettings {
  monthlyBudget: number | null;
  weeklyBudget: number | null;
  alertThresholdPct: number; // default 80
}

export type BudgetAlertLevel = 'none' | 'warning' | 'exceeded' | 'unconfigured';

export interface CategorySpendingSummary {
  category: ProductCategory | string;
  amount: number;
  sharePct: number;
  itemsCount: number;
}

export interface MonthlySpendingHistoryEntry {
  monthKey: string; // YYYY-MM
  labelRo: string;
  totalSpent: number;
  receiptsCount: number;
  budgetTarget: number | null;
  overBudget: boolean;
}

export interface BudgetStatusSummary {
  settings: PersonalBudgetSettings;
  currentMonthKey: string;
  currentWeekRangeLabel: string;
  monthlySpent: number;
  weeklySpent: number;
  monthlyRemaining: number | null;
  weeklyRemaining: number | null;
  monthlyProgressPct: number | null;
  weeklyProgressPct: number | null;
  monthlyAlertLevel: BudgetAlertLevel;
  weeklyAlertLevel: BudgetAlertLevel;
  confirmedReceiptsCount: number;
  excludedReceiptsCount: number;
  categoryBreakdown: CategorySpendingSummary[];
  monthlyHistory: MonthlySpendingHistoryEntry[];
  warningsRo: string[];
}

export type ProductAlternativeKind =
  | 'same_product_other_retailer'
  | 'same_product_other_size'
  | 'similar_product'
  | 'alternative_brand'
  | 'private_label';

export interface ProductAlternativeRecommendation {
  kind: ProductAlternativeKind;
  kindLabelRo: string;
  product: Product;
  bestOffer: ProductOffer;
  store: Store;
  price: number;
  normalizedUnitPrice: number;
  normalizedUnitLabel: string;
  savingsPerNormalizedUnit: number;
  savingsPercent: number;
  isCheaperNormalized: boolean;
  isPrivateLabel: boolean;
  compatibilityReasonRo: string;
}

export interface ProductAlternativesResult {
  targetProduct: Product;
  referenceOffer: ProductOffer | null;
  referenceStore: Store | null;
  referenceNormalizedUnitPrice: number | null;
  referenceNormalizedUnitLabel: string;
  groups: Record<ProductAlternativeKind, ProductAlternativeRecommendation[]>;
  cheaperNormalizedAlternatives: ProductAlternativeRecommendation[];
  totalCount: number;
  limitations: string[];
}

export interface BarcodeLookupResult {
  found: boolean;
  searchedBarcode: string;
  normalizedBarcodes: string[];
  barcodeValidation?: import('./services/ProductNormalizationService.js').BarcodeValidationResult;
  product?: Product;
  offers: Array<{
    offer: ProductOffer;
    store: Store;
  }>;
  lowestPrice: number | null;
  lowestStoreName: string | null;
  historySummary?: {
    observationsCount: number;
    minPrice90d: number | null;
    avgPrice90d: number | null;
    lastObservationDate: string | null;
  };
  messageRo: string;
}

export interface ProductBarcodeSuggestion {
  id: string;
  userId?: string;
  barcode: string;
  proposedName: string;
  proposedBrand?: string;
  category: ProductCategory;
  packageWeightOrVolume?: number;
  packageUnit?: UnitType;
  observedStoreId?: string;
  observedPrice?: number;
  notes?: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected';
  createdAt: string;
}

export type ShoppingAssistantIntent =
  | 'budget_basket'
  | 'optimize_list'
  | 'list_promos'
  | 'cheaper_alternatives'
  | 'meal_plan_days'
  | 'general_guidance';

export interface ShoppingAssistantGroundedItem {
  productId: string;
  productName: string;
  brand: string;
  category: string;
  storeId: string;
  storeName: string;
  quantity: number;
  unit: UnitType;
  price: number;
  unitPrice: number;
  unitPriceMeasure: string;
  isPromo: boolean;
  originalPrice?: number;
  promoDetails?: string;
  dayLabel?: string;
  noteRo?: string;
}

export interface ShoppingAssistantDeterministicPlan {
  intent: ShoppingAssistantIntent;
  titleRo: string;
  budgetRequestedLei?: number;
  daysRequested?: number;
  catalogAvailableCount: number;
  validOffersCount: number;
  items: ShoppingAssistantGroundedItem[];
  totalEstimatedCost: number;
  remainingBudgetLei?: number;
  estimatedSavingsLei?: number;
  optimizationSummary?: {
    bestSingleStoreName?: string;
    bestSingleStoreTotal?: number;
    bestMultiStoreTotal?: number;
    savingsAmount?: number;
    missingItemsCount: number;
    unconfidentMatchesCount: number;
  };
  limitations: string[];
  allowedProductIds: string[];
}

export interface ShoppingAssistantResponse {
  success: boolean;
  intent: ShoppingAssistantIntent;
  answerRo: string;
  highlights: string[];
  recommendedItems: ShoppingAssistantGroundedItem[];
  totalEstimatedCost: number;
  remainingBudgetLei?: number;
  estimatedSavingsLei?: number;
  limitations: string[];
  groundedSourceCount: number;
  generatedWithAi: boolean;
  model?: string;
  error?: string;
}

// =========================================================================
// FAZA 1B: Shadow Matching & Duplicate Detection (Read-Only Analysis)
// =========================================================================

export type ShadowMatchDecisionCategory =
  | 'HIGH_CONFIDENCE'
  | 'REVIEW'
  | 'BLOCKED'
  | 'LOW_CONFIDENCE';

export type ShadowMatchMethod =
  | 'gs1_exact'
  | 'brand_title_packaging'
  | 'title_packaging'
  | 'variant_conflict_blocked'
  | 'quantity_conflict_blocked'
  | 'brand_conflict_blocked'
  | 'packaging_structure_blocked'
  | 'insufficient_identity_blocked';

export type ShadowRecommendedAction =
  | 'review_high_confidence_candidate'
  | 'manual_review_needed'
  | 'keep_separate_different_packaging_structure'
  | 'block_incompatible_candidates'
  | 'no_action_low_confidence';

export type ShadowHardGuardCode =
  | 'GUARD_INSUFFICIENT_TITLE'
  | 'GUARD_VARIABLE_WEIGHT'
  | 'GUARD_SUSPICIOUS_MULTIPACK'
  | 'GUARD_NONFOOD_UNIT_CONTRADICTION'
  | 'GUARD_INCOMPATIBLE_BRAND'
  | 'GUARD_PRIVATE_LABEL_CROSS_RETAILER'
  | 'GUARD_AMBIGUOUS_BRAND_PLACEHOLDER'
  | 'GUARD_INCOMPATIBLE_VARIANT'
  | 'GUARD_INCOMPATIBLE_UNIT_FAMILY'
  | 'GUARD_INCOMPATIBLE_QUANTITY'
  | 'GUARD_PACKAGING_STRUCTURE_MISMATCH';

export interface ShadowHardGuardResult {
  code: ShadowHardGuardCode;
  passed: boolean;
  severity: 'hard_block' | 'soft_warning';
  reason: string;
}

export interface ShadowMatchEvidence {
  code: string;
  label: string;
  weight?: number;
  detail: string;
}

export interface ShadowScoreBreakdown {
  gtinScore: number;
  brandScore: number;
  titleScore: number;
  packagingScore: number;
  variantCategoryScore: number;
  penalties: number;
  cappedByMissingBrand: boolean;
  cappedByInsufficientTitle: boolean;
  cappedByHardGuard: boolean;
}

export interface ShadowMatchCandidate {
  candidateId: string;
  sourceProductId: string;
  targetProductId: string;
  sourceRetailer: string;
  targetRetailer: string;
  sourceTitle: string;
  targetTitle: string;
  normalizedSourceTitle?: string;
  normalizedTargetTitle?: string;
  sourceBrand: string | null;
  targetBrand: string | null;
  sourceBarcode: string | null;
  targetBarcode: string | null;
  sourceQuantity: string | null;
  targetQuantity: string | null;
  sourceUnit?: string | null;
  targetUnit?: string | null;
  sourcePackagingStructure: string | null;
  targetPackagingStructure: string | null;
  variantAttributes: {
    source: Record<string, unknown>;
    target: Record<string, unknown>;
    compatible: boolean;
    conflictReasons: string[];
  };
  matchingScore: number;
  scoreBreakdown?: ShadowScoreBreakdown;
  matchingMethod: ShadowMatchMethod;
  hardGuardResults: {
    allPassed: boolean;
    failedGuards: ShadowHardGuardCode[];
    checks: ShadowHardGuardResult[];
  };
  positiveEvidence: ShadowMatchEvidence[];
  negativeEvidence: ShadowMatchEvidence[];
  decisionCategory: ShadowMatchDecisionCategory;
  recommendedAction: ShadowRecommendedAction;
  explanation: string;
  normalizationVersion: string;
  generatedAt: string;
  differentStructureSameTotal: boolean;
  falsePositiveRisk: 'low' | 'medium' | 'high';
  sourceCategory?: ProductCategory;
  targetCategory?: ProductCategory;
}

// =========================================================================
// FAZA 2: Human Review Panel Types (Strictly Non-Destructive, No Merge)
// =========================================================================

export type ShadowReviewStatus =
  | 'pending_review'
  | 'confirmed_same_product'
  | 'confirmed_different_product'
  | 'needs_more_information'
  | 'dismissed';

export interface ShadowReviewDecisionRecord {
  candidateId: string;
  status: ShadowReviewStatus;
  reviewerId: string;
  reviewerEmail: string;
  authSource: 'admin_bearer_token' | 'supabase_admin_session';
  reason: string;
  notes?: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  version: number;
  decisionCategorySnapshot: ShadowMatchDecisionCategory;
  matchingScoreSnapshot: number;
}

export interface ShadowReviewAuditEntry {
  id: string;
  candidateId: string;
  previousStatus: ShadowReviewStatus;
  newStatus: ShadowReviewStatus;
  reviewerId: string;
  reviewerEmail: string;
  reason: string;
  notes?: string | null;
  timestamp: string;
  version: number;
}

export interface ShadowReviewOverviewStats {
  totalInspectableCount: number;
  totalPending: number;
  highConfidenceCount: number;
  reviewCount: number;
  blockedCount: number;
  lowConfidenceCount: number;
  confirmedSameProductCount: number;
  confirmedDifferentProductCount: number;
  needsMoreInformationCount: number;
  dismissedCount: number;
}

export interface ShadowReviewCandidateView {
  candidate: ShadowMatchCandidate;
  review: ShadowReviewDecisionRecord;
}

export interface ShadowMatchingReport {
  generatedAt: string;
  normalizationVersion: string;
  dataSource: 'postgresql' | 'supabase_readonly' | 'storage_service' | 'custom_dataset';
  readOnlyVerified: boolean;
  autoMergeExecuted: false;
  durationMs: number;
  summary: {
    totalProductsAnalyzed: number;
    canonicalProductsCount: number;
    aliasProductsSkippedCount: number;
    totalCandidatePairsGeneratedByBlocking: number;
    totalCandidatePairsEvaluated: number;
    highConfidenceCount: number;
    reviewCount: number;
    blockedCount: number;
    lowConfidenceCount: number;
    gs1ExactMatchesCount: number;
    brandBasedMatchesCount: number;
    titleBasedMatchesCount: number;
    quantityBasedMatchesCount: number;
    variantBasedMatchesCount: number;
    brandConflictsCount: number;
    quantityConflictsCount: number;
    multipackConflictsCount: number;
    differentStructureSameTotalCount: number;
    variantConflictsCount: number;
    insufficientIdentityProductsCount: number;
    falsePositiveRiskBreakdown: {
      low: number;
      medium: number;
      high: number;
    };
  };
  byRetailer: Record<
    string,
    {
      productsCount: number;
      candidatePairsCount: number;
      highConfidenceCount: number;
      reviewCount: number;
      blockedCount: number;
      lowConfidenceCount: number;
    }
  >;
  byRetailerPair: Record<
    string,
    {
      totalPairs: number;
      highConfidenceCount: number;
      reviewCount: number;
      blockedCount: number;
      lowConfidenceCount: number;
    }
  >;
  byMethod: Record<ShadowMatchMethod, number>;
  samples: {
    highConfidence: ShadowMatchCandidate[];
    review: ShadowMatchCandidate[];
    blocked: ShadowMatchCandidate[];
    lowConfidence: ShadowMatchCandidate[];
    differentStructureSameTotal: ShadowMatchCandidate[];
  };
  candidates: ShadowMatchCandidate[];
}
