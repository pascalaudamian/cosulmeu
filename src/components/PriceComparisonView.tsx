import React, { useState } from 'react';
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
import { ShoppingList, BasketStoreComparison } from '../types';
import { PriceComparisonService } from '../services/PriceComparisonService';
import { StorageService } from '../services/StorageService';
import { MultiStoreOptimizationModal } from './MultiStoreOptimizationModal';
import { STORES } from '../data/mockData';

interface PriceComparisonViewProps {
  activeList: ShoppingList;
  onNavigateToList: () => void;
  onViewProductDetail?: (productId: string) => void;
}

export const PriceComparisonView: React.FC<PriceComparisonViewProps> = ({
  activeList,
  onNavigateToList,
  onViewProductDetail
}) => {
  const [showOptimizationModal, setShowOptimizationModal] = useState(false);
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'stores' | 'matrix'>('stores');

  const [useLoyaltyCards, setUseLoyaltyCards] = useState<boolean>(() => {
    return StorageService.getUserProfile().useLoyaltyCards ?? true;
  });

  const comparisons = PriceComparisonService.compareBasketAcrossStores(activeList.items, { useLoyaltyCards });

  if (activeList.items.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200/90 p-12 text-center max-w-lg mx-auto my-8 shadow-xs">
        <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Lista ta este goală</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
          Adaugă câteva produse în lista „{activeList.name}” pentru a compara instant prețurile la supermarketuri.
        </p>
        <button
          onClick={onNavigateToList}
          className="mt-6 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-md transition-all"
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
      <div className="bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase tracking-wider mb-3 border border-emerald-400/20">
              <Sparkles className="w-3.5 h-3.5 fill-emerald-300" />
              Comparație Coș Activ • {activeList.name}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {winner ? `${winner.store.name} are cel mai ieftin coș!` : 'Comparație prețuri'}
            </h1>
            <p className="text-emerald-100/80 text-sm mt-1 max-w-xl">
              Calculat pe baza a {activeList.items.length} articole. Prețurile sunt normalizate la unități de măsură echivalente (lei/kg, lei/l, lei/buc).
            </p>
          </div>

          {/* Quick Savings Metric Box */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 sm:p-5 border border-white/10 flex items-center gap-4 shrink-0">
            <div>
              <span className="text-xs text-emerald-200 block">Economie potențială</span>
              <span className="text-2xl sm:text-3xl font-black text-white">
                {PriceComparisonService.formatRon(maxSavings)}
              </span>
              <span className="text-[11px] text-emerald-300/80 block mt-0.5">
                față de cea mai scumpă alternativă
              </span>
            </div>
            <button
              onClick={() => setShowOptimizationModal(true)}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/30 transition-transform active:scale-95"
            >
              <Split className="w-4 h-4" />
              <span>Optimizează coșul</span>
            </button>
          </div>
        </div>
      </div>

      {/* Switch between: Store Ranking View & Product Matrix View + Loyalty Toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-200/70 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('stores')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'stores' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Clasament Magazine
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === 'matrix' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
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
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              useLoyaltyCards
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
            }`}
            title="Activează/Dezactivează prețurile speciale cu carduri de fidelitate (Lidl Plus, Kaufland Card etc.)"
          >
            <Tag className="w-3.5 h-3.5 text-emerald-600" />
            <span>Carduri fidelitate: {useLoyaltyCards ? 'Incluse' : 'Excluse'}</span>
          </button>
        </div>

        <button
          onClick={() => setShowOptimizationModal(true)}
          className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/70 px-3.5 py-1.5 rounded-xl transition-colors"
        >
          <Split className="w-4 h-4 text-emerald-600" />
          <span>Cum împart lista între 2 magazine?</span>
        </button>
      </div>

      {/* View Mode 1: Store Ranking Cards */}
      {viewMode === 'stores' && (
        <div className="space-y-4">
          {comparisons.map((comp, index) => {
            const isExpanded = expandedStoreId === comp.store.id;
            const diffFromWinner = comp.grandTotal - (winner?.grandTotal || 0);

            return (
              <div
                key={comp.store.id}
                className={`bg-white rounded-2xl border transition-all overflow-hidden ${
                  comp.isWinner
                    ? 'border-emerald-500 shadow-md ring-2 ring-emerald-500/10'
                    : 'border-slate-200 hover:border-slate-300 shadow-xs'
                }`}
              >
                {/* Store Main Bar */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Left: Store info & rank */}
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl text-white font-black text-sm flex items-center justify-center shadow-xs shrink-0 ${comp.store.brandColor}`}
                    >
                      #{index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-lg text-slate-900">
                          {comp.store.name}
                        </span>
                        {comp.isWinner && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold uppercase tracking-wider">
                            Câștigător
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1 font-medium text-slate-700">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          {comp.availableItems.length} din {activeList.items.length} produse găsite ({comp.completenessPercentage}%)
                        </span>
                        {comp.missingItems.length > 0 && (
                          <span className="text-amber-700 flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {comp.missingItems.length} estimate
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Cost & Expand button */}
                  <div className="flex items-center justify-between sm:justify-end gap-5">
                    <div className="text-right">
                      <div className="text-xs text-slate-500">Cost estimat coș:</div>
                      <div className="text-xl sm:text-2xl font-black text-slate-900">
                        {PriceComparisonService.formatRon(comp.grandTotal)}
                      </div>
                      {comp.isWinner ? (
                        <span className="text-xs font-bold text-emerald-600 block">
                          Cel mai mic preț total
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-rose-600 block">
                          +{PriceComparisonService.formatRon(diffFromWinner)} față de lider
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => setExpandedStoreId(isExpanded ? null : comp.store.id)}
                      className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                      title={isExpanded ? 'Ascunde produsele' : 'Vezi detalii produse'}
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded Item Breakdown */}
                {isExpanded && (
                  <div className="bg-slate-50/60 border-t border-slate-100 p-4 sm:p-6 animate-in fade-in">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                      Detaliu produse în {comp.store.name}:
                    </h4>

                    {/* Available items */}
                    <div className="space-y-2 mb-4">
                      {comp.availableItems.map(({ item, calculatedPrice, unitPriceString, isLowest, offer }) => (
                        <div
                          key={item.id}
                          className="p-2.5 rounded-xl bg-white border border-slate-200/80 flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isLowest ? (
                              <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">
                                Cel mai mic
                              </span>
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-slate-300 shrink-0"></div>
                            )}
                            <span className="font-semibold text-slate-800 truncate">{item.name}</span>
                            <span className="text-xs text-slate-500 shrink-0">
                              ({PriceComparisonService.formatQuantity(item.quantity, item.unit)})
                            </span>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-bold text-slate-900">
                              {PriceComparisonService.formatRon(calculatedPrice)}
                            </span>
                            <span className="text-[11px] text-slate-400 block">{unitPriceString}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Missing items clearly stated */}
                    {comp.missingItems.length > 0 && (
                      <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/60 text-xs text-amber-900">
                        <span className="font-bold block mb-1">
                          Produse fără ofertă specifică în {comp.store.name} ({comp.missingItems.length}):
                        </span>
                        <div className="space-y-1 text-amber-800">
                          {comp.missingItems.map(item => (
                            <div key={item.id} className="flex items-center justify-between">
                              <span>• {item.name} ({item.quantity} {item.unit})</span>
                              <span>Estimat la referință: ~{PriceComparisonService.formatRon((item.estimatedPrice || 10) * item.quantity)}</span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-amber-700 italic">
                          * Nu am exclus aceste produse din total pentru a nu favoriza nerealist magazinele cu stoc incomplet.
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <th className="p-3.5 pl-4">Produs căutat</th>
                <th className="p-3.5 text-center">Cantitate</th>
                {STORES.slice(0, 5).map(st => (
                  <th key={st.id} className="p-3.5 text-right font-bold text-slate-800">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${st.brandColor}`}></span>
                      <span>{st.name}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeList.items.map(item => (
                <tr key={item.id} className="hover:bg-slate-50/50">
                  <td className="p-3.5 pl-4 font-semibold text-slate-800">
                    <div>{item.name}</div>
                    {item.brand && <span className="text-[11px] text-slate-400 font-normal">{item.brand}</span>}
                  </td>
                  <td className="p-3.5 text-center text-xs text-slate-500">
                    {PriceComparisonService.formatQuantity(item.quantity, item.unit)}
                  </td>
                  {STORES.slice(0, 5).map(store => {
                    const comp = comparisons.find(c => c.store.id === store.id);
                    const itemDetail = comp?.availableItems.find(ai => ai.item.id === item.id);

                    if (!itemDetail) {
                      return (
                        <td key={store.id} className="p-3.5 text-right text-xs text-slate-400 italic">
                          lipsă stoc
                        </td>
                      );
                    }

                    return (
                      <td
                        key={store.id}
                        className={`p-3.5 text-right ${
                          itemDetail.isLowest ? 'bg-emerald-50/60 font-black text-emerald-700' : 'text-slate-800 font-medium'
                        }`}
                      >
                        {PriceComparisonService.formatRon(itemDetail.calculatedPrice)}
                        {itemDetail.isLowest && (
                          <span className="block text-[10px] text-emerald-600 font-bold">
                            minim
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
        />
      )}
    </div>
  );
};
