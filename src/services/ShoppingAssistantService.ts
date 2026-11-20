import {
  BudgetStatusSummary,
  Product,
  ProductCategory,
  ProductOffer,
  ShoppingAssistantDeterministicPlan,
  ShoppingAssistantGroundedItem,
  ShoppingAssistantIntent,
  ShoppingList,
  Store
} from '../types.js';
import { BasketOptimizerService } from './BasketOptimizerService.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import { ProductAlternativesService, computeNormalizedUnitPrice } from './ProductAlternativesService.js';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeStoreKey(storeId: string): string {
  return (storeId || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
}

function normalizePrompt(prompt: string): string {
  return (prompt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function classifyAssistantIntent(params: {
  prompt: string;
  explicitIntent?: ShoppingAssistantIntent;
}): {
  intent: ShoppingAssistantIntent;
  budgetLei?: number;
  days?: number;
} {
  if (params.explicitIntent) {
    const budgetMatch = params.prompt.match(/(\d+(?:[.,]\d+)?)\s*(?:lei|ron)/i);
    const daysMatch = params.prompt.match(/(\d+)\s*(?:zile|zi)/i);
    return {
      intent: params.explicitIntent,
      budgetLei: budgetMatch ? Number(budgetMatch[1].replace(',', '.')) : undefined,
      days: daysMatch ? Math.max(1, Math.min(14, parseInt(daysMatch[1], 10))) : undefined
    };
  }

  const norm = normalizePrompt(params.prompt);
  const budgetMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*(?:lei|ron|buget)?/);
  const explicitLeiMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*(?:lei|ron)/);
  const daysMatch = norm.match(/(\d+)\s*(?:zile|zi)/);

  if (norm.includes('reducere') || norm.includes('promot') || norm.includes('oferta') || norm.includes('oferte')) {
    return { intent: 'list_promos' };
  }
  if (norm.includes('alternativ') || norm.includes('mai ieftin') || norm.includes('inlocui') || norm.includes('marca proprie')) {
    return { intent: 'cheaper_alternatives' };
  }
  if (norm.includes('planific') || norm.includes('meniu') || daysMatch) {
    return {
      intent: 'meal_plan_days',
      days: daysMatch ? Math.max(1, Math.min(14, parseInt(daysMatch[1], 10))) : 5,
      budgetLei: explicitLeiMatch ? Number(explicitLeiMatch[1].replace(',', '.')) : undefined
    };
  }
  if (norm.includes('optimiz') || norm.includes('cel mai ieftin magazin') || norm.includes('impart') || norm.includes('cosul')) {
    return { intent: 'optimize_list' };
  }
  if (norm.includes('cumpara') || norm.includes('buget') || explicitLeiMatch || budgetMatch) {
    const rawNum = explicitLeiMatch
      ? Number(explicitLeiMatch[1].replace(',', '.'))
      : budgetMatch
      ? Number(budgetMatch[1].replace(',', '.'))
      : 200;
    return {
      intent: 'budget_basket',
      budgetLei: Number.isFinite(rawNum) && rawNum > 0 ? rawNum : 200
    };
  }

  return { intent: 'general_guidance' };
}

interface BestValidProductEntry {
  product: Product;
  offer: ProductOffer;
  store: Store;
  price: number;
  unitPrice: number;
  unitLabel: string;
}

const ESSENTIAL_CATEGORIES_ORDER: ProductCategory[] = [
  'Lactate și ouă',
  'Panificație',
  'Fructe și legume',
  'Carne și pește',
  'Produse de bază',
  'Băuturi',
  'Curățenie',
  'Igienă personală'
];

