import type { Product, UnitType } from '../types.js';
import { validateAndNormalizeBarcode } from './ProductNormalizationService.js';

export interface CanonicalProductNode {
  id: string;
  canonicalProductId?: string | null;
  canonical_product_id?: string | null;
}

export interface CanonicalAliasIndex {
  parentById: Map<string, string | null>;
  childrenByCanonicalId: Map<string, Set<string>>;
  hasExplicitNodes: boolean;
}

export interface CanonicalResolutionResult {
  requestedId: string;
  canonicalId: string | null;
  found: boolean;
  wasAlias: boolean;
  hops: number;
  cycleDetected: boolean;
  visitedChain: string[];
}

const DEFAULT_MAX_ALIAS_HOPS = 16;

function isPlainRecord(val: unknown): val is Record<string, string | null | undefined> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Map);
}

function isCanonicalAliasIndex(val: unknown): val is CanonicalAliasIndex {
  return (
    Boolean(val) &&
    typeof val === 'object' &&
    'parentById' in (val as Record<string, unknown>) &&
    (val as CanonicalAliasIndex).parentById instanceof Map
  );
}

/**
 * Normalizează identificatorul unui magazin (ex: "store-lidl" / "lidl-chain" -> "lidl").
 */
export function normalizeStoreIdKey(storeId?: string | null): string {
  return (storeId || '')
    .toLowerCase()
    .replace(/^store-/, '')
    .replace(/-chain$/, '')
    .trim();
}

/**
 * Normalizează un cod de bare și generează variante echivalente (UPC-A 12 <-> EAN-13 cu '0').
 */
export function normalizeBarcodeCandidates(rawCode: string): string[] {
  const digits = (rawCode || '').replace(/\D/g, '').trim();
  if (digits.length < 6 || digits.length > 14) return [];

  const candidates = new Set<string>([digits]);
  if (digits.length === 12) {
    candidates.add(`0${digits}`);
  } else if (digits.length === 13 && digits.startsWith('0')) {
    candidates.add(digits.slice(1));
  }
  return Array.from(candidates);
}

/**
 * Normalizează coduri de bare UPC-A <-> EAN-13 DOAR dacă au format GS1 valid, digit de control corect
 * și nu sunt coduri interne / cu greutate variabilă (prefix 20..29).
 */
export function normalizeValidatedBarcodeCandidates(rawCode: string): string[] {
  const validation = validateAndNormalizeBarcode(rawCode);
  return validation.isEligibleForAutoMatch ? validation.normalizedEquivalentBarcodes : [];
}

/**
 * Construiește un index bidirecțional al relațiilor canonical_product_id.
 * Acceptă fie lista completă de noduri/produse, fie un Map / Record de aliasuri (aliasId -> parentId).
 */
export function buildCanonicalAliasIndex(
  input:
    | CanonicalAliasIndex
    | ReadonlyArray<CanonicalProductNode | Product>
    | Map<string, string | null | undefined>
    | Record<string, string | null | undefined>
    | null
    | undefined
): CanonicalAliasIndex {
  if (isCanonicalAliasIndex(input)) {
    return input;
  }

  const parentById = new Map<string, string | null>();
  const childrenByCanonicalId = new Map<string, Set<string>>();
  let hasExplicitNodes = false;

  const addChild = (parentId: string, childId: string) => {
    let set = childrenByCanonicalId.get(parentId);
    if (!set) {
      set = new Set<string>();
      childrenByCanonicalId.set(parentId, set);
    }
    set.add(childId);
  };

  if (Array.isArray(input)) {
    hasExplicitNodes = true;
    for (const raw of input) {
      if (!raw || typeof raw.id !== 'string') continue;
      const id = raw.id.trim();
      if (!id) continue;
      const rawParent =
        (raw as CanonicalProductNode).canonicalProductId ??
        (raw as CanonicalProductNode).canonical_product_id ??
        null;
      const parentId = typeof rawParent === 'string' && rawParent.trim() ? rawParent.trim() : null;
      parentById.set(id, parentId);
      if (parentId) {
        addChild(parentId, id);
      }
    }
  } else if (input instanceof Map) {
    for (const [rawId, rawParent] of input.entries()) {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id) continue;
      const parentId = typeof rawParent === 'string' && rawParent.trim() ? rawParent.trim() : null;
      parentById.set(id, parentId);
      if (parentId) {
        addChild(parentId, id);
      }
    }
  } else if (isPlainRecord(input)) {
    for (const [rawId, rawParent] of Object.entries(input)) {
      const id = rawId.trim();
      if (!id) continue;
      const parentId = typeof rawParent === 'string' && rawParent.trim() ? rawParent.trim() : null;
      parentById.set(id, parentId);
      if (parentId) {
        addChild(parentId, id);
      }
    }
  }

  return { parentById, childrenByCanonicalId, hasExplicitNodes };
}

