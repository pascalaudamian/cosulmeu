// src/services/BasketOptimizerService.ts
// Motor V1/V2 de optimizare a coșului de cumpărături (1 magazin vs multi-magazin)
// Reguli stricte: fără prețuri inventate, fără costuri de transport inventate,
// normalizare strictă a unităților și ambalajelor indivizibile, potrivire sigură
// anti-confuzie (gramaje/arome/bio/fără zahăr/multipack) și comparabilitate validă.

import type {
  BasketItemAllocation,
  BasketMatchConfidence,
  BasketMissingPriceItem,
  BasketMultiStorePlan,
  BasketMultiStoreStop,
  BasketOptimizationOptions,
  BasketOptimizationResult,
  BasketSingleStorePlan,
  BasketSolverMetadata,
  BasketUnconfidentMatch,
  BasketUnitConflict,
  ConditionalPromoType,
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
import {
  buildCanonicalAliasIndex,
  CanonicalAliasIndex,
  resolveCanonicalProductDetail,
  resolveCanonicalProductId,
  resolveProductReferenceMap
} from './ProductIdentityService.js';

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

function normalizeBarcodeDigits(value?: string): string {
  return (value || '').replace(/\D/g, '').trim();
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
  if (unit === 'kg' || unit === 'l') return quantity * 1000; // grams or ml
  return quantity;
}

function fromBaseAmount(baseAmount: number, targetUnit: UnitType): number {
  if (targetUnit === 'kg' || targetUnit === 'l') {
    return Math.round((baseAmount / 1000) * 1000) / 1000;
  }
  return Math.round(baseAmount * 1000) / 1000;
}

interface MultipackSpec {
  count: number;
  perUnitValue: number;
  perUnit: UnitType;
  totalBase: number;
}

function parseMultipackSpec(text: string): MultipackSpec | null {
  const clean = normalizeText(text);
  const m = clean.match(/\b(\d+)\s*[x]\s*(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|buc)\b/i);
  if (!m) return null;
  const count = Number(m[1]);
  const perUnitValue = Number(m[2].replace(',', '.'));
  const perUnit = normalizeUnitToken(m[3]);
  if (!Number.isFinite(count) || count <= 1 || !Number.isFinite(perUnitValue) || perUnitValue <= 0) {
    return null;
  }
  return {
    count,
    perUnitValue,
    perUnit,
    totalBase: count * toBaseAmount(perUnitValue, perUnit)
  };
}

interface ExtractedWeightSpec {
  dimension: 'mass' | 'volume' | 'count';
  baseAmount: number;
  rawUnit: UnitType;
  multipackCount: number;
}

function extractPackageSpecFromText(text: string): ExtractedWeightSpec | null {
  const mp = parseMultipackSpec(text);
  if (mp) {
    return {
      dimension: getUnitDimension(mp.perUnit),
      baseAmount: mp.totalBase,
      rawUnit: mp.perUnit,
      multipackCount: mp.count
    };
  }
  const clean = normalizeText(text);
  // Match standalone package weights/volumes/counts like 500g, 1.5l, 200 ml, 10 buc (exclude percentages like 1.5%)
  const matches = [...clean.matchAll(/(?<![.,\d])(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|buc|pachet)\b(?!\s*%)/gi)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const val = Number(last[1].replace(',', '.'));
  const unit = normalizeUnitToken(last[2]);
  if (!Number.isFinite(val) || val <= 0) return null;
  return {
    dimension: getUnitDimension(unit),
    baseAmount: toBaseAmount(val, unit),
    rawUnit: unit,
    multipackCount: unit === 'buc' ? Math.round(val) : 1
  };
}

function extractPercentages(text: string): string[] {
  const matches = [...normalizeText(text).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)];
  return matches.map(m => String(Number(m[1].replace(',', '.'))));
}

const FLAVOR_AND_VARIANT_TOKENS = [
  'vanilie',
  'ciocolata',
  'cacao',
  'capsuni',
  'lamaie',
  'portocale',
  'zmeura',
  'afine',
  'fructe de padure',
  'piersici',
  'caise',
  'visine',
  'cirese',
  'banane',
  'caramel',
  'alune',
  'migdale',
  'cocos',
  'menta',
  'busuioc',
  'usturoi',
  'picant',
  'afumat',
  'dulce',
  'iute',
  'alba',
  'neagra',
  'secara',
  'integrala',
  'integral',
  'seminte',
  'fara lactoza',
  'delactozat',
  'decofeinizata',
  'decaf',
  'boabe',
  'macinata',
  'solubila',
  'plata',
  'carbogazoasa',
  'minerala',
  'fara sare',
  'nesarat',
  'sarat'
];

function extractVariantMarkers(text: string): Set<string> {
  const norm = normalizeText(text);
  const found = new Set<string>();
  for (const token of FLAVOR_AND_VARIANT_TOKENS) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(norm)) {
      found.add(token);
    }
  }
  return found;
}

function hasSugarFreeMarker(text: string): boolean {
  const norm = normalizeText(text);
  return /\b(fara\s+zahar|no\s+sugar|sugar\s*free|zero\s*zahar|zero|diet|light|stevia|0%\s*zahar)\b/i.test(norm);
}

function hasBioMarker(text: string, isBioFlag?: boolean): boolean {
  if (isBioFlag) return true;
  const norm = normalizeText(text);
  return /\b(bio|eco|organic|organica|ecologic|ecologica)\b/i.test(norm);
}

function isProductIndivisible(product: Product): boolean {
  if (product.isSoldByWeight === true) return false;
  if (product.isIndivisiblePackage === true) return true;

  const normName = normalizeText(product.name);
  if (/\b(vrac|la kg|vracuri|cantar)\b/i.test(normName)) return false;

  const pkgUnit = normalizeUnitToken(product.packageUnit || product.defaultUnit);
  const defUnit = normalizeUnitToken(product.defaultUnit || pkgUnit);
  const pkgWeight = Number(product.packageWeightOrVolume);

  if (defUnit === 'buc' || defUnit === 'pachet') return true;
  if (pkgUnit === 'l' || pkgUnit === 'ml' || pkgUnit === 'buc' || pkgUnit === 'pachet') return true;
  if (/\b(sac|pachet|cutie|sticla|doza|borcan|bax|multipack|\d+\s*[x]\s*\d+)\b/i.test(normName)) {
    return true;
  }
  if ((pkgUnit === 'kg' || pkgUnit === 'g') && Number.isFinite(pkgWeight)) {
    const baseGrams = toBaseAmount(pkgWeight, pkgUnit);
    // Fixed non-1kg solid packs (e.g., 200g butter, 500g pasta, 2.5kg potatoes) are indivisible packs
    if (Math.abs(baseGrams - 1000) > 1) return true;
  }
  return false;
}

function normalizeRegionToken(region?: string | null): string {
  const clean = normalizeText(region || '');
  if (!clean || clean === 'national' || clean === 'romania' || clean === 'toate') return '';
  return clean;
}

function isOfferValidForRegion(offerRegion: string | undefined, requestedRegion: string | undefined): boolean {
  const offReg = normalizeRegionToken(offerRegion);
  const reqReg = normalizeRegionToken(requestedRegion);
  if (!offReg) return true; // National offers apply everywhere
  if (!reqReg) return false; // Regional-only offers must not apply to national/other-region calculations
  return offReg === reqReg || offReg.includes(reqReg) || reqReg.includes(offReg);
}

