import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  ChevronDown,
  ChevronUp,
  Clock,
  Info,
  Layers,
  ShieldAlert,
  Split,
  Star,
  Store as StoreIcon,
  Tag
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
  compact?: boolean;
}

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
  compact = false
}) => {
  const [maxStores, setMaxStores] = useState<number>(3);
  const [excludedStoreIds, setExcludedStoreIds] = useState<string[]>([]);
  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>(() => {
    const profile = StorageService.getUserProfile();
    return Array.isArray(profile.preferredStores) ? profile.preferredStores : [];
  });
  const [useLoyaltyCards, setUseLoyaltyCards] = useState<boolean>(
    () => StorageService.getUserProfile().useLoyaltyCards ?? true
  );
  const [transportCost, setTransportCost] = useState<number>(initialTransportCost);
  const [showLimitations, setShowLimitations] = useState<boolean>(false);
  const [serverOptimization, setServerOptimization] = useState<BasketOptimizationResult | null>(null);
  const [isServerSyncing, setIsServerSyncing] = useState<boolean>(false);
  const [serverMeta, setServerMeta] = useState<{ batchQueryMode?: string; catalogCacheHit?: boolean } | null>(null);

  // Client-side optimization result cache (strictly scoped by list + items + options + catalog signature)
  const serverResultCacheRef = useRef<Map<string, BasketOptimizationResult>>(new Map());

  const resolvedProducts = useMemo(
    () => (products && products.length > 0 ? products : StorageService.getAllProducts()),
    [products]
  );
  const resolvedOffers = useMemo(
    () => (offers && offers.length > 0 ? offers : StorageService.getProductOffers()),
    [offers]
  );
  const resolvedStores = useMemo(
    () =>
      BasketOptimizerService.canonicalizeStores(
        stores && stores.length > 0 ? stores : STORES
      ),
    [stores]
  );

  const catalogSignature = useMemo(
    () => `${resolvedProducts.length}:${resolvedOffers.length}:${resolvedStores.length}`,
    [resolvedProducts.length, resolvedOffers.length, resolvedStores.length]
  );

  const optimizerOptions: BasketOptimizationOptions = useMemo(
    () => ({
      maxStores,
      excludedStoreIds,
      favoriteStoreIds,
      useLoyaltyCards,
      transportCostPerExtraStore: transportCost
    }),
    [maxStores, excludedStoreIds, favoriteStoreIds, useLoyaltyCards, transportCost]
  );

  const cacheKey = useMemo(
    () => buildBasketCacheKey(activeList, optimizerOptions, catalogSignature),
    [activeList, optimizerOptions, catalogSignature]
  );

  // Instant deterministic client-side computation using real catalog datasets
  const localOptimization = useMemo(
    () =>
      BasketOptimizerService.optimize({
        list: { id: activeList.id, name: activeList.name },
        items: activeList.items,
        options: optimizerOptions,
        products: resolvedProducts,
        offers: resolvedOffers,
        stores: resolvedStores
      }),
    [activeList, optimizerOptions, resolvedProducts, resolvedOffers, resolvedStores]
  );

  // Server synchronization with local cache + automatic invalidation when list or options change
  useEffect(() => {
    if (!activeList.items.length) {
      setServerOptimization(null);
      setServerMeta(null);
      return;
    }

    const cached = serverResultCacheRef.current.get(cacheKey);
    if (cached) {
      setServerOptimization(cached);
      setIsServerSyncing(false);
      return;
    }

    let cancelled = false;
    setIsServerSyncing(true);

    (async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session?.access_token) {
            headers.Authorization = `Bearer ${data.session.access_token}`;
          }
        } catch {
          // Guest/unauthenticated optimization continues cleanly
        }

        const res = await fetch('/api/basket/optimize', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            listId: activeList.id,
            listName: activeList.name,
            items: activeList.items,
            options: optimizerOptions
          })
        });

        if (!res.ok) return;
        const payload = await res.json();
        if (!cancelled && payload?.success && payload.optimization) {
          const optResult = payload.optimization as BasketOptimizationResult;
          // Evict oldest if cache grows beyond 24 permutations
          if (serverResultCacheRef.current.size >= 24) {
            const firstKey = serverResultCacheRef.current.keys().next().value;
            if (firstKey) serverResultCacheRef.current.delete(firstKey);
          }
          serverResultCacheRef.current.set(cacheKey, optResult);
          setServerOptimization(optResult);
          setServerMeta(payload.meta || null);
        }
      } catch {
        // Keep deterministic local catalog calculation silently if offline
      } finally {
        if (!cancelled) setIsServerSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeList, optimizerOptions, cacheKey]);

  const optimization = serverOptimization || localOptimization;

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
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Adaugă cel puțin un produs în lista „{activeList.name}” pentru a calcula planul optim de cumpărături.
        </p>
        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-bold hover:opacity-90 cursor-pointer"
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

  const primaryTotalDisplay = activeRecommendedPlan
    ? PriceComparisonService.formatRon(activeRecommendedPlan.totalWithTransport)
    : singleBest
    ? PriceComparisonService.formatRon(singleBest.totalPrice)
    : 'Indisponibil';

  const primaryStoreHeadline = activeRecommendedPlan
    ? activeRecommendedPlan.stops.map(s => s.store.name).join(' + ')
    : singleBest
    ? singleBest.store.name
    : 'Niciun magazin disponibil';

  const activeSavings =
    activeRecommendedPlan &&
    activeRecommendedPlan.hasValidSavingsBaseline &&
    activeRecommendedPlan.savingsVsBestSingleStore !== null &&
    activeRecommendedPlan.savingsVsBestSingleStore > 0
      ? activeRecommendedPlan.savingsVsBestSingleStore
      : singleBest?.savingsVsWorstStore && singleBest.savingsVsWorstStore > 0
      ? singleBest.savingsVsWorstStore
      : null;

  const activeSavingsContext =
    activeRecommendedPlan &&
    activeRecommendedPlan.hasValidSavingsBaseline &&
    activeRecommendedPlan.savingsVsBestSingleStore !== null &&
    activeRecommendedPlan.savingsVsBestSingleStore > 0
      ? `față de ${activeRecommendedPlan.baselineSingleStore?.store.name || '1 magazin'}`
      : singleBest?.savingsVsWorstStore && singleBest.savingsVsWorstStore > 0
      ? 'față de cel mai scump magazin comparabil'
      : 'Economie comparativă indisponibilă fără acoperire comună';

  const completeSingleStoreRankings = optimization.singleStoreRankings.filter(r => r.isComplete);
  const cheapestCompleteTotal = completeSingleStoreRankings.length > 0 ? completeSingleStoreRankings[0].totalPrice : null;

  return (
    <section
      aria-label="Optimizator coș de cumpărături"
      className="surface-card p-4 sm:p-6 space-y-6"
    >
      {/* Header + Return Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            {onBackToList && (
              <button
                type="button"
                onClick={onBackToList}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Înapoi la lista de cumpărături</span>
              </button>
            )}
            <div className="flex items-center gap-2">
              <Split className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                Optimizare Coș · {activeList.name}
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
            {' · '}Actualizare prețuri: {formatRoDateTime(optimization.lastPriceVerificationAt)}
            {isServerSyncing && ' · Se sincronizează cu catalogul...'}
            {!isServerSyncing && serverMeta?.batchQueryMode === 'targeted_batch' && ' · Interogare batch'}
          </p>
        </div>

        {/* List switcher if available */}
        {lists && lists.length > 1 && onSelectActiveList && (
          <div className="flex items-center gap-2">
            <label htmlFor="optimizer-list-select" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Listă:
            </label>
            <select
              id="optimizer-list-select"
              value={activeList.id}
              onChange={e => onSelectActiveList(e.target.value)}
              className="text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-slate-800 dark:text-slate-100"
            >
              {lists.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.items.length})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Top KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            Total coș optim
          </span>
          <span className="font-display text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mt-1 block">
            {primaryTotalDisplay}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {activeRecommendedPlan
              ? `${activeRecommendedPlan.coveredItemsCount}/${optimization.distinctNormalizedItemsCount} produse acoperite`
              : 'Doar produse cu preț valid'}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            Magazin recomandat
          </span>
          <span className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mt-1 block truncate">
            {primaryStoreHeadline}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {singleBest
              ? `1 magazin unic: ${singleBest.store.name} (${PriceComparisonService.formatRon(singleBest.totalPrice)})`
              : 'Niciun magazin cu acoperire validă'}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
            Economii estimate
          </span>
          <span className="font-display text-xl sm:text-2xl font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums mt-1 block">
            {activeSavings !== null ? PriceComparisonService.formatRon(activeSavings) : '0,00 lei'}
          </span>
          <span className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
            {activeSavingsContext}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">
            Ultima actualizare prețuri
          </span>
          <span className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1.5 block">
            {formatRoDateTime(optimization.lastPriceVerificationAt)}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {optimization.itemsWithoutAnyValidPrice.length > 0 || optimization.unconfidentMatches.length > 0
              ? `${optimization.itemsWithoutAnyValidPrice.length} fără preț · ${optimization.unconfidentMatches.length} incerte`
              : 'Toate produsele verificate'}
          </span>
        </div>
      </div>

      {/* Configurator Row: Max stores selector, Loyalty cards, Store favorites / exclusions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-50/70 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200/70 dark:border-slate-800">
        <div className="lg:col-span-5 space-y-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1.5">
              Selector număr magazine
            </span>
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
              {[
                { val: 1, label: '1 magazin' },
                { val: 2, label: 'Max 2' },
                { val: 3, label: 'Max 3' },
                { val: 8, label: '3+ (nelimitat)' }
              ].map(opt => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setMaxStores(opt.val)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    maxStores === opt.val
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setUseLoyaltyCards(v => !v)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                useLoyaltyCards
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Carduri fidelitate: {useLoyaltyCards ? 'Incluse' : 'Excluse'}</span>
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <label htmlFor="optimizer-transport" className="font-semibold whitespace-nowrap">
                Cost deplasare/oprire:
              </label>
              <input
                id="optimizer-transport"
                type="number"
                min={0}
                max={100}
                step={1}
                value={transportCost}
                onChange={e => setTransportCost(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums text-right"
              />
              <span>lei</span>
            </div>
          </div>
          {transportCost === 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Calcul strict pe prețul produselor (costul de deplasare nu este inventat; îl poți introduce manual).
            </p>
          )}
        </div>

        {/* Store preferences: Favorite & Exclude */}
        <div className="lg:col-span-7">
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
                    className="px-2 py-1 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 flex items-center gap-1 cursor-pointer"
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
                    className="px-1.5 py-1 border-l border-slate-200/70 dark:border-slate-700 hover:bg-rose-100/70 dark:hover:bg-rose-900/50 cursor-pointer"
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

      {/* Strategy Comparison Grid: 1 Magazin vs 2 Magazine vs Max 3 Magazine */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Best Single Store */}
        <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                1. Cel mai ieftin magazin unic
              </span>
              {singleBest && (
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                  {singleBest.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} ({singleBest.completenessPercentage}%)
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
                      {singleBest.missingItems.length} articole fără ofertă în acest magazin
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
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                2. Varianta optimă în 2 magazine
              </span>
              {twoStorePlan && (
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                  {twoStorePlan.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} · {twoStorePlan.storeCount} {twoStorePlan.storeCount === 1 ? 'oprire' : 'opriri'}
                </span>
              )}
            </div>

            {maxStores < 2 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                Selectează „Max 2” sau „Max 3” mai sus pentru a compara împărțirea în două magazine.
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
                    <p className="text-slate-500 dark:text-slate-400">
                      Acoperire extinsă (fără magazin unic comun pentru comparație).
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

        {/* Card 3: Optimal Max-3 (or Unlimited) Store Plan */}
        <div
          className={`p-4 sm:p-5 rounded-2xl border flex flex-col justify-between ${
            maxStores >= 3 && activeRecommendedPlan
              ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/25'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                3. Varianta optimă (max {maxStores > 3 ? optimization.maxStoresApplied : 3} magazine)
              </span>
              {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan) && (
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                  {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} · {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.storeCount}{' '}
                  {(maxStores > 3 ? activeRecommendedPlan : threeStorePlan)!.storeCount === 1 ? 'oprire' : 'opriri'}
                </span>
              )}
            </div>

            {maxStores < 3 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                Selectează „Max 3” sau „3+ (nelimitat)” pentru optimizarea pe maximum 3 magazine.
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
                            : `Egal cu ${plan.baselineSingleStore?.store.name}`}
                        </p>
                      ) : (
                        <p className="text-slate-500 dark:text-slate-400">
                          Acoperire maximă în limita selectată.
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

      {/* All Supermarkets Comparison Table */}
      {optimization.singleStoreRankings.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <StoreIcon className="w-3.5 h-3.5" />
              <span>Comparație supermarketuri ({optimization.singleStoreRankings.length} magazine eligibile)</span>
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Produsele fără ofertă într-un magazin nu sunt incluse ca 0 lei
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px]">Supermarket</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right">Total coș</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right">Acoperire</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right hidden sm:table-cell">Diferență</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right hidden md:table-cell">Actualizat</th>
                  <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {optimization.singleStoreRankings.map((rank, index) => {
                  const isBestComplete = rank.isComplete && index === 0;
                  const diffVsBestComplete =
                    rank.isComplete && cheapestCompleteTotal !== null
                      ? Math.round((rank.totalPrice - cheapestCompleteTotal) * 100) / 100
                      : null;

                  return (
                    <tr
                      key={rank.store.id}
                      className={isBestComplete ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'}
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
                          </div>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums">
                        <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                          {PriceComparisonService.formatRon(rank.totalPrice)}
                        </span>
                        {rank.isEstimative && (
                          <span className="block text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                            *estimativ* ({rank.missingItems.length} lipsă)
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                        {rank.coveredItemsCount}/{optimization.distinctNormalizedItemsCount} ({rank.completenessPercentage}%)
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums hidden sm:table-cell">
                        {diffVsBestComplete !== null ? (
                          diffVsBestComplete === 0 ? (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Referință</span>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-300">
                              +{PriceComparisonService.formatRon(diffVsBestComplete)}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Acoperire parțială</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-500 dark:text-slate-400 hidden md:table-cell">
                        {rank.lastVerifiedAt ? formatRoDateTime(rank.lastVerifiedAt) : '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleFavoriteStore(rank.store.id)}
                            title={rank.isFavorite ? 'Scoate de la favorite' : 'Setează favorit'}
                            className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
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
                            className="p-1 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 cursor-pointer"
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
      )}

      {/* Store Stops Breakdown: Lista produselor pe magazine */}
      {activeRecommendedPlan && activeRecommendedPlan.stops.length > 0 && !compact && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Lista produselor pe magazine ({activeRecommendedPlan.stops.length}{' '}
            {activeRecommendedPlan.stops.length === 1 ? 'magazin' : 'magazine'})
          </h3>
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
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{stop.store.name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">({stop.itemsCount} art.)</span>
                  </div>
                  <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 tabular-nums">
                    {PriceComparisonService.formatRon(stop.subtotal)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {stop.allocations.map(alloc => (
                    <div
                      key={`${stop.store.id}-${alloc.item.id}`}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                          {alloc.product.name}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          {PriceComparisonService.formatQuantity(alloc.aggregatedQuantity, alloc.item.unit)}
                          {alloc.mergedOccurrencesCount > 1 && ` · cumulat (${alloc.mergedOccurrencesCount}×)`}
                          {` · ${alloc.unitPriceDisplay}`}
                          {` · ${alloc.qualityAssessment.labelRo}`}
                        </span>
                      </div>
                      <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums shrink-0">
                        {PriceComparisonService.formatRon(alloc.calculatedPrice)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
            onClick={() => setShowLimitations(v => !v)}
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Metodologie și limitări ale optimizării ({optimization.limitations.length})</span>
            {showLimitations ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showLimitations && (
            <ul className="mt-2.5 space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc pl-5">
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
