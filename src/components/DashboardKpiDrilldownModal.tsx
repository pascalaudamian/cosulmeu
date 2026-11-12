import { useEffect, useMemo, useRef } from 'react';
import { Bell, X } from 'lucide-react';
import type { ShoppingList, UserProfile } from '../types.js';
import type { DashboardData } from '../services/DashboardDataService.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';

interface DashboardKpiDrilldownModalProps {
  mode: 'potential-savings' | 'tracked-products';
  activeList: ShoppingList;
  dashboardData: DashboardData;
  useLoyaltyCards: UserProfile['useLoyaltyCards'];
  onClose: () => void;
}

export function DashboardKpiDrilldownModal({
  mode,
  activeList,
  dashboardData,
  useLoyaltyCards,
  onClose
}: DashboardKpiDrilldownModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isSavingsMode = mode === 'potential-savings';
  const savingsDetails = useMemo(() => PriceComparisonService.getPotentialSavingsDetailsForList(
    activeList.items,
    dashboardData.products,
    dashboardData.productOffers,
    dashboardData.stores,
    useLoyaltyCards
  ), [activeList.items, dashboardData, useLoyaltyCards]);
  const trackedDetails = useMemo(() => {
    const productsById = new Map(dashboardData.products.map(product => [product.id, product]));
    const storesById = new Map(dashboardData.stores.map(store => [store.id, store]));
    return dashboardData.trackedProductIds.map(productId => {
      const product = productsById.get(productId);
      const currentOffer = dashboardData.productOffers
        .filter(offer => offer.productId === productId && offer.verificationStatus === 'verified')
        .sort((left, right) => left.price - right.price)[0];
      const activeAlerts = dashboardData.priceAlerts.filter(alert => alert.productId === productId && alert.isActive);
      return {
        productId,
        name: product?.name || 'Produs din catalog indisponibil',
        brand: product?.brand,
        price: currentOffer?.price,
        storeName: currentOffer ? storesById.get(currentOffer.storeId)?.name || currentOffer.storeId : undefined,
        activeAlerts
      };
    });
  }, [dashboardData]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = isSavingsMode ? 'Detalii economiei potențiale' : 'Produse urmărite în cont';
  const subtitle = isSavingsMode
    ? `Oferte verificate din Supabase pentru lista „${activeList.name}”.` 
    : 'Produse și alerte citite din profilul și tabelele Supabase ale contului.';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-kpi-dialog-title"
        aria-describedby="dashboard-kpi-dialog-description"
        className="max-h-[min(85vh,760px)] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h2 id="dashboard-kpi-dialog-title" className="text-lg font-bold text-slate-900">{title}</h2>
            <p id="dashboard-kpi-dialog-description" className="mt-1 text-sm text-slate-600">{subtitle}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Închide detaliile indicatorului"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[calc(min(85vh,760px)-76px)] overflow-y-auto p-4 sm:p-6">
          {isSavingsMode ? (
            activeList.items.length === 0 ? (
              <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">Lista activă nu conține produse.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {savingsDetails.map(detail => (
                  <li key={detail.item.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{detail.item.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {PriceComparisonService.formatQuantity(detail.item.quantity, detail.item.unit)}
                        {detail.product?.brand ? ` · ${detail.product.brand}` : ''}
                      </p>
                      {detail.cheapestPrice === undefined ? (
                        <p className="mt-2 text-xs text-amber-700">Fără ofertă verificată curentă în mai multe magazine.</p>
                      ) : (
                        <p className="mt-2 text-xs text-slate-600">
                          {detail.lowestStoreName}: {PriceComparisonService.formatRon(detail.cheapestPrice)}
                          {' · '}{detail.highestStoreName}: {PriceComparisonService.formatRon(detail.mostExpensivePrice || 0)}
                        </p>
                      )}
                    </div>
                    <div className="text-left sm:text-right">
                      <span className="block text-xs font-medium text-slate-500">Economie estimată</span>
                      <span className="text-sm font-extrabold text-emerald-700">{PriceComparisonService.formatRon(detail.savings)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : trackedDetails.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">Nu ai încă produse urmărite în profilul Supabase.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {trackedDetails.map(item => (
                <li key={item.productId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <Bell className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{item.brand || item.productId}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {item.price === undefined
                          ? 'Fără ofertă verificată curentă.'
                          : `${PriceComparisonService.formatRon(item.price)} la ${item.storeName}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    {item.activeAlerts.length ? item.activeAlerts.map(alert => (
                      <span key={alert.id} className="block text-xs font-semibold text-emerald-700">
                        Alertă sub {PriceComparisonService.formatRon(alert.targetPrice)}
                      </span>
                    )) : <span className="text-xs text-slate-500">Fără alertă activă</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