function parseOfferConditionalDetails(offer: ProductOffer): {
  couponRequired: boolean;
  minQuantityForPromo: number | null;
} {
  const details = normalizeText(offer.promoDetails || '');
  const couponRequired = Boolean(
    offer.couponRequired ||
      offer.couponCode ||
      /\b(cupon|voucher|cod\s+promo)\b/i.test(details)
  );

  let minQty: number | null =
    offer.minQuantityForPromo && offer.minQuantityForPromo > 1
      ? Math.floor(offer.minQuantityForPromo)
      : null;

  if (!minQty && details) {
    const m = details.match(/(?:min(?:im)?\.?\s*|la\s+(?:min(?:im)?\.?\s*)?)(\d+)\s*(?:buc|pac|pachete|l|kg)/i);
    if (m) {
      const parsed = Number(m[1]);
      if (Number.isFinite(parsed) && parsed > 1) {
        minQty = Math.floor(parsed);
      }
    }
  }

  return { couponRequired, minQuantityForPromo: minQty };
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
   * Verifică strict compatibilitatea atributelor critice dintre articol și produsul candidat:
   * gramaj/volum, multipack, bio, fără zahăr, procent grăsime, aromă/variantă, brand.
   */
  static areProductAttributesCompatible(item: ShoppingListItem, product: Product): boolean {
    const itemText = `${item.name || ''} ${item.notes || ''}`;
    const prodText = `${product.name || ''} ${product.description || ''}`;

    // 1. Sugar-free / Zero / Diet must match
    if (hasSugarFreeMarker(itemText) !== hasSugarFreeMarker(prodText)) {
      return false;
    }

    // 2. BIO / Eco / Organic must match
    if (hasBioMarker(itemText) !== hasBioMarker(prodText, product.isBio)) {
      return false;
    }

    // 3. Fat % / Concentration mismatch (e.g., 1.5% vs 3.5%)
    const itemPcts = extractPercentages(itemText);
    const prodPcts = extractPercentages(prodText);
    if (itemPcts.length > 0 && prodPcts.length > 0) {
      const overlap = itemPcts.some(p => prodPcts.includes(p));
      if (!overlap) return false;
    }

    // 4. Flavor / Aroma / Variant mismatch
    const itemVariants = extractVariantMarkers(itemText);
    const prodVariants = extractVariantMarkers(prodText);
    if (itemVariants.size > 0 && prodVariants.size > 0) {
      // Every explicit variant requested by user must exist on candidate, and no conflicting extra flavor
      for (const v of itemVariants) {
        if (!prodVariants.has(v)) return false;
      }
      for (const v of prodVariants) {
        if (!itemVariants.has(v)) return false;
      }
    } else if (itemVariants.size > 0 && prodVariants.size === 0) {
      // User explicitly asked for a flavor/variant (e.g. "Iaurt capsuni") -> don't match plain product
      return false;
    } else if (itemVariants.size === 0 && prodVariants.size > 0) {
      // Check bread/flour/milk specific variant safety when user wrote generic text vs flavored product
      const flavorSpecific = ['capsuni', 'vanilie', 'ciocolata', 'zmeura', 'piersici', 'caise', 'visine', 'cirese', 'banane', 'caramel', 'menta', 'picant', 'afumat', 'decofeinizata', 'fara lactoza'];
      if (flavorSpecific.some(f => prodVariants.has(f))) {
        return false;
      }
    }

    // 5. Explicit weight/volume & multipack count guard
    const itemSpec = extractPackageSpecFromText(item.name || '');
    const prodMp = parseMultipackSpec(product.name || '');
    const prodPkgUnit = normalizeUnitToken(product.packageUnit || product.defaultUnit);
    const prodPkgBase = toBaseAmount(Number(product.packageWeightOrVolume) || 1, prodPkgUnit);

    if (itemSpec) {
      const prodCount = prodMp ? prodMp.count : prodPkgUnit === 'buc' ? Math.round(Number(product.packageWeightOrVolume) || 1) : 1;
      if (itemSpec.multipackCount > 1 || prodCount > 1) {
        if (itemSpec.multipackCount !== prodCount) {
          return false;
        }
      }
      const prodDim = getUnitDimension(prodPkgUnit);
      if (itemSpec.dimension === prodDim && prodPkgBase > 0 && itemSpec.baseAmount > 0) {
        const ratio = Math.min(itemSpec.baseAmount, prodPkgBase) / Math.max(itemSpec.baseAmount, prodPkgBase);
        if (ratio < 0.95) {
          return false;
        }
      }
    } else if (prodMp) {
      // Product is a multipack (e.g. 6 x 0.5L) while item text has no multipack count -> avoid silent mismatch
      return false;
    }

    // 6. Explicit brand guard if caller provided brand or preferredBrand
    const reqBrand = normalizeText(item.brand || item.preferredBrand || '');
    const prodBrand = normalizeText(product.brand || '');
    if (reqBrand && prodBrand) {
      if (!prodBrand.includes(reqBrand) && !reqBrand.includes(prodBrand)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Potrivire strictă în ordinea:
   * 1. Cod de bare exact (EAN / GTIN)
   * 2. ID intern exact
   * 3. Brand + denumire + gramaj + unitate
   * 4. Matching semantic doar cu scor ridicat și fără conflicte de atribute
   */
  static matchItemToProduct(
    item: ShoppingListItem,
    products: Product[],
    aliasSource?: CanonicalAliasIndex | Map<string, string> | Record<string, string>
  ): {
    status: 'matched' | 'unconfident';
    product?: Product;
    confidence?: BasketMatchConfidence;
    reasonRo?: string;
    candidates?: Array<{ id: string; name: string; brand: string }>;
  } {
    const aliasIndex = buildCanonicalAliasIndex(aliasSource ?? products);
    const refMap = resolveProductReferenceMap(products, aliasIndex);
    const canonicalMap = new Map<string, Product>();
    for (const rootProd of refMap.values()) {
      canonicalMap.set(rootProd.id, rootProd);
    }
    const canonicalProducts = Array.from(canonicalMap.values());

    // 1. Exact EAN / GTIN (incl. normalized digits, promoting aliases to canonical root if non-cyclic)
    if (item.barcode && item.barcode.trim()) {
      const cleanBarcode = item.barcode.trim();
      const digitsOnly = normalizeBarcodeDigits(cleanBarcode);
      const barcodeMatches = products.filter(p => {
        if (!p.barcode) return false;
        const pClean = p.barcode.trim();
        if (pClean === cleanBarcode) return true;
        if (digitsOnly.length >= 8) {
          const pDigits = normalizeBarcodeDigits(pClean);
          return pDigits === digitsOnly || pDigits.replace(/^0+/, '') === digitsOnly.replace(/^0+/, '');
        }
        return false;
      });
      // Preferăm rădăcina canonică dacă există; blocăm potrivirile ambigue pe același cod de bare
      const resolvedByBarcode = new Map<string, Product>();
      for (const candidate of barcodeMatches) {
        const resolved = refMap.get(candidate.id);
        if (resolved) {
          resolvedByBarcode.set(resolved.id, resolved);
        }
      }
      if (resolvedByBarcode.size === 1) {
        return {
          status: 'matched',
          product: Array.from(resolvedByBarcode.values())[0],
          confidence: 'exact_ean'
        };
      }
      if (resolvedByBarcode.size > 1) {
        return {
          status: 'unconfident',
          reasonRo: `Codul de bare ${cleanBarcode} corespunde la ${resolvedByBarcode.size} produse distincte în catalog.`,
          candidates: Array.from(resolvedByBarcode.values())
            .slice(0, 4)
            .map(p => ({ id: p.id, name: p.name, brand: p.brand }))
        };
      }
    }

    // 2. Exact internal ID (multi-hop canonical resolution; nu acceptă cicluri sau aliasuri orfane)
    if (item.productId) {
      const detail = resolveCanonicalProductDetail(item.productId, aliasIndex, {
        knownProductIds: new Set(products.map(p => p.id))
      });
      if (detail.cycleDetected) {
        return {
          status: 'unconfident',
          reasonRo: `Referința produsului (${item.productId}) face parte dintr-un lanț canonic invalid/ciclic.`
        };
      }
      if (detail.wasAlias && !detail.found) {
        return {
          status: 'unconfident',
          reasonRo: `Referința produsului (${item.productId}) este un alias orfan fără rădăcină canonică validă.`
        };
      }
      const resolvedProd = refMap.get(item.productId);
      if (resolvedProd) {
        return { status: 'matched', product: resolvedProd, confidence: 'exact_id' };
      }
    }

    const cleanItemName = normalizeText(item.name);
    if (!cleanItemName) {
      return {
        status: 'unconfident',
        reasonRo: 'Produsul nu are o denumire validă pentru asocierea în catalog.'
      };
    }

    // 3. Exact Brand + Name + Weight + Unit (exclusiv pe rădăcini canonice deduplicate)
    const itemBrandNorm = normalizeText(item.brand || item.preferredBrand || '');
    const itemSpec = extractPackageSpecFromText(item.name || '');
    const itemReqUnit = normalizeUnitToken(item.unit);

    const exactBrandNameWeightMatches = canonicalProducts.filter(p => {
      if (!this.areProductAttributesCompatible(item, p)) return false;
      const pName = normalizeText(p.name);
      const pBrand = normalizeText(p.brand);
      const nameAndBrandCombined = normalizeText(`${p.name} ${p.brand}`);
      const nameMatches = pName === cleanItemName || nameAndBrandCombined === cleanItemName;
      if (!nameMatches) return false;

      if (itemBrandNorm && !(pBrand.includes(itemBrandNorm) || itemBrandNorm.includes(pBrand))) {
        return false;
      }

      if (itemSpec) {
        const pPkgUnit = normalizeUnitToken(p.packageUnit || p.defaultUnit);
        const pBase = toBaseAmount(Number(p.packageWeightOrVolume) || 1, pPkgUnit);
        if (getUnitDimension(pPkgUnit) !== itemSpec.dimension) return false;
        const ratio = Math.min(itemSpec.baseAmount, pBase) / Math.max(itemSpec.baseAmount, pBase);
        if (ratio < 0.95) return false;
      } else {
        const pDim = getUnitDimension(normalizeUnitToken(p.packageUnit || p.defaultUnit));
        const rDim = getUnitDimension(itemReqUnit);
        if (rDim !== 'count' && pDim !== rDim) return false;
      }
      return true;
    });

    if (exactBrandNameWeightMatches.length === 1) {
      const matchConfidence: BasketMatchConfidence = itemBrandNorm || itemSpec ? 'exact_brand_name_weight' : 'exact_name';
      return { status: 'matched', product: exactBrandNameWeightMatches[0], confidence: matchConfidence };
    }

    // Exact normalized name match (single compatible canonical candidate; blochează potrivirile ambigue)
    const exactMatches = canonicalProducts.filter(
      p => normalizeText(p.name) === cleanItemName && this.areProductAttributesCompatible(item, p)
    );
    if (exactMatches.length === 1) {
      return { status: 'matched', product: exactMatches[0], confidence: 'exact_name' };
    }
    if (exactMatches.length > 1) {
      if (itemBrandNorm) {
        const byBrand = exactMatches.filter(p => normalizeText(p.brand).includes(itemBrandNorm));
        if (byBrand.length === 1) {
          return { status: 'matched', product: byBrand[0], confidence: 'exact_brand_name_weight' };
        }
      }
      return {
        status: 'unconfident',
        reasonRo: `Există ${exactMatches.length} produse cu denumirea exactă „${item.name}” în catalog; selectează produsul exact.`,
        candidates: exactMatches.slice(0, 4).map(p => ({ id: p.id, name: p.name, brand: p.brand }))
      };
    }

    // 4. High-confidence semantic token match ONLY on attribute-compatible canonical products
    const itemTokens = cleanItemName.split(' ').filter(t => t.length >= 2);
    if (itemTokens.length >= 2) {
      const compatibleProducts = canonicalProducts.filter(p => this.areProductAttributesCompatible(item, p));
      const scored = compatibleProducts
        .map(p => {
          const fullText = normalizeText(`${p.name} ${p.brand}`);
          const pTokens = fullText.split(' ').filter(t => t.length >= 2);
          const matchedTokens = itemTokens.filter(t => pTokens.includes(t));
          const coverage = matchedTokens.length / itemTokens.length;
          const reverseCoverage = matchedTokens.length / Math.max(1, pTokens.length);
          const brandMatch = itemBrandNorm ? normalizeText(p.brand).includes(itemBrandNorm) : false;
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

    // Provide potential candidates ONLY as suggestions without auto-matching
    const potentialSuggestions = canonicalProducts
      .filter(p => {
        const pNorm = normalizeText(`${p.name} ${p.brand}`);
        return itemTokens.some(t => pNorm.includes(t));
      })
      .slice(0, 3)
      .map(p => ({ id: p.id, name: p.name, brand: p.brand }));

    return {
      status: 'unconfident',
      reasonRo: `Nu am găsit un produs asociat sigur pentru „${item.name}” (verifică gramajul, varianta sau selectează produsul din catalog).`,
      candidates: potentialSuggestions.length > 0 ? potentialSuggestions : undefined
    };
  }

  /**
   * Calculează costul normalizat verificând strict compatibilitatea unităților/gramajelor,
   * regula ambalajelor indivizibile (N = ceil(necesar / ambalaj), surplus) și promoțiile condiționate.
   */
  static computeNormalizedItemCost(params: {
    quantity: number;
    requestedUnit: UnitType;
    product: Product;
    offer: ProductOffer;
    useLoyaltyCards: boolean;
    useCoupons?: boolean;
  }):
    | {
        compatible: true;
        calculatedPrice: number;
        effectiveUnitPrice: number;
        unitPriceDisplay: string;
        loyaltyApplied: boolean;
        loyaltyCardName?: string;
        requestedQuantity: number;
        requestedUnit: UnitType;
        packagesCount: number;
        packageSizeLabel: string;
        purchasedQuantity: number;
        purchasedUnit: UnitType;
        surplusQuantity: number;
        surplusUnit: UnitType;
        isIndivisiblePackage: boolean;
        conditionalPromoType: ConditionalPromoType;
        conditionalPromoApplied: boolean;
        conditionalPromoNoteRo?: string;
      }
    | {
        compatible: false;
        reasonRo: string;
      } {
    const { quantity, product, offer, useLoyaltyCards } = params;
    const useCoupons = params.useCoupons ?? false;
    const requestedUnit = normalizeUnitToken(params.requestedUnit);
    const pkgUnit = normalizeUnitToken(product.packageUnit || product.defaultUnit);
    const normUnit = normalizeUnitToken(product.normalizedUnit || pkgUnit);
    const pkgWeight = Number(product.packageWeightOrVolume);
    const multipack = parseMultipackSpec(product.name);
    const indivisible = isProductIndivisible(product);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { compatible: false, reasonRo: 'Cantitatea din listă trebuie să fie mai mare ca 0.' };
    }

    const reqDim = getUnitDimension(requestedUnit);
    const pkgDim = getUnitDimension(pkgUnit);
    const normDim = getUnitDimension(normUnit);

    let packagesCount = 1;
    let purchasedQuantity = quantity;
    let purchasedUnit: UnitType = requestedUnit;
    let surplusQuantity = 0;
    let surplusUnit: UnitType = requestedUnit;

    // 1. User requests discrete packages ('buc' or 'pachet')
    if (requestedUnit === 'buc' || requestedUnit === 'pachet') {
      if (requestedUnit === 'buc' && multipack && product.defaultUnit === 'pachet') {
        // E.g. item asks for 7 buc of a 6 x 0.5L multipack -> ceil(7 / 6) = 2 packs, purchased 12 buc, surplus 5 buc
        packagesCount = Math.ceil((quantity / multipack.count) - 1e-9);
        purchasedQuantity = packagesCount * multipack.count;
        purchasedUnit = 'buc';
        surplusQuantity = Math.max(0, Math.round((purchasedQuantity - quantity) * 1000) / 1000);
        surplusUnit = 'buc';
      } else {
        packagesCount = Math.ceil(quantity - 1e-9);
        purchasedQuantity = packagesCount;
        purchasedUnit = requestedUnit;
        surplusQuantity = Math.max(0, Math.round((purchasedQuantity - quantity) * 1000) / 1000);
        surplusUnit = requestedUnit;
      }
    }
    // 2. Compatible physical dimensions (mass: g/kg or volume: ml/l)
    else if ((reqDim === pkgDim || (reqDim === normDim && pkgDim === normDim)) && Number.isFinite(pkgWeight) && pkgWeight > 0) {
      const requestedBase = toBaseAmount(quantity, requestedUnit);
      const packageBase = toBaseAmount(pkgWeight, pkgUnit);
      if (packageBase <= 0) {
        return {
          compatible: false,
          reasonRo: `Gramajul produsului „${product.name}” nu permite conversia automată.`
        };
      }
      const exactRatio = requestedBase / packageBase;
      if (indivisible) {
        packagesCount = Math.max(1, Math.ceil(exactRatio - 1e-9));
        const purchasedBase = packagesCount * packageBase;
        const surplusBase = Math.max(0, purchasedBase - requestedBase);
        purchasedQuantity = fromBaseAmount(purchasedBase, requestedUnit);
        purchasedUnit = requestedUnit;
        surplusQuantity = fromBaseAmount(surplusBase, requestedUnit);
        surplusUnit = requestedUnit;
      } else {
        // Divisible / loose-by-weight item (e.g. 0.5kg bulk meat or 500g flour at 1kg price)
        packagesCount = Math.round(exactRatio * 1000) / 1000;
        purchasedQuantity = Math.round(quantity * 1000) / 1000;
        purchasedUnit = requestedUnit;
        surplusQuantity = 0;
        surplusUnit = requestedUnit;
      }
    } else {
      return {
        compatible: false,
        reasonRo: `Unitatea cerută (${requestedUnit}) este incompatibilă cu ambalajul produsului „${product.name}” (${pkgWeight} ${pkgUnit}).`
      };
    }

    // Resolve conditional promos: loyalty card, coupon, minimum quantity
    const { couponRequired, minQuantityForPromo } = parseOfferConditionalDetails(offer);
    const nonConditionalFallbackPrice =
      offer.normalPrice && offer.normalPrice > 0
        ? offer.normalPrice
        : offer.originalPrice && offer.originalPrice > 0
        ? offer.originalPrice
        : null;

    let effectivePackPrice = offer.price;
    let loyaltyApplied = false;
    let conditionalPromoType: ConditionalPromoType = 'none';
    let conditionalPromoApplied = false;
    let conditionalPromoNoteRo: string | undefined;

    if (offer.loyaltyCardRequired) {
      conditionalPromoType = 'loyalty_card';
      if (useLoyaltyCards) {
        loyaltyApplied = true;
        conditionalPromoApplied = true;
        effectivePackPrice = offer.loyaltyPrice && offer.loyaltyPrice > 0 ? offer.loyaltyPrice : offer.price;
        conditionalPromoNoteRo = offer.loyaltyCardName
          ? `Card fidelitate aplicat (${offer.loyaltyCardName})`
          : 'Card fidelitate aplicat';
      } else {
        effectivePackPrice = nonConditionalFallbackPrice ?? offer.price;
        conditionalPromoApplied = false;
        conditionalPromoNoteRo = nonConditionalFallbackPrice
          ? `Fără card fidelitate — preț standard (${nonConditionalFallbackPrice.toFixed(2).replace('.', ',')} lei)`
          : 'Preț condiționat de card fidelitate (card dezactivat)';
      }
    } else if (couponRequired) {
      conditionalPromoType = 'coupon';
      if (useCoupons) {
        conditionalPromoApplied = true;
        effectivePackPrice = offer.promoPrice && offer.promoPrice > 0 ? offer.promoPrice : offer.price;
        conditionalPromoNoteRo = offer.couponCode ? `Cupon aplicat (${offer.couponCode})` : 'Cupon promoțional aplicat';
      } else if (nonConditionalFallbackPrice) {
        conditionalPromoApplied = false;
        effectivePackPrice = nonConditionalFallbackPrice;
        conditionalPromoNoteRo = `Cupon neactivat — preț standard (${nonConditionalFallbackPrice.toFixed(2).replace('.', ',')} lei)`;
      } else {
        return {
          compatible: false,
          reasonRo: `Oferta necesită cupon activat (${offer.promoDetails || 'cupon magazin'}) și nu are preț standard fără cupon.`
        };
      }
    } else if (minQuantityForPromo && minQuantityForPromo > 1) {
      conditionalPromoType = 'min_quantity';
      if (packagesCount >= minQuantityForPromo) {
        conditionalPromoApplied = true;
        effectivePackPrice = offer.promoPrice && offer.promoPrice > 0 ? offer.promoPrice : offer.price;
        conditionalPromoNoteRo = `Promoție cantitate aplicată (min. ${minQuantityForPromo} buc)`;
      } else if (nonConditionalFallbackPrice) {
        conditionalPromoApplied = false;
        effectivePackPrice = nonConditionalFallbackPrice;
        conditionalPromoNoteRo = `Promoția necesită min. ${minQuantityForPromo} buc (aplicat preț standard pentru ${packagesCount})`;
      } else {
        return {
          compatible: false,
          reasonRo: `Promoția necesită minimum ${minQuantityForPromo} unități fără preț standard alternativ.`
        };
      }
    }

    const calculatedPrice = packagesCount * effectivePackPrice;
    const roundedTotal = Math.round(calculatedPrice * 100) / 100;
    const unitMeasureLabel = offer.unitPriceMeasure || `lei/${normUnit}`;
    let displayUnitPrice = offer.unitPrice;
    if (offer.price > 0 && offer.unitPrice > 0 && Math.abs(effectivePackPrice - offer.price) > 0.001) {
      displayUnitPrice = Math.round(offer.unitPrice * (effectivePackPrice / offer.price) * 100) / 100;
    } else if ((!Number.isFinite(displayUnitPrice) || displayUnitPrice <= 0) && Number.isFinite(pkgWeight) && pkgWeight > 0) {
      const baseUnits =
        normUnit === 'kg' || normUnit === 'l'
          ? toBaseAmount(pkgWeight, pkgUnit) / 1000
          : pkgWeight;
      if (baseUnits > 0) {
        displayUnitPrice = Math.round((effectivePackPrice / baseUnits) * 100) / 100;
      }
    }

    const packageSizeLabel = multipack
      ? `${multipack.count} x ${multipack.perUnitValue} ${multipack.perUnit}`
      : `${pkgWeight} ${pkgUnit}`;

    return {
      compatible: true,
      calculatedPrice: roundedTotal,
      effectiveUnitPrice: Math.round(effectivePackPrice * 100) / 100,
      unitPriceDisplay: `${displayUnitPrice.toFixed(2).replace('.', ',')} ${unitMeasureLabel}`,
      loyaltyApplied,
      loyaltyCardName: loyaltyApplied ? offer.loyaltyCardName : undefined,
      requestedQuantity: Math.round(quantity * 1000) / 1000,
      requestedUnit,
      packagesCount,
      packageSizeLabel,
      purchasedQuantity,
      purchasedUnit,
      surplusQuantity,
      surplusUnit,
      isIndivisiblePackage: indivisible,
      conditionalPromoType,
      conditionalPromoApplied,
      conditionalPromoNoteRo
    };
  }

  /**
   * Filtrează ofertele prin clasificatorul centralizat, verificând regiunea, vechimea configurabilă
   * și excluderea ofertelor fără sursă/expirate/anomalii/demo.
   */
  static evaluateStoreOfferForProduct(params: {
    product: Product;
    store: Store;
    offers: ProductOffer[];
    includeStaleOffers: boolean;
    maxOfferAgeDays?: number;
    region?: string;
    useLoyaltyCards?: boolean;
    useCoupons?: boolean;
    requestedQuantity?: number;
    requestedUnit?: UnitType;
    now: Date;
  }): { offer: ProductOffer; assessment: PriceDataQualityAssessment } | null {
    const targetStoreKey = normalizeStoreKey(params.store.slug || params.store.id);
    const targetStoreIdKey = normalizeStoreKey(params.store.id);
    const useLoyaltyCards = params.useLoyaltyCards ?? true;
    const useCoupons = params.useCoupons ?? false;

    const matchingOffers = params.offers.filter(o => {
      if (o.productId !== params.product.id) return false;
      if (!o.storeId || !String(o.storeId).trim()) return false;
      const offerStoreKey = normalizeStoreKey(o.storeId);
      const matchesStore =
        o.storeId === params.store.id ||
        offerStoreKey === targetStoreIdKey ||
        offerStoreKey === targetStoreKey;
      if (!matchesStore) return false;
      return isOfferValidForRegion(o.region, params.region);
    });

    const classifierConfig = params.maxOfferAgeDays
      ? { staleMaxHours: Math.max(24, params.maxOfferAgeDays * 24) }
      : undefined;

    const evaluated = matchingOffers
      .map(offer => ({
        offer,
        assessment: PriceQualityClassifier.classifyOffer(offer, {
          product: params.product,
          config: classifierConfig,
          now: params.now
        })
      }))
      .filter(({ offer, assessment }) => {
        if (!assessment.isUsableForComparison) return false;
        if (!params.includeStaleOffers && assessment.status === 'STALE') return false;
        // Exclude conditional offers that cannot fall back cleanly (e.g. coupon required with no regular price)
        if (params.requestedQuantity && params.requestedUnit) {
          const check = this.computeNormalizedItemCost({
            quantity: params.requestedQuantity,
            requestedUnit: params.requestedUnit,
            product: params.product,
            offer,
            useLoyaltyCards,
            useCoupons
          });
          if (!check.compatible) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Compute effective comparable cost if quantity provided
        let priceA = a.offer.price;
        let priceB = b.offer.price;
        if (params.requestedQuantity && params.requestedUnit) {
          const costA = this.computeNormalizedItemCost({
            quantity: params.requestedQuantity,
            requestedUnit: params.requestedUnit,
            product: params.product,
            offer: a.offer,
            useLoyaltyCards,
            useCoupons
          });
          const costB = this.computeNormalizedItemCost({
            quantity: params.requestedQuantity,
            requestedUnit: params.requestedUnit,
            product: params.product,
            offer: b.offer,
            useLoyaltyCards,
            useCoupons
          });
          if (costA.compatible) priceA = costA.calculatedPrice;
          if (costB.compatible) priceB = costB.calculatedPrice;
        }

        if (a.assessment.isReliableForOptimization !== b.assessment.isReliableForOptimization) {
          return a.assessment.isReliableForOptimization ? -1 : 1;
        }
        if (Math.abs(priceA - priceB) > 0.001) {
          return priceA - priceB;
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
    aliasMap?: Map<string, string> | Record<string, string> | CanonicalAliasIndex;
    options?: BasketOptimizationOptions;
  }): BasketOptimizationResult {
    const startedAtMs = Date.now();
    const now = params.options?.now || new Date();
    const useLoyaltyCards = params.options?.useLoyaltyCards ?? true;
    const useCoupons = params.options?.useCoupons ?? false;
    const includeStaleOffers = params.options?.includeStaleOffers ?? true;
    const maxOfferAgeDays = params.options?.maxOfferAgeDays;
    const appliedRegion = params.options?.region?.trim() || null;
    const maxStoresApplied = Math.max(1, Math.min(20, Math.floor(params.options?.maxStores ?? 3)));
    // Regula strictă: nu inventăm costuri de transport. Implicit = 0.
    const transportCostPerExtraStore = Math.max(0, Number(params.options?.transportCostPerExtraStore ?? 0) || 0);

    const allProducts = params.products && params.products.length > 0 ? params.products : PRODUCTS;
    const aliasIndex = buildCanonicalAliasIndex(params.aliasMap ?? allProducts);
    const knownProductIds = new Set(allProducts.map(p => p.id));
    const rawOffers = params.offers !== undefined ? params.offers : PRODUCT_OFFERS;
    const allOffers: ProductOffer[] = [];
    for (const o of rawOffers) {
      if (!o || !o.productId) continue;
      const detail = resolveCanonicalProductDetail(o.productId, aliasIndex, { knownProductIds });
      if (detail.cycleDetected || (detail.wasAlias && !detail.found)) continue;
      const resolvedId = detail.canonicalId || o.productId;
      allOffers.push(resolvedId !== o.productId ? { ...o, productId: resolvedId } : o);
    }
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
      const match = this.matchItemToProduct(item, allProducts, aliasIndex);
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
      const canMergeDimension = (itemDim === 'mass' || itemDim === 'volume') && itemDim === pkgDim;
      const mergeKey = canMergeDimension ? `${match.product.id}::dim:${itemDim}` : `${match.product.id}::${normUnit}`;
      const existing = resolvedByKey.get(mergeKey);
      if (existing) {
        const existingUnit = normalizeUnitToken(existing.representativeItem.unit);
        if (existingUnit === normUnit) {
          existing.aggregatedQuantity =
            Math.round((existing.aggregatedQuantity + item.quantity) * 1000) / 1000;
        } else {
          // Mixed units in same dimension (e.g. g + kg) -> canonicalize both to pkgUnit
          const existingInPkg =
            pkgUnit === 'kg' || pkgUnit === 'l'
              ? toBaseAmount(existing.aggregatedQuantity, existingUnit) / 1000
              : toBaseAmount(existing.aggregatedQuantity, existingUnit);
          const incomingInPkg =
            pkgUnit === 'kg' || pkgUnit === 'l'
              ? toBaseAmount(item.quantity, normUnit) / 1000
              : toBaseAmount(item.quantity, normUnit);
          existing.representativeItem = {
            ...existing.representativeItem,
            unit: pkgUnit,
            quantity: Math.round((existingInPkg + incomingInPkg) * 1000) / 1000
          };
          existing.aggregatedQuantity = existing.representativeItem.quantity;
        }
        existing.mergedOccurrencesCount += 1;
        duplicateLinesMergedCount += 1;
      } else {
        resolvedByKey.set(mergeKey, {
          representativeItem: item,
          aggregatedQuantity: Math.round(item.quantity * 1000) / 1000,
          mergedOccurrencesCount: 1,
          product: match.product,
          matchConfidence: match.confidence
        });
      }
    }

    const resolvedEntries = Array.from(resolvedByKey.values());
    const unitConflicts: BasketUnitConflict[] = [];
    const comparableEntries: ResolvedListEntry[] = [];

    // Pre-check unit compatibility against product metadata
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
        useLoyaltyCards,
        useCoupons
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
        const reqUnit = normalizeUnitToken(entry.representativeItem.unit);
        const entryKey = `${entry.product.id}::${reqUnit}`;
        const best = this.evaluateStoreOfferForProduct({
          product: entry.product,
          store,
          offers: allOffers,
          includeStaleOffers,
          maxOfferAgeDays,
          region: appliedRegion || undefined,
          useLoyaltyCards,
          useCoupons,
          requestedQuantity: entry.aggregatedQuantity,
          requestedUnit: reqUnit,
          now
        });
        if (!best) continue;

        const cost = this.computeNormalizedItemCost({
          quantity: entry.aggregatedQuantity,
          requestedUnit: reqUnit,
          product: entry.product,
          offer: best.offer,
          useLoyaltyCards,
          useCoupons
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
          loyaltyCardName: cost.loyaltyCardName,
          requestedQuantity: cost.requestedQuantity,
          requestedUnit: cost.requestedUnit,
          packagesCount: cost.packagesCount,
          packageSizeLabel: cost.packageSizeLabel,
          purchasedQuantity: cost.purchasedQuantity,
          purchasedUnit: cost.purchasedUnit,
          surplusQuantity: cost.surplusQuantity,
          surplusUnit: cost.surplusUnit,
          isIndivisiblePackage: cost.isIndivisiblePackage,
          conditionalPromoType: cost.conditionalPromoType,
          conditionalPromoApplied: cost.conditionalPromoApplied,
          conditionalPromoNoteRo: cost.conditionalPromoNoteRo,
          regionMatched: best.offer.region || 'Național',
          currency: 'RON'
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
          reasonRo: appliedRegion
            ? `Nu există nicio ofertă activă și validă în magazinele eligibile pentru regiunea ${appliedRegion}.`
            : 'Nu există nicio ofertă activă și validă în magazinele eligibile pentru acest produs.'
        });
      } else {
        priceableEntries.push(entry);
      }
    }

    // 3. Single-Store Plans Ranking (Coverage ALWAYS beats partial low price!)
    const singleStoreRankings: BasketSingleStorePlan[] = eligibleStores
      .map(store => {
        const storeAllocMap = allocationsByStoreId.get(store.id) || new Map<string, BasketItemAllocation>();
        const allocations: BasketItemAllocation[] = [];
        const missingItems: BasketMissingPriceItem[] = [];
        let totalPrice = 0;
        let loyaltySavings = 0;
        let totalSurplusItemsCount = 0;
        let staleItemsCount = 0;
        const verifiedDates: string[] = [];

        for (const entry of comparableEntries) {
          const entryKey = `${entry.product.id}::${normalizeUnitToken(entry.representativeItem.unit)}`;
          const alloc = storeAllocMap.get(entryKey);
          if (alloc) {
            allocations.push(alloc);
            totalPrice += alloc.calculatedPrice;
            if ((alloc.surplusQuantity ?? 0) > 0) {
              totalSurplusItemsCount += 1;
            }
            if (alloc.qualityAssessment.status === 'STALE' || !alloc.qualityAssessment.isReliableForOptimization) {
              staleItemsCount += 1;
            }
            if (alloc.loyaltyApplied && (alloc.offer.normalPrice || alloc.offer.originalPrice)) {
              const stdPack = alloc.offer.normalPrice || alloc.offer.originalPrice || alloc.offer.price;
              if (stdPack > alloc.effectiveUnitPrice) {
                loyaltySavings += Math.max(0, (stdPack - alloc.effectiveUnitPrice) * (alloc.packagesCount || 1));
              }
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
          staleItemsCount > 0;

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
          savingsVsWorstStore: null,
          totalSurplusItemsCount,
          staleItemsCount,
          hasIncompleteData: missingItems.length > 0 || staleItemsCount > 0
        };
      })
      .filter(plan => plan.coveredItemsCount > 0)
      .sort((a, b) => {
        // 1. Strictly prioritize higher coverage (never rank partial basket above fuller one)
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

    // Compute valid single-store savings ONLY against comparable stores with EXACTLY EQUAL item-set coverage
    if (singleStoreRankings.length >= 2) {
      const best = singleStoreRankings[0];
      const coverageSignature = (plan: BasketSingleStorePlan) =>
        plan.allocations
          .map(a => `${a.product.id}::${normalizeUnitToken(a.item.unit)}`)
          .sort()
          .join('|');
      const bestSig = coverageSignature(best);
      const sameCoveragePlans = singleStoreRankings.filter(
        p => p.coveredItemsCount === best.coveredItemsCount && coverageSignature(p) === bestSig
      );
      if (sameCoveragePlans.length >= 2) {
        const worstTotal = Math.max(...sameCoveragePlans.map(p => p.totalPrice));
        for (const plan of sameCoveragePlans) {
          plan.savingsVsWorstStore = Math.max(0, Math.round((worstTotal - plan.totalPrice) * 100) / 100);
        }
      }
    }

    const bestSingleStore = singleStoreRankings[0] || null;

    // 4. Hybrid Deterministic Multi-Store Solver:
    //    - Exact Branch-and-Bound pe matrice pre-indexată pentru dimensiuni până la bugetul exact (4.500 combinații);
    //    - Euristică deterministă (multi-start greedy + căutare locală 1-swap) peste prag, fără a pretinde optim global demonstrat.
    const EXACT_SUBSET_BUDGET = 4500;
    const countSubsetsUpTo = (m: number, k: number, cap: number): number => {
      let total = 0;
      const maxR = Math.min(m, k);
      for (let r = 1; r <= maxR; r++) {
        let comb = 1;
        for (let j = 1; j <= r; j++) {
          comb = (comb * (m - r + j)) / j;
          if (total + comb > cap) return cap + 1;
        }
        total += Math.round(comb);
        if (total > cap) return cap + 1;
      }
      return total;
    };

    const usefulStores = eligibleStores
      .filter(st => {
        const map = allocationsByStoreId.get(st.id);
        return map && map.size > 0;
      })
      .sort((a, b) => {
        const sizeA = allocationsByStoreId.get(a.id)?.size || 0;
        const sizeB = allocationsByStoreId.get(b.id)?.size || 0;
        if (sizeB !== sizeA) return sizeB - sizeA;
        const favA =
          favoriteSet.has(normalizeStoreKey(a.id)) || favoriteSet.has(normalizeStoreKey(a.slug || a.id));
        const favB =
          favoriteSet.has(normalizeStoreKey(b.id)) || favoriteSet.has(normalizeStoreKey(b.slug || b.id));
        if (favA !== favB) return favA ? -1 : 1;
        return a.name.localeCompare(b.name, 'ro');
      });

    const N = priceableEntries.length;
    const M = usefulStores.length;
    const priceableKeys = priceableEntries.map(
      entry => `${entry.product.id}::${normalizeUnitToken(entry.representativeItem.unit)}`
    );
    const storeIsFav = usefulStores.map(
      st => favoriteSet.has(normalizeStoreKey(st.id)) || favoriteSet.has(normalizeStoreKey(st.slug || st.id))
    );
    const storeAllocsMatrix: Array<Array<BasketItemAllocation | null>> = usefulStores.map(st => {
      const storeMap = allocationsByStoreId.get(st.id);
      return priceableKeys.map(k => storeMap?.get(k) || null);
    });
    const storeCostMatrix: Float64Array[] = storeAllocsMatrix.map(row => {
      const arr = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const alloc = row[i];
        arr[i] = alloc ? alloc.calculatedPrice : Infinity;
      }
      return arr;
    });

    // Precompute suffix minimum price per item for exact Branch-and-Bound lower bounds
    const suffixMinCost: Float64Array[] = new Array(M + 1);
    suffixMinCost[M] = new Float64Array(N);
    suffixMinCost[M].fill(Infinity);
    for (let s = M - 1; s >= 0; s--) {
      const nextArr = suffixMinCost[s + 1];
      const sCosts = storeCostMatrix[s];
      const curArr = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        curArr[i] = sCosts[i] < nextArr[i] ? sCosts[i] : nextArr[i];
      }
      suffixMinCost[s] = curArr;
    }

    let lastSolverMeta: BasketSolverMetadata = {
      strategy: 'exact_branch_and_bound',
      isProvenGlobalOptimum: true,
      evaluatedSubsetsCount: 0,
      eligibleUsefulStoresCount: M,
      itemCount: N,
      executionTimeMs: 0,
      noteRo:
        'Algoritm exact Branch-and-Bound pe matrice pre-indexată (acoperire prioritară, apoi cost minim în RON); optim global demonstrat în limita magazinelor eligibile.'
    };

    interface InternalSolverResult {
      plan: BasketMultiStorePlan | null;
      meta: BasketSolverMetadata;
    }

    const solveForMaxStores = (limitK: number): InternalSolverResult => {
      const solveStartMs = Date.now();
      if (N === 0 || M === 0) {
        return {
          plan: null,
          meta: {
            strategy: 'exact_branch_and_bound',
            isProvenGlobalOptimum: true,
            evaluatedSubsetsCount: 0,
            eligibleUsefulStoresCount: M,
            itemCount: N,
            executionTimeMs: 0,
            noteRo:
              'Nu există articole cu preț valid în magazinele eligibile pentru rularea optimizării.'
          }
        };
      }

      const effectiveLimit = Math.min(limitK, M);

      interface CandidateSolution {
        selectedStoreIndices: number[];
        coveredCount: number;
        totalProductsCost: number;
        actualStopsCount: number;
        favCount: number;
        totalWithTransport: number;
        chosenStorePerItem: Int32Array;
      }

      let bestSolution: CandidateSolution | null = null;
      let evaluatedSubsetsCount = 0;

      const isBetterCandidate = (
        coveredCount: number,
        totalWithTransport: number,
        actualStopsCount: number,
        favCount: number
      ): boolean => {
        if (!bestSolution) return true;
        if (coveredCount !== bestSolution.coveredCount) {
          return coveredCount > bestSolution.coveredCount;
        }
        if (Math.abs(totalWithTransport - bestSolution.totalWithTransport) > 0.009) {
          return totalWithTransport < bestSolution.totalWithTransport;
        }
        if (actualStopsCount !== bestSolution.actualStopsCount) {
          return actualStopsCount < bestSolution.actualStopsCount;
        }
        return favCount > bestSolution.favCount;
      };

      const evaluateStoreSet = (indices: number[]): CandidateSolution | null => {
        if (indices.length === 0) return null;
        evaluatedSubsetsCount += 1;

        const chosenStorePerItem = new Int32Array(N);
        chosenStorePerItem.fill(-1);
        let coveredCount = 0;
        let totalProductsCost = 0;
        const usedStoreFlags = new Uint8Array(M);
        let actualStopsCount = 0;
        let favCount = 0;

        for (let i = 0; i < N; i++) {
          let bestS = -1;
          let bestPrice = Infinity;
          let bestFav = false;
          for (let k = 0; k < indices.length; k++) {
            const sIdx = indices[k];
            const p = storeCostMatrix[sIdx][i];
            if (p === Infinity) continue;
            const fav = storeIsFav[sIdx];
            if (bestS === -1) {
              bestS = sIdx;
              bestPrice = p;
              bestFav = fav;
            } else if (p < bestPrice - 0.001) {
              bestS = sIdx;
              bestPrice = p;
              bestFav = fav;
            } else if (Math.abs(p - bestPrice) <= 0.001 && fav && !bestFav) {
              bestS = sIdx;
              bestPrice = p;
              bestFav = fav;
            }
          }
          if (bestS !== -1) {
            chosenStorePerItem[i] = bestS;
            coveredCount += 1;
            totalProductsCost += bestPrice;
            if (!usedStoreFlags[bestS]) {
              usedStoreFlags[bestS] = 1;
              actualStopsCount += 1;
              if (storeIsFav[bestS]) favCount += 1;
            }
          }
        }

        if (actualStopsCount === 0) return null;
        const extraStops = Math.max(0, actualStopsCount - 1);
        const roundedProducts = Math.round(totalProductsCost * 100) / 100;
        const totalWithTransport =
          Math.round((totalProductsCost + extraStops * transportCostPerExtraStore) * 100) / 100;

        const cand: CandidateSolution = {
          selectedStoreIndices: indices.filter(sIdx => usedStoreFlags[sIdx] === 1),
          coveredCount,
          totalProductsCost: roundedProducts,
          actualStopsCount,
          favCount,
          totalWithTransport,
          chosenStorePerItem
        };

        if (isBetterCandidate(coveredCount, totalWithTransport, actualStopsCount, favCount)) {
          bestSolution = cand;
        }
        return cand;
      };

      // Seed strong deterministic incumbent (single stores + greedy coverage/savings up to effectiveLimit)
      for (let s = 0; s < M; s++) {
        evaluateStoreSet([s]);
      }

      const buildGreedyFromSeed = (seedStoreIdx: number | null): number[] => {
        const chosen: number[] = [];
        const chosenMask = new Uint8Array(M);
        const curCosts = new Float64Array(N);
        curCosts.fill(Infinity);

        if (seedStoreIdx !== null) {
          chosen.push(seedStoreIdx);
          chosenMask[seedStoreIdx] = 1;
          const sc = storeCostMatrix[seedStoreIdx];
          for (let i = 0; i < N; i++) curCosts[i] = sc[i];
          evaluateStoreSet([...chosen]);
        }

        while (chosen.length < effectiveLimit) {
          let bestNext = -1;
          let bestNewCov = -1;
          let bestGain = -Infinity;

          for (let s = 0; s < M; s++) {
            if (chosenMask[s]) continue;
            const sc = storeCostMatrix[s];
            let newCov = 0;
            let costSave = 0;
            for (let i = 0; i < N; i++) {
              const p = sc[i];
              if (p === Infinity) continue;
              if (curCosts[i] === Infinity) {
                newCov += 1;
              } else if (p < curCosts[i] - 0.001) {
                costSave += curCosts[i] - p;
              }
            }
            if (newCov === 0 && costSave <= 0.001) continue;
            const netGain = costSave - (chosen.length > 0 ? transportCostPerExtraStore : 0);
            if (
              newCov > bestNewCov ||
              (newCov === bestNewCov &&
                (netGain > bestGain + 0.001 ||
                  (Math.abs(netGain - bestGain) <= 0.001 &&
                    storeIsFav[s] &&
                    bestNext !== -1 &&
                    !storeIsFav[bestNext])))
            ) {
              bestNewCov = newCov;
              bestGain = netGain;
              bestNext = s;
            }
          }

          if (bestNext === -1) break;
          if (bestNewCov === 0 && bestGain <= 0.001) break;

          chosen.push(bestNext);
          chosenMask[bestNext] = 1;
          const sc = storeCostMatrix[bestNext];
          for (let i = 0; i < N; i++) {
            if (sc[i] < curCosts[i]) curCosts[i] = sc[i];
          }
          evaluateStoreSet([...chosen]);
        }

        return chosen;
      };

      const totalCombEstimate = countSubsetsUpTo(M, effectiveLimit, EXACT_SUBSET_BUDGET);
      const useExactBranchAndBound = totalCombEstimate <= EXACT_SUBSET_BUDGET;

      if (useExactBranchAndBound) {
        // Seed quick greedy incumbent so B&B pruning starts tight
        if (effectiveLimit >= 2) {
          buildGreedyFromSeed(null);
          const seedLimit = Math.min(3, M);
          for (let s = 0; s < seedLimit; s++) buildGreedyFromSeed(s);
        }

        if (effectiveLimit >= 2) {
          const costStack: Float64Array[] = Array.from({ length: effectiveLimit + 1 }, () => {
            const arr = new Float64Array(N);
            arr.fill(Infinity);
            return arr;
          });
          const chosenStack: number[] = [];

          const dfsBranchAndBound = (pos: number, depth: number) => {
            const curCosts = costStack[depth];
            if (depth >= 2) {
              evaluateStoreSet([...chosenStack]);
            }
            if (depth === effectiveLimit || pos >= M) return;

            for (let next = pos; next < M; next++) {
              // Exact admissibility check over remaining universe [next .. M-1]
              const suf = suffixMinCost[next];
              let maxReachableCov = 0;
              let lowerBoundProductsCost = 0;
              for (let i = 0; i < N; i++) {
                const c = curCosts[i];
                const sMin = suf[i];
                const minVal = c < sMin ? c : sMin;
                if (minVal < Infinity) {
                  maxReachableCov += 1;
                  lowerBoundProductsCost += minVal;
                }
              }

              // Since [next2 .. M-1] is a strict subset of [next .. M-1], failing here prunes ALL remaining next..M-1!
              if (bestSolution && maxReachableCov < bestSolution.coveredCount) {
                break;
              }
              if (
                bestSolution &&
                transportCostPerExtraStore === 0 &&
                maxReachableCov === bestSolution.coveredCount &&
                lowerBoundProductsCost > bestSolution.totalWithTransport + 0.015
              ) {
                break;
              }

              // Store dominance/redundancy skip: skip store `next` if it cannot improve ANY item over `curCosts`
              const nextCosts = storeCostMatrix[next];
              let improvesAnything = false;
              for (let i = 0; i < N; i++) {
                const np = nextCosts[i];
                if (np === Infinity) continue;
                const cp = curCosts[i];
                if (np < cp - 0.001 || (Math.abs(np - cp) <= 0.001 && storeIsFav[next])) {
                  improvesAnything = true;
                  break;
                }
              }
              if (!improvesAnything) continue;

              const childCosts = costStack[depth + 1];
              for (let i = 0; i < N; i++) {
                const cp = curCosts[i];
                const np = nextCosts[i];
                childCosts[i] = np < cp ? np : cp;
              }

              chosenStack.push(next);
              dfsBranchAndBound(next + 1, depth + 1);
              chosenStack.pop();
            }
          };

          dfsBranchAndBound(0, 0);
        }
      } else {
        // Deterministic multi-start greedy + 1-swap local refinement when M, k exceed EXACT_SUBSET_BUDGET
        const seedCandidates: number[][] = [buildGreedyFromSeed(null)];
        const seedCount = Math.min(M, 6);
        for (let s = 0; s < seedCount; s++) {
          seedCandidates.push(buildGreedyFromSeed(s));
        }

        // Local 1-swap + drop refinement from current bestSolution
        const initialBest = bestSolution as CandidateSolution | null;
        if (initialBest) {
          let currentBest: CandidateSolution = initialBest;
          let currentSet = [...currentBest.selectedStoreIndices];
          for (let iter = 0; iter < 40; iter++) {
            let improved = false;
            const beforeBest = currentBest;
            // Try adding a store if below limit
            if (currentSet.length < effectiveLimit) {
              for (let s = 0; s < M; s++) {
                if (currentSet.includes(s)) continue;
                evaluateStoreSet([...currentSet, s]);
              }
            }
            // Try 1-swap between chosen and outside stores
            for (let idx = 0; idx < currentSet.length; idx++) {
              for (let candS = 0; candS < M; candS++) {
                if (currentSet.includes(candS)) continue;
                const trial = [...currentSet];
                trial[idx] = candS;
                evaluateStoreSet(trial);
              }
            }
            // Try dropping redundant stop
            if (currentSet.length > 1) {
              for (let idx = 0; idx < currentSet.length; idx++) {
                const trial = currentSet.filter((_, j) => j !== idx);
                evaluateStoreSet(trial);
              }
            }
            const afterBest = bestSolution as CandidateSolution | null;
            if (afterBest && afterBest !== beforeBest) {
              currentBest = afterBest;
              currentSet = [...afterBest.selectedStoreIndices];
              improved = true;
            }
            if (!improved) break;
          }
        }
      }

      const elapsedMs = Math.max(0, Date.now() - solveStartMs);
      const solverMeta: BasketSolverMetadata = {
        strategy: useExactBranchAndBound ? 'exact_branch_and_bound' : 'deterministic_heuristic',
        isProvenGlobalOptimum: useExactBranchAndBound,
        evaluatedSubsetsCount,
        eligibleUsefulStoresCount: M,
        itemCount: N,
        executionTimeMs: elapsedMs,
        noteRo: useExactBranchAndBound
          ? `Algoritm exact Branch-and-Bound pe matrice pre-indexată (${evaluatedSubsetsCount} combinații evaluate din ${M} magazine eligibile, ${N} articole); optim global demonstrat.`
          : `Algoritm euristic determinist (multi-start greedy + căutare locală 1-swap, ${evaluatedSubsetsCount} evaluări din ${M} magazine eligibile, ${N} articole) aplicat pentru protejarea performanței; optimul global nu este garantat matematic.`
      };

      if (!bestSolution) {
        return { plan: null, meta: solverMeta };
      }
      const sol = bestSolution as CandidateSolution;

      const stopMap = new Map<string, BasketItemAllocation[]>();
      const verifiedDates: string[] = [];
      let totalSurplusItemsCount = 0;
      const allocatedByKey = new Map<string, BasketItemAllocation>();

      for (let i = 0; i < N; i++) {
        const sIdx = sol.chosenStorePerItem[i];
        if (sIdx < 0) continue;
        const alloc = storeAllocsMatrix[sIdx][i];
        if (!alloc) continue;
        allocatedByKey.set(priceableKeys[i], alloc);
        const arr = stopMap.get(alloc.store.id) || [];
        arr.push(alloc);
        stopMap.set(alloc.store.id, arr);
        if ((alloc.surplusQuantity ?? 0) > 0) totalSurplusItemsCount += 1;
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
      for (let i = 0; i < N; i++) {
        if (sol.chosenStorePerItem[i] < 0) {
          missingItems.push({
            item: priceableEntries[i].representativeItem,
            product: priceableEntries[i].product,
            reasonRo: `Nu a putut fi acoperit în limita a ${limitK} magazine.`
          });
        }
      }

      // Compute comparable baseline savings ONLY when bestSingleStore covers the exact same item set
      let hasValidSavingsBaseline = false;
      let savingsVsBestSingleStore: number | null = null;
      let savingsPercentVsBestSingleStore: number | null = null;
      let comparableItemsCountWithBaseline = 0;
      let savingsBasisRo = 'Comparabilitate insuficientă — niciun magazin unic nu acoperă aceleași articole.';

      if (bestSingleStore) {
        const singleByKey = new Map<string, BasketItemAllocation>(
          bestSingleStore.allocations.map(a => [
            `${a.product.id}::${normalizeUnitToken(a.item.unit)}`,
            a
          ])
        );

        let baselineSharedTotal = 0;
        let multiSharedTotal = 0;

        for (const [entryKey, multiAlloc] of allocatedByKey.entries()) {
          const singleAlloc = singleByKey.get(entryKey);
          if (singleAlloc) {
            comparableItemsCountWithBaseline += 1;
            baselineSharedTotal += singleAlloc.calculatedPrice;
            multiSharedTotal += multiAlloc.calculatedPrice;
          }
        }

        if (
          comparableItemsCountWithBaseline > 0 &&
          comparableItemsCountWithBaseline === allocatedByKey.size &&
          bestSingleStore.coveredItemsCount === allocatedByKey.size &&
          baselineSharedTotal > 0
        ) {
          hasValidSavingsBaseline = true;
          const extraTransport = Math.max(0, stops.length - 1) * transportCostPerExtraStore;
          const netDiff = Math.round((baselineSharedTotal - (multiSharedTotal + extraTransport)) * 100) / 100;
          savingsVsBestSingleStore = netDiff;
          savingsPercentVsBestSingleStore = Math.round((netDiff / baselineSharedTotal) * 1000) / 10;
          savingsBasisRo = `Economie calculată pe acoperire egală (${comparableItemsCountWithBaseline}/${comparableItemsCountWithBaseline} articole comparabile), pe baza prețurilor observate în catalog.`;
        } else if (bestSingleStore.coveredItemsCount !== sol.coveredCount) {
          savingsBasisRo = `Acoperire diferită (${sol.coveredCount}/${comparableEntries.length} articole în varianta multi-magazin vs. ${bestSingleStore.coveredItemsCount}/${comparableEntries.length} în ${bestSingleStore.store.name}) — nu există magazin unic echivalent pentru calculul economiei.`;
        }
      }

      const totalTransportCost = Math.round(Math.max(0, stops.length - 1) * transportCostPerExtraStore * 100) / 100;
      const isComplete =
        sol.coveredCount === comparableEntries.length &&
        comparableEntries.length > 0 &&
        unconfidentMatches.length === 0 &&
        unitConflicts.length === 0;
      const completenessPercentage =
        comparableEntries.length > 0 ? Math.round((sol.coveredCount / comparableEntries.length) * 100) : 0;
      const coverageStatusRo: 'COMPLET' | 'PARȚIAL' | 'INDISPONIBIL' = isComplete
        ? 'COMPLET'
        : sol.coveredCount > 0
        ? 'PARȚIAL'
        : 'INDISPONIBIL';
      const isEstimative =
        missingItems.length > 0 ||
        unconfidentMatches.length > 0 ||
        unitConflicts.length > 0 ||
        Array.from(allocatedByKey.values()).some(a => !a.qualityAssessment.isReliableForOptimization);

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
              `Economie estimată la produse de ${savingsVsBestSingleStore.toFixed(2).replace('.', ',')} lei (${savingsPercentVsBestSingleStore}%) față de cel mai bun magazin unic (${bestSingleStore?.store.name}).`
            );
          } else {
            explanationParts.push(
              `Costul la produse este egal cu varianta într-un singur magazin (${bestSingleStore?.store.name}).`
            );
          }
        } else if (!isComplete) {
          explanationParts.push(
            `Plan parțial (${sol.coveredCount}/${comparableEntries.length} articole acoperite); produsele lipsă nu sunt calculate ca 0 RON.`
          );
        }
      }

      return {
        meta: solverMeta,
        plan: {
          storeCount: stops.length,
          maxStoresLimit: limitK,
          stops,
          coveredItemsCount: sol.coveredCount,
          totalComparableItemsCount: comparableEntries.length,
          completenessPercentage,
          coverageStatusRo,
          unconfidentMatchesCount: unconfidentMatches.length,
          unitConflictsCount: unitConflicts.length,
          missingItems,
          isComplete,
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
          explanationRo: explanationParts.join(' '),
          totalSurplusItemsCount,
          savingsBasisRo
        }
      };
    };

    const twoRes = maxStoresApplied >= 2 ? solveForMaxStores(2) : null;
    const threeRes = maxStoresApplied >= 3 ? solveForMaxStores(3) : null;
    const recRes = solveForMaxStores(maxStoresApplied);

    const bestTwoStores = twoRes ? twoRes.plan : null;
    const bestThreeStores = threeRes ? threeRes.plan : null;
    const recommendedMultiStore = recRes.plan;
    lastSolverMeta = {
      ...recRes.meta,
      executionTimeMs: Math.max(recRes.meta.executionTimeMs, Date.now() - startedAtMs)
    };

    const allDates = [
      ...singleStoreRankings.map(s => s.lastVerifiedAt),
      ...singleStoreRankings.map(s => s.oldestVerifiedAt)
    ]
      .filter((d): d is string => Boolean(d))
      .sort();

    const limitations: string[] = [];
    if (transportCostPerExtraStore === 0) {
      limitations.push(
        'Optimizarea este calculată exclusiv pe baza prețurilor observate ale produselor; costurile de transport, carburantul și timpul de deplasare nu sunt incluse deoarece nu există date individuale de transport.'
      );
    }
    if ((recommendedMultiStore?.storeCount || 0) > 1) {
      limitations.push(
        'Varianta multi-magazin nu este întotdeauna cea mai bună alegere practică: evaluează dacă economia obținută justifică deplasarea în mai multe magazine.'
      );
    }
    if (lastSolverMeta.strategy === 'deterministic_heuristic') {
      limitations.push(lastSolverMeta.noteRo);
    }
    if ((recommendedMultiStore?.totalSurplusItemsCount || 0) > 0) {
      limitations.push(
        'Pentru ambalajele indivizibile (ex: lapte 1L, unt 200g, multipack), cantitatea este rotunjită în sus la număr întreg de ambalaje, generând surplus afișat explicit.'
      );
    }
    if (recommendedMultiStore && !recommendedMultiStore.isComplete && recommendedMultiStore.missingItems.length > 0) {
      limitations.push(
        `Planul recomandat este PARȚIAL (${recommendedMultiStore.coveredItemsCount}/${recommendedMultiStore.totalComparableItemsCount} articole comparabile acoperite); articolele lipsă nu sunt incluse în total și nu sunt considerate 0 RON.`
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
    if (appliedRegion) {
      limitations.push(
        `Filtrare regională activă pentru „${appliedRegion}”: sunt incluse ofertele naționale și cele specifice regiunii selectate.`
      );
    }

    const overallIsEstimative =
      unconfidentMatches.length > 0 ||
      unitConflicts.length > 0 ||
      itemsWithoutAnyValidPrice.length > 0 ||
      (bestSingleStore ? bestSingleStore.isEstimative : true);

    const savingsMethodNoteRo = recommendedMultiStore?.hasValidSavingsBaseline
      ? overallIsEstimative
        ? 'Economie estimativă pe prețuri observate (acoperire egală, include date cu avertisment).'
        : 'Economie bazată pe prețuri observate și verificate, comparată pe exact același set de produse.'
      : bestSingleStore && bestSingleStore.savingsVsWorstStore !== null
      ? 'Economie calculată față de cel mai scump magazin cu aceeași acoperire a coșului.'
      : 'Nu există reper complet echivalent pentru calculul economiilor.';

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
      hasValidSavingsBaseline: Boolean(
        recommendedMultiStore?.hasValidSavingsBaseline ||
          (bestSingleStore && bestSingleStore.savingsVsWorstStore !== null)
      ),
      isEstimative: overallIsEstimative,
      lastPriceVerificationAt: allDates.length ? allDates[allDates.length - 1] : null,
      oldestPriceVerificationAt: allDates.length ? allDates[0] : null,
      limitations,
      calculatedAt: now.toISOString(),
      appliedRegion,
      maxOfferAgeDaysApplied: maxOfferAgeDays ?? null,
      useCouponsApplied: useCoupons,
      revisionToken: params.options?.clientRevision,
      savingsMethodNoteRo,
      solverMetadata: lastSolverMeta
    };
  }
}
