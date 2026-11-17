// src/utils/priceTrendForecast.ts
// Utilitar deterministic pentru agregarea istoricului de prețuri și estimarea evoluției săptămânale

import { PriceObservation, Store } from '../types.js';

export interface HistoricalPricePoint {
  date: string;
  label: string;
  minPrice: number;
  avgPrice: number;
  maxPrice: number;
  observationsCount: number;
  stores: string[];
  sources: string[];
}

export interface PriceTrendChartPoint {
  date: string;
  label: string;
  kind: 'historical' | 'forecast';
  historicalPrice?: number;
  avgPrice?: number;
  forecastPrice?: number;
  forecastLow?: number;
  forecastHigh?: number;
  forecastBand?: [number, number];
  observationsCount?: number;
  stores?: string[];
  sources?: string[];
  weekOffset?: number;
}

export interface OfferSnapshotInput {
  price: number;
  observationDate?: string;
  storeId?: string;
  storeName?: string;
}

export interface PriceTrendForecastResult {
  status: 'ready' | 'same_day_only' | 'insufficient_history';
  historicalPoints: HistoricalPricePoint[];
  chartData: PriceTrendChartPoint[];
  metrics: {
    latestObservedPrice: number;
    latestObservedDate: string;
    minObservedPrice: number;
    maxObservedPrice: number;
    averageObservedPrice: number;
    projectedPrice: number;
    projectedLow: number;
    projectedHigh: number;
    changeAmount: number;
    changePercent: number;
    weeklySlopeRon: number;
    rSquared: number;
  } | null;
  direction: 'up' | 'down' | 'stable';
  confidence: 'ridicată' | 'medie' | 'redusă';
  totalObservationsCount: number;
  distinctDatesCount: number;
  spanDays: number;
  forecastWeeks: number;
  summaryMessage: string;
}

const RO_MONTHS_SHORT = [
  'ian',
  'feb',
  'mar',
  'apr',
  'mai',
  'iun',
  'iul',
  'aug',
  'sep',
  'oct',
  'noi',
  'dec'
];

export function formatShortRoDate(isoDate: string): string {
  const parts = isoDate.slice(0, 10).split('-');
  if (parts.length !== 3) return isoDate;
  const day = parseInt(parts[2], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (!Number.isFinite(day) || monthIdx < 0 || monthIdx > 11) return isoDate;
  return `${day} ${RO_MONTHS_SHORT[monthIdx]}`;
}

function addDaysIso(isoDate: string, daysToAdd: number): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  parsed.setUTCDate(parsed.getUTCDate() + daysToAdd);
  return parsed.toISOString().slice(0, 10);
}