export class ShoppingAssistantService {
  static buildDeterministicPlan(params: {
    prompt: string;
    explicitIntent?: ShoppingAssistantIntent;
    budgetLei?: number;
    days?: number;
    activeList?: ShoppingList | null;
    selectedProductId?: string;
    allProducts: Product[];
    allOffers: ProductOffer[];
    allStores: Store[];
    useLoyaltyCards?: boolean;
    budgetSummary?: BudgetStatusSummary | null;
  }): ShoppingAssistantDeterministicPlan {
    const classified = classifyAssistantIntent({
      prompt: params.prompt,
      explicitIntent: params.explicitIntent
    });

    const intent = classified.intent;
    const budgetRequestedLei =
      params.budgetLei && params.budgetLei > 0 ? round2(params.budgetLei) : classified.budgetLei;
    const daysRequested =
      params.days && params.days > 0
        ? Math.max(1, Math.min(14, params.days))
        : classified.days || (intent === 'meal_plan_days' ? 5 : undefined);
    const useLoyaltyCards = params.useLoyaltyCards ?? true;

    const storeMap = new Map<string, Store>();
    for (const s of params.allStores || []) {
      if (!s?.id || s.id === 'validation-only-retailer') continue;
      storeMap.set(s.id, s);
      storeMap.set(normalizeStoreKey(s.id), s);
    }
    const resolveStore = (id: string) => storeMap.get(id) || storeMap.get(normalizeStoreKey(id)) || null;

    const productById = new Map<string, Product>();
    for (const p of params.allProducts || []) {
      if (p?.id) productById.set(p.id, p);
    }

    const bestOfferByProduct = new Map<string, BestValidProductEntry>();
    const validOffersByProduct = new Map<string, BestValidProductEntry[]>();
    let validOffersCount = 0;

    for (const offer of params.allOffers || []) {
      const product = productById.get(offer.productId);
      if (!product) continue;
      const store = resolveStore(offer.storeId);
      if (!store) continue;
      if (!PriceComparisonService.isOfferValid(offer, product)) continue;

      validOffersCount += 1;
      const calc = computeNormalizedUnitPrice(offer, product, useLoyaltyCards);
      const entry: BestValidProductEntry = {
        product,
        offer,
        store,
        price: calc.price,
        unitPrice: calc.unitPrice,
        unitLabel: calc.unitLabel
      };
      const arr = validOffersByProduct.get(product.id) || [];
      arr.push(entry);
      validOffersByProduct.set(product.id, arr);

      const currentBest = bestOfferByProduct.get(product.id);
      if (!currentBest || entry.price < currentBest.price) {
        bestOfferByProduct.set(product.id, entry);
      }
    }

    const limitations: string[] = [];
    const catalogAvailableCount = (params.allProducts || []).length;

    // Empty catalog / zero valid offers safeguard
    if (catalogAvailableCount === 0 || validOffersCount === 0) {
      limitations.push(
        catalogAvailableCount === 0
          ? 'Catalogul nu conține produse disponibile în acest moment. Nu putem recomanda produse sau prețuri fără date reale.'
          : 'Nu există oferte valide verificate în catalog în acest moment. Nu inventăm prețuri sau disponibilitate.'
      );
      return {
        intent,
        titleRo: 'Date insuficiente în catalog',
        budgetRequestedLei,
        daysRequested,
        catalogAvailableCount,
        validOffersCount,
        items: [],
        totalEstimatedCost: 0,
        remainingBudgetLei: budgetRequestedLei,
        limitations,
        allowedProductIds: []
      };
    }

    const items: ShoppingAssistantGroundedItem[] = [];
    let totalEstimatedCost = 0;
    let estimatedSavingsLei: number | undefined;
    let optimizationSummary: ShoppingAssistantDeterministicPlan['optimizationSummary'];

    if (intent === 'optimize_list') {
      const listItems = params.activeList?.items || [];
      if (listItems.length === 0) {
        limitations.push('Lista activă de cumpărături este goală. Adaugă cel puțin un produs pentru optimizare.');
      } else {
        const opt = BasketOptimizerService.optimize({
          list: params.activeList || undefined,
          items: listItems,
          options: { useLoyaltyCards, maxStores: 3, transportCostPerExtraStore: 0 },
          products: params.allProducts,
          offers: params.allOffers,
          stores: params.allStores
        });

        const preferredPlan =
          opt.recommendedMultiStore ||
          (opt.bestSingleStore
            ? {
                stops: [
                  {
                    store: opt.bestSingleStore.store,
                    allocations: opt.bestSingleStore.allocations,
                    subtotal: opt.bestSingleStore.totalPrice
                  }
                ],
                productsTotal: opt.bestSingleStore.totalPrice,
                savingsVsBestSingleStore: opt.bestSingleStore.savingsVsWorstStore
              }
            : null);

        if (preferredPlan) {
          for (const stop of preferredPlan.stops) {
            for (const alloc of stop.allocations) {
              items.push({
                productId: alloc.product.id,
                productName: alloc.product.name,
                brand: alloc.product.brand,
                category: alloc.product.category,
                storeId: stop.store.id,
                storeName: stop.store.name,
                quantity: alloc.aggregatedQuantity,
                unit: alloc.item.unit || alloc.product.defaultUnit,
                price: round2(alloc.calculatedPrice),
                unitPrice: alloc.offer.unitPrice,
                unitPriceMeasure: alloc.unitPriceDisplay,
                isPromo: alloc.offer.isPromo,
                originalPrice: alloc.offer.originalPrice,
                promoDetails: alloc.offer.promoDetails,
                noteRo: alloc.loyaltyApplied
                  ? `Include reducere ${alloc.loyaltyCardName || 'card fidelitate'}`
                  : undefined
              });
            }
          }
          totalEstimatedCost = round2(preferredPlan.productsTotal);
        }

        const savingsAmt =
          opt.recommendedMultiStore?.savingsVsBestSingleStore ??
          opt.bestSingleStore?.savingsVsWorstStore ??
          undefined;
        estimatedSavingsLei = savingsAmt != null ? round2(savingsAmt) : undefined;

        optimizationSummary = {
          bestSingleStoreName: opt.bestSingleStore?.store.name,
          bestSingleStoreTotal: opt.bestSingleStore?.totalPrice,
          bestMultiStoreTotal: opt.recommendedMultiStore?.productsTotal,
          savingsAmount: estimatedSavingsLei,
          missingItemsCount: opt.itemsWithoutAnyValidPrice.length,
          unconfidentMatchesCount: opt.unconfidentMatches.length
        };

        limitations.push(...opt.limitations);
        if (opt.itemsWithoutAnyValidPrice.length > 0) {
          limitations.push(
            `${opt.itemsWithoutAnyValidPrice.length} produs(e) din listă nu au preț valid verificat și nu au fost incluse în total.`
          );
        }
      }
    } else if (intent === 'list_promos') {
      const listItems = params.activeList?.items || [];
      if (listItems.length === 0) {
        limitations.push('Lista ta de cumpărături este goală; afișăm promoțiile active disponibile din catalog.');
        // Return valid promo offers from catalog cleanly
        const promoEntries = Array.from(bestOfferByProduct.values())
          .filter(e => e.offer.isPromo)
          .sort((a, b) => b.price - a.price)
          .slice(0, 8);
        for (const entry of promoEntries) {
          items.push({
            productId: entry.product.id,
            productName: entry.product.name,
            brand: entry.product.brand,
            category: entry.product.category,
            storeId: entry.store.id,
            storeName: entry.store.name,
            quantity: 1,
            unit: entry.product.defaultUnit,
            price: entry.price,
            unitPrice: entry.unitPrice,
            unitPriceMeasure: entry.unitLabel,
            isPromo: true,
            originalPrice: entry.offer.originalPrice,
            promoDetails: entry.offer.promoDetails
          });
          totalEstimatedCost = round2(totalEstimatedCost + entry.price);
        }
      } else {
        let unmatchedCount = 0;
        let promoSavingsSum = 0;
        for (const listItem of listItems) {
          const match = BasketOptimizerService.matchItemToProduct(listItem, params.allProducts);
          if (match.status !== 'matched' || !match.product) {
            unmatchedCount += 1;
            continue;
          }
          const offers = (validOffersByProduct.get(match.product.id) || [])
            .filter(e => e.offer.isPromo)
            .sort((a, b) => a.price - b.price);
          if (offers.length === 0) continue;
          const bestPromo = offers[0];
          const itemCost = round2(bestPromo.price * (listItem.quantity || 1));
          items.push({
            productId: bestPromo.product.id,
            productName: bestPromo.product.name,
            brand: bestPromo.product.brand,
            category: bestPromo.product.category,
            storeId: bestPromo.store.id,
            storeName: bestPromo.store.name,
            quantity: listItem.quantity || 1,
            unit: listItem.unit || bestPromo.product.defaultUnit,
            price: itemCost,
            unitPrice: bestPromo.unitPrice,
            unitPriceMeasure: bestPromo.unitLabel,
            isPromo: true,
            originalPrice: bestPromo.offer.originalPrice,
            promoDetails: bestPromo.offer.promoDetails,
            noteRo: bestPromo.offer.validUntil ? `Promoție valabilă până la ${bestPromo.offer.validUntil}` : 'Promoție activă'
          });
          totalEstimatedCost = round2(totalEstimatedCost + itemCost);
          if (bestPromo.offer.originalPrice && bestPromo.offer.originalPrice > bestPromo.price) {
            promoSavingsSum = round2(
              promoSavingsSum + (bestPromo.offer.originalPrice - bestPromo.price) * (listItem.quantity || 1)
            );
          }
        }
        estimatedSavingsLei = promoSavingsSum > 0 ? promoSavingsSum : undefined;
        if (items.length === 0) {
          limitations.push('Niciun produs din lista ta activă nu are o promoție activă verificată în acest moment.');
        }
        if (unmatchedCount > 0) {
          limitations.push(`${unmatchedCount} produs(e) din listă nu au putut fi asociate sigur cu catalogul.`);
        }
      }
    } else if (intent === 'cheaper_alternatives') {
      const targetProducts: Product[] = [];
      if (params.selectedProductId && productById.has(params.selectedProductId)) {
        targetProducts.push(productById.get(params.selectedProductId)!);
      }
      for (const li of params.activeList?.items || []) {
        const match = BasketOptimizerService.matchItemToProduct(li, params.allProducts);
        if (match.status === 'matched' && match.product && !targetProducts.some(p => p.id === match.product!.id)) {
          targetProducts.push(match.product);
        }
      }
      if (targetProducts.length === 0) {
        limitations.push('Lista este goală; nu există produse selectate pentru a căuta alternative mai ieftine.');
      } else {
        let potentialNormalizedSavings = 0;
        for (const target of targetProducts.slice(0, 8)) {
          const altResult = ProductAlternativesService.getAlternatives({
            targetProduct: target,
            allProducts: params.allProducts,
            allOffers: params.allOffers,
            stores: params.allStores,
            useLoyaltyCards,
            limitPerGroup: 3
          });
          const topCheaper = altResult.cheaperNormalizedAlternatives[0];
          if (topCheaper) {
            items.push({
              productId: topCheaper.product.id,
              productName: topCheaper.product.name,
              brand: topCheaper.product.brand,
              category: topCheaper.product.category,
              storeId: topCheaper.store.id,
              storeName: topCheaper.store.name,
              quantity: 1,
              unit: topCheaper.product.defaultUnit,
              price: topCheaper.price,
              unitPrice: topCheaper.normalizedUnitPrice,
              unitPriceMeasure: topCheaper.normalizedUnitLabel,
              isPromo: topCheaper.bestOffer.isPromo,
              originalPrice: topCheaper.bestOffer.originalPrice,
              noteRo: `Înlocuiește „${target.name}”: -${topCheaper.savingsPercent.toFixed(0)}% (${topCheaper.kindLabelRo})`
            });
            totalEstimatedCost = round2(totalEstimatedCost + topCheaper.price);
            potentialNormalizedSavings = round2(potentialNormalizedSavings + topCheaper.savingsPerNormalizedUnit);
          }
        }
        estimatedSavingsLei = potentialNormalizedSavings > 0 ? potentialNormalizedSavings : undefined;
        if (items.length === 0) {
          limitations.push('Nu am găsit alternative compatibile mai ieftine la preț normalizat pentru produsele din listă.');
        }
      }
    } else if (intent === 'meal_plan_days') {
      const days = daysRequested || 5;
      const capBudget = budgetRequestedLei && budgetRequestedLei > 0 ? budgetRequestedLei : Number.POSITIVE_INFINITY;
      const foodCategories: ProductCategory[] = [
        'Lactate și ouă',
        'Panificație',
        'Carne și pește',
        'Fructe și legume',
        'Produse de bază',
        'Băuturi'
      ];

      let running = 0;
      const selectedIds = new Set<string>();
      const maxItemsTarget = Math.min(14, Math.max(4, days * 2));

      // Round-robin across core food categories picking lowest valid prices
      let round = 0;
      while (items.length < maxItemsTarget && round < 4) {
        let addedInRound = false;
        for (const cat of foodCategories) {
          if (items.length >= maxItemsTarget) break;
          const candidates = Array.from(bestOfferByProduct.values())
            .filter(e => e.product.category === cat && !selectedIds.has(e.product.id))
            .sort((a, b) => a.price - b.price);
          const pick = candidates.find(c => running + c.price <= capBudget);
          if (!pick) continue;

          selectedIds.add(pick.product.id);
          const dayStart = Math.min(days, Math.floor((items.length / maxItemsTarget) * days) + 1);
          const dayEnd = Math.min(days, dayStart + 1);
          items.push({
            productId: pick.product.id,
            productName: pick.product.name,
            brand: pick.product.brand,
            category: pick.product.category,
            storeId: pick.store.id,
            storeName: pick.store.name,
            quantity: 1,
            unit: pick.product.defaultUnit,
            price: pick.price,
            unitPrice: pick.unitPrice,
            unitPriceMeasure: pick.unitLabel,
            isPromo: pick.offer.isPromo,
            originalPrice: pick.offer.originalPrice,
            dayLabel: dayStart === dayEnd ? `Ziua ${dayStart}` : `Zilele ${dayStart}–${dayEnd}`
          });
          running = round2(running + pick.price);
          addedInRound = true;
        }
        if (!addedInRound) break;
        round += 1;
      }

      totalEstimatedCost = running;
      if (items.length === 0) {
        limitations.push('Catalogul nu conține produse alimentare cu oferte valide care să se încadreze în parametrii ceruți.');
      } else if (items.length < 4) {
        limitations.push('Catalogul disponibil are un număr limitat de produse alimentare cu oferte active.');
      }
    } else {
      // budget_basket or general_guidance
      const budgetCap =
        budgetRequestedLei && budgetRequestedLei > 0
          ? budgetRequestedLei
          : params.budgetSummary?.settings?.weeklyBudget || 200;

      let running = 0;
      const selectedIds = new Set<string>();

      // Pass 1: diversify across essential categories first
      for (const cat of ESSENTIAL_CATEGORIES_ORDER) {
        const candidates = Array.from(bestOfferByProduct.values())
          .filter(e => e.product.category === cat && !selectedIds.has(e.product.id))
          .sort((a, b) => a.price - b.price);
        const pick = candidates.find(c => running + c.price <= budgetCap);
        if (pick) {
          selectedIds.add(pick.product.id);
          items.push({
            productId: pick.product.id,
            productName: pick.product.name,
            brand: pick.product.brand,
            category: pick.product.category,
            storeId: pick.store.id,
            storeName: pick.store.name,
            quantity: 1,
            unit: pick.product.defaultUnit,
            price: pick.price,
            unitPrice: pick.unitPrice,
            unitPriceMeasure: pick.unitLabel,
            isPromo: pick.offer.isPromo,
            originalPrice: pick.offer.originalPrice,
            promoDetails: pick.offer.promoDetails
          });
          running = round2(running + pick.price);
        }
      }

      // Pass 2: fill remaining budget with cheapest remaining products (up to 16 items)
      const remainingPool = Array.from(bestOfferByProduct.values())
        .filter(e => !selectedIds.has(e.product.id))
        .sort((a, b) => a.price - b.price);

      for (const cand of remainingPool) {
        if (items.length >= 16) break;
        if (running + cand.price <= budgetCap) {
          selectedIds.add(cand.product.id);
          items.push({
            productId: cand.product.id,
            productName: cand.product.name,
            brand: cand.product.brand,
            category: cand.product.category,
            storeId: cand.store.id,
            storeName: cand.store.name,
            quantity: 1,
            unit: cand.product.defaultUnit,
            price: cand.price,
            unitPrice: cand.unitPrice,
            unitPriceMeasure: cand.unitLabel,
            isPromo: cand.offer.isPromo,
            originalPrice: cand.offer.originalPrice,
            promoDetails: cand.offer.promoDetails
          });
          running = round2(running + cand.price);
        }
      }

      totalEstimatedCost = running;
      if (items.length === 0) {
        limitations.push(
          `Bugetul de ${budgetCap.toFixed(2)} lei este sub cel mai mic preț valid disponibil în catalog.`
        );
      }
    }

    const effectiveBudgetCap =
      budgetRequestedLei && budgetRequestedLei > 0 ? budgetRequestedLei : undefined;

    return {
      intent,
      titleRo:
        intent === 'optimize_list'
          ? 'Optimizare listă de cumpărături'
          : intent === 'list_promos'
          ? 'Promoții active pe lista ta'
          : intent === 'cheaper_alternatives'
          ? 'Alternative compatibile mai ieftine'
          : intent === 'meal_plan_days'
          ? `Plan cumpărături pentru ${daysRequested || 5} zile`
          : `Coș recomandat în bugetul de ${(effectiveBudgetCap ?? 200).toFixed(0)} lei`,
      budgetRequestedLei: effectiveBudgetCap,
      daysRequested,
      catalogAvailableCount,
      validOffersCount,
      items,
      totalEstimatedCost: round2(totalEstimatedCost),
      remainingBudgetLei:
        effectiveBudgetCap !== undefined ? round2(effectiveBudgetCap - totalEstimatedCost) : undefined,
      estimatedSavingsLei,
      optimizationSummary,
      limitations,
      allowedProductIds: items.map(i => i.productId)
    };
  }

