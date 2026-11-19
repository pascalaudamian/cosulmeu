// src/services/BasketOptimizerService.ts
// Motor V1 de optimizare a coșului de cumpărături (1 magazin vs multi-magazin)
// Reguli stricte: fără prețuri inventate, fără costuri de transport inventate,
// normalizare strictă a unităților, potrivire sigură și comparabilitate validă.

import type {
  BasketItemAllocation,
  BasketMatchConfidence,
  BasketMissingPriceItem,
  BasketMultiStorePlan,
  BasketMultiStoreStop,
  BasketOptimizationOptions,
  BasketOptimizationResult,
  BasketSingleStorePlan,
  BasketUnconfidentMatch,
  BasketUnitConflict,
  PriceDataQualityAssessment,
  Product,
  ProductOffer,
  ShoppingList,
  ShoppingListItem,
  Store,
  UnitType
} from '../types.js';
import { PRODUCTS, PRODUCT_OFFERS, STORES } from '../data/mockData.js';
import { PriceQualityClassifier } from './PriceQualityClassifier.js';

function normalizeStoreKey(value: string): string {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/^store-/, '')
    .replace(/-chain$/, '')
    .replace(/[^a-z0-9-]/g, '');
}

function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUnitToken(unit?: string): UnitType {
  const clean = (unit || 'buc').toLowerCase().trim();
  if (clean === 'kg' || clean === 'g' || clean === 'l' || clean === 'ml' || clean === 'pachet' || clean === 'buc') {
    return clean;
  }
  return 'buc';
}

function getUnitDimension(unit: UnitType): 'mass' | 'volume' | 'count' {
  if (unit === 'g' || unit === 'kg') return 'mass';
  if (unit === 'ml' || unit === 'l') return 'volume';
  return 'count';
}

function toBaseAmount(quantity: number, unit: UnitType): number {
  if (unit === 'kg' || unit === 'l') return quantity * 1000; // in grams / ml
  return quantity;
}

