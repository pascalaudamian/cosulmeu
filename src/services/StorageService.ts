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
  ProductMatchCandidate
} from '../types';
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
} from '../indexing/types';
import {
  INITIAL_SHOPPING_LISTS,
  SAMPLE_RECEIPTS,
  INITIAL_USER_PROFILE,
  PRODUCTS,
  PRODUCT_OFFERS,
  PRICE_OBSERVATIONS,
  DATA_SOURCES,
  INITIAL_SYNC_RUNS,
  INITIAL_MATCH_CANDIDATES
} from '../data/mockData';

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
  QUALITY_CONFIG: 'cosul_meu_quality_config_v1'
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
      const data = safeGetItem(KEYS.SHOPPING_LISTS);
      if (!data) {
        this.saveShoppingLists(INITIAL_SHOPPING_LISTS);
        return INITIAL_SHOPPING_LISTS;
      }
      return JSON.parse(data);
    } catch {
      return INITIAL_SHOPPING_LISTS;
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
      return lists[0]?.id || 'list-default';
    } catch {
      return 'list-default';
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
      const data = safeGetItem(KEYS.RECEIPTS);
      if (!data) {
        this.saveReceipts(SAMPLE_RECEIPTS);
        return SAMPLE_RECEIPTS;
      }
      return JSON.parse(data);
    } catch {
      return SAMPLE_RECEIPTS;
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
        this.saveUserProfile({ ...INITIAL_USER_PROFILE, useLoyaltyCards: true });
        return { ...INITIAL_USER_PROFILE, useLoyaltyCards: true };
      }
      const parsed = JSON.parse(data);
      if (parsed.useLoyaltyCards === undefined) parsed.useLoyaltyCards = true;
      return parsed;
    } catch {
      return { ...INITIAL_USER_PROFILE, useLoyaltyCards: true };
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
      const data = safeGetItem(KEYS.PRICE_ALERTS);
      if (!data) {
        const initialAlerts: PriceAlert[] = [
          {
            id: 'alt-1',
            productId: 'prod-lapte-1',
            productName: 'Lapte proaspăt 1.5% grăsime 1L (Napolact)',
            targetPrice: 6.00,
            currentLowestPrice: 6.29,
            lowestStoreId: 'kaufland',
            createdAt: '2026-10-20',
            isActive: true
          },
          {
            id: 'alt-2',
            productId: 'prod-piept-pui',
            productName: 'Piept de pui dezosat fără piele 1kg',
            targetPrice: 25.00,
            currentLowestPrice: 26.49,
            lowestStoreId: 'penny',
            createdAt: '2026-10-22',
            isActive: true
          }
        ];
        this.savePriceAlerts(initialAlerts);
        return initialAlerts;
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
      const data = safeGetItem(KEYS.TRACKED_PRODUCTS);
      if (!data) {
        const initial = ['prod-lapte-1', 'prod-piept-pui', 'prod-oua-m10', 'prod-ulei-fl-soarelui'];
        safeSetItem(KEYS.TRACKED_PRODUCTS, JSON.stringify(initial));
        return initial;
      }
      return JSON.parse(data);
    } catch {
      return ['prod-lapte-1', 'prod-piept-pui'];
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

  static getAllProducts(): Product[] {
    const custom = this.getCustomProducts();
    return [...PRODUCTS, ...custom];
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
    // Avoid exact duplicate entries (same product, store, price and date)
    const existingSignatures = new Set(
      current.map(obs => `${obs.productId}_${obs.storeId}_${obs.date}_${obs.price}`)
    );

    const nonDuplicates = newObs.filter(
      obs => !existingSignatures.has(`${obs.productId}_${obs.storeId}_${obs.date}_${obs.price}`)
    );

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

  // Reset & Export
  static resetAllData(): void {
    safeClear();
    this.saveShoppingLists(INITIAL_SHOPPING_LISTS);
    this.saveReceipts(SAMPLE_RECEIPTS);
    this.saveUserProfile({ ...INITIAL_USER_PROFILE, useLoyaltyCards: true });
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
