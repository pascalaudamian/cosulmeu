// src/components/ProductPriceTrend.tsx
// Secțiunea „Istoricul prețurilor” pe pagina individuală a produsului (FAZA 3.1)
// Afișează exclusiv observații reale validate (RON), diferențiate pe magazine, fără interpolare între zile lipsă și fără estimări viitoare.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { AlertTriangle, Calendar, ChevronDown, ChevronUp, Info, Store as StoreIcon } from 'lucide-react';
import {
  FlaggedPriceObservation,
  PriceDataQualityStatus,
  PriceHistoryInterval,
  PriceHistoryStoreBreakdown,
  PriceObservation,
  Product,
  Store
} from '../types.js';
import { STORES } from '../data/mockData.js';
import {
  formatPriceSourceLabel,
  isRonCurrency,
  normalizeHistoryStoreKey,
  parseStrictIsoDate,
  PriceHistoryService,
  PriceTimelinePoint
} from '../services/PriceHistoryService.js';
import { PriceQualityClassifier } from '../services/PriceQualityClassifier.js';
import { formatShortRoDate } from '../utils/priceTrendForecast.js';
import { QualityStatusBadge } from './ui/StateFeedback.js';

interface ProductPriceTrendProps {
  productId?: string;
  productName: string;
  product?: Product;
  observations: PriceObservation[];
  flaggedObservations?: FlaggedPriceObservation[];
  stores?: Store[];
}

const INTERVAL_OPTIONS: Array<{ days: PriceHistoryInterval; label: string }> = [
  { days: 30, label: '30 zile' },
  { days: 90, label: '90 zile' },
  { days: 180, label: '180 zile' },
  { days: 365, label: '1 an' }
];

const STORE_SERIES_COLORS = [
  '#059669', // emerald-600
  '#2563eb', // blue-600
  '#d97706', // amber-600
  '#dc2626', // red-600
  '#7c3aed', // violet-600
  '#0891b2', // cyan-600
  '#ea580c', // orange-600
  '#4f46e5'  // indigo-600
];

function formatRonValue(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return 'Indisponibil';
  return `${val.toFixed(2)} lei`;
}

interface StoreSeriesMeta {
  key: string;
  dataKey: string;
  storeId: string;
  storeName: string;
  color: string;
}

interface StorePointDetail {
  storeKey: string;
  storeName: string;
  price: number;
  sources: string[];
  observationsCount: number;
  hasAliasProvenance: boolean;
  color: string;
}

interface MultiStoreChartRow {
  date: string;
  label: string;
  detailsByKey: Record<string, StorePointDetail>;
  [key: string]: unknown;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: MultiStoreChartRow }>;
  seriesList: StoreSeriesMeta[];
  selectedStoreKey: string;
}

const MultiStoreChartTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  seriesList,
  selectedStoreKey
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const visibleSeries =
    selectedStoreKey === 'all'
      ? seriesList
      : seriesList.filter(s => s.key === selectedStoreKey);

  const entries = visibleSeries
    .map(s => row.detailsByKey[s.key])
    .filter((d): d is StorePointDetail => Boolean(d));

  if (entries.length === 0) return null;

  return (
    <div className="bg-slate-900 text-white rounded-xl px-3.5 py-2.5 text-xs shadow-lg border border-slate-700 max-w-xs space-y-1.5">
      <div className="font-bold text-slate-100 flex items-center justify-between gap-4 pb-1 border-b border-slate-700/80">
        <span>{formatShortRoDate(row.date)}</span>
        <span className="font-mono text-[11px] text-slate-400 tabular-nums">{row.date}</span>
      </div>

      <div className="space-y-1.5">
        {entries.map(entry => (
          <div key={entry.storeKey} className="space-y-0.5">
            <div className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span>{entry.storeName}</span>
              </span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {formatRonValue(entry.price)}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 pl-4">
              Sursă: {entry.sources.join(' · ')}
              {entry.observationsCount > 1 ? ` (${entry.observationsCount} obs.)` : ''}
              {entry.hasAliasProvenance ? ' · Variantă asociată' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function renderQualityStatusBadge(status?: PriceDataQualityStatus) {
  if (!status) return null;
  return <QualityStatusBadge status={status} compact />;
}

export const ProductPriceTrend: React.FC<ProductPriceTrendProps> = ({
  productId,
  productName,
  product,
  observations,
  flaggedObservations = [],
  stores = STORES
}) => {
  const [intervalDays, setIntervalDays] = useState<PriceHistoryInterval>(90);
  const [selectedStoreKey, setSelectedStoreKey] = useState<string>('all');
  const [remoteObservations, setRemoteObservations] = useState<PriceObservation[] | null>(null);
  const [remoteFlaggedObservations, setRemoteFlaggedObservations] = useState<FlaggedPriceObservation[] | null>(null);
  const [showFlaggedAudit, setShowFlaggedAudit] = useState<boolean>(false);
  const [isHydratingRemote, setIsHydratingRemote] = useState<boolean>(false);

  // Hidratare opțională din /api/catalog/history/:productId?days=365&limit=5000 în browser
  // (păstrează funcționarea sincronă pe baza prop-ului `observations` în teste / SSR).
  useEffect(() => {
    setRemoteObservations(null);
    setRemoteFlaggedObservations(null);
    setSelectedStoreKey('all');

    if (!productId || typeof window === 'undefined' || typeof fetch !== 'function') {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setIsHydratingRemote(true);

    fetch(`/api/catalog/history/${encodeURIComponent(productId)}?days=365&limit=5000`, {
      signal: controller.signal
    })
      .then(async res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (cancelled || !data?.success) return;
        if (Array.isArray(data.observations)) {
          setRemoteObservations(data.observations as PriceObservation[]);
        }
        if (Array.isArray(data.flaggedObservations)) {
          setRemoteFlaggedObservations(data.flaggedObservations as FlaggedPriceObservation[]);
        }
      })
      .catch(() => {
        // Fallback silențios la observațiile primite prin props
      })
      .finally(() => {
        if (!cancelled) setIsHydratingRemote(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [productId]);

  const effectiveObservations = useMemo(() => {
    const propList = Array.isArray(observations) ? observations : [];
    if (remoteObservations && remoteObservations.length > propList.length) {
      return remoteObservations;
    }
    return propList;
  }, [observations, remoteObservations]);

  const storeLookup = useMemo(() => {
    const map = new Map<string, Store>();
    for (const s of stores) {
      if (s.id) map.set(s.id, s);
      const normId = normalizeHistoryStoreKey(s.id);
      if (normId && !map.has(normId)) map.set(normId, s);
      if (s.slug) {
        const normSlug = normalizeHistoryStoreKey(s.slug);
        if (normSlug && !map.has(normSlug)) map.set(normSlug, s);
      }
    }
    return map;
  }, [stores]);

  const { timelineAll, excludedForeignCurrencyCount, localFlaggedObservations } = useMemo(() => {
    const now = new Date();
    const maxAllowedMs = now.getTime() + 24 * 60 * 60 * 1000;
    let foreignCount = 0;

    const batch = PriceQualityClassifier.classifyObservationBatch(effectiveObservations, {
      product,
      expectedProductId: productId || product?.id,
      now
    });

    const parsedPoints: PriceTimelinePoint[] = [];
    const flagged: FlaggedPriceObservation[] = [];

    for (let i = 0; i < effectiveObservations.length; i++) {
      const obs = effectiveObservations[i];
      if (!obs) continue;
      const obsKey = obs.id || `obs-${i}`;
      const assessment = batch.assessmentsById[obsKey];
      const storeObj =
        storeLookup.get(obs.storeId) || storeLookup.get(normalizeHistoryStoreKey(obs.storeId));
      const storeId = storeObj?.id || normalizeHistoryStoreKey(obs.storeId) || obs.storeId;
      const storeName = storeObj?.name || obs.storeId || 'Magazin';

      if (!isRonCurrency(obs.currency)) {
        foreignCount++;
      }

      const priceNum = Number(obs.price);
      const parsedDate = parseStrictIsoDate(obs.date);

      if (assessment?.status === 'SUSPICIOUS') {
        flagged.push({
          id: obsKey,
          productId: productId || obs.productId,
          originalProductId: obs.originalProductId,
          storeId,
          storeName,
          price: priceNum,
          currency: obs.currency || 'RON',
          date: parsedDate ? parsedDate.isoDate : String(obs.date || ''),
          source: obs.source,
          sourceLabel: formatPriceSourceLabel(obs.source),
          qualityAssessment: assessment
        });
        continue;
      }

      if (!Number.isFinite(priceNum) || priceNum <= 0) continue;
      if (!parsedDate || parsedDate.timestampMs > maxAllowedMs) continue;

      parsedPoints.push({
        id: obsKey,
        date: parsedDate.isoDate,
        price: Math.round(priceNum * 100) / 100,
        storeId,
        storeName,
        source: formatPriceSourceLabel(obs.source),
        sourceType: obs.source,
        originalProductId: obs.originalProductId,
        sourceId: obs.sourceId,
        receiptId: obs.receiptId,
        loyaltyCardUsed: obs.loyaltyCardUsed,
        region: obs.region,
        currency: 'RON',
        qualityStatus: assessment?.status,
        qualityLabelRo: assessment?.labelRo,
        qualityReasons: assessment?.reasons
      });
    }

    parsedPoints.sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      return a.storeName.localeCompare(b.storeName);
    });

    flagged.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return {
      timelineAll: parsedPoints,
      excludedForeignCurrencyCount: foreignCount,
      localFlaggedObservations: flagged
    };
  }, [effectiveObservations, product, productId, storeLookup]);

  const resolvedFlaggedObservations = useMemo(() => {
    const mergedMap = new Map<string, FlaggedPriceObservation>();
    for (const f of [...localFlaggedObservations, ...flaggedObservations, ...(remoteFlaggedObservations || [])]) {
      if (f && f.id && !mergedMap.has(f.id)) {
        mergedMap.set(f.id, f);
      }
    }
    return Array.from(mergedMap.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [localFlaggedObservations, flaggedObservations, remoteFlaggedObservations]);

  const yearStats = useMemo(
    () =>
      PriceHistoryService.computeIntervalStats(timelineAll, 365, new Date(), {
        excludedForeignCurrencyCount
      }),
    [timelineAll, excludedForeignCurrencyCount]
  );

  const activeIntervalStats = useMemo(
    () =>
      PriceHistoryService.computeIntervalStats(timelineAll, intervalDays, new Date(), {
        excludedForeignCurrencyCount
      }),
    [timelineAll, intervalDays, excludedForeignCurrencyCount]
  );

  const intervalPoints = useMemo(
    () => PriceHistoryService.filterPointsByDays(timelineAll, intervalDays),
    [timelineAll, intervalDays]
  );

  // Construiește seria per magazin pentru intervalul activ
  const { storeSeriesList, multiStoreChartRows } = useMemo(() => {
    const storeMetaMap = new Map<string, StoreSeriesMeta>();
    const groupedByDate = new Map<string, Map<string, PriceTimelinePoint[]>>();

    for (const pt of intervalPoints) {
      const sKey = normalizeHistoryStoreKey(pt.storeId) || pt.storeId || 'unknown';
      if (!storeMetaMap.has(sKey)) {
        const color = STORE_SERIES_COLORS[storeMetaMap.size % STORE_SERIES_COLORS.length];
        storeMetaMap.set(sKey, {
          key: sKey,
          dataKey: `store_${sKey}`,
          storeId: pt.storeId,
          storeName: pt.storeName,
          color
        });
      }

      let dateBucket = groupedByDate.get(pt.date);
      if (!dateBucket) {
        dateBucket = new Map<string, PriceTimelinePoint[]>();
        groupedByDate.set(pt.date, dateBucket);
      }
      const arr = dateBucket.get(sKey);
      if (arr) {
        arr.push(pt);
      } else {
        dateBucket.set(sKey, [pt]);
      }
    }

    const sortedDates = Array.from(groupedByDate.keys()).sort((a, b) => a.localeCompare(b));
    const series = Array.from(storeMetaMap.values()).sort((a, b) =>
      a.storeName.localeCompare(b.storeName)
    );

    const rows: MultiStoreChartRow[] = sortedDates.map(date => {
      const dateBucket = groupedByDate.get(date)!;
      const detailsByKey: Record<string, StorePointDetail> = {};
      const row: MultiStoreChartRow = {
        date,
        label: formatShortRoDate(date),
        detailsByKey
      };

      for (const s of series) {
        const pts = dateBucket.get(s.key);
        if (!pts || pts.length === 0) {
          // Explicit null: Recharts cu connectNulls={false} nu trage linii inventate peste zile lipsă
          row[s.dataKey] = null;
          continue;
        }
        const sum = pts.reduce((acc, item) => acc + item.price, 0);
        const dayPrice = Math.round((sum / pts.length) * 100) / 100;
        const uniqueSources = Array.from(new Set(pts.map(p => p.source)));
        const hasAliasProvenance = pts.some(p => Boolean(p.originalProductId));

        row[s.dataKey] = dayPrice;
        detailsByKey[s.key] = {
          storeKey: s.key,
          storeName: s.storeName,
          price: dayPrice,
          sources: uniqueSources,
          observationsCount: pts.length,
          hasAliasProvenance,
          color: s.color
        };
      }

      return row;
    });

    return {
      storeSeriesList: series,
      multiStoreChartRows: rows
    };
  }, [intervalPoints]);

  // Resetăm filtrul de magazin dacă magazinul nu mai există în noul interval selectat
  const activeStoreFilter = useMemo(() => {
    if (selectedStoreKey === 'all') return 'all';
    return storeSeriesList.some(s => s.key === selectedStoreKey) ? selectedStoreKey : 'all';
  }, [selectedStoreKey, storeSeriesList]);

  const visibleSeries = useMemo(
    () =>
      activeStoreFilter === 'all'
        ? storeSeriesList
        : storeSeriesList.filter(s => s.key === activeStoreFilter),
    [storeSeriesList, activeStoreFilter]
  );

  // Pentru graficul cu un singur magazin filtrat, excludem datele unde acel magazin nu are observații?
  // Nu! Păstrăm axa cronologică reală din interval sau filtrăm doar la punctele acelui magazin, păstrând connectNulls={false}
  const visibleChartRows = useMemo(() => {
    if (activeStoreFilter === 'all') return multiStoreChartRows;
    const targetDataKey = `store_${activeStoreFilter}`;
    return multiStoreChartRows.filter(row => row[targetDataKey] !== null && row[targetDataKey] !== undefined);
  }, [multiStoreChartRows, activeStoreFilter]);

  const visibleStatsForFilter = useMemo(() => {
    if (activeStoreFilter === 'all') return activeIntervalStats;
    const filteredPts = intervalPoints.filter(
      pt => (normalizeHistoryStoreKey(pt.storeId) || pt.storeId) === activeStoreFilter
    );
    return PriceHistoryService.computeIntervalStats(filteredPts, intervalDays, new Date(), {
      excludedForeignCurrencyCount
    });
  }, [activeStoreFilter, activeIntervalStats, intervalPoints, intervalDays, excludedForeignCurrencyCount]);

  const sameDayStoreBars = useMemo(() => {
    if (visibleStatsForFilter.observationsCount < 2 || visibleStatsForFilter.distinctDaysCount !== 1) {
      return [];
    }
    return intervalPoints
      .filter(
        pt =>
          activeStoreFilter === 'all' ||
          (normalizeHistoryStoreKey(pt.storeId) || pt.storeId) === activeStoreFilter
      )
      .map((pt, idx) => ({
        key: `${normalizeHistoryStoreKey(pt.storeId)}-${idx}`,
        storeName: pt.storeName,
        price: pt.price,
        date: pt.date,
        source: pt.source
      }))
      .sort((a, b) => a.price - b.price);
  }, [visibleStatsForFilter, intervalPoints, activeStoreFilter]);

  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    for (const row of visibleChartRows) {
      for (const s of visibleSeries) {
        const val = row[s.dataKey];
        if (typeof val === 'number' && Number.isFinite(val)) {
          vals.push(val);
        }
      }
    }
    if (vals.length === 0) return [0, 10];
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const pad = Math.max(0.25, (maxVal - minVal) * 0.18);
    return [
      Math.max(0, Math.floor((minVal - pad) * 10) / 10),
      Math.ceil((maxVal + pad) * 10) / 10
    ];
  }, [visibleChartRows, visibleSeries]);

  const activeIntervalLabel =
    INTERVAL_OPTIONS.find(o => o.days === intervalDays)?.label || `${intervalDays} zile`;

  const storeBreakdown: PriceHistoryStoreBreakdown[] =
    activeIntervalStats.storeBreakdown || [];

  const singleObservation =
    visibleStatsForFilter.observationsCount === 1
      ? intervalPoints.find(
          pt =>
            activeStoreFilter === 'all' ||
            (normalizeHistoryStoreKey(pt.storeId) || pt.storeId) === activeStoreFilter
        ) || null
      : null;

  return (
    <section
      aria-label={`Istoricul prețurilor pentru ${productName}`}
      className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 mb-8"
    >
      {/* Header & Selector Interval strict 30 / 90 / 180 / 365 zile */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800 mb-6">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Istoricul prețurilor
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-1.5 tabular-nums">
            <span>Exclusiv observații reale în RON</span>
            <span aria-hidden="true">·</span>
            <span>{visibleStatsForFilter.observationsCount} observații în {activeIntervalLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{visibleStatsForFilter.distinctDaysCount} zile distincte</span>
            {storeBreakdown.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{storeBreakdown.length} {storeBreakdown.length === 1 ? 'magazin' : 'magazine'}</span>
              </>
            )}
            {isHydratingRemote && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-400">Actualizare istoric...</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Interval istoric prețuri"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl"
          >
            {INTERVAL_OPTIONS.map(opt => {
              const isOneYearLimited = opt.days === 365 && !yearStats.hasSufficientHistory;
              return (
                <button
                  key={opt.days}
                  type="button"
                  aria-pressed={intervalDays === opt.days}
                  onClick={() => setIntervalDays(opt.days)}
                  title={
                    isOneYearLimited
                      ? 'Datele pe 1 an sunt limitate pentru acest produs'
                      : `Afișează istoricul pe ${opt.label}`
                  }
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    intervalDays === opt.days
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Avertisment transparent dacă au fost excluse observații în altă monedă decât RON */}
      {excludedForeignCurrencyCount > 0 && (
        <div className="mb-5 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {excludedForeignCurrencyCount}{' '}
            {excludedForeignCurrencyCount === 1
              ? 'observație în altă monedă decât RON a fost exclusă'
              : 'observații în altă monedă decât RON au fost excluse'}{' '}
            pentru a păstra acuratețea statisticilor și graficului în RON.
          </span>
        </div>
      )}

      {/* 4 Carduri Metrici Reale pentru intervalul activ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 tabular-nums">
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Cel mai mic preț ({activeIntervalLabel})
          </div>
          <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-400 font-mono mt-1">
            {formatRonValue(visibleStatsForFilter.minPrice)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {visibleStatsForFilter.minPriceStoreName
              ? `${visibleStatsForFilter.minPriceStoreName} · ${visibleStatsForFilter.minPriceDate}`
              : 'Fără observații în interval'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Preț mediu ({activeIntervalLabel})
          </div>
          <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-1">
            {formatRonValue(visibleStatsForFilter.avgPrice)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {visibleStatsForFilter.observationsCount > 0
              ? `Din ${visibleStatsForFilter.observationsCount} observații`
              : 'Nicio observație'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Cel mai recent preț observat
          </div>
          <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-1">
            {formatRonValue(visibleStatsForFilter.lastObservation?.price)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {visibleStatsForFilter.lastObservation
              ? `${visibleStatsForFilter.lastObservation.storeName} · ${visibleStatsForFilter.lastObservation.date}`
              : 'Fără dată observată'}
          </div>
          {visibleStatsForFilter.lastObservation?.source && (
            <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
              {visibleStatsForFilter.lastObservation.source}
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Observații în {activeIntervalLabel}
          </div>
          <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-1">
            {visibleStatsForFilter.observationsCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {visibleStatsForFilter.hasSufficientHistory
              ? `${visibleStatsForFilter.distinctDaysCount} zile distincte acoperite`
              : visibleStatsForFilter.observationsCount === 0
              ? 'Fără date istorice'
              : 'Date insuficiente pentru evoluție'}
          </div>
        </div>
      </div>

      {/* Filtru interactiv pe magazine când există cel puțin 2 magazine */}
      {storeSeriesList.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1 inline-flex items-center gap-1">
            <StoreIcon className="w-3.5 h-3.5" />
            <span>Filtru magazin:</span>
          </span>
          <button
            type="button"
            aria-pressed={activeStoreFilter === 'all'}
            onClick={() => setSelectedStoreKey('all')}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              activeStoreFilter === 'all'
                ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            Toate magazinele ({storeSeriesList.length})
          </button>
          {storeSeriesList.map(series => {
            const isSelected = activeStoreFilter === series.key;
            return (
              <button
                key={series.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedStoreKey(isSelected ? 'all' : series.key)}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: series.color }}
                />
                <span>{series.storeName}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Caz 1: Cel puțin 2 zile distincte -> Grafic Recharts multi-magazin fără interpolare */}
      {visibleStatsForFilter.hasSufficientHistory && visibleChartRows.length >= 2 ? (
        <div className="space-y-4">
          <div className="w-full min-w-0">
            <div className="w-full h-60 sm:h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={visibleChartRows}
                  margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148, 163, 184, 0.28)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={54}
                    tickFormatter={(v: number) => `${Number(v).toFixed(2)}`}
                  />
                  <Tooltip
                    content={
                      <MultiStoreChartTooltip
                        seriesList={storeSeriesList}
                        selectedStoreKey={activeStoreFilter}
                      />
                    }
                  />

                  {visibleSeries.map(series => (
                    <Line
                      key={series.key}
                      type="linear"
                      dataKey={series.dataKey}
                      name={series.storeName}
                      stroke={series.color}
                      strokeWidth={2.25}
                      dot={{ r: 4, fill: series.color, stroke: '#ffffff', strokeWidth: 1.5 }}
                      activeDot={{ r: 6, fill: series.color, stroke: '#ffffff', strokeWidth: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              {visibleSeries.map(series => (
                <span key={series.key} className="inline-flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full inline-block"
                    style={{ backgroundColor: series.color }}
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-200">{series.storeName}</span>
                </span>
              ))}
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                · Punctele reprezintă exclusiv observații reale (fără interpolare în zilele lipsă)
              </span>
            </div>
          </div>
        </div>
      ) : sameDayStoreBars.length > 0 ? (
        /* Caz 2: Observații multiple într-o singură zi -> Comparație pe magazine pentru acea zi */
        <div className="space-y-4">
          <div className="w-full h-56 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={sameDayStoreBars}
                margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.28)" vertical={false} />
                <XAxis
                  dataKey="storeName"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tickFormatter={(v: number) => `${Number(v).toFixed(2)}`}
                />
                <Tooltip
                  formatter={(value: unknown) => [formatRonValue(Number(value)), 'Preț observat']}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '0.75rem',
                    color: '#f8fafc',
                    fontSize: '12px'
                  }}
                  itemStyle={{ color: '#34d399', fontWeight: 700 }}
                  labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '2px' }}
                />
                <Bar
                  dataKey="price"
                  name="Preț observat"
                  fill="#059669"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2.5">
            <Calendar className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
            <span>{visibleStatsForFilter.noticeRo}</span>
          </div>
        </div>
      ) : (
        /* Caz 3: 0 observații sau 1 singură observație -> stare onestă, zero puncte inventate */
        <div className="py-8 px-4 text-center bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <Info className="w-7 h-7 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Istoric insuficient pentru intervalul {activeIntervalLabel}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto mt-1 leading-relaxed">
            {visibleStatsForFilter.noticeRo ||
              'Nu există suficiente observații reale în intervalul selectat pentru a afișa evoluția prețului.'}
          </p>
          {singleObservation && (
            <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs tabular-nums">
              <span className="font-semibold text-slate-800 dark:text-slate-100">{singleObservation.date}</span>
              <span className="text-slate-500 dark:text-slate-400">{singleObservation.storeName}</span>
              <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                {formatRonValue(singleObservation.price)}
              </span>
              <span className="text-slate-400 dark:text-slate-500">{singleObservation.source}</span>
            </div>
          )}
        </div>
      )}

      {/* Tabel comparativ per magazin pentru intervalul activ */}
      {storeBreakdown.length > 0 && (
        <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Comparație istorică între magazine ({activeIntervalLabel})
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Ordonat după cel mai mic preț observat în interval
            </span>
          </div>

          {/* Mobile stacked cards (< sm) */}
          <div className="sm:hidden space-y-2.5">
            {storeBreakdown.map(row => {
              const rowKey = normalizeHistoryStoreKey(row.storeId) || row.storeId;
              const seriesMeta = storeSeriesList.find(s => s.key === rowKey);
              const isHighlighted = activeStoreFilter === rowKey;
              return (
                <div
                  key={`mobile-${rowKey}`}
                  className={`p-3.5 rounded-xl border text-xs space-y-2 tabular-nums ${
                    isHighlighted
                      ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700'
                      : 'bg-slate-50/50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: seriesMeta?.color || '#059669' }}
                      />
                      <span>{row.storeName}</span>
                    </div>
                    {renderQualityStatusBadge(row.latestQualityStatus)}
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Minim</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                        {formatRonValue(row.minPrice)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Mediu</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">
                        {formatRonValue(row.avgPrice)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Ultimul</span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono">
                        {formatRonValue(row.lastPrice)}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-1">
                    <span>
                      {row.observationsCount} obs. · {row.distinctDaysCount} {row.distinctDaysCount === 1 ? 'zi' : 'zile'}
                    </span>
                    <span className="truncate max-w-full">{row.sources.join(' · ')}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden sm:block overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Magazin</th>
                  <th className="px-4 py-2.5">Preț minim observat</th>
                  <th className="px-4 py-2.5">Preț mediu</th>
                  <th className="px-4 py-2.5">Ultimul preț observat</th>
                  <th className="px-4 py-2.5">Observații</th>
                  <th className="px-4 py-2.5">Calitate date & surse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {storeBreakdown.map(row => {
                  const rowKey = normalizeHistoryStoreKey(row.storeId) || row.storeId;
                  const seriesMeta = storeSeriesList.find(s => s.key === rowKey);
                  const isHighlighted = activeStoreFilter === rowKey;
                  return (
                    <tr
                      key={rowKey}
                      className={
                        isHighlighted
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/30'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }
                    >
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: seriesMeta?.color || '#059669' }}
                          />
                          <span>{row.storeName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-emerald-700 dark:text-emerald-400 font-mono block">
                          {formatRonValue(row.minPrice)}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          {row.minPriceDate}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-200 font-mono">
                        {formatRonValue(row.avgPrice)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 font-mono block">
                          {formatRonValue(row.lastPrice)}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          {row.lastDate}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                        {row.observationsCount} ({row.distinctDaysCount} {row.distinctDaysCount === 1 ? 'zi' : 'zile'})
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400 space-y-0.5">
                        <div>
                          {renderQualityStatusBadge(row.latestQualityStatus)}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {row.sources.join(' · ')}
                        </div>
                        {row.latestQualityStatus === 'STALE' && (
                          <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                            {row.latestQualityReasonRo || 'Preț mai vechi de 30 de zile — necesită reconfirmare.'}
                          </span>
                        )}
                        {row.hasMixedSources && (
                          <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                            Surse mixte în acest interval
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Observații istorice semnalate (păstrate transparent în audit, excluse din mediile RON) */}
      {resolvedFlaggedObservations.length > 0 && (
        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-rose-800 dark:text-rose-300 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {resolvedFlaggedObservations.length}{' '}
                {resolvedFlaggedObservations.length === 1
                  ? 'observație suspectă sau incompatibilă a fost marcată'
                  : 'observații suspecte sau incompatibile au fost marcate'}{' '}
                și excluse din mediile și graficul RON
              </span>
            </div>
            <button
              type="button"
              aria-expanded={showFlaggedAudit}
              onClick={() => setShowFlaggedAudit(prev => !prev)}
              className="min-h-[36px] inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>{showFlaggedAudit ? 'Ascunde detalii' : 'Vezi motivația'}</span>
              {showFlaggedAudit ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {showFlaggedAudit && (
            <>
              <div className="sm:hidden mt-3 space-y-2">
                {resolvedFlaggedObservations.slice(0, 20).map(item => (
                  <div
                    key={`mobile-flagged-${item.id}`}
                    className="p-3 rounded-xl border border-rose-200/70 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20 text-xs space-y-1 tabular-nums"
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span className="text-slate-900 dark:text-slate-100">{item.storeName}</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {Number.isFinite(item.price) ? `${item.price.toFixed(2)} ${item.currency || 'RON'}` : 'Invalid'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {item.date || 'Dată lipsă'} · <span className="text-rose-700 dark:text-rose-300 font-semibold">{item.qualityAssessment.labelRo}</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      {item.qualityAssessment.reasons[0] || item.qualityAssessment.descriptionRo}
                    </p>
                  </div>
                ))}
              </div>
              <div className="hidden sm:block mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-3.5 py-2">Dată înregistrată</th>
                      <th className="px-3.5 py-2">Magazin</th>
                      <th className="px-3.5 py-2">Valoare</th>
                      <th className="px-3.5 py-2">Stare & motiv</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {resolvedFlaggedObservations.slice(0, 20).map(item => (
                      <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3.5 py-2 font-mono text-slate-700 dark:text-slate-300">
                          {item.date || 'Dată lipsă'}
                        </td>
                        <td className="px-3.5 py-2 font-semibold text-slate-900 dark:text-slate-100">
                          {item.storeName}
                        </td>
                        <td className="px-3.5 py-2 font-mono text-slate-800 dark:text-slate-200">
                          {Number.isFinite(item.price) ? `${item.price.toFixed(2)} ${item.currency || 'RON'}` : 'Invalid'}
                        </td>
                        <td className="px-3.5 py-2 text-rose-700 dark:text-rose-300">
                          <span className="font-semibold block">{item.qualityAssessment.labelRo}</span>
                          <span className="text-[11px] text-slate-600 dark:text-slate-400">
                            {item.qualityAssessment.reasons[0] || item.qualityAssessment.descriptionRo}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Notă de transparență istoric vs disponibilitate curentă */}
      <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
        Notă: Prețurile istorice reflectă exclusiv observații din trecut și nu garantează disponibilitatea actuală la raft sau prețul curent din magazin.
      </p>
    </section>
  );
};
