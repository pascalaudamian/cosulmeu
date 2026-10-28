import React from 'react';
import {
  Wallet,
  TrendingDown,
  Receipt,
  Eye,
  ArrowRight,
  Sparkles,
  Camera,
  PlusCircle,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { UserProfile, ShoppingList, Receipt as ReceiptType } from '../types';
import { PriceComparisonService } from '../services/PriceComparisonService';
import { STORES } from '../data/mockData';

interface DashboardViewProps {
  userProfile: UserProfile;
  activeList: ShoppingList;
  receipts: ReceiptType[];
  trackedCount: number;
  onNavigate: (tab: string) => void;
  onOpenReceipt: (receipt: ReceiptType) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  userProfile,
  activeList,
  receipts,
  trackedCount,
  onNavigate,
  onOpenReceipt
}) => {
  // Calculate potential savings for active list
  const savingsSummary = PriceComparisonService.getPotentialSavingsForList(activeList.items);
  const storeComparisons = PriceComparisonService.compareBasketAcrossStores(activeList.items);

  // Calculate actual total saved from receipts (difference between subtotal and total after discounts)
  const totalSavedFromDiscounts = receipts.reduce((acc, r) => acc + (r.discountTotal || 0), 0);
  const totalHistoricalReceipts = receipts.reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="space-y-6 sm:space-y-8 pb-12">
      {/* Welcome Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 text-emerald-800 text-xs font-semibold mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Monitorizare prețuri active în {userProfile.city}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Bună, {userProfile.name.split(' ')[0]}! 👋
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Iată estimările de preț și economiile pentru coșul tău de cumpărături.
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onNavigate('scan-receipt')}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-sm transition-all"
          >
            <Camera className="w-4 h-4 text-emerald-400" />
            <span>Scanează bon</span>
          </button>
          <button
            onClick={() => onNavigate('compare')}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-md shadow-emerald-600/20 transition-all"
          >
            <Sparkles className="w-4 h-4 fill-white" />
            <span>Compară coșul</span>
          </button>
        </div>
      </div>

      {/* Main Stats Card: Economiile Mele */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-emerald-950 rounded-3xl p-5 sm:p-7 text-white shadow-xl relative overflow-hidden">
        {/* Subtle decorative background circles */}
        <div className="absolute -right-12 -top-12 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none"></div>
        <div className="absolute right-32 -bottom-20 w-80 h-80 rounded-full bg-teal-500/10 blur-3xl pointer-events-none"></div>

        <div className="relative z-10">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
                <Wallet className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm tracking-wide uppercase text-emerald-400">
                Economiile mele
              </span>
            </div>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-slate-300 border border-white/10">
              Date demonstrative
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mt-5">
            {/* Stat 1 */}
            <div>
              <span className="text-xs text-slate-300 block mb-1">Economii realizate</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {PriceComparisonService.formatRon(totalSavedFromDiscounts + 82.50)}
                </span>
              </div>
              <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
                <CheckCircle2 className="w-3 h-3" /> din bonuri & reduceri
              </span>
            </div>

            {/* Stat 2 */}
            <div>
              <span className="text-xs text-slate-300 block mb-1">Economie potențială listă</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400 tracking-tight">
                  {PriceComparisonService.formatRon(savingsSummary.maxSavings)}
                </span>
              </div>
              <span className="text-[11px] text-slate-300 font-medium block mt-1">
                Alegând cel mai ieftin magazin
              </span>
            </div>

            {/* Stat 3 */}
            <div>
              <span className="text-xs text-slate-300 block mb-1">Bonuri scanate</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {receipts.length}
                </span>
                <span className="text-xs text-slate-400">bonuri</span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium block mt-1">
                Total cheltuit: {PriceComparisonService.formatRon(totalHistoricalReceipts)}
              </span>
            </div>

            {/* Stat 4 */}
            <div>
              <span className="text-xs text-slate-300 block mb-1">Produse urmărite</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {trackedCount}
                </span>
                <span className="text-xs text-slate-400">articole</span>
              </div>
              <span className="text-[11px] text-emerald-400 font-medium block mt-1">
                Alerte active la reduceri
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Active Shopping List Summary + Supermarket Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Active Shopping List Preview Card (5 cols on lg) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-base">
                  {activeList.name}
                </span>
                <span className="bg-slate-100 text-slate-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {activeList.items.length} produse
                </span>
              </div>
              <button
                onClick={() => onNavigate('shopping-list')}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
              >
                Editează
              </button>
            </div>

            {/* Items list preview */}
            <div className="divide-y divide-slate-100 my-3">
              {activeList.items.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  Lista ta este goală. Adaugă câteva produse!
                </div>
              ) : (
                activeList.items.slice(0, 4).map(item => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                      <span className="text-slate-800 font-medium truncate">{item.name}</span>
                    </div>
                    <span className="text-slate-500 text-xs shrink-0 font-medium">
                      {PriceComparisonService.formatQuantity(item.quantity, item.unit)}
                    </span>
                  </div>
                ))
              )}
              {activeList.items.length > 4 && (
                <div className="pt-2 text-xs text-slate-500 text-center font-medium">
                  + încă {activeList.items.length - 4} produse în listă
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Estimare coș optim:</span>
              <span className="font-extrabold text-lg text-emerald-700">
                {PriceComparisonService.formatRon(savingsSummary.cheapestTotal)}
              </span>
            </div>
            <button
              onClick={() => onNavigate('compare')}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all"
            >
              <Sparkles className="w-4 h-4 fill-white" />
              <span>Compară prețurile magazinelor</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        </div>

        {/* Supermarkets Price Overview Cards (7 cols on lg) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <div>
              <h2 className="font-bold text-slate-900 text-base">Magazine avantajoase</h2>
              <p className="text-xs text-slate-500">
                Preț total estimat pentru lista curentă ({activeList.items.length} articole)
              </p>
            </div>
            <button
              onClick={() => onNavigate('compare')}
              className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
            >
              Toate magazinele <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {storeComparisons.slice(0, 4).map(comp => (
              <div
                key={comp.store.id}
                onClick={() => onNavigate('compare')}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer relative hover:shadow-md ${
                  comp.isWinner
                    ? 'border-emerald-500 bg-emerald-50/40'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                }`}
              >
                {comp.isWinner && (
                  <span className="absolute -top-2.5 right-3 bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-xs">
                    Cel mai ieftin
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-lg text-white font-black text-xs flex items-center justify-center ${comp.store.brandColor}`}
                    >
                      {comp.store.name.charAt(0)}
                    </div>
                    <div>
                      <span className="font-bold text-sm text-slate-900">{comp.store.name}</span>
                      <span className="text-[11px] text-slate-500 block">
                        {comp.availableItems.length} din {activeList.items.length} produse găsite
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-extrabold text-base text-slate-900 block">
                      {PriceComparisonService.formatRon(comp.grandTotal)}
                    </span>
                    {comp.isWinner ? (
                      <span className="text-[11px] text-emerald-700 font-bold">
                        Opțiunea #1
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-700 font-medium">
                        + {PriceComparisonService.formatRon(comp.grandTotal - (storeComparisons[0]?.grandTotal || 0))}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Date actualizate azi
            </span>
            <span>Prețurile sunt estimate conform ofertelor din {userProfile.city}</span>
          </div>
        </div>
      </div>

      {/* Recent Scanned Receipts & Activity */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div>
            <h2 className="font-bold text-slate-900 text-base">Bonuri fiscale recente</h2>
            <p className="text-xs text-slate-500">
              Bonuri salvate și confirmate pentru analiza evoluției prețurilor
            </p>
          </div>
          <button
            onClick={() => onNavigate('receipts')}
            className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
          >
            Vezi istoricul bonurilor <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {receipts.length === 0 ? (
          <div className="py-8 text-center">
            <Receipt className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">Nu ai încă bonuri scanate</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Fotografiază bonul tău fiscal de la supermarket pentru a extrage automat produsele și a salva istoricul de preț.
            </p>
            <button
              onClick={() => onNavigate('scan-receipt')}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500"
            >
              <Camera className="w-3.5 h-3.5" /> Scanează primul bon
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {receipts.slice(0, 4).map(receipt => (
              <div
                key={receipt.id}
                onClick={() => onOpenReceipt(receipt)}
                className="p-3.5 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/20 transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                    <Receipt className="w-5 h-5 text-slate-700" />
                  </div>
                  <div>
                    <span className="font-bold text-sm text-slate-900 block">
                      {receipt.storeName}
                    </span>
                    <span className="text-xs text-slate-500 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" /> {receipt.date} • {receipt.items.length} produse
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-extrabold text-sm text-slate-900 block">
                    {PriceComparisonService.formatRon(receipt.total)}
                  </span>
                  {receipt.discountTotal > 0 && (
                    <span className="text-[11px] text-emerald-600 font-bold">
                      Reducere: -{PriceComparisonService.formatRon(receipt.discountTotal)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
