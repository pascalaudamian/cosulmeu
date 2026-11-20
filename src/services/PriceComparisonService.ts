import {
  ShoppingListItem,
  Store,
  ProductOffer,
  BasketStoreComparison,
  BasketSavingsSummary,
  Product,
  UnitType
} from '../types.js';
import { STORES } from '../data/mockData.js';
import { StorageService } from './StorageService.js';
import { BasketOptimizerService } from './BasketOptimizerService.js';
import { PriceQualityClassifier } from './PriceQualityClassifier.js';

export interface PriceComparisonOptions {
  useLoyaltyCards?: boolean;
  useCoupons?: boolean;
  region?: string;
  includeStaleOffers?: boolean;
  maxOfferAgeDays?: number;
  now?: Date;
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeUnitToken = (unit?: string): UnitType => {
  const clean = (unit || 'buc').toLowerCase().trim();
  if (clean === 'kg' || clean === 'g' || clean === 'l' || clean === 'ml' || clean === 'pachet' || clean === 'buc') {
    return clean;
  }
  return 'buc';
};

const getUnitDimension = (unit: UnitType): 'mass' | 'volume' | 'count' => {
  if (unit === 'g' || unit === 'kg') return 'mass';
  if (unit === 'ml' || unit === 'l') return 'volume';
  return 'count';
};

const toBaseAmount = (quantity: number, unit: UnitType): number => {
  if (unit === 'kg' || unit === 'l') return quantity * 1000;
  return quantity;
};

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
   * Check if an offer is currently valid via centralized PriceQualityClassifier
   * (non-expired, sourced, non-anomalous, non-demo, non-estimated, context-aware).
   */
  static isOfferValid(
    offer: ProductOffer,
    product?: Product,
    options?: {
      region?: string;
      useLoyaltyCards?: boolean;
      useCoupons?: boolean;
      includeStaleOffers?: boolean;
      maxOfferAgeDays?: number;
      requestedQuantity?: number;
      now?: Date;
    }
  ): boolean {
    if (!offer || !Number.isFinite(offer.price) || offer.price <= 0) return false;
    if (['expired', 'isolated', 'rejected', 'demo'].includes(offer.verificationStatus)) return false;
    if (offer.source === 'demo' || offer.source === 'estimated') return false;
    if (offer.isFlaggedAnomaly) return false;

    const classifierConfig = options?.maxOfferAgeDays
      ? { staleMaxHours: Math.max(24, options.maxOfferAgeDays * 24) }
      : undefined;

    const contextResult = PriceQualityClassifier.validateOfferForContext(offer, {
      product,
      region: options?.region,
      useLoyaltyCards: options?.useLoyaltyCards ?? true,
      useCoupons: options?.useCoupons ?? false,
      includeStaleOffers: options?.includeStaleOffers ?? true,
      requestedQuantity: options?.requestedQuantity,
      config: classifierConfig,
      now: options?.now
    });

    return contextResult.valid;
  }

  /**
   * Find product offers across all stores for a specific item, filtering out expired/invalid offers
   */
  static getOffersForProduct(
    productId: string,
    includeExpired = false,
    customOffers?: ProductOffer[],
    product?: Product
  ): ProductOffer[] {
    const allOffers = customOffers ?? StorageService.getProductOffers();
    return allOffers.filter(
      o => o.productId === productId && (includeExpired || this.isOfferValid(o, product))
    );
  }

  /**
   * Calculate single item cost at a specific store using the canonical BasketOptimizerService
   * unit normalization, indivisible package rounding, and loyalty/coupon/min-quantity rules.
   */
  static calculateItemCostAtStore(
    item: ShoppingListItem,
    product: Product,
    offer: ProductOffer,
    applyLoyaltyDiscount = true,
    useCoupons = false
  ): {
    price: number;
    unitPriceStr: string;
    effectivePrice: number;
    loyaltyApplied: boolean;
    compatible: boolean;
    packagesCount: number;
    surplusQuantity: number;
    reasonRo?: string;
  } {
    const cost = BasketOptimizerService.computeNormalizedItemCost({
      quantity: item.quantity,
      requestedUnit: normalizeUnitToken(item.unit || product.defaultUnit),
      product,
      offer,
      useLoyaltyCards: applyLoyaltyDiscount,
      useCoupons
    });

    if (!cost.compatible) {
      return {
        price: 0,
        unitPriceStr: '-',
        effectivePrice: 0,
        loyaltyApplied: false,
        compatible: false,
        packagesCount: 0,
        surplusQuantity: 0,
        reasonRo: cost.reasonRo
      };
    }

    return {
      price: cost.calculatedPrice,
      unitPriceStr: cost.unitPriceDisplay,
      effectivePrice: cost.effectiveUnitPrice,
      loyaltyApplied: cost.loyaltyApplied,
      compatible: true,
      packagesCount: cost.packagesCount,
      surplusQuantity: cost.surplusQuantity
    };
  }

