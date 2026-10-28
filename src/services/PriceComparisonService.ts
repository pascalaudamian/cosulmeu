import { ShoppingListItem, Store, ProductOffer, BasketStoreComparison, Product } from '../types';
import { STORES } from '../data/mockData';
import { StorageService } from './StorageService';

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
  static getOffersForProduct(productId: string, includeExpired = false): ProductOffer[] {
    const allOffers = StorageService.getProductOffers();
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

    let calculatedCost = 0;
    // Normalized cost calculation
    if (item.unit === 'g' && product.normalizedUnit === 'kg') {
      calculatedCost = (item.quantity / 1000) * effectiveUnitPrice;
    } else if (item.unit === 'ml' && product.normalizedUnit === 'l') {
      calculatedCost = (item.quantity / 1000) * effectiveUnitPrice;
    } else if (item.unit === 'kg' && product.normalizedUnit === 'kg') {
      calculatedCost = item.quantity * effectiveUnitPrice;
    } else if (item.unit === 'l' && product.normalizedUnit === 'l') {
      calculatedCost = item.quantity * effectiveUnitPrice;
    } else {
      // Per package or item count
      calculatedCost = item.quantity * effectiveOfferPrice;
    }

    const unitPriceStr = `${this.formatRon(effectiveUnitPrice)} / ${product.normalizedUnit}`;
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
    options?: { useLoyaltyCards?: boolean }
  ): BasketStoreComparison[] {
    if (!items || items.length === 0) return [];

    const allProducts = StorageService.getAllProducts();
    const allOffers = StorageService.getProductOffers();
    const userProfile = StorageService.getUserProfile();

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
    const comparisons: BasketStoreComparison[] = STORES.map(store => {
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
        const candidateOffers = allOffers.filter(
          o => o.productId === product.id && o.storeId === store.id && this.isOfferValid(o)
        );

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
          const estPrice = (product.baseReferencePrice || item.referencePrice || 10) * item.quantity;
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

  /**
   * Calculate potential savings summary for active list
   */
  static getPotentialSavingsForList(
    items: ShoppingListItem[],
    options?: { useLoyaltyCards?: boolean }
  ): {
    cheapestTotal: number;
    mostExpensiveTotal: number;
    maxSavings: number;
    bestStoreName: string;
    hasLoyaltyDiscount: boolean;
  } {
    const comparisons = this.compareBasketAcrossStores(items, options);
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
}
