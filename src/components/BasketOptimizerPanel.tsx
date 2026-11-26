import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  ChevronDown,
  ChevronUp,
  Info,
  Layers,
  MapPin,
  Package,
  RefreshCw,
  ShieldAlert,
  Star,
  Store as StoreIcon,
  Tag,
  Ticket
} from 'lucide-react';
import {
  BasketMultiStorePlan,
  BasketOptimizationOptions,
  BasketOptimizationResult,
  Product,
  ProductOffer,
  ShoppingList,
  Store
} from '../types.js';
import { BasketOptimizerService } from '../services/BasketOptimizerService.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { StorageService } from '../services/StorageService.js';
import { STORES } from '../data/mockData.js';
import { supabase } from '../lib/supabase.js';

interface BasketOptimizerPanelProps {
  lists?: ShoppingList[];
  activeList: ShoppingList;
  onSelectActiveList?: (listId: string) => void;
  onBackToList?: () => void;
  products?: Product[];
  offers?: ProductOffer[];
  stores?: Store[];
  initialTransportCost?: number;
  initialMaxStores?: number;
  singleStoreOnly?: boolean;
  defaultRegion?: string;
  compact?: boolean;
}

const STANDARD_REGIONS = [
  'Național',
  'București',
  'Cluj-Napoca',
  'Timișoara',
  'Iași',
  'Brașov',
  'Constanța',
  'Oradea',
  'Ploiești'
];

