// src/components/ProductPriceTrend.tsx
// Componentă 'Trend Prețuri' pe pagina de detaliu produs folosind Recharts
// Vizualizează istoricul real de preț și estimează evoluția pentru următoarele săptămâni.

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
import { PriceObservation, Store } from '../types.js';
import { STORES } from '../data/mockData.js';
import {
  computePriceTrendForecast,
  formatShortRoDate,
  OfferSnapshotInput,
  PriceTrendChartPoint
} from '../utils/priceTrendForecast.js';

interface ProductPriceTrendProps {
  productName: string;
  observations: PriceObservation[];
  offers?: OfferSnapshotInput[];
  stores?: Store[];
}

function formatRonValue(val: number | undefined | null): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return '—';
  return `${val.toFixed(2)} lei`;
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
            <span className="text-slate-300">Preț minim observat:</span>
            <span className="font-mono font-bold text-emerald-400 tabular-nums">
              {formatRonValue(point.historicalPrice)}
            </span>
          </div>
          {point.avgPrice !== undefined && Math.abs(point.avgPrice - point.historicalPrice) >= 0.01 && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-300">Medie retaileri:</span>
              <span className="font-mono font-semibold text-slate-200 tabular-nums">
                {formatRonValue(point.avgPrice)}
              </span>
            </div>
          )}
          {point.stores && point.stores.length > 0 && (
            <div className="text-[11px] text-slate-400 pt-0.5">
              Magazine: {point.stores.join(', ')}
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
            <span className="text-slate-300">Preț estimat:</span>
            <span className="font-mono font-bold text-sky-400 tabular-nums">
              {formatRonValue(point.forecastPrice)}
            </span>
          </div>
          {point.forecastLow !== undefined && point.forecastHigh !== undefined && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-300">Interval probabil:</span>
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
  const [forecastWeeks, setForecastWeeks] = useState<number>(4);
  const [showStoreAverage, setShowStoreAverage] = useState<boolean>(true);

  const forecast = useMemo(
    () =>
      computePriceTrendForecast({
        observations,
        offers,
        stores,
        forecastWeeks
      }),
    [observations, offers, stores, forecastWeeks]
  );

  // Date pentru graficul de comparație pe aceeași zi (când există >= 2 observații dar dintr-o singură zi)
  const sameDayStoreBars = useMemo(() => {
    if (forecast.status !== 'same_day_only') return [];
    const storeNameMap = new Map(
      stores.map(s => [s.id.toLowerCase().replace(/^store-/, ''), s.name])
    );
    return observations
      .filter(o => Number.isFinite(Number(o.price)) && Number(o.price) > 0)
      .map((o, idx) => {
        const norm = (o.storeId || '').toLowerCase().replace(/^store-/, '');
        return {
          key: `${norm}-${idx}`,
          storeName: storeNameMap.get(norm) || o.storeId || 'Magazin',
          price: Math.round(Number(o.price) * 100) / 100,
          date: o.date
        };
      })
      .sort((a, b) => a.price - b.price);
  }, [forecast.status, observations, stores]);

  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [];
    for (const p of forecast.chartData) {
      if (p.historicalPrice !== undefined) vals.push(p.historicalPrice);
      if (showStoreAverage && p.avgPrice !== undefined) vals.push(p.avgPrice);
      if (p.forecastLow !== undefined) vals.push(p.forecastLow);
      if (p.forecastHigh !== undefined) vals.push(p.forecastHigh);
    }
    if (vals.length === 0) return [0, 10];
    const minVal = Math.min(...vals);
    const maxVal = Math.max(...vals);
    const pad = Math.max(0.2, (maxVal - minVal) * 0.18);
    return [Math.max(0, Math.floor((minVal - pad) * 10) / 10), Math.ceil((maxVal + pad) * 10) / 10];
  }, [forecast.chartData, showStoreAverage]);

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
      ? { label: 'Scădere estimată', color: 'text-emerald-700 dark:text-emerald-400' }
      : forecast.direction === 'up'
      ? { label: 'Creștere estimată', color: 'text-rose-700 dark:text-rose-400' }
      : { label: 'Evoluție stabilă', color: 'text-slate-700 dark:text-slate-300' };

  return (
    <section
      aria-label={`Trend prețuri pentru ${productName}`}
      className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 mb-8"
    >
      {/* Header & Controale Orizont */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800 mb-6">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            Trend Prețuri
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-1.5">
            <span>Istoric din observații reale</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{forecast.totalObservationsCount} observații</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{forecast.distinctDatesCount} zile distincte</span>
          </p>
        </div>

        {forecast.status === 'ready' && (
          <div className="flex flex-wrap items-center gap-2">
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
                Medie magazine
              </button>
            )}

            <div
              role="group"
              aria-label="Orizont estimare săptămânală"
              className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl"
            >
              {[2, 3, 4].map(weeks => (
                <button
                  key={weeks}
                  type="button"
                  onClick={() => setForecastWeeks(weeks)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
      </div>

      {/* Caz 1: Istoric suficient pe mai multe zile -> Grafic Recharts + Estimare */}
      {forecast.status === 'ready' && metrics ? (
        <div className="space-y-6">
          {/* Metrici cheie pe 4 coloane (single-elevation, fără carduri imbricate cu umbre) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Ultimul preț observat
              </div>
              <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-1">
                {formatRonValue(metrics.latestObservedPrice)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {formatShortRoDate(metrics.latestObservedDate)}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Minim / Mediu istoric
              </div>
              <div className="text-xl font-extrabold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums mt-1">
                {metrics.minObservedPrice.toFixed(2)} lei
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                Medie: {formatRonValue(metrics.averageObservedPrice)}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Estimare +{forecastWeeks} săptămâni
              </div>
              <div className="text-xl font-extrabold text-sky-700 dark:text-sky-400 font-mono tabular-nums mt-1">
                {formatRonValue(metrics.projectedPrice)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                Interval: {metrics.projectedLow.toFixed(2)} – {metrics.projectedHigh.toFixed(2)} lei
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Direcție & Încredere
              </div>
              <div className={`text-base font-extrabold flex items-center gap-1.5 mt-1.5 ${directionMeta.color}`}>
                <DirectionIcon className="w-4 h-4 shrink-0" />
                <span>{directionMeta.label}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                {metrics.changePercent >= 0 ? '+' : ''}
                {metrics.changePercent.toFixed(1)}% · Încredere {forecast.confidence}
              </div>
            </div>
          </div>

          {/* Grafic Recharts Istoric + Estimare */}
          <div className="w-full min-w-0 pt-2">
            <div className="w-full h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={forecast.chartData}
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

                  {lastHistoricalLabel && (
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

                  {/* Bandă de incertitudine pentru săptămânile estimate */}
                  <Area
                    type="monotone"
                    dataKey="forecastBand"
                    name="Interval estimat"
                    stroke="none"
                    fill="#0284c7"
                    fillOpacity={0.14}
                    isAnimationActive={false}
                  />

                  {/* Linia istorică reală */}
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

                  {/* Medie retaileri pe zile */}
                  {showStoreAverage && hasAverageDiff && (
                    <Line
                      type="monotone"
                      dataKey="avgPrice"
                      name="Medie magazine"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="2 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}

                  {/* Linia de estimare săptămânală */}
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
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Legendă curată sub grafic */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-400 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-0.5 bg-emerald-600 inline-block" />
                <span>Istoric confirmat (minim zilnic)</span>
              </span>
              {showStoreAverage && hasAverageDiff && (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-0.5 border-t-2 border-dotted border-slate-500 inline-block" />
                  <span>Medie retaileri</span>
                </span>
              )}
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-0.5 border-t-2 border-dashed border-sky-600 inline-block" />
                <span>Estimare săptămânală</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="w-3.5 h-2.5 rounded-xs bg-sky-600/20 border border-sky-600/30 inline-block" />
                <span>Interval probabil</span>
              </span>
            </div>
          </div>

          {/* Interpretare & Notă metodologică transparentă */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-700 dark:text-slate-300 space-y-1">
            <p className="font-semibold text-slate-900 dark:text-slate-100">{forecast.summaryMessage}</p>
            <p className="text-slate-500 dark:text-slate-400">
              Metodologie: estimare statistică orientativă calculată prin regresie liniară amortizată pe baza celor {forecast.distinctDatesCount} zile de observații reale ({forecast.spanDays} zile acoperite). Nu reprezintă o garanție a prețului de raft viitor.
            </p>
          </div>
        </div>
      ) : forecast.status === 'same_day_only' && sameDayStoreBars.length > 0 ? (
        /* Caz 2: Mai multe observații dar toate din aceeași zi -> Comparație bar chart pe magazine */
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
            <span>{forecast.summaryMessage}</span>
          </div>
        </div>
      ) : (
        /* Caz 3: Istoric insuficient (< 2 zile) */
        <div className="py-8 px-4 text-center bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
          <Info className="w-7 h-7 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Istoric insuficient pentru estimarea săptămânală
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto mt-1 leading-relaxed">
            {forecast.summaryMessage}
          </p>
        </div>
      )}
    </section>
  );
};
