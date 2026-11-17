import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Split,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Info,
  Store,
  Tag,
  ArrowRight,
  TrendingDown
} from 'lucide-react';
import { ShoppingList, BasketStoreComparison, Product, ProductOffer, Store as StoreType } from '../types.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { StorageService } from '../services/StorageService.js';
import { MultiStoreOptimizationModal } from './MultiStoreOptimizationModal.js';
import { STORES } from '../data/mockData.js';

interface PriceComparisonViewProps {
  activeList: ShoppingList;
  onNavigateToList: () => void;
  onViewProductDetail?: (productId: string) => void;
  catalogProducts?: Product[];
  catalogOffers?: ProductOffer[];
  catalogStores?: StoreType[];
}

const normalizeStoreKey = (value: string): string =>
  (value || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();

const canonicalizeStores = (rawStores: StoreType[]): StoreType[] => {
  const byKey = new Map<string, StoreType>();
  for (const store of rawStores) {
    if (!store?.id || store.id === 'validation-only-retailer' || store.slug === 'validation-only-retailer') {
      continue;
    }
    const key = normalizeStoreKey(store.slug || store.id);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, store);
    } else if (existing.id !== key && store.id === key) {
      byKey.set(key, store);
    }
  }
  return Array.from(byKey.values());
};

