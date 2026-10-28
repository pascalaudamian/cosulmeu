import { ShoppingListItem, MultiStoreOptimization, Store, ProductOffer, BasketStoreComparison } from '../types';
import { STORES, PRODUCT_OFFERS, PRODUCTS } from '../data/mockData';
import { PriceComparisonService } from './PriceComparisonService';
import { StorageService } from './StorageService';

export class OptimizationService {
  /**
   * Optimize shopping basket across multiple stores
   * @param items List of shopping list items
   * @param transportCost Extra transport / gas / time cost per additional store in RON (e.g. 6.00 lei)
   */
  static optimizeBasket(
    items: ShoppingListItem[],
    transportCost: number = 6.00
  ): MultiStoreOptimization {
    if (!items || items.length === 0) {
      return {
        singleStoreWinner: null,
        multiStorePlan: [],
        multiStoreTotal: 0,
        grossSavings: 0,
        transportCost: 0,
        netSavings: 0,
        isSplitRecommended: false,
        explanation: 'Lista este goală. Adaugă produse pentru a calcula optimizarea.'
      };
    }

    const comparisons = PriceComparisonService.compareBasketAcrossStores(items);
    const singleStoreWinner = comparisons[0] || null;
    const singleWinnerTotal = singleStoreWinner ? singleStoreWinner.grandTotal : 0;

    const allProducts = StorageService.getAllProducts();

    // Map each item to its absolute lowest available price store
    const itemAssignments: {
      item: ShoppingListItem;
      store: Store;
      offer: ProductOffer;
      calculatedPrice: number;
    }[] = [];

    for (const item of items) {
      const product = PriceComparisonService.findProductForListItem(item, allProducts);
      if (!product) continue;

      const offers = PriceComparisonService.getOffersForProduct(product.id);
      if (offers.length === 0) continue;

      let bestOffer: ProductOffer | null = null;
      let minCost = Infinity;

      const userProfile = StorageService.getUserProfile();
      for (const offer of offers) {
        const { price } = PriceComparisonService.calculateItemCostAtStore(
          item,
          product,
          offer,
          userProfile.useLoyaltyCards
        );
        if (price < minCost) {
          minCost = price;
          bestOffer = offer;
        }
      }

      if (bestOffer) {
        const store = STORES.find(s => s.id === bestOffer.storeId);
        if (store) {
          itemAssignments.push({
            item,
            store,
            offer: bestOffer,
            calculatedPrice: minCost
          });
        }
      }
    }

    // Group items by assigned store
    const storeMap = new Map<string, {
      store: Store;
      items: { item: ShoppingListItem; offer: ProductOffer; calculatedPrice: number }[];
      subtotal: number;
    }>();

    for (const assignment of itemAssignments) {
      const sId = assignment.store.id;
      if (!storeMap.has(sId)) {
        storeMap.set(sId, {
          store: assignment.store,
          items: [],
          subtotal: 0
        });
      }
      const entry = storeMap.get(sId)!;
      entry.items.push({
        item: assignment.item,
        offer: assignment.offer,
        calculatedPrice: assignment.calculatedPrice
      });
      entry.subtotal = Math.round((entry.subtotal + assignment.calculatedPrice) * 100) / 100;
    }

    // Filter to stores with substantial items (prune stores that only have 1 trivial item if savings are micro)
    const multiStorePlan = Array.from(storeMap.values()).sort((a, b) => b.subtotal - a.subtotal);

    const multiStoreTotal = Math.round(
      multiStorePlan.reduce((sum, p) => sum + p.subtotal, 0) * 100
    ) / 100;

    const numStores = multiStorePlan.length;
    // Extra transport cost applies to stores beyond the 1st one: (numStores - 1) * transportCost
    const extraTrips = Math.max(0, numStores - 1);
    const totalTransportCost = Math.round(extraTrips * transportCost * 100) / 100;

    const grossSavings = Math.max(0, Math.round((singleWinnerTotal - multiStoreTotal) * 100) / 100);
    const netSavings = Math.round((grossSavings - totalTransportCost) * 100) / 100;

    const isSplitRecommended = netSavings > 2.00 && numStores > 1;

    let explanation = '';
    if (numStores <= 1) {
      explanation = `Toate cele mai bune prețuri sunt deja concentrate la ${singleStoreWinner?.store.name || 'un singur magazin'}. O deplasare unică este optimă.`;
    } else if (isSplitRecommended) {
      const storeNames = multiStorePlan.map(p => p.store.name).join(' și ');
      explanation = `Împărțind lista între ${storeNames}, economisești ${PriceComparisonService.formatRon(grossSavings)}. Chiar scăzând ${PriceComparisonService.formatRon(totalTransportCost)} cost estimat de deplasare, rămâi cu un câștig net de ${PriceComparisonService.formatRon(netSavings)}.`;
    } else {
      explanation = `Deși împărțirea pe ${numStores} magazine oferă o reducere brută de ${PriceComparisonService.formatRon(grossSavings)}, costul de transport și timpul suplimentar (~${PriceComparisonService.formatRon(totalTransportCost)}) depășesc beneficiul. Recomandăm să faci toate cumpărăturile la ${singleStoreWinner?.store.name}.`;
    }

    return {
      singleStoreWinner,
      multiStorePlan,
      multiStoreTotal,
      grossSavings,
      transportCost: totalTransportCost,
      netSavings,
      isSplitRecommended,
      explanation
    };
  }
}
