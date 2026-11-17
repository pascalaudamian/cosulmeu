import React, { useState } from 'react';
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
  AlertCircle,
  ShoppingBag
} from 'lucide-react';
import { UserProfile, ShoppingList, Receipt as ReceiptType, Product, ProductOffer, Store } from '../types.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { DashboardKpiDrilldownModal } from './DashboardKpiDrilldownModal.js';
import type {
  DashboardData,
  DashboardImportResult,
  LocalDashboardCounts
} from '../services/DashboardDataService.js';

interface DashboardViewProps {
  userProfile: UserProfile;
  activeList: ShoppingList;
  receipts: ReceiptType[];
  trackedCount: number;
  activeAlertCount: number;
  dataSource: 'supabase' | 'local';
  isAuthenticated?: boolean;
  isDemoMode?: boolean;
  catalogProducts?: Product[];
  catalogOffers?: ProductOffer[];
  catalogStores?: Store[];
  dashboardData?: DashboardData;
  dashboardLoading: boolean;
  dashboardError?: string | null;
  localImportCounts: LocalDashboardCounts;
  canImportLocalData: boolean;
  isImportingLocalData: boolean;
  importError?: string | null;
  importResult?: DashboardImportResult | null;
  onImportLocalData: () => void;
  onNavigate: (tab: string) => void;
  onOpenReceipt: (receipt: ReceiptType) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  userProfile,
  activeList,
  receipts,
  trackedCount,
  activeAlertCount,
  dataSource,
  isAuthenticated = dataSource === 'supabase',
  isDemoMode = false,
  catalogProducts,
  catalogOffers,
  catalogStores,
  dashboardData,
  dashboardLoading,
  dashboardError,
  localImportCounts,
  canImportLocalData,
  isImportingLocalData,
  importError,
  importResult,
  onImportLocalData,
  onNavigate,
  onOpenReceipt
}) => {
  const [activeDrilldown, setActiveDrilldown] = useState<'potential-savings' | 'tracked-products' | null>(null);
  const customProducts =
    dataSource === 'supabase'
      ? dashboardData?.products ?? []
      : catalogProducts && catalogProducts.length > 0
        ? catalogProducts
        : undefined;
  const customOffers =
    dataSource === 'supabase'
      ? dashboardData?.productOffers ?? []
      : catalogOffers && catalogOffers.length > 0
        ? catalogOffers
        : undefined;
  const customStores =
    dataSource === 'supabase'
      ? dashboardData?.stores ?? []
      : catalogStores && catalogStores.length > 0
        ? catalogStores
        : undefined;
  const comparisonOptions = { useLoyaltyCards: userProfile.useLoyaltyCards };
  const savingsSummary = PriceComparisonService.getPotentialSavingsForList(
    activeList.items,
    comparisonOptions,
    customProducts,
    customOffers,
    customStores
  );
  const storeComparisons = PriceComparisonService.compareBasketAcrossStores(
    activeList.items,
    comparisonOptions,
    customProducts,
    customOffers,
    customStores
  );
  const statsUnavailable = dashboardLoading || Boolean(dashboardError);

  // Calculate actual total saved from receipts (difference between subtotal and total after discounts)
  const totalSavedFromDiscounts = receipts.reduce((acc, r) => acc + (r.discountTotal || 0), 0);
  const totalHistoricalReceipts = receipts.reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="space-y-6 sm:space-y-8 pb-12">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="min-w-0">
          {!isAuthenticated ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Previzualizare demonstrativă</span>
                <span aria-hidden="true">·</span>
                <span>{userProfile.city}</span>
                <span aria-hidden="true">·</span>
                <span>{isDemoMode ? 'Produse populare · date demo' : 'Date locale pe dispozitiv'}</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 dark:text-slate-50 tracking-tight">
                Bine ai venit la Coșul Meu
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Descoperă produse populare și compară prețurile între magazine, fără să-ți creezi un cont.
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Monitorizare activă</span>
                <span aria-hidden="true">·</span>
                <span>{userProfile.city}</span>
                <span aria-hidden="true">·</span>
                <span>{dataSource === 'supabase' ? 'Sincronizat Supabase' : 'Date locale pe dispozitiv'}</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-950 dark:text-slate-50 tracking-tight">
                {userProfile.name && userProfile.name !== 'Utilizator'
                  ? `Bună, ${userProfile.name.split(' ')[0]}`
                  : 'Coșul tău de cumpărături'}
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                Estimări actualizate de preț și economii calculate pentru lista activă.
              </p>
            </>
          )}
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('products')}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <Eye className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Catalog Produse</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('scan-receipt')}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap border border-transparent dark:border-slate-700"
          >
            <Camera className="w-4 h-4 text-emerald-400" />
            <span>Scanează bon</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('compare')}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            <span>Compară coșul</span>
          </button>
        </div>
      </div>

      {(dashboardLoading || dashboardError) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {dashboardLoading && <span role="status" className="text-slate-500 dark:text-slate-400">Se încarcă datele contului…</span>}
          {dashboardError && <span role="alert" className="text-rose-700 dark:text-rose-400 font-medium">Datele Supabase nu au putut fi încărcate. Reîncarcă pagina pentru a încerca din nou.</span>}
        </div>
      )}

      {(canImportLocalData || importResult || importError) && (
        <section className="rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/80 dark:bg-amber-950/35 p-4 sm:p-5" aria-labelledby="local-import-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="local-import-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {importResult ? 'Importul datelor locale a fost finalizat' : 'Ai date salvate pe acest dispozitiv'}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                {importResult
                  ? `${importResult.receipts} bonuri, ${importResult.lists} liste, ${importResult.listItems} produse din liste, ${importResult.alerts} alerte și ${importResult.trackedProducts} produse urmărite au fost importate.`
                  : `${localImportCounts.receipts} bonuri, ${localImportCounts.lists} liste, ${localImportCounts.listItems} produse din liste, ${localImportCounts.alerts} alerte și ${localImportCounts.trackedProducts} produse urmărite. Nimic nu se încarcă fără confirmarea ta.`}
              </p>
              {!importResult && localImportCounts.receiptsWithImages > 0 && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Imaginile bonurilor rămân pe acest dispozitiv; se importă doar datele extrase.</p>
              )}
              {importResult && importResult.imagesLeftOnDevice > 0 && (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Imaginile bonurilor au rămas pe acest dispozitiv.</p>
              )}
              {importResult && (importResult.skippedAlerts > 0 || importResult.skippedTrackedProducts > 0) && (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  {importResult.skippedAlerts + importResult.skippedTrackedProducts} elemente au fost omise deoarece produsele nu există în catalogul Supabase.
                </p>
              )}
              {importError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-400">{importError}</p>}
            </div>
            {canImportLocalData && !importResult && (
              <button
                type="button"
                onClick={onImportLocalData}
                disabled={isImportingLocalData}
                className="shrink-0 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
              >
                {isImportingLocalData ? 'Se importă…' : 'Importă în contul meu'}
              </button>
            )}
          </div>
        </section>
      )}

      {/* Main Stats Card: Economiile Mele */}
      <section aria-label="Economiile mele" className="bg-slate-950 rounded-2xl border border-slate-800 text-white overflow-hidden">
        <div className="px-5 sm:px-7 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-xs tracking-wide text-slate-200">
              Rezumat financiar și economii
            </span>
          </div>
          <span className="text-xs text-slate-400 hidden sm:inline tabular-nums">
            {activeList.items.length} articole în lista activă
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
          {/* Stat 1 */}
          <button
            type="button"
            onClick={() => onNavigate('receipts')}
            aria-label="Deschide bonurile pentru detalii despre economiile realizate"
            className="p-5 sm:p-6 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400 cursor-pointer"
          >
            <span className="text-xs text-slate-400 block mb-1.5">Economii realizate</span>
            <span className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight tabular-nums block">
              {statsUnavailable ? '—' : PriceComparisonService.formatRon(totalSavedFromDiscounts)}
            </span>
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 mt-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Din bonuri și reduceri · Detalii</span>
            </span>
          </button>

          {/* Stat 2 */}
          <button
            type="button"
            onClick={() => dataSource === 'supabase' && dashboardData
              ? setActiveDrilldown('potential-savings')
              : onNavigate('compare')}
            aria-label={dataSource === 'supabase'
              ? 'Deschide detaliile Supabase ale economiei potențiale și ofertelor verificate'
              : 'Deschide comparația de prețuri pentru coșul de cumpărături'}
            className="p-5 sm:p-6 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400 cursor-pointer"
          >
            <span className="text-xs text-slate-400 block mb-1.5">Economie potențială listă</span>
            <span className="font-display text-2xl sm:text-3xl font-bold text-emerald-400 tracking-tight tabular-nums block">
              {statsUnavailable ? '—' : PriceComparisonService.formatRon(activeList.items.length === 0 ? 0 : savingsSummary.maxSavings)}
            </span>
            <span className="text-xs text-slate-300 font-medium block mt-2">
              Cel mai ieftin magazin · Detalii
            </span>
          </button>

          {/* Stat 3 */}
          <button
            type="button"
            onClick={() => onNavigate('receipts')}
            aria-label="Deschide istoricul bonurilor scanate și totalul cheltuit"
            className="p-5 sm:p-6 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400 cursor-pointer"
          >
            <span className="text-xs text-slate-400 block mb-1.5">Bonuri scanate</span>
            <span className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight tabular-nums block">
              {statsUnavailable ? '—' : receipts.length}
            </span>
            <span className="text-xs text-slate-400 font-medium block mt-2 tabular-nums">
              Cheltuit: {statsUnavailable ? '—' : PriceComparisonService.formatRon(totalHistoricalReceipts)} · Istoric
            </span>
          </button>

          {/* Stat 4 */}
          <button
            type="button"
            onClick={() => dataSource === 'supabase' && dashboardData
              ? setActiveDrilldown('tracked-products')
              : onNavigate('price-history')}
            aria-label={dataSource === 'supabase'
              ? 'Deschide produsele urmărite și alertele de preț din contul Supabase'
              : 'Deschide istoricul produselor urmărite și alertele locale'}
            className="p-5 sm:p-6 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-400 cursor-pointer"
          >
            <span className="text-xs text-slate-400 block mb-1.5">Produse urmărite</span>
            <span className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight tabular-nums block">
              {statsUnavailable ? '—' : trackedCount}
            </span>
            <span className="text-xs text-emerald-400 font-medium block mt-2 tabular-nums">
              {statsUnavailable ? '—' : `${activeAlertCount} alerte active`} · Detalii
            </span>
          </button>
        </div>
      </section>

      {/* Grid: Active Shopping List Summary + Supermarket Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Active Shopping List Preview Card (5 cols on lg) */}
        <div className="lg:col-span-5 surface-card rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-baseline gap-2 min-w-0">
                <h2 className="font-display font-bold text-slate-900 dark:text-slate-100 text-lg truncate">
                  {activeList.name}
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium tabular-nums shrink-0">
                  · {activeList.items.length} {activeList.items.length === 1 ? 'produs' : 'produse'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('shopping-list')}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline shrink-0 cursor-pointer"
              >
                Editează
              </button>
            </div>

            {/* Items list preview */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 my-2">
              {activeList.items.length === 0 ? (
                <div className="py-10 text-center text-slate-500 dark:text-slate-400 text-xs">
                  Lista ta este goală. Adaugă produse din catalog pentru comparație.
                </div>
              ) : (
                activeList.items.slice(0, 4).map(item => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-800 dark:text-slate-200 font-medium truncate">{item.name}</span>
                    <span className="text-slate-500 dark:text-slate-400 text-xs shrink-0 font-medium tabular-nums">
                      {PriceComparisonService.formatQuantity(item.quantity, item.unit)}
                    </span>
                  </div>
                ))
              )}
              {activeList.items.length > 4 && (
                <div className="pt-2.5 text-xs text-slate-500 dark:text-slate-400 text-center font-medium tabular-nums">
                  + încă {activeList.items.length - 4} produse în listă
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Estimare coș optim</span>
              <span className="font-display font-bold text-lg text-emerald-700 dark:text-emerald-400 tabular-nums">
                {PriceComparisonService.formatRon(savingsSummary.cheapestTotal)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('compare')}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Compară prețurile magazinelor</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Supermarkets Price Overview Cards (7 cols on lg) */}
        <div className="lg:col-span-7 surface-card rounded-2xl p-5 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div>
                <h2 className="font-display font-bold text-slate-900 dark:text-slate-100 text-lg">Magazine avantajoase</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Preț total estimat pentru lista curentă ({activeList.items.length} articole)
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('compare')}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
              >
                Toate magazinele <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {storeComparisons.length === 0 ? (
              <div className="py-10 text-center">
                <ShoppingBag className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Nu ai produse în lista activă</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                  Adaugă produse în lista ta de cumpărături pentru a compara automat prețurile și disponibilitatea la supermarketuri.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('products')}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" /> Deschide Catalog Produse
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from(new Map(storeComparisons.map(c => [c.store.id, c])).values()).slice(0, 4).map(comp => (
                  <button
                    type="button"
                    key={comp.store.id}
                    onClick={() => onNavigate('compare')}
                    aria-label={`Deschide comparația completă de prețuri pentru ${comp.store.name}`}
                    className={`w-full p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      comp.isWinner
                        ? 'border-emerald-500/80 bg-emerald-50/40 dark:bg-emerald-950/35 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/60'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/40 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg text-white font-bold text-xs flex items-center justify-center shrink-0 ${comp.store.brandColor}`}
                        >
                          {comp.store.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <span className="font-bold text-sm text-slate-900 dark:text-slate-100 block truncate">{comp.store.name}</span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 block tabular-nums">
                            {comp.availableItems.length}/{activeList.items.length} găsite
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-display font-bold text-base text-slate-950 dark:text-slate-50 block tabular-nums">
                          {PriceComparisonService.formatRon(comp.grandTotal)}
                        </span>
                        {comp.isWinner ? (
                          <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                            Cel mai ieftin
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium tabular-nums">
                            +{PriceComparisonService.formatRon(comp.grandTotal - (storeComparisons[0]?.grandTotal || 0))}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {storeComparisons.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Prețuri validate din oferte active
              </span>
              <span>{userProfile.city}</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent Scanned Receipts & Activity */}
      <div className="surface-card rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800 mb-4">
          <div>
            <h2 className="font-display font-bold text-slate-900 dark:text-slate-100 text-lg">Bonuri fiscale recente</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bonuri salvate și confirmate pentru analiza evoluției prețurilor
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('receipts')}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            Vezi istoricul bonurilor <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {receipts.length === 0 ? (
          <div className="py-8 text-center">
            <Receipt className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Nu ai încă bonuri scanate</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              Fotografiază bonul tău fiscal de la supermarket pentru a extrage automat produsele și a salva istoricul de preț.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('scan-receipt')}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" /> Scanează primul bon
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {receipts.slice(0, 4).map(receipt => (
              <button
                type="button"
                key={receipt.id}
                onClick={() => onOpenReceipt(receipt)}
                aria-label={`Deschide detaliile bonului de la ${receipt.storeName}, ${PriceComparisonService.formatRon(receipt.total)}`}
                className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50/20 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer flex items-center justify-between text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
                    <Receipt className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 block truncate">
                      {receipt.storeName}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 tabular-nums">
                      <Clock className="w-3 h-3 shrink-0" /> {receipt.date} · {receipt.items.length} produse
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="font-display font-bold text-sm text-slate-950 dark:text-slate-50 block tabular-nums">
                    {PriceComparisonService.formatRon(receipt.total)}
                  </span>
                  {receipt.discountTotal > 0 && (
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                      Reducere: -{PriceComparisonService.formatRon(receipt.discountTotal)}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {activeDrilldown && dataSource === 'supabase' && dashboardData && (
        <DashboardKpiDrilldownModal
          mode={activeDrilldown}
          activeList={activeList}
          dashboardData={dashboardData}
          useLoyaltyCards={userProfile.useLoyaltyCards}
          onClose={() => setActiveDrilldown(null)}
        />
      )}
    </div>
  );
};
