import {
  ShoppingList,
  Receipt,
  PriceAlert,
  UserProfile,
  Product,
  ProductOffer,
  PriceObservation,
  DataSource,
  SourceSyncRun,
  ProductMatchCandidate,
  UserErrorReport,
  MatchAuditEntry
} from '../types.js';
import {
  PromotionRecord,
  ReceiptDiscoveryItem,
  RetailerProductRecord,
  IndexingRunRecord,
  QualityAnomalyRecord,
  RecollectionTask,
  DailyQualityReportRecord,
  PriceFreshnessThresholds,
  PriceQualityWeights
} from '../indexing/types.js';
import {
  CatalogSource,
  CatalogDocument,
  CatalogImportRun,
  CatalogExtractedOffer,
  CatalogImportError,
  CatalogImporterStats
} from '../indexing/catalog/catalogTypes.js';
import { INITIAL_CATALOG_SOURCES } from '../indexing/catalog/CatalogSourceDiscovery.js';
import {
  INITIAL_USER_PROFILE,
  PRODUCTS,
  PRODUCT_OFFERS,
  PRICE_OBSERVATIONS,
  DATA_SOURCES,
  INITIAL_SYNC_RUNS,
  INITIAL_MATCH_CANDIDATES
} from '../data/mockData.js';

const KEYS = {
  SHOPPING_LISTS: 'cosul_meu_lists_v1',
  ACTIVE_LIST_ID: 'cosul_meu_active_list_id',
  RECEIPTS: 'cosul_meu_receipts_v1',
  USER_PROFILE: 'cosul_meu_user_profile_v1',
  PRICE_ALERTS: 'cosul_meu_price_alerts_v1',
  TRACKED_PRODUCTS: 'cosul_meu_tracked_products_v1',
  CUSTOM_PRODUCTS: 'cosul_meu_custom_products_v1',
  PRICE_OBSERVATIONS: 'cosul_meu_price_observations_v1',
  DISMISSED_DEMO: 'cosul_meu_demo_banner_dismissed',
  DATA_SOURCES: 'cosul_meu_data_sources_v1',
  SYNC_RUNS: 'cosul_meu_sync_runs_v1',
  PRODUCT_OFFERS: 'cosul_meu_product_offers_v1',
  MATCH_CANDIDATES: 'cosul_meu_match_candidates_v1',
  PROMOTIONS: 'cosul_meu_promotions_v1',
  RECEIPT_PRODUCTS: 'cosul_meu_receipt_products_v1',
  RETAILER_PRODUCTS: 'cosul_meu_retailer_products_v1',
  INDEXING_RUNS: 'cosul_meu_indexing_runs_v1',
  QUALITY_ANOMALIES: 'cosul_meu_quality_anomalies_v1',
  RECOLLECTION_QUEUE: 'cosul_meu_recollection_queue_v1',
  DAILY_QUALITY_REPORTS: 'cosul_meu_daily_quality_reports_v1',
  QUALITY_CONFIG: 'cosul_meu_quality_config_v1',
  USER_ERROR_REPORTS: 'cosul_meu_user_error_reports_v1',
  MATCH_AUDIT_LOGS: 'cosul_meu_match_audit_logs_v1',
  CATALOG_SOURCES: 'cosul_meu_catalog_sources_v1',
  CATALOG_DOCUMENTS: 'cosul_meu_catalog_documents_v1',
  CATALOG_IMPORT_RUNS: 'cosul_meu_catalog_import_runs_v1',
  CATALOG_EXTRACTED_OFFERS: 'cosul_meu_catalog_extracted_offers_v1',
  CATALOG_IMPORT_ERRORS: 'cosul_meu_catalog_import_errors_v1',
  DELETED_PRODUCT_IDS: 'cosul_meu_deleted_product_ids_v1'
};


const memoryStore: Record<string, string> = {};

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {}
  return null;
}

function safeGetItem(key: string): string | null {
  const storage = getStorage();
  if (storage) {
    try {
      return storage.getItem(key);
    } catch {}
  }
  return memoryStore[key] ?? null;
}

function safeSetItem(key: string, value: string): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(key, value);
      return;
    } catch {}
  }
  memoryStore[key] = value;
}

function safeClear(): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.clear();
    } catch {}
  }
  for (const k of Object.keys(memoryStore)) {
    delete memoryStore[k];
  }
}