function daysBetweenIso(startIso: string, endIso: string): number {
  const a = new Date(`${startIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${endIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function roundRon(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatSourceLabel(source?: string): string {
  if (source === 'verified') return 'Bon fiscal verificat';
  if (source === 'official_feed' || source === 'catalog_import' || source === 'estimated') {
    return 'Catalog / feed retailer';
  }
  return source ? source : 'Observație magazin';
}

export function computePriceTrendForecast(params: {
  observations: PriceObservation[];
  offers?: OfferSnapshotInput[];
  stores?: Store[];
  forecastWeeks?: number;
}): PriceTrendForecastResult {
  const forecastWeeks = Math.max(1, Math.min(8, Math.round(params.forecastWeeks ?? 4)));
  const storeNameMap = new Map<string, string>();
  for (const s of params.stores || []) {
    storeNameMap.set(s.id.toLowerCase().replace(/^store-/, ''), s.name);
  }

  const resolveStoreName = (rawStoreId?: string, fallbackName?: string): string => {
    if (fallbackName) return fallbackName;
    const norm = (rawStoreId || '').toLowerCase().replace(/^store-/, '');
    return storeNameMap.get(norm) || rawStoreId || 'Retailer';
  };

  type RawSample = {
    date: string;
    price: number;
    storeName: string;
    sourceLabel: string;
  };

  const samples: RawSample[] = [];
  for (const obs of params.observations || []) {
    const price = Number(obs.price);
    const date = typeof obs.date === 'string' ? obs.date.slice(0, 10) : '';
    if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue;
    }
    samples.push({
      date,
      price: roundRon(price),
      storeName: resolveStoreName(obs.storeId),
      sourceLabel: formatSourceLabel(obs.source)
    });
  }

  // Dacă există oferte active cu date distincte neacoperite deja de observații, le putem completa onest
  const existingDateKeys = new Set(samples.map(s => `${s.date}::${s.storeName}`));
  const distinctObsDates = new Set(samples.map(s => s.date));
  if (distinctObsDates.size < 2 && Array.isArray(params.offers)) {
    for (const off of params.offers) {
      const price = Number(off.price);
      const date = typeof off.observationDate === 'string' ? off.observationDate.slice(0, 10) : '';
      if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        continue;
      }
      const sName = resolveStoreName(off.storeId, off.storeName);
      const key = `${date}::${sName}`;
      if (!existingDateKeys.has(key)) {
        existingDateKeys.add(key);
        samples.push({
          date,
          price: roundRon(price),
          storeName: sName,
          sourceLabel: 'Ofertă activă verificată'
        });
      }
    }
  }

  // Grupăm cronologic după dată
  const byDate = new Map<string, RawSample[]>();
  for (const s of samples) {
    const arr = byDate.get(s.date) || [];
    arr.push(s);
    byDate.set(s.date, arr);
  }

  const sortedDates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
  const historicalPoints: HistoricalPricePoint[] = sortedDates.map(date => {
    const rows = byDate.get(date)!;
    const prices = rows.map(r => r.price);
    const minPrice = roundRon(Math.min(...prices));
    const maxPrice = roundRon(Math.max(...prices));
    const avgPrice = roundRon(prices.reduce((acc, p) => acc + p, 0) / prices.length);
    return {
      date,
      label: formatShortRoDate(date),
      minPrice,
      avgPrice,
      maxPrice,
      observationsCount: rows.length,
      stores: Array.from(new Set(rows.map(r => r.storeName))),
      sources: Array.from(new Set(rows.map(r => r.sourceLabel)))
    };
  });

  if (historicalPoints.length === 0) {
    return {
      status: 'insufficient_history',
      historicalPoints: [],
      chartData: [],
      metrics: null,
      direction: 'stable',
      confidence: 'redusă',
      totalObservationsCount: 0,
      distinctDatesCount: 0,
      spanDays: 0,
      forecastWeeks,
      summaryMessage:
        'Nu există încă observații istorice pentru acest produs. Estimarea evoluției va deveni disponibilă după cel puțin două indexări sau bonuri în zile diferite.'
    };
  }

  if (historicalPoints.length === 1) {
    const only = historicalPoints[0];
    const isSameDayMulti = only.observationsCount >= 2;
    return {
      status: isSameDayMulti ? 'same_day_only' : 'insufficient_history',
      historicalPoints,
      chartData: [
        {
          date: only.date,
          label: only.label,
          kind: 'historical',
          historicalPrice: only.minPrice,
          avgPrice: only.avgPrice,
          observationsCount: only.observationsCount,
          stores: only.stores,
          sources: only.sources
        }
      ],
      metrics: null,
      direction: 'stable',
      confidence: 'redusă',
      totalObservationsCount: samples.length,
      distinctDatesCount: 1,
      spanDays: 0,
      forecastWeeks,
      summaryMessage: isSameDayMulti
        ? `Există ${only.observationsCount} observații înregistrate exclusiv în data de ${formatShortRoDate(only.date)} (${only.minPrice.toFixed(2)} – ${only.maxPrice.toFixed(2)} lei). Estimarea pentru următoarele săptămâni necesită observații în cel puțin două zile distincte.`
        : `Există o singură observație istorică (${only.minPrice.toFixed(2)} lei pe ${formatShortRoDate(only.date)}). Sunt necesare cel puțin două zile distincte de observație pentru a calcula tendința și estimarea săptămânală.`
    };
  }

  // Avem >= 2 date distincte: calculăm regresie liniară pe seria cronologică (x în zile de la prima observație)
  const firstDate = historicalPoints[0].date;
  const lastPoint = historicalPoints[historicalPoints.length - 1];
  const spanDays = Math.max(1, daysBetweenIso(firstDate, lastPoint.date));

  const xs = historicalPoints.map(p => daysBetweenIso(firstDate, p.date));
  const ys = historicalPoints.map(p => p.minPrice);

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const rawDailySlope = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - rawDailySlope * meanX;

  // R^2 și deviația standard a reziduurilor
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + rawDailySlope * xs[i];
    sse += (ys[i] - pred) ** 2;
  }
  const rSquared = syy > 0 ? Math.max(0, Math.min(1, 1 - sse / syy)) : 1;
  const residualSigma = n > 2 ? Math.sqrt(sse / (n - 2)) : Math.sqrt(sse / n);

  // Limităm panta zilnică pentru stabilitate pe ferestre scurte și aplicăm amortizare exponențială săptămânală
  const rawWeeklySlope = rawDailySlope * 7;
  const maxWeeklyMove = Math.max(0.25, lastPoint.minPrice * 0.12);
  const clampedWeeklySlope = Math.max(-maxWeeklyMove, Math.min(maxWeeklyMove, rawWeeklySlope));

  // Amortizare suplimentară dacă sunt doar 2 date apropiate (< 4 zile)
  const sampleReliabilityFactor = spanDays < 4 && n <= 2 ? 0.5 : spanDays < 7 ? 0.75 : 1.0;
  const effectiveWeeklySlope = clampedWeeklySlope * sampleReliabilityFactor;

  const minObservedPrice = roundRon(Math.min(...historicalPoints.map(p => p.minPrice)));
  const maxObservedPrice = roundRon(Math.max(...historicalPoints.map(p => p.maxPrice)));
  const averageObservedPrice = roundRon(ys.reduce((a, b) => a + b, 0) / n);

  // Praguri realiste pentru proiecții (evităm valori negative sau extreme)
  const lowerFloor = Math.max(0.15, roundRon(minObservedPrice * 0.65));
  const upperCeiling = roundRon(maxObservedPrice * 1.45);
  const baseUncertainty = Math.max(residualSigma, lastPoint.minPrice * 0.025);

  const chartData: PriceTrendChartPoint[] = historicalPoints.map((p, idx) => {
    const isLastHistorical = idx === historicalPoints.length - 1;
    return {
      date: p.date,
      label: p.label,
      kind: 'historical',
      historicalPrice: p.minPrice,
      avgPrice: p.avgPrice,
      observationsCount: p.observationsCount,
      stores: p.stores,
      sources: p.sources,
      ...(isLastHistorical
        ? {
            forecastPrice: p.minPrice,
            forecastLow: p.minPrice,
            forecastHigh: p.minPrice,
            forecastBand: [p.minPrice, p.minPrice] as [number, number]
          }
        : {})
    };
  });

  // Generăm punctele estimate săptămânale (+1 săpt. .. +forecastWeeks săpt.)
  // Cu factor de amortizare 0.78^j per săptămână (mean-reversion blândă)
  let cumulativeDelta = 0;
  let finalProjectedPrice = lastPoint.minPrice;
  let finalProjectedLow = lastPoint.minPrice;
  let finalProjectedHigh = lastPoint.minPrice;

  for (let week = 1; week <= forecastWeeks; week++) {
    const damping = Math.pow(0.78, week - 1);
    cumulativeDelta += effectiveWeeklySlope * damping;
    const rawProjected = lastPoint.minPrice + cumulativeDelta;
    const projectedPrice = roundRon(Math.max(lowerFloor, Math.min(upperCeiling, rawProjected)));

    const spread = Math.min(
      lastPoint.minPrice * 0.35,
      baseUncertainty * Math.sqrt(week) * (spanDays < 7 ? 1.25 : 1.0)
    );
    const forecastLow = roundRon(Math.max(lowerFloor, projectedPrice - spread));
    const forecastHigh = roundRon(Math.min(upperCeiling, projectedPrice + spread));

    finalProjectedPrice = projectedPrice;
    finalProjectedLow = forecastLow;
    finalProjectedHigh = forecastHigh;

    const futureDate = addDaysIso(lastPoint.date, week * 7);
    chartData.push({
      date: futureDate,
      label: `+${week} săpt.`,
      kind: 'forecast',
      forecastPrice: projectedPrice,
      forecastLow,
      forecastHigh,
      forecastBand: [forecastLow, forecastHigh],
      weekOffset: week
    });
  }

  const changeAmount = roundRon(finalProjectedPrice - lastPoint.minPrice);
  const changePercent =
    lastPoint.minPrice > 0 ? Math.round((changeAmount / lastPoint.minPrice) * 1000) / 10 : 0;

  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (changePercent <= -1.5) direction = 'down';
  else if (changePercent >= 1.5) direction = 'up';

  let confidence: 'ridicată' | 'medie' | 'redusă' = 'redusă';
  if (historicalPoints.length >= 6 && spanDays >= 14) {
    confidence = 'ridicată';
  } else if (historicalPoints.length >= 3 && spanDays >= 3) {
    confidence = 'medie';
  }

  let summaryMessage =
    'Prețul a rămas relativ stabil în perioada observată, fără o variație majoră estimată în următoarele săptămâni.';
  if (direction === 'down') {
    summaryMessage = `Pe baza ultimelor ${historicalPoints.length} zile de observații, trendul indică o posibilă scădere ușoară de aproximativ ${Math.abs(changePercent).toFixed(1)}% în următoarele ${forecastWeeks} săptămâni.`;
  } else if (direction === 'up') {
    summaryMessage = `Pe baza ultimelor ${historicalPoints.length} zile de observații, trendul sugerează o posibilă creștere de aproximativ +${changePercent.toFixed(1)}% în următoarele ${forecastWeeks} săptămâni.`;
  }

  return {
    status: 'ready',
    historicalPoints,
    chartData,
    metrics: {
      latestObservedPrice: lastPoint.minPrice,
      latestObservedDate: lastPoint.date,
      minObservedPrice,
      maxObservedPrice,
      averageObservedPrice,
      projectedPrice: finalProjectedPrice,
      projectedLow: finalProjectedLow,
      projectedHigh: finalProjectedHigh,
      changeAmount,
      changePercent,
      weeklySlopeRon: roundRon(effectiveWeeklySlope),
      rSquared: Math.round(rSquared * 100) / 100
    },
    direction,
    confidence,
    totalObservationsCount: samples.length,
    distinctDatesCount: historicalPoints.length,
    spanDays,
    forecastWeeks,
    summaryMessage
  };
}
