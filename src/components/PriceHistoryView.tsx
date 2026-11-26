import React, { useState, useMemo, useEffect } from 'react';
import {
  TrendingDown,
  TrendingUp,
  LineChart,
  Bell,
  BellOff,
  Eye,
  Search,
  Trash2,
  Edit2,
  Check,
  CheckCircle2,
  ListPlus,
  Pause,
  Play,
  Info,
  Clock,
  X
} from 'lucide-react';
import {
  InAppPriceNotification,
  PriceAlert,
  PriceAlertType,
  PriceHistoryInterval,
  PriceHistoryIntervalStats,
  Product,
  ProductOffer,
  ShoppingList,
  Store
} from '../types.js';
import { StorageService } from '../services/StorageService.js';
import {
  PriceHistoryService,
  PriceTimelinePoint,
  ProductPriceStats
} from '../services/PriceHistoryService.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { PriceAlertService } from '../services/PriceAlertService.js';
import { STORES } from '../data/mockData.js';

interface PriceHistoryViewProps {
  alerts: PriceAlert[];
  trackedProductIds: string[];
  onUpdateAlerts: (alerts: PriceAlert[]) => void;
  onUpdateTrackedProductIds: (productIds: string[]) => void;
  onSelectProductForDetails?: (product: Product) => void;
  catalogProducts?: Product[];
  catalogOffers?: ProductOffer[];
  catalogStores?: Store[];
  activeList?: ShoppingList;
  notifications?: InAppPriceNotification[];
  onMarkNotificationRead?: (notificationId: string) => void;
  onMarkAllNotificationsRead?: () => void;
  onCreateAlertsFromList?: (list: ShoppingList) => { createdCount: number; skippedCount: number } | void;
}

const INTERVAL_OPTIONS: Array<{ days: PriceHistoryInterval; label: string }> = [
  { days: 30, label: '30 zile' },
  { days: 90, label: '90 zile' },
  { days: 180, label: '180 zile' },
  { days: 365, label: '1 an' }
];