export const PriceComparisonView: React.FC<PriceComparisonViewProps> = ({
  activeList,
  onNavigateToList,
  onViewProductDetail,
  catalogProducts,
  catalogOffers,
  catalogStores
}) => {
  const [showOptimizationModal, setShowOptimizationModal] = useState(false);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'stores' | 'matrix'>('stores');
  const [fetchedProducts, setFetchedProducts] = useState<Product[] | null>(null);
  const [fetchedOffers, setFetchedOffers] = useState<ProductOffer[] | null>(null);
  const [fetchedStores, setFetchedStores] = useState<StoreType[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(false);

  const [useLoyaltyCards, setUseLoyaltyCards] = useState<boolean>(() => {
    return StorageService.getUserProfile().useLoyaltyCards ?? true;
  });

  const hasProvidedCatalog = Boolean(
    catalogProducts && catalogProducts.length > 0 && catalogOffers && catalogOffers.length > 0
  );

  useEffect(() => {
    if (hasProvidedCatalog || activeList.items.length === 0) return;
    let cancelled = false;
    setCatalogLoading(true);
    Promise.all([
      fetch('/api/catalog/products').then(r => r.json()).catch(() => null),
      fetch('/api/catalog/offers').then(r => r.json()).catch(() => null),
      fetch('/api/stores').then(r => r.json()).catch(() => null)
    ])
      .then(([prodRes, offRes, storeRes]) => {
        if (cancelled) return;
        if (prodRes?.success && Array.isArray(prodRes.products)) setFetchedProducts(prodRes.products);
        if (offRes?.success && Array.isArray(offRes.offers)) setFetchedOffers(offRes.offers);
        if (storeRes?.success && Array.isArray(storeRes.stores)) setFetchedStores(storeRes.stores);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasProvidedCatalog, activeList.items.length]);

  const products = useMemo(() => {
    if (catalogProducts && catalogProducts.length > 0) return catalogProducts;
    if (fetchedProducts && fetchedProducts.length > 0) return fetchedProducts;
    return StorageService.getAllProducts();
  }, [catalogProducts, fetchedProducts]);

  const offers = useMemo(() => {
    if (catalogOffers && catalogOffers.length > 0) return catalogOffers;
    if (fetchedOffers && fetchedOffers.length > 0) return fetchedOffers;
    return StorageService.getProductOffers();
  }, [catalogOffers, fetchedOffers]);

  const stores = useMemo(() => {
    const raw = (catalogStores && catalogStores.length > 0)
      ? catalogStores
      : (fetchedStores && fetchedStores.length > 0 ? fetchedStores : STORES);
    return canonicalizeStores(raw);
  }, [catalogStores, fetchedStores]);

  const comparisons = useMemo(
    () => PriceComparisonService.compareBasketAcrossStores(
      activeList.items,
      { useLoyaltyCards },
      products,
      offers,
      stores
    ),
    [activeList.items, useLoyaltyCards, products, offers, stores]
  );

  const matrixStores = useMemo(() => {
    const withOffers = comparisons.filter(c => c.availableItems.length > 0);
    const selected = (withOffers.length > 0 ? withOffers : comparisons).slice(0, 6);
    return selected.map(c => c.store);
  }, [comparisons]);

  if (activeList.items.length === 0) {
    return (
      <div className="surface-card p-12 text-center max-w-lg mx-auto my-8">
        <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-7 h-7" />
        </div>
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">Lista ta este goală</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
          Adaugă câteva produse în lista „{activeList.name}” pentru a compara instant prețurile la supermarketuri.
        </p>
        <button
          onClick={onNavigateToList}
          className="mt-6 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors cursor-pointer"
        >
          Mergi la lista de cumpărături
        </button>
      </div>
    );
  }

  const winner = comparisons[0];
  const mostExpensive = comparisons[comparisons.length - 1];
  const maxSavings = winner && mostExpensive ? Math.max(0, mostExpensive.grandTotal - winner.grandTotal) : 0;

  return (
    <div className="space-y-6 pb-16">
      {/* Header Banner: Winner & Max Savings */}
      <section className="bg-slate-950 text-white rounded-2xl border border-slate-800 p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">
              Comparație Coș Activ · {activeList.name}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight mt-2 text-white">
              {catalogLoading
                ? 'Se încarcă prețurile actualizate...'
                : winner
                ? `${winner.store.name} oferă cel mai mic total`
                : 'Comparație prețuri pe magazine'}
            </h1>
            <p className="text-slate-400 text-sm mt-1.5 max-w-xl leading-relaxed">
              Calculat pe <span className="tabular-nums text-slate-200 font-semibold">{activeList.items.length}</span> articole, cu prețuri normalizate la unități echivalente (lei/kg, lei/l, lei/buc).
            </p>
          </div>

          {/* Quick Savings Metric Ledger */}
          <div className="bg-slate-900/90 rounded-xl p-4 sm:p-5 border border-white/10 flex items-center gap-5 shrink-0">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                Economie potențială
              </span>
              <span className="font-display text-2xl sm:text-3xl font-bold text-emerald-400 tabular-nums mt-0.5 block">
                {PriceComparisonService.formatRon(maxSavings)}
              </span>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                față de cel mai scump coș
              </span>
            </div>
            <button
              onClick={() => setShowOptimizationModal(true)}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Split className="w-4 h-4" />
              <span>Optimizează coșul</span>
            </button>
          </div>
        </div>
      </section>

      {/* Switch between: Store Ranking View & Product Matrix View + Loyalty Toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-200/70 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('stores')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'stores'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Clasament Magazine
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'matrix'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Tabel Comparativ pe Produse
            </button>
          </div>

          {/* Loyalty card filter toggle */}
          <button
            onClick={() => {
              const updated = !useLoyaltyCards;
              setUseLoyaltyCards(updated);
              StorageService.saveUserProfile({ ...StorageService.getUserProfile(), useLoyaltyCards: updated });
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
              useLoyaltyCards
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
            title="Activează/Dezactivează prețurile speciale cu carduri de fidelitate (Lidl Plus, Kaufland Card etc.)"
          >
            <Tag className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Carduri fidelitate: {useLoyaltyCards ? 'Incluse' : 'Excluse'}</span>
          </button>
        </div>

        <button
          onClick={() => setShowOptimizationModal(true)}
          className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200/70 dark:border-emerald-800/70 px-3.5 py-1.5 rounded-xl transition-colors cursor-pointer"
        >
          <Split className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Cum împart lista între 2 magazine?</span>
        </button>
      </div>

      {/* View Mode 1: Store Ranking Cards */}
      {viewMode === 'stores' && (
        <div className="space-y-3.5">
          {comparisons.map((comp, index) => {
            const isExpanded = expandedStoreId === comp.store.id;
            const diffFromWinner = comp.grandTotal - (winner?.grandTotal || 0);

            return (
              <div
                key={comp.store.id}
                className={`surface-card transition-colors overflow-hidden ${
                  comp.isWinner
                    ? 'border-emerald-500 ring-1 ring-emerald-500/20'
                    : 'hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                {/* Store Main Bar */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Left: Store info & rank */}
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl text-white font-bold text-sm tabular-nums flex items-center justify-center shrink-0 ${comp.store.brandColor}`}
                    >
                      #{index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
                          {comp.store.name}
                        </span>
                        {comp.isWinner && (
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                            · Cel mai avantajos
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          {comp.availableItems.length}/{activeList.items.length} găsite ({comp.completenessPercentage}%)
                        </span>
                        {comp.missingItems.length > 0 && (
                          <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {comp.missingItems.length} estimate
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Cost & Expand button */}
                  <div className="flex items-center justify-between sm:justify-end gap-5">
                    <div className="text-right tabular-nums">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Cost estimat coș</div>
                      <div className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                        {PriceComparisonService.formatRon(comp.grandTotal)}
                      </div>
                      {comp.isWinner ? (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 block">
                          Cel mai mic preț total
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-rose-600 dark:text-rose-400 block">
                          +{PriceComparisonService.formatRon(diffFromWinner)} față de lider
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => setExpandedStoreId(isExpanded ? null : comp.store.id)}
                      className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title={isExpanded ? 'Ascunde produsele' : 'Vezi detalii produse'}
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Item Breakdown */}
                {isExpanded && (
                  <div className="bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 p-4 sm:p-5">
                    <h4 className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
                      Detaliu produse în {comp.store.name}
                    </h4>

                    {/* Available items */}
                    <div className="space-y-2 mb-4">
                      {comp.availableItems.map(({ item, calculatedPrice, unitPriceString, isLowest }) => (
                        <div
                          key={item.id}
                          className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between text-sm gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {item.productId && onViewProductDetail ? (
                              <button
                                type="button"
                                onClick={() => onViewProductDetail(item.productId!)}
                                className="font-semibold text-slate-800 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline truncate text-left cursor-pointer"
                              >
                                {item.name}
                              </button>
                            ) : (
                              <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">{item.name}</span>
                            )}
                            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                              · {PriceComparisonService.formatQuantity(item.quantity, item.unit)}
                            </span>
                            {isLowest && (
                              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                                · Minim
                              </span>
                            )}
                          </div>

                          <div className="text-right shrink-0 tabular-nums">
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {PriceComparisonService.formatRon(calculatedPrice)}
                            </span>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 block">{unitPriceString}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Missing items clearly stated */}
                    {comp.missingItems.length > 0 && (
                      <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200">
                        <span className="font-bold block mb-1.5">
                          Produse fără ofertă specifică în {comp.store.name} ({comp.missingItems.length}):
                        </span>
                        <div className="space-y-1 text-amber-800 dark:text-amber-300 tabular-nums">
                          {comp.missingItems.map(item => (
                            <div key={item.id} className="flex items-center justify-between gap-2">
                              <span>{item.name} ({item.quantity} {item.unit})</span>
                              <span className="font-medium">~{PriceComparisonService.formatRon((item.estimatedPrice || item.referencePrice || 10) * item.quantity)}</span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                          Estimate la prețul de referință pentru o comparație corectă între magazine.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* View Mode 2: Full Product Comparison Matrix Table */}
      {viewMode === 'matrix' && (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="p-3.5 pl-4">Produs căutat</th>
                <th className="p-3.5 text-center">Cantitate</th>
                {matrixStores.map(st => (
                  <th key={st.id} className="p-3.5 text-right font-bold text-slate-800 dark:text-slate-100">
                    {st.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {activeList.items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="p-3.5 pl-4 font-semibold text-slate-800 dark:text-slate-100">
                    {item.productId && onViewProductDetail ? (
                      <button
                        type="button"
                        onClick={() => onViewProductDetail(item.productId!)}
                        className="text-left hover:text-emerald-700 dark:hover:text-emerald-400 hover:underline transition-colors cursor-pointer"
                      >
                        {item.name}
                      </button>
                    ) : (
                      <div>{item.name}</div>
                    )}
                    {item.brand && <span className="block text-[11px] text-slate-400 dark:text-slate-500 font-normal">{item.brand}</span>}
                  </td>
                  <td className="p-3.5 text-center text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {PriceComparisonService.formatQuantity(item.quantity, item.unit)}
                  </td>
                  {matrixStores.map(store => {
                    const comp = comparisons.find(c => c.store.id === store.id);
                    const itemDetail = comp?.availableItems.find(ai => ai.item.id === item.id);

                    if (!itemDetail) {
                      return (
                        <td key={store.id} className="p-3.5 text-right text-xs text-slate-400 dark:text-slate-500">
                          —
                        </td>
                      );
                    }

                    return (
                      <td
                        key={store.id}
                        className={`p-3.5 text-right tabular-nums ${
                          itemDetail.isLowest ? 'bg-emerald-50/60 dark:bg-emerald-950/40 font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200 font-medium'
                        }`}
                      >
                        {PriceComparisonService.formatRon(itemDetail.calculatedPrice)}
                        {itemDetail.isLowest && (
                          <span className="block text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider">
                            Minim
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Multi-store Modal */}
      {showOptimizationModal && (
        <MultiStoreOptimizationModal
          items={activeList.items}
          onClose={() => setShowOptimizationModal(false)}
          products={products}
          offers={offers}
          stores={stores}
        />
      )}
    </div>
  );
};