/**
 * Rezolvă detaliat un productId (canonic sau alias cu 1..N niveluri) până la rădăcina canonică.
 * Protejat determinist împotriva auto-referințelor (A -> A) și ciclurilor (A -> B -> A).
 */
export function resolveCanonicalProductDetail(
  productId: string | undefined | null,
  indexOrSource:
    | CanonicalAliasIndex
    | ReadonlyArray<CanonicalProductNode | Product>
    | Map<string, string | null | undefined>
    | Record<string, string | null | undefined>
    | null
    | undefined,
  options?: {
    maxHops?: number;
    knownProductIds?: ReadonlySet<string>;
  }
): CanonicalResolutionResult {
  const requestedId = typeof productId === 'string' ? productId.trim() : '';
  if (!requestedId) {
    return {
      requestedId: '',
      canonicalId: null,
      found: false,
      wasAlias: false,
      hops: 0,
      cycleDetected: false,
      visitedChain: []
    };
  }

  const index = buildCanonicalAliasIndex(indexOrSource);
  const maxHops = Math.max(1, options?.maxHops ?? DEFAULT_MAX_ALIAS_HOPS);
  const knownIds = options?.knownProductIds;

  // Dacă avem listă explicită de noduri sau knownProductIds, verificăm existența nodului inițial
  if (index.hasExplicitNodes && !index.parentById.has(requestedId)) {
    return {
      requestedId,
      canonicalId: null,
      found: false,
      wasAlias: false,
      hops: 0,
      cycleDetected: false,
      visitedChain: []
    };
  }
  if (!index.hasExplicitNodes && knownIds && !knownIds.has(requestedId) && !index.parentById.has(requestedId)) {
    return {
      requestedId,
      canonicalId: null,
      found: false,
      wasAlias: false,
      hops: 0,
      cycleDetected: false,
      visitedChain: []
    };
  }

  const visited = new Set<string>([requestedId]);
  const visitedChain = [requestedId];
  let currentId = requestedId;
  let hops = 0;

  while (hops < maxHops) {
    const parentId = index.parentById.get(currentId);
    if (!parentId) {
      // Am ajuns la un nod canonic (fără părinte) sau la capătul hărții de aliasuri
      if (knownIds && !knownIds.has(currentId)) {
        return {
          requestedId,
          canonicalId: null,
          found: false,
          wasAlias: hops > 0,
          hops,
          cycleDetected: false,
          visitedChain
        };
      }
      return {
        requestedId,
        canonicalId: currentId,
        found: true,
        wasAlias: hops > 0,
        hops,
        cycleDetected: false,
        visitedChain
      };
    }

    // Protecție ciclu / auto-referință (A -> A sau A -> B -> A)
    if (visited.has(parentId)) {
      return {
        requestedId,
        canonicalId: null,
        found: false,
        wasAlias: hops > 0 || parentId !== requestedId,
        hops,
        cycleDetected: true,
        visitedChain: [...visitedChain, parentId]
      };
    }

    // Dacă avem index complet de noduri și părintele indicat nu există în tabel (referință orfană)
    if (index.hasExplicitNodes && !index.parentById.has(parentId)) {
      return {
        requestedId,
        canonicalId: null,
        found: false,
        wasAlias: true,
        hops: hops + 1,
        cycleDetected: false,
        visitedChain: [...visitedChain, parentId]
      };
    }

    visited.add(parentId);
    visitedChain.push(parentId);
    currentId = parentId;
    hops++;
  }

  // Depășirea adâncimii maxime este tratată sigur ca lanț corupt / ciclic
  return {
    requestedId,
    canonicalId: null,
    found: false,
    wasAlias: hops > 0,
    hops,
    cycleDetected: true,
    visitedChain
  };
}

/**
 * Helper concis care returnează ID-ul canonic rezolvat sau undefined dacă produsul lipsește ori este într-un ciclu.
 */