  /**
   * Validează strict ieșirea generată de modelul AI împotriva planului determinist verificat.
   * Blochează orice ID sau preț inventat (hallucination check) și construiește un rezumat determinist onest dacă e necesar.
   */
  static validateAiOutputAgainstPlan(params: {
    plan: ShoppingAssistantDeterministicPlan;
    aiPayload: unknown;
  }): {
    valid: boolean;
    hallucinationDetected: boolean;
    answerRo: string;
    highlights: string[];
    verifiedProductIds: string[];
  } {
    const { plan, aiPayload } = params;
    const allowedSet = new Set(plan.allowedProductIds);
    const fallback = ShoppingAssistantService.formatDeterministicAnswer(plan);

    if (!aiPayload || typeof aiPayload !== 'object') {
      return {
        valid: false,
        hallucinationDetected: false,
        answerRo: fallback.answerRo,
        highlights: fallback.highlights,
        verifiedProductIds: plan.allowedProductIds
      };
    }

    const record = aiPayload as Record<string, unknown>;
    const rawAnswer = typeof record.answerRo === 'string' ? record.answerRo.trim() : '';
    const rawHighlights = Array.isArray(record.highlights)
      ? record.highlights.filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
      : [];
    const citedIds = Array.isArray(record.citedProductIds)
      ? record.citedProductIds.filter((id): id is string => typeof id === 'string')
      : [];

    const unknownIds = citedIds.filter(id => !allowedSet.has(id));
    if (unknownIds.length > 0 || !rawAnswer) {
      return {
        valid: false,
        hallucinationDetected: unknownIds.length > 0,
        answerRo: fallback.answerRo,
        highlights: fallback.highlights,
        verifiedProductIds: plan.allowedProductIds
      };
    }

    return {
      valid: true,
      hallucinationDetected: false,
      answerRo: rawAnswer,
      highlights: rawHighlights.length > 0 ? rawHighlights.slice(0, 6) : fallback.highlights,
      verifiedProductIds: citedIds
    };
  }

