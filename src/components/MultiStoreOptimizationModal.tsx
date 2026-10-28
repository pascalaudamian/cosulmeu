import React, { useState } from 'react';
import {
  X,
  Split,
  Store,
  Fuel,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import { ShoppingListItem } from '../types';
import { OptimizationService } from '../services/OptimizationService';
import { PriceComparisonService } from '../services/PriceComparisonService';

interface MultiStoreOptimizationModalProps {
  items: ShoppingListItem[];
  onClose: () => void;
}

export const MultiStoreOptimizationModal: React.FC<MultiStoreOptimizationModalProps> = ({
  items,
  onClose
}) => {
  const [transportCost, setTransportCost] = useState<number>(6.00); // 6 RON default travel cost

  const optimization = OptimizationService.optimizeBasket(items, transportCost);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-7 shadow-2xl my-8 animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Split className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                Optimizare Coș între Magazine
              </h2>
              <p className="text-xs text-slate-500">
                Comparăm varianta unui singur magazin versus împărțirea listei
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Travel Cost Slider / Parameter */}
        <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Fuel className="w-4 h-4 text-amber-600" /> Cost estimat deplasare / magazin suplimentar:
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Combustibil, transport în comun sau timpul tău pentru fiecare magazin în plus
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                value={transportCost}
                onChange={e => setTransportCost(parseFloat(e.target.value) || 0)}
                className="w-28 accent-emerald-600 cursor-pointer"
              />
              <span className="text-sm font-extrabold text-slate-900 min-w-[55px] text-right">
                {PriceComparisonService.formatRon(transportCost)}
              </span>
            </div>
          </div>
        </div>

        {/* Strategies Comparison: 3 strategies */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Strategy 1: Single store winner */}
          <div
            className={`p-4 rounded-2xl border transition-all ${
              !optimization.isSplitRecommended
                ? 'border-emerald-500 bg-emerald-50/30 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Strategia 1: Un singur magazin
              </span>
              {!optimization.isSplitRecommended && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                  Recomandat
                </span>
              )}
            </div>
            <div className="font-bold text-base text-slate-900">
              {optimization.singleStoreWinner?.store.name || 'Magazin optim'}
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-2">
              {PriceComparisonService.formatRon(optimization.singleStoreWinner?.grandTotal || 0)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              O singură oprire, 0 costuri sau timp suplimentar de deplasare.
            </p>
          </div>

          {/* Strategy 2 & 3: Multi-store split with transport deduction */}
          <div
            className={`p-4 rounded-2xl border transition-all ${
              optimization.isSplitRecommended
                ? 'border-emerald-500 bg-emerald-50/30 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Strategia 2: Coș împărțit
              </span>
              {optimization.isSplitRecommended && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                  Recomandat
                </span>
              )}
            </div>
            <div className="font-bold text-base text-slate-900">
              {optimization.multiStorePlan.length} magazine combinate
            </div>
            <div className="text-2xl font-extrabold text-emerald-700 mt-2">
              {PriceComparisonService.formatRon(optimization.multiStoreTotal)}
            </div>
            <div className="text-xs text-slate-600 mt-1 space-y-0.5">
              <div>Reducere brută: <span className="font-bold text-emerald-700">-{PriceComparisonService.formatRon(optimization.grossSavings)}</span></div>
              <div>Cost transport: <span className="text-rose-600">+{PriceComparisonService.formatRon(optimization.transportCost)}</span></div>
              <div className="font-bold text-slate-900 pt-0.5">
                Economie netă: {PriceComparisonService.formatRon(optimization.netSavings)}
              </div>
            </div>
          </div>
        </div>

        {/* Clear Explanation Box */}
        <div className="mt-4 p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200/70 flex items-start gap-3">
          <HelpCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-900 leading-relaxed font-medium">
            {optimization.explanation}
          </p>
        </div>

        {/* Detailed Breakdown per Store in Multi-store plan */}
        {optimization.multiStorePlan.length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">
              Cum să împarți lista de cumpărături:
            </h3>
            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {optimization.multiStorePlan.map(plan => (
                <div
                  key={plan.store.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/40"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-md text-white font-black text-xs flex items-center justify-center ${plan.store.brandColor}`}>
                        {plan.store.name.charAt(0)}
                      </div>
                      <span className="font-bold text-sm text-slate-900">{plan.store.name}</span>
                      <span className="text-xs text-slate-500">({plan.items.length} produse)</span>
                    </div>
                    <span className="font-bold text-sm text-slate-900">
                      Subtotal: {PriceComparisonService.formatRon(plan.subtotal)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {plan.items.map(({ item, calculatedPrice }) => (
                      <div key={item.id} className="flex items-center justify-between text-xs text-slate-700">
                        <span>
                          {item.name} ({PriceComparisonService.formatQuantity(item.quantity, item.unit)})
                        </span>
                        <span className="font-semibold">{PriceComparisonService.formatRon(calculatedPrice)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-all"
          >
            Am înțeles
          </button>
        </div>
      </div>
    </div>
  );
};
