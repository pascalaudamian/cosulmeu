import { ShoppingListItem, Store, ProductOffer, BasketStoreComparison, Product } from '../types.js';
import { STORES } from '../data/mockData.js';
import { StorageService } from './StorageService.js';

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
   * Match a shopping list item with a catalog product
   */
  static findProductForListItem(item: ShoppingListItem, allProducts: Product[]): Product | undefined {
    if (item.productId) {
      const match = allProducts.find(p => p.id === item.productId);
      if (match) return match;
    }
    if (item.barcode) {
      const barcodeMatch = allProducts.find(p => p.barcode && p.barcode === item.barcode);
      if (barcodeMatch) return barcodeMatch;
    }
    const cleanItemName = item.name.toLowerCase().trim();
    return allProducts.find(p => {
      const pName = p.name.toLowerCase();
      return pName.includes(cleanItemName) || cleanItemName.includes(pName);
    });
  }

  /**
   * Check if an offer is currently valid (non-expired)
   */
  static isOfferValid(offer: ProductOffer): boolean {
    if (offer.verificationStatus === 'expired') return false;
    if (offer.validUntil) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (offer.validUntil < todayStr) return false;
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
    const allStores = customStores ?? STORES;
    const userProfile = StorageService.getUserProfile();

    const normalizeStoreKey = (val: string) =>
      (val || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();

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
          // Custom unlinked item: estimate using item.referencePrice or item.estimatedPrice
          const estPrice = (item.estimatedPrice || item.referencePrice || 10) * item.quantity;
          missingItems.push(item);
          estimatedMissingTotal += estPrice;
          continue;
        }

        // Look for valid, non-expired offer from this store
        const candidateOffers = allOffers.filter(o => {
          if (o.productId !== product.id || !this.isOfferValid(o)) return false;
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
          // Missing in this store: calculate transparent estimate without treating as 0
          const estPrice = (product.baseReferencePrice || item.referencePrice || item.estimatedPrice || 10) * item.quantity;
          missingItems.push(item);
          estimatedMissingTotal += estPrice;
        }
      }

      const totalItemsCount = items.length;
      const completenessPercentage =
        totalItemsCount > 0 ? Math.round((availableItems.length / totalItemsCount) * 100) : 0;

      const grandTotal = Math.round((availableTotal + estimatedMissingTotal) * 100) / 100;

      return {
        store,
        availableItems,
        missingItems,
        availableTotal: Math.round(availableTotal * 100) / 100,
        estimatedMissingTotal: Math.round(estimatedMissingTotal * 100) / 100,
        grandTotal,
        savingsVsWorst: 0,
        isWinner: false,
        completenessPercentage,
        confidenceLevel:
          completenessPercentage >= 80 ? 'high' : completenessPercentage >= 50 ? 'medium' : 'low',
        lastUpdated: 'Astăzi, ' + new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' }),
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

    // Sort stores by grandTotal ascending, favoring higher completeness if totals are close
    comparisons.sort((a, b) => {
      if (Math.abs(a.completenessPercentage - b.completenessPercentage) > 30) {
        return b.completenessPercentage - a.completenessPercentage;
      }
      return a.grandTotal - b.grandTotal;
    });

    // Calculate potential savings vs worst comparable store
    const highestTotal = Math.max(...comparisons.map(c => c.grandTotal));
    comparisons.forEach((comp, idx) => {
      if (idx === 0) comp.isWinner = true;
      comp.savingsVsWorst = Math.max(0, Math.round((highestTotal - comp.grandTotal) * 100) / 100);
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

      const obsDate = offer.observationDate || offer.lastChecked.slice(0, 10);
      if (!latestVerifiedDate || obsDate > latestVerifiedDate) {
        latestVerifiedDate = obsDate;
      }

      // Calcul prospețime
      const now = new Date();
      const obsTime = new Date(obsDate).getTime();
      const ageHours = Math.max(0, (now.getTime() - obsTime) / (3600 * 1000));
      let freshness: 'very_recent' | 'recent' | 'stale' | 'expired' = 'very_recent';
      let freshnessLabel = 'Foarte recent';

      if (ageHours <= 24) {
        freshness = 'very_recent';
        freshnessLabel = 'Foarte recent';
      } else if (ageHours <= 48) {
        freshness = 'recent';
        freshnessLabel = 'Recent';
      } else if (ageHours <= 72) {
        freshness = 'stale';
        freshnessLabel = 'Vechi';
      } else {
        freshness = 'expired';
        freshnessLabel = 'Neverificat / expirat';
      }

      if (freshness === 'very_recent') overallFreshness = 'very_recent';
      else if (freshness === 'recent' && overallFreshness !== 'very_recent') overallFreshness = 'recent';
      else if (freshness === 'stale' && overallFreshness === 'expired') overallFreshness = 'stale';

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
        freshnessStatus: freshness,
        freshnessLabelRo: freshnessLabel,
        qualityScore: offer.qualityScore || 85,
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
