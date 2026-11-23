import {
  Product,
  ProductAlternativeKind,
  ProductAlternativeRecommendation,
  ProductAlternativesResult,
  ProductOffer,
  Store
} from '../types.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import {
  buildCanonicalAliasIndex,
  type CanonicalAliasSource,
  collectProductIdsForCanonical,
  resolveCanonicalProductId
} from './ProductIdentityService.js';

const KIND_LABELS_RO: Record<ProductAlternativeKind, string> = {
  same_product_other_retailer: 'Același produs la alt retailer',
  same_product_other_size: 'Același produs în alt gramaj',
  similar_product: 'Produse similare',
  alternative_brand: 'Branduri alternative',
  private_label: 'Marcă proprie'
};

const PRIVATE_LABEL_BRANDS = new Set([
  'pilos',
  'cien',
  'floralys',
  'milbona',
  'pikok',
  'combino',
  'k-classic',
  'k classic',
  'carrefour',
  'carrefour classic',
  'carrefour bio',
  'simpl',
  'drag de romania',
  'boni',
  'penny',
  'myproject',
  's-budget',
  '365',
  'gusturi romanesti',
  'auchan',
  'proxi',
  'aro',
  'fine life',
  'rioba',
  'chef select',
  'delicato',
  'camara noastra',
  'solevita',
  'freeway',
  'lidl',
  'kaufland',
  'mega image',
  'profi',
  'metro'
]);

const STOPWORDS = new Set([
  'de', 'cu', 'si', 'in', 'la', 'din', 'pentru', 'fara', 'sau', 'cu', 'bio', 'ro'
]);

const CONCEPT_FAMILIES: Array<{ id: string; keywords: string[] }> = [
  { id: 'pet_food', keywords: ['pisici', 'caini', 'hrana umeda', 'hrana uscata', 'hrana animale', 'pliculete pisici'] },
  { id: 'plant_milk', keywords: ['bautura vegetala', 'lapte de soia', 'lapte migdale', 'lapte ovaz', 'soia', 'migdale'] },
  { id: 'milk', keywords: ['lapte'] },
  { id: 'yogurt', keywords: ['iaurt', 'kefir', 'sana', 'ayran'] },
  { id: 'sour_cream', keywords: ['smantana'] },
  { id: 'butter', keywords: ['unt ', 'unt ', 'margarina'] },
  { id: 'cheese', keywords: ['telemea', 'cascaval', 'mozzarella', 'branza', 'feta', 'parmezan', 'ricotta', 'crema de branza'] },
  { id: 'eggs', keywords: ['oua'] },
  { id: 'oil', keywords: ['ulei'] },
  { id: 'vinegar', keywords: ['otet'] },
  { id: 'sugar', keywords: ['zahar'] },
  { id: 'salt', keywords: ['sare'] },
  { id: 'flour', keywords: ['faina'] },
  { id: 'cornmeal', keywords: ['malai', 'gris'] },
  { id: 'rice', keywords: ['orez'] },
  { id: 'pasta', keywords: ['paste', 'spaghetti', 'penne', 'fusilli', 'macaroane', 'taitei'] },
  { id: 'chocolate', keywords: ['ciocolata', 'praline', 'tableta cacao'] },
  { id: 'tomato_sauce', keywords: ['bulion', 'pasta tomate', 'rosii cuburi', 'pasata'] },
  { id: 'coffee', keywords: ['cafea', 'espresso'] },
  { id: 'tea', keywords: ['ceai'] },
  { id: 'water', keywords: ['apa plata', 'apa minerala', 'apa carbogazoasa'] },
  { id: 'juice_soda', keywords: ['suc', 'nectar', 'cola', 'pepsi', 'limonada', 'bautura racoritoare'] },
  { id: 'beer', keywords: ['bere'] },
  { id: 'wine', keywords: ['vin'] },
  { id: 'bread', keywords: ['paine', 'toast', 'bagheta', 'franzela', 'chifle', 'lipie'] },
  { id: 'poultry', keywords: ['pui', 'piept de pui', 'pulpe de pui', 'curcan', 'aripi pui'] },
  { id: 'pork', keywords: ['porc', 'ceafa', 'cotlet', 'pulpa porc'] },
  { id: 'beef', keywords: ['vita', 'antricot', 'manzat'] },
  { id: 'cold_cuts', keywords: ['salam', 'sunca', 'carnati', 'parizer', 'crenvursti', 'bacon', 'muschiulet'] },
  { id: 'fish', keywords: ['somon', 'ton', 'pastrav', 'dorada', 'sardine', 'peste', 'macrou'] },
  { id: 'laundry', keywords: ['detergent rufe', 'capsule rufe', 'balsam rufe', 'detergent lichid', 'detergent pudra', 'ariel', 'persil', 'lenor', 'dero'] },
  { id: 'dishwash', keywords: ['detergent vase', 'tablete vase', 'masina spalat vase', 'fairy'] },
  { id: 'surface_clean', keywords: ['solutie geamuri', 'solutie pardoseli', 'degresant', 'dezinfectant', 'clor'] },
  { id: 'toilet_paper', keywords: ['hartie igienica'] },
  { id: 'paper_towel', keywords: ['prosoape hartie', 'prosoape bucatarie', 'servetele'] },
  { id: 'toothpaste', keywords: ['pasta dinti', 'pasta de dinti', 'apa de gura'] },
  { id: 'shower_hair', keywords: ['sampon', 'gel dus', 'gel de dus', 'balsam par'] },
  { id: 'soap', keywords: ['sapun'] },
  { id: 'deodorant', keywords: ['deodorant', 'antiperspirant'] },
  { id: 'apples', keywords: ['mere'] },
  { id: 'bananas', keywords: ['banane'] },
  { id: 'tomatoes', keywords: ['rosii'] },
  { id: 'potatoes', keywords: ['cartofi'] }
];