function offerEffectiveDateIso(offer: ProductOffer): string | null {
  const candidate = offer.lastVerifiedAt || offer.lastChecked || offer.observationDate;
  if (!candidate) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(candidate.trim())
    ? `${candidate.trim()}T12:00:00.000Z`
    : candidate.trim();
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

interface ResolvedListEntry {
  representativeItem: ShoppingListItem;
  aggregatedQuantity: number;
  mergedOccurrencesCount: number;
  product: Product;
  matchConfidence: BasketMatchConfidence;
}

export class BasketOptimizerService {
  static canonicalizeStores(stores: Store[]): Store[] {
    const map = new Map<string, Store>();
    for (const st of stores) {
      if (!st?.id || st.id === 'validation-only-retailer' || st.slug === 'validation-only-retailer') {
        continue;
      }
      const key = normalizeStoreKey(st.slug || st.id);
      if (!key) continue;
      const existing = map.get(key);
      if (!existing || (existing.id !== key && st.id === key)) {
        map.set(key, st);
      }
    }
    return Array.from(map.values());
  }

  /**
   * Potrivire strictă cu detectarea cazurilor incerte/ambigue.
   */
  static matchItemToProduct(
    item: ShoppingListItem,
    products: Product[]
  ): {
    status: 'matched' | 'unconfident';
    product?: Product;
    confidence?: BasketMatchConfidence;
    reasonRo?: string;
    candidates?: Array<{ id: string; name: string; brand: string }>;
  } {
    if (item.barcode && item.barcode.trim()) {
      const cleanBarcode = item.barcode.trim();
      const byBarcode = products.find(p => p.barcode && p.barcode.trim() === cleanBarcode);
      if (byBarcode) {
        return { status: 'matched', product: byBarcode, confidence: 'exact_ean' };
      }
    }

    if (item.productId) {
      const byId = products.find(p => p.id === item.productId);
      if (byId) {
        return { status: 'matched', product: byId, confidence: 'exact_id' };
      }
    }

    const cleanItemName = normalizeText(item.name);
    if (!cleanItemName) {
      return {
        status: 'unconfident',
        reasonRo: 'Produsul nu are o denumire validă pentru asocierea în catalog.'
      };
    }

    // Exact normalized name match (single candidate)
    const exactMatches = products.filter(p => normalizeText(p.name) === cleanItemName);
    if (exactMatches.length === 1) {
      return { status: 'matched', product: exactMatches[0], confidence: 'exact_name' };
    }
    if (exactMatches.length > 1) {
      // Disambiguate by brand if provided
      if (item.brand) {
        const brandKey = normalizeText(item.brand);
        const byBrand = exactMatches.filter(p => normalizeText(p.brand) === brandKey);
        if (byBrand.length === 1) {
          return { status: 'matched', product: byBrand[0], confidence: 'exact_name' };
        }
      }
      return {
        status: 'unconfident',
        reasonRo: `Există ${exactMatches.length} produse cu denumirea exactă „${item.name}” în catalog; selectează produsul exact.`,
        candidates: exactMatches.slice(0, 4).map(p => ({ id: p.id, name: p.name, brand: p.brand }))
      };
    }

    // Token similarity check: strict, requires high token overlap and ZERO ambiguity
    const itemTokens = cleanItemName.split(' ').filter(t => t.length >= 2);
    if (itemTokens.length >= 2) {
      const scored = products
        .map(p => {
          const fullText = normalizeText(`${p.name} ${p.brand}`);
          const pTokens = fullText.split(' ').filter(t => t.length >= 2);
          const matchedTokens = itemTokens.filter(t => pTokens.includes(t));
          const coverage = matchedTokens.length / itemTokens.length;
          const reverseCoverage = matchedTokens.length / Math.max(1, pTokens.length);
          const brandMatch = item.brand ? normalizeText(p.brand) === normalizeText(item.brand) : false;
          return {
            product: p,
            coverage,
            reverseCoverage,
            combined: coverage * 0.65 + reverseCoverage * 0.35 + (brandMatch ? 0.15 : 0)
          };
        })
        .filter(entry => entry.coverage >= 0.8 && entry.reverseCoverage >= 0.5)
        .sort((a, b) => b.combined - a.combined);

      if (scored.length === 1 && scored[0].combined >= 0.72) {
        return { status: 'matched', product: scored[0].product, confidence: 'high_token' };
      }
      if (scored.length > 1) {
        // Only auto-pick if clear margin between #1 and #2
        if (scored[0].combined >= 0.85 && scored[0].combined - scored[1].combined >= 0.25) {
          return { status: 'matched', product: scored[0].product, confidence: 'high_token' };
        }
        return {
          status: 'unconfident',
          reasonRo: `Potrivire ambiguă pentru „${item.name}”: mai multe variante posibile în catalog.`,
          candidates: scored.slice(0, 4).map(s => ({ id: s.product.id, name: s.product.name, brand: s.product.brand }))
        };
      }
    }

    return {
      status: 'unconfident',
      reasonRo: `Nu am găsit un produs exact asociat pentru „${item.name}” (matching nesigur — selectează produsul din catalog).`
    };
  }

  /**
   * Calculează costul normalizat verificând strict compatibilitatea unităților/gramajelor.
   */
  static computeNormalizedItemCost(params: {
    quantity: number;
    requestedUnit: UnitType;
    product: Product;
    offer: ProductOffer;
    useLoyaltyCards: boolean;
  }):
    | {
        compatible: true;
        calculatedPrice: number;
        effectiveUnitPrice: number;
        unitPriceDisplay: string;
        loyaltyApplied: boolean;
        loyaltyCardName?: string;
      }
    | {
        compatible: false;
        reasonRo: string;
      } {
    const { quantity, product, offer, useLoyaltyCards } = params;
    const requestedUnit = normalizeUnitToken(params.requestedUnit);
    const pkgUnit = normalizeUnitToken(product.packageUnit || product.defaultUnit);
    const normUnit = normalizeUnitToken(product.normalizedUnit || pkgUnit);
    const pkgWeight = Number(product.packageWeightOrVolume);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { compatible: false, reasonRo: 'Cantitatea din listă trebuie să fie mai mare ca 0.' };
    }

    // Respect loyalty card price gating
    let effectivePackPrice = offer.price;
    let loyaltyApplied = false;
    if (offer.loyaltyCardRequired) {
      if (useLoyaltyCards) {
        loyaltyApplied = true;
        effectivePackPrice = offer.loyaltyPrice && offer.loyaltyPrice > 0 ? offer.loyaltyPrice : offer.price;
      } else {
        effectivePackPrice = offer.normalPrice || offer.originalPrice || offer.price;
      }
    }

    const reqDim = getUnitDimension(requestedUnit);
    const pkgDim = getUnitDimension(pkgUnit);
    const normDim = getUnitDimension(normUnit);

    let calculatedPrice = 0;

    // 1. User requests discrete packages ('buc' or 'pachet') -> multiply package count by pack price
    if (requestedUnit === 'buc' || requestedUnit === 'pachet') {
      calculatedPrice = quantity * effectivePackPrice;
    }
    // 2. Compatible physical dimensions (mass: g/kg or volume: ml/l)
    else if (reqDim === pkgDim && Number.isFinite(pkgWeight) && pkgWeight > 0) {
      const requestedBase = toBaseAmount(quantity, requestedUnit);
      const packageBase = toBaseAmount(pkgWeight, pkgUnit);
      if (packageBase <= 0) {
        return {
          compatible: false,
          reasonRo: `Gramajul produsului „${product.name}” nu permite conversia automată.`
        };
      }
      const packFraction = requestedBase / packageBase;
      calculatedPrice = packFraction * effectivePackPrice;
    }
    // 3. Compatible with product.normalizedUnit (when packageUnit differs only in default)
    else if (reqDim === normDim && Number.isFinite(pkgWeight) && pkgWeight > 0 && pkgDim === normDim) {
      const requestedBase = toBaseAmount(quantity, requestedUnit);
      const packageBase = toBaseAmount(pkgWeight, pkgUnit);
      calculatedPrice = (requestedBase / packageBase) * effectivePackPrice;
    } else {
      return {
        compatible: false,
        reasonRo: `Unitatea cerută (${requestedUnit}) este incompatibilă cu ambalajul produsului „${product.name}” (${pkgWeight} ${pkgUnit}).`
      };
    }

    const roundedTotal = Math.round(calculatedPrice * 100) / 100;
    const unitMeasureLabel = offer.unitPriceMeasure || `lei/${normUnit}`;
    let displayUnitPrice = offer.unitPrice;
    if (offer.loyaltyCardRequired && !useLoyaltyCards && offer.price > 0 && offer.unitPrice > 0) {
      displayUnitPrice = Math.round(offer.unitPrice * (effectivePackPrice / offer.price) * 100) / 100;
    }

    return {
      compatible: true,
      calculatedPrice: roundedTotal,
      effectiveUnitPrice: Math.round(effectivePackPrice * 100) / 100,
      unitPriceDisplay: `${displayUnitPrice.toFixed(2).replace('.', ',')} ${unitMeasureLabel}`,
      loyaltyApplied,
      loyaltyCardName: loyaltyApplied ? offer.loyaltyCardName : undefined
    };
  }

  /**
   * Filtrează ofertele prin clasificatorul centralizat (exclude expirate, anomalii, demo, respinse, preț <= 0).
   */
  static evaluateStoreOfferForProduct(params: {
    product: Product;
    store: Store;
    offers: ProductOffer[];
    includeStaleOffers: boolean;
    now: Date;
  }): { offer: ProductOffer; assessment: PriceDataQualityAssessment } | null {
    const targetStoreKey = normalizeStoreKey(params.store.slug || params.store.id);
    const targetStoreIdKey = normalizeStoreKey(params.store.id);

    const matchingOffers = params.offers.filter(o => {
      if (o.productId !== params.product.id) return false;
      const offerStoreKey = normalizeStoreKey(o.storeId);
      return (
        o.storeId === params.store.id ||
        offerStoreKey === targetStoreIdKey ||
        offerStoreKey === targetStoreKey
      );
    });

    const evaluated = matchingOffers
      .map(offer => ({
        offer,
        assessment: PriceQualityClassifier.classifyOffer(offer, {
          product: params.product,
          now: params.now
        })
      }))
      .filter(({ assessment }) => {
        if (!assessment.isUsableForComparison) return false;
        if (!params.includeStaleOffers && assessment.status === 'STALE') return false;
        return true;
      })
      .sort((a, b) => {
        // Prefer reliable verified offers first, then lowest price, then freshest score
        if (a.assessment.isReliableForOptimization !== b.assessment.isReliableForOptimization) {
          return a.assessment.isReliableForOptimization ? -1 : 1;
        }
        if (a.offer.price !== b.offer.price) {
          return a.offer.price - b.offer.price;
        }
        return b.assessment.score - a.assessment.score;
      });

    return evaluated[0] || null;
  }

  static optimize(params: {
    items: ShoppingListItem[];
    list?: Pick<ShoppingList, 'id' | 'name'>;
    products?: Product[];
    offers?: ProductOffer[];
    stores?: Store[];
    options?: BasketOptimizationOptions;
  }): BasketOptimizationResult {
    const now = params.options?.now || new Date();
    const useLoyaltyCards = params.options?.useLoyaltyCards ?? true;
    const includeStaleOffers = params.options?.includeStaleOffers ?? true;
    const maxStoresApplied = Math.max(1, Math.min(8, Math.floor(params.options?.maxStores ?? 3)));
    // Regula strictă: nu inventăm costuri de transport. Implicit = 0.
    const transportCostPerExtraStore = Math.max(0, Number(params.options?.transportCostPerExtraStore ?? 0) || 0);

    const allProducts = params.products && params.products.length > 0 ? params.products : PRODUCTS;
    const allOffers = params.offers !== undefined ? params.offers : PRODUCT_OFFERS;
    const rawStores = params.stores && params.stores.length > 0 ? params.stores : STORES;
    const canonicalStores = this.canonicalizeStores(rawStores);

    const excludedSet = new Set((params.options?.excludedStoreIds || []).map(normalizeStoreKey));
    const favoriteSet = new Set((params.options?.favoriteStoreIds || []).map(normalizeStoreKey));

    const eligibleStores = canonicalStores.filter(
      s => !excludedSet.has(normalizeStoreKey(s.id)) && !excludedSet.has(normalizeStoreKey(s.slug || s.id))
    );

    const activeItems = (params.items || []).filter(i => !i.checked && Number(i.quantity) > 0);
    const itemsToProcess = activeItems.length > 0 ? activeItems : (params.items || []).filter(i => Number(i.quantity) > 0);

    // 1. Match catalog & detect unconfident / duplicate lines
    const unconfidentMatches: BasketUnconfidentMatch[] = [];
    const resolvedByKey = new Map<string, ResolvedListEntry>();
    let duplicateLinesMergedCount = 0;

    for (const item of itemsToProcess) {
      const match = this.matchItemToProduct(item, allProducts);
      if (match.status !== 'matched' || !match.product || !match.confidence) {
        unconfidentMatches.push({
          item,
          reasonRo: match.reasonRo || 'Asociere incertă în catalog.',
          candidateProducts: match.candidates
        });
        continue;
      }

      const normUnit = normalizeUnitToken(item.unit);
      const pkgUnit = normalizeUnitToken(match.product.packageUnit || match.product.defaultUnit);
      const itemDim = getUnitDimension(normUnit);
      const pkgDim = getUnitDimension(pkgUnit);

      // Merge duplicate lines for the same product across compatible dimensions (e.g. 500 g + 0.5 kg)
      const canCanonicalizeToPkg =
        (itemDim === 'mass' || itemDim === 'volume') && itemDim === pkgDim;
      const canonicalMergeUnit: UnitType = canCanonicalizeToPkg ? pkgUnit : normUnit;
      const normalizedQty = canCanonicalizeToPkg
        ? pkgUnit === 'kg' || pkgUnit === 'l'
          ? toBaseAmount(item.quantity, normUnit) / 1000
          : toBaseAmount(item.quantity, normUnit)
        : item.quantity;

      const mergeKey = `${match.product.id}::${canonicalMergeUnit}`;
      const existing = resolvedByKey.get(mergeKey);
      if (existing) {
        existing.aggregatedQuantity =
          Math.round((existing.aggregatedQuantity + normalizedQty) * 1000) / 1000;
        existing.mergedOccurrencesCount += 1;
        duplicateLinesMergedCount += 1;
      } else {
        resolvedByKey.set(mergeKey, {
          representativeItem:
            canonicalMergeUnit === normUnit
              ? item
              : { ...item, unit: canonicalMergeUnit, quantity: normalizedQty },
          aggregatedQuantity: Math.round(normalizedQty * 1000) / 1000,
          mergedOccurrencesCount: 1,
          product: match.product,
          matchConfidence: match.confidence
        });
      }
    }

    const resolvedEntries = Array.from(resolvedByKey.values());
    const unitConflicts: BasketUnitConflict[] = [];
    const comparableEntries: ResolvedListEntry[] = [];

    // Pre-check unit compatibility against product metadata even before checking stores
    for (const entry of resolvedEntries) {
      const syntheticProbeOffer: ProductOffer = {
        id: 'probe',
        productId: entry.product.id,
        storeId: 'probe',
        price: 1,
        unitPrice: 1,
        unitPriceMeasure: `lei/${entry.product.normalizedUnit || 'buc'}`,
        isPromo: false,
        observationDate: now.toISOString().slice(0, 10),
        source: 'verified',
        confidenceLevel: 'high',
        verificationStatus: 'verified',
        lastChecked: now.toISOString()
      };
      const unitCheck = this.computeNormalizedItemCost({
        quantity: entry.aggregatedQuantity,
        requestedUnit: normalizeUnitToken(entry.representativeItem.unit),
        product: entry.product,
        offer: syntheticProbeOffer,
        useLoyaltyCards
      });
      if (!unitCheck.compatible) {
        unitConflicts.push({
          item: entry.representativeItem,
          product: entry.product,
          reasonRo: unitCheck.reasonRo
        });
      } else {
        comparableEntries.push(entry);
      }
    }

    // 2. Build store-by-item matrix of valid allocations
    const allocationsByStoreId = new Map<string, Map<string, BasketItemAllocation>>();
    for (const store of eligibleStores) {
      const storeMap = new Map<string, BasketItemAllocation>();
      for (const entry of comparableEntries) {
        const entryKey = `${entry.product.id}::${normalizeUnitToken(entry.representativeItem.unit)}`;
        const best = this.evaluateStoreOfferForProduct({
          product: entry.product,
          store,
          offers: allOffers,
          includeStaleOffers,
          now
        });
        if (!best) continue;

        const cost = this.computeNormalizedItemCost({
          quantity: entry.aggregatedQuantity,
          requestedUnit: normalizeUnitToken(entry.representativeItem.unit),
          product: entry.product,
          offer: best.offer,
          useLoyaltyCards
        });
        if (!cost.compatible) continue;

        storeMap.set(entryKey, {
          item: entry.representativeItem,
          aggregatedQuantity: entry.aggregatedQuantity,
          mergedOccurrencesCount: entry.mergedOccurrencesCount,
          product: entry.product,
          matchConfidence: entry.matchConfidence,
          offer: best.offer,
          qualityAssessment: best.assessment,
          store,
          effectiveUnitPrice: cost.effectiveUnitPrice,
          calculatedPrice: cost.calculatedPrice,
          unitPriceDisplay: cost.unitPriceDisplay,
          loyaltyApplied: cost.loyaltyApplied,
          loyaltyCardName: cost.loyaltyCardName
        });
      }
      allocationsByStoreId.set(store.id, storeMap);
    }

    // Identify items with NO valid offer across ANY eligible store
    const itemsWithoutAnyValidPrice: BasketMissingPriceItem[] = [];
    const priceableEntries: ResolvedListEntry[] = [];
    for (const entry of comparableEntries) {
      const entryKey = `${entry.product.id}::${normalizeUnitToken(entry.representativeItem.unit)}`;
      const hasAnyStore = eligibleStores.some(s => allocationsByStoreId.get(s.id)?.has(entryKey));
      if (!hasAnyStore) {
        itemsWithoutAnyValidPrice.push({
          item: entry.representativeItem,
          product: entry.product,
          reasonRo: 'Nu există nicio ofertă activă și validă în magazinele eligibile pentru acest produs.'
        });
      } else {
        priceableEntries.push(entry);
      }
    }

    // 3. Single-Store Plans Ranking
    const singleStoreRankings: BasketSingleStorePlan[] = eligibleStores
      .map(store => {
        const storeAllocMap = allocationsByStoreId.get(store.id) || new Map<string, BasketItemAllocation>();
        const allocations: BasketItemAllocation[] = [];
        const missingItems: BasketMissingPriceItem[] = [];
        let totalPrice = 0;
        let loyaltySavings = 0;
        const verifiedDates: string[] = [];

        for (const entry of comparableEntries) {
          const entryKey = `${entry.product.id}::${normalizeUnitToken(entry.representativeItem.unit)}`;
          const alloc = storeAllocMap.get(entryKey);
          if (alloc) {
            allocations.push(alloc);
            totalPrice += alloc.calculatedPrice;
            if (alloc.loyaltyApplied && alloc.offer.originalPrice && alloc.offer.originalPrice > alloc.offer.price) {
              const normalRatio = alloc.offer.originalPrice / Math.max(0.01, alloc.offer.price);
              loyaltySavings += Math.max(0, alloc.calculatedPrice * (normalRatio - 1));
            }
            const iso = alloc.qualityAssessment.lastVerifiedAt || offerEffectiveDateIso(alloc.offer);
            if (iso) verifiedDates.push(iso);
          } else {
            missingItems.push({
              item: entry.representativeItem,
              product: entry.product,
              reasonRo: `Produs indisponibil sau fără preț valid activ la ${store.name}.`
            });
          }
        }

        verifiedDates.sort();
        const totalComparable = comparableEntries.length;
        const covered = allocations.length;
        const completenessPercentage =
          totalComparable > 0 ? Math.round((covered / totalComparable) * 100) : 0;
        const hasIssues =
          missingItems.length > 0 ||
          unconfidentMatches.length > 0 ||
          unitConflicts.length > 0 ||
          allocations.some(a => !a.qualityAssessment.isReliableForOptimization);

        const isFav =
          favoriteSet.has(normalizeStoreKey(store.id)) ||
          favoriteSet.has(normalizeStoreKey(store.slug || store.id));

        return {
          store,
          isFavorite: isFav,
          allocations,
          missingItems,
          coveredItemsCount: covered,
          totalComparableItemsCount: totalComparable,
          completenessPercentage,
          isComplete:
            covered === totalComparable &&
            totalComparable > 0 &&
            unconfidentMatches.length === 0 &&
            unitConflicts.length === 0,
          isEstimative: covered === 0 || hasIssues,
          totalPrice: Math.round(totalPrice * 100) / 100,
          loyaltySavings: Math.round(loyaltySavings * 100) / 100,
          lastVerifiedAt: verifiedDates.length ? verifiedDates[verifiedDates.length - 1] : null,
          oldestVerifiedAt: verifiedDates.length ? verifiedDates[0] : null,
          savingsVsWorstStore: null
        };
      })
      .filter(plan => plan.coveredItemsCount > 0)
      .sort((a, b) => {
        // 1. Prioritize higher item coverage (complete basket > partial basket)
        if (b.coveredItemsCount !== a.coveredItemsCount) {
          return b.coveredItemsCount - a.coveredItemsCount;
        }
        // 2. Lowest real product total
        if (Math.abs(a.totalPrice - b.totalPrice) > 0.009) {
          return a.totalPrice - b.totalPrice;
        }
        // 3. Favorite store tie-breaker
        if (a.isFavorite !== b.isFavorite) {
          return a.isFavorite ? -1 : 1;
        }
        return a.store.name.localeCompare(b.store.name, 'ro');
      });

    // Compute valid single-store savings ONLY against comparable stores with same coverage
    if (singleStoreRankings.length >= 2) {
      const best = singleStoreRankings[0];
      const sameCoveragePlans = singleStoreRankings.filter(p => p.coveredItemsCount === best.coveredItemsCount);
      if (sameCoveragePlans.length >= 2) {
        const worstTotal = Math.max(...sameCoveragePlans.map(p => p.totalPrice));
        for (const plan of sameCoveragePlans) {
          plan.savingsVsWorstStore = Math.max(0, Math.round((worstTotal - plan.totalPrice) * 100) / 100);
        }
      }
    }

    const bestSingleStore = singleStoreRankings[0] || null;

    // 4. Exact Combinatorial Solver for k stores (2, 3, or maxStoresApplied)
    const solveForMaxStores = (limitK: number): BasketMultiStorePlan | null => {
      if (priceableEntries.length === 0 || eligibleStores.length === 0) return null;

      // Keep only stores that carry at least one priceable item
      const usefulStores = eligibleStores.filter(st => {
        const map = allocationsByStoreId.get(st.id);
        return map && map.size > 0;
      });
      if (usefulStores.length === 0) return null;

      const effectiveLimit = Math.min(limitK, usefulStores.length);

      interface CandidateSolution {
        storeIndices: number[];
        coveredCount: number;
        totalProductsCost: number;
        favCount: number;
        totalWithTransport: number;
        allocsByEntryKey: Map<string, BasketItemAllocation>;
      }

      let bestSolution: CandidateSolution | null = null;

      const evaluateSubset = (indices: number[]) => {
        const allocsByEntryKey = new Map<string, BasketItemAllocation>();
        let totalProductsCost = 0;

        for (const entry of priceableEntries) {
          const entryKey = `${entry.product.id}::${normalizeUnitToken(entry.representativeItem.unit)}`;
          let cheapest: BasketItemAllocation | null = null;
          for (const idx of indices) {
            const store = usefulStores[idx];
            const alloc = allocationsByStoreId.get(store.id)?.get(entryKey);
            if (!alloc) continue;
            if (!cheapest) {
              cheapest = alloc;
            } else if (alloc.calculatedPrice < cheapest.calculatedPrice - 0.001) {
              cheapest = alloc;
            } else if (Math.abs(alloc.calculatedPrice - cheapest.calculatedPrice) <= 0.001) {
              const allocFav = favoriteSet.has(normalizeStoreKey(alloc.store.id));
              const cheapFav = favoriteSet.has(normalizeStoreKey(cheapest.store.id));
              if (allocFav && !cheapFav) cheapest = alloc;
            }
          }
          if (cheapest) {
            allocsByEntryKey.set(entryKey, cheapest);
            totalProductsCost += cheapest.calculatedPrice;
          }
        }

        // Count actually used stores (no empty stops)
        const usedStoreIds = new Set<string>();
        for (const alloc of allocsByEntryKey.values()) {
          usedStoreIds.add(alloc.store.id);
        }
        const actualStopsCount = usedStoreIds.size;
        if (actualStopsCount === 0) return;

        const extraStops = Math.max(0, actualStopsCount - 1);
        const totalWithTransport = Math.round((totalProductsCost + extraStops * transportCostPerExtraStore) * 100) / 100;
        const roundedProducts = Math.round(totalProductsCost * 100) / 100;
        const coveredCount = allocsByEntryKey.size;
        const favCount = Array.from(usedStoreIds).filter(id => favoriteSet.has(normalizeStoreKey(id))).length;

        const isBetter = (): boolean => {
          if (!bestSolution) return true;
          // 1. Maximize covered products
          if (coveredCount !== bestSolution.coveredCount) {
            return coveredCount > bestSolution.coveredCount;
          }
          // 2. Minimize total cost (with transport if caller provided it, else pure product cost)
          if (Math.abs(totalWithTransport - bestSolution.totalWithTransport) > 0.009) {
            return totalWithTransport < bestSolution.totalWithTransport;
          }
          // 3. Fewer stores if tied on cost
          const bestUsedCount = new Set(Array.from(bestSolution.allocsByEntryKey.values()).map(a => a.store.id)).size;
          if (actualStopsCount !== bestUsedCount) {
            return actualStopsCount < bestUsedCount;
          }
          // 4. More favorite stores
          return favCount > bestSolution.favCount;
        };

        if (isBetter()) {
          bestSolution = {
            storeIndices: indices,
            coveredCount,
            totalProductsCost: roundedProducts,
            favCount,
            totalWithTransport,
            allocsByEntryKey
          };
        }
      };

      // Generate subsets up to effectiveLimit (capped safely if many stores exist)
      const cappedStores = usefulStores.length <= 12 ? usefulStores : usefulStores.slice(0, 12);
      const backtrack = (start: number, current: number[], targetLen: number) => {
        if (current.length === targetLen) {
          evaluateSubset([...current]);
          return;
        }
        for (let i = start; i < cappedStores.length; i++) {
          current.push(i);
          backtrack(i + 1, current, targetLen);
          current.pop();
        }
      };

      for (let len = 1; len <= Math.min(effectiveLimit, cappedStores.length); len++) {
        backtrack(0, [], len);
      }

      if (!bestSolution) return null;
      const sol = bestSolution as CandidateSolution;

      // Group allocations by used store
      const stopMap = new Map<string, BasketItemAllocation[]>();
      const verifiedDates: string[] = [];
      for (const alloc of sol.allocsByEntryKey.values()) {
        const arr = stopMap.get(alloc.store.id) || [];
        arr.push(alloc);
        stopMap.set(alloc.store.id, arr);
        const iso = alloc.qualityAssessment.lastVerifiedAt || offerEffectiveDateIso(alloc.offer);
        if (iso) verifiedDates.push(iso);
      }
      verifiedDates.sort();

      const stops: BasketMultiStoreStop[] = Array.from(stopMap.entries())
        .map(([storeId, allocs]) => {
          const store = allocs[0].store;
          const subtotal = Math.round(allocs.reduce((s, a) => s + a.calculatedPrice, 0) * 100) / 100;
          const dates = allocs
            .map(a => a.qualityAssessment.lastVerifiedAt || offerEffectiveDateIso(a.offer))
            .filter((d): d is string => Boolean(d))
            .sort();
          return {
            store,
            isFavorite:
              favoriteSet.has(normalizeStoreKey(storeId)) ||
              favoriteSet.has(normalizeStoreKey(store.slug || storeId)),
            allocations: allocs,
            subtotal,
            itemsCount: allocs.length,
            lastVerifiedAt: dates.length ? dates[dates.length - 1] : null
          };
        })
        .sort((a, b) => b.subtotal - a.subtotal);

      const missingItems: BasketMissingPriceItem[] = [...itemsWithoutAnyValidPrice];
      for (const entry of priceableEntries) {
        const entryKey = `${entry.product.id}::${normalizeUnitToken(entry.representativeItem.unit)}`;
        if (!sol.allocsByEntryKey.has(entryKey)) {
          missingItems.push({
            item: entry.representativeItem,
            product: entry.product,
            reasonRo: `Nu a putut fi acoperit în limita a ${limitK} magazine.`
          });
        }
      }

      // Compute comparable baseline savings ONLY over exact shared items covered by bestSingleStore AND this multi-store plan
      let hasValidSavingsBaseline = false;
      let savingsVsBestSingleStore: number | null = null;
      let savingsPercentVsBestSingleStore: number | null = null;
      let comparableItemsCountWithBaseline = 0;

      if (bestSingleStore) {
        const singleByKey = new Map<string, BasketItemAllocation>(
          bestSingleStore.allocations.map(a => [
            `${a.product.id}::${normalizeUnitToken(a.item.unit)}`,
            a
          ])
        );

        let baselineSharedTotal = 0;
        let multiSharedTotal = 0;

        for (const [entryKey, multiAlloc] of sol.allocsByEntryKey.entries()) {
          const singleAlloc = singleByKey.get(entryKey);
          if (singleAlloc) {
            comparableItemsCountWithBaseline += 1;
            baselineSharedTotal += singleAlloc.calculatedPrice;
            multiSharedTotal += multiAlloc.calculatedPrice;
          }
        }

        // Baseline is strictly valid when baseline covers all items covered by multiStore (same basket comparison)
        // OR clearly represents the full single-store winner when both cover identical items
        if (
          comparableItemsCountWithBaseline > 0 &&
          comparableItemsCountWithBaseline === sol.allocsByEntryKey.size &&
          baselineSharedTotal > 0
        ) {
          hasValidSavingsBaseline = true;
          const extraTransport = Math.max(0, stops.length - 1) * transportCostPerExtraStore;
          const netDiff = Math.round((baselineSharedTotal - (multiSharedTotal + extraTransport)) * 100) / 100;
          savingsVsBestSingleStore = netDiff;
          savingsPercentVsBestSingleStore = Math.round((netDiff / baselineSharedTotal) * 1000) / 10;
        }
      }

      const totalTransportCost = Math.round(Math.max(0, stops.length - 1) * transportCostPerExtraStore * 100) / 100;
      const isEstimative =
        missingItems.length > 0 ||
        unconfidentMatches.length > 0 ||
        unitConflicts.length > 0 ||
        Array.from(sol.allocsByEntryKey.values()).some(a => !a.qualityAssessment.isReliableForOptimization);

      const explanationParts: string[] = [];
      if (stops.length === 1) {
        explanationParts.push(
          `Cel mai bun rezultat pentru limita de ${limitK} ${limitK === 1 ? 'magazin' : 'magazine'} este într-un singur magazin (${stops[0].store.name}: ${sol.totalProductsCost.toFixed(2).replace('.', ',')} lei).`
        );
      } else {
        explanationParts.push(
          `Împărțirea între ${stops.length} magazine acoperă ${sol.coveredCount}/${comparableEntries.length} produse cu total de ${sol.totalProductsCost.toFixed(2).replace('.', ',')} lei.`
        );
        if (hasValidSavingsBaseline && savingsVsBestSingleStore !== null) {
          if (savingsVsBestSingleStore > 0.01) {
            explanationParts.push(
              `Economie la produse de ${savingsVsBestSingleStore.toFixed(2).replace('.', ',')} lei (${savingsPercentVsBestSingleStore}%) față de cel mai bun magazin unic (${bestSingleStore?.store.name}).`
            );
          } else {
            explanationParts.push(
              `Costul la produse este egal cu varianta într-un singur magazin (${bestSingleStore?.store.name}).`
            );
          }
        }
      }

      return {
        storeCount: stops.length,
        maxStoresLimit: limitK,
        stops,
        coveredItemsCount: sol.coveredCount,
        totalComparableItemsCount: comparableEntries.length,
        missingItems,
        isComplete:
          sol.coveredCount === comparableEntries.length &&
          comparableEntries.length > 0 &&
          unconfidentMatches.length === 0 &&
          unitConflicts.length === 0,
        isEstimative,
        productsTotal: sol.totalProductsCost,
        transportCost: totalTransportCost,
        includesTransportCost: transportCostPerExtraStore > 0,
        totalWithTransport: sol.totalWithTransport,
        baselineSingleStore: bestSingleStore,
        comparableItemsCountWithBaseline,
        hasValidSavingsBaseline,
        savingsVsBestSingleStore,
        savingsPercentVsBestSingleStore,
        lastVerifiedAt: verifiedDates.length ? verifiedDates[verifiedDates.length - 1] : null,
        oldestVerifiedAt: verifiedDates.length ? verifiedDates[0] : null,
        explanationRo: explanationParts.join(' ')
      };
    };

    const bestTwoStores = maxStoresApplied >= 2 ? solveForMaxStores(2) : null;
    const bestThreeStores = maxStoresApplied >= 3 ? solveForMaxStores(3) : null;
    const recommendedMultiStore = solveForMaxStores(maxStoresApplied);

    // Overall verification window & limitations
    const allDates = [
      ...singleStoreRankings.map(s => s.lastVerifiedAt),
      ...singleStoreRankings.map(s => s.oldestVerifiedAt)
    ]
      .filter((d): d is string => Boolean(d))
      .sort();

    const limitations: string[] = [];
    if (transportCostPerExtraStore === 0) {
      limitations.push(
        'Optimizarea este calculată exclusiv pe baza prețurilor produselor; costurile de transport, carburantul și timpul de deplasare nu sunt incluse deoarece nu există date individuale de transport.'
      );
    }
    if ((recommendedMultiStore?.storeCount || 0) > 1) {
      limitations.push(
        'Varianta multi-magazin nu este întotdeauna cea mai bună alegere practică: evaluează dacă economia obținută justifică deplasarea în mai multe magazine.'
      );
    }
    if (unconfidentMatches.length > 0) {
      limitations.push(
        `${unconfidentMatches.length} ${unconfidentMatches.length === 1 ? 'produs nu are' : 'produse nu au'} potrivire sigură în catalog și ${unconfidentMatches.length === 1 ? 'a fost exclus' : 'au fost excluse'} din totalurile reale.`
      );
    }
    if (unitConflicts.length > 0) {
      limitations.push(
        `${unitConflicts.length} ${unitConflicts.length === 1 ? 'produs are' : 'produse au'} unități incompatibile cu ambalajul din catalog și nu au fost combinate artificial.`
      );
    }
    if (itemsWithoutAnyValidPrice.length > 0) {
      limitations.push(
        `${itemsWithoutAnyValidPrice.length} ${itemsWithoutAnyValidPrice.length === 1 ? 'produs nu are' : 'produse nu au'} niciun preț valid/activ în magazinele selectate (nu sunt tratate ca 0 RON).`
      );
    }

    const overallIsEstimative =
      unconfidentMatches.length > 0 ||
      unitConflicts.length > 0 ||
      itemsWithoutAnyValidPrice.length > 0 ||
      (bestSingleStore ? bestSingleStore.isEstimative : true);

    return {
      listId: params.list?.id,
      listName: params.list?.name,
      totalRequestedLines: itemsToProcess.length,
      distinctNormalizedItemsCount: resolvedEntries.length + unconfidentMatches.length,
      duplicateLinesMergedCount,
      comparableCatalogItemsCount: comparableEntries.length,
      unconfidentMatches,
      unitConflicts,
      itemsWithoutAnyValidPrice,
      singleStoreRankings,
      bestSingleStore,
      bestTwoStores,
      bestThreeStores,
      recommendedMultiStore,
      maxStoresApplied,
      excludedStoreIds: Array.from(excludedSet),
      favoriteStoreIds: Array.from(favoriteSet),
      hasValidSavingsBaseline: Boolean(recommendedMultiStore?.hasValidSavingsBaseline || (bestSingleStore && bestSingleStore.savingsVsWorstStore !== null)),
      isEstimative: overallIsEstimative,
      lastPriceVerificationAt: allDates.length ? allDates[allDates.length - 1] : null,
      oldestPriceVerificationAt: allDates.length ? allDates[0] : null,
      limitations,
      calculatedAt: now.toISOString()
    };
  }
}