function formatRoDateTime(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return 'Indisponibil';
  const parsed = new Date(isoOrDate);
  if (!Number.isFinite(parsed.getTime())) return isoOrDate;
  return parsed.toLocaleString('ro-RO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRoShortDate(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '—';
  const parsed = new Date(isoOrDate);
  if (!Number.isFinite(parsed.getTime())) return isoOrDate;
  return parsed.toLocaleDateString('ro-RO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function formatSourceLabelRo(source?: string): string {
  switch (source) {
    case 'official_feed':
      return 'Feed oficial';
    case 'partner_api':
      return 'API partener';
    case 'verified':
      return 'Preț verificat';
    case 'receipt':
      return 'Bon fiscal verificat';
    case 'crowdsourced':
      return 'Raportat de utilizatori';
    case 'scraper':
      return 'Catalog magazin';
    default:
      return source || 'Catalog Coșul Meu';
  }
}

function formatPromoPeriodRo(validFrom?: string, validUntil?: string): string | null {
  if (validFrom && validUntil) {
    return `${formatRoShortDate(validFrom)} – ${formatRoShortDate(validUntil)}`;
  }
  if (validUntil) {
    return `până la ${formatRoShortDate(validUntil)}`;
  }
  if (validFrom) {
    return `din ${formatRoShortDate(validFrom)}`;
  }
  return null;
}

function buildBasketCacheKey(
  list: ShoppingList,
  options: BasketOptimizationOptions,
  catalogSig: string
): string {
  const itemsSig = list.items
    .map(
      i =>
        `${i.id}:${i.productId || ''}:${i.barcode || ''}:${i.name}:${i.quantity}:${i.unit}:${i.checked ? '1' : '0'}`
    )
    .join('|');
  const optsSig = JSON.stringify({
    m: options.maxStores,
    e: [...(options.excludedStoreIds || [])].sort(),
    f: [...(options.favoriteStoreIds || [])].sort(),
    l: options.useLoyaltyCards,
    c: options.useCoupons,
    s: options.includeStaleOffers,
    a: options.maxOfferAgeDays || null,
    r: options.region || '',
    t: options.transportCostPerExtraStore
  });
  return `${list.id}::${list.updatedAt || ''}::${itemsSig}::${optsSig}::${catalogSig}`;
}

export const BasketOptimizerPanel: React.FC<BasketOptimizerPanelProps> = ({
  lists,
  activeList,
  onSelectActiveList,
  onBackToList,
  products,
  offers,
  stores,
  initialTransportCost = 0,
  initialMaxStores = 1,
  singleStoreOnly,
  defaultRegion,
  compact = false
}) => {
  const isSingleStoreOnly = Boolean(singleStoreOnly || initialMaxStores === 1);
  const [maxStores, setMaxStores] = useState<number>(isSingleStoreOnly ? 1 : initialMaxStores);
  useEffect(() => {
    setMaxStores(isSingleStoreOnly ? 1 : initialMaxStores);
  }, [initialMaxStores, isSingleStoreOnly]);
  const [excludedStoreIds, setExcludedStoreIds] = useState<string[]>([]);
  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>(() => {
    const profile = StorageService.getUserProfile();
    return Array.isArray(profile.preferredStores) ? profile.preferredStores : [];
  });
  const [useLoyaltyCards, setUseLoyaltyCards] = useState<boolean>(
    () => StorageService.getUserProfile().useLoyaltyCards ?? true
  );
  const [useCoupons, setUseCoupons] = useState<boolean>(false);
  const [stalePolicy, setStalePolicy] = useState<'include_warn' | 'exclude_7d' | 'strict_3d'>('include_warn');
  const [selectedRegion, setSelectedRegion] = useState<string>('Național');
  const [showLimitations, setShowLimitations] = useState<boolean>(true);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  const [serverSyncEntry, setServerSyncEntry] = useState<{
    cacheKey: string;
    result: BasketOptimizationResult;
    meta: { batchQueryMode?: string; catalogCacheHit?: boolean } | null;
  } | null>(null);
  const [isServerSyncing, setIsServerSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [recalcNonce, setRecalcNonce] = useState<number>(0);

  // Cache scoped strictly by list + items + options + catalog signature
  const serverResultCacheRef = useRef<
    Map<string, { result: BasketOptimizationResult; meta: { batchQueryMode?: string; catalogCacheHit?: boolean } | null }>
  >(new Map());
  const requestSeqRef = useRef<number>(0);
  const latestCacheKeyRef = useRef<string>('');

  const regionOptions = useMemo(() => {
    const cityCandidate = (defaultRegion || StorageService.getUserProfile().city || '').trim();
    if (cityCandidate && !STANDARD_REGIONS.some(r => r.toLowerCase() === cityCandidate.toLowerCase())) {
      return ['Național', cityCandidate, ...STANDARD_REGIONS.slice(1)];
    }
    return STANDARD_REGIONS;
  }, [defaultRegion]);

  const resolvedProducts = useMemo(
    () => (products && products.length > 0 ? products : StorageService.getAllProducts()),
    [products]
  );
  const resolvedOffers = useMemo(
    () => (offers && offers.length > 0 ? offers : StorageService.getProductOffers()),
    [offers]
  );
  const resolvedStores = useMemo(
    () => BasketOptimizerService.canonicalizeStores(stores && stores.length > 0 ? stores : STORES),
    [stores]
  );

  const catalogSignature = useMemo(
    () => `${resolvedProducts.length}:${resolvedOffers.length}:${resolvedStores.length}`,
    [resolvedProducts.length, resolvedOffers.length, resolvedStores.length]
  );

  const eligibleStoresCount = useMemo(
    () => Math.max(1, resolvedStores.filter(s => !excludedStoreIds.includes(s.id)).length),
    [resolvedStores, excludedStoreIds]
  );
  const allEligibleLimitValue = useMemo(
    () => Math.max(4, Math.min(20, resolvedStores.length)),
    [resolvedStores.length]
  );

  const effectiveMaxStores = isSingleStoreOnly ? 1 : maxStores;
  // Regula FAZA 2.2: nu inventăm costuri sau estimări de transport; optimizarea folosește exclusiv prețul produselor.
  const effectiveTransportCost = isSingleStoreOnly ? 0 : Math.max(0, initialTransportCost || 0);

  const optimizerOptions: BasketOptimizationOptions = useMemo(
    () => ({
      maxStores: effectiveMaxStores,
      excludedStoreIds,
      favoriteStoreIds,
      useLoyaltyCards,
      useCoupons,
      includeStaleOffers: stalePolicy === 'include_warn',
      maxOfferAgeDays: stalePolicy === 'strict_3d' ? 3 : stalePolicy === 'exclude_7d' ? 7 : undefined,
      region: selectedRegion === 'Național' ? undefined : selectedRegion,
      transportCostPerExtraStore: effectiveTransportCost
    }),
    [
      effectiveMaxStores,
      excludedStoreIds,
      favoriteStoreIds,
      useLoyaltyCards,
      useCoupons,
      stalePolicy,
      selectedRegion,
      effectiveTransportCost
    ]
  );

  const cacheKey = useMemo(
    () => buildBasketCacheKey(activeList, optimizerOptions, catalogSignature),
    [activeList, optimizerOptions, catalogSignature]
  );
  latestCacheKeyRef.current = cacheKey;

  // Instant deterministic client-side fallback calculation using current catalog snapshot
  const localOptimization = useMemo(
    () =>
      BasketOptimizerService.optimize({
        list: { id: activeList.id, name: activeList.name },
        items: activeList.items,
        options: { ...optimizerOptions, clientRevision: cacheKey.slice(0, 80) },
        products: resolvedProducts,
        offers: resolvedOffers,
        stores: resolvedStores
      }),
    [activeList, optimizerOptions, cacheKey, resolvedProducts, resolvedOffers, resolvedStores]
  );

  const runServerOptimization = useCallback(
    async (targetKey: string, forceBypassCache: boolean) => {
      if (!activeList.items.length) {
        setServerSyncEntry(null);
        setSyncError(null);
        setIsServerSyncing(false);
        return;
      }

      if (!forceBypassCache) {
        const cached = serverResultCacheRef.current.get(targetKey);
        if (cached) {
          setServerSyncEntry({ cacheKey: targetKey, result: cached.result, meta: cached.meta });
          setSyncError(null);
          setIsServerSyncing(false);
          return;
        }
      } else {
        serverResultCacheRef.current.delete(targetKey);
      }

      const seq = ++requestSeqRef.current;
      setIsServerSyncing(true);
      setSyncError(null);

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session?.access_token) {
            headers.Authorization = `Bearer ${data.session.access_token}`;
          }
        } catch {
          // Guest optimization continues cleanly
        }

        const res = await fetch('/api/basket/optimize', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            listId: activeList.id,
            listName: activeList.name,
            items: activeList.items,
            options: {
              ...optimizerOptions,
              clientRevision: `${seq}:${targetKey.slice(0, 64)}`
            }
          })
        });

        // Guard against stale async completion when list or options changed mid-flight
        if (seq !== requestSeqRef.current || latestCacheKeyRef.current !== targetKey) {
          return;
        }

        if (!res.ok) {
          let errMsg = 'Nu s-a putut sincroniza calculul cu serverul; se afișează calculul determinist local.';
          try {
            const errJson = await res.json();
            if (errJson?.error) errMsg = `${errJson.error} (se afișează calculul local)`;
          } catch {
            // Keep safe message
          }
          setSyncError(errMsg);
          return;
        }

        const payload = await res.json();
        if (seq !== requestSeqRef.current || latestCacheKeyRef.current !== targetKey) {
          return;
        }

        if (payload?.success && payload.optimization) {
          const optResult = payload.optimization as BasketOptimizationResult;
          const meta = (payload.meta || null) as { batchQueryMode?: string; catalogCacheHit?: boolean } | null;
          if (serverResultCacheRef.current.size >= 24) {
            const firstKey = serverResultCacheRef.current.keys().next().value;
            if (firstKey) serverResultCacheRef.current.delete(firstKey);
          }
          serverResultCacheRef.current.set(targetKey, { result: optResult, meta });
          setServerSyncEntry({ cacheKey: targetKey, result: optResult, meta });
          setSyncError(null);
        }
      } catch {
        if (seq === requestSeqRef.current && latestCacheKeyRef.current === targetKey) {
          setSyncError('Conexiunea cu serverul de prețuri a eșuat temporar; calculul afișat folosește catalogul local.');
        }
      } finally {
        if (seq === requestSeqRef.current) {
          setIsServerSyncing(false);
        }
      }
    },
    [activeList, optimizerOptions]
  );

  // Sync automatically whenever list, items, options, or explicit recalculation changes
  useEffect(() => {
    void runServerOptimization(cacheKey, recalcNonce > 0);
  }, [cacheKey, recalcNonce, runServerOptimization]);

  // Never render a server response from an older list revision / cacheKey
  const activeServerMatch = serverSyncEntry && serverSyncEntry.cacheKey === cacheKey ? serverSyncEntry : null;
  const optimization = activeServerMatch ? activeServerMatch.result : localOptimization;
  const serverMeta = activeServerMatch ? activeServerMatch.meta : null;

  const toggleExcludedStore = (storeId: string) => {
    setExcludedStoreIds(prev =>
      prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId]
    );
    setFavoriteStoreIds(prev => prev.filter(id => id !== storeId));
  };

  const toggleFavoriteStore = (storeId: string) => {
    setFavoriteStoreIds(prev =>
      prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId]
    );
    setExcludedStoreIds(prev => prev.filter(id => id !== storeId));
  };

  if (activeList.items.length === 0) {
    return (
      <div className="surface-card p-6 text-center space-y-4">
        {lists && lists.length > 1 && onSelectActiveList && (
          <div className="flex items-center justify-center gap-2">
            <label htmlFor="optimizer-list-select-empty" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Selectează o listă:
            </label>
            <select
              id="optimizer-list-select-empty"
              value={activeList.id}
              onChange={e => onSelectActiveList(e.target.value)}
              className="text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-100"
            >
              {lists.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.items.length})
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Adaugă cel puțin un produs în lista „{activeList.name}” pentru a calcula costul într-un supermarket.
        </p>
        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-bold hover:opacity-90 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Înapoi la lista de cumpărături</span>
          </button>
        )}
      </div>
    );
  }

  const singleBest = optimization.bestSingleStore;
  const twoStorePlan = optimization.bestTwoStores;
  const threeStorePlan = optimization.bestThreeStores;
  const activeRecommendedPlan: BasketMultiStorePlan | null = optimization.recommendedMultiStore;

  const selectedStorePlan =
    optimization.singleStoreRankings.find(r => r.store.id === selectedStoreId) ||
    singleBest ||
    optimization.singleStoreRankings[0] ||
    null;

  const primaryTotalDisplay = isSingleStoreOnly
    ? singleBest
      ? PriceComparisonService.formatRon(singleBest.totalPrice)
      : 'Indisponibil'
    : activeRecommendedPlan
    ? PriceComparisonService.formatRon(activeRecommendedPlan.totalWithTransport)
    : singleBest
    ? PriceComparisonService.formatRon(singleBest.totalPrice)
    : 'Indisponibil';

  const primaryStoreHeadline = isSingleStoreOnly
    ? singleBest
      ? singleBest.store.name
      : 'Niciun supermarket eligibil'
    : activeRecommendedPlan
    ? activeRecommendedPlan.stops.map(s => s.store.name).join(' + ')
    : singleBest
    ? singleBest.store.name
    : 'Niciun magazin disponibil';

  const activeSavings = isSingleStoreOnly
    ? singleBest?.savingsVsWorstStore && singleBest.savingsVsWorstStore > 0
      ? singleBest.savingsVsWorstStore
      : null
    : activeRecommendedPlan &&
      activeRecommendedPlan.hasValidSavingsBaseline &&
      activeRecommendedPlan.savingsVsBestSingleStore !== null &&
      activeRecommendedPlan.savingsVsBestSingleStore > 0
    ? activeRecommendedPlan.savingsVsBestSingleStore
    : singleBest?.savingsVsWorstStore && singleBest.savingsVsWorstStore > 0
    ? singleBest.savingsVsWorstStore
    : null;

  const activeSavingsContext = isSingleStoreOnly
    ? singleBest?.savingsVsWorstStore && singleBest.savingsVsWorstStore > 0
      ? 'față de cel mai scump supermarket comparabil'
      : 'Comparabilitate insuficientă fără acoperire completă comună'
    : activeRecommendedPlan &&
      activeRecommendedPlan.hasValidSavingsBaseline &&
      activeRecommendedPlan.savingsVsBestSingleStore !== null &&
      activeRecommendedPlan.savingsVsBestSingleStore > 0
    ? `față de ${activeRecommendedPlan.baselineSingleStore?.store.name || '1 magazin'} (acoperire egală)`
    : singleBest?.savingsVsWorstStore && singleBest.savingsVsWorstStore > 0
    ? 'față de cel mai scump magazin comparabil'
    : 'Comparabilitate insuficientă fără acoperire comună';

  const completeSingleStoreRankings = optimization.singleStoreRankings.filter(r => r.isComplete);
  const cheapestCompleteTotal = completeSingleStoreRankings.length > 0 ? completeSingleStoreRankings[0].totalPrice : null;

  return (
    <section
      aria-label={isSingleStoreOnly ? 'Optimizare coș într-un singur supermarket' : 'Optimizator coș de cumpărături'}
      className="surface-card p-4 sm:p-6 space-y-6"
    >
      {/* Header + Controls (Return, List Selector & Explicit Recalculate) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            {onBackToList && (
              <button
                type="button"
                onClick={onBackToList}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Înapoi la lista de cumpărături</span>
              </button>
            )}
            <div className="flex items-center gap-2">
              <StoreIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                {isSingleStoreOnly
                  ? `Optimizare Coș (1 supermarket) · ${activeList.name}`
                  : `Optimizator Multi-Magazin · ${activeList.name}`}
              </h2>
            </div>
            {optimization.isEstimative && (
              <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                *estimativ*
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 tabular-nums">
            {optimization.totalRequestedLines} rânduri în listă · {optimization.distinctNormalizedItemsCount} articole distincte
            {optimization.duplicateLinesMergedCount > 0 && ` (${optimization.duplicateLinesMergedCount} duplicate cumulate)`}
            {' · '}Ultima verificare prețuri: {formatRoDateTime(optimization.lastPriceVerificationAt)}
            {isServerSyncing && ' · Se recalculează...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {lists && lists.length > 0 && onSelectActiveList && (
            <div className="flex items-center gap-2">
              <label htmlFor="optimizer-list-select" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Listă:
              </label>
              <select
                id="optimizer-list-select"
                value={activeList.id}
                onChange={e => onSelectActiveList(e.target.value)}
                className="text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-100"
              >
                {lists.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.items.length})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={() => setRecalcNonce(n => n + 1)}
            disabled={isServerSyncing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isServerSyncing ? 'animate-spin' : ''}`} />
            <span>{isServerSyncing ? 'Se recalculează...' : isSingleStoreOnly ? 'Optimizează coșul' : 'Recalculare'}</span>
          </button>
        </div>
      </div>

      {/* Sync / API Error Banner (non-blocking, with retry) */}
      {syncError && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{syncError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRecalcNonce(n => n + 1)}
            className="self-start sm:self-auto px-3 py-1 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-500 cursor-pointer"
          >
            Reîncearcă
          </button>
        </div>
      )}

      {/* Top KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            {isSingleStoreOnly ? 'Cost total (1 supermarket)' : 'Total coș optim'}
          </span>
          <span className="font-display text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-1 block">
            {primaryTotalDisplay}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {isSingleStoreOnly
              ? singleBest
                ? singleBest.isComplete
                  ? `Coș complet (${singleBest.coveredItemsCount}/${optimization.distinctNormalizedItemsCount} produse)`
                  : `Subtotal parțial (${singleBest.coveredItemsCount}/${optimization.distinctNormalizedItemsCount}) · fără coș complet comparabil`
                : 'Nicio ofertă validă disponibilă'
              : activeRecommendedPlan
              ? `${activeRecommendedPlan.coveredItemsCount}/${optimization.distinctNormalizedItemsCount} produse acoperite`
              : 'Doar produse cu preț valid'}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            {isSingleStoreOnly ? 'Cel mai mic cost comparabil' : 'Magazin recomandat'}
          </span>
          <span className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 block truncate">
            {primaryStoreHeadline}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {singleBest
              ? isSingleStoreOnly
                ? singleBest.isComplete
                  ? `Acoperire 100% în RON · ${singleBest.coveredItemsCount} produse cu preț valid`
                  : `Acoperire ${singleBest.completenessPercentage}% (${singleBest.missingItems.length} lipsă)`
                : `1 magazin unic: ${singleBest.store.name} (${PriceComparisonService.formatRon(singleBest.totalPrice)})`
              : 'Niciun magazin cu acoperire validă'}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
            Economii estimate
          </span>
          <span className="font-display text-xl sm:text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1 block">
            {activeSavings !== null ? PriceComparisonService.formatRon(activeSavings) : 'Economie nedeterminată'}
          </span>
          <span className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 block">
            {activeSavingsContext}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            Ultima verificare prețuri
          </span>
          <span className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1.5 block">
            {formatRoDateTime(optimization.lastPriceVerificationAt)}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums block">
            Cea mai veche obs.: {formatRoShortDate(optimization.oldestPriceVerificationAt)}
          </span>
        </div>
      </div>

      {/* Configurator Row: Loyalty/Coupons/Stale/Region, Store favorites/exclusions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-50/70 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200/70 dark:border-slate-800">
        <div className="lg:col-span-6 space-y-3">
          {!isSingleStoreOnly && (
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
                Selector număr magazine
              </span>
              <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                {[
                  { val: 1, label: '1 magazin' },
                  { val: 2, label: 'Max 2' },
                  { val: 3, label: 'Max 3' },
                  { val: allEligibleLimitValue, label: `Toate eligibile (${eligibleStoresCount})` }
                ].map(opt => {
                  const isActiveOption =
                    opt.val >= 4 ? maxStores >= 4 : maxStores === opt.val;
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      aria-pressed={isActiveOption}
                      onClick={() => setMaxStores(opt.val)}
                      className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        isActiveOption
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={useLoyaltyCards}
              onClick={() => setUseLoyaltyCards(v => !v)}
              className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                useLoyaltyCards
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Carduri fidelitate: {useLoyaltyCards ? 'Incluse' : 'Excluse'}</span>
            </button>

            <button
              type="button"
              aria-pressed={useCoupons}
              onClick={() => setUseCoupons(v => !v)}
              className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                useCoupons
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Ticket className="w-3.5 h-3.5" />
              <span>Cupoane: {useCoupons ? 'Activate' : 'Neactivate'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <label htmlFor="optimizer-region" className="font-semibold">
                Regiune:
              </label>
              <select
                id="optimizer-region"
                value={selectedRegion}
                onChange={e => setSelectedRegion(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-slate-100"
              >
                {regionOptions.map(reg => (
                  <option key={reg} value={reg}>
                    {reg}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="optimizer-stale-policy" className="font-semibold">
                Vechime prețuri:
              </label>
              <select
                id="optimizer-stale-policy"
                value={stalePolicy}
                onChange={e => setStalePolicy(e.target.value as 'include_warn' | 'exclude_7d' | 'strict_3d')}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-slate-100"
              >
                <option value="include_warn">Include vechi (cu avertisment)</option>
                <option value="exclude_7d">Doar verificate ≤ 7 zile</option>
                <option value="strict_3d">Strict recente ≤ 3 zile</option>
              </select>
            </div>

          </div>

          {!isSingleStoreOnly && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Costurile de transport, carburantul și timpul de deplasare nu sunt incluse (nu sunt calculate sau estimate distanțe); calcul exclusiv pe prețurile produselor.
            </p>
          )}
          {isSingleStoreOnly && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Comparare exclusivă într-un singur supermarket, strict pe baza ofertelor reale în RON din catalog.
            </p>
          )}
        </div>

        {/* Store preferences: Favorite & Exclude */}
        <div className="lg:col-span-6">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
            Magazine favorite (★) și magazine excluse (⊘)
          </span>
          <div className="flex flex-wrap gap-1.5">
            {resolvedStores.map(st => {
              const isExcluded = excludedStoreIds.includes(st.id);
              const isFavorite = favoriteStoreIds.includes(st.id);
              return (
                <div
                  key={st.id}
                  className={`inline-flex items-center rounded-xl border text-xs overflow-hidden transition-colors ${
                    isExcluded
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 line-through opacity-75'
                      : isFavorite
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-bold'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleFavoriteStore(st.id)}
                    title={isFavorite ? 'Elimină de la favorite' : 'Marchează magazin favorit'}
                    className="px-2.5 py-1.5 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 flex items-center gap-1 cursor-pointer"
                  >
                    <Star
                      className={`w-3 h-3 ${
                        isFavorite ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                      }`}
                    />
                    <span>{st.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExcludedStore(st.id)}
                    title={isExcluded ? `Include ${st.name}` : `Exclude ${st.name}`}
                    className="px-2 py-1.5 border-l border-slate-200/70 dark:border-slate-700 hover:bg-rose-100/70 dark:hover:bg-rose-900/50 cursor-pointer"
                  >
                    <Ban className={`w-3 h-3 ${isExcluded ? 'text-rose-600' : 'text-slate-400'}`} />
                  </button>
                </div>
              );
            })}
          </div>
          {(excludedStoreIds.length > 0 || favoriteStoreIds.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              {favoriteStoreIds.length > 0 && <span>Favorite active: {favoriteStoreIds.length}</span>}
              {excludedStoreIds.length > 0 && <span>Excluse din optimizare: {excludedStoreIds.length}</span>}
              <button
                type="button"
                onClick={() => {
                  setExcludedStoreIds([]);
                  setFavoriteStoreIds([]);
                }}
                className="text-emerald-700 dark:text-emerald-400 font-semibold hover:underline cursor-pointer"
              >
                Resetează preferințele
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Strategy Comparison Grid: shown ONLY in multi-store mode */}
      {!isSingleStoreOnly && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Best Single Store */}
          <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  1. Cel mai ieftin magazin unic
                </span>
                {singleBest && (
                  <span
                    className={`text-[11px] font-bold tabular-nums ${
                      singleBest.isComplete
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {singleBest.isComplete ? 'COMPLET' : 'PARȚIAL'} · {singleBest.coveredItemsCount}/
                    {optimization.distinctNormalizedItemsCount} ({singleBest.completenessPercentage}%)
                  </span>
                )}
              </div>

              {singleBest ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                      {singleBest.store.name}
                    </span>
                    {singleBest.isFavorite && (
                      <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">★ Favorit</span>
                    )}
                  </div>

                  <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                    <span className="font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                      {PriceComparisonService.formatRon(singleBest.totalPrice)}
                    </span>
                    {singleBest.isEstimative && (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">*estimativ*</span>
                    )}
                  </div>

                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    {singleBest.savingsVsWorstStore !== null && singleBest.savingsVsWorstStore > 0 && (
                      <p className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                        -{PriceComparisonService.formatRon(singleBest.savingsVsWorstStore)} față de cel mai scump magazin comparabil
                      </p>
                    )}
                    {singleBest.missingItems.length > 0 && (
                      <p className="text-amber-700 dark:text-amber-400">
                        PARȚIAL: {singleBest.missingItems.length} articole fără ofertă în acest magazin
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  Niciun magazin activ nu are oferte valide.
                </p>
              )}
            </div>
          </div>

          {/* Card 2: Optimal 2-Store Plan */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border flex flex-col justify-between ${
              maxStores === 2 && twoStorePlan
                ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/25'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  2. Varianta optimă în 2 magazine
                </span>
                {twoStorePlan && (
                  <span
                    className={`text-[11px] font-bold tabular-nums ${
                      twoStorePlan.isComplete
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {twoStorePlan.coverageStatusRo || (twoStorePlan.isComplete ? 'COMPLET' : 'PARȚIAL')} ·{' '}
                    {twoStorePlan.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} · {twoStorePlan.storeCount}{' '}
                    {twoStorePlan.storeCount === 1 ? 'oprire' : 'opriri'}
                  </span>
                )}
              </div>

              {maxStores < 2 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  Selectează „Max 2”, „Max 3” sau „Toate eligibile” mai sus pentru a compara împărțirea în două magazine.
                </p>
              ) : twoStorePlan ? (
                <>
                  <div className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                    {twoStorePlan.stops.map(s => s.store.name).join(' + ')}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                    <span className="font-display text-2xl font-extrabold text-emerald-700 dark:text-emerald-400">
                      {PriceComparisonService.formatRon(twoStorePlan.totalWithTransport)}
                    </span>
                    {twoStorePlan.isEstimative && (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">*estimativ*</span>
                    )}
                  </div>
                  <div className="mt-2 text-xs space-y-1">
                    {twoStorePlan.hasValidSavingsBaseline && twoStorePlan.savingsVsBestSingleStore !== null ? (
                      <p
                        className={`font-semibold tabular-nums ${
                          twoStorePlan.savingsVsBestSingleStore > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {twoStorePlan.savingsVsBestSingleStore > 0
                          ? `Economie ${PriceComparisonService.formatRon(twoStorePlan.savingsVsBestSingleStore)} (${twoStorePlan.savingsPercentVsBestSingleStore}%) vs. 1 magazin`
                          : 'Fără economie suplimentară față de 1 magazin'}
                      </p>
                    ) : (
                      <p className="text-amber-700 dark:text-amber-400">
                        {twoStorePlan.savingsBasisRo ||
                          'Acoperire diferită (fără magazin unic echivalent pentru calculul economiei).'}
                      </p>
                    )}
                    {!twoStorePlan.isComplete && twoStorePlan.missingItems.length > 0 && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        PARȚIAL ({twoStorePlan.missingItems.length} articole lipsă — nu sunt calculate ca 0 RON)
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  Nu există oferte valide pentru combinarea a 2 magazine.
                </p>
              )}
            </div>
          </div>

          {/* Card 3: Optimal Max-3 (or All Eligible) Store Plan */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border flex flex-col justify-between ${
              maxStores >= 3 && activeRecommendedPlan
                ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/25'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  3. Varianta optimă ({maxStores > 3 ? `toate max ${optimization.maxStoresApplied}` : 'max 3'} magazine)
                </span>
                {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan) && (
                  <span
                    className={`text-[11px] font-bold tabular-nums ${
                      (maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.isComplete
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.coverageStatusRo ||
                      ((maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.isComplete ? 'COMPLET' : 'PARȚIAL')}{' '}
                    · {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.coveredItemsCount}/
                    {optimization.distinctNormalizedItemsCount} ·{' '}
                    {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.storeCount}{' '}
                    {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.storeCount === 1 ? 'oprire' : 'opriri'}
                  </span>
                )}
              </div>

              {maxStores < 3 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  Selectează „Max 3” sau „Toate eligibile” pentru optimizarea pe 3 sau mai multe magazine.
                </p>
              ) : (maxStores > 3 ? activeRecommendedPlan : threeStorePlan) ? (
                (() => {
                  const plan = (maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!;
                  return (
                    <>
                      <div className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                        {plan.stops.map(s => s.store.name).join(' + ')}
                      </div>
                      <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                        <span className="font-display text-2xl font-extrabold text-emerald-700 dark:text-emerald-400">
                          {PriceComparisonService.formatRon(plan.totalWithTransport)}
                        </span>
                        {plan.isEstimative && (
                          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">*estimativ*</span>
                        )}
                      </div>
                      <div className="mt-2 text-xs space-y-1">
                        {plan.hasValidSavingsBaseline && plan.savingsVsBestSingleStore !== null ? (
                          <p
                            className={`font-semibold tabular-nums ${
                              plan.savingsVsBestSingleStore > 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {plan.savingsVsBestSingleStore > 0
                              ? `Economie ${PriceComparisonService.formatRon(plan.savingsVsBestSingleStore)} (${plan.savingsPercentVsBestSingleStore}%) vs. ${plan.baselineSingleStore?.store.name}`
                              : `Egal cu ${plan.baselineSingleStore?.store.name} (fără economie suplimentară)`}
                          </p>
                        ) : (
                          <p className="text-amber-700 dark:text-amber-400">
                            {plan.savingsBasisRo || 'Acoperire maximă în limita selectată (fără reper unic comun).'}
                          </p>
                        )}
                        {!plan.isComplete && plan.missingItems.length > 0 && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            PARȚIAL ({plan.missingItems.length} articole lipsă — nu sunt calculate ca 0 RON)
                          </p>
                        )}
                      </div>
                    </>
                  );
                })()
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  Nu există oferte valide pentru planul în 3 magazine.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* All Supermarkets Comparison Table & Mobile Cards */}
      {optimization.singleStoreRankings.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <StoreIcon className="w-3.5 h-3.5" />
              <span>Comparație supermarketuri ({optimization.singleStoreRankings.length} magazine eligibile)</span>
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Produsele fără ofertă într-un magazin nu sunt incluse ca 0 RON
            </span>
          </div>

          {/* Mobile cards (< sm) */}
          <div className="space-y-2.5 sm:hidden">
            {optimization.singleStoreRankings.map((rank, index) => {
              const isBestComplete = rank.isComplete && index === 0;
              const isSelected = selectedStorePlan?.store.id === rank.store.id;
              const diffVsBestComplete =
                rank.isComplete && cheapestCompleteTotal !== null
                  ? Math.round((rank.totalPrice - cheapestCompleteTotal) * 100) / 100
                  : null;

              return (
                <div
                  key={`mobile-${rank.store.id}`}
                  className={`p-3.5 rounded-2xl border text-xs space-y-2 ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/25'
                      : isBestComplete
                      ? 'border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-6 h-6 rounded-md text-white text-[11px] font-bold flex items-center justify-center shrink-0 ${rank.store.brandColor}`}
                      >
                        {rank.store.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 dark:text-slate-100 block truncate">
                          {rank.store.name}
                          {rank.isFavorite ? ' ★' : ''}
                        </span>
                        {isBestComplete && (
                          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 block">
                            Cel mai mic cost comparabil
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right tabular-nums shrink-0">
                      <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 block">
                        {PriceComparisonService.formatRon(rank.totalPrice)}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {rank.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} ({rank.completenessPercentage}%)
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {diffVsBestComplete !== null
                        ? diffVsBestComplete === 0
                          ? 'Referință completă'
                          : `+${PriceComparisonService.formatRon(diffVsBestComplete)} vs. minim`
                        : `${rank.missingItems.length} produse fără preț`}
                      {' · '}Verificat: {formatRoShortDate(rank.lastVerifiedAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedStoreId(rank.store.id)}
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {isSelected ? 'Selectat' : 'Vezi detalii'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop/tablet table (sm+) */}
          <div className="hidden sm:block overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px]">Supermarket</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right">Total coș</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right">Acoperire (Valide / Lipsă)</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right">Diferență</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right hidden md:table-cell">Cea mai veche obs.</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right hidden lg:table-cell">Ultima verificare</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {optimization.singleStoreRankings.map((rank, index) => {
                  const isBestComplete = rank.isComplete && index === 0;
                  const isSelected = selectedStorePlan?.store.id === rank.store.id;
                  const diffVsBestComplete =
                    rank.isComplete && cheapestCompleteTotal !== null
                      ? Math.round((rank.totalPrice - cheapestCompleteTotal) * 100) / 100
                      : null;

                  return (
                    <tr
                      key={rank.store.id}
                      className={
                        isSelected
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/30'
                          : isBestComplete
                          ? 'bg-emerald-50/30 dark:bg-emerald-950/15'
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                      }
                    >
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-6 h-6 rounded-md text-white text-[11px] font-bold flex items-center justify-center shrink-0 ${rank.store.brandColor}`}
                          >
                            {rank.store.name.charAt(0)}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {rank.store.name}
                            </span>
                            {isBestComplete && (
                              <span className="ml-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                · Cel mai ieftin complet
                              </span>
                            )}
                            {rank.isFavorite && (
                              <span className="ml-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                ★
                              </span>
                            )}
                            {(rank.staleItemsCount ?? 0) > 0 && (
                              <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                                {rank.staleItemsCount} prețuri vechi/neconfirmate
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums">
                        <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                          {PriceComparisonService.formatRon(rank.totalPrice)}
                        </span>
                        {!rank.isComplete ? (
                          <span className="block text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                            Subtotal parțial ({rank.missingItems.length} lipsă)
                          </span>
                        ) : rank.isEstimative ? (
                          <span className="block text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                            *estimativ*
                          </span>
                        ) : null}
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        <div>
                          {rank.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} ({rank.completenessPercentage}%)
                        </div>
                        {rank.missingItems.length > 0 && (
                          <div className="text-[10px] text-amber-700 dark:text-amber-400">
                            {rank.missingItems.length} fără preț
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {diffVsBestComplete !== null ? (
                          diffVsBestComplete === 0 ? (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Referință</span>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-300">
                              +{PriceComparisonService.formatRon(diffVsBestComplete)}
                            </span>
                          )
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">Date incomplete</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 hidden md:table-cell">
                        {formatRoShortDate(rank.oldestVerifiedAt)}
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                        {rank.lastVerifiedAt ? formatRoDateTime(rank.lastVerifiedAt) : '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedStoreId(rank.store.id)}
                            className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            {isSelected ? 'Selectat' : 'Detalii'}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleFavoriteStore(rank.store.id)}
                            title={rank.isFavorite ? 'Scoate de la favorite' : 'Setează favorit'}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                rank.isFavorite ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExcludedStore(rank.store.id)}
                            title={`Exclude ${rank.store.name}`}
                            className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-900 dark:text-amber-200">
          Niciun supermarket eligibil nu are oferte valide în RON pentru produsele din această listă (conform filtrelor curente).
        </div>
      )}

      {/* Breakdown Section */}
      {isSingleStoreOnly && selectedStorePlan && !compact && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Detaliu produse în {selectedStorePlan.store.name} ({selectedStorePlan.allocations.length} cu ofertă validă
              {selectedStorePlan.missingItems.length > 0 ? `, ${selectedStorePlan.missingItems.length} fără preț` : ''})
            </h3>
            {optimization.singleStoreRankings.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {optimization.singleStoreRankings.map(r => (
                  <button
                    key={`tab-${r.store.id}`}
                    type="button"
                    onClick={() => setSelectedStoreId(r.store.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                      selectedStorePlan.store.id === r.store.id
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {r.store.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/70 dark:border-slate-700/70">
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-md text-white text-xs font-bold flex items-center justify-center ${selectedStorePlan.store.brandColor}`}
                >
                  {selectedStorePlan.store.name.charAt(0)}
                </div>
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{selectedStorePlan.store.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  ({selectedStorePlan.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} acoperite)
                </span>
              </div>
              <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 tabular-nums">
                {PriceComparisonService.formatRon(selectedStorePlan.totalPrice)}
              </span>
            </div>

            {selectedStorePlan.allocations.length > 0 && (
              <div className="space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  Produse cu ofertă validă ({selectedStorePlan.allocations.length})
                </div>
                <div className="divide-y divide-slate-200/60 dark:divide-slate-700/60">
                  {selectedStorePlan.allocations.map(alloc => {
                    const hasSurplus = (alloc.surplusQuantity ?? 0) > 0.001;
                    const showPackCount =
                      alloc.isIndivisiblePackage && alloc.packagesCount && alloc.packagesCount >= 1;
                    const promoPeriod = alloc.offer.isPromo
                      ? formatPromoPeriodRo(alloc.offer.validFrom, alloc.offer.validUntil)
                      : null;
                    const verifiedDate = formatRoShortDate(
                      alloc.offer.lastVerifiedAt || alloc.offer.observationDate || alloc.offer.lastChecked
                    );
                    const packageMeta = `${alloc.product.packageWeightOrVolume} ${alloc.product.packageUnit}`;
                    return (
                      <div
                        key={`${selectedStorePlan.store.id}-${alloc.item.id}`}
                        className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {alloc.product.name}
                            </span>
                            {alloc.product.brand && (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                · {alloc.product.brand}
                              </span>
                            )}
                            {alloc.offer.isPromo && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded">
                                Promoție{promoPeriod ? ` (${promoPeriod})` : ''}
                              </span>
                            )}
                          </div>
                          {alloc.item.name.trim().toLowerCase() !== alloc.product.name.trim().toLowerCase() && (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                              Din listă: „{alloc.item.name}”
                            </span>
                          )}
                          <span className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums block">
                            Ambalaj: {packageMeta} · Cerut: {PriceComparisonService.formatQuantity(alloc.aggregatedQuantity, alloc.item.unit)}
                            {alloc.mergedOccurrencesCount > 1 && ` (cumulat ${alloc.mergedOccurrencesCount}×)`}
                            {showPackCount &&
                              ` · Cumpărat: ${alloc.packagesCount} ${alloc.packagesCount === 1 ? 'ambalaj' : 'ambalaje'} (${PriceComparisonService.formatQuantity(alloc.purchasedQuantity || alloc.aggregatedQuantity, alloc.purchasedUnit || alloc.item.unit)})`}
                            {` · Preț unitar: ${alloc.unitPriceDisplay}`}
                          </span>
                          {hasSurplus && (
                            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 inline-flex items-center gap-1 tabular-nums">
                              <Package className="w-3 h-3 shrink-0" />
                              Surplus ambalaj: +{PriceComparisonService.formatQuantity(alloc.surplusQuantity!, alloc.surplusUnit || alloc.item.unit)}
                            </span>
                          )}
                          {alloc.conditionalPromoNoteRo && (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block">
                              {alloc.conditionalPromoNoteRo}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 block tabular-nums">
                            Stare: {alloc.qualityAssessment.labelRo} · Verificat: {verifiedDate} · Sursă: {formatSourceLabelRo(alloc.offer.source)}
                          </span>
                        </div>
                        <div className="text-right shrink-0 tabular-nums">
                          <span className="font-bold text-slate-900 dark:text-slate-100 block">
                            {PriceComparisonService.formatRon(alloc.calculatedPrice)}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase">
                            {alloc.currency || alloc.offer.currency || 'RON'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedStorePlan.missingItems.length > 0 && (
              <div className="pt-3 border-t border-slate-200/70 dark:border-slate-700/70 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Produse fără preț în {selectedStorePlan.store.name} ({selectedStorePlan.missingItems.length})
                </div>
                <ul className="space-y-1 text-xs text-amber-900 dark:text-amber-200">
                  {selectedStorePlan.missingItems.map(m => (
                    <li key={`${selectedStorePlan.store.id}-missing-${m.item.id}`}>
                      <span className="font-semibold">{m.item.name}</span> — {m.reasonRo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {!isSingleStoreOnly && activeRecommendedPlan && activeRecommendedPlan.stops.length > 0 && !compact && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Lista produselor pe magazine ({activeRecommendedPlan.stops.length}{' '}
                {activeRecommendedPlan.stops.length === 1 ? 'magazin' : 'magazine'}) ·{' '}
                {activeRecommendedPlan.coverageStatusRo || (activeRecommendedPlan.isComplete ? 'COMPLET' : 'PARȚIAL')}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {activeRecommendedPlan.explanationRo}
              </p>
            </div>
            <div className="text-right tabular-nums">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                Total produse: {PriceComparisonService.formatRon(activeRecommendedPlan.productsTotal)}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Transport și timp deplasare: neincluse
              </span>
            </div>
          </div>
          {activeRecommendedPlan.savingsBasisRo && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {activeRecommendedPlan.savingsBasisRo}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeRecommendedPlan.stops.map(stop => (
              <div
                key={stop.store.id}
                className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
              >
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-200/70 dark:border-slate-700/70">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-md text-white text-xs font-bold flex items-center justify-center ${stop.store.brandColor}`}
                    >
                      {stop.store.name.charAt(0)}
                    </div>
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {stop.store.name}
                      {stop.isFavorite ? ' ★' : ''}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">({stop.itemsCount} art.)</span>
                  </div>
                  <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 tabular-nums">
                    {PriceComparisonService.formatRon(stop.subtotal)}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {stop.allocations.map(alloc => {
                    const hasSurplus = (alloc.surplusQuantity ?? 0) > 0.001;
                    const showPackCount =
                      alloc.isIndivisiblePackage && alloc.packagesCount && alloc.packagesCount >= 1;
                    return (
                      <div
                        key={`${stop.store.id}-${alloc.item.id}`}
                        className="flex items-start justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                            {alloc.product.name}
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums block">
                            Cerut: {PriceComparisonService.formatQuantity(alloc.aggregatedQuantity, alloc.item.unit)}
                            {alloc.mergedOccurrencesCount > 1 && ` (cumulat ${alloc.mergedOccurrencesCount}×)`}
                            {showPackCount &&
                              ` · Cumpărat: ${alloc.packagesCount} ${alloc.packagesCount === 1 ? 'ambalaj' : 'ambalaje'} (${PriceComparisonService.formatQuantity(alloc.purchasedQuantity || alloc.aggregatedQuantity, alloc.purchasedUnit || alloc.item.unit)})`}
                            {` · ${alloc.unitPriceDisplay}`}
                          </span>
                          {hasSurplus && (
                            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 inline-flex items-center gap-1 tabular-nums">
                              <Package className="w-3 h-3 shrink-0" />
                              Surplus ambalaj: +{PriceComparisonService.formatQuantity(alloc.surplusQuantity!, alloc.surplusUnit || alloc.item.unit)}
                            </span>
                          )}
                          {alloc.conditionalPromoNoteRo && (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block">
                              {alloc.conditionalPromoNoteRo}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                            {alloc.qualityAssessment.labelRo} · Verificat: {formatRoShortDate(alloc.offer.lastVerifiedAt || alloc.offer.observationDate || alloc.offer.lastChecked)} · Sursă: {formatSourceLabelRo(alloc.offer.source)}
                          </span>
                        </div>
                        <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                          {PriceComparisonService.formatRon(alloc.calculatedPrice)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {activeRecommendedPlan.missingItems.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 text-xs">
              <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Produse neacoperite în planul selectat ({activeRecommendedPlan.missingItems.length})
              </div>
              <ul className="space-y-1 text-amber-800 dark:text-amber-200">
                {activeRecommendedPlan.missingItems.map(m => (
                  <li key={`plan-missing-${m.item.id}`}>
                    <span className="font-semibold">{m.item.name}</span> — {m.reasonRo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Warnings: Items without valid price, Unconfident matches, Unit conflicts */}
      {(optimization.unconfidentMatches.length > 0 ||
        optimization.unitConflicts.length > 0 ||
        optimization.itemsWithoutAnyValidPrice.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {optimization.itemsWithoutAnyValidPrice.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 text-xs">
              <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Produse fără preț valid ({optimization.itemsWithoutAnyValidPrice.length})
              </div>
              <ul className="space-y-1 text-amber-800 dark:text-amber-200">
                {optimization.itemsWithoutAnyValidPrice.map(m => (
                  <li key={m.item.id}>
                    <span className="font-semibold">{m.item.name}</span> — {m.reasonRo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {optimization.unconfidentMatches.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
              <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-1">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                Produse fără matching sigur ({optimization.unconfidentMatches.length})
              </div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
                {optimization.unconfidentMatches.map(u => (
                  <li key={u.item.id}>
                    <span className="font-semibold">{u.item.name}</span> — {u.reasonRo}
                    {u.candidateProducts && u.candidateProducts.length > 0 && (
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        Candidați posibili: {u.candidateProducts.map(c => c.name).join(', ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {optimization.unitConflicts.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/70 dark:border-rose-800/60 text-xs">
              <div className="font-bold text-rose-900 dark:text-rose-300 flex items-center gap-1.5 mb-1">
                <Layers className="w-3.5 h-3.5" />
                Unități incompatibile ({optimization.unitConflicts.length})
              </div>
              <ul className="space-y-1 text-rose-800 dark:text-rose-200">
                {optimization.unitConflicts.map(c => (
                  <li key={c.item.id}>
                    <span className="font-semibold">{c.item.name}</span> — {c.reasonRo}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Footer: Limitations Accordion & Return Button */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <button
            type="button"
            aria-expanded={showLimitations}
            onClick={() => setShowLimitations(v => !v)}
            className="min-h-[36px] text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Metodologie și limitări ale optimizării ({optimization.limitations.length})</span>
            {showLimitations ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showLimitations && (
            <ul className="mt-2.5 space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc pl-5">
              {optimization.solverMetadata?.noteRo && <li>{optimization.solverMetadata.noteRo}</li>}
              {optimization.limitations.map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
          )}
        </div>

        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Înapoi la lista de cumpărături</span>
          </button>
        )}
      </div>
    </section>
  );
};