export function resolveCanonicalProductId(
  productId: string | undefined | null,
  indexOrSource:
    | CanonicalAliasIndex
    | ReadonlyArray<CanonicalProductNode | Product>
    | Map<string, string | null | undefined>
    | Record<string, string | null | undefined>
    | null
    | undefined,
  options?: {
    maxHops?: number;
    knownProductIds?: ReadonlySet<string>;
  }
): string | undefined {
  const res = resolveCanonicalProductDetail(productId, indexOrSource, options);
  return res.found && res.canonicalId ? res.canonicalId : undefined;
}

/**
 * Returnează ID-ul canonic împreună cu toate ID-urile alias descendente (1..N niveluri), fără bucle infinite.
 */
export function collectProductIdsForCanonical(
  productId: string | undefined | null,
  indexOrSource:
    | CanonicalAliasIndex
    | ReadonlyArray<CanonicalProductNode | Product>
    | Map<string, string | null | undefined>
    | Record<string, string | null | undefined>
    | null
    | undefined,
  options?: { maxHops?: number; knownProductIds?: ReadonlySet<string> }
): string[] {
  const index = buildCanonicalAliasIndex(indexOrSource);
  const resolved = resolveCanonicalProductDetail(productId, index, options);
  if (resolved.cycleDetected || !resolved.found || !resolved.canonicalId) {
    return [];
  }
  const rootId = resolved.canonicalId;

  const collected = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const children = index.childrenByCanonicalId.get(curr);
    if (!children) continue;
    for (const childId of children) {
      if (!collected.has(childId)) {
        collected.add(childId);
        queue.push(childId);
      }
    }
  }
  return Array.from(collected);
}

export type CanonicalAliasSource =
  | CanonicalAliasIndex
  | ReadonlyArray<CanonicalProductNode | Product>
  | Map<string, string | null | undefined>
  | Record<string, string | null | undefined>
  | null
  | undefined;

export function mergeCanonicalAliasSources(
  primary: CanonicalAliasSource,
  secondary?: CanonicalAliasSource
): CanonicalAliasIndex {
  const baseIndex = buildCanonicalAliasIndex(primary);
  if (!secondary) {
    return baseIndex;
  }
  const extraIndex = buildCanonicalAliasIndex(secondary);
  const parentById = new Map<string, string | null>(baseIndex.parentById);
  for (const [id, parentId] of extraIndex.parentById.entries()) {
    if (!parentById.has(id)) {
      parentById.set(id, parentId);
    } else if (parentId && !parentById.get(id)) {
      parentById.set(id, parentId);
    }
  }
  const childrenByCanonicalId = new Map<string, Set<string>>();
  for (const [childId, parentId] of parentById.entries()) {
    if (!parentId) continue;
    let set = childrenByCanonicalId.get(parentId);
    if (!set) {
      set = new Set<string>();
      childrenByCanonicalId.set(parentId, set);
    }
    set.add(childId);
  }
  return {
    parentById,
    childrenByCanonicalId,
    hasExplicitNodes: baseIndex.hasExplicitNodes || extraIndex.hasExplicitNodes
  };
}

/**
 * Construiește o hartă deterministă `anyProductId -> canonicalRootProduct` pentru toate
 * rădăcinile canonice și aliasurile lor valide (1..N niveluri, cu protecție împotriva ciclurilor
 * și fără a ascunde referințele rupte sau orfane).
 */