function normalizeText(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s%-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeCoreName(product: Product): string[] {
  const brandNorm = normalizeText(product.brand);
  const nameNorm = normalizeText(product.name);
  return nameNorm
    .split(/\s+/)
    .filter(tok => tok.length >= 2)
    .filter(tok => !STOPWORDS.has(tok))
    .filter(tok => tok !== brandNorm)
    .filter(tok => !/^\d+(?:[.,]\d+)?(?:g|kg|ml|l|buc|rolle|role|tablete)?$/.test(tok));
}

function resolveConceptFamily(product: Product): string | null {
  const combined = ` ${normalizeText(product.name)} ${normalizeText(product.subcategory || '')} `;
  for (const family of CONCEPT_FAMILIES) {
    if (family.keywords.some(kw => combined.includes(` ${kw}`) || combined.includes(kw))) {
      return family.id;
    }
  }
  return null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeStoreKey(storeId: string): string {
  return (storeId || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
}

export function isPrivateLabelBrand(brand: string, stores: Store[] = []): boolean {
  const norm = normalizeText(brand);
  if (!norm) return false;
  if (PRIVATE_LABEL_BRANDS.has(norm)) return true;
  if (norm.includes('marca proprie')) return true;
  for (const s of stores) {
    const sNorm = normalizeText(s.name);
    if (sNorm && (norm === sNorm || norm.startsWith(`${sNorm} `))) return true;
  }
  return false;
}

export function computeNormalizedUnitPrice(offer: ProductOffer, product: Product, useLoyaltyCards: boolean): {
  price: number;
  unitPrice: number;
  unitLabel: string;
} {
  const effectivePrice =
    offer.loyaltyCardRequired && !useLoyaltyCards && offer.originalPrice && offer.originalPrice > 0
      ? offer.originalPrice
      : offer.price;

  let unitPrice = offer.unitPrice;
  if (offer.loyaltyCardRequired && !useLoyaltyCards && offer.originalPrice && offer.price > 0) {
    unitPrice = round2((offer.originalPrice / offer.price) * offer.unitPrice);
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    const w = Number(product.packageWeightOrVolume) || 1;
    const pu = (product.packageUnit || 'buc').toLowerCase();
    const nu = (product.normalizedUnit || 'buc').toLowerCase();
    if ((pu === 'g' && nu === 'kg') || (pu === 'ml' && nu === 'l')) {
      unitPrice = round2(effectivePrice / (w / 1000));
    } else if (w > 0) {
      unitPrice = round2(effectivePrice / w);
    } else {
      unitPrice = round2(effectivePrice);
    }
  }

  return {
    price: round2(effectivePrice),
    unitPrice: round2(unitPrice),
    unitLabel: offer.unitPriceMeasure || `lei/${product.normalizedUnit || 'buc'}`
  };
}

export function areProductsCompatibleForSubstitution(
  target: Product,
  candidate: Product
): { compatible: boolean; reasonRo: string } {
  if (!target || !candidate || target.id === candidate.id) {
    return { compatible: false, reasonRo: 'Același produs.' };
  }

  // Must stay in the same top-level category (never swap pet food with dairy, cleaning with food, etc.)
  if (target.category !== candidate.category) {
    return { compatible: false, reasonRo: 'Categorii incompatibile.' };
  }

  // Must share normalized comparison unit (kg with kg, l with l, buc with buc)
  if ((target.normalizedUnit || 'buc') !== (candidate.normalizedUnit || 'buc')) {
    return { compatible: false, reasonRo: 'Unități de măsură normalizate incompatibile.' };
  }

  // Subcategories, if both specified, must match cleanly
  if (
    target.subcategory &&
    candidate.subcategory &&
    normalizeText(target.subcategory) !== normalizeText(candidate.subcategory)
  ) {
    return { compatible: false, reasonRo: 'Subcategorii diferite.' };
  }

  // Concept family gate: prevent cross-type swaps inside the same category (e.g. Milk vs Cheese, Oil vs Sugar)
  const targetFamily = resolveConceptFamily(target);
  const candidateFamily = resolveConceptFamily(candidate);

  if (targetFamily && candidateFamily) {
    if (targetFamily !== candidateFamily) {
      return { compatible: false, reasonRo: 'Tipuri de produs incompatibile pentru substituție directă.' };
    }
    return {
      compatible: true,
      reasonRo: `Același tip de produs (${target.subcategory || target.category}), comparat la ${target.normalizedUnit}.`
    };
  }

  // If one has a recognized concept family and the other doesn't, require strong token overlap
  const tTokens = new Set(tokenizeCoreName(target));
  const cTokens = new Set(tokenizeCoreName(candidate));
  let intersection = 0;
  for (const tok of tTokens) {
    if (cTokens.has(tok)) intersection += 1;
  }
  const union = new Set([...tTokens, ...cTokens]).size || 1;
  const jaccard = intersection / union;

  if (intersection === 0 || jaccard < 0.25) {
    return { compatible: false, reasonRo: 'Produse fără compatibilitate funcțională suficientă.' };
  }

  return {
    compatible: true,
    reasonRo: `Produs compatibil din categoria ${target.category} (${target.normalizedUnit}).`
  };
}

export class ProductAlternativesService {
  static isPrivateLabelBrand = isPrivateLabelBrand;
  static areProductsCompatibleForSubstitution = areProductsCompatibleForSubstitution;

  static getAlternatives(params: {
    targetProduct: Product;
    allProducts: Product[];
    allOffers: ProductOffer[];
    stores: Store[];
    useLoyaltyCards?: boolean;
    limitPerGroup?: number;
    aliasMap?: CanonicalAliasSource;
  }): ProductAlternativesResult {
    const {
      allProducts,
      allOffers,
      stores,
      useLoyaltyCards = true,
      limitPerGroup = 6,
      aliasMap
    } = params;

    const aliasIndex = buildCanonicalAliasIndex(aliasMap ?? allProducts);
    const productById = new Map<string, Product>();
    for (const p of allProducts) {
      if (p?.id) productById.set(p.id, p);
    }

    const resolvedTargetId = resolveCanonicalProductId(params.targetProduct.id, aliasIndex);
    const targetProduct =
      (resolvedTargetId && productById.get(resolvedTargetId)) || params.targetProduct;

    const canonicalProducts = allProducts.filter(p => {
      if (!p?.id || p.canonicalProductId) return false;
      const cid = resolveCanonicalProductId(p.id, aliasIndex);
      return !cid || cid === p.id;
    });

    const storeMap = new Map<string, Store>();
    for (const s of stores) {
      if (!s?.id || s.id === 'validation-only-retailer') continue;
      storeMap.set(s.id, s);
      storeMap.set(normalizeStoreKey(s.id), s);
    }

    const resolveStore = (storeId: string): Store | null => {
      return storeMap.get(storeId) || storeMap.get(normalizeStoreKey(storeId)) || null;
    };

    const groups: Record<ProductAlternativeKind, ProductAlternativeRecommendation[]> = {
      same_product_other_retailer: [],
      same_product_other_size: [],
      similar_product: [],
      alternative_brand: [],
      private_label: []
    };

    const limitations: string[] = [];

    // Collect valid offers indexed by canonical productId
    const validOffersByProduct = new Map<string, ProductOffer[]>();

    for (const offer of allOffers) {
      if (!offer?.productId) continue;
      const canonicalOfferProdId = resolveCanonicalProductId(offer.productId, aliasIndex) || offer.productId;
      const prod = productById.get(canonicalOfferProdId) || productById.get(offer.productId);
      if (!prod) continue;
      if (!PriceComparisonService.isOfferValid(offer, prod)) continue;
      if (!resolveStore(offer.storeId)) continue;
      const normalizedOffer =
        offer.productId === prod.id ? offer : { ...offer, productId: prod.id };
      const arr = validOffersByProduct.get(prod.id) || [];
      arr.push(normalizedOffer);
      validOffersByProduct.set(prod.id, arr);
    }

    const targetValidOffers = (validOffersByProduct.get(targetProduct.id) || [])
      .map(offer => {
        const calc = computeNormalizedUnitPrice(offer, targetProduct, useLoyaltyCards);
        return { offer, ...calc, store: resolveStore(offer.storeId)! };
      })
      .sort((a, b) => a.unitPrice - b.unitPrice);

    const referenceEntry = targetValidOffers[0] || null;
    const referenceUnitPrice = referenceEntry ? referenceEntry.unitPrice : null;
    const referenceUnitLabel =
      referenceEntry?.unitLabel || `lei/${targetProduct.normalizedUnit || 'buc'}`;

    if (!referenceEntry) {
      limitations.push(
        'Produsul curent nu are o ofertă activă verificată; comparația economiilor este afișată față de prețul de referință al produsului.'
      );
    }

    const baselineUnitPrice =
      referenceUnitPrice ??
      computeNormalizedUnitPrice(
        {
          id: 'ref',
          productId: targetProduct.id,
          storeId: 'ref',
          price: targetProduct.baseReferencePrice,
          unitPrice: 0,
          unitPriceMeasure: `lei/${targetProduct.normalizedUnit}`,
          isPromo: false,
          observationDate: new Date().toISOString().slice(0, 10),
          source: 'verified',
          confidenceLevel: 'medium',
          verificationStatus: 'verified',
          lastChecked: new Date().toISOString()
        },
        targetProduct,
        true
      ).unitPrice;

    // 1. Same product at other retailers
    for (const entry of targetValidOffers) {
      if (referenceEntry && normalizeStoreKey(entry.store.id) === normalizeStoreKey(referenceEntry.store.id)) {
        continue;
      }
      const savingsPerUnit = round2(baselineUnitPrice - entry.unitPrice);
      const savingsPct = baselineUnitPrice > 0 ? round2((savingsPerUnit / baselineUnitPrice) * 100) : 0;
      groups.same_product_other_retailer.push({
        kind: 'same_product_other_retailer',
        kindLabelRo: KIND_LABELS_RO.same_product_other_retailer,
        product: targetProduct,
        bestOffer: entry.offer,
        store: entry.store,
        price: entry.price,
        normalizedUnitPrice: entry.unitPrice,
        normalizedUnitLabel: entry.unitLabel,
        savingsPerNormalizedUnit: savingsPerUnit,
        savingsPercent: savingsPct,
        isCheaperNormalized: savingsPerUnit > 0,
        isPrivateLabel: isPrivateLabelBrand(targetProduct.brand, stores),
        compatibilityReasonRo: `Exact același produs (${targetProduct.packageWeightOrVolume} ${targetProduct.packageUnit}) la ${entry.store.name}.`
      });
    }

    // 2-5. Cross-product compatible alternatives
    const targetBrandNorm = normalizeText(targetProduct.brand);
    const targetCoreTokens = new Set(tokenizeCoreName(targetProduct));

    for (const candidate of canonicalProducts) {
      if (candidate.id === targetProduct.id) continue;
      const candOffers = validOffersByProduct.get(candidate.id);
      if (!candOffers || candOffers.length === 0) continue;

      const compat = areProductsCompatibleForSubstitution(targetProduct, candidate);
      if (!compat.compatible) continue;

      const bestCand = candOffers
        .map(offer => ({
          offer,
          ...computeNormalizedUnitPrice(offer, candidate, useLoyaltyCards),
          store: resolveStore(offer.storeId)!
        }))
        .sort((a, b) => a.unitPrice - b.unitPrice)[0];

      if (!bestCand) continue;

      const candBrandNorm = normalizeText(candidate.brand);
      const sameBrand = Boolean(targetBrandNorm && candBrandNorm && targetBrandNorm === candBrandNorm);
      const differentPackage =
        Number(candidate.packageWeightOrVolume) !== Number(targetProduct.packageWeightOrVolume) ||
        normalizeText(candidate.packageUnit) !== normalizeText(targetProduct.packageUnit);

      const candTokens = new Set(tokenizeCoreName(candidate));
      let tokenHits = 0;
      for (const tok of targetCoreTokens) {
        if (candTokens.has(tok)) tokenHits += 1;
      }
      const maxTokenCount = Math.max(targetCoreTokens.size, candTokens.size, 1);
      const coreSimilarity = tokenHits / maxTokenCount;

      let kind: ProductAlternativeKind;
      if (sameBrand && differentPackage && coreSimilarity >= 0.5) {
        kind = 'same_product_other_size';
      } else if (!sameBrand && isPrivateLabelBrand(candidate.brand, stores)) {
        kind = 'private_label';
      } else if (!sameBrand && coreSimilarity >= 0.35) {
        kind = 'alternative_brand';
      } else {
        kind = 'similar_product';
      }

      const savingsPerUnit = round2(baselineUnitPrice - bestCand.unitPrice);
      const savingsPct = baselineUnitPrice > 0 ? round2((savingsPerUnit / baselineUnitPrice) * 100) : 0;

      groups[kind].push({
        kind,
        kindLabelRo: KIND_LABELS_RO[kind],
        product: candidate,
        bestOffer: bestCand.offer,
        store: bestCand.store,
        price: bestCand.price,
        normalizedUnitPrice: bestCand.unitPrice,
        normalizedUnitLabel: bestCand.unitLabel,
        savingsPerNormalizedUnit: savingsPerUnit,
        savingsPercent: savingsPct,
        isCheaperNormalized: savingsPerUnit > 0.005,
        isPrivateLabel: isPrivateLabelBrand(candidate.brand, stores),
        compatibilityReasonRo: compat.reasonRo
      });
    }

    // Sort each group strictly by normalized unit price ascending and cap
    const allRecs: ProductAlternativeRecommendation[] = [];
    for (const kind of Object.keys(groups) as ProductAlternativeKind[]) {
      groups[kind].sort((a, b) => a.normalizedUnitPrice - b.normalizedUnitPrice);
      groups[kind] = groups[kind].slice(0, limitPerGroup);
      allRecs.push(...groups[kind]);
    }

    const cheaperNormalizedAlternatives = allRecs
      .filter(r => r.kind !== 'same_product_other_retailer' && r.isCheaperNormalized)
      .sort((a, b) => a.normalizedUnitPrice - b.normalizedUnitPrice);

    return {
      targetProduct,
      referenceOffer: referenceEntry?.offer || null,
      referenceStore: referenceEntry?.store || null,
      referenceNormalizedUnitPrice: referenceUnitPrice,
      referenceNormalizedUnitLabel: referenceUnitLabel,
      groups,
      cheaperNormalizedAlternatives,
      totalCount: allRecs.length,
      limitations
    };
  }
}
