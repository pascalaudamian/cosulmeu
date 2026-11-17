import { Product, ProductCategory, ProductOffer, ShoppingList, ShoppingListItem } from '../types.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';

export const GUEST_DEMO_LIST_ID = 'guest-demo-list';
export const GUEST_DEMO_LIST_NAME = 'Coș demonstrativ';

const STAPLE_CATEGORIES = new Set<ProductCategory>([
  'Lactate și ouă',
  'Panificație',
  'Fructe și legume',
  'Carne și pește',
  'Produse de bază',
  'Băuturi'
]);

export function normalizeCatalogStoreKey(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/^store-/, '')
    .replace(/-chain$/, '')
    .trim();
}

export function isGuestDemoList(list: ShoppingList | null | undefined): boolean {
  return Boolean(list && list.id === GUEST_DEMO_LIST_ID);
}

function isCleanDisplayName(name: string): boolean {
  const trimmed = (name || '').trim();
  return trimmed.length >= 4 && trimmed.length <= 65 && !trimmed.includes('\n') && !/^\d/.test(trimmed);
}

function formatDemoItemName(name: string): string {
  return (name || '').replace(/\s+/g, ' ').trim() || 'Produs';
}

interface RankedProductCandidate {
  product: Product;
  distinctStoreCount: number;
  verifiedCount: number;
  validOffersCount: number;
  minValidPrice: number | null;
  primaryStoreKey: string;
  isStapleCategory: boolean;
  isCleanTitle: boolean;
  hasPrice: boolean;
}

export function selectPopularCatalogProducts(
  products: Product[],
  offers: ProductOffer[],
  limit = 6
): { selected: Product[]; minPriceByProductId: Map<string, number> } {
  const minPriceByProductId = new Map<string, number>();
  if (!Array.isArray(products) || products.length === 0 || limit <= 0) {
    return { selected: [], minPriceByProductId };
  }

  const offersByProduct = new Map<string, ProductOffer[]>();
  for (const offer of offers || []) {
    if (!PriceComparisonService.isOfferValid(offer)) continue;
    const list = offersByProduct.get(offer.productId) || [];
    list.push(offer);
    offersByProduct.set(offer.productId, list);
  }

  const ranked: RankedProductCandidate[] = products.map(product => {
    const validOffers = offersByProduct.get(product.id) || [];
    const distinctStores = new Set<string>();
    let verifiedCount = 0;
    let minValidPrice: number | null = null;
    let primaryStoreKey = '';

    for (const offer of validOffers) {
      const storeKey = normalizeCatalogStoreKey(offer.storeId);
      if (storeKey) distinctStores.add(storeKey);
      if (offer.verificationStatus === 'verified') verifiedCount += 1;
      if (minValidPrice === null || offer.price < minValidPrice) {
        minValidPrice = offer.price;
        primaryStoreKey = storeKey;
      }
    }

    if (minValidPrice !== null) {
      minPriceByProductId.set(product.id, minValidPrice);
    }

    const effectivePrice = minValidPrice ?? (Number.isFinite(product.baseReferencePrice) && product.baseReferencePrice > 0 ? product.baseReferencePrice : 0);

    return {
      product,
      distinctStoreCount: distinctStores.size,
      verifiedCount,
      validOffersCount: validOffers.length,
      minValidPrice,
      primaryStoreKey,
      isStapleCategory: STAPLE_CATEGORIES.has(product.category),
      isCleanTitle: isCleanDisplayName(product.name),
      hasPrice: effectivePrice > 0
    };
  });

  ranked.sort((a, b) => {
    if (b.distinctStoreCount !== a.distinctStoreCount) {
      return b.distinctStoreCount - a.distinctStoreCount;
    }
    if (b.verifiedCount !== a.verifiedCount) {
      return b.verifiedCount - a.verifiedCount;
    }
    if (b.validOffersCount !== a.validOffersCount) {
      return b.validOffersCount - a.validOffersCount;
    }
    if (a.isStapleCategory !== b.isStapleCategory) {
      return a.isStapleCategory ? -1 : 1;
    }
    if (a.isCleanTitle !== b.isCleanTitle) {
      return a.isCleanTitle ? -1 : 1;
    }
    if (a.hasPrice !== b.hasPrice) {
      return a.hasPrice ? -1 : 1;
    }
    return a.product.name.localeCompare(b.product.name, 'ro');
  });

  const selected: Product[] = [];
  const selectedIds = new Set<string>();
  const usedCategories = new Set<ProductCategory>();
  const usedStores = new Set<string>();

  const pushCandidate = (candidate: RankedProductCandidate) => {
    if (selected.length >= limit || selectedIds.has(candidate.product.id)) return;
    selected.push(candidate.product);
    selectedIds.add(candidate.product.id);
    usedCategories.add(candidate.product.category);
    if (candidate.primaryStoreKey) {
      usedStores.add(candidate.primaryStoreKey);
    }
  };

  // 1. Prioritize products covered by multiple distinct stores (best for cross-store comparison)
  const multiStoreCandidates = ranked.filter(c => c.distinctStoreCount > 1);
  for (const candidate of multiStoreCandidates) {
    if (selected.length >= limit) break;
    if (!usedCategories.has(candidate.product.category)) {
      pushCandidate(candidate);
    }
  }
  for (const candidate of multiStoreCandidates) {
    if (selected.length >= limit) break;
    pushCandidate(candidate);
  }

  // 2. Fill remaining slots with popular catalog items that have active offers, favoring category & store diversity
  const offeredCandidates = ranked.filter(c => c.validOffersCount > 0 && !selectedIds.has(c.product.id));
  for (const candidate of offeredCandidates) {
    if (selected.length >= limit) break;
    if (!usedCategories.has(candidate.product.category) && candidate.primaryStoreKey && !usedStores.has(candidate.primaryStoreKey)) {
      pushCandidate(candidate);
    }
  }
  for (const candidate of offeredCandidates) {
    if (selected.length >= limit) break;
    if (!usedCategories.has(candidate.product.category)) {
      pushCandidate(candidate);
    }
  }
  for (const candidate of offeredCandidates) {
    if (selected.length >= limit) break;
    pushCandidate(candidate);
  }

  // 3. Fallback when catalog offers are not loaded yet
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (!usedCategories.has(candidate.product.category)) {
      pushCandidate(candidate);
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    pushCandidate(candidate);
  }

  return { selected, minPriceByProductId };
}

