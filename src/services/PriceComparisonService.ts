import { ShoppingListItem, Store, ProductOffer, BasketStoreComparison, Product } from '../types.js';
import { STORES } from '../data/mockData.js';
import { StorageService } from './StorageService.js';
import { BasketOptimizerService } from './BasketOptimizerService.js';
import { PriceQualityClassifier } from './PriceQualityClassifier.js';

export class PriceComparisonService {
  /**
   * Format a numerical value into Romanian Lei display: "14,50 lei"
   */
  static formatRon(amount: number): string {
    if (isNaN(amount) || amount === null || amount === undefined) {
      return '0,00 lei';
    }
    return (
      new Intl.NumberFormat('ro-RO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount) + ' lei'
    );
  }

  /**
   * Format quantity with Romanian decimals and unit
   */
  static formatQuantity(quantity: number, unit: string): string {
    const formattedNum = new Intl.NumberFormat('ro-RO', {
      maximumFractionDigits: 2
    }).format(quantity);
    return `${formattedNum} ${unit}`;
  }

  /**
   * Match a shopping list item with a catalog product using strict confidence rules
   */
  static findProductForListItem(item: ShoppingListItem, allProducts: Product[]): Product | undefined {
    const res = BasketOptimizerService.matchItemToProduct(item, allProducts);
    return res.status === 'matched' ? res.product : undefined;
  }

  /**
   * Check if an offer is currently valid (non-expired, non-anomalous, non-demo, non-estimated)
   */
  static isOfferValid(offer: ProductOffer, product?: Product): boolean {
    if (!offer || !Number.isFinite(offer.price) || offer.price <= 0) return false;
    if (['expired', 'isolated', 'rejected', 'demo'].includes(offer.verificationStatus)) return false;
    if (offer.source === 'demo' || offer.source === 'estimated') return false;
    if (offer.isFlaggedAnomaly) return false;
    if (offer.validUntil) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (offer.validUntil < todayStr) return false;
    }
    if (product) {
      return PriceQualityClassifier.classifyOffer(offer, { product }).isUsableForComparison;
    }
    return true;
  }

  /**
   * Find product offers across all stores for a specific item, filtering out expired offers
   */
  static getOffersForProduct(
    productId: string,
    includeExpired = false,
    customOffers?: ProductOffer[]
  ): ProductOffer[] {
    const allOffers = customOffers ?? StorageService.getProductOffers();
    return allOffers.filter(
      o => o.productId === productId && (includeExpired || this.isOfferValid(o))
    );
  }

  /**
   * Calculate single item cost at a specific store with unit normalization and loyalty card check
   */
  static calculateItemCostAtStore(
    item: ShoppingListItem,
    product: Product,
    offer: ProductOffer,
    applyLoyaltyDiscount = true
  ): { price: number; unitPriceStr: string; effectivePrice: number; loyaltyApplied: boolean } {
    let effectiveOfferPrice = offer.price;
    let loyaltyApplied = false;

    // Check loyalty card discount
    if (offer.loyaltyCardRequired) {
      if (!applyLoyaltyDiscount) {
        // If user does not have loyalty card, fallback to original non-promo price if known
        effectiveOfferPrice = offer.originalPrice || offer.price;
      } else {
        loyaltyApplied = true;
      }
    }

    const effectiveUnitPrice =
      offer.loyaltyCardRequired && !applyLoyaltyDiscount && offer.originalPrice && offer.price > 0
        ? Math.round(((offer.originalPrice / offer.price) * offer.unitPrice) * 100) / 100
        : offer.unitPrice;

    const itemUnit = (item.unit || 'buc').toLowerCase();
    const normUnit = (product.normalizedUnit || 'buc').toLowerCase();

    let calculatedCost = 0;
    // Normalized cost calculation
    if (itemUnit === 'g' && normUnit === 'kg') {
      calculatedCost = (item.quantity / 1000) * effectiveUnitPrice;
    } else if (itemUnit === 'ml' && normUnit === 'l') {
      calculatedCost = (item.quantity / 1000) * effectiveUnitPrice;
    } else if (itemUnit === 'kg' && normUnit === 'kg') {
      calculatedCost = item.quantity * effectiveUnitPrice;
    } else if (itemUnit === 'l' && normUnit === 'l') {
      calculatedCost = item.quantity * effectiveUnitPrice;
    } else {
      // Per package or item count
      calculatedCost = item.quantity * effectiveOfferPrice;
    }

    const unitPriceStr = `${this.formatRon(effectiveUnitPrice)} / ${normUnit}`;
    return {
      price: Math.round(calculatedCost * 100) / 100,
      unitPriceStr,
      effectivePrice: effectiveOfferPrice,
      loyaltyApplied
    };
  }