  /**
   * Compare full shopping basket across all canonical stores:
   * - Separates complete baskets (100% coverage) from partial coverage and stores without valid offers
   * - Only sets isWinner / isCheapestCompleteBasket on a store with 100% basket coverage
   * - Never computes savings across stores with different coverage or different covered product subsets
   * - Never displays 0,00 lei / fabricated prices for missing items
   */
  static compareBasketAcrossStores(
    items: ShoppingListItem[],
    options?: PriceComparisonOptions,
    customProducts?: Product[],
    customOffers?: ProductOffer[],
    customStores?: Store[]
  ): BasketStoreComparison[] {
    if (!items || items.length === 0) return [];

    const now = options?.now || new Date();
    const allProducts = customProducts ?? StorageService.getAllProducts();
    const allOffers = customOffers ?? StorageService.getProductOffers();
    const rawStores = customStores ?? STORES;
    const userProfile = StorageService.getUserProfile();

    const allStores = BasketOptimizerService.canonicalizeStores(rawStores);
    const useLoyaltyCards =
      options?.useLoyaltyCards !== undefined
        ? options.useLoyaltyCards
        : userProfile.useLoyaltyCards ?? true;
    const useCoupons = options?.useCoupons ?? false;
    const includeStaleOffers = options?.includeStaleOffers ?? true;
    const maxOfferAgeDays = options?.maxOfferAgeDays;
    const region = options?.region;

    // Match each item to catalog product & aggregate duplicate quantities for minQuantityForPromo checks
    const itemsWithProduct = items.map(item => ({
      item,
      product: this.findProductForListItem(item, allProducts)
    }));

    const aggregatedQtyByGroup = new Map<string, { totalBase: number; canonicalUnit: UnitType; count: number }>();
    const itemGroupKey = new Map<string, string>();
    for (const { item, product } of itemsWithProduct) {
      if (!product) continue;
      const reqUnit = normalizeUnitToken(item.unit || product.defaultUnit);
      const pkgUnit = normalizeUnitToken(product.packageUnit || product.defaultUnit);
      const dim = getUnitDimension(reqUnit);
      const pkgDim = getUnitDimension(pkgUnit);
      const key =
        (dim === 'mass' || dim === 'volume') && dim === pkgDim
          ? `${product.id}::dim:${dim}`
          : `${product.id}::${reqUnit}`;
      itemGroupKey.set(item.id, key);
      const existing = aggregatedQtyByGroup.get(key);
      const baseAmt = toBaseAmount(Math.max(0, Number(item.quantity) || 0), reqUnit);
      if (existing) {
        existing.totalBase += baseAmt;
        existing.count += 1;
      } else {
        aggregatedQtyByGroup.set(key, {
          totalBase: baseAmt,
          canonicalUnit: (dim === 'mass' || dim === 'volume') && dim === pkgDim ? pkgUnit : reqUnit,
          count: 1
        });
      }
    }

    const totalItemsCount = items.length;

    const comparisons: BasketStoreComparison[] = allStores.map(store => {
      const availableItems: BasketStoreComparison['availableItems'] = [];
      const missingItems: ShoppingListItem[] = [];
      let availableTotal = 0;
      let loyaltySavings = 0;
      let hasLoyaltyDiscount = false;

      for (const { item, product } of itemsWithProduct) {
        if (!product) {
          missingItems.push(item);
          continue;
        }

        const reqUnit = normalizeUnitToken(item.unit || product.defaultUnit);
        const grpKey = itemGroupKey.get(item.id);
        const grpInfo = grpKey ? aggregatedQtyByGroup.get(grpKey) : undefined;
        const aggQty =
          grpInfo && grpInfo.count > 1
            ? grpInfo.canonicalUnit === 'kg' || grpInfo.canonicalUnit === 'l'
              ? grpInfo.totalBase / 1000
              : grpInfo.totalBase
            : item.quantity;
        const evalUnit = grpInfo && grpInfo.count > 1 ? grpInfo.canonicalUnit : reqUnit;

        const bestEvaluated = BasketOptimizerService.evaluateStoreOfferForProduct({
          product,
          store,
          offers: allOffers,
          includeStaleOffers,
          maxOfferAgeDays,
          region,
          useLoyaltyCards,
          useCoupons,
          requestedQuantity: aggQty,
          requestedUnit: evalUnit,
          now
        });

        if (!bestEvaluated) {
          missingItems.push(item);
          continue;
        }

        const { offer } = bestEvaluated;
        let linePrice = 0;
        let unitPriceStr = '-';
        let loyaltyApplied = false;
        let compatible = false;

        if (grpInfo && grpInfo.count > 1 && grpInfo.totalBase > 0) {
          const aggCost = BasketOptimizerService.computeNormalizedItemCost({
            quantity: aggQty,
            requestedUnit: evalUnit,
            product,
            offer,
            useLoyaltyCards,
            useCoupons
          });
          if (aggCost.compatible) {
            compatible = true;
            const share = toBaseAmount(item.quantity, reqUnit) / grpInfo.totalBase;
            linePrice = round2(aggCost.calculatedPrice * share);
            unitPriceStr = aggCost.unitPriceDisplay;
            loyaltyApplied = aggCost.loyaltyApplied;
          }
        } else {
          const singleCost = this.calculateItemCostAtStore(
            item,
            product,
            offer,
            useLoyaltyCards,
            useCoupons
          );
          if (singleCost.compatible) {
            compatible = true;
            linePrice = singleCost.price;
            unitPriceStr = singleCost.unitPriceStr;
            loyaltyApplied = singleCost.loyaltyApplied;
          }
        }

        if (!compatible) {
          missingItems.push(item);
          continue;
        }

        const stdPackPrice =
          offer.normalPrice && offer.normalPrice > 0
            ? offer.normalPrice
            : offer.originalPrice && offer.originalPrice > 0
            ? offer.originalPrice
            : offer.price;

        if (loyaltyApplied && stdPackPrice > offer.price) {
          hasLoyaltyDiscount = true;
          loyaltySavings += Math.max(0, (stdPackPrice - offer.price) * item.quantity);
        }

        availableItems.push({
          item,
          offer,
          calculatedPrice: linePrice,
          unitPriceString: unitPriceStr,
          isLowest: false,
          isLoyaltyPrice: offer.loyaltyCardRequired,
          loyaltyCardName: offer.loyaltyCardName,
          isExpired: false,
          sourceType: offer.source,
          verificationStatus: offer.verificationStatus
        });
        availableTotal += linePrice;
      }

      const coveredItemsCount = availableItems.length;
      const unpricedItemsCount = missingItems.length;
      const completenessPercentage =
        totalItemsCount > 0 ? Math.round((coveredItemsCount / totalItemsCount) * 100) : 0;
      const isCompleteBasket = totalItemsCount > 0 && coveredItemsCount === totalItemsCount && unpricedItemsCount === 0;
      const hasValidOffers = coveredItemsCount > 0;
      const rankingBucket: BasketStoreComparison['rankingBucket'] = isCompleteBasket
        ? 'complete'
        : hasValidOffers
        ? 'partial'
        : 'no_offers';

      const grandTotal = hasValidOffers ? round2(availableTotal) : 0;
      const offerDates = availableItems
        .map(ai => ai.offer.lastVerifiedAt || ai.offer.observationDate || ai.offer.lastChecked.slice(0, 10))
        .filter(Boolean)
        .sort();
      const latestObsDate = offerDates.length > 0 ? offerDates[offerDates.length - 1].slice(0, 10) : null;
      const oldestObsDate = offerDates.length > 0 ? offerDates[0] : null;

      return {
        store,
        availableItems,
        missingItems,
        availableTotal: grandTotal,
        estimatedMissingTotal: 0,
        grandTotal,
        savingsVsWorst: 0,
        isWinner: false,
        isCompleteBasket,
        isCheapestCompleteBasket: false,
        rankingBucket,
        hasValidOffers,
        totalItemsCount,
        coveredItemsCount,
        unpricedItemsCount,
        comparableDiffVsCompleteWinner: null,
        comparableDiffVsSameCoverageLeader: null,
        oldestVerifiedAt: oldestObsDate,
        completenessPercentage,
        confidenceLevel:
          isCompleteBasket ? 'high' : completenessPercentage >= 50 ? 'medium' : 'low',
        lastUpdated: latestObsDate
          ? new Date(latestObsDate).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'Fără oferte verificate',
        hasLoyaltyDiscount,
        loyaltySavings: round2(loyaltySavings)
      };
    });

    // Mark lowest price on each product across stores that actually carry it
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
          if (found && Math.abs(found.calculatedPrice - minPrice) <= 0.001) {
            found.isLowest = true;
          }
        }
      }
    }

    const bucketRank = (bucket?: BasketStoreComparison['rankingBucket']): number => {
      if (bucket === 'complete') return 0;
      if (bucket === 'partial') return 1;
      return 2;
    };

    // Sort: 1. Complete baskets by lowest total; 2. Partial by highest coverage then lowest subtotal; 3. No offers alphabetically
    comparisons.sort((a, b) => {
      const rankDiff = bucketRank(a.rankingBucket) - bucketRank(b.rankingBucket);
      if (rankDiff !== 0) return rankDiff;

      if (a.rankingBucket === 'complete') {
        if (Math.abs(a.grandTotal - b.grandTotal) > 0.001) {
          return a.grandTotal - b.grandTotal;
        }
        return a.store.name.localeCompare(b.store.name, 'ro');
      }

      if (a.rankingBucket === 'partial') {
        if (b.availableItems.length !== a.availableItems.length) {
          return b.availableItems.length - a.availableItems.length;
        }
        if (Math.abs(a.grandTotal - b.grandTotal) > 0.001) {
          return a.grandTotal - b.grandTotal;
        }
        return a.store.name.localeCompare(b.store.name, 'ro');
      }

      return a.store.name.localeCompare(b.store.name, 'ro');
    });

    // Complete basket winner & savings ONLY across complete baskets (equal 100% coverage)
    const completeStores = comparisons.filter(c => c.isCompleteBasket);
    const completeWinner = completeStores[0] || null;
    const highestCompleteTotal =
      completeStores.length >= 2 ? Math.max(...completeStores.map(c => c.grandTotal)) : 0;

    // Group partial stores by exact covered item signature so unequal product subsets are never compared
    const partialGroups = new Map<string, BasketStoreComparison[]>();
    for (const comp of comparisons) {
      if (!comp.isCompleteBasket && comp.availableItems.length > 0) {
        const sig = comp.availableItems
          .map(ai => `${ai.item.productId || ai.item.id}:${ai.item.quantity}:${ai.item.unit}`)
          .sort()
          .join('|');
        const arr = partialGroups.get(sig) || [];
        arr.push(comp);
        partialGroups.set(sig, arr);
      }
    }

    for (const comp of comparisons) {
      if (comp.isCompleteBasket && completeWinner) {
        const isLeader = comp.store.id === completeWinner.store.id;
        comp.isWinner = isLeader;
        comp.isCheapestCompleteBasket = isLeader;
        comp.comparableDiffVsCompleteWinner = round2(comp.grandTotal - completeWinner.grandTotal);
        comp.savingsVsWorst =
          completeStores.length >= 2 && highestCompleteTotal > comp.grandTotal
            ? round2(Math.max(0, highestCompleteTotal - comp.grandTotal))
            : 0;
      } else {
        comp.isWinner = false;
        comp.isCheapestCompleteBasket = false;
        comp.comparableDiffVsCompleteWinner = null;
        comp.savingsVsWorst = 0;

        if (comp.availableItems.length > 0) {
          const sig = comp.availableItems
            .map(ai => `${ai.item.productId || ai.item.id}:${ai.item.quantity}:${ai.item.unit}`)
            .sort()
            .join('|');
          const peers = partialGroups.get(sig) || [];
          if (peers.length >= 2) {
            const minGroupTotal = Math.min(...peers.map(p => p.grandTotal));
            comp.comparableDiffVsSameCoverageLeader = round2(comp.grandTotal - minGroupTotal);
          }
        }
      }
    }

    return comparisons;
  }

  /**
   * Per-item price spread across canonical stores using unified matching & offer validation.
   * Requires >= 2 valid store offers to report savings; single-store items report savings = 0.
   */
  static getPotentialSavingsDetailsForList(
    items: ShoppingListItem[],
    customProducts: Product[],
    customOffers: ProductOffer[],
    customStores: Store[],
    useLoyaltyCards = true,
    options?: Omit<PriceComparisonOptions, 'useLoyaltyCards'>
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
    comparableStoresCount: number;
  }> {
    const now = options?.now || new Date();
    const canonicalStores = BasketOptimizerService.canonicalizeStores(customStores);

    return items.map(item => {
      const product = this.findProductForListItem(item, customProducts);
      if (!product) {
        return { item, savings: 0, loyaltyApplied: false, comparableStoresCount: 0 };
      }

      const reqUnit = normalizeUnitToken(item.unit || product.defaultUnit);
      const storePrices: Array<{
        store: Store;
        offer: ProductOffer;
        price: number;
        loyaltyApplied: boolean;
      }> = [];

      for (const store of canonicalStores) {
        const evaluated = BasketOptimizerService.evaluateStoreOfferForProduct({
          product,
          store,
          offers: customOffers,
          includeStaleOffers: options?.includeStaleOffers ?? true,
          maxOfferAgeDays: options?.maxOfferAgeDays,
          region: options?.region,
          useLoyaltyCards,
          useCoupons: options?.useCoupons ?? false,
          requestedQuantity: item.quantity,
          requestedUnit: reqUnit,
          now
        });
        if (!evaluated) continue;

        const cost = this.calculateItemCostAtStore(
          item,
          product,
          evaluated.offer,
          useLoyaltyCards,
          options?.useCoupons ?? false
        );
        if (!cost.compatible) continue;

        storePrices.push({
          store,
          offer: evaluated.offer,
          price: cost.price,
          loyaltyApplied: cost.loyaltyApplied
        });
      }

      storePrices.sort((a, b) => a.price - b.price);

      if (storePrices.length === 0) {
        return { item, product, savings: 0, loyaltyApplied: false, comparableStoresCount: 0 };
      }

      if (storePrices.length === 1) {
        const only = storePrices[0];
        return {
          item,
          product,
          lowestOffer: only.offer,
          lowestStoreName: only.store.name,
          cheapestPrice: only.price,
          mostExpensivePrice: undefined,
          savings: 0,
          loyaltyApplied: only.loyaltyApplied,
          comparableStoresCount: 1
        };
      }

      const lowest = storePrices[0];
      const highest = storePrices[storePrices.length - 1];
      return {
        item,
        product,
        lowestOffer: lowest.offer,
        highestOffer: highest.offer,
        lowestStoreName: lowest.store.name,
        highestStoreName: highest.store.name,
        cheapestPrice: lowest.price,
        mostExpensivePrice: highest.price,
        savings: round2(Math.max(0, highest.price - lowest.price)),
        loyaltyApplied: storePrices.some(p => p.loyaltyApplied),
        comparableStoresCount: storePrices.length
      };
    });
  }

  /**
   * Unified basket potential savings summary derived strictly from compareBasketAcrossStores.
   * Never mixes stores or unequal coverage; returns status='undetermined' when < 2 complete stores exist.
   */
  static getPotentialSavingsForList(
    items: ShoppingListItem[],
    options?: PriceComparisonOptions,
    customProducts?: Product[],
    customOffers?: ProductOffer[],
    customStores?: Store[]
  ): BasketSavingsSummary {
    const totalItemsCount = items?.length || 0;
    if (totalItemsCount === 0) {
      return {
        status: 'undetermined',
        cheapestTotal: 0,
        availableSubtotal: 0,
        mostExpensiveTotal: 0,
        maxSavings: 0,
        bestStoreName: '-',
        hasLoyaltyDiscount: false,
        hasCompleteComparableBaskets: false,
        isCompleteBasket: false,
        pricedItemsCount: 0,
        unpricedItemsCount: 0,
        totalItemsCount: 0,
        comparableStoresCount: 0,
        comparedStoreNames: [],
        comparableItemsCount: 0,
        savingsExplanationRo: 'Lista de cumpărături este goală.'
      };
    }

    const comparisons = this.compareBasketAcrossStores(
      items,
      options,
      customProducts,
      customOffers,
      customStores
    );

    const pricedItemIds = new Set<string>();
    for (const comp of comparisons) {
      for (const ai of comp.availableItems) {
        pricedItemIds.add(ai.item.id);
      }
    }
    const pricedItemsCount = pricedItemIds.size;
    const unpricedItemsCount = Math.max(0, totalItemsCount - pricedItemsCount);

    const completeStores = comparisons.filter(c => c.isCompleteBasket);

    if (completeStores.length >= 2) {
      const cheapest = completeStores[0];
      const mostExpensive = completeStores[completeStores.length - 1];
      const maxSavings = round2(Math.max(0, mostExpensive.grandTotal - cheapest.grandTotal));
      const comparedStoreNames = completeStores.map(c => c.store.name);

      return {
        status: 'determined',
        cheapestTotal: cheapest.grandTotal,
        availableSubtotal: cheapest.grandTotal,
        mostExpensiveTotal: mostExpensive.grandTotal,
        maxSavings,
        bestStoreName: cheapest.store.name,
        mostExpensiveStoreName: mostExpensive.store.name,
        hasLoyaltyDiscount: cheapest.hasLoyaltyDiscount,
        hasCompleteComparableBaskets: true,
        isCompleteBasket: true,
        pricedItemsCount,
        unpricedItemsCount: 0,
        totalItemsCount,
        comparableStoresCount: completeStores.length,
        comparedStoreNames,
        comparableItemsCount: totalItemsCount,
        savingsExplanationRo: `Economie calculată pe ${totalItemsCount}/${totalItemsCount} produse între ${completeStores.length} magazine cu coș complet (${cheapest.store.name} vs ${mostExpensive.store.name}).`
      };
    }

    if (completeStores.length === 1) {
      const onlyComplete = completeStores[0];
      return {
        status: 'undetermined',
        cheapestTotal: onlyComplete.grandTotal,
        availableSubtotal: onlyComplete.grandTotal,
        mostExpensiveTotal: onlyComplete.grandTotal,
        maxSavings: 0,
        bestStoreName: onlyComplete.store.name,
        hasLoyaltyDiscount: onlyComplete.hasLoyaltyDiscount,
        hasCompleteComparableBaskets: false,
        isCompleteBasket: true,
        pricedItemsCount,
        unpricedItemsCount: 0,
        totalItemsCount,
        comparableStoresCount: 1,
        comparedStoreNames: [onlyComplete.store.name],
        comparableItemsCount: totalItemsCount,
        savingsExplanationRo: `Doar ${onlyComplete.store.name} acoperă toate cele ${totalItemsCount} produse. Sunt necesare cel puțin 2 magazine cu coș complet pentru calculul economiilor.`
      };
    }

    const partialStores = comparisons.filter(c => c.availableItems.length > 0);
    const leaderPartial = partialStores[0] || null;

    return {
      status: 'undetermined',
      cheapestTotal: 0,
      availableSubtotal: leaderPartial ? leaderPartial.grandTotal : 0,
      mostExpensiveTotal: 0,
      maxSavings: 0,
      bestStoreName: leaderPartial ? leaderPartial.store.name : '-',
      hasLoyaltyDiscount: Boolean(leaderPartial?.hasLoyaltyDiscount),
      hasCompleteComparableBaskets: false,
      isCompleteBasket: false,
      pricedItemsCount,
      unpricedItemsCount,
      totalItemsCount,
      comparableStoresCount: 0,
      comparedStoreNames: partialStores.map(c => c.store.name),
      comparableItemsCount: leaderPartial ? leaderPartial.availableItems.length : 0,
      savingsExplanationRo:
        partialStores.length === 0
          ? `Nu există oferte active verificate pentru produsele din listă (${unpricedItemsCount} fără preț).`
          : `Niciun magazin nu acoperă toate cele ${totalItemsCount} produse (${leaderPartial?.store.name}: ${leaderPartial?.availableItems.length}/${totalItemsCount} găsite). Comparația completă este nedeterminată.`
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

    const allStores: Store[] = BasketOptimizerService.canonicalizeStores(
      providedStores && providedStores.length > 0 ? providedStores : STORES
    );
    const storeMap = new Map<string, Store>();
    for (const s of allStores) {
      storeMap.set(s.id, s);
      storeMap.set(`store-${s.id}`, s);
    }

    // Oferte valide neexpirate prin clasificatorul centralizat
    const rawOffers = providedOffers
      ? providedOffers.filter(o => o.productId === productId && this.isOfferValid(o, product))
      : this.getOffersForProduct(productId, false, undefined, product);

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

    const sortedOffers = [...rawOffers].sort((a, b) => a.price - b.price);
    const minPrice = sortedOffers[0].price;
    const maxPrice = Math.max(...sortedOffers.map(o => o.price));
    const savingsAmount = sortedOffers.length >= 2 ? round2(Math.max(0, maxPrice - minPrice)) : 0;
    const savingsPct = sortedOffers.length >= 2 && maxPrice > 0 ? Math.round((savingsAmount / maxPrice) * 100) : 0;

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
