// src/components/ProductPriceTrend.tsx
// Secțiunea „Istoricul prețurilor” pe pagina individuală a produsului (Recharts + 30/90/180/365 zile)
// Afișează exclusiv observații reale validate, fără valori sintetice sau inventate.

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from 'recharts';
import { TrendingDown, TrendingUp, Minus, Info, Calendar } from 'lucide-react';
import {
  PriceHistoryInterval,
  PriceObservation,
  Store
} from '../types.js';
import { STORES } from '../data/mockData.js';
import {
  PriceHistoryService,
  PriceTimelinePoint
} from '../services/PriceHistoryService.js';
import {
  computePriceTrendForecast,
  formatShortRoDate,
  OfferSnapshotInput,
  PriceTrendChartPoint
} from '../utils/priceTrendForecast.js';

interface ProductPriceTrendProps {
  productId?: string;
  productName: string;
  observations: PriceObservation[];
  offers?: OfferSnapshotInput[];
  stores?: Store[];
}

const INTERVAL_OPTIONS: Array<{ days: PriceHistoryInterval; label: string }> = [
  { days: 30, label: '30 zile' },
  { days: 90, label: '90 zile' },
  { days: 180, label: '180 zile' },
  { days: 365, label: '1 an' }
];

function formatRonValue(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return 'Indisponibil';
  return `${val.toFixed(2)} lei`;
}

function normalizeStoreKey(value: string): string {
  return (value || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
}

function resolveStoreName(storeId: string, stores: Store[]): string {
  const key = normalizeStoreKey(storeId);
  const found = stores.find(
    s =>
      s.id === storeId ||
      normalizeStoreKey(s.id) === key ||
      normalizeStoreKey(s.slug || '') === key
  );
  return found?.name || storeId || 'Magazin';
}

function formatSourceLabel(source: string): string {
  switch (source) {
    case 'verified':
      return 'Bon fiscal confirmat';
    case 'official_feed':
      return 'Catalog / feed oficial';
    case 'partner_api':
      return 'API partener';
    case 'user_reported':
      return 'Raportat de utilizator';
    default:
      return 'Observație catalog';
  }
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: PriceTrendChartPoint }>;
}

const TrendChartTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const isForecast = point.kind === 'forecast';

  return (
    <div className="bg-slate-900 text-white rounded-xl px-3.5 py-2.5 text-xs shadow-lg border border-slate-700 max-w-xs space-y-1">
      <div className="font-bold text-slate-100 flex items-center justify-between gap-3">
        <span>{isForecast ? `Estimare ${point.label}` : formatShortRoDate(point.date)}</span>
        <span className="font-mono text-[11px] text-slate-400 tabular-nums">{point.date}</span>
      </div>

      {!isForecast && point.historicalPrice !== undefined && (
        <div className="space-y-0.5 pt-1 border-t border-slate-700/80">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-300">Cel mai mic preț:</span>
            <span className="font-mono font-bold text-emerald-400 tabular-nums">
              {formatRonValue(point.historicalPrice)}
            </span>
          </div>
          {point.avgPrice !== undefined && Math.abs(point.avgPrice - point.historicalPrice) >= 0.01 && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-300">Preț mediu retaileri:</span>
              <span className="font-mono font-semibold text-slate-200 tabular-nums">
                {formatRonValue(point.avgPrice)}
              </span>
            </div>
          )}
          {point.stores && point.stores.length > 0 && (
            <div className="text-[11px] text-slate-300 pt-0.5">
              Retailer: {point.stores.join(', ')}
            </div>
          )}
          {point.sources && point.sources.length > 0 && (
            <div className="text-[11px] text-slate-400">
              Sursă: {point.sources.join(' · ')}
            </div>
          )}
        </div>
      )}

      {isForecast && point.forecastPrice !== undefined && (
        <div className="space-y-0.5 pt-1 border-t border-slate-700/80">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-300">Estimare statistică:</span>
            <span className="font-mono font-bold text-sky-400 tabular-nums">
              {formatRonValue(point.forecastPrice)}
            </span>
          </div>
          {point.forecastLow !== undefined && point.forecastHigh !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-300">Interval orientativ:</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {point.forecastLow.toFixed(2)} – {point.forecastHigh.toFixed(2)} lei
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ProductPriceTrend: React.FC<ProductPriceTrendProps> = ({
  productName,
  observations,
  offers = [],
  stores = STORES
}) => {
  const [intervalDays, setIntervalDays] = useState<PriceHistoryInterval>(90);
  const [forecastWeeks, setForecastWeeks] = useState<number>(4);
  const [showStoreAverage, setShowStoreAverage] = useState<boolean>(true);
  const [showForecast, setShowForecast] = useState<boolean>(false);

  // Excludem orice observație sintetică / demo / invalidă
  const realObservations = useMemo(
    () =>
      (observations || [])
        .filter(
          obs =>
            obs &&
            Number.isFinite(Number(obs.price)) &&
            Number(obs.price) > 0 &&
            obs.source !== 'demo' &&
            obs.source !== 'estimated'
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [observations]
  );

  // Verificăm dacă există date suficiente pentru 1 an (minim 2 zile distincte în ultimele 365 zile, cu acoperire > 180 zile sau înregistrări în afara 180 zile)
  const timelineAll: PriceTimelinePoint[] = useMemo(
    () =>
      realObservations.map(obs => ({
        date: obs.date.slice(0, 10),
        price: Math.round(Number(obs.price) * 100) / 100,
        storeId: obs.storeId,
        storeName: resolveStoreName(obs.storeId, stores),
        source: formatSourceLabel(obs.source),
        sourceType: obs.source
      })),
    [realObservations, stores]
  );

  const yearStats = useMemo(
    () => PriceHistoryService.computeIntervalStats(timelineAll, 365),
    [timelineAll]
  );

  const intervalObservations = useMemo(
    () => PriceHistoryService.filterPointsByDays(realObservations, intervalDays),
    [realObservations, intervalDays]
  );

  const activeIntervalStats = useMemo(
    () => PriceHistoryService.computeIntervalStats(timelineAll, intervalDays),
    [timelineAll, intervalDays]
  );

  const forecast = useMemo(
    () =>
      computePriceTrendForecast({
        observations: intervalObservations,
        offers: showForecast ? offers : [],
        stores,
        forecastWeeks
      }),
    [intervalObservations, offers, stores, forecastWeeks, showForecast]
  );

  const chartData = useMemo(
    () =>
      showForecast
        ? forecast.chartData
        : forecast.chartData.filter(point => point.kind === 'historical'),
    [forecast.chartData, showForecast]
  );

  const sameDayStoreBars = useMemo(() => {
    if (forecast.status !== 'same_day_only') return [];
    return intervalObservations
      .map((o, idx) => ({
        key: `${normalizeStoreKey(o.storeId)}-${idx}`,
        storeName: resolveStoreName(o.storeId, stores),
        price: Math.round(Number(o.price) * 100) / 100,
        date: o.date.slice(0, 10)
      }))
      .sort((a, b) => a.price - b.price);
  }, [forecast.status, intervalObservations, stores]);

  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    for (const p of chartData) {
      if (p.historicalPrice !== undefined) vals.push(p.historicalPrice);
      if (showStoreAverage && p.avgPrice !== undefined) vals.push(p.avgPrice);
      if (showForecast && p.forecastLow !== undefined) vals.push(p.forecastLow);
      if (showForecast && p.forecastHigh !== undefined) vals.push(p.forecastHigh);
    }
    if (vals.length === 0) return [0, 10];
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const pad = Math.max(0.2, (maxVal - minVal) * 0.18);
    return [Math.max(0, Math.floor((minVal - pad) * 10) / 10), Math.ceil((maxVal + pad) * 10) / 10];
  }, [chartData, showStoreAverage, showForecast]);

  const lastHistoricalLabel =
    forecast.historicalPoints.length > 0
      ? forecast.historicalPoints[forecast.historicalPoints.length - 1].label
      : undefined;

  const hasAverageDiff = forecast.historicalPoints.some(
    p => Math.abs(p.avgPrice - p.minPrice) >= 0.01
  );

  const metrics = forecast.metrics;

  const DirectionIcon =
    forecast.direction === 'down'
      ? TrendingDown
      : forecast.direction === 'up'
      ? TrendingUp
      : Minus;

  const directionMeta =
    forecast.direction === 'down'
      ? { label: 'Scădere', color: 'text-emerald-700 dark:text-emerald-400' }
      : forecast.direction === 'up'
      ? { label: 'Creștere', color: 'text-rose-700 dark:text-rose-400' }
      : { label: 'Stabil', color: 'text-slate-700 dark:text-slate-300' };

  const activeIntervalLabel =
    INTERVAL_OPTIONS.find(o => o.days === intervalDays)?.label || `${intervalDays} zile`;

  return (
    <section
      aria-label={`Istoricul prețurilor pentru ${productName}`}
      className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 mb-8"
    >
      {/* Header & Selector Interval 30 / 90 / 180 / 1 an */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800 mb-6">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Istoricul prețurilor
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-1.5 tabular-nums">
            <span>Exclusiv observații reale</span>
            <span aria-hidden="true">·</span>
            <span>{activeIntervalStats.observationsCount} observații în {activeIntervalLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{activeIntervalStats.distinctDaysCount} zile distincte</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector strict 30 | 90 | 180 | 1 an */}
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
                  onClick={() => setIntervalDays(opt.days)}
                  title={
                    isOneYearLimited
                      ? 'Datele pe 1 an sunt limitate pentru acest produs'
                      : `Afișează istoricul pe ${opt.label}`
                  }
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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

          {forecast.status === 'ready' && (
            <>
              {hasAverageDiff && (
                <button
                  type="button"
                  onClick={() => setShowStoreAverage(v => !v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    showStoreAverage
                      ? 'bg-slate-900 dark:bg-emerald-600 text-white border-slate-900 dark:border-emerald-600'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  Medie retaileri
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowForecast(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  showForecast
                    ? 'bg-sky-700 text-white border-sky-700'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {showForecast ? `Proiecție +${forecastWeeks} săpt.` : 'Arată proiecție'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 4 Carduri Metrici Cheie pentru intervalul activ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 tabular-nums">
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Cel mai mic preț ({activeIntervalLabel})
          </div>
          <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-400 font-mono mt-1">
            {formatRonValue(activeIntervalStats.minPrice)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {activeIntervalStats.minPriceStoreName
              ? `${activeIntervalStats.minPriceStoreName} · ${formatShortRoDate(activeIntervalStats.minPriceDate || '')}`
              : 'Fără observații în interval'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Preț mediu ({activeIntervalLabel})
          </div>
          <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-1">
            {formatRonValue(activeIntervalStats.avgPrice)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {activeIntervalStats.observationsCount > 0
              ? `Din ${activeIntervalStats.observationsCount} observații`
              : 'Nicio observație'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Ultimul preț observat
          </div>
          <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-mono mt-1">
            {formatRonValue(activeIntervalStats.lastObservation?.price)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {activeIntervalStats.lastObservation
              ? `${activeIntervalStats.lastObservation.storeName} · ${activeIntervalStats.lastObservation.date}`
              : 'Fără dată observată'}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Variație în {activeIntervalLabel}
          </div>
          {forecast.status === 'ready' && metrics ? (
            <>
              <div className={`text-base font-extrabold flex items-center gap-1.5 mt-1.5 ${directionMeta.color}`}>
                <DirectionIcon className="w-4 h-4 shrink-0" />
                <span>
                  {metrics.changePercent >= 0 ? '+' : ''}
                  {metrics.changePercent.toFixed(1)}%
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {directionMeta.label} · {activeIntervalStats.distinctDaysCount} zile distincte
              </div>
            </>
          ) : (
            <>
              <div className="text-base font-bold text-slate-600 dark:text-slate-300 mt-1.5">
                Date insuficiente
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Minim 2 zile distincte
              </div>
            </>
          )}
        </div>
      </div>

      {/* Caz 1: Istoric suficient pe mai multe zile -> Grafic evoluție Recharts */}
      {forecast.status === 'ready' && metrics ? (
        <div className="space-y-5">
          {showForecast && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-sky-700 dark:text-sky-400 font-semibold">
                Proiecție statistică orientativă (+{forecastWeeks} săpt.): {formatRonValue(metrics.projectedPrice)} ({metrics.projectedLow.toFixed(2)} – {metrics.projectedHigh.toFixed(2)} lei)
              </span>
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {[2, 3, 4].map(weeks => (
                  <button
                    key={weeks}
                    type="button"
                    onClick={() => setForecastWeeks(weeks)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      forecastWeeks === weeks
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    +{weeks} săpt.
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="w-full min-w-0">
            <div className="w-full h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 12, right: 18, left: 0, bottom: 8 }}
                >
                  <defs>
                    <linearGradient id="trendHistoricalFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.28)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={{ stroke: 'rgba(148, 163, 184, 0.35)' }}
                    tickLine={false}
                    minTickGap={16}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={54}
                    tickFormatter={(v: number) => `${Number(v).toFixed(2)}`}
                  />
                  <Tooltip content={<TrendChartTooltip />} />

                  {showForecast && lastHistoricalLabel && (
                    <ReferenceLine
                      x={lastHistoricalLabel}
                      stroke="#94a3b8"
                      strokeDasharray="3 3"
                      label={{
                        value: 'Prezent',
                        position: 'top',
                        fill: '#94a3b8',
                        fontSize: 10
                      }}
                    />
                  )}

                  {showForecast && (
                    <Area
                      type="monotone"
                      dataKey="forecastBand"
                      name="Interval orientativ"
                      stroke="none"
                      fill="#0284c7"
                      fillOpacity={0.14}
                      isAnimationActive={false}
                    />
                  )}

                  <Area
                    type="monotone"
                    dataKey="historicalPrice"
                    name="Istoric confirmat"
                    stroke="#059669"
                    strokeWidth={2.5}
                    fill="url(#trendHistoricalFill)"
                    dot={{ r: 3.5, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: '#059669', stroke: '#ffffff', strokeWidth: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />

                  {showStoreAverage && hasAverageDiff && (
                    <Line
                      type="monotone"
                      dataKey="avgPrice"
                      name="Medie retaileri"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="2 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}

                  {showForecast && (
                    <Line
                      type="monotone"
                      dataKey="forecastPrice"
                      name="Estimare evoluție"
                      stroke="#0284c7"
                      strokeWidth={2.5}
                      strokeDasharray="6 4"
                      dot={{ r: 3.5, fill: '#0284c7', stroke: '#ffffff', strokeWidth: 2 }}
                      activeDot={{ r: 5, fill: '#0284c7', stroke: '#ffffff', strokeWidth: 2 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-0.5 bg-emerald-600 inline-block" />
                <span>Cel mai mic preț zilnic observat</span>
              </span>
              {showStoreAverage && hasAverageDiff && (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-0.5 border-t-2 border-dotted border-slate-500 inline-block" />
                  <span>Preț mediu retaileri</span>
                </span>
              )}
              {showForecast && (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-0.5 border-t-2 border-dashed border-sky-600 inline-block" />
                  <span>Proiecție statistică orientativă</span>
                </span>
              )}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-700 dark:text-slate-300 space-y-1">
            <p className="font-semibold text-slate-900 dark:text-slate-100">{forecast.summaryMessage}</p>
            <p className="text-slate-500 dark:text-slate-400">
              Date reale afișate pentru intervalul {activeIntervalLabel} ({forecast.distinctDatesCount} zile distincte, {forecast.spanDays} zile acoperite). Nu sunt generate puncte sintetice pentru zilele fără observații.
            </p>
          </div>
        </div>
      ) : forecast.status === 'same_day_only' && sameDayStoreBars.length > 0 ? (
        <div className="space-y-5">
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
            <span>{activeIntervalStats.noticeRo || forecast.summaryMessage}</span>
          </div>
        </div>
      ) : (
        <div className="py-8 px-4 text-center bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <Info className="w-7 h-7 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Istoric insuficient pentru intervalul {activeIntervalLabel}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto mt-1 leading-relaxed">
            {activeIntervalStats.noticeRo ||
              'Nu există suficiente observații reale în intervalul selectat pentru a afișa evoluția prețului.'}
          </p>
        </div>
      )}
    </section>
  );
};