export function resolveProductReferenceMap<T extends CanonicalProductNode = Product>(
  products: ReadonlyArray<T>,
  aliasSource?: CanonicalAliasSource,
  options?: { maxHops?: number }
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const prod of products || []) {
    if (prod && typeof prod.id === 'string' && prod.id.trim()) {
      byId.set(prod.id.trim(), prod);
    }
  }

  // Combinăm sursa explicită de aliasuri (dacă există) cu eventualele legături de pe obiectele de produs
  const baseIndex = buildCanonicalAliasIndex(aliasSource ?? products);
  const mergedParentById = new Map<string, string | null>(baseIndex.parentById);
  for (const prod of byId.values()) {
    const rawParent = prod.canonicalProductId ?? prod.canonical_product_id ?? null;
    const parentId = typeof rawParent === 'string' && rawParent.trim() ? rawParent.trim() : null;
    if (!mergedParentById.has(prod.id)) {
      mergedParentById.set(prod.id, parentId);
    } else if (parentId && !mergedParentById.get(prod.id)) {
      mergedParentById.set(prod.id, parentId);
    }
  }

  const combinedIndex: CanonicalAliasIndex = {
    parentById: mergedParentById,
    childrenByCanonicalId: new Map<string, Set<string>>(),
    hasExplicitNodes: baseIndex.hasExplicitNodes || (!aliasSource && byId.size > 0)
  };
  for (const [childId, parentId] of mergedParentById.entries()) {
    if (!parentId) continue;
    let set = combinedIndex.childrenByCanonicalId.get(parentId);
    if (!set) {
      set = new Set<string>();
      combinedIndex.childrenByCanonicalId.set(parentId, set);
    }
    set.add(childId);
  }

  const knownProductIds = new Set<string>(byId.keys());
  const refMap = new Map<string, T>();

  const candidateIds = new Set<string>([...byId.keys(), ...mergedParentById.keys()]);
  for (const rawId of candidateIds) {
    const detail = resolveCanonicalProductDetail(rawId, combinedIndex, {
      maxHops: options?.maxHops,
      knownProductIds
    });
    if (!detail.found || !detail.canonicalId || detail.cycleDetected) {
      continue;
    }
    const rootProduct = byId.get(detail.canonicalId);
    if (rootProduct) {
      refMap.set(rawId, rootProduct);
    }
  }

  return refMap;
}

/**
 * Rezolvă un produs sau ID de produs (inclusiv alias multi-hop) până la obiectul produsului canonic.
 * Returnează `undefined` pentru ID lipsă, referință orfană sau lanț ciclic (nu fabrică produse false).
 */
export function resolveCanonicalProduct<T extends CanonicalProductNode = Product>(
  productOrId: string | T | null | undefined,
  productsOrById: ReadonlyArray<T> | ReadonlyMap<string, T>,
  aliasSource?: CanonicalAliasSource,
  options?: { maxHops?: number }
): T | undefined {
  const requestedId =
    typeof productOrId === 'string'
      ? productOrId.trim()
      : productOrId && typeof productOrId.id === 'string'
      ? productOrId.id.trim()
      : '';
  if (!requestedId) return undefined;

  const productList = Array.isArray(productsOrById)
    ? productsOrById
    : Array.from((productsOrById as ReadonlyMap<string, T>).values());
  const effectiveList =
    typeof productOrId !== 'string' &&
    productOrId &&
    !productList.some(p => p.id === requestedId)
      ? [...productList, productOrId]
      : productList;

  const refMap = resolveProductReferenceMap(effectiveList, aliasSource, options);
  return refMap.get(requestedId);
}

/**
 * Normalizează determinist referințele către `productId` / `matchedProductId` pe o colecție de elemente
 * (oferte, observații, alerte, articole de bon sau listă), fără acces la baza de date și fără a
 * pierde proveniența originală dacă este solicitată păstrarea ei.
 */
export function normalizeProductReferences<T extends object>(
  items: ReadonlyArray<T>,
  aliasSource: CanonicalAliasSource,
  options?: {
    fields?: ReadonlyArray<string>;
    knownProductIds?: ReadonlySet<string>;
    maxHops?: number;
    preserveOriginalField?: string;
    preserveInProvenanceKey?: string;
  }
): T[] {
  const index = buildCanonicalAliasIndex(aliasSource);
  const fields = options?.fields && options.fields.length > 0 ? options.fields : ['productId', 'matchedProductId'];

  return (items || []).map(item => {
    if (!item || typeof item !== 'object') return item;
    const rec = item as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;

    for (const field of fields) {
      const rawVal = rec[field];
      if (typeof rawVal !== 'string' || !rawVal.trim()) continue;
      const trimmed = rawVal.trim();
      const detail = resolveCanonicalProductDetail(trimmed, index, {
        maxHops: options?.maxHops,
        knownProductIds: options?.knownProductIds
      });
      if (!detail.found || !detail.canonicalId || detail.cycleDetected) {
        continue;
      }
      if (detail.canonicalId !== trimmed) {
        if (!next) next = { ...rec };
        next[field] = detail.canonicalId;
        if (options?.preserveOriginalField && next[options.preserveOriginalField] === undefined) {
          next[options.preserveOriginalField] = trimmed;
        }
        if (options?.preserveInProvenanceKey) {
          const existingProv =
            next.provenance && typeof next.provenance === 'object' && !Array.isArray(next.provenance)
              ? { ...(next.provenance as Record<string, unknown>) }
              : {};
          if (existingProv[options.preserveInProvenanceKey] === undefined) {
            existingProv[options.preserveInProvenanceKey] = trimmed;
          }
          next.provenance = existingProv;
        }
      }
    }

    return (next as unknown as T | null) ?? item;
  });
}