  /**
   * Compare full shopping basket across all stores with loyalty card distinction & expired filtering
   */
  static compareBasketAcrossStores(
    items: ShoppingListItem[],
    options?: { useLoyaltyCards?: boolean },
    customProducts?: Product[],
    customOffers?: ProductOffer[],
    customStores?: Store[]
  ): BasketStoreComparison[] {
    if (!items || items.length === 0) return [];

    const allProducts = customProducts ?? StorageService.getAllProducts();
    const allOffers = customOffers ?? StorageService.getProductOffers();
    const rawStores = customStores ?? STORES;
    const userProfile = StorageService.getUserProfile();

    const normalizeStoreKey = (val: string) =>
      (val || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();

    const canonicalStoresMap = new Map<string, Store>();
    for (const st of rawStores) {
      if (!st?.id || st.id === 'validation-only-retailer' || st.slug === 'validation-only-retailer') {
        continue;
      }
      const key = normalizeStoreKey(st.slug || st.id) || st.id;
      const existing = canonicalStoresMap.get(key);
      if (!existing || (existing.id !== key && st.id === key)) {
        canonicalStoresMap.set(key, st);
      }
    }
    const allStores = Array.from(canonicalStoresMap.values());

    const useLoyaltyCards =
      options?.useLoyaltyCards !== undefined
        ? options.useLoyaltyCards
        : userProfile.useLoyaltyCards ?? true;

    // Map each item to catalog product
    const itemsWithProduct = items.map(item => ({
      item,
      product: this.findProductForListItem(item, allProducts)
    }));

    // For each store, gather matching non-expired offers and calculate totals
    const comparisons: BasketStoreComparison[] = allStores.map(store => {
      const storeKey = normalizeStoreKey(store.slug || store.id);
      const storeIdKey = normalizeStoreKey(store.id);
      const availableItems: BasketStoreComparison['availableItems'] = [];
      const missingItems: ShoppingListItem[] = [];
      let availableTotal = 0;
      let estimatedMissingTotal = 0;
      let loyaltySavings = 0;
      let hasLoyaltyDiscount = false;

      for (const { item, product } of itemsWithProduct) {
        if (!product) {
          missingItems.push(item);
          continue;
        }

        // Look for valid, non-expired offer from this store
        const candidateOffers = allOffers.filter(o => {
          if (o.productId !== product.id || !this.isOfferValid(o, product)) return false;
          const offStoreKey = normalizeStoreKey(o.storeId);
          return (
            o.storeId === store.id ||
            offStoreKey === storeIdKey ||
            offStoreKey === storeKey
          );
        });

        const offer = candidateOffers[0];

        if (offer) {
          const { price, unitPriceStr, loyaltyApplied } = this.calculateItemCostAtStore(
            item,
            product,
            offer,
            useLoyaltyCards
          );

          if (loyaltyApplied && offer.originalPrice) {
            hasLoyaltyDiscount = true;
            loyaltySavings += Math.max(0, (offer.originalPrice - offer.price) * item.quantity);
          }

          availableItems.push({
            item,
            offer,
            calculatedPrice: price,
            unitPriceString: unitPriceStr,
            isLowest: false,
            isLoyaltyPrice: offer.loyaltyCardRequired,
            loyaltyCardName: offer.loyaltyCardName,
            isExpired: false,
            sourceType: offer.source,
            verificationStatus: offer.verificationStatus
          });
          availableTotal += price;
        } else {
          // Nu inventăm prețuri fictive (fără fallback 10 RON)
          missingItems.push(item);
        }
      }

      const totalItemsCount = items.length;
      const completenessPercentage =
        totalItemsCount > 0 ? Math.round((availableItems.length / totalItemsCount) * 100) : 0;

      const grandTotal = Math.round(availableTotal * 100) / 100;
      const offerDates = availableItems
        .map(ai => ai.offer.lastVerifiedAt || ai.offer.observationDate || ai.offer.lastChecked.slice(0, 10))
        .filter(Boolean)
        .sort();
      const latestObsDate = offerDates.length > 0 ? offerDates[offerDates.length - 1].slice(0, 10) : null;

      return {
        store,
        availableItems,
        missingItems,
        availableTotal: Math.round(availableTotal * 100) / 100,
        estimatedMissingTotal: 0,
        grandTotal,
        savingsVsWorst: 0,
        isWinner: false,
        completenessPercentage,
        confidenceLevel:
          completenessPercentage >= 80 ? 'high' : completenessPercentage >= 50 ? 'medium' : 'low',
        lastUpdated: latestObsDate
          ? new Date(latestObsDate).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'Fără oferte verificate',
        hasLoyaltyDiscount,
        loyaltySavings: Math.round(loyaltySavings * 100) / 100
      };
    });

    // Mark lowest price on each product across all stores
    for (const { item } of itemsWithProduct) {
      let minPrice = Infinity;
      let bestStoreId = '';

      for (const comp of comparisons) {
        const found = comp.availableItems.find(ai => ai.item.id === item.id);
        if (found && found.calculatedPrice < minPrice) {
          minPrice = found.calculatedPrice;
          bestStoreId = comp.store.id;
        }
      }

      if (bestStoreId) {
        for (const comp of comparisons) {
          const found = comp.availableItems.find(ai => ai.item.id === item.id);
          if (found && comp.store.id === bestStoreId) {
            found.isLowest = true;
          }
        }
      }
    }

    // Rank stores by highest coverage first, then lowest real product total
    comparisons.sort((a, b) => {
      if (b.availableItems.length !== a.availableItems.length) {
        return b.availableItems.length - a.availableItems.length;
      }
      return a.grandTotal - b.grandTotal;
    });

    // Calculate potential savings vs worst comparable store (only with equal or valid coverage)
    const winner = comparisons[0];
    const comparableStores = winner
      ? comparisons.filter(c => c.availableItems.length === winner.availableItems.length)
      : [];
    const highestTotal = comparableStores.length > 0
      ? Math.max(...comparableStores.map(c => c.grandTotal))
      : 0;
    comparisons.forEach((comp, idx) => {
      if (idx === 0) comp.isWinner = true;
      comp.savingsVsWorst =
        comp.availableItems.length === winner?.availableItems.length && highestTotal > comp.grandTotal
          ? Math.max(0, Math.round((highestTotal - comp.grandTotal) * 100) / 100)
          : 0;
    });

    return comparisons;
  }

  static getPotentialSavingsDetailsForList(
    items: ShoppingListItem[],
    customProducts: Product[],
    customOffers: ProductOffer[],
    customStores: Store[],
    useLoyaltyCards = true
  ): Array<{
    item: ShoppingListItem;
    product?: Product;
    lowestOffer?: ProductOffer;
    highestOffer?: ProductOffer;
    lowestStoreName?: string;
    highestStoreName?: string;
    cheapestPrice?: number;
    mostExpensivePrice?: number;
    savings: number;
    loyaltyApplied: boolean;
  }> {
    const productById = new Map(customProducts.map(product => [product.id, product]));
    const storeById = new Map(customStores.map(store => [store.id, store]));

    return items.map(item => {
      const product = item.productId ? productById.get(item.productId) : undefined;
      if (!product) return { item, savings: 0, loyaltyApplied: false };

      const latestOfferByStore = new Map<string, ProductOffer>();
      for (const offer of customOffers) {
        if (
          offer.productId === product.id &&
          offer.verificationStatus === 'verified' &&
          this.isOfferValid(offer) &&
          !latestOfferByStore.has(offer.storeId)
        ) {
          latestOfferByStore.set(offer.storeId, offer);
        }
      }

      const prices = Array.from(latestOfferByStore.values()).map(offer => ({
        offer,
        ...this.calculateItemCostAtStore(item, product, offer, useLoyaltyCards)
      })).sort((left, right) => left.price - right.price);
      if (prices.length === 0) return { item, product, savings: 0, loyaltyApplied: false };

      const lowest = prices[0];
      const highest = prices[prices.length - 1];
      return {
        item,
        product,
        lowestOffer: lowest.offer,
        highestOffer: highest.offer,
        lowestStoreName: storeById.get(lowest.offer.storeId)?.name || lowest.offer.storeId,
        highestStoreName: storeById.get(highest.offer.storeId)?.name || highest.offer.storeId,
        cheapestPrice: lowest.price,
        mostExpensivePrice: highest.price,
        savings: Math.max(0, Math.round((highest.price - lowest.price) * 100) / 100),
        loyaltyApplied: prices.some(price => price.loyaltyApplied)
      };
    });
  }

  /**
   * Calculate potential savings summary for active list
   */
  static getPotentialSavingsForList(
    items: ShoppingListItem[],
    options?: { useLoyaltyCards?: boolean },
    customProducts?: Product[],
    customOffers?: ProductOffer[],
    customStores?: Store[]
  ): {
    cheapestTotal: number;
    mostExpensiveTotal: number;
    maxSavings: number;
    bestStoreName: string;
    hasLoyaltyDiscount: boolean;
  } {
    if (customProducts !== undefined && customOffers !== undefined && customStores !== undefined) {
      const details = this.getPotentialSavingsDetailsForList(
        items,
        customProducts,
        customOffers,
        customStores,
        options?.useLoyaltyCards ?? true
      );
      const pricedItems = details.filter(detail => detail.cheapestPrice !== undefined);
      const cheapestTotal = pricedItems.reduce((sum, detail) => sum + (detail.cheapestPrice || 0), 0);
      const mostExpensiveTotal = pricedItems.reduce((sum, detail) => sum + (detail.mostExpensivePrice || 0), 0);
      const bestStoreName = pricedItems.find(detail => detail.lowestStoreName)?.lowestStoreName || '-';
      return {
        cheapestTotal: Math.round(cheapestTotal * 100) / 100,
        mostExpensiveTotal: Math.round(mostExpensiveTotal * 100) / 100,
        maxSavings: Math.round(details.reduce((sum, detail) => sum + detail.savings, 0) * 100) / 100,
        bestStoreName,
        hasLoyaltyDiscount: details.some(detail => detail.loyaltyApplied)
      };
    }

    const comparisons = this.compareBasketAcrossStores(items, options, customProducts, customOffers, customStores);
    if (comparisons.length === 0) {
      return {
        cheapestTotal: 0,
        mostExpensiveTotal: 0,
        maxSavings: 0,
        bestStoreName: '-',
        hasLoyaltyDiscount: false
      };
    }

    const winner = comparisons[0];
    const highestTotal = Math.max(...comparisons.map(c => c.grandTotal));
    const maxSavings = Math.max(0, Math.round((highestTotal - winner.grandTotal) * 100) / 100);

    return {
      cheapestTotal: winner.grandTotal,
      mostExpensiveTotal: highestTotal,
      maxSavings,
      bestStoreName: winner.store.name,
      hasLoyaltyDiscount: winner.hasLoyaltyDiscount
    };
  }

  /**
   * Preluare comparație multi-retailer detaliată pentru un singur produs
   */
  static getProductComparisonDetails(
    productId: string,
    providedProduct?: Product,
    providedOffers?: ProductOffer[],
    providedStores?: Store[]
  ): {
    product: Product;
    offers: Array<{
      store: Store;
      offer: ProductOffer;
      standardPrice: number;
      loyaltyPrice?: number;
      loyaltyCardName?: string;
      isPromo: boolean;
      promoDetails?: string;
      validUntil?: string;
      availability: 'in_stock' | 'confirmed_on_shelf' | 'unknown';
      unitPrice: number;
      unitPriceMeasure: string;
      lastVerifiedAt: string;
      freshnessStatus: 'very_recent' | 'recent' | 'stale' | 'expired';
      freshnessLabelRo: string;
      qualityScore: number;
      directUrl?: string;
      isLowestPrice: boolean;
    }>;
    lowestPrice: number;
    lowestStoreName: string;
    highestPrice: number;
    maxSavingsAmount: number;
    maxSavingsPercentage: number;
    totalStoresCount: number;
    lastCheckedDate: string;
    overallFreshnessStatus: 'very_recent' | 'recent' | 'stale' | 'expired';
  } | null {
    const product = providedProduct || StorageService.getAllProducts().find(p => p.id === productId);
    if (!product) return null;

    const allStores: Store[] = providedStores && providedStores.length > 0 ? providedStores : STORES;
    const storeMap = new Map<string, Store>();
    for (const s of allStores) {
      storeMap.set(s.id, s);
      storeMap.set(`store-${s.id}`, s);
    }

    // Oferte valide neexpirate
    const rawOffers = providedOffers
      ? providedOffers.filter(o => o.productId === productId && this.isOfferValid(o))
      : this.getOffersForProduct(productId, false);

    if (rawOffers.length === 0) {
      return {
        product,
        offers: [],
        lowestPrice: 0,
        lowestStoreName: '-',
        highestPrice: 0,
        maxSavingsAmount: 0,
        maxSavingsPercentage: 0,
        totalStoresCount: 0,
        lastCheckedDate: '-',
        overallFreshnessStatus: 'expired'
      };
    }

    // Sortare crescătoare după preț
    const sortedOffers = [...rawOffers].sort((a, b) => a.price - b.price);
    const minPrice = sortedOffers[0].price;
    const maxPrice = Math.max(...sortedOffers.map(o => o.price));
    const savingsAmount = Math.max(0, Math.round((maxPrice - minPrice) * 100) / 100);
    const savingsPct = maxPrice > 0 ? Math.round((savingsAmount / maxPrice) * 100) : 0;

    let overallFreshness: 'very_recent' | 'recent' | 'stale' | 'expired' = 'expired';
    let latestVerifiedDate = '';

    const detailedOffers = sortedOffers.map(offer => {
      const store = storeMap.get(offer.storeId) || {
        id: offer.storeId,
        name: offer.storeId.toUpperCase(),
        slug: offer.storeId,
        chain: offer.storeId,
        brandColor: 'bg-slate-700',
        accentColor: 'text-slate-700',
        type: 'supermarket' as const,
        rating: 4.0,
        locationsCount: 100,
        sampleAddress: 'România'
      };

      const quality = PriceQualityClassifier.classifyOffer(offer, { product });
      const obsDate = offer.observationDate || offer.lastChecked.slice(0, 10);
      if (!latestVerifiedDate || obsDate > latestVerifiedDate) {
        latestVerifiedDate = obsDate;
      }

      const mappedFreshness: 'very_recent' | 'recent' | 'stale' | 'expired' =
        quality.status === 'VERIFIED_RECENTLY'
          ? 'very_recent'
          : quality.status === 'VERIFIED'
            ? 'recent'
            : quality.status === 'STALE'
              ? 'stale'
              : 'expired';

      if (mappedFreshness === 'very_recent') overallFreshness = 'very_recent';
      else if (mappedFreshness === 'recent' && overallFreshness !== 'very_recent') overallFreshness = 'recent';
      else if (mappedFreshness === 'stale' && overallFreshness === 'expired') overallFreshness = 'stale';

      return {
        store,
        offer,
        standardPrice: offer.loyaltyCardRequired && offer.originalPrice ? offer.originalPrice : offer.price,
        loyaltyPrice: offer.loyaltyCardRequired ? offer.price : undefined,
        loyaltyCardName: offer.loyaltyCardName,
        isPromo: Boolean(offer.isPromo),
        promoDetails: offer.promoDetails,
        validUntil: offer.validUntil,
        availability: 'confirmed_on_shelf' as const,
        unitPrice: offer.unitPrice,
        unitPriceMeasure: offer.unitPriceMeasure,
        lastVerifiedAt: obsDate,
        freshnessStatus: mappedFreshness,
        freshnessLabelRo: quality.labelRo,
        qualityScore: quality.score,
        qualityAssessment: quality,
        directUrl: undefined,
        isLowestPrice: offer.price === minPrice
      };
    });

    const lowestStore = detailedOffers[0]?.store.name || '-';

    return {
      product,
      offers: detailedOffers,
      lowestPrice: minPrice,
      lowestStoreName: lowestStore,
      highestPrice: maxPrice,
      maxSavingsAmount: savingsAmount,
      maxSavingsPercentage: savingsPct,
      totalStoresCount: detailedOffers.length,
      lastCheckedDate: latestVerifiedDate || new Date().toISOString().split('T')[0],
      overallFreshnessStatus: overallFreshness
    };
  }
}
