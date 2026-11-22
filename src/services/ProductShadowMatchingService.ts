import type {
  Product,
  ProductOffer,
  RetailerProductRecord,
  ShadowHardGuardCode,
  ShadowHardGuardResult,
  ShadowMatchCandidate,
  ShadowMatchDecisionCategory,
  ShadowMatchEvidence,
  ShadowMatchMethod,
  ShadowMatchingReport,
  ShadowRecommendedAction,
  ShadowScoreBreakdown
} from '../types.js';
import {
  buildCanonicalAliasIndex,
  normalizeStoreIdKey,
  resolveCanonicalProductId,
  type CanonicalAliasIndex
} from './ProductIdentityService.js';
import {
  areVariantAttributesCompatible,
  compareNormalizedPackaging,
  normalizeCatalogProduct,
  stripDiacriticsLower,
  type NormalizedProductAuditRecord
} from './ProductNormalizationService.js';

export const SHADOW_NORMALIZATION_VERSION = 'faza-1b-v1';

export interface ShadowMatchingOptions {
  dataSource?: ShadowMatchingReport['dataSource'];
  maxCandidatesPerProduct?: number;
  maxReportCandidates?: number;
  sampleLimit?: number;
  includeLowConfidence?: boolean;
  includeSameRetailer?: boolean;
  retailerByProductId?: Map<string, string[]> | Record<string, string | string[]>;
}

const KNOWN_RETAILER_PREFIXES: Array<{ prefix: string; storeKey: string }> = [
  { prefix: 'prod-mega-image-', storeKey: 'mega-image' },
  { prefix: 'prod-megaimage-', storeKey: 'mega-image' },
  { prefix: 'prod-la-doi-pasi-', storeKey: 'la-doi-pasi' },
  { prefix: 'prod-kaufland-', storeKey: 'kaufland' },
  { prefix: 'prod-carrefour-', storeKey: 'carrefour' },
  { prefix: 'prod-auchan-', storeKey: 'auchan' },
  { prefix: 'prod-penny-', storeKey: 'penny' },
  { prefix: 'prod-profi-', storeKey: 'profi' },
  { prefix: 'prod-metro-', storeKey: 'metro' },
  { prefix: 'prod-lidl-', storeKey: 'lidl' },
  { prefix: 'prod-cora-', storeKey: 'cora' },
  { prefix: 'prod-selgros-', storeKey: 'selgros' },
  { prefix: 'prod-supeco-', storeKey: 'supeco' },
  { prefix: 'prod-dm-', storeKey: 'dm' }
];

// Private label ownership hints (lowercase normalized brand -> normalized retailer keys)
const PRIVATE_LABEL_RETAILER_HINTS: Record<string, string[]> = {
  pilos: ['lidl'],
  milbona: ['lidl'],
  pikok: ['lidl'],
  dulano: ['lidl'],
  argus: ['lidl'],
  solevita: ['lidl'],
  freeway: ['lidl'],
  sondey: ['lidl'],
  favorina: ['lidl'],
  'fin carre': ['lidl'],
  cien: ['lidl'],
  w5: ['lidl'],
  floralys: ['lidl'],
  'camara noastra': ['lidl'],
  'k-classic': ['kaufland'],
  aro: ['metro'],
  'fine life': ['metro'],
  'gusturi romanesti': ['mega-image'],
  'mega image': ['mega-image'],
  '365': ['mega-image'],
  delhaize: ['mega-image'],
  carrefour: ['carrefour'],
  auchan: ['auchan'],
  'hanul boieresc': ['penny'],
  'san fabio': ['penny'],
  boni: ['penny'],
  proxi: ['profi']
};

const TITLE_STOP_WORDS = new Set([
  'de',
  'cu',
  'si',
  'in',
  'la',
  'pe',
  'din',
  'pentru',
  'fara',
  'sau',
  'ori',
  'ca',
  'un',
  'o',
  'al',
  'a',
  'le',
  'tip',
  'cal',
  'calitatea',
  'buc',
  'pachet',
  'cutie',
  'sticla',
  'doza',
  'pet',
  'tetra',
  'ambalaj'
]);

const GENERIC_NON_DESCRIPTIVE_TOKENS = new Set([
  'produs',
  'produse',
  'articol',
  'oferta',
  'promotie',
  'super',
  'mega',
  'divers',
  'diverse',
  'generic',
  'item',
  'unknown',
  'necunoscut'
]);

function deterministicHexHash(input: string, length = 20): string {
  const fnv32 = (seed: number, str: string): string => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const h1 = fnv32(0x811c9dc5, input);
  const h2 = fnv32(0x9e3779b9, `${input}#b`);
  const h3 = fnv32(0x85ebca6b, `${input.length}:${input}`);
  return `${h1}${h2}${h3}`.slice(0, length);
}

function inferRetailerFromProductId(productId: string): string | null {
  const lower = (productId || '').toLowerCase().trim();
  for (const entry of KNOWN_RETAILER_PREFIXES) {
    if (lower.startsWith(entry.prefix)) {
      return entry.storeKey;
    }
  }
  return null;
}

function extractDescriptiveTokens(
  audit: NormalizedProductAuditRecord,
  options?: { excludeBrandTokens?: boolean }
): string[] {
  const excludeBrandTokens = options?.excludeBrandTokens ?? true;
  const brandTokens = new Set<string>();
  if (excludeBrandTokens && audit.brand.normalizedBrand) {
    for (const bt of stripDiacriticsLower(audit.brand.normalizedBrand).split(/[^a-z0-9]+/)) {
      if (bt.length >= 2) brandTokens.add(bt);
    }
  }

  const rawTokens = audit.title.normalizedDescriptiveTitle
    .split(/[^a-z0-9.%]+/)
    .map(t => t.trim())
    .filter(Boolean);

  const tokens: string[] = [];
  for (const tok of rawTokens) {
    if (tok.length < 2) continue;
    if (/^\d+(?:\.\d+)?%?$/.test(tok)) continue;
    if (TITLE_STOP_WORDS.has(tok) || GENERIC_NON_DESCRIPTIVE_TOKENS.has(tok)) continue;
    if (excludeBrandTokens && brandTokens.has(tok)) continue;
    tokens.push(tok);
  }
  return Array.from(new Set(tokens));
}

function computeTokenSimilarity(tokensA: string[], tokensB: string[]): {
  jaccard: number;
  dice: number;
  overlap: number;
  sharedCount: number;
  sharedTokens: string[];
} {
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { jaccard: 0, dice: 0, overlap: 0, sharedCount: 0, sharedTokens: [] };
  }
  const setB = new Set(tokensB);
  const sharedTokens = tokensA.filter(t => setB.has(t));
  const sharedCount = sharedTokens.length;
  const unionSize = new Set([...tokensA, ...tokensB]).size;
  const jaccard = unionSize > 0 ? sharedCount / unionSize : 0;
  const dice = (2 * sharedCount) / (tokensA.length + tokensB.length);
  const overlap = sharedCount / Math.min(tokensA.length, tokensB.length);
  return {
    jaccard: Number(jaccard.toFixed(4)),
    dice: Number(dice.toFixed(4)),
    overlap: Number(overlap.toFixed(4)),
    sharedCount,
    sharedTokens
  };
}