/**
 * Verifică dacă setarea `productId.canonical_product_id = candidateCanonicalId` ar introduce un ciclu.
 */
export function detectCanonicalCycle(
  productId: string,
  candidateCanonicalId: string,
  indexOrSource:
    | CanonicalAliasIndex
    | ReadonlyArray<CanonicalProductNode | Product>
    | Map<string, string | null | undefined>
    | Record<string, string | null | undefined>
): boolean {
  const a = (productId || '').trim();
  const b = (candidateCanonicalId || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;

  const index = buildCanonicalAliasIndex(indexOrSource);
  const visited = new Set<string>([a, b]);
  let curr: string | null | undefined = b;
  let hops = 0;

  while (curr && hops < DEFAULT_MAX_ALIAS_HOPS) {
    const parent = index.parentById.get(curr);
    if (!parent) return false;
    if (parent === a || visited.has(parent)) return true;
    visited.add(parent);
    curr = parent;
    hops++;
  }
  return hops >= DEFAULT_MAX_ALIAS_HOPS;
}

/**
 * Hash determinist pur JS (128-bit hex formatat din 2x FNV-1a) compatibil atât în Node, cât și în browser.
 */
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
  const h2 = fnv32(0x9e3779b9, `${input}#2`);
  const h3 = fnv32(0x85ebca6b, `${input.length}:${input}`);
  return `${h1}${h2}${h3}`.slice(0, length);
}

/**
 * Extrage un URL valid de produs (http/https), prioritizând `catalogUrl` față de `sourcePageUrl`
 * și evitând salvarea URL-ului generic al documentului PDF drept URL de produs.
 */
export function pickRetailerProductUrl(params: {
  catalogUrl?: string | null;
  sourcePageUrl?: string | null;
  documentUrl?: string | null;
}): string | undefined {
  const isHttpUrl = (raw?: string | null): raw is string => {
    if (!raw || typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  if (isHttpUrl(params.catalogUrl)) {
    return params.catalogUrl.trim();
  }

  if (isHttpUrl(params.sourcePageUrl)) {
    const src = params.sourcePageUrl.trim();
    const doc = typeof params.documentUrl === 'string' ? params.documentUrl.trim() : '';
    if (!doc || src !== doc) {
      return src;
    }
  }

  return undefined;
}

/**
 * Generează un external_sku determinist și idempotent pentru `retailer_products`,
 * complet independent de `runId`, timestamp sau indexul din batch.
 */
export function buildCanonicalExternalSku(params: {
  retailerId: string;
  retailerSku?: string | null;
  barcode?: string | null;
  catalogUrl?: string | null;
  sourcePageUrl?: string | null;
  documentUrl?: string | null;
  title?: string | null;
  packageQuantity?: number | null;
  packageUnit?: UnitType | string | null;
}): string {
  const explicitSku = (params.retailerSku || '').trim();
  if (explicitSku && !/^stg-/i.test(explicitSku)) {
    return explicitSku.slice(0, 120);
  }

  const barcodeDigits = (params.barcode || '').replace(/\D/g, '').trim();
  if (barcodeDigits.length >= 8 && barcodeDigits.length <= 14) {
    return `ean-${barcodeDigits}`;
  }

  const productUrl = pickRetailerProductUrl({
    catalogUrl: params.catalogUrl,
    sourcePageUrl: params.sourcePageUrl,
    documentUrl: params.documentUrl
  });
  if (productUrl) {
    try {
      const u = new URL(productUrl);
      const canonicalPath = `${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
      return `url-${deterministicHexHash(`${params.retailerId}::${canonicalPath}`, 20)}`;
    } catch {
      // Continuă către amprenta semantică deterministă
    }
  }

  const normTitle = (params.title || 'produs')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const qty = Number.isFinite(Number(params.packageQuantity)) && Number(params.packageQuantity) > 0
    ? Number(params.packageQuantity).toString()
    : '';
  const unit = (params.packageUnit || '').toString().toLowerCase().trim();
  return `sku-${deterministicHexHash(`${params.retailerId}|${normTitle}|${qty}|${unit}`, 20)}`;
}