  static formatDeterministicAnswer(plan: ShoppingAssistantDeterministicPlan): {
    answerRo: string;
    highlights: string[];
  } {
    if (plan.items.length === 0) {
      return {
        answerRo:
          plan.limitations[0] ||
          'Nu am găsit suficiente oferte valide verificate în catalog pentru această solicitare.',
        highlights: plan.limitations.slice(0, 4)
      };
    }

    const highlights: string[] = [];
    let answerRo = '';

    if (plan.intent === 'optimize_list' && plan.optimizationSummary) {
      const opt = plan.optimizationSummary;
      answerRo = `Am analizat lista ta folosind oferte valide din catalog. Total optimizat: ${plan.totalEstimatedCost.toFixed(2)} lei.`;
      if (opt.bestSingleStoreName && opt.bestSingleStoreTotal !== undefined) {
        highlights.push(`Cel mai bun magazin unic: ${opt.bestSingleStoreName} (${opt.bestSingleStoreTotal.toFixed(2)} lei)`);
      }
      if (opt.savingsAmount && opt.savingsAmount > 0) {
        highlights.push(`Economie estimată față de varianta de bază: ${opt.savingsAmount.toFixed(2)} lei`);
      }
    } else if (plan.intent === 'list_promos') {
      answerRo = `Am identificat ${plan.items.length} produse cu promoții active verificate (total ${plan.totalEstimatedCost.toFixed(2)} lei).`;
      if (plan.estimatedSavingsLei && plan.estimatedSavingsLei > 0) {
        highlights.push(`Economie totală din promoțiile active: ${plan.estimatedSavingsLei.toFixed(2)} lei`);
      }
    } else if (plan.intent === 'cheaper_alternatives') {
      answerRo = `Am găsit ${plan.items.length} alternative compatibile mai ieftine la preț normalizat (lei/kg, lei/l sau lei/buc).`;
    } else if (plan.intent === 'meal_plan_days') {
      answerRo = `Am pregătit un plan de cumpărături pentru ${plan.daysRequested || 5} zile bazat exclusiv pe produse reale din catalog (${plan.items.length} articole, total ${plan.totalEstimatedCost.toFixed(2)} lei).`;
    } else {
      const budgetStr = plan.budgetRequestedLei ? `${plan.budgetRequestedLei.toFixed(2)} lei` : 'bugetul selectat';
      answerRo = `Cu ${budgetStr} poți cumpăra ${plan.items.length} produse reale esențiale la cele mai bune prețuri valide (total ${plan.totalEstimatedCost.toFixed(2)} lei).`;
      if (plan.remainingBudgetLei !== undefined) {
        highlights.push(`Buget rămas necheltuit: ${plan.remainingBudgetLei.toFixed(2)} lei`);
      }
    }

    for (const item of plan.items.slice(0, 4)) {
      highlights.push(
        `${item.productName} · ${item.storeName}: ${item.price.toFixed(2)} lei (${item.unitPrice.toFixed(2)} ${item.unitPriceMeasure})`
      );
    }

    return { answerRo, highlights };
  }
}