export class StorageService {
  // Shopping Lists
  static getShoppingLists(): ShoppingList[] {
    try {
      this.sanitizeDemoData();
      const data = safeGetItem(KEYS.SHOPPING_LISTS);
      if (!data) {
        return [];
      }
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  static saveShoppingLists(lists: ShoppingList[]): void {
    try {
      safeSetItem(KEYS.SHOPPING_LISTS, JSON.stringify(lists));
    } catch (e) {
      console.error('Eroare la salvarea listelor:', e);
    }
  }

  static getActiveListId(): string {
    try {
      const id = safeGetItem(KEYS.ACTIVE_LIST_ID);
      if (id) return id;
      const lists = this.getShoppingLists();
      return lists[0]?.id || '';
    } catch {
      return '';
    }
  }

  static setActiveListId(id: string): void {
    try {
      safeSetItem(KEYS.ACTIVE_LIST_ID, id);
    } catch (e) {
      console.error('Eroare la setarea listei active:', e);
    }
  }

  // Receipts
  static getReceipts(): Receipt[] {
    try {
      this.sanitizeDemoData();
      const data = safeGetItem(KEYS.RECEIPTS);
      if (!data) {
        return [];
      }
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  static saveReceipts(receipts: Receipt[]): void {
    try {
      safeSetItem(KEYS.RECEIPTS, JSON.stringify(receipts));
    } catch (e) {
      console.error('Eroare la salvarea bonurilor:', e);
    }
  }

  static addReceipt(receipt: Receipt): void {
    const receipts = this.getReceipts();
    const updated = [receipt, ...receipts.filter(r => r.id !== receipt.id)];
    this.saveReceipts(updated);

    // Register price observations from this confirmed receipt without overwriting historical ones
    const newObservations: PriceObservation[] = receipt.items
      .filter(item => item.matchedProductId)
      .map(item => ({
        id: `obs-rec-${receipt.id}-${item.id}`,
        productId: item.matchedProductId!,
        storeId: receipt.storeId,
        price: item.unitPrice,
        date: receipt.date,
        receiptId: receipt.id,
        source: 'verified' as const
      }));

    if (newObservations.length > 0) {
      this.addPriceObservations(newObservations);
    }
  }

  static deleteReceipt(receiptId: string): void {
    const receipts = this.getReceipts().filter(r => r.id !== receiptId);
    this.saveReceipts(receipts);
  }

  // User Profile
  static getUserProfile(): UserProfile {
    try {
      const data = safeGetItem(KEYS.USER_PROFILE);
      if (!data) {
        return {
          name: 'Utilizator',
          email: '',
          city: 'București',
          preferredStores: [],
          monthlySavingsGoal: 0,
          notificationsEnabled: false,
          defaultTransportCostEstimate: 0,
          useLoyaltyCards: true
        };
      }
      const parsed = JSON.parse(data);
      if (parsed.useLoyaltyCards === undefined) parsed.useLoyaltyCards = true;
      return parsed;
    } catch {
      return {
        name: 'Utilizator',
        email: '',
        city: 'București',
        preferredStores: [],
        monthlySavingsGoal: 0,
        notificationsEnabled: false,
        defaultTransportCostEstimate: 0,
        useLoyaltyCards: true
      };
    }
  }

  static saveUserProfile(profile: UserProfile): void {
    try {
      safeSetItem(KEYS.USER_PROFILE, JSON.stringify(profile));
    } catch (e) {
      console.error('Eroare la salvarea profilului:', e);
    }
  }

  // Price Alerts
  static getPriceAlerts(): PriceAlert[] {
    try {
      this.sanitizeDemoData();
      const data = safeGetItem(KEYS.PRICE_ALERTS);
      if (!data) {
        return [];
      }
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  static savePriceAlerts(alerts: PriceAlert[]): void {
    try {
      safeSetItem(KEYS.PRICE_ALERTS, JSON.stringify(alerts));
    } catch (e) {
      console.error('Eroare la salvarea alertelor:', e);
    }
  }

  // Tracked Products
  static getTrackedProducts(): string[] {
    try {
      this.sanitizeDemoData();
      const data = safeGetItem(KEYS.TRACKED_PRODUCTS);
      if (!data) {
        return [];
      }
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  static toggleTrackedProduct(productId: string): boolean {
    const current = this.getTrackedProducts();
    let updated: string[];
    let isTracked: boolean;
    if (current.includes(productId)) {
      updated = current.filter(id => id !== productId);
      isTracked = false;
    } else {
      updated = [...current, productId];
      isTracked = true;
    }
    safeSetItem(KEYS.TRACKED_PRODUCTS, JSON.stringify(updated));
    return isTracked;
  }

  static saveTrackedProducts(productIds: string[]): void {
    safeSetItem(KEYS.TRACKED_PRODUCTS, JSON.stringify(Array.from(new Set(productIds.filter(Boolean)))));
  }

  // Custom Products
  static getCustomProducts(): Product[] {
    try {
      const data = safeGetItem(KEYS.CUSTOM_PRODUCTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static addCustomProduct(product: Product): void {
    const list = this.getCustomProducts();
    safeSetItem(KEYS.CUSTOM_PRODUCTS, JSON.stringify([...list, product]));
  }

  static getDeletedProductIds(): string[] {
    try {
      const data = safeGetItem(KEYS.DELETED_PRODUCT_IDS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static deleteProducts(ids: string[]): { deletedCount: number } {
    if (!ids || ids.length === 0) return { deletedCount: 0 };
    const idSet = new Set(ids);
    const deletedList = this.getDeletedProductIds();
    const updatedDeletedList = Array.from(new Set([...deletedList, ...ids]));
    safeSetItem(KEYS.DELETED_PRODUCT_IDS, JSON.stringify(updatedDeletedList));

    const custom = this.getCustomProducts();
    const updatedCustom = custom.filter(p => !idSet.has(p.id));
    safeSetItem(KEYS.CUSTOM_PRODUCTS, JSON.stringify(updatedCustom));

    // Also remove from tracked products
    const tracked = this.getTrackedProducts();
    const updatedTracked = tracked.filter((id: string) => !idSet.has(id));
    safeSetItem(KEYS.TRACKED_PRODUCTS, JSON.stringify(updatedTracked));

    // Also remove offers associated with deleted products
    const offers = this.getProductOffers();
    const updatedOffers = offers.filter(o => !idSet.has(o.productId));
    this.saveProductOffers(updatedOffers);

    // Also remove observations associated with deleted products
    const observations = this.getPriceObservations();
    const updatedObs = observations.filter(o => !idSet.has(o.productId));
    safeSetItem(KEYS.PRICE_OBSERVATIONS, JSON.stringify(updatedObs));

    return { deletedCount: ids.length };
  }

  static deleteProduct(id: string): boolean {
    return this.deleteProducts([id]).deletedCount > 0;
  }

  static getAllProducts(): Product[] {
    const deleted = new Set(this.getDeletedProductIds());
    const custom = this.getCustomProducts();
    return [...PRODUCTS, ...custom].filter(p => !deleted.has(p.id));
  }

  static getProducts(): Product[] {
    return this.getAllProducts();
  }

  // Product Offers (dynamic & persistent)
  static getProductOffers(): ProductOffer[] {
    try {
      const data = safeGetItem(KEYS.PRODUCT_OFFERS);
      if (!data) {
        this.saveProductOffers(PRODUCT_OFFERS);
        return PRODUCT_OFFERS;
      }
      return JSON.parse(data);
    } catch {
      return PRODUCT_OFFERS;
    }
  }

  static saveProductOffers(offers: ProductOffer[]): void {
    try {
      safeSetItem(KEYS.PRODUCT_OFFERS, JSON.stringify(offers));
    } catch (e) {
      console.error('Eroare la salvarea ofertelor:', e);
    }
  }

  static addOrUpdateOffers(newOffers: ProductOffer[]): { added: number; updated: number } {
    const current = this.getProductOffers();
    let added = 0;
    let updated = 0;

    const offerMap = new Map<string, ProductOffer>();
    for (const off of current) {
      const key = `${off.productId}__${off.storeId}`;
      // Prioritize active non-expired offers when building index
      if (!offerMap.has(key) || (offerMap.get(key)!.verificationStatus === 'expired' && off.verificationStatus !== 'expired')) {
        offerMap.set(key, off);
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];

    for (const newOff of newOffers) {
      const key = `${newOff.productId}__${newOff.storeId}`;
      if (offerMap.has(key)) {
        const existing = offerMap.get(key)!;
        offerMap.set(key, {
          ...existing,
          ...newOff,
          validUntil: newOff.validUntil !== undefined ? newOff.validUntil : undefined,
          verificationStatus: newOff.verificationStatus || (newOff.validUntil && newOff.validUntil < todayStr ? 'expired' : 'verified'),
          id: existing.id
        });
        updated++;
      } else {
        offerMap.set(key, newOff);
        added++;
      }
    }

    const merged = Array.from(offerMap.values());
    this.saveProductOffers(merged);
    return { added, updated };
  }

  static upsertProductOffers(offers: ProductOffer[]): { added: number; updated: number } {
    return this.addOrUpdateOffers(offers);
  }

  // Price Observations (History preservation)
  static getPriceObservations(): PriceObservation[] {
    try {
      const data = safeGetItem(KEYS.PRICE_OBSERVATIONS);
      if (!data) {
        safeSetItem(KEYS.PRICE_OBSERVATIONS, JSON.stringify(PRICE_OBSERVATIONS));
        return PRICE_OBSERVATIONS;
      }
      return JSON.parse(data);
    } catch {
      return PRICE_OBSERVATIONS;
    }
  }

  /**
   * Adds new price observations to history.
   * Guarantees that historical entries are NEVER overwritten, preserving full audit timeline.
   */
  static addPriceObservations(newObs: PriceObservation[]): number {
    const current = this.getPriceObservations();
  // IDs identify the indexing event; equal prices on the same day are separate observations.
  const existingIds = new Set(current.map(obs => obs.id));
  const nonDuplicates = newObs.filter(obs => {
  if (existingIds.has(obs.id)) return false;
  existingIds.add(obs.id);
  return true;
  });

    if (nonDuplicates.length > 0) {
      const updated = [...current, ...nonDuplicates];
      safeSetItem(KEYS.PRICE_OBSERVATIONS, JSON.stringify(updated));
    }

    return nonDuplicates.length;
  }

  // Data Sources
  static getDataSources(): DataSource[] {
    try {
      const data = safeGetItem(KEYS.DATA_SOURCES);
      if (!data) {
        this.saveDataSources(DATA_SOURCES);
        return DATA_SOURCES;
      }
      return JSON.parse(data);
    } catch {
      return DATA_SOURCES;
    }
  }

  static saveDataSources(sources: DataSource[]): void {
    try {
      safeSetItem(KEYS.DATA_SOURCES, JSON.stringify(sources));
    } catch (e) {
      console.error('Eroare la salvarea surselor:', e);
    }
  }

  static updateDataSource(sourceId: string, partial: Partial<DataSource>): void {
    const current = this.getDataSources();
    const updated = current.map(s => (s.id === sourceId ? { ...s, ...partial } : s));
    this.saveDataSources(updated);
  }

  // Sync Runs
  static getSyncRuns(): SourceSyncRun[] {
    try {
      const data = safeGetItem(KEYS.SYNC_RUNS);
      if (!data) {
        this.saveSyncRuns(INITIAL_SYNC_RUNS);
        return INITIAL_SYNC_RUNS;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_SYNC_RUNS;
    }
  }

  static saveSyncRuns(runs: SourceSyncRun[]): void {
    try {
      safeSetItem(KEYS.SYNC_RUNS, JSON.stringify(runs));
    } catch (e) {
      console.error('Eroare la salvarea jurnalului de sincronizare:', e);
    }
  }

  static addSyncRun(run: SourceSyncRun): void {
    const runs = this.getSyncRuns();
    const updated = [run, ...runs];
    this.saveSyncRuns(updated);

    // Also update source metadata
    this.updateDataSource(run.sourceId, {
      lastSyncAt: run.completedAt,
      importedOffersCount: (this.getDataSources().find(s => s.id === run.sourceId)?.importedOffersCount || 0) + run.recordsImported,
      errorCount: (this.getDataSources().find(s => s.id === run.sourceId)?.errorCount || 0) + run.invalidRecords
    });
  }

  // Match Candidates
  static getMatchCandidates(): ProductMatchCandidate[] {
    try {
      const data = safeGetItem(KEYS.MATCH_CANDIDATES);
      if (!data) {
        this.saveMatchCandidates(INITIAL_MATCH_CANDIDATES);
        return INITIAL_MATCH_CANDIDATES;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_MATCH_CANDIDATES;
    }
  }

  static saveMatchCandidates(candidates: ProductMatchCandidate[]): void {
    try {
      safeSetItem(KEYS.MATCH_CANDIDATES, JSON.stringify(candidates));
    } catch (e) {
      console.error('Eroare la salvarea candidaților de potrivire:', e);
    }
  }

  static updateMatchCandidateStatus(id: string, status: 'auto_approved' | 'pending_confirmation' | 'rejected'): void {
    const current = this.getMatchCandidates();
    const updated = current.map(c => (c.id === id ? { ...c, status } : c));
    this.saveMatchCandidates(updated);
  }

  static addMatchCandidates(newCandidates: ProductMatchCandidate[]): void {
    const current = this.getMatchCandidates();
    const existingIds = new Set(current.map(c => c.id));
    const nonDups = newCandidates.filter(c => !existingIds.has(c.id));
    this.saveMatchCandidates([...current, ...nonDups]);
  }

  // Promotions Storage
  static getPromotions(): PromotionRecord[] {
    try {
      const data = safeGetItem(KEYS.PROMOTIONS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static savePromotions(promos: PromotionRecord[]): void {
    try {
      safeSetItem(KEYS.PROMOTIONS, JSON.stringify(promos));
    } catch (e) {
      console.error('Eroare la salvarea promoțiilor:', e);
    }
  }

  static addPromotions(newPromos: PromotionRecord[]): void {
    const existing = this.getPromotions();
    const map = new Map<string, PromotionRecord>();
    for (const p of existing) map.set(p.id, p);
    for (const p of newPromos) map.set(p.id, p);
    this.savePromotions(Array.from(map.values()));
  }

  // Receipt Products Discovery
  static getReceiptProducts(): ReceiptDiscoveryItem[] {
    try {
      const data = safeGetItem(KEYS.RECEIPT_PRODUCTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveReceiptProducts(items: ReceiptDiscoveryItem[]): void {
    try {
      safeSetItem(KEYS.RECEIPT_PRODUCTS, JSON.stringify(items));
    } catch (e) {
      console.error('Eroare la salvarea produselor din bonuri:', e);
    }
  }

  static addReceiptProducts(items: ReceiptDiscoveryItem[]): void {
    const existing = this.getReceiptProducts();
    const existingKeys = new Set(existing.map(i => `${i.rawName.toLowerCase().trim()}`));
    const newOnes = items.filter(i => !existingKeys.has(i.rawName.toLowerCase().trim()));
    this.saveReceiptProducts([...existing, ...newOnes]);
  }

  static updateReceiptProductStatus(id: string, status: 'pending' | 'searched' | 'matched' | 'ignored', matchedProductId?: string): void {
    const current = this.getReceiptProducts();
    const updated = current.map(item => {
      if (item.id === id) {
        return {
          ...item,
          targetSearchStatus: status,
          matchedProductId: matchedProductId ?? item.matchedProductId,
          lastSearchedAt: new Date().toISOString()
        };
      }
      return item;
    });
    this.saveReceiptProducts(updated);
  }

  // Retailer Products
  static getRetailerProducts(): RetailerProductRecord[] {
    try {
      const data = safeGetItem(KEYS.RETAILER_PRODUCTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveRetailerProducts(prods: RetailerProductRecord[]): void {
    try {
      safeSetItem(KEYS.RETAILER_PRODUCTS, JSON.stringify(prods));
    } catch (e) {
      console.error('Eroare la salvarea produselor retailer:', e);
    }
  }

  static addRetailerProducts(prods: RetailerProductRecord[]): void {
    const existing = this.getRetailerProducts();
    const map = new Map<string, RetailerProductRecord>();
    for (const p of existing) map.set(p.id, p);
    for (const p of prods) map.set(p.id, p);
    this.saveRetailerProducts(Array.from(map.values()));
  }

  // Indexing Runs
  static getIndexingRuns(): IndexingRunRecord[] {
    try {
      const data = safeGetItem(KEYS.INDEXING_RUNS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveIndexingRuns(runs: IndexingRunRecord[]): void {
    try {
      safeSetItem(KEYS.INDEXING_RUNS, JSON.stringify(runs));
    } catch (e) {
      console.error('Eroare la salvarea execuțiilor de indexare:', e);
    }
  }

  static addIndexingRun(run: IndexingRunRecord): void {
    const existing = this.getIndexingRuns();
    this.saveIndexingRuns([run, ...existing.slice(0, 49)]); // păstrăm ultimele 50 de execuții
  }

  // Demo Banner Dismiss
  static isDemoBannerDismissed(): boolean {
    return safeGetItem(KEYS.DISMISSED_DEMO) === 'true';
  }

  static setDemoBannerDismissed(dismissed: boolean): void {
    safeSetItem(KEYS.DISMISSED_DEMO, dismissed ? 'true' : 'false');
  }

  // Quality Anomalies Storage
  static getQualityAnomalies(): QualityAnomalyRecord[] {
    try {
      const data = safeGetItem(KEYS.QUALITY_ANOMALIES);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveQualityAnomalies(anomalies: QualityAnomalyRecord[]): void {
    try {
      safeSetItem(KEYS.QUALITY_ANOMALIES, JSON.stringify(anomalies));
    } catch (e) {
      console.error('Eroare la salvarea anomaliilor de calitate:', e);
    }
  }

  static addQualityAnomaly(anomaly: QualityAnomalyRecord): void {
    const existing = this.getQualityAnomalies();
    // Prevenim dublurile identice pentru același produs și retailer
    const filtered = existing.filter(a => !(a.productId === anomaly.productId && a.retailerId === anomaly.retailerId && a.anomalyType === anomaly.anomalyType && a.status === 'pending_review'));
    this.saveQualityAnomalies([anomaly, ...filtered]);
  }

  static updateQualityAnomalyStatus(id: string, status: 'pending_review' | 'resolved_approved' | 'resolved_rejected', reviewedBy?: string): void {
    const current = this.getQualityAnomalies();
    const updated = current.map(a => {
      if (a.id === id) {
        return {
          ...a,
          status,
          reviewedAt: new Date().toISOString(),
          reviewedBy: reviewedBy || 'admin'
        };
      }
      return a;
    });
    this.saveQualityAnomalies(updated);
  }

  // Recollection Queue Storage
  static getRecollectionQueue(): RecollectionTask[] {
    try {
      const data = safeGetItem(KEYS.RECOLLECTION_QUEUE);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveRecollectionQueue(tasks: RecollectionTask[]): void {
    try {
      safeSetItem(KEYS.RECOLLECTION_QUEUE, JSON.stringify(tasks));
    } catch (e) {
      console.error('Eroare la salvarea cozii de recolectare:', e);
    }
  }

  static addRecollectionTasks(tasks: RecollectionTask[]): void {
    const existing = this.getRecollectionQueue();
    const existingKeys = new Set(existing.filter(t => t.status === 'queued' || t.status === 'in_progress').map(t => `${t.productId}__${t.retailerId}`));
    const newTasks = tasks.filter(t => !existingKeys.has(`${t.productId}__${t.retailerId}`));
    this.saveRecollectionQueue([...existing, ...newTasks].sort((a, b) => a.priority - b.priority));
  }

  static updateRecollectionTaskStatus(id: string, status: 'queued' | 'in_progress' | 'completed' | 'failed'): void {
    const current = this.getRecollectionQueue();
    const updated = current.map(t => {
      if (t.id === id) {
        return {
          ...t,
          status,
          attempts: status === 'failed' || status === 'completed' ? t.attempts + 1 : t.attempts
        };
      }
      return t;
    });
    this.saveRecollectionQueue(updated);
  }

  // Daily Quality Reports Storage
  static getDailyQualityReports(): DailyQualityReportRecord[] {
    try {
      const data = safeGetItem(KEYS.DAILY_QUALITY_REPORTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveDailyQualityReports(reports: DailyQualityReportRecord[]): void {
    try {
      safeSetItem(KEYS.DAILY_QUALITY_REPORTS, JSON.stringify(reports));
    } catch (e) {
      console.error('Eroare la salvarea rapoartelor zilnice:', e);
    }
  }

  static addDailyQualityReport(report: DailyQualityReportRecord): void {
    const existing = this.getDailyQualityReports();
    const filtered = existing.filter(r => r.reportDate !== report.reportDate);
    this.saveDailyQualityReports([report, ...filtered]);
  }

  // Quality Configuration
  static getQualityConfig(): { thresholds: PriceFreshnessThresholds; weights: PriceQualityWeights } {
    try {
      const data = safeGetItem(KEYS.QUALITY_CONFIG);
      if (data) return JSON.parse(data);
    } catch {}

    return {
      thresholds: {
        veryRecentHours: 24,
        recentHours: 48,
        staleHours: 72
      },
      weights: {
        freshness: 0.25,
        formatValidity: 0.15,
        sourceProvenance: 0.10,
        productMatchConfidence: 0.15,
        unitConsistency: 0.10,
        verificationStatus: 0.10,
        anomalyAbsence: 0.10,
        retailerReliability: 0.05
      }
    };
  }

  static saveQualityConfig(config: { thresholds: PriceFreshnessThresholds; weights: PriceQualityWeights }): void {
    try {
      safeSetItem(KEYS.QUALITY_CONFIG, JSON.stringify(config));
    } catch (e) {
      console.error('Eroare la salvarea configurației de calitate:', e);
    }
  }

  // User Error Reports
  static getUserErrorReports(): UserErrorReport[] {
    try {
      const data = safeGetItem(KEYS.USER_ERROR_REPORTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static addUserErrorReport(report: UserErrorReport): void {
    const reports = this.getUserErrorReports();
    safeSetItem(KEYS.USER_ERROR_REPORTS, JSON.stringify([report, ...reports]));
  }

  // Match Audit History
  static getMatchAuditHistory(): MatchAuditEntry[] {
    try {
      const data = safeGetItem(KEYS.MATCH_AUDIT_LOGS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static addMatchAuditEntry(entry: MatchAuditEntry): void {
    const logs = this.getMatchAuditHistory();
    safeSetItem(KEYS.MATCH_AUDIT_LOGS, JSON.stringify([entry, ...logs]));
  }

  static correctProductMatch(
    candidateId: string,
    correctedProductId: string,
    reason: string,
    performedBy = 'admin'
  ): boolean {
    const candidates = this.getMatchCandidates();
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate) return false;

    const previousId = candidate.matchedProductId;
    candidate.matchedProductId = correctedProductId;
    candidate.status = 'auto_approved';
    this.saveMatchCandidates(candidates);

    this.addMatchAuditEntry({
      id: `audit-${Date.now()}`,
      candidateId,
      rawName: candidate.sourceRawName,
      previousProductId: previousId,
      correctedProductId,
      action: previousId === correctedProductId ? 'approved' : 'reassigned',
      reason,
      performedBy,
      timestamp: new Date().toISOString()
    });

    return true;
  }

  // ==========================================
  // CATALOG IMPORTER STORAGE METHODS
  // ==========================================

  static getCatalogSources(): CatalogSource[] {
    try {
      const data = safeGetItem(KEYS.CATALOG_SOURCES);
      if (!data) return INITIAL_CATALOG_SOURCES;

      const storedSources = JSON.parse(data) as CatalogSource[];
      const storedById = new Map(storedSources.map(source => [source.id, source]));

      // Keep user changes, but backfill newly registered retailers and sync updated official URLs.
      return INITIAL_CATALOG_SOURCES.map(source => {
        const stored = storedById.get(source.id);
        if (!stored) return source;
        if (stored.catalogUrl !== source.catalogUrl) {
          return { ...stored, ...source };
        }
        return stored;
      });
    } catch {
      return INITIAL_CATALOG_SOURCES;
    }
  }

  static saveCatalogSources(sources: CatalogSource[]): void {
    safeSetItem(KEYS.CATALOG_SOURCES, JSON.stringify(sources));
  }

  static updateCatalogSource(id: string, updates: Partial<CatalogSource>): CatalogSource | null {
    const sources = this.getCatalogSources();
    const idx = sources.findIndex(s => s.id === id);
    if (idx === -1) return null;
    sources[idx] = { ...sources[idx], ...updates };
    this.saveCatalogSources(sources);
    return sources[idx];
  }

  static getCatalogDocuments(): CatalogDocument[] {
    try {
      const data = safeGetItem(KEYS.CATALOG_DOCUMENTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveCatalogDocuments(docs: CatalogDocument[]): void {
    safeSetItem(KEYS.CATALOG_DOCUMENTS, JSON.stringify(docs));
  }

  static addCatalogDocument(doc: CatalogDocument): void {
    const docs = this.getCatalogDocuments();
    const idx = docs.findIndex(d => d.id === doc.id || (d.sha256Checksum && d.sha256Checksum === doc.sha256Checksum));
    if (idx !== -1) {
      docs[idx] = { ...docs[idx], ...doc, updatedAt: new Date().toISOString() };
    } else {
      docs.unshift(doc);
    }
    this.saveCatalogDocuments(docs);
  }

  static updateCatalogDocument(id: string, updates: Partial<CatalogDocument>): CatalogDocument | null {
    const docs = this.getCatalogDocuments();
    const idx = docs.findIndex(d => d.id === id);
    if (idx === -1) return null;
    docs[idx] = { ...docs[idx], ...updates, updatedAt: new Date().toISOString() };
    this.saveCatalogDocuments(docs);
    return docs[idx];
  }

  static getCatalogImportRuns(): CatalogImportRun[] {
    try {
      const data = safeGetItem(KEYS.CATALOG_IMPORT_RUNS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveCatalogImportRuns(runs: CatalogImportRun[]): void {
    safeSetItem(KEYS.CATALOG_IMPORT_RUNS, JSON.stringify(runs));
  }

  static addCatalogImportRun(run: CatalogImportRun): void {
    const runs = this.getCatalogImportRuns();
    safeSetItem(KEYS.CATALOG_IMPORT_RUNS, JSON.stringify([run, ...runs]));
  }

  static updateCatalogImportRun(id: string, updates: Partial<CatalogImportRun>): void {
    const runs = this.getCatalogImportRuns();
    const idx = runs.findIndex(r => r.id === id);
    if (idx !== -1) {
      runs[idx] = { ...runs[idx], ...updates };
      this.saveCatalogImportRuns(runs);
    }
  }

  static getCatalogExtractedOffers(): CatalogExtractedOffer[] {
    try {
      const data = safeGetItem(KEYS.CATALOG_EXTRACTED_OFFERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveCatalogExtractedOffers(offers: CatalogExtractedOffer[]): void {
    safeSetItem(KEYS.CATALOG_EXTRACTED_OFFERS, JSON.stringify(offers));
  }

  static addCatalogExtractedOffers(newOffers: CatalogExtractedOffer[]): void {
    const existing = this.getCatalogExtractedOffers();
    const map = new Map(existing.map(o => [o.id, o]));
    for (const off of newOffers) {
      map.set(off.id, off);
    }
    this.saveCatalogExtractedOffers(Array.from(map.values()));
  }

  static removeCatalogExtractedOffersByIds(offerIds: string[]): number {
    if (offerIds.length === 0) return 0;
    const ids = new Set(offerIds);
    const offers = this.getCatalogExtractedOffers();
    const remainingOffers = offers.filter(offer => !ids.has(offer.id));
    this.saveCatalogExtractedOffers(remainingOffers);
    return offers.length - remainingOffers.length;
  }

  static deleteUnpublishedCatalogExtractedOffers(offerIds: string[]): string[] {
    const ids = new Set(offerIds);
    const offers = this.getCatalogExtractedOffers();
    const deletedIds = offers
      .filter(offer => ids.has(offer.id) && String(offer.stagingStatus).toUpperCase() !== 'PUBLISHED')
      .map(offer => offer.id);
    this.removeCatalogExtractedOffersByIds(deletedIds);
    return deletedIds;
  }

  static updateCatalogExtractedOffer(id: string, updates: Partial<CatalogExtractedOffer>): CatalogExtractedOffer | null {
    const offers = this.getCatalogExtractedOffers();
    const idx = offers.findIndex(o => o.id === id);
    if (idx === -1) return null;
    offers[idx] = { ...offers[idx], ...updates, updatedAt: new Date().toISOString() };
    this.saveCatalogExtractedOffers(offers);
    return offers[idx];
  }

  static getCatalogImportErrors(): CatalogImportError[] {
    try {
      const data = safeGetItem(KEYS.CATALOG_IMPORT_ERRORS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static saveCatalogImportErrors(errors: CatalogImportError[]): void {
    safeSetItem(KEYS.CATALOG_IMPORT_ERRORS, JSON.stringify(errors));
  }

  static addCatalogImportError(error: CatalogImportError): void {
    const errors = this.getCatalogImportErrors();
    this.saveCatalogImportErrors([error, ...errors.slice(0, 199)]);
  }

  static getCatalogStats(): CatalogImporterStats {
    const sources = this.getCatalogSources();
    const docs = this.getCatalogDocuments();
    const offers = this.getCatalogExtractedOffers();
    const runs = this.getCatalogImportRuns();

    return {
      totalSources: sources.length,
      activeSources: sources.filter(s => s.status === 'active').length,
      totalDocuments: docs.length,
      totalExtractedOffers: offers.length,
      stagedPendingReview: offers.filter(o => o.stagingStatus === 'NEEDS_REVIEW').length,
      stagedValidated: offers.filter(o => o.stagingStatus === 'VALIDATED').length,
      totalPublished: offers.filter(o => o.stagingStatus === 'PUBLISHED').length,
      lastRunAt: runs[0]?.startedAt
    };
  }

  /**
   * Curăță datele demonstrative istorice din stocarea locală/memorie pentru a asigura doar date reale
   */
  static sanitizeDemoData(): void {
    try {
      const receiptsData = safeGetItem(KEYS.RECEIPTS);
      if (receiptsData) {
        const parsed: Receipt[] = JSON.parse(receiptsData);
        const cleaned = parsed.filter(r => r.id !== 'rec-kaufland-102' && r.id !== 'rec-lidl-089');
        if (cleaned.length !== parsed.length) {
          safeSetItem(KEYS.RECEIPTS, JSON.stringify(cleaned));
        }
      }

      const listsData = safeGetItem(KEYS.SHOPPING_LISTS);
      if (listsData) {
        const parsed: ShoppingList[] = JSON.parse(listsData);
        const cleaned = parsed.filter(l => l.id !== 'list-default' && l.id !== 'list-curatenie');
        if (cleaned.length !== parsed.length) {
          safeSetItem(KEYS.SHOPPING_LISTS, JSON.stringify(cleaned));
        }
      }

      const alertsData = safeGetItem(KEYS.PRICE_ALERTS);
      if (alertsData) {
        const parsed: PriceAlert[] = JSON.parse(alertsData);
        const cleaned = parsed.filter(a => a.id !== 'alt-1' && a.id !== 'alt-2');
        if (cleaned.length !== parsed.length) {
          safeSetItem(KEYS.PRICE_ALERTS, JSON.stringify(cleaned));
        }
      }

      const trackedData = safeGetItem(KEYS.TRACKED_PRODUCTS);
      if (trackedData) {
        const parsed: string[] = JSON.parse(trackedData);
        const demoTracked = ['prod-lapte-1', 'prod-piept-pui', 'prod-oua-m10', 'prod-ulei-fl-soarelui'];
        const isExactDemo = parsed.length === demoTracked.length && parsed.every(p => demoTracked.includes(p));
        if (isExactDemo) {
          safeSetItem(KEYS.TRACKED_PRODUCTS, JSON.stringify([]));
        }
      }
    } catch {}
  }

  // Reset & Export
  static resetAllData(): void {
    safeClear();
    this.saveShoppingLists([]);
    this.saveReceipts([]);
    this.saveUserProfile({
      name: 'Utilizator',
      email: '',
      city: 'București',
      preferredStores: [],
      monthlySavingsGoal: 0,
      notificationsEnabled: false,
      defaultTransportCostEstimate: 0,
      useLoyaltyCards: true
    });
    this.saveProductOffers(PRODUCT_OFFERS);
    this.saveDataSources(DATA_SOURCES);
    this.saveSyncRuns(INITIAL_SYNC_RUNS);
    this.saveMatchCandidates(INITIAL_MATCH_CANDIDATES);
    this.savePromotions([]);
    this.saveReceiptProducts([]);
    this.saveRetailerProducts([]);
    this.saveIndexingRuns([]);
    this.saveQualityAnomalies([]);
    this.saveRecollectionQueue([]);
    this.saveDailyQualityReports([]);
  }

  static exportDataAsJson(): string {
    const exportObject = {
      app: 'Coșul Meu',
      exportedAt: new Date().toISOString(),
      userProfile: this.getUserProfile(),
      shoppingLists: this.getShoppingLists(),
      receipts: this.getReceipts(),
      productOffers: this.getProductOffers(),
      priceObservations: this.getPriceObservations(),
      dataSources: this.getDataSources(),
      syncRuns: this.getSyncRuns(),
      matchCandidates: this.getMatchCandidates(),
      priceAlerts: this.getPriceAlerts(),
      trackedProducts: this.getTrackedProducts()
    };
    return JSON.stringify(exportObject, null, 2);
  }
}