export const PriceHistoryView: React.FC<PriceHistoryViewProps> = ({
  alerts,
  trackedProductIds,
  onUpdateAlerts,
  onUpdateTrackedProductIds,
  onSelectProductForDetails,
  catalogProducts,
  catalogOffers,
  catalogStores,
  activeList,
  notifications = [],
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onCreateAlertsFromList
}) => {
  const allProducts = useMemo(
    () => (catalogProducts && catalogProducts.length > 0 ? catalogProducts : StorageService.getAllProducts()),
    [catalogProducts]
  );
  const allOffers = useMemo(
    () => (catalogOffers && catalogOffers.length > 0 ? catalogOffers : StorageService.getProductOffers()),
    [catalogOffers]
  );
  const allStores = useMemo(
    () => (catalogStores && catalogStores.length > 0 ? catalogStores : STORES),
    [catalogStores]
  );

  const [selectedProductId, setSelectedProductId] = useState<string>(() => allProducts[0]?.id || 'prod-lapte-1');
  const [timeframeDays, setTimeframeDays] = useState<PriceHistoryInterval>(90);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Alert creation / edit modal state
  const [showAddAlertModal, setShowAddAlertModal] = useState<boolean>(false);
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [alertTypeInput, setAlertTypeInput] = useState<PriceAlertType>('below_target');
  const [alertIntervalInput, setAlertIntervalInput] = useState<PriceHistoryInterval>(90);
  const [targetAlertPrice, setTargetAlertPrice] = useState<number>(6.0);
  const [minDropPercentInput, setMinDropPercentInput] = useState<number>(5);
  const [cooldownHoursInput, setCooldownHoursInput] = useState<number>(24);
  const [expandedHistoryAlertId, setExpandedHistoryAlertId] = useState<string | null>(null);
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);

  // Remote DB history sync
  const [remoteHistory, setRemoteHistory] = useState<{
    productId: string;
    days: PriceHistoryInterval;
    points: PriceTimelinePoint[];
    intervalStats?: PriceHistoryIntervalStats;
    currentLowestPrice?: number;
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  const [trackedList, setTrackedList] = useState<string[]>(trackedProductIds);
  useEffect(() => {
    setTrackedList(trackedProductIds);
  }, [trackedProductIds]);

  const selectedProduct = useMemo(
    () => allProducts.find(p => p.id === selectedProductId) || allProducts[0],
    [allProducts, selectedProductId]
  );

  // Ensure selectedProductId stays valid when catalog loads
  useEffect(() => {
    if (allProducts.length > 0 && !allProducts.some(p => p.id === selectedProductId)) {
      setSelectedProductId(allProducts[0].id);
    }
  }, [allProducts, selectedProductId]);

  // Fetch real history from backend API
  useEffect(() => {
    if (!selectedProduct?.id) return;
    let cancelled = false;
    setHistoryLoading(true);
    fetch(`/api/catalog/history/${encodeURIComponent(selectedProduct.id)}?days=${timeframeDays}`)
      .then(res => (res.ok ? res.json() : null))
      .then(payload => {
        if (cancelled || !payload?.success) return;
        const pts: PriceTimelinePoint[] = Array.isArray(payload.observations)
          ? payload.observations.map((obs: any) => {
              const normStoreKey = String(obs.storeId || '')
                .toLowerCase()
                .replace(/^store-/, '')
                .replace(/-chain$/, '')
                .trim();
              const matchedStore = allStores.find(
                s =>
                  s.id === obs.storeId ||
                  s.id.toLowerCase().replace(/^store-/, '') === normStoreKey ||
                  (s.slug || '').toLowerCase() === normStoreKey
              );
              return {
                date: String(obs.date || '').slice(0, 10),
                price: Number(obs.price) || 0,
                storeId: obs.storeId || '',
                storeName: obs.storeName || matchedStore?.name || obs.storeId || 'Magazin',
                source:
                  obs.source === 'verified'
                    ? 'Bon fiscal confirmat'
                    : obs.source === 'official_feed'
                    ? 'Catalog / feed oficial'
                    : obs.source || 'Observație catalog',
                sourceType: obs.source || 'official_feed'
              };
            })
          : [];
        setRemoteHistory({
          productId: selectedProduct.id,
          days: timeframeDays,
          points: pts,
          intervalStats: payload.intervalStats,
          currentLowestPrice:
            typeof payload.currentLowestPrice === 'number' ? payload.currentLowestPrice : undefined
        });
      })
      .catch(() => {
        if (!cancelled) setRemoteHistory(null);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProduct?.id, timeframeDays, allStores]);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    return allProducts.filter(
      p =>
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.brand.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allProducts, searchQuery]);

  // Compute local baseline stats from real offers & observations
  const localStats: ProductPriceStats | null = useMemo(() => {
    if (!selectedProduct) return null;
    return PriceHistoryService.getProductPriceStats(selectedProduct.id, {
      offers: allOffers,
      stores: allStores
    });
  }, [selectedProduct, allOffers, allStores]);

  const useRemoteForSelection = Boolean(
    remoteHistory &&
      remoteHistory.productId === selectedProduct?.id &&
      remoteHistory.days === timeframeDays &&
      (remoteHistory.points.length > 0 || (localStats?.historyPoints.length ?? 0) === 0)
  );

  const filteredTimeline: PriceTimelinePoint[] = useMemo(() => {
    if (useRemoteForSelection && remoteHistory) {
      return remoteHistory.points;
    }
    if (!localStats) return [];
    return PriceHistoryService.filterPointsByDays(localStats.historyPoints, timeframeDays);
  }, [useRemoteForSelection, remoteHistory, localStats, timeframeDays]);

  const activeIntervalStats: PriceHistoryIntervalStats = useMemo(() => {
    if (useRemoteForSelection && remoteHistory?.intervalStats) {
      return remoteHistory.intervalStats;
    }
    if (localStats) {
      return localStats.intervalStats[timeframeDays];
    }
    return PriceHistoryService.computeIntervalStats(filteredTimeline, timeframeDays);
  }, [useRemoteForSelection, remoteHistory, localStats, timeframeDays, filteredTimeline]);

  const currentLowestPrice =
    useRemoteForSelection && typeof remoteHistory?.currentLowestPrice === 'number' && remoteHistory.currentLowestPrice > 0
      ? remoteHistory.currentLowestPrice
      : localStats?.currentLowestPrice || 0;

  const currentLowestStoreName = localStats?.currentLowestStoreName || '-';

  const handleToggleTracked = (productId: string) => {
    const nextTrackedList = trackedList.includes(productId)
      ? trackedList.filter(id => id !== productId)
      : [...trackedList, productId];
    setTrackedList(nextTrackedList);
    onUpdateTrackedProductIds(nextTrackedList);
  };

  const openNewAlertModal = () => {
    if (!selectedProduct) return;
    setEditingAlertId(null);
    setAlertTypeInput('below_target');
    setAlertIntervalInput(timeframeDays);
    setMinDropPercentInput(5);
    setCooldownHoursInput(24);
    const suggested =
      currentLowestPrice > 0
        ? Math.round(currentLowestPrice * 0.9 * 100) / 100
        : Math.round((selectedProduct.baseReferencePrice || 5) * 0.9 * 100) / 100;
    setTargetAlertPrice(suggested > 0 ? suggested : 5);
    setShowAddAlertModal(true);
  };

  const openEditAlertModal = (alert: PriceAlert) => {
    const t = alert.alertType || 'below_target';
    setEditingAlertId(alert.id);
    setAlertTypeInput(t);
    setAlertIntervalInput(alert.intervalDays || 90);
    setTargetAlertPrice(alert.targetPrice > 0 ? alert.targetPrice : 5);
    setMinDropPercentInput(
      alert.minDropPercent ?? (t === 'product_watch' ? 5 : t === 'any_drop' ? 3 : 5)
    );
    setCooldownHoursInput(alert.cooldownHours ?? PriceAlertService.getDefaultCooldownHours(t));
    setShowAddAlertModal(true);
  };

  const handleSelectAlertType = (nextType: PriceAlertType) => {
    setAlertTypeInput(nextType);
    if (!editingAlertId) {
      if (nextType === 'product_watch') {
        setMinDropPercentInput(5);
        setCooldownHoursInput(72);
      } else if (nextType === 'any_drop') {
        setMinDropPercentInput(3);
        setCooldownHoursInput(24);
      } else {
        setCooldownHoursInput(24);
      }
    }
  };

  const handleSaveAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    const effectiveMinDrop =
      alertTypeInput === 'product_watch' || alertTypeInput === 'any_drop'
        ? Math.max(0.1, Math.min(90, Number(minDropPercentInput) || PriceAlertService.getDefaultMinDropPercent(alertTypeInput)))
        : undefined;
    const effectiveCooldown = Math.max(0, Math.min(720, Math.round(Number(cooldownHoursInput) || 0)));

    if (editingAlertId) {
      const updated = alerts.map(a => {
        if (a.id !== editingAlertId) return a;
        const nextDraft: PriceAlert = {
          ...a,
          alertType: alertTypeInput,
          intervalDays: alertTypeInput === 'interval_low' ? alertIntervalInput : undefined,
          targetPrice:
            alertTypeInput === 'below_target'
              ? targetAlertPrice
              : alertTypeInput === 'product_watch'
                ? 0
                : a.targetPrice || currentLowestPrice || 1,
          minDropPercent: effectiveMinDrop,
          cooldownHours: effectiveCooldown
        };
        const ruleChanged =
          nextDraft.targetPrice !== a.targetPrice ||
          nextDraft.alertType !== (a.alertType || 'below_target') ||
          nextDraft.intervalDays !== a.intervalDays ||
          nextDraft.minDropPercent !== a.minDropPercent;
        return ruleChanged ? PriceAlertService.rearmAlertManually(nextDraft) : nextDraft;
      });
      onUpdateAlerts(updated);
      setShowAddAlertModal(false);
      setEditingAlertId(null);
      return;
    }

    if (alertTypeInput === 'below_target' && targetAlertPrice <= 0) return;

    const alreadyDuplicate = alerts.some(
      a =>
        a.productId === selectedProduct.id &&
        (a.alertType || 'below_target') === alertTypeInput &&
        (alertTypeInput !== 'interval_low' || (a.intervalDays || 90) === alertIntervalInput)
    );
    if (alreadyDuplicate) {
      setBulkFeedback(`Există deja o alertă similară pentru „${selectedProduct.name}”.`);
      setShowAddAlertModal(false);
      window.setTimeout(() => setBulkFeedback(null), 4000);
      return;
    }

    const baselinePrice = currentLowestPrice > 0 ? currentLowestPrice : selectedProduct.baseReferencePrice || 0;
    const newAlert: PriceAlert = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `alert-${Date.now()}`,
      productId: selectedProduct.id,
      productName: `${selectedProduct.name}${selectedProduct.brand ? ` (${selectedProduct.brand})` : ''}`,
      targetPrice:
        alertTypeInput === 'below_target'
          ? targetAlertPrice
          : alertTypeInput === 'product_watch'
            ? 0
            : Math.max(0.01, baselinePrice),
      currentLowestPrice,
      lowestStoreId: localStats?.currentLowestStoreId,
      createdAt: new Date().toISOString().split('T')[0],
      isActive: true,
      alertType: alertTypeInput,
      intervalDays: alertTypeInput === 'interval_low' ? alertIntervalInput : undefined,
      minDropPercent: effectiveMinDrop,
      cooldownHours: effectiveCooldown,
      rearmState: 'armed',
      triggerCycle: 0,
      triggerHistory: [],
      lastEvaluatedPrice: currentLowestPrice > 0 ? currentLowestPrice : undefined
    };

    onUpdateAlerts([newAlert, ...alerts]);
    setShowAddAlertModal(false);
  };

  const handleToggleAlertActive = (alertId: string) => {
    onUpdateAlerts(
      alerts.map(a => {
        if (a.id !== alertId) return a;
        const nextActive = !a.isActive;
        return nextActive
          ? PriceAlertService.rearmAlertManually({ ...a, isActive: true })
          : { ...a, isActive: false };
      })
    );
  };

  const handleDeleteAlert = (alertId: string) => {
    onUpdateAlerts(alerts.filter(a => a.id !== alertId));
  };

  const handleBulkCreateFromActiveList = () => {
    if (!activeList || activeList.items.length === 0) return;
    if (onCreateAlertsFromList) {
      const res = onCreateAlertsFromList(activeList);
      if (res && typeof res === 'object') {
        setBulkFeedback(
          res.createdCount > 0
            ? `Au fost create ${res.createdCount} alerte noi din lista „${activeList.name}”${res.skippedCount > 0 ? ` (${res.skippedCount} deja existente)` : ''}.`
            : `Toate produsele potrivite din „${activeList.name}” au deja alerte active.`
        );
      } else {
        setBulkFeedback(`Alertele din lista „${activeList.name}” au fost procesate.`);
      }
      window.setTimeout(() => setBulkFeedback(null), 4000);
      return;
    }

    const { createdAlerts, skippedExistingCount } = PriceAlertService.createAlertsFromShoppingList(
      activeList,
      alerts,
      allProducts,
      allOffers
    );
    if (createdAlerts.length > 0) {
      onUpdateAlerts([...createdAlerts, ...alerts]);
    }
    setBulkFeedback(
      createdAlerts.length > 0
        ? `Au fost create ${createdAlerts.length} alerte noi din lista „${activeList.name}”${skippedExistingCount > 0 ? ` (${skippedExistingCount} ignorate ca duplicate)` : ''}.`
        : `Nu au fost adăugate alerte noi (${skippedExistingCount} există deja).`
    );
    window.setTimeout(() => setBulkFeedback(null), 4000);
  };

  // Safe SVG chart calculation (only evaluated when filteredTimeline.length >= 2)
  const chartWidth = 600;
  const chartHeight = 220;
  const padding = { top: 25, right: 30, bottom: 35, left: 55 };

  const prices = filteredTimeline.map(p => p.price).filter(p => p > 0);
  const chartMinPrice = prices.length > 0 ? Math.min(...prices) * 0.95 : 0;
  const chartMaxPrice = prices.length > 0 ? Math.max(...prices) * 1.05 : 10;

  const getX = (index: number) => {
    if (filteredTimeline.length <= 1) return chartWidth / 2;
    return (
      padding.left +
      (index / (filteredTimeline.length - 1)) * (chartWidth - padding.left - padding.right)
    );
  };

  const getY = (price: number) => {
    if (chartMaxPrice === chartMinPrice) return chartHeight / 2;
    const ratio = (price - chartMinPrice) / (chartMaxPrice - chartMinPrice);
    return chartHeight - padding.bottom - ratio * (chartHeight - padding.top - padding.bottom);
  };

  const polylinePoints = filteredTimeline
    .map((p, i) => `${getX(i)},${getY(p.price)}`)
    .join(' ');

  const unreadNotificationsCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="space-y-6 pb-16">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
            Istoricul Prețurilor &amp; Alerte
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-0.5">
            Monitorizează evoluția reală a prețurilor pe 30, 90, 180 sau 365 de zile și configurează alerte fără duplicate.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {activeList && activeList.items.length > 0 && (
            <button
              type="button"
              onClick={handleBulkCreateFromActiveList}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ListPlus className="w-4 h-4" />
              <span>Creează alerte din lista activă</span>
            </button>
          )}
          <button
            type="button"
            onClick={openNewAlertModal}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            <span>Setează alertă de preț</span>
          </button>
        </div>
      </div>

      {bulkFeedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{bulkFeedback}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Product Selector List */}
        <div className="lg:col-span-4 surface-card p-4 sm:p-5 flex flex-col max-h-[320px] lg:max-h-none lg:h-[600px]">
          <div className="mb-3">
            <label htmlFor="price-history-search" className="font-bold text-sm text-slate-900 dark:text-slate-50 mb-2 block">
              Alege un produs
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-3 pointer-events-none" />
              <input
                id="price-history-search"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Caută în catalog..."
                className="w-full min-h-[40px] pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto flex-1 pr-1">
            {filteredProducts.map(p => {
              const isSelected = selectedProduct?.id === p.id;
              const isTracked = trackedList.includes(p.id);

              return (
                <div
                  key={p.id}
                  className={`rounded-xl transition-all flex items-center justify-between gap-1 ${
                    isSelected
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-200 font-semibold'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedProductId(p.id)}
                    className="flex-1 min-w-0 p-3 text-left cursor-pointer"
                  >
                    <span className="text-xs sm:text-sm block truncate">{p.name}</span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate font-normal">
                      {p.brand} · {p.category}
                    </span>
                  </button>

                  <div className="flex items-center pr-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleTracked(p.id)}
                      aria-pressed={isTracked}
                      aria-label={isTracked ? `Oprește urmărirea pentru ${p.name}` : `Urmărește ${p.name}`}
                      className={`min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg text-xs cursor-pointer ${
                        isTracked
                          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100/60 dark:bg-emerald-900/50'
                          : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                      title={isTracked ? 'Urmărești acest produs' : 'Urmărește produsul'}
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Interactive Price Chart, Observations & Alerts */}
        <div className="lg:col-span-8 space-y-6">
          {selectedProduct && (
            <div className="surface-card p-5 sm:p-7">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block mb-1">
                    {selectedProduct.category}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-display text-lg sm:text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                      {selectedProduct.name}
                    </h2>
                    {onSelectProductForDetails && (
                      <button
                        type="button"
                        onClick={() => onSelectProductForDetails(selectedProduct)}
                        className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        Vezi detalii produs
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedProduct.brand}</span>
                    <span>· Unitate de referință: 1 {selectedProduct.normalizedUnit}</span>
                    {selectedProduct.barcode && <span>· EAN: {selectedProduct.barcode}</span>}
                  </div>
                </div>

                {/* Strict Timeframe Selector (30 | 90 | 180 | 365 zile) */}
                <div
                  role="group"
                  aria-label="Interval evoluție preț"
                  className="flex flex-wrap items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl self-start sm:self-auto"
                >
                  {INTERVAL_OPTIONS.map(opt => (
                    <button
                      key={opt.days}
                      type="button"
                      aria-pressed={timeframeDays === opt.days}
                      onClick={() => setTimeframeDays(opt.days)}
                      className={`min-h-[34px] px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        timeframeDays === opt.days
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Metrics Row (strictly reflecting interval stats, null-safe) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-5 tabular-nums">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700/70">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium block">
                    Minim ({timeframeDays} zile)
                  </span>
                  <span className="font-display text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                    {activeIntervalStats.minPrice !== null
                      ? PriceComparisonService.formatRon(activeIntervalStats.minPrice)
                      : 'Indisponibil'}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate block">
                    {activeIntervalStats.minPriceStoreName
                      ? `${activeIntervalStats.minPriceStoreName} (${activeIntervalStats.minPriceDate})`
                      : 'fără observații'}
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700/70">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium block">
                    Medie ({timeframeDays} zile)
                  </span>
                  <span className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-50 mt-0.5 block">
                    {activeIntervalStats.avgPrice !== null
                      ? PriceComparisonService.formatRon(activeIntervalStats.avgPrice)
                      : 'Indisponibil'}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                    {activeIntervalStats.observationsCount} observații reale
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700/70">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium block">
                    Maxim ({timeframeDays} zile)
                  </span>
                  <span className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-50 mt-0.5 block">
                    {activeIntervalStats.maxPrice !== null
                      ? PriceComparisonService.formatRon(activeIntervalStats.maxPrice)
                      : 'Indisponibil'}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 block">
                    {activeIntervalStats.distinctDaysCount} zile distincte
                  </span>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700/70">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium block">
                    Ultima observație / ofertă
                  </span>
                  <span className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-50 mt-0.5 block">
                    {activeIntervalStats.lastObservation
                      ? PriceComparisonService.formatRon(activeIntervalStats.lastObservation.price)
                      : currentLowestPrice > 0
                      ? PriceComparisonService.formatRon(currentLowestPrice)
                      : 'Indisponibil'}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate block">
                    {activeIntervalStats.lastObservation
                      ? `${activeIntervalStats.lastObservation.storeName} · ${activeIntervalStats.lastObservation.date}`
                      : currentLowestPrice > 0
                      ? `ofertă activă la ${currentLowestStoreName}`
                      : 'fără date'}
                  </span>
                </div>
              </div>

              {/* Interactive SVG Chart or Honest Empty / Single-Observation State */}
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <LineChart className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Evoluție preț (ultimele {timeframeDays} zile)</span>
                    {historyLoading && <span className="text-slate-400 font-normal">· Se încarcă...</span>}
                  </span>
                  {activeIntervalStats.hasSufficientHistory && localStats && localStats.trendPercentage !== 0 && (
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-md flex items-center gap-1 tabular-nums ${
                        localStats.trendPercentage < 0
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                          : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {localStats.trendPercentage < 0 ? (
                        <TrendingDown className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingUp className="w-3.5 h-3.5" />
                      )}
                      {localStats.trendPercentage > 0 ? `+${localStats.trendPercentage}%` : `${localStats.trendPercentage}%`}
                    </span>
                  )}
                </div>

                {!activeIntervalStats.hasSufficientHistory || filteredTimeline.length < 2 ? (
                  <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-center space-y-2">
                    <Info className="w-6 h-6 text-slate-400 mx-auto" />
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300 max-w-lg mx-auto">
                      {activeIntervalStats.noticeRo ||
                        `Nu există suficiente observații distincte în ultimele ${timeframeDays} zile pentru a trasa un grafic.`}
                    </p>
                    {filteredTimeline.length === 1 && (
                      <div className="inline-flex items-center gap-3 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs tabular-nums">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{filteredTimeline[0].date}</span>
                        <span className="text-slate-500 dark:text-slate-400">{filteredTimeline[0].storeName}</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">
                          {PriceComparisonService.formatRon(filteredTimeline[0].price)}
                        </span>
                        <span className="text-slate-400">({filteredTimeline[0].source})</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="relative overflow-x-auto">
                    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-56 overflow-visible">
                      {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                        const priceVal = chartMinPrice + (chartMaxPrice - chartMinPrice) * (1 - pct);
                        const y = padding.top + pct * (chartHeight - padding.top - padding.bottom);
                        return (
                          <g key={i}>
                            <line
                              x1={padding.left}
                              y1={y}
                              x2={chartWidth - padding.right}
                              y2={y}
                              className="stroke-slate-200 dark:stroke-slate-700/80"
                              strokeDasharray="4 4"
                            />
                            <text
                              x={padding.left - 8}
                              y={y + 3}
                              textAnchor="end"
                              fontSize="10"
                              className="fill-slate-400 dark:fill-slate-400"
                              fontWeight="500"
                            >
                              {priceVal.toFixed(2)}
                            </text>
                          </g>
                        );
                      })}

                      <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      <polygon
                        points={`${getX(0)},${chartHeight - padding.bottom} ${polylinePoints} ${getX(
                          filteredTimeline.length - 1
                        )},${chartHeight - padding.bottom}`}
                        fill="url(#chartGradient)"
                      />

                      <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={polylinePoints}
                      />

                      {filteredTimeline.map((p, i) => {
                        const cx = getX(i);
                        const cy = getY(p.price);
                        return (
                          <g key={i} className="group cursor-pointer">
                            <title>{`${p.date} · ${p.storeName}: ${p.price.toFixed(2)} lei (${p.source})`}</title>
                            <circle
                              cx={cx}
                              cy={cy}
                              r="5"
                              className="fill-white dark:fill-slate-900 stroke-emerald-600 dark:stroke-emerald-400 stroke-2"
                            />
                            <text
                              x={cx}
                              y={chartHeight - 12}
                              textAnchor="middle"
                              fontSize="9"
                              className="fill-slate-500 dark:fill-slate-400"
                            >
                              {p.date.split('-').slice(1).join('/')}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                )}

                {/* Real Observations Mobile Cards (< sm) & Desktop Table (>= sm) */}
                {filteredTimeline.length > 0 && (
                  <>
                    <div className="sm:hidden mt-4 space-y-2">
                      {[...filteredTimeline].reverse().slice(0, 10).map((pt, idx) => (
                        <div
                          key={`mobile-obs-${pt.date}-${pt.storeId}-${idx}`}
                          className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-3 text-xs tabular-nums"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-slate-900 dark:text-slate-100 block truncate">
                              {pt.storeName}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate">
                              {pt.date} · {pt.source}
                            </span>
                          </div>
                          <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono shrink-0">
                            {PriceComparisonService.formatRon(pt.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="hidden sm:block mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="px-3.5 py-2">Dată</th>
                            <th className="px-3.5 py-2">Magazin</th>
                            <th className="px-3.5 py-2">Preț observat</th>
                            <th className="px-3.5 py-2">Sursă</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {[...filteredTimeline].reverse().slice(0, 10).map((pt, idx) => (
                            <tr key={`${pt.date}-${pt.storeId}-${idx}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                              <td className="px-3.5 py-2 tabular-nums text-slate-700 dark:text-slate-300">{pt.date}</td>
                              <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">{pt.storeName}</td>
                              <td className="px-3.5 py-2 font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                                {PriceComparisonService.formatRon(pt.price)}
                              </td>
                              <td className="px-3.5 py-2 text-slate-500 dark:text-slate-400">{pt.source}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* In-App Price Alert Notifications */}
          {notifications.length > 0 && (
            <div className="surface-card p-5 sm:p-7">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="font-bold text-slate-900 dark:text-slate-50 text-base">
                    Notificări în aplicație ({unreadNotificationsCount} necitite)
                  </h3>
                </div>
                {unreadNotificationsCount > 0 && onMarkAllNotificationsRead && (
                  <button
                    type="button"
                    onClick={onMarkAllNotificationsRead}
                    className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    Marchează toate citite
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                {notifications.slice(0, 12).map(notif => (
                  <div
                    key={notif.id}
                    className={`p-3.5 rounded-2xl border flex items-start justify-between gap-3 ${
                      notif.isRead
                        ? 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 opacity-80'
                        : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-950/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {!notif.isRead && <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />}
                        <span className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                          {notif.title}
                        </span>
                        {notif.qualityLabelRo && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                            {notif.qualityLabelRo}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                        {notif.reasonRo || notif.message}
                      </p>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-1 tabular-nums flex-wrap">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(notif.triggeredAt).toLocaleString('ro-RO')} · {notif.storeName}</span>
                        {notif.observedIntervalDays && notif.observedObservationsCount != null && (
                          <span>
                            · {notif.observedObservationsCount} observații ({notif.observedIntervalDays} zile)
                          </span>
                        )}
                      </span>
                    </div>
                    {!notif.isRead && onMarkNotificationRead && (
                      <button
                        type="button"
                        onClick={() => onMarkNotificationRead(notif.id)}
                        aria-label={`Marchează notificarea ${notif.title} ca citită`}
                        className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 shrink-0 cursor-pointer"
                        title="Marchează ca citită"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Price Alerts Management */}
          <div className="surface-card p-5 sm:p-7">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-50 text-base">
                  Alerte de preț configurate ({alerts.filter(a => a.isActive).length} active / {alerts.length} total)
                </h3>
              </div>
              <button
                type="button"
                onClick={openNewAlertModal}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                + Adaugă alertă
              </button>
            </div>

            {alerts.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 py-4 text-center">
                Nu ai nicio alertă configurată. Poți crea alerte pentru preț sub prag, scădere de preț, minim observat (30/90/180/365 zile) sau urmărire produs.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {alerts.map(alert => {
                  const historyEvents = alert.triggerHistory || [];
                  const isHistoryOpen = expandedHistoryAlertId === alert.id;
                  const stateLabel = PriceAlertService.getRearmStateLabel(alert);
                  return (
                    <div
                      key={alert.id}
                      className={`p-3.5 rounded-2xl border flex flex-col gap-2 transition-colors ${
                        alert.isActive
                          ? 'border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/30'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">
                              {alert.productName}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                !alert.isActive
                                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  : alert.rearmState === 'triggered_locked'
                                    ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300'
                                    : 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {stateLabel}
                            </span>
                          </div>
                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 block mt-0.5">
                            {PriceAlertService.getAlertTypeLabel(alert.alertType, alert.intervalDays)}
                          </span>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 tabular-nums">
                            {(alert.alertType || 'below_target') === 'below_target' && (
                              <span>
                                Prag: <strong className="text-slate-900 dark:text-slate-100">{PriceComparisonService.formatRon(alert.targetPrice)}</strong>
                              </span>
                            )}
                            {(alert.alertType === 'any_drop' || alert.alertType === 'product_watch') && (
                              <span>
                                Scădere min: <strong>{alert.minDropPercent ?? PriceAlertService.getDefaultMinDropPercent(alert.alertType)}%</strong>
                              </span>
                            )}
                            <span>
                              Minim curent: {alert.currentLowestPrice > 0 ? PriceComparisonService.formatRon(alert.currentLowestPrice) : 'Indisponibil'}
                            </span>
                            <span>
                              Anti-spam: {alert.cooldownHours ?? PriceAlertService.getDefaultCooldownHours(alert.alertType)}h
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleAlertActive(alert.id)}
                            aria-label={`${alert.isActive ? 'Oprește temporar alerta' : 'Reactivează alerta'} pentru ${alert.productName}`}
                            className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                            title={alert.isActive ? 'Oprește temporar alerta' : 'Reactivează alerta'}
                          >
                            {alert.isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditAlertModal(alert)}
                            aria-label={`Editează alerta pentru ${alert.productName}`}
                            className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer"
                            title="Editează alerta"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAlert(alert.id)}
                            aria-label={`Șterge alerta pentru ${alert.productName}`}
                            className="min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                            title="Șterge alerta"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {(alert.lastTriggerReasonRo || alert.lastSkippedReasonRo) && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                          {alert.lastTriggerReasonRo || alert.lastSkippedReasonRo}
                        </p>
                      )}

                      {historyEvents.length > 0 && (
                        <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
                          <button
                            type="button"
                            aria-expanded={isHistoryOpen}
                            onClick={() => setExpandedHistoryAlertId(isHistoryOpen ? null : alert.id)}
                            className="min-h-[32px] text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                          >
                            {isHistoryOpen
                              ? 'Ascunde istoricul declanșărilor'
                              : `Vezi istoricul declanșărilor (${historyEvents.length})`}
                          </button>
                          {isHistoryOpen && (
                            <ul className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                              {historyEvents.slice(0, 8).map(ev => (
                                <li
                                  key={ev.id}
                                  className="text-[10px] p-2 rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-700/60 tabular-nums"
                                >
                                  <div className="flex items-center justify-between font-semibold text-slate-700 dark:text-slate-200">
                                    <span>{new Date(ev.evaluatedAt).toLocaleString('ro-RO')}</span>
                                    {ev.observedPrice != null && ev.observedPrice > 0 && (
                                      <span>
                                        {PriceComparisonService.formatRon(ev.observedPrice)}
                                        {ev.storeName ? ` · ${ev.storeName}` : ''}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-slate-500 dark:text-slate-400 mt-0.5">{ev.reasonRo}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add / Edit Alert Modal */}
      {showAddAlertModal && selectedProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="price-alert-modal-title"
          className="fixed inset-0 z-50 bg-black/50 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white dark:bg-slate-900 dark:border dark:border-slate-800 rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 id="price-alert-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-50">
                  {editingAlertId ? 'Editează alerta de preț' : 'Setează o alertă de preț'}
                </h3>
                {!editingAlertId && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Pentru: <strong className="text-slate-800 dark:text-slate-200">{selectedProduct.name}</strong>
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Închide fereastra de alertă"
                onClick={() => {
                  setShowAddAlertModal(false);
                  setEditingAlertId(null);
                }}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAlert} className="mt-4 space-y-4">
              <div>
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Tip alertă
                </span>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { type: 'below_target' as PriceAlertType, label: 'Preț sub prag țintă (RON)' },
                    { type: 'any_drop' as PriceAlertType, label: 'Scădere de preț față de ultimul reper verificat' },
                    { type: 'interval_low' as PriceAlertType, label: 'Când atinge minimul observat în interval' },
                    { type: 'product_watch' as PriceAlertType, label: 'Urmărire produs (scăderi relevante fără prag fix)' }
                  ].map(item => (
                    <label
                      key={item.type}
                      className={`flex items-center gap-2.5 p-2.5 min-h-[42px] rounded-xl border text-xs cursor-pointer ${
                        alertTypeInput === item.type
                          ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 font-semibold text-emerald-900 dark:text-emerald-200'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="alertType"
                        checked={alertTypeInput === item.type}
                        onChange={() => handleSelectAlertType(item.type)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {alertTypeInput === 'below_target' && (
                <div>
                  <label htmlFor="alert-target-price" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Preț țintă dorit (lei)
                  </label>
                  <div className="relative">
                    <input
                      id="alert-target-price"
                      type="number"
                      step="0.05"
                      min="0.1"
                      required
                      value={targetAlertPrice}
                      onChange={e => setTargetAlertPrice(parseFloat(e.target.value) || 0)}
                      className="w-full min-h-[42px] px-3 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-emerald-500 tabular-nums"
                    />
                    <span className="absolute right-3 top-3 text-xs text-slate-400 dark:text-slate-500 font-bold">RON</span>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block tabular-nums">
                    Prețul minim actual: {currentLowestPrice > 0 ? PriceComparisonService.formatRon(currentLowestPrice) : 'Indisponibil'}
                  </span>
                </div>
              )}

              {alertTypeInput === 'interval_low' && (
                <div>
                  <label htmlFor="alert-interval-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Interval de referință (exclusiv observații verificate)
                  </label>
                  <select
                    id="alert-interval-select"
                    value={alertIntervalInput}
                    onChange={e => setAlertIntervalInput(Number(e.target.value) as PriceHistoryInterval)}
                    className="w-full min-h-[42px] px-3 py-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-slate-100"
                  >
                    {INTERVAL_OPTIONS.map(opt => (
                      <option key={opt.days} value={opt.days}>
                        Ultimele {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(alertTypeInput === 'any_drop' || alertTypeInput === 'product_watch') && (
                <div>
                  <label htmlFor="alert-min-drop" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Scădere minimă pentru notificare (%)
                  </label>
                  <input
                    id="alert-min-drop"
                    type="number"
                    step="0.5"
                    min="0.1"
                    max="90"
                    value={minDropPercentInput}
                    onChange={e => setMinDropPercentInput(parseFloat(e.target.value) || 0.1)}
                    className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                    {alertTypeInput === 'product_watch'
                      ? 'Urmărește produsul fără prag fix și notifică doar la scăderi relevante verificate.'
                      : 'Se compară exclusiv cu ultimul preț verificat anterior.'}
                  </span>
                </div>
              )}

              <div>
                <label htmlFor="alert-cooldown-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Fereastră anti-spam (cooldown între notificări)
                </label>
                <select
                  id="alert-cooldown-select"
                  value={cooldownHoursInput}
                  onChange={e => setCooldownHoursInput(Number(e.target.value))}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  <option value={24}>24 ore (standard)</option>
                  <option value={48}>48 ore</option>
                  <option value={72}>72 ore (recomandat pentru urmărire)</option>
                  <option value={168}>7 zile (168 ore)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddAlertModal(false);
                    setEditingAlertId(null);
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-medium cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-xs cursor-pointer"
                >
                  {editingAlertId ? 'Actualizează alerta' : 'Salvează alerta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