function formatNormalizedQuantityLabel(audit: NormalizedProductAuditRecord): string | null {
  const p = audit.packaging;
  if (p.isVariableWeight) return 'greutate variabilă';
  if (p.hasMissingQuantity || p.normalizedMetricValue === null || !p.normalizedMetricUnit) {
    return p.originalQuantity && p.originalUnit ? `${p.originalQuantity} ${p.originalUnit} (neconfirmat)` : null;
  }
  if (p.isMultipack && p.unitPackageQuantity && p.unitPackageUnit) {
    return `${p.packCount} x ${p.unitPackageQuantity} ${p.unitPackageUnit} (${p.totalQuantity} ${p.totalUnit})`;
  }
  return `${p.totalQuantity} ${p.totalUnit}`;
}

export interface PreparedShadowProduct {
  product: Product;
  audit: NormalizedProductAuditRecord;
  retailers: string[];
  primaryRetailer: string;
  descriptiveTokensNoBrand: string[];
  allSubstantiveTokens: string[];
}

export class ProductShadowMatchingService {
  /**
   * Resolves read-only retailer provenance for every canonical root product without mutating records.
   */
  static buildRetailerProvenanceMap(params: {
    products: Product[];
    retailerProducts?: RetailerProductRecord[];
    offers?: ProductOffer[];
    retailerByProductId?: Map<string, string[]> | Record<string, string | string[]>;
    aliasIndex?: CanonicalAliasIndex;
  }): Map<string, string[]> {
    const aliasIndex = params.aliasIndex || buildCanonicalAliasIndex(params.products);
    const map = new Map<string, Set<string>>();

    const addRetailer = (rawProductId: string | null | undefined, rawStoreId: string | null | undefined) => {
      if (!rawProductId || !rawStoreId) return;
      const canonicalId = resolveCanonicalProductId(rawProductId, aliasIndex) || rawProductId.trim();
      const storeKey = normalizeStoreIdKey(rawStoreId);
      if (!canonicalId || !storeKey || storeKey === 'unknown') return;
      let set = map.get(canonicalId);
      if (!set) {
        set = new Set<string>();
        map.set(canonicalId, set);
      }
      set.add(storeKey);
    };

    if (params.retailerByProductId) {
      if (params.retailerByProductId instanceof Map) {
        for (const [pid, stores] of params.retailerByProductId.entries()) {
          for (const st of stores) addRetailer(pid, st);
        }
      } else {
        for (const [pid, stores] of Object.entries(params.retailerByProductId)) {
          const arr = Array.isArray(stores) ? stores : [stores];
          for (const st of arr) addRetailer(pid, st);
        }
      }
    }

    for (const rp of params.retailerProducts || []) {
      if (rp.productId && rp.retailerId) {
        addRetailer(rp.productId, rp.retailerId);
      }
    }

    for (const offer of params.offers || []) {
      if (offer.productId && offer.storeId) {
        addRetailer(offer.productId, offer.storeId);
      }
    }

    for (const p of params.products) {
      const canonicalId = resolveCanonicalProductId(p.id, aliasIndex) || p.id;
      const inferred = inferRetailerFromProductId(p.id);
      if (inferred) {
        addRetailer(canonicalId, inferred);
      }
    }

    const result = new Map<string, string[]>();
    for (const [pid, set] of map.entries()) {
      result.set(pid, Array.from(set).sort());
    }
    return result;
  }

  /**
   * Prepares an individual canonical product for deterministic shadow matching.
   */
  static prepareProduct(product: Product, retailers: string[]): PreparedShadowProduct {
    const audit = normalizeCatalogProduct(product);
    const sortedRetailers = Array.from(new Set(retailers.map(normalizeStoreIdKey).filter(Boolean))).sort();
    return {
      product,
      audit,
      retailers: sortedRetailers,
      primaryRetailer: sortedRetailers[0] || inferRetailerFromProductId(product.id) || 'unknown',
      descriptiveTokensNoBrand: extractDescriptiveTokens(audit, { excludeBrandTokens: true }),
      allSubstantiveTokens: extractDescriptiveTokens(audit, { excludeBrandTokens: false })
    };
  }