export function buildGuestDemoShoppingList(
  products: Product[],
  offers: ProductOffer[],
  limit = 6
): ShoppingList {
  const { selected, minPriceByProductId } = selectPopularCatalogProducts(products, offers, limit);

  const items: ShoppingListItem[] = selected.map(product => {
    const minOfferPrice = minPriceByProductId.get(product.id);
    const refPrice = minOfferPrice ?? (Number.isFinite(product.baseReferencePrice) && product.baseReferencePrice > 0
      ? product.baseReferencePrice
      : 10);
    const unit = product.defaultUnit === 'g' || product.defaultUnit === 'ml'
      ? 'buc'
      : (product.defaultUnit || 'buc');

    return {
      id: `guest-demo-item-${product.id}`,
      productId: product.id,
      name: formatDemoItemName(product.name),
      brand: product.brand || undefined,
      category: product.category || 'Alte produse',
      quantity: 1,
      unit,
      checked: false,
      barcode: product.barcode,
      referencePrice: refPrice,
      estimatedPrice: refPrice
    };
  });

  const nowIso = new Date().toISOString();
  return {
    id: GUEST_DEMO_LIST_ID,
    name: GUEST_DEMO_LIST_NAME,
    items,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export function selectDashboardListsForSession(params: {
  isAuthenticated: boolean;
  userShoppingLists?: ShoppingList[] | null;
  localShoppingLists: ShoppingList[];
  guestDemoList: ShoppingList;
}): { lists: ShoppingList[]; isDemoMode: boolean } {
  const { isAuthenticated, userShoppingLists, localShoppingLists, guestDemoList } = params;

  if (isAuthenticated) {
    return {
      lists: Array.isArray(userShoppingLists) ? userShoppingLists : [],
      isDemoMode: false
    };
  }

  const cleanLocal = (localShoppingLists || []).filter(list => list.id !== GUEST_DEMO_LIST_ID);
  if (cleanLocal.length > 0) {
    return {
      lists: cleanLocal,
      isDemoMode: false
    };
  }

  return {
    lists: [guestDemoList],
    isDemoMode: true
  };
}

export function materializeGuestDemoLists(
  lists: ShoppingList[],
  replacementId: string
): ShoppingList[] {
  return lists.map(list => {
    if (list.id !== GUEST_DEMO_LIST_ID) return list;
    return {
      ...list,
      id: replacementId,
      name: list.name === GUEST_DEMO_LIST_NAME ? 'Coșul Meu' : list.name,
      updatedAt: new Date().toISOString()
    };
  });
}
