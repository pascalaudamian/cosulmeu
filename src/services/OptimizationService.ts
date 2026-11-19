// src/services/OptimizationService.ts
// Fațadă compatibilă cu API-ul existent, delegând calculul determinist către BasketOptimizerService (V1).

import {
  ShoppingListItem,
  MultiStoreOptimization,
  Product,
  ProductOffer,
  Store,
  BasketOptimizationOptions
} from '../types.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import { BasketOptimizerService } from './BasketOptimizerService.js';
import { StorageService } from './StorageService.js';

export class OptimizationService {
  /**
   * Calculează planul multi-magazin și îl compară cu cel mai bun magazin unic.
   * Implicit NU inventează costuri de transport (travelCost = 0), decât dacă apelantul specifică explicit o valoare.
   */
  static optimizeBasket(
    items: ShoppingListItem[],
    travelCostPerExtraStore = 0,
    customProducts?: Product[],
    customOffers?: ProductOffer[],
    customStores?: Store[],
    options?: Omit<BasketOptimizationOptions, 'transportCostPerExtraStore'>
  ): MultiStoreOptimization {
    const allProducts = customProducts ?? StorageService.getAllProducts();
    const allOffers = customOffers ?? StorageService.getProductOffers();
    const allStores = customStores;
    const useLoyalty =
      options?.useLoyaltyCards !== undefined
        ? options.useLoyaltyCards
        : StorageService.getUserProfile().useLoyaltyCards ?? true;

    const singleComparisons = PriceComparisonService.compareBasketAcrossStores(
      items,
      { useLoyaltyCards: useLoyalty },
      allProducts,
      allOffers,
      allStores
    );
    const singleWinner = singleComparisons.length > 0 ? singleComparisons[0] : null;

    const v1 = BasketOptimizerService.optimize({
      items,
      products: allProducts,
      offers: allOffers,
      stores: allStores,
      options: {
        ...options,
        useLoyaltyCards: useLoyalty,
        transportCostPerExtraStore: Math.max(0, Number(travelCostPerExtraStore) || 0)
      }
    });

    const plan = v1.recommendedMultiStore;
    if (!plan || plan.stops.length === 0) {
      return {
        singleStoreWinner: singleWinner,
        multiStorePlan: [],
        multiStoreTotal: singleWinner?.grandTotal || 0,
        grossSavings: 0,
        transportCost: 0,
        netSavings: 0,
        isSplitRecommended: false,
        explanation:
          v1.limitations[0] ||
          'Nu există suficiente oferte active verificate pentru a împărți coșul în mai multe magazine.'
      };
    }

    const multiStorePlan = plan.stops.map(stop => ({
      store: stop.store,
      items: stop.allocations.map(alloc => ({
        item: alloc.item,
        offer: alloc.offer,
        calculatedPrice: alloc.calculatedPrice
      })),
      subtotal: stop.subtotal
    }));

    const multiStoreTotal = plan.productsTotal;
    const extraStoresCount = Math.max(0, multiStorePlan.length - 1);
    const totalTransportCost = Math.round(extraStoresCount * Math.max(0, travelCostPerExtraStore) * 100) / 100;

    const grossSavings =
      plan.hasValidSavingsBaseline && plan.savingsVsBestSingleStore !== null
        ? Math.max(0, Math.round((plan.savingsVsBestSingleStore + totalTransportCost) * 100) / 100)
        : 0;
    const netSavings = Math.round((grossSavings - totalTransportCost) * 100) / 100;
    const isSplitRecommended = extraStoresCount > 0 && netSavings > 0.01;

    let explanation = plan.explanationRo;
    if (extraStoresCount === 0) {
      explanation = `Împărțirea nu este necesară: ${multiStorePlan[0].store.name} oferă cel mai bun preț total pentru produsele disponibile.`;
    } else if (!plan.hasValidSavingsBaseline) {
      explanation =
        'Împărțirea între mai multe magazine acoperă produse indisponibile într-un singur magazin; nu există un reper complet echivalent într-un singur magazin pentru calculul economiilor.';
    } else if (isSplitRecommended) {
      explanation = `Economie de ${PriceComparisonService.formatRon(netSavings)} la produsele comparabile împărțind coșul în ${multiStorePlan.length} magazine${totalTransportCost === 0 ? ' (fără costuri de transport incluse).' : '.'}`;
    } else {
      explanation = `Economia estimată (${PriceComparisonService.formatRon(grossSavings)}) nu depășește pragul suplimentar de deplasare. Cumpărăturile la un singur magazin rămân opțiunea mai practică.`;
    }

    return {
      singleStoreWinner: singleWinner,
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