  /**
   * Generates sub-quadratic blocking candidate pairs without evaluating O(n^2) combinations.
   */
  static generateBlockingPairs(
    preparedProducts: PreparedShadowProduct[],
    options?: {
      includeSameRetailer?: boolean;
      maxBucketSize?: number;
    }
  ): Array<{ a: PreparedShadowProduct; b: PreparedShadowProduct; sourceRetailer: string; targetRetailer: string; matchedBuckets: string[] }> {
    const includeSameRetailer = Boolean(options?.includeSameRetailer);
    const maxNonGtinBucketSize = Math.max(20, options?.maxBucketSize ?? 85);

    const byIndexBuckets = new Map<string, number[]>();
    const gtinBucketKeys = new Set<string>();

    const pushToBucket = (key: string, idx: number, isGtin = false) => {
      if (isGtin) gtinBucketKeys.add(key);
      let list = byIndexBuckets.get(key);
      if (!list) {
        list = [];
        byIndexBuckets.set(key, list);
      }
      if (list[list.length - 1] !== idx) {
        list.push(idx);
      }
    };

    for (let i = 0; i < preparedProducts.length; i++) {
      const item = preparedProducts[i];
      const { audit } = item;

      // 1. Valid universal GS1 barcode buckets
      if (audit.barcode.isEligibleForAutoMatch) {
        for (const eq of audit.barcode.normalizedEquivalentBarcodes) {
          pushToBucket(`gtin:${eq}`, i, true);
        }
      }

      const unitFamily = audit.packaging.normalizedMetricUnit || '_';

      // 2. Normalized real brand + descriptive tokens buckets
      if (audit.brand.normalizedBrand) {
        const normBrand = stripDiacriticsLower(audit.brand.normalizedBrand);
        const brandTokens = item.descriptiveTokensNoBrand.slice(0, 6);
        for (const tok of brandTokens) {
          if (tok.length >= 3) {
            pushToBucket(`brandtok:${normBrand}::${tok}`, i);
          }
        }
        if (unitFamily !== '_') {
          pushToBucket(`brandunit:${normBrand}::${unitFamily}`, i);
        } else {
          pushToBucket(`brandonly:${normBrand}`, i);
        }
      }

      // 3. Descriptive token bigram + unit family (also captures missing/placeholder brand items)
      const tokList = item.descriptiveTokensNoBrand
        .filter(t => t.length >= 3)
        .slice(0, 8)
        .sort();
      for (let t1 = 0; t1 < tokList.length; t1++) {
        for (let t2 = t1 + 1; t2 < tokList.length; t2++) {
          pushToBucket(`bigram:${tokList[t1]}::${tokList[t2]}::${unitFamily}`, i);
        }
      }

      // Fallback single strong token (>4 chars) + metric value bucket when few descriptive tokens exist
      if (tokList.length > 0 && audit.packaging.normalizedMetricValue !== null && unitFamily !== '_') {
        const roundedMetric = Math.round(audit.packaging.normalizedMetricValue);
        for (const tok of tokList.slice(0, 3)) {
          if (tok.length >= 4) {
            pushToBucket(`tokqty:${tok}::${roundedMetric}${unitFamily}`, i);
          }
        }
      }
    }

    const pairMap = new Map<string, { idxA: number; idxB: number; sourceRetailer: string; targetRetailer: string; buckets: Set<string> }>();

    for (const [bucketKey, indices] of byIndexBuckets.entries()) {
      if (indices.length < 2) continue;
      const isGtinBucket = gtinBucketKeys.has(bucketKey);
      if (!isGtinBucket && indices.length > maxNonGtinBucketSize) {
        continue; // Cap overly broad buckets to keep execution strictly sub-quadratic
      }

      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const rawA = indices[i];
          const rawB = indices[j];
          const prodA = preparedProducts[rawA];
          const prodB = preparedProducts[rawB];

          // Enforce deterministic canonical ordering by product ID
          const swap = prodA.product.id.localeCompare(prodB.product.id) > 0;
          const idxA = swap ? rawB : rawA;
          const idxB = swap ? rawA : rawB;
          const first = preparedProducts[idxA];
          const second = preparedProducts[idxB];

          // Resolve cross-retailer pairing
          let sourceRetailer = first.primaryRetailer;
          let targetRetailer = second.primaryRetailer;

          if (!includeSameRetailer) {
            if (sourceRetailer === 'unknown' || targetRetailer === 'unknown') continue;
            // Find any distinct cross-retailer pairing across their retailer sets
            let foundCross = false;
            if (sourceRetailer !== targetRetailer) {
              foundCross = true;
            } else {
              for (const rA of first.retailers) {
                const diffB = second.retailers.find(rB => rB !== rA);
                if (diffB) {
                  sourceRetailer = rA;
                  targetRetailer = diffB;
                  foundCross = true;
                  break;
                }
              }
            }
            if (!foundCross) continue;
          }

          const pairKey = `${first.product.id}__${second.product.id}`;
          let existing = pairMap.get(pairKey);
          if (!existing) {
            existing = {
              idxA,
              idxB,
              sourceRetailer,
              targetRetailer,
              buckets: new Set<string>()
            };
            pairMap.set(pairKey, existing);
          }
          existing.buckets.add(bucketKey);
        }
      }
    }

    return Array.from(pairMap.values()).map(entry => ({
      a: preparedProducts[entry.idxA],
      b: preparedProducts[entry.idxB],
      sourceRetailer: entry.sourceRetailer,
      targetRetailer: entry.targetRetailer,
      matchedBuckets: Array.from(entry.buckets).sort()
    }));
  }

  /**
   * Evaluates a single pair of normalized products against all Hard Guards & Scoring Rules (read-only).
   */
  static evaluateCandidatePair(
    a: PreparedShadowProduct,
    b: PreparedShadowProduct,
    sourceRetailer: string,
    targetRetailer: string,
    generatedAt = new Date().toISOString()
  ): ShadowMatchCandidate {
    const auditA = a.audit;
    const auditB = b.audit;

    const positiveEvidence: ShadowMatchEvidence[] = [];
    const negativeEvidence: ShadowMatchEvidence[] = [];
    const checks: ShadowHardGuardResult[] = [];

    // Compute core signals
    const gtinSetB = new Set(auditB.barcode.normalizedEquivalentBarcodes);
    const sharedValidGtins =
      auditA.barcode.isEligibleForAutoMatch && auditB.barcode.isEligibleForAutoMatch
        ? auditA.barcode.normalizedEquivalentBarcodes.filter(code => gtinSetB.has(code))
        : [];
    const hasExactValidGtin = sharedValidGtins.length > 0;

    const brandA = auditA.brand.normalizedBrand ? stripDiacriticsLower(auditA.brand.normalizedBrand) : null;
    const brandB = auditB.brand.normalizedBrand ? stripDiacriticsLower(auditB.brand.normalizedBrand) : null;
    const bothHaveRealBrand = Boolean(brandA && brandB);
    const sameRealBrand = Boolean(brandA && brandB && brandA === brandB);
    const eitherHasPlaceholderOrMissingBrand =
      auditA.brand.brandQuality === 'placeholder' ||
      auditA.brand.brandQuality === 'corrupt_or_non_brand' ||
      auditA.brand.brandQuality === 'missing' ||
      auditB.brand.brandQuality === 'placeholder' ||
      auditB.brand.brandQuality === 'corrupt_or_non_brand' ||
      auditB.brand.brandQuality === 'missing';

    const pkgCmp = compareNormalizedPackaging(auditA.packaging, auditB.packaging);
    const variantCmp = areVariantAttributesCompatible(auditA.title.variantAttributes, auditB.title.variantAttributes);

    // Title token comparison (excluding brand & packaging)
    const noBrandSim = computeTokenSimilarity(a.descriptiveTokensNoBrand, b.descriptiveTokensNoBrand);
    const fullSim = computeTokenSimilarity(a.allSubstantiveTokens, b.allSubstantiveTokens);
    const effectiveTitleSim = Number((noBrandSim.dice * 0.55 + noBrandSim.jaccard * 0.35 + noBrandSim.overlap * 0.1).toFixed(4));

    // =====================================================
    // HARD GUARDS (FAZA 3)
    // =====================================================

    // Guard 1: Insufficiently descriptive titles
    const insufficientPass = !auditA.title.isInsufficientlyDescriptive && !auditB.title.isInsufficientlyDescriptive;
    checks.push({
      code: 'GUARD_INSUFFICIENT_TITLE',
      passed: insufficientPass,
      severity: 'hard_block',
      reason: insufficientPass
        ? 'Ambele titluri conțin termeni descriptivi suficienți.'
        : `Titlu insuficient descriptiv: ${[...auditA.title.insufficiencyReasons, ...auditB.title.insufficiencyReasons].join(' ')}`
    });

    // Guard 2: Variable-weight / internal store barcodes (20..29) / vrac / la kg
    const variableWeightPass =
      !auditA.packaging.isVariableWeight &&
      !auditB.packaging.isVariableWeight &&
      !auditA.barcode.isVariableWeight &&
      !auditB.barcode.isVariableWeight;
    checks.push({
      code: 'GUARD_VARIABLE_WEIGHT',
      passed: variableWeightPass,
      severity: 'hard_block',
      reason: variableWeightPass
        ? 'Produse cu greutate fixă și fără cod intern 20..29.'
        : 'Cel puțin un produs este la greutate variabilă (vrac/la kg) sau are cod intern 20..29.'
    });

    // Guard 3: Suspicious multipacks
    const suspiciousMultipackPass = !auditA.packaging.isSuspiciousMultipack && !auditB.packaging.isSuspiciousMultipack;
    checks.push({
      code: 'GUARD_SUSPICIOUS_MULTIPACK',
      passed: suspiciousMultipackPass,
      severity: 'hard_block',
      reason: suspiciousMultipackPass
        ? 'Fără multipackuri suspecte.'
        : 'Multipack suspect detectat (>48 bucăți sau volum/masă nerealistă).'
    });

    // Guard 4: Non-food unit or DB-vs-title attribute contradictions
    const contradictionPass = !auditA.packaging.hasContradictoryAttributes && !auditB.packaging.hasContradictoryAttributes;
    checks.push({
      code: 'GUARD_NONFOOD_UNIT_CONTRADICTION',
      passed: contradictionPass,
      severity: 'hard_block',
      reason: contradictionPass
        ? 'Fără contradicții între atributele de cantitate din DB și titlu.'
        : [...auditA.packaging.contradictionReasons, ...auditB.packaging.contradictionReasons].join(' ')
    });

    // Guard 5: Incompatible real brands
    const compatibleBrandPass = !(bothHaveRealBrand && brandA !== brandB);
    checks.push({
      code: 'GUARD_INCOMPATIBLE_BRAND',
      passed: compatibleBrandPass,
      severity: 'hard_block',
      reason: compatibleBrandPass
        ? sameRealBrand
          ? `Brand compatibil (${auditA.brand.normalizedBrand}).`
          : 'Nu există conflict între branduri reale.'
        : `Branduri reale incompatibile: „${auditA.brand.normalizedBrand}” vs „${auditB.brand.normalizedBrand}”.`
    });

    // Guard 6: Private label cross-retailer isolation
    const isCrossRetailer = sourceRetailer !== targetRetailer && sourceRetailer !== 'unknown' && targetRetailer !== 'unknown';
    let privateLabelConflictReason: string | null = null;
    if (isCrossRetailer && (auditA.brand.isPrivateLabel || auditB.brand.isPrivateLabel)) {
      const ownersA = brandA ? PRIVATE_LABEL_RETAILER_HINTS[brandA] : undefined;
      const ownersB = brandB ? PRIVATE_LABEL_RETAILER_HINTS[brandB] : undefined;
      if (auditA.brand.isPrivateLabel !== auditB.brand.isPrivateLabel) {
        privateLabelConflictReason = `Marcă proprie a unui retailer (${auditA.brand.isPrivateLabel ? auditA.brand.normalizedBrand : auditB.brand.normalizedBrand}) nu poate fi asociată cu produs de la alt retailer.`;
      } else if (brandA !== brandB) {
        privateLabelConflictReason = `Mărci proprii diferite între retaileri (${auditA.brand.normalizedBrand} vs ${auditB.brand.normalizedBrand}).`;
      } else if (ownersA && (!ownersA.includes(sourceRetailer) || !ownersA.includes(targetRetailer))) {
        privateLabelConflictReason = `Marca proprie „${auditA.brand.normalizedBrand}” aparține exclusiv lanțului ${ownersA.join(', ')} și nu poate fi asociată între ${sourceRetailer} și ${targetRetailer}.`;
      } else if (ownersB && (!ownersB.includes(sourceRetailer) || !ownersB.includes(targetRetailer))) {
        privateLabelConflictReason = `Marca proprie „${auditB.brand.normalizedBrand}” aparține exclusiv lanțului ${ownersB.join(', ')} și nu poate fi asociată între ${sourceRetailer} și ${targetRetailer}.`;
      } else {
        privateLabelConflictReason = `Produsele marcă proprie (${auditA.brand.normalizedBrand || auditB.brand.normalizedBrand}) sunt izolate cross-retailer (${sourceRetailer} vs ${targetRetailer}).`;
      }
    }
    checks.push({
      code: 'GUARD_PRIVATE_LABEL_CROSS_RETAILER',
      passed: !privateLabelConflictReason,
      severity: 'hard_block',
      reason: privateLabelConflictReason || 'Fără conflict cross-retailer de marcă proprie.'
    });

    // Guard 7: Placeholder / missing brand ambiguity
    let placeholderGuardPass = true;
    let placeholderGuardReason = 'Identitatea brandului este suficientă pentru evaluare.';
    if (eitherHasPlaceholderOrMissingBrand && !hasExactValidGtin) {
      if (bothHaveRealBrand === false && (brandA || brandB)) {
        // One has a real brand, the other has placeholder/missing brand:
        // Block unless title similarity is high AND all substantive tokens overlap well
        if (effectiveTitleSim < 0.72 || noBrandSim.sharedCount < 2) {
          placeholderGuardPass = false;
          placeholderGuardReason =
            'Un produs are brand lipsă/placeholder, iar suprapunerea descriptivă a titlului este insuficientă (<0.72 sau <2 cuvinte comune) fără GTIN.';
        }
      } else if (!brandA && !brandB) {
        // Both lack a real brand and no GTIN: require strong multi-token descriptive overlap
        if (effectiveTitleSim < 0.72 || noBrandSim.sharedCount < 2) {
          placeholderGuardPass = false;
          placeholderGuardReason =
            'Ambele produse au brand placeholder/absent și fără GTIN valid; similaritate titlu insuficientă pentru candidat.';
        }
      }
    }
    checks.push({
      code: 'GUARD_AMBIGUOUS_BRAND_PLACEHOLDER',
      passed: placeholderGuardPass,
      severity: 'hard_block',
      reason: placeholderGuardReason
    });

    // Guard 8: Incompatible variants (fat %, coffee form, sugar-free, lactose-free, bio, alcohol, flavors, etc.)
    checks.push({
      code: 'GUARD_INCOMPATIBLE_VARIANT',
      passed: variantCmp.compatible,
      severity: 'hard_block',
      reason: variantCmp.compatible
        ? 'Atributele de variantă sunt compatibile.'
        : variantCmp.conflictReasons.join(' ')
    });

    // Guard 9: Incompatible unit families (solid vs liquid vs buc)
    const incompatibleUnitFamily =
      pkgCmp.incompatibleUnitFamily ||
      (auditA.packaging.hasMissingQuantity !== auditB.packaging.hasMissingQuantity && !hasExactValidGtin);
    checks.push({
      code: 'GUARD_INCOMPATIBLE_UNIT_FAMILY',
      passed: !pkgCmp.incompatibleUnitFamily,
      severity: 'hard_block',
      reason: pkgCmp.incompatibleUnitFamily
        ? pkgCmp.reason || `Familii de unități incompatibile (${auditA.packaging.normalizedMetricUnit} vs ${auditB.packaging.normalizedMetricUnit}).`
        : 'Familii de unități compatibile.'
    });

    // Guard 10: Incompatible quantity
    let quantityPass = true;
    let quantityReason = 'Cantitatea totală este compatibilă.';
    if (pkgCmp.incompatibleUnitFamily) {
      quantityPass = false;
      quantityReason = pkgCmp.reason || 'Familii de unități incompatibile.';
    } else if (auditA.packaging.hasMissingQuantity || auditB.packaging.hasMissingQuantity) {
      if (!hasExactValidGtin) {
        quantityPass = false;
        quantityReason = 'Cel puțin un produs nu are cantitate/ambalaj explicit confirmat și nu există GTIN universal comun.';
      } else {
        quantityReason = 'Cantitate neconfirmată parțial, dar GTIN universal identic.';
      }
    } else if (!pkgCmp.totalQuantityMatch) {
      quantityPass = false;
      quantityReason = `Cantități totale diferite: ${formatNormalizedQuantityLabel(auditA)} vs ${formatNormalizedQuantityLabel(auditB)} (raport ${pkgCmp.totalRatio}).`;
    } else if (incompatibleUnitFamily && !hasExactValidGtin) {
      quantityPass = false;
      quantityReason = 'Cantitate incompatibilă între cele două produse.';
    }
    checks.push({
      code: 'GUARD_INCOMPATIBLE_QUANTITY',
      passed: quantityPass,
      severity: 'hard_block',
      reason: quantityReason
    });

    // Guard 11: Packaging structure mismatch (1x500g vs 2x250g -> differentStructureSameTotal)
    const differentStructureSameTotal = Boolean(pkgCmp.differentStructureSameTotal);
    checks.push({
      code: 'GUARD_PACKAGING_STRUCTURE_MISMATCH',
      passed: !differentStructureSameTotal,
      severity: 'hard_block',
      reason: differentStructureSameTotal
        ? pkgCmp.reason ||
          `Structură de ambalaj diferită la aceeași cantitate totală (${auditA.packaging.packagingStructureKey} vs ${auditB.packaging.packagingStructureKey}).`
        : 'Structură de ambalaj compatibilă.'
    });

    const failedGuards = checks.filter(c => !c.passed).map(c => c.code);
    const allGuardsPassed = failedGuards.length === 0;

    // =====================================================
    // POSITIVE & NEGATIVE EVIDENCE (FAZA 4)
    // =====================================================
    if (hasExactValidGtin) {
      positiveEvidence.push({
        code: 'VALID_GS1_EXACT',
        label: 'Cod GS1/EAN valid identic',
        weight: 0.58,
        detail: `Cod universal valid comun: ${sharedValidGtins.join(', ')}.`
      });
    } else if (auditA.barcode.originalBarcode || auditB.barcode.originalBarcode) {
      if (!auditA.barcode.isEligibleForAutoMatch && auditA.barcode.originalBarcode) {
        negativeEvidence.push({
          code: 'BARCODE_A_INELIGIBLE',
          label: 'Cod de bare sursă neeligibil',
          detail: `Sursa (${auditA.barcode.originalBarcode}): ${auditA.barcode.reasons.join(' ')}`
        });
      }
      if (!auditB.barcode.isEligibleForAutoMatch && auditB.barcode.originalBarcode) {
        negativeEvidence.push({
          code: 'BARCODE_B_INELIGIBLE',
          label: 'Cod de bare țintă neeligibil',
          detail: `Ținta (${auditB.barcode.originalBarcode}): ${auditB.barcode.reasons.join(' ')}`
        });
      }
      if (
        auditA.barcode.isEligibleForAutoMatch &&
        auditB.barcode.isEligibleForAutoMatch &&
        !hasExactValidGtin
      ) {
        negativeEvidence.push({
          code: 'DIFFERENT_VALID_GTINS',
          label: 'GTIN-uri universale diferite',
          detail: `${auditA.barcode.normalizedPrimaryBarcode} vs ${auditB.barcode.normalizedPrimaryBarcode}.`
        });
      }
    }

    if (sameRealBrand) {
      const bothVerified =
        auditA.brand.brandQuality === 'verified_brand' && auditB.brand.brandQuality === 'verified_brand';
      positiveEvidence.push({
        code: 'BRAND_EXACT_MATCH',
        label: bothVerified ? 'Brand explicit identic' : 'Brand normalizat identic (recuperat din titlu)',
        weight: bothVerified ? 0.25 : 0.21,
        detail: `Brand normalizat comun: „${auditA.brand.normalizedBrand}” (${auditA.brand.brandQuality} / ${auditB.brand.brandQuality}).`
      });
    } else if (eitherHasPlaceholderOrMissingBrand) {
      negativeEvidence.push({
        code: 'BRAND_MISSING_OR_PLACEHOLDER',
        label: 'Brand absent sau placeholder',
        detail: `Calitate brand: ${auditA.brand.brandQuality} vs ${auditB.brand.brandQuality}. Nu adaugă scor pozitiv.`
      });
    }

    if (noBrandSim.sharedCount > 0) {
      positiveEvidence.push({
        code: 'TITLE_DESCRIPTIVE_MATCH',
        label: 'Similaritate descriptivă titlu',
        weight: Number((effectiveTitleSim * 0.42).toFixed(3)),
        detail: `Similaritate ${Math.round(effectiveTitleSim * 100)}% (${noBrandSim.sharedCount} termeni comuni: ${noBrandSim.sharedTokens.slice(0, 6).join(', ')}).`
      });
    } else {
      negativeEvidence.push({
        code: 'NO_DESCRIPTIVE_OVERLAP',
        label: 'Lipsă termeni descriptivi comuni',
        detail: 'Titlurile nu împărtășesc cuvinte descriptive comune în afara brandului/unității.'
      });
    }

    if (pkgCmp.exactStructureMatch && !auditA.packaging.hasMissingQuantity && !auditB.packaging.hasMissingQuantity) {
      positiveEvidence.push({
        code: 'PACKAGING_EXACT_MATCH',
        label: 'Cantitate și structură ambalaj identice',
        weight: 0.25,
        detail: `Structură identică ${auditA.packaging.packagingStructureKey} (${formatNormalizedQuantityLabel(auditA)}).`
      });
    }

    if (variantCmp.compatible) {
      const sharedVars = auditA.title.variantAttributes.extraVariantTokens.filter(v =>
        auditB.title.variantAttributes.extraVariantTokens.includes(v)
      );
      if (sharedVars.length > 0) {
        positiveEvidence.push({
          code: 'VARIANT_ATTRIBUTES_MATCH',
          label: 'Variante identice confirmate',
          weight: 0.05,
          detail: `Atribute de variantă comune: ${sharedVars.join(', ')}.`
        });
      }
    }

    if (
      a.product.category &&
      b.product.category &&
      a.product.category !== 'Alte produse' &&
      b.product.category !== 'Alte produse'
    ) {
      if (a.product.category === b.product.category) {
        positiveEvidence.push({
          code: 'CATEGORY_MATCH',
          label: 'Categorie compatibilă',
          weight: 0.03,
          detail: `Categorie comună: ${a.product.category}.`
        });
      } else {
        negativeEvidence.push({
          code: 'CATEGORY_MISMATCH',
          label: 'Categorii diferite',
          detail: `${a.product.category} vs ${b.product.category}.`
        });
      }
    }

    for (const chk of checks) {
      if (!chk.passed) {
        negativeEvidence.push({
          code: chk.code,
          label: chk.code,
          detail: chk.reason
        });
      }
    }

    // =====================================================
    // SCORING & DECISION CATEGORY (FAZA 4)
    // =====================================================
    let rawScore = 0;
    let gtinScore = 0;
    let brandScore = 0;
    let titleScore = 0;
    let packagingScore = 0;
    let variantCategoryScore = 0;
    let penalties = 0;
    let cappedByMissingBrand = false;
    let cappedByInsufficientTitle = false;
    let cappedByHardGuard = false;

    if (hasExactValidGtin) {
      gtinScore = 0.58;
      if (sameRealBrand) brandScore = 0.16;
      titleScore = Number(Math.min(0.16, effectiveTitleSim * 0.16).toFixed(4));
      if (pkgCmp.exactStructureMatch) packagingScore = 0.08;
      else if (pkgCmp.totalQuantityMatch) packagingScore = 0.04;
      if (variantCmp.compatible) variantCategoryScore = 0.02;
      rawScore = gtinScore + brandScore + titleScore + packagingScore + variantCategoryScore;
    } else {
      // Non-GTIN deterministic scoring
      if (sameRealBrand) {
        const bothVerified =
          auditA.brand.brandQuality === 'verified_brand' && auditB.brand.brandQuality === 'verified_brand';
        brandScore = bothVerified ? 0.25 : 0.21;
        rawScore += brandScore;
      }

      // Title contribution (0 .. 0.44)
      titleScore = effectiveTitleSim * 0.39;
      if (noBrandSim.sharedCount >= 2 && noBrandSim.jaccard >= 0.55) {
        titleScore += 0.05;
      }
      rawScore += titleScore;

      // Exact packaging structure contribution (0.25)
      if (pkgCmp.exactStructureMatch && !auditA.packaging.hasMissingQuantity && !auditB.packaging.hasMissingQuantity) {
        packagingScore = 0.25;
        rawScore += packagingScore;
      } else if (pkgCmp.totalQuantityMatch && !auditA.packaging.hasMissingQuantity && !auditB.packaging.hasMissingQuantity) {
        packagingScore = 0.14;
        rawScore += packagingScore;
      }

      // Variant & category synergy (max +0.06)
      if (variantCmp.compatible) {
        const sharedVars = auditA.title.variantAttributes.extraVariantTokens.filter(v =>
          auditB.title.variantAttributes.extraVariantTokens.includes(v)
        );
        if (sharedVars.length > 0) {
          variantCategoryScore += 0.04;
        } else if (
          auditA.title.variantAttributes.extraVariantTokens.length === 0 &&
          auditB.title.variantAttributes.extraVariantTokens.length === 0
        ) {
          variantCategoryScore += 0.02;
        }
      }
      if (
        a.product.category &&
        b.product.category &&
        a.product.category === b.product.category &&
        a.product.category !== 'Alte produse'
      ) {
        variantCategoryScore += 0.03;
      }
      rawScore += variantCategoryScore;

      // Penalty if different categories (not Alte produse)
      if (
        a.product.category &&
        b.product.category &&
        a.product.category !== 'Alte produse' &&
        b.product.category !== 'Alte produse' &&
        a.product.category !== b.product.category
      ) {
        penalties -= 0.12;
        rawScore -= 0.12;
      }

      // Penalty if different valid GTINs on both sides
      if (
        auditA.barcode.isEligibleForAutoMatch &&
        auditB.barcode.isEligibleForAutoMatch &&
        !hasExactValidGtin
      ) {
        penalties -= 0.25;
        rawScore -= 0.25;
      }

      // Strict cap when no real brand matches or placeholder/missing brand is present
      if (!sameRealBrand) {
        if (rawScore > 0.84) cappedByMissingBrand = true;
        rawScore = Math.min(rawScore, 0.84); // NEVER HIGH_CONFIDENCE without GTIN + real brand
      }

      // Require at least 1 shared non-brand descriptive token for non-GTIN HIGH_CONFIDENCE
      if (noBrandSim.sharedCount === 0 || effectiveTitleSim < 0.6) {
        if (rawScore > 0.65) cappedByInsufficientTitle = true;
        rawScore = Math.min(rawScore, 0.65);
      }
    }

    // Clamp to [0, 1] and round to 4 decimals
    let matchingScore = Number(Math.max(0, Math.min(1, rawScore)).toFixed(4));

    let decisionCategory: ShadowMatchDecisionCategory;
    let recommendedAction: ShadowRecommendedAction;

    if (!allGuardsPassed) {
      decisionCategory = 'BLOCKED';
      recommendedAction = differentStructureSameTotal
        ? 'keep_separate_different_packaging_structure'
        : 'block_incompatible_candidates';
      // Keep score capped below HIGH_CONFIDENCE on blocked candidates so score and status never mislead
      const guardCap = differentStructureSameTotal ? 0.66 : 0.49;
      if (matchingScore > guardCap) cappedByHardGuard = true;
      matchingScore = Math.min(matchingScore, guardCap);
    } else if (matchingScore >= 0.88) {
      decisionCategory = 'HIGH_CONFIDENCE';
      recommendedAction = 'review_high_confidence_candidate';
    } else if (matchingScore >= 0.68) {
      decisionCategory = 'REVIEW';
      recommendedAction = 'manual_review_needed';
    } else {
      decisionCategory = 'LOW_CONFIDENCE';
      recommendedAction = 'no_action_low_confidence';
    }

    const scoreBreakdown: ShadowScoreBreakdown = {
      gtinScore: Number(gtinScore.toFixed(4)),
      brandScore: Number(brandScore.toFixed(4)),
      titleScore: Number(titleScore.toFixed(4)),
      packagingScore: Number(packagingScore.toFixed(4)),
      variantCategoryScore: Number(variantCategoryScore.toFixed(4)),
      penalties: Number(penalties.toFixed(4)),
      cappedByMissingBrand,
      cappedByInsufficientTitle,
      cappedByHardGuard
    };

    // Determine matchingMethod
    let matchingMethod: ShadowMatchMethod;
    if (!allGuardsPassed) {
      if (failedGuards.includes('GUARD_INCOMPATIBLE_BRAND') || failedGuards.includes('GUARD_PRIVATE_LABEL_CROSS_RETAILER')) {
        matchingMethod = 'brand_conflict_blocked';
      } else if (failedGuards.includes('GUARD_INCOMPATIBLE_VARIANT')) {
        matchingMethod = 'variant_conflict_blocked';
      } else if (failedGuards.includes('GUARD_PACKAGING_STRUCTURE_MISMATCH')) {
        matchingMethod = 'packaging_structure_blocked';
      } else if (
        failedGuards.includes('GUARD_INCOMPATIBLE_QUANTITY') ||
        failedGuards.includes('GUARD_INCOMPATIBLE_UNIT_FAMILY') ||
        failedGuards.includes('GUARD_VARIABLE_WEIGHT') ||
        failedGuards.includes('GUARD_SUSPICIOUS_MULTIPACK') ||
        failedGuards.includes('GUARD_NONFOOD_UNIT_CONTRADICTION')
      ) {
        matchingMethod = 'quantity_conflict_blocked';
      } else {
        matchingMethod = 'insufficient_identity_blocked';
      }
    } else if (hasExactValidGtin) {
      matchingMethod = 'gs1_exact';
    } else if (sameRealBrand) {
      matchingMethod = 'brand_title_packaging';
    } else {
      matchingMethod = 'title_packaging';
    }

    // False positive risk classification
    let falsePositiveRisk: 'low' | 'medium' | 'high' = 'medium';
    if (decisionCategory === 'BLOCKED') {
      falsePositiveRisk = 'high';
    } else if (
      decisionCategory === 'HIGH_CONFIDENCE' &&
      (hasExactValidGtin || (sameRealBrand && pkgCmp.exactStructureMatch && noBrandSim.jaccard >= 0.7))
    ) {
      falsePositiveRisk = 'low';
    } else if (eitherHasPlaceholderOrMissingBrand || fullSim.sharedCount < 2) {
      falsePositiveRisk = 'high';
    } else {
      falsePositiveRisk = 'medium';
    }

    // Human-readable explanation in Romanian
    const explanation =
      decisionCategory === 'BLOCKED'
        ? `Blocat de hard guards (${failedGuards.join(', ')}): ${checks
            .filter(c => !c.passed)
            .map(c => c.reason)
            .join(' ')}`
        : decisionCategory === 'HIGH_CONFIDENCE'
          ? `Candidat cu încredere ridicată (${Math.round(matchingScore * 100)}%, metodă: ${matchingMethod}) între ${sourceRetailer} și ${targetRetailer}. Recomandat pentru confirmare manuală în Faza 2 (fără auto-merge).`
          : decisionCategory === 'REVIEW'
            ? `Necesită revizie manuală (${Math.round(matchingScore * 100)}%, metodă: ${matchingMethod}). Semnale parțiale compatibile, fără blocaje de variantă/cantitate.`
            : `Încredere scăzută (${Math.round(matchingScore * 100)}%). Dovezi insuficiente pentru recomandare de asociere.`;

    const candidateId = `shd-${deterministicHexHash(`${SHADOW_NORMALIZATION_VERSION}|${a.product.id}|${b.product.id}`, 20)}`;

    return {
      candidateId,
      sourceProductId: a.product.id,
      targetProductId: b.product.id,
      sourceRetailer,
      targetRetailer,
      sourceTitle: a.product.name,
      targetTitle: b.product.name,
      normalizedSourceTitle: auditA.title.normalizedDescriptiveTitle,
      normalizedTargetTitle: auditB.title.normalizedDescriptiveTitle,
      sourceBrand: auditA.brand.normalizedBrand,
      targetBrand: auditB.brand.normalizedBrand,
      sourceBarcode: auditA.barcode.normalizedPrimaryBarcode || auditA.originalBarcode,
      targetBarcode: auditB.barcode.normalizedPrimaryBarcode || auditB.originalBarcode,
      sourceQuantity: formatNormalizedQuantityLabel(auditA),
      targetQuantity: formatNormalizedQuantityLabel(auditB),
      sourceUnit: auditA.packaging.normalizedMetricUnit || auditA.packaging.originalUnit || a.product.packageUnit || null,
      targetUnit: auditB.packaging.normalizedMetricUnit || auditB.packaging.originalUnit || b.product.packageUnit || null,
      sourcePackagingStructure: auditA.packaging.packagingStructureKey,
      targetPackagingStructure: auditB.packaging.packagingStructureKey,
      variantAttributes: {
        source: auditA.title.variantAttributes as unknown as Record<string, unknown>,
        target: auditB.title.variantAttributes as unknown as Record<string, unknown>,
        compatible: variantCmp.compatible,
        conflictReasons: variantCmp.conflictReasons
      },
      matchingScore,
      scoreBreakdown,
      matchingMethod,
      hardGuardResults: {
        allPassed: allGuardsPassed,
        failedGuards,
        checks
      },
      positiveEvidence,
      negativeEvidence,
      decisionCategory,
      recommendedAction,
      explanation,
      normalizationVersion: SHADOW_NORMALIZATION_VERSION,
      generatedAt,
      differentStructureSameTotal,
      falsePositiveRisk,
      sourceCategory: a.product.category,
      targetCategory: b.product.category
    };
  }

  /**
   * FAZA 5: Generates full read-only Shadow Matching & Duplicate Detection Report.
   * Zero database mutations, zero canonical_product_id updates, zero price modifications.
   */
  static generateShadowMatchingReport(params: {
    products: Product[];
    retailerProducts?: RetailerProductRecord[];
    offers?: ProductOffer[];
    options?: ShadowMatchingOptions;
  }): ShadowMatchingReport {
    const startMs = Date.now();
    const generatedAt = new Date().toISOString();
    const opts = params.options || {};
    const sampleLimit = Math.min(Math.max(Number(opts.sampleLimit) || 15, 3), 50);
    const maxCandidatesPerProduct = Math.min(Math.max(Number(opts.maxCandidatesPerProduct) || 10, 1), 50);
    const maxReportCandidates = Math.min(Math.max(Number(opts.maxReportCandidates) || 300, 10), 2000);
    const includeLowConfidence = Boolean(opts.includeLowConfidence);
    const includeSameRetailer = Boolean(opts.includeSameRetailer);

    const allProducts = params.products || [];
    const aliasIndex = buildCanonicalAliasIndex(allProducts);
    const provenanceMap = this.buildRetailerProvenanceMap({
      products: allProducts,
      retailerProducts: params.retailerProducts,
      offers: params.offers,
      retailerByProductId: opts.retailerByProductId,
      aliasIndex
    });

    const canonicalRoots = allProducts.filter(p => !p.canonicalProductId);
    const aliasProductsSkippedCount = allProducts.length - canonicalRoots.length;

    const prepared = canonicalRoots
      .map(prod => this.prepareProduct(prod, provenanceMap.get(prod.id) || []))
      .sort((x, y) => x.product.id.localeCompare(y.product.id));

    let insufficientIdentityProductsCount = 0;
    const byRetailer: ShadowMatchingReport['byRetailer'] = {};

    const ensureRetailerStats = (ret: string) => {
      if (!byRetailer[ret]) {
        byRetailer[ret] = {
          productsCount: 0,
          candidatePairsCount: 0,
          highConfidenceCount: 0,
          reviewCount: 0,
          blockedCount: 0,
          lowConfidenceCount: 0
        };
      }
      return byRetailer[ret];
    };

    for (const item of prepared) {
      ensureRetailerStats(item.primaryRetailer).productsCount++;
      if (
        item.audit.title.isInsufficientlyDescriptive ||
        (item.audit.brand.normalizedBrand === null &&
          !item.audit.barcode.isEligibleForAutoMatch &&
          item.audit.packaging.hasMissingQuantity)
      ) {
        insufficientIdentityProductsCount++;
      }
    }

    const rawPairs = this.generateBlockingPairs(prepared, { includeSameRetailer });
    const evaluatedCandidates: ShadowMatchCandidate[] = [];

    for (const pair of rawPairs) {
      evaluatedCandidates.push(
        this.evaluateCandidatePair(pair.a, pair.b, pair.sourceRetailer, pair.targetRetailer, generatedAt)
      );
    }

    // Deterministic sort: category priority (HIGH_CONFIDENCE -> REVIEW -> BLOCKED -> LOW_CONFIDENCE), then score desc, then IDs asc
    const categoryOrder: Record<ShadowMatchDecisionCategory, number> = {
      HIGH_CONFIDENCE: 0,
      REVIEW: 1,
      BLOCKED: 2,
      LOW_CONFIDENCE: 3
    };
    evaluatedCandidates.sort((c1, c2) => {
      const catDiff = categoryOrder[c1.decisionCategory] - categoryOrder[c2.decisionCategory];
      if (catDiff !== 0) return catDiff;
      const scoreDiff = c2.matchingScore - c1.matchingScore;
      if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
      const srcDiff = c1.sourceProductId.localeCompare(c2.sourceProductId);
      if (srcDiff !== 0) return srcDiff;
      return c1.targetProductId.localeCompare(c2.targetProductId);
    });

    // Enforce bounded per-product candidate limit cleanly on non-LOW_CONFIDENCE candidates while preserving full summary counts
    let highConfidenceCount = 0;
    let reviewCount = 0;
    let blockedCount = 0;
    let lowConfidenceCount = 0;
    let gs1ExactMatchesCount = 0;
    let brandBasedMatchesCount = 0;
    let titleBasedMatchesCount = 0;
    let quantityBasedMatchesCount = 0;
    let variantBasedMatchesCount = 0;
    let brandConflictsCount = 0;
    let quantityConflictsCount = 0;
    let multipackConflictsCount = 0;
    let differentStructureSameTotalCount = 0;
    let variantConflictsCount = 0;
    const falsePositiveRiskBreakdown = { low: 0, medium: 0, high: 0 };

    const byRetailerPair: ShadowMatchingReport['byRetailerPair'] = {};
    const byMethod: Record<ShadowMatchMethod, number> = {
      gs1_exact: 0,
      brand_title_packaging: 0,
      title_packaging: 0,
      variant_conflict_blocked: 0,
      quantity_conflict_blocked: 0,
      brand_conflict_blocked: 0,
      packaging_structure_blocked: 0,
      insufficient_identity_blocked: 0
    };

    const samples: ShadowMatchingReport['samples'] = {
      highConfidence: [],
      review: [],
      blocked: [],
      lowConfidence: [],
      differentStructureSameTotal: []
    };

    const perProductCount = new Map<string, number>();
    const selectedCandidates: ShadowMatchCandidate[] = [];

    for (const c of evaluatedCandidates) {
      if (c.decisionCategory === 'HIGH_CONFIDENCE') highConfidenceCount++;
      else if (c.decisionCategory === 'REVIEW') reviewCount++;
      else if (c.decisionCategory === 'BLOCKED') blockedCount++;
      else lowConfidenceCount++;

      byMethod[c.matchingMethod]++;
      falsePositiveRiskBreakdown[c.falsePositiveRisk]++;

      if (c.matchingMethod === 'gs1_exact') gs1ExactMatchesCount++;
      if (c.positiveEvidence.some(e => e.code === 'BRAND_EXACT_MATCH')) brandBasedMatchesCount++;
      if (c.positiveEvidence.some(e => e.code === 'TITLE_DESCRIPTIVE_MATCH')) titleBasedMatchesCount++;
      if (c.positiveEvidence.some(e => e.code === 'PACKAGING_EXACT_MATCH')) quantityBasedMatchesCount++;
      if (c.positiveEvidence.some(e => e.code === 'VARIANT_ATTRIBUTES_MATCH')) variantBasedMatchesCount++;

      const failed = c.hardGuardResults.failedGuards;
      if (failed.includes('GUARD_INCOMPATIBLE_BRAND') || failed.includes('GUARD_PRIVATE_LABEL_CROSS_RETAILER')) {
        brandConflictsCount++;
      }
      if (
        failed.includes('GUARD_INCOMPATIBLE_QUANTITY') ||
        failed.includes('GUARD_INCOMPATIBLE_UNIT_FAMILY') ||
        failed.includes('GUARD_NONFOOD_UNIT_CONTRADICTION')
      ) {
        quantityConflictsCount++;
      }
      if (failed.includes('GUARD_SUSPICIOUS_MULTIPACK') || failed.includes('GUARD_PACKAGING_STRUCTURE_MISMATCH')) {
        multipackConflictsCount++;
      }
      if (c.differentStructureSameTotal) {
        differentStructureSameTotalCount++;
      }
      if (failed.includes('GUARD_INCOMPATIBLE_VARIANT')) {
        variantConflictsCount++;
      }

      // Retailer stats
      const rSrc = ensureRetailerStats(c.sourceRetailer);
      const rTgt = ensureRetailerStats(c.targetRetailer);
      rSrc.candidatePairsCount++;
      if (c.sourceRetailer !== c.targetRetailer) rTgt.candidatePairsCount++;
      if (c.decisionCategory === 'HIGH_CONFIDENCE') {
        rSrc.highConfidenceCount++;
        if (c.sourceRetailer !== c.targetRetailer) rTgt.highConfidenceCount++;
      } else if (c.decisionCategory === 'REVIEW') {
        rSrc.reviewCount++;
        if (c.sourceRetailer !== c.targetRetailer) rTgt.reviewCount++;
      } else if (c.decisionCategory === 'BLOCKED') {
        rSrc.blockedCount++;
        if (c.sourceRetailer !== c.targetRetailer) rTgt.blockedCount++;
      } else {
        rSrc.lowConfidenceCount++;
        if (c.sourceRetailer !== c.targetRetailer) rTgt.lowConfidenceCount++;
      }

      const pairLabel = [c.sourceRetailer, c.targetRetailer].sort().join(' <-> ');
      if (!byRetailerPair[pairLabel]) {
        byRetailerPair[pairLabel] = {
          totalPairs: 0,
          highConfidenceCount: 0,
          reviewCount: 0,
          blockedCount: 0,
          lowConfidenceCount: 0
        };
      }
      byRetailerPair[pairLabel].totalPairs++;
      if (c.decisionCategory === 'HIGH_CONFIDENCE') byRetailerPair[pairLabel].highConfidenceCount++;
      else if (c.decisionCategory === 'REVIEW') byRetailerPair[pairLabel].reviewCount++;
      else if (c.decisionCategory === 'BLOCKED') byRetailerPair[pairLabel].blockedCount++;
      else byRetailerPair[pairLabel].lowConfidenceCount++;

      // Samples
      if (c.decisionCategory === 'HIGH_CONFIDENCE' && samples.highConfidence.length < sampleLimit) {
        samples.highConfidence.push(c);
      } else if (c.decisionCategory === 'REVIEW' && samples.review.length < sampleLimit) {
        samples.review.push(c);
      } else if (c.decisionCategory === 'BLOCKED' && samples.blocked.length < sampleLimit) {
        samples.blocked.push(c);
      } else if (c.decisionCategory === 'LOW_CONFIDENCE' && samples.lowConfidence.length < sampleLimit) {
        samples.lowConfidence.push(c);
      }
      if (c.differentStructureSameTotal && samples.differentStructureSameTotal.length < sampleLimit) {
        samples.differentStructureSameTotal.push(c);
      }

      // Bounded candidate output
      if (!includeLowConfidence && c.decisionCategory === 'LOW_CONFIDENCE') continue;
      if (selectedCandidates.length >= maxReportCandidates) continue;
      const cntA = perProductCount.get(c.sourceProductId) || 0;
      const cntB = perProductCount.get(c.targetProductId) || 0;
      if (cntA >= maxCandidatesPerProduct || cntB >= maxCandidatesPerProduct) continue;

      perProductCount.set(c.sourceProductId, cntA + 1);
      perProductCount.set(c.targetProductId, cntB + 1);
      selectedCandidates.push(c);
    }

    return {
      generatedAt,
      normalizationVersion: SHADOW_NORMALIZATION_VERSION,
      dataSource: opts.dataSource || 'custom_dataset',
      readOnlyVerified: true,
      autoMergeExecuted: false,
      durationMs: Math.max(0, Date.now() - startMs),
      summary: {
        totalProductsAnalyzed: allProducts.length,
        canonicalProductsCount: canonicalRoots.length,
        aliasProductsSkippedCount,
        totalCandidatePairsGeneratedByBlocking: rawPairs.length,
        totalCandidatePairsEvaluated: evaluatedCandidates.length,
        highConfidenceCount,
        reviewCount,
        blockedCount,
        lowConfidenceCount,
        gs1ExactMatchesCount,
        brandBasedMatchesCount,
        titleBasedMatchesCount,
        quantityBasedMatchesCount,
        variantBasedMatchesCount,
        brandConflictsCount,
        quantityConflictsCount,
        multipackConflictsCount,
        differentStructureSameTotalCount,
        variantConflictsCount,
        insufficientIdentityProductsCount,
        falsePositiveRiskBreakdown
      },
      byRetailer,
      byRetailerPair,
      byMethod,
      samples,
      candidates: selectedCandidates
    };
  }
}
