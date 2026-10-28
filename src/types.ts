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
export type VerificationStatus = 'verified' | 'pending' | 'rejected' | 'expired' | 'demo';

export interface Store {
  id: string;
  name: string;
  slug: string;
  chain: string;
  brandColor: string;
  accentColor: string;
  logoUrl?: string;
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

export interface ReceiptItem {
  id: string;
  rawName: string;
  matchedProductId?: string;
  matchedProductName?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discount: number;
  vatRate?: number;
  confidence: ConfidenceLevel;
  category?: ProductCategory;
}

export interface Receipt {
  id: string;
  storeId: string;
  storeName: string;
  storeAddress?: string;
  fiscalNumber?: string;
  date: string;
  time?: string;
  items: ReceiptItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
  currency: 'RON';
  imageUrl?: string;
  createdAt: string;
  verifiedStatus: 'confirmed' | 'draft';
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

export interface UserProfile {
  name: string;
  email: string;
  city: string;
  preferredStores: string[];
  monthlySavingsGoal: number;
  notificationsEnabled: boolean;
  defaultTransportCostEstimate: number;
  useLoyaltyCards: boolean; // whether user has supermarket loyalty cards
}

export interface SavingsSummary {
  totalSavedToDate: number;
  potentialCurrentBasketSavings: number;
  scannedReceiptsCount: number;
  trackedProductsCount: number;
  lastMonthSavings: number;
}
