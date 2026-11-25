// src/services/PriceQualityClassifier.ts
// Motor centralizat, configurabil și auditabil pentru clasificarea calității prețurilor (V1 + FAZA 3.2)

import type {
  PriceDataQualityAssessment,
  PriceDataQualityStatus,
  PriceObservationQualityInput,
  PriceQualityClassifierConfig,
  PriceQualityFactor,
  Product,
  ProductOffer
} from '../types.js';
import {
  buildCanonicalAliasIndex,
  type CanonicalAliasSource,
  resolveCanonicalProductDetail
} from './ProductIdentityService.js';

export const PRICE_QUALITY_METHODOLOGY_VERSION = 'v1.2.0';
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const DEFAULT_PRICE_QUALITY_CONFIG: PriceQualityClassifierConfig = {
  recentlyVerifiedMaxHours: 24,
  verifiedMaxHours: 72,
  staleMaxHours: 168, // 7 zile (ciclu săptămânal standard de catalog retail)
  expiredMaxHours: 168,
  observationRecentlyVerifiedMaxDays: 7,
  observationVerifiedMaxDays: 30, // > 30 zile => STALE (niciodată EXPIRED doar pentru că este vechi)
  suspiciousDeviationHighRatio: 0.5,
  suspiciousDropNoPromoRatio: 0.6,
  minPlausiblePrice: 0.1,
  maxPlausiblePrice: 5000,
  weights: {
    age: 0.25,
    source: 0.15,
    promoValidity: 0.15,
    productValidity: 0.10,
    unitConsistency: 0.10,
    anomaly: 0.15,
    confirmations: 0.10
  }
};

export const QUALITY_STATUS_LABELS_RO: Record<PriceDataQualityStatus, string> = {
  VERIFIED_RECENTLY: 'Verificat recent (≤ 24h)',
  VERIFIED: 'Verificat',
  STALE: 'Vechi',
  UNVERIFIED: 'Neverificat',
  EXPIRED: 'Expirat',
  SUSPICIOUS: 'Suspect / anomalie'
};

export const OBSERVATION_QUALITY_LABELS_RO: Record<PriceDataQualityStatus, string> = {
  VERIFIED_RECENTLY: 'Confirmat recent',
  VERIFIED: 'Verificat',
  STALE: 'Preț vechi (> 30 zile)',
  UNVERIFIED: 'Neverificat',
  EXPIRED: 'Expirat',
  SUSPICIOUS: 'Suspect / anomalie'
};

export interface ParsedIsoDateResult {
  isoDate: string;
  timestampMs: number;
}

/**
 * Parsează strict un timestamp sau o dată ISO (YYYY-MM-DD / YYYY-MM-DDTHH:mm:ss...).
 * Respinge date calendaristice imposibile (ex. 2026-02-30) și formate invalide.
 */
export function parseStrictIsoDate(rawDate: unknown): ParsedIsoDateResult | null {
  if (typeof rawDate !== 'string') return null;
  const trimmed = rawDate.trim();
  if (!trimmed) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
    return null;
  }

  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    utcMidday.getUTCFullYear() !== year ||
    utcMidday.getUTCMonth() !== month - 1 ||
    utcMidday.getUTCDate() !== day
  ) {
    return null;
  }

  const isoDate = `${match[1]}-${match[2]}-${match[3]}`;
  if (trimmed.length === 10) {
    return { isoDate, timestampMs: utcMidday.getTime() };
  }

  const fullMs = new Date(trimmed).getTime();
  if (!Number.isFinite(fullMs)) {
    return null;
  }

  return { isoDate, timestampMs: fullMs };
}

export function isRonCurrency(currency: unknown): boolean {
  if (currency === undefined || currency === null) return true;
  if (typeof currency !== 'string') return false;
  const normalized = currency.trim().toUpperCase();
  return normalized === '' || normalized === 'RON' || normalized === 'LEI';
}

interface TimestampAnalysis {
  state: 'valid' | 'missing' | 'invalid_format' | 'future';
  timestampMs: number | null;
  iso: string | null;
  isoDate: string | null;
}

function analyzeTimestamp(raw: unknown, now: Date): TimestampAnalysis {
  if (raw === undefined || raw === null) {
    return { state: 'missing', timestampMs: null, iso: null, isoDate: null };
  }
  const str = String(raw).trim();
  if (!str) {
    return { state: 'missing', timestampMs: null, iso: null, isoDate: null };
  }
  const parsed = parseStrictIsoDate(str);
  if (!parsed) {
    return { state: 'invalid_format', timestampMs: null, iso: null, isoDate: null };
  }
  if (parsed.timestampMs > now.getTime() + MS_PER_DAY) {
    return {
      state: 'future',
      timestampMs: parsed.timestampMs,
      iso: new Date(parsed.timestampMs).toISOString(),
      isoDate: parsed.isoDate
    };
  }
  return {
    state: 'valid',
    timestampMs: parsed.timestampMs,
    iso: new Date(parsed.timestampMs).toISOString(),
    isoDate: parsed.isoDate
  };
}

function normalizeUnitToken(u?: string): string {
  return (u || '').trim().toLowerCase().replace(/^ron\//, 'lei/');
}

type UnitFamily = 'mass' | 'volume' | 'count' | 'unknown';

function getUnitFamily(unitRaw?: string): UnitFamily {
  const token = normalizeUnitToken(unitRaw).replace(/^lei\//, '');
  if (token === 'kg' || token === 'g' || token === 'mg') return 'mass';
  if (token === 'l' || token === 'ml' || token === 'cl') return 'volume';
  if (token === 'buc' || token === 'pachet' || token === 'set' || token === 'cutie') return 'count';
  return 'unknown';
}

function convertToBaseMeasure(value: number, unitRaw?: string): { family: UnitFamily; baseValue: number } | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const token = normalizeUnitToken(unitRaw).replace(/^lei\//, '');
  if (token === 'kg' || token === 'l') {
    return { family: token === 'kg' ? 'mass' : 'volume', baseValue: value * 1000 };
  }
  if (token === 'g' || token === 'ml') {
    return { family: token === 'g' ? 'mass' : 'volume', baseValue: value };
  }
  if (token === 'cl') {
    return { family: 'volume', baseValue: value * 10 };
  }
  if (token === 'mg') {
    return { family: 'mass', baseValue: value / 1000 };
  }
  if (token === 'buc' || token === 'pachet' || token === 'set' || token === 'cutie') {
    return { family: 'count', baseValue: value };
  }
  return null;
}

const TRUSTED_EXACT_SOURCES = new Set([
  'official_feed',
  'partner_api',
  'verified',
  'authorized_api',
  'public_catalog_feed',
  'affiliate_feed',
  'manual_import'
]);

const UNCONFIRMED_SOURCES = new Set(['receipt_ocr', 'user_reported']);
const SYNTHETIC_SOURCES = new Set(['demo', 'estimated', 'mock', 'synthetic', 'fake', 'simulated']);
const MISSING_SOURCE_TOKENS = new Set(['', 'unknown', 'none', 'null', 'undefined', 'n/a']);

function computeMedian(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export interface ClassifyOfferQualityOptions {
  product?: Product;
  expectedProductId?: string;
  aliasSource?: CanonicalAliasSource;
  historicalBaselinePrice?: number | null;
  config?: Partial<PriceQualityClassifierConfig>;
  confirmationsCount?: number;
  now?: Date;
}

export interface ClassifyObservationQualityOptions {
  product?: Product;
  expectedProductId?: string;
  aliasSource?: CanonicalAliasSource;
  historicalBaselinePrice?: number | null;
  linkedOffer?: ProductOffer;
  config?: Partial<PriceQualityClassifierConfig>;
  confirmationsCount?: number;
  now?: Date;
}

interface InternalObservationContext {
  cfg: PriceQualityClassifierConfig;
  nowMs: number;
  todayStr: string;
  tsAnalysis?: TimestampAnalysis;
  skipAliasCheck?: boolean;
  obsCanonicalDetail?: ReturnType<typeof resolveCanonicalProductDetail>;
  targetCanonicalDetail?: ReturnType<typeof resolveCanonicalProductDetail> | null;
  historicalBaselinePrice?: number | null;
  confirmationsCount?: number;
}

export interface ClassifyObservationBatchResult {
  assessmentsById: Record<string, PriceDataQualityAssessment>;
  baselineUsed: number | null;
  summary: {
    total: number;
    verifiedRecently: number;
    verified: number;
    stale: number;
    unverified: number;
    suspicious: number;
  };
}

export interface ValidateOfferContextOptions {
  product?: Product;
  aliasSource?: CanonicalAliasSource;
  storeId?: string;
  region?: string;
  useLoyaltyCards?: boolean;
  useCoupons?: boolean;
  includeStaleOffers?: boolean;
  requestedQuantity?: number;
  config?: Partial<PriceQualityClassifierConfig>;
  now?: Date;
}

export interface OfferContextValidationResult {
  valid: boolean;
  reasons: string[];
  assessment: PriceDataQualityAssessment;
  requiresLoyaltyCard: boolean;
  requiresCoupon: boolean;
  minQuantityRequired: number | null;
}

function mergeConfig(custom?: Partial<PriceQualityClassifierConfig>): PriceQualityClassifierConfig {
  if (!custom) return DEFAULT_PRICE_QUALITY_CONFIG;
  return {
    ...DEFAULT_PRICE_QUALITY_CONFIG,
    ...custom,
    weights: {
      ...DEFAULT_PRICE_QUALITY_CONFIG.weights,
      ...(custom.weights || {})
    }
  };
}

export class PriceQualityClassifier {
  private static activeConfig: PriceQualityClassifierConfig = DEFAULT_PRICE_QUALITY_CONFIG;

  static getConfig(): PriceQualityClassifierConfig {
    return {
      ...this.activeConfig,
      weights: { ...this.activeConfig.weights }
    };
  }

  static configure(custom: Partial<PriceQualityClassifierConfig>): PriceQualityClassifierConfig {
    this.activeConfig = mergeConfig(custom);
    return this.getConfig();
  }

  static resetConfig(): void {
    this.activeConfig = DEFAULT_PRICE_QUALITY_CONFIG;
  }

  static classifyOffer(
    offer: ProductOffer,
    options: ClassifyOfferQualityOptions = {}
  ): PriceDataQualityAssessment {
    const cfg = options.config ? mergeConfig(options.config) : this.activeConfig;
    const now = options.now || new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const product = options.product;
    const reasons: string[] = [];

    // 0. Canonical identity check (when aliasSource or expectedProductId supplied)
    let hasFatalAnomaly = false;
    let hasSuspiciousAnomaly = false;
    let canonicalProductId = product?.id || options.expectedProductId || offer.productId;
    let originalProductId: string | undefined;

    if (options.aliasSource) {
      const aliasIdx = buildCanonicalAliasIndex(options.aliasSource);
      const offDetail = resolveCanonicalProductDetail(offer.productId, aliasIdx);
      const targetId = options.expectedProductId || product?.id;
      const targetDetail = targetId ? resolveCanonicalProductDetail(targetId, aliasIdx) : null;

      if (offDetail.cycleDetected || (offDetail.wasAlias && !offDetail.found)) {
        hasFatalAnomaly = true;
        reasons.push('Identificatorul de produs al ofertei prezintă ciclu canonic sau alias orfan.');
      } else if (targetDetail && (targetDetail.cycleDetected || (targetDetail.wasAlias && !targetDetail.found))) {
        hasFatalAnomaly = true;
        reasons.push('Produsul țintă prezintă identitate canonică invalidă.');
      } else if (
        targetDetail?.canonicalId &&
        offDetail.canonicalId &&
        targetDetail.canonicalId !== offDetail.canonicalId
      ) {
        hasSuspiciousAnomaly = true;
        reasons.push(
          `Oferta aparține produsului canonic ${offDetail.canonicalId}, diferit de ${targetDetail.canonicalId}.`
        );
      } else if (offDetail.canonicalId) {
        canonicalProductId = offDetail.canonicalId;
        if (offer.productId !== offDetail.canonicalId) {
          originalProductId = offer.productId;
        }
      }
    }

    // 1. Age of observation / verification
    const rawTsCandidate = offer.lastVerifiedAt || offer.lastChecked || offer.observationDate;
    const tsAnalysis = analyzeTimestamp(rawTsCandidate, now);
    const lastVerifiedIso = tsAnalysis.iso;
    const ageHours =
      tsAnalysis.state === 'valid' && tsAnalysis.timestampMs !== null
        ? Math.round((Math.max(0, now.getTime() - tsAnalysis.timestampMs) / MS_PER_HOUR) * 10) / 10
        : null;

    const hasFutureValidUntil = Boolean(offer.validUntil && offer.validUntil >= todayStr);
    const expiredThresholdHours = Math.max(cfg.staleMaxHours, cfg.expiredMaxHours ?? cfg.staleMaxHours);

    let ageScore = 0;
    let ageDetail = 'Lipsă dată validă de verificare.';
    if (tsAnalysis.state === 'invalid_format') {
      hasFatalAnomaly = true;
      ageDetail = 'Data sau timestamp-ul ofertei are format invalid sau imposibil calendaristic.';
      reasons.push(ageDetail);
    } else if (tsAnalysis.state === 'future') {
      hasFatalAnomaly = true;
      ageDetail = 'Data sau timestamp-ul ofertei se află în viitor (> +24h).';
      reasons.push(ageDetail);
    } else if (ageHours === null) {
      ageScore = 0;
      reasons.push('Lipsește data ultimei verificări sau observații.');
    } else if (ageHours <= cfg.recentlyVerifiedMaxHours) {
      ageScore = 100;
      ageDetail = `Verificat acum ${ageHours.toFixed(1)} ore (≤ ${cfg.recentlyVerifiedMaxHours}h).`;
    } else if (ageHours <= cfg.verifiedMaxHours) {
      ageScore = 80;
      ageDetail = `Verificat acum ${ageHours.toFixed(1)} ore (${cfg.recentlyVerifiedMaxHours}–${cfg.verifiedMaxHours}h).`;
    } else if (ageHours <= cfg.staleMaxHours || hasFutureValidUntil) {
      ageScore = hasFutureValidUntil ? 65 : 45;
      ageDetail = hasFutureValidUntil
        ? `Ofertă cu valabilitate activă până la ${offer.validUntil} (verificată acum ${Math.round(ageHours)}h).`
        : `Ofertă veche: ${ageHours.toFixed(1)} ore (${cfg.verifiedMaxHours}–${cfg.staleMaxHours}h).`;
      if (!hasFutureValidUntil) {
        reasons.push(`Prețul are o vechime între ${cfg.verifiedMaxHours} și ${cfg.staleMaxHours} de ore și necesită reconfirmare.`);
      }
    } else if (ageHours <= expiredThresholdHours) {
      ageScore = 25;
      ageDetail = `Ofertă veche extinsă: ${ageHours.toFixed(1)} ore (${cfg.staleMaxHours}–${expiredThresholdHours}h).`;
      reasons.push(`Prețul are o vechime de ${Math.round(ageHours)} ore și necesită reconfirmare.`);
    } else {
      ageScore = 10;
      ageDetail = `Ofertă depășită: ${ageHours.toFixed(1)} ore (> ${expiredThresholdHours}h).`;
      reasons.push(`Observația depășește pragul de ${expiredThresholdHours} de ore fără valabilitate extinsă.`);
    }

    // 2. Source provenance
    const sourceKey = String(offer.source || '').trim().toLowerCase();
    const missingSource = MISSING_SOURCE_TOKENS.has(sourceKey);
    const isSyntheticSource = SYNTHETIC_SOURCES.has(sourceKey);

    let sourceScore = 50;
    let sourceDetail = `Sursă: ${offer.source}.`;
    if (missingSource) {
      sourceScore = 0;
      sourceDetail = 'Lipsă sursă declarată — nu poate fi prezentat ca preț verificat.';
      reasons.push('Prețul nu are sursă declarată și nu poate fi prezentat ca verificat.');
    } else if (isSyntheticSource) {
      sourceScore = 0;
      hasSuspiciousAnomaly = true;
      sourceDetail = 'Sursă demonstrativă sau estimată (neacreditată pentru prețuri reale).';
      reasons.push('Sursa ofertei este demonstrativă sau estimată.');
    } else if (sourceKey === 'official_feed' || sourceKey === 'partner_api' || sourceKey === 'verified' || sourceKey === 'authorized_api') {
      sourceScore = 100;
      sourceDetail = 'Sursă oficială / acreditată.';
    } else if (sourceKey === 'public_catalog_feed' || sourceKey === 'affiliate_feed' || sourceKey === 'manual_import') {
      sourceScore = 85;
      sourceDetail = 'Catalog public / import verificat.';
    } else if (UNCONFIRMED_SOURCES.has(sourceKey)) {
      sourceScore = 70;
      sourceDetail = 'Observație raportată de utilizator sau extrasă de pe bon.';
    } else {
      sourceScore = 40;
      reasons.push('Sursă de date neacreditată oficial.');
    }

    // 3. Promo validity (inclusiv verificare validFrom .. validUntil și normalPrice < promoPrice)
    const validFromStr = offer.validFrom ? String(offer.validFrom).slice(0, 10) : undefined;
    const validUntilStr = offer.validUntil ? String(offer.validUntil).slice(0, 10) : undefined;
    const isPromoExpired = Boolean(validUntilStr && validUntilStr < todayStr);
    const isPromoNotYetActive = Boolean(validFromStr && validFromStr > todayStr);
    const hasInvalidPromoRange = Boolean(validFromStr && validUntilStr && validFromStr > validUntilStr);

    const hasNonPositivePromoBound =
      (offer.normalPrice !== undefined && offer.normalPrice !== null && (!Number.isFinite(offer.normalPrice) || offer.normalPrice <= 0)) ||
      (offer.promoPrice !== undefined && offer.promoPrice !== null && (!Number.isFinite(offer.promoPrice) || offer.promoPrice <= 0)) ||
      (offer.loyaltyPrice !== undefined && offer.loyaltyPrice !== null && (!Number.isFinite(offer.loyaltyPrice) || offer.loyaltyPrice <= 0));

    const hasInvertedPromoPrices =
      Boolean(offer.normalPrice && offer.promoPrice && offer.normalPrice < offer.promoPrice) ||
      Boolean(offer.isPromo && offer.normalPrice && offer.price > offer.normalPrice + 0.001);

    const hasInvalidPromoBounds =
      hasInvalidPromoRange ||
      hasNonPositivePromoBound ||
      hasInvertedPromoPrices ||
      Boolean(offer.loyaltyCardRequired && !offer.loyaltyCardName) ||
      Boolean(offer.loyaltyPrice && offer.normalPrice && offer.loyaltyPrice >= offer.normalPrice);

    let promoScore = 100;
    let promoDetail = 'Fără promoție sau promoție în termen.';
    if (hasInvalidPromoRange) {
      promoScore = 0;
      promoDetail = `Perioadă promoție invalidă (${validFromStr} – ${validUntilStr}).`;
      reasons.push(`Perioada promoției este invalidă (${validFromStr} > ${validUntilStr}).`);
    } else if (hasInvertedPromoPrices || hasNonPositivePromoBound) {
      promoScore = 0;
      promoDetail = 'Inconsistență promoțională (preț normal mai mic decât prețul promoțional sau valori ≤ 0).';
      reasons.push(promoDetail);
    } else if (hasInvalidPromoBounds) {
      promoScore = 25;
      promoDetail = 'Date promoționale sau card de fidelitate inconsistente.';
      reasons.push('Condițiile promoției sau ale cardului de fidelitate sunt inconsistente.');
    } else if (isPromoExpired) {
      promoScore = 0;
      promoDetail = `Promoție/ofertă expirată la ${validUntilStr}.`;
      reasons.push(`Oferta a expirat la data de ${validUntilStr}.`);
    } else if (isPromoNotYetActive) {
      promoScore = 0;
      promoDetail = `Promoție/ofertă neactivă încă (începe la ${validFromStr}).`;
      reasons.push(`Promoția nu este încă activă (începe la ${validFromStr}).`);
    } else if (offer.isPromo && validFromStr && validUntilStr) {
      promoDetail = `Promoție activă în perioada ${validFromStr} – ${validUntilStr}.`;
    } else if (offer.isPromo && validUntilStr) {
      promoDetail = `Promoție activă până la ${validUntilStr}.`;
    } else if (offer.isPromo && validFromStr) {
      promoDetail = `Promoție activă din ${validFromStr}.`;
    }

    // 4. Product validity
    let productScore = 100;
    let productDetail = 'Produs valid în catalog.';
    if (!product) {
      productScore = 50;
      productDetail = 'Produs fără detalii complete de ambalaj transmise.';
    } else if (!Number.isFinite(product.packageWeightOrVolume) || product.packageWeightOrVolume <= 0) {
      productScore = 20;
      hasSuspiciousAnomaly = true;
      productDetail = 'Gramajul sau volumul produsului lipsește / este invalid.';
      reasons.push('Gramajul produsului este invalid sau lipsă.');
    } else if (!product.normalizedUnit) {
      productScore = 60;
      productDetail = 'Lipsește unitatea normalizată a produsului.';
    }

    // 5. Unit & currency consistency
    let unitScore = 100;
    let unitDetail = 'Preț unitar și unitate de măsură consecvente.';
    const rawMeasure = String(offer.unitPriceMeasure || '').trim();
    const hasForeignMeasureCurrency = /^(eur|usd|gbp|chf|€|\$|£)\b/i.test(rawMeasure);
    if (hasForeignMeasureCurrency) {
      unitScore = 0;
      unitDetail = `Unitate de măsură în altă monedă decât RON (${rawMeasure}).`;
      reasons.push(`Moneda prețului unitar (${rawMeasure}) nu este RON.`);
    } else if (!Number.isFinite(offer.unitPrice) || offer.unitPrice <= 0 || !offer.unitPriceMeasure) {
      unitScore = 40;
      unitDetail = 'Lipsește prețul unitar sau unitatea de măsură.';
      reasons.push('Lipsește prețul unitar normalizat.');
    } else if (product?.normalizedUnit) {
      const expectedMeasure = `lei/${normalizeUnitToken(product.normalizedUnit)}`;
      const offerFamily = getUnitFamily(offer.unitPriceMeasure);
      const productFamily = getUnitFamily(product.normalizedUnit);
      if (
        (offerFamily === 'mass' && productFamily === 'volume') ||
        (offerFamily === 'volume' && productFamily === 'mass')
      ) {
        unitScore = 0;
        hasSuspiciousAnomaly = true;
        unitDetail = `Conflict fizic de unitate: produs ${product.normalizedUnit}, ofertă ${offer.unitPriceMeasure}.`;
        reasons.push(unitDetail);
      } else if (normalizeUnitToken(offer.unitPriceMeasure) !== expectedMeasure) {
        unitScore = 30;
        unitDetail = `Neconcordanță unitate: așteptat ${expectedMeasure}, primit ${offer.unitPriceMeasure}.`;
        reasons.push(`Neconcordanță între unitatea produsului (${expectedMeasure}) și ofertă (${offer.unitPriceMeasure}).`);
      }
    }

    // 6. Price anomalies, currency & structural validity
    let anomalyScore = 100;
    let anomalyDetail = 'Fără anomalii detectate.';

    const normalizedCurrency = (offer.currency ?? 'RON').trim().toUpperCase();
    const isSupportedCurrency = normalizedCurrency === '' || normalizedCurrency === 'RON' || normalizedCurrency === 'LEI';
    const referencePrice =
      options.historicalBaselinePrice && options.historicalBaselinePrice > 0
        ? options.historicalBaselinePrice
        : product?.baseReferencePrice && product.baseReferencePrice > 0
        ? product.baseReferencePrice
        : null;

    if (!isSupportedCurrency || hasForeignMeasureCurrency) {
      anomalyScore = 0;
      hasFatalAnomaly = true;
      anomalyDetail = `Monedă incompatibilă cu RON (${offer.currency || rawMeasure}).`;
      reasons.push(anomalyDetail);
    } else if (!Number.isFinite(offer.price) || offer.price <= 0) {
      anomalyScore = 0;
      hasFatalAnomaly = true;
      anomalyDetail = 'Preț 0, negativ sau NaN.';
      reasons.push('Prețul ofertei este invalid (≤ 0 RON).');
    } else if (offer.price < cfg.minPlausiblePrice || offer.price > cfg.maxPlausiblePrice) {
      anomalyScore = 0;
      hasSuspiciousAnomaly = true;
      anomalyDetail = `Preț în afara intervalului plauzibil (${cfg.minPlausiblePrice}–${cfg.maxPlausiblePrice} RON).`;
      reasons.push(anomalyDetail);
    } else if (offer.isFlaggedAnomaly) {
      anomalyScore = 10;
      hasSuspiciousAnomaly = true;
      anomalyDetail = offer.anomalyReason || 'Ofertă marcată ca anomalie de audit.';
      reasons.push(anomalyDetail);
    } else if (referencePrice !== null) {
      const ratio = (offer.price - referencePrice) / referencePrice;
      if (ratio > cfg.suspiciousDeviationHighRatio) {
        anomalyScore = 30;
        hasSuspiciousAnomaly = true;
        anomalyDetail = `Creștere atipică +${Math.round(ratio * 100)}% față de reperul de ${referencePrice.toFixed(2)} RON.`;
        reasons.push(anomalyDetail);
      } else if (ratio < -cfg.suspiciousDropNoPromoRatio && !offer.isPromo) {
        anomalyScore = 25;
        hasSuspiciousAnomaly = true;
        anomalyDetail = `Scădere atipică -${Math.round(Math.abs(ratio) * 100)}% fără promoție declarată.`;
        reasons.push(anomalyDetail);
      }
    }

    // 7. Confirmations & verification status
    const verifStatus = offer.verificationStatus;
    const confirmations = Math.max(0, options.confirmationsCount ?? (verifStatus === 'verified' ? 1 : 0));
    let confirmScore = 40;
    let confirmDetail = 'Neverificat.';
    if (verifStatus === 'verified') {
      confirmScore = confirmations >= 2 ? 100 : 88;
      confirmDetail = confirmations >= 2
        ? `Verificat și susținut de ${confirmations} surse/confirmări.`
        : 'Ofertă verificată.';
    } else if (verifStatus === 'pending') {
      confirmScore = 45;
      confirmDetail = 'În așteptarea verificării.';
      reasons.push('Oferta nu a fost încă verificată.');
    } else if (verifStatus === 'rejected' || verifStatus === 'isolated') {
      confirmScore = 0;
      hasFatalAnomaly = true;
      confirmDetail = `Ofertă ${verifStatus === 'isolated' ? 'izolată' : 'respinsă'} din catalog.`;
      reasons.push(confirmDetail);
    } else if (verifStatus === 'expired') {
      confirmScore = 10;
      confirmDetail = 'Ofertă marcată oficial ca expirată.';
      reasons.push(confirmDetail);
    } else if (verifStatus === 'demo') {
      confirmScore = 0;
      hasFatalAnomaly = true;
      confirmDetail = 'Ofertă exclusiv demonstrativă.';
      reasons.push(confirmDetail);
    } else {
      confirmScore = 20;
      confirmDetail = `Status verificare necunoscut (${String(verifStatus || 'nespecificat')}).`;
      reasons.push(confirmDetail);
    }

    const w = cfg.weights;
    const totalWeight =
      w.age + w.source + w.promoValidity + w.productValidity + w.unitConsistency + w.anomaly + w.confirmations || 1;

    const factors: PriceQualityFactor[] = [
      {
        key: 'age',
        labelRo: 'Vechimea observației',
        score: ageScore,
        weight: w.age,
        contribution: Math.round((ageScore * w.age / totalWeight) * 10) / 10,
        detailRo: ageDetail
      },
      {
        key: 'source',
        labelRo: 'Sursa datelor',
        score: sourceScore,
        weight: w.source,
        contribution: Math.round((sourceScore * w.source / totalWeight) * 10) / 10,
        detailRo: sourceDetail
      },
      {
        key: 'promo_validity',
        labelRo: 'Validitatea promoției / ofertei',
        score: promoScore,
        weight: w.promoValidity,
        contribution: Math.round((promoScore * w.promoValidity / totalWeight) * 10) / 10,
        detailRo: promoDetail
      },
      {
        key: 'product_validity',
        labelRo: 'Validitatea produsului de referință',
        score: productScore,
        weight: w.productValidity,
        contribution: Math.round((productScore * w.productValidity / totalWeight) * 10) / 10,
        detailRo: productDetail
      },
      {
        key: 'unit_consistency',
        labelRo: 'Consistența unităților',
        score: unitScore,
        weight: w.unitConsistency,
        contribution: Math.round((unitScore * w.unitConsistency / totalWeight) * 10) / 10,
        detailRo: unitDetail
      },
      {
        key: 'anomaly',
        labelRo: 'Absența anomaliilor de preț',
        score: anomalyScore,
        weight: w.anomaly,
        contribution: Math.round((anomalyScore * w.anomaly / totalWeight) * 10) / 10,
        detailRo: anomalyDetail
      },
      {
        key: 'confirmations',
        labelRo: 'Confirmări și status verificare',
        score: confirmScore,
        weight: w.confirmations,
        contribution: Math.round((confirmScore * w.confirmations / totalWeight) * 10) / 10,
        detailRo: confirmDetail
      }
    ];

    const score = Math.min(
      100,
      Math.max(
        0,
        Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight)
      )
    );

    // Priority: SUSPICIOUS ALWAYS overrides recency!
    let status: PriceDataQualityStatus;
    if (hasFatalAnomaly || hasSuspiciousAnomaly || hasInvalidPromoBounds || isSyntheticSource) {
      status = 'SUSPICIOUS';
    } else if (
      verifStatus === 'expired' ||
      isPromoExpired ||
      (!hasFutureValidUntil && ageHours !== null && ageHours > expiredThresholdHours)
    ) {
      status = 'EXPIRED';
    } else if (missingSource || isPromoNotYetActive || verifStatus === 'pending' || UNCONFIRMED_SOURCES.has(sourceKey) && confirmations < 2 && verifStatus !== 'verified' || ageHours === null) {
      status = 'UNVERIFIED';
    } else if (ageHours > cfg.verifiedMaxHours) {
      status = 'STALE';
    } else if (ageHours <= cfg.recentlyVerifiedMaxHours && verifStatus === 'verified') {
      status = 'VERIFIED_RECENTLY';
    } else {
      status = 'VERIFIED';
    }

    const isUsableForComparison =
      !hasFatalAnomaly &&
      !hasSuspiciousAnomaly &&
      !missingSource &&
      !isPromoNotYetActive &&
      !isSyntheticSource &&
      status !== 'EXPIRED' &&
      status !== 'SUSPICIOUS' &&
      offer.price > 0 &&
      verifStatus !== 'demo' &&
      verifStatus !== 'rejected' &&
      verifStatus !== 'isolated';

    const isReliableForOptimization =
      isUsableForComparison && !missingSource && (status === 'VERIFIED_RECENTLY' || status === 'VERIFIED');

    const descriptions: Record<PriceDataQualityStatus, string> = {
      VERIFIED_RECENTLY: 'Preț verificat recent, fără anomalii și cu unități consecvente.',
      VERIFIED: 'Preț verificat în intervalul normal de actualizare (24–72h).',
      STALE: 'Preț verificat anterior; poate necesita reconfirmare la raft.',
      UNVERIFIED: 'Ofertă încă neverificată sau fără confirmare completă.',
      EXPIRED: 'Ofertă sau promoție expirată — exclusă din optimizările active.',
      SUSPICIOUS: 'Anomalie de preț sau date inconsistente — exclusă din calculele sigure.'
    };

    const hasEnoughDataForScore = !missingSource && ageHours !== null && !hasFatalAnomaly;

    return {
      status,
      labelRo: QUALITY_STATUS_LABELS_RO[status],
      descriptionRo: descriptions[status],
      score,
      hasEnoughDataForScore,
      subjectType: 'offer',
      methodologyVersion: PRICE_QUALITY_METHODOLOGY_VERSION,
      ageHours,
      lastVerifiedAt: lastVerifiedIso,
      isUsableForComparison,
      isReliableForOptimization,
      canonicalProductId,
      originalProductId,
      factors,
      reasons
    };
  }

  /**
   * Clasificare deterministă și explicabilă pentru o observație istorică (`price_observations`).
   * REGULĂ DE AUR FAZA 3.2:
   * - `SUSPICIOUS` are întotdeauna prioritate peste prospețime/vechime.
   * - O observație istorică veche (> 30 zile) devine `STALE`, NICIODATĂ `EXPIRED` doar pentru că este veche.
   * - Dacă oferta asociată a expirat, se menționează transparent în motive fără a invalida faptul istoric.
   */
  static classifyObservation(
    observation: PriceObservationQualityInput,
    options: ClassifyObservationQualityOptions = {}
  ): PriceDataQualityAssessment {
    const cfg = options.config ? mergeConfig(options.config) : this.activeConfig;
    const now = options.now || new Date();
    const nowMs = now.getTime();
    const todayStr = now.toISOString().slice(0, 10);
    return this.classifyObservationCore(observation, options, {
      cfg,
      nowMs,
      todayStr,
      historicalBaselinePrice: options.historicalBaselinePrice,
      confirmationsCount: options.confirmationsCount
    });
  }

  private static classifyObservationCore(
    observation: PriceObservationQualityInput,
    options: ClassifyObservationQualityOptions,
    ctx: InternalObservationContext
  ): PriceDataQualityAssessment {
    const cfg = ctx.cfg;
    const nowMs = ctx.nowMs;
    const todayStr = ctx.todayStr;
    const product = options.product;
    const reasons: string[] = [];

    const recentDays = Math.max(1, cfg.observationRecentlyVerifiedMaxDays ?? 7);
    const verifiedDays = Math.max(recentDays, cfg.observationVerifiedMaxDays ?? 30);

    let hasFatalAnomaly = false;
    let hasSuspiciousAnomaly = false;

    // 0. Canonical identity & alias provenance
    let canonicalProductId = product?.id || options.expectedProductId || observation.productId;
    let originalProductId: string | undefined =
      observation.originalProductId && observation.originalProductId !== canonicalProductId
        ? observation.originalProductId
        : undefined;

    if (ctx.obsCanonicalDetail) {
      const obsDetail = ctx.obsCanonicalDetail;
      const targetDetail = ctx.targetCanonicalDetail ?? null;

      if (obsDetail.cycleDetected || (obsDetail.wasAlias && !obsDetail.found)) {
        hasFatalAnomaly = true;
        reasons.push('Identificator de produs invalid în observație (ciclu canonic sau alias orfan).');
      } else if (targetDetail && (targetDetail.cycleDetected || (targetDetail.wasAlias && !targetDetail.found))) {
        hasFatalAnomaly = true;
        reasons.push('Produsul țintă are identitate canonică invalidă (ciclu sau alias orfan).');
      } else if (
        targetDetail?.canonicalId &&
        obsDetail.canonicalId &&
        targetDetail.canonicalId !== obsDetail.canonicalId
      ) {
        hasSuspiciousAnomaly = true;
        reasons.push(
          `Observația aparține altui produs canonic (${obsDetail.canonicalId} ≠ ${targetDetail.canonicalId}).`
        );
      } else if (obsDetail.canonicalId) {
        canonicalProductId = obsDetail.canonicalId;
        if (observation.productId !== obsDetail.canonicalId) {
          originalProductId = observation.productId;
        }
      }
    } else if (!ctx.skipAliasCheck && options.aliasSource) {
      const aliasIdx = buildCanonicalAliasIndex(options.aliasSource);
      const obsDetail = resolveCanonicalProductDetail(observation.productId, aliasIdx);
      const targetId = options.expectedProductId || product?.id;
      const targetDetail = targetId ? resolveCanonicalProductDetail(targetId, aliasIdx) : null;

      if (obsDetail.cycleDetected || (obsDetail.wasAlias && !obsDetail.found)) {
        hasFatalAnomaly = true;
        reasons.push('Identificator de produs invalid în observație (ciclu canonic sau alias orfan).');
      } else if (targetDetail && (targetDetail.cycleDetected || (targetDetail.wasAlias && !targetDetail.found))) {
        hasFatalAnomaly = true;
        reasons.push('Produsul țintă are identitate canonică invalidă (ciclu sau alias orfan).');
      } else if (
        targetDetail?.canonicalId &&
        obsDetail.canonicalId &&
        targetDetail.canonicalId !== obsDetail.canonicalId
      ) {
        hasSuspiciousAnomaly = true;
        reasons.push(
          `Observația aparține altui produs canonic (${obsDetail.canonicalId} ≠ ${targetDetail.canonicalId}).`
        );
      } else if (obsDetail.canonicalId) {
        canonicalProductId = obsDetail.canonicalId;
        if (observation.productId !== obsDetail.canonicalId) {
          originalProductId = observation.productId;
        }
      }
    } else if (
      options.expectedProductId &&
      observation.productId &&
      observation.productId !== options.expectedProductId &&
      observation.originalProductId !== observation.productId
    ) {
      hasSuspiciousAnomaly = true;
      reasons.push(
        `Observația aparține produsului ${observation.productId}, diferit de ${options.expectedProductId}.`
      );
    }

    // 1. Date / timestamp validation (strict calendar + future detection)
    const tsAnalysis = ctx.tsAnalysis ?? analyzeTimestamp(observation.date, new Date(nowMs));
    const lastVerifiedIso = tsAnalysis.iso;
    const ageHours =
      tsAnalysis.state === 'valid' && tsAnalysis.timestampMs !== null
        ? Math.round((Math.max(0, nowMs - tsAnalysis.timestampMs) / MS_PER_HOUR) * 10) / 10
        : null;
    const ageDays = ageHours !== null ? ageHours / 24 : null;

    let ageScore = 0;
    let ageDetail = 'Lipsă dată a observației.';
    if (tsAnalysis.state === 'invalid_format') {
      hasFatalAnomaly = true;
      ageDetail = 'Dată calendaristică invalidă sau format nerecunoscut.';
      reasons.push(ageDetail);
    } else if (tsAnalysis.state === 'future') {
      hasFatalAnomaly = true;
      ageDetail = 'Data observației se află în viitor (> +24h).';
      reasons.push(ageDetail);
    } else if (ageDays === null) {
      ageScore = 0;
      reasons.push('Lipsește data observației istorice.');
    } else if (ageDays <= recentDays) {
      ageScore = 100;
      ageDetail = `Observație recentă (acum ${Math.round(ageDays)} zile, ≤ ${recentDays} zile).`;
    } else if (ageDays <= verifiedDays) {
      ageScore = 80;
      ageDetail = `Observație din ultimele ${verifiedDays} de zile (acum ${Math.round(ageDays)} zile).`;
    } else {
      // Historical observations older than 30 days become STALE — NEVER EXPIRED!
      ageScore = 45;
      ageDetail = `Preț mai vechi de ${verifiedDays} de zile (${Math.round(ageDays)} zile).`;
    }

    // 2. Source provenance
    const sourceKey = String(observation.source ?? '').trim().toLowerCase();
    const missingSource = MISSING_SOURCE_TOKENS.has(sourceKey);
    const isSyntheticSource = SYNTHETIC_SOURCES.has(sourceKey);
    const isTrustedSource = TRUSTED_EXACT_SOURCES.has(sourceKey);
    const isUnconfirmedSource = UNCONFIRMED_SOURCES.has(sourceKey);

    let sourceScore = 40;
    let sourceDetail = `Sursă: ${observation.source || 'nespecificată'}.`;
    if (missingSource) {
      sourceScore = 0;
      sourceDetail = 'Lipsă sursă declarată.';
      reasons.push('Sursa observației lipsește — nu poate fi confirmată ca verificată.');
    } else if (isSyntheticSource) {
      sourceScore = 0;
      hasSuspiciousAnomaly = true;
      sourceDetail = 'Sursă demonstrativă sau estimată (nevalidă pentru istoric real).';
      reasons.push('Observația provine dintr-o sursă demonstrativă sau estimată.');
    } else if (sourceKey === 'official_feed' || sourceKey === 'partner_api' || sourceKey === 'verified' || sourceKey === 'authorized_api') {
      sourceScore = 100;
      sourceDetail = 'Sursă oficială / bon fiscal confirmat.';
    } else if (isTrustedSource) {
      sourceScore = 85;
      sourceDetail = 'Catalog public / import verificat.';
    } else if (isUnconfirmedSource) {
      sourceScore = 60;
      sourceDetail = 'Observație raportată de utilizator / OCR în așteptarea confirmării.';
    } else {
      sourceScore = 30;
      reasons.push(`Sursă neacreditată (${observation.source}).`);
    }

    // 3. Linked offer / historical promo context (WITHOUT marking historical observation EXPIRED)
    let promoScore = 100;
    let promoDetail = 'Fără inconsistențe promoționale.';
    let historicalContextNoteRo: string | undefined;

    const validFromStr = observation.validFrom ? String(observation.validFrom).slice(0, 10) : undefined;
    const validUntilStr = observation.validUntil ? String(observation.validUntil).slice(0, 10) : undefined;
    const linkedValidUntil =
      observation.offerValidUntil
        ? String(observation.offerValidUntil).slice(0, 10)
        : options.linkedOffer?.validUntil
        ? String(options.linkedOffer.validUntil).slice(0, 10)
        : undefined;

    const numericPrice = typeof observation.price === 'number' ? observation.price : Number(observation.price);
    const hasNonPositivePromoBound =
      (observation.normalPrice !== undefined && observation.normalPrice !== null && (!Number.isFinite(observation.normalPrice) || observation.normalPrice <= 0)) ||
      (observation.promoPrice !== undefined && observation.promoPrice !== null && (!Number.isFinite(observation.promoPrice) || observation.promoPrice <= 0)) ||
      (observation.loyaltyPrice !== undefined && observation.loyaltyPrice !== null && (!Number.isFinite(observation.loyaltyPrice) || observation.loyaltyPrice <= 0));
    const hasInvertedPromo =
      Boolean(observation.normalPrice && observation.promoPrice && observation.normalPrice < observation.promoPrice) ||
      Boolean(observation.isPromo && observation.normalPrice && Number.isFinite(numericPrice) && numericPrice > observation.normalPrice + 0.001) ||
      Boolean(observation.loyaltyPrice && observation.normalPrice && observation.loyaltyPrice >= observation.normalPrice) ||
      Boolean(validFromStr && validUntilStr && validFromStr > validUntilStr);

    const associatedOfferExpired =
      observation.verificationStatus === 'expired' ||
      options.linkedOffer?.verificationStatus === 'expired' ||
      Boolean(validUntilStr && validUntilStr < todayStr) ||
      Boolean(linkedValidUntil && linkedValidUntil < todayStr);

    if (hasInvertedPromo || hasNonPositivePromoBound) {
      promoScore = 0;
      hasSuspiciousAnomaly = true;
      promoDetail = 'Inconsistență promoțională: prețul normal este mai mic decât prețul promoțional sau conține valori ≤ 0.';
      reasons.push(promoDetail);
    } else if (associatedOfferExpired) {
      const expDate = linkedValidUntil || validUntilStr;
      promoScore = 85;
      historicalContextNoteRo = expDate
        ? `Oferta sau promoția asociată a expirat la ${expDate}; observația rămâne validă ca înregistrare istorică.`
        : 'Oferta asociată a expirat între timp; observația rămâne validă ca înregistrare istorică.';
      promoDetail = historicalContextNoteRo;
    }

    // 4. Packaging & product validity
    let productScore = product ? 100 : 65;
    let productDetail = product ? 'Produs de referință valid.' : 'Fără context complet de produs.';
    const expectedPkgWeight = observation.expectedPackageWeightOrVolume ?? product?.packageWeightOrVolume;
    const expectedPkgUnit = observation.expectedPackageUnit ?? product?.packageUnit ?? observation.expectedUnit ?? product?.normalizedUnit;

    if (
      observation.packageWeightOrVolume !== undefined &&
      (!Number.isFinite(observation.packageWeightOrVolume) || observation.packageWeightOrVolume <= 0)
    ) {
      productScore = 0;
      hasSuspiciousAnomaly = true;
      productDetail = 'Gramajul/volumul declarat al observației este invalid (≤ 0).';
      reasons.push(productDetail);
    } else if (product && (!Number.isFinite(product.packageWeightOrVolume) || product.packageWeightOrVolume <= 0)) {
      productScore = 20;
      hasSuspiciousAnomaly = true;
      productDetail = 'Gramajul produsului de referință este invalid.';
      reasons.push(productDetail);
    } else if (observation.packageWeightOrVolume !== undefined && expectedPkgWeight && expectedPkgWeight > 0) {
      const obsPkgUnit = observation.packageUnit ?? observation.unit ?? expectedPkgUnit;
      const obsBase = convertToBaseMeasure(observation.packageWeightOrVolume, obsPkgUnit);
      const expBase = convertToBaseMeasure(expectedPkgWeight, expectedPkgUnit);
      if (obsBase && expBase) {
        if (obsBase.family !== expBase.family) {
          productScore = 0;
          hasSuspiciousAnomaly = true;
          productDetail = `Conflict de ambalaj/unitate: observație ${observation.packageWeightOrVolume} ${obsPkgUnit} vs produs ${expectedPkgWeight} ${expectedPkgUnit}.`;
          reasons.push(productDetail);
        } else {
          const relDiff = Math.abs(obsBase.baseValue - expBase.baseValue) / Math.max(obsBase.baseValue, expBase.baseValue);
          if (relDiff > 0.05) {
            productScore = 0;
            hasSuspiciousAnomaly = true;
            productDetail = `Conflict de gramaj/ambalaj: observație ${observation.packageWeightOrVolume} ${obsPkgUnit} vs produs așteptat ${expectedPkgWeight} ${expectedPkgUnit}.`;
            reasons.push(productDetail);
          }
        }
      }
    }

    // 5. Unit & currency consistency
    let unitScore = 100;
    let unitDetail = 'Unitate de măsură consecventă.';
    const rawMeasure = String(observation.unitPriceMeasure || '').trim();
    const hasForeignMeasureCurrency = /^(eur|usd|gbp|chf|€|\$|£)\b/i.test(rawMeasure);

    const expectedUnit = observation.expectedUnit || product?.normalizedUnit;
    const expectedFamily = getUnitFamily(expectedUnit);
    const obsUnitToken = observation.normalizedUnit || observation.unit || (rawMeasure ? rawMeasure.replace(/^lei\//i, '') : '');
    const obsFamily = getUnitFamily(obsUnitToken);

    if (hasForeignMeasureCurrency) {
      unitScore = 0;
      unitDetail = `Unitate de măsură în altă monedă decât RON (${rawMeasure}).`;
      reasons.push(unitDetail);
    } else if (expectedFamily !== 'unknown' && obsFamily !== 'unknown') {
      const explicitCountConflict =
        (obsFamily === 'count' &&
          expectedFamily !== 'count' &&
          (Boolean(observation.normalizedUnit) || (product ? product.defaultUnit !== 'buc' && product.packageUnit !== 'buc' : true))) ||
        (expectedFamily === 'count' && obsFamily !== 'count' && (!product || !product.packageUnit || product.packageUnit === 'buc'));

      if ((obsFamily === 'mass' && expectedFamily === 'volume') || (obsFamily === 'volume' && expectedFamily === 'mass') || explicitCountConflict) {
        unitScore = 0;
        hasSuspiciousAnomaly = true;
        unitDetail = `Conflict de unitate de măsură: observație "${obsUnitToken}" vs produs "${expectedUnit}".`;
        reasons.push(unitDetail);
      }
    }

    // 6. Price anomalies & currency check
    let anomalyScore = 100;
    let anomalyDetail = 'Fără anomalii detectate.';
    const normalizedCurrency = (observation.currency ?? 'RON').trim().toUpperCase();
    const supportedCurrency = isRonCurrency(observation.currency);
    const effectiveBaseline = ctx.historicalBaselinePrice !== undefined ? ctx.historicalBaselinePrice : options.historicalBaselinePrice;
    const baselinePrice =
      effectiveBaseline && effectiveBaseline > 0
        ? effectiveBaseline
        : product?.baseReferencePrice && product.baseReferencePrice > 0
        ? product.baseReferencePrice
        : null;

    if (!supportedCurrency || hasForeignMeasureCurrency) {
      anomalyScore = 0;
      hasFatalAnomaly = true;
      anomalyDetail = `Monedă incompatibilă cu RON (${observation.currency || rawMeasure}).`;
      reasons.push(anomalyDetail);
    } else if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      anomalyScore = 0;
      hasFatalAnomaly = true;
      anomalyDetail = 'Preț zero, negativ sau NaN.';
      reasons.push(anomalyDetail);
    } else if (numericPrice < cfg.minPlausiblePrice || numericPrice > cfg.maxPlausiblePrice) {
      anomalyScore = 0;
      hasSuspiciousAnomaly = true;
      anomalyDetail = `Preț în afara intervalului plauzibil (${cfg.minPlausiblePrice}–${cfg.maxPlausiblePrice} RON).`;
      reasons.push(anomalyDetail);
    } else if (observation.isFlaggedAnomaly) {
      anomalyScore = 10;
      hasSuspiciousAnomaly = true;
      anomalyDetail = observation.anomalyReason || 'Observație marcată ca anomalie.';
      reasons.push(anomalyDetail);
    } else if (baselinePrice !== null) {
      const ratio = (numericPrice - baselinePrice) / baselinePrice;
      const isLegitPromo = Boolean(observation.isPromo && (!observation.normalPrice || observation.normalPrice >= numericPrice));
      if (ratio > cfg.suspiciousDeviationHighRatio) {
        anomalyScore = 25;
        hasSuspiciousAnomaly = true;
        anomalyDetail = `Variație extremă inexplicabilă (+${Math.round(ratio * 100)}% față de reperul de ${baselinePrice.toFixed(2)} RON).`;
        reasons.push(anomalyDetail);
      } else if (ratio < -cfg.suspiciousDropNoPromoRatio && !isLegitPromo) {
        anomalyScore = 25;
        hasSuspiciousAnomaly = true;
        anomalyDetail = `Scădere extremă inexplicabilă (-${Math.round(Math.abs(ratio) * 100)}% fără promoție declarată față de reperul de ${baselinePrice.toFixed(2)} RON).`;
        reasons.push(anomalyDetail);
      }
    }

    // 7. Verification status & confirmations
    const obsVerifStatus = observation.verificationStatus;
    const effectiveConfirmations = ctx.confirmationsCount !== undefined ? ctx.confirmationsCount : options.confirmationsCount;
    const confirmations = Math.max(
      0,
      effectiveConfirmations ?? (isTrustedSource && obsVerifStatus !== 'pending' ? 1 : 0)
    );

    let confirmScore = 50;
    let confirmDetail = 'În așteptarea confirmării.';
    if (obsVerifStatus === 'demo' || obsVerifStatus === 'rejected' || obsVerifStatus === 'isolated') {
      confirmScore = 0;
      hasFatalAnomaly = true;
      confirmDetail = `Observație marcată ca ${obsVerifStatus}.`;
      reasons.push(confirmDetail);
    } else if (isTrustedSource && obsVerifStatus !== 'pending') {
      confirmScore = confirmations >= 2 ? 100 : 88;
      confirmDetail = confirmations >= 2
        ? `Confirmată de ${confirmations} înregistrări/surse.`
        : 'Sursă istorică verificată.';
    } else if (obsVerifStatus === 'verified') {
      confirmScore = 90;
      confirmDetail = 'Confirmată ca verificată.';
    } else {
      confirmScore = 40;
      confirmDetail = 'Observație insuficient confirmată / neverificată.';
      if (!isUnconfirmedSource && !missingSource && obsVerifStatus === 'pending') {
        reasons.push('Observația are status pending (neconfirmată).');
      } else if (isUnconfirmedSource && obsVerifStatus !== 'verified' && confirmations < 2) {
        reasons.push('Observație raportată fără confirmare oficială sau corroborare.');
      }
    }

    const w = cfg.weights;
    const totalWeight =
      w.age + w.source + w.promoValidity + w.productValidity + w.unitConsistency + w.anomaly + w.confirmations || 1;

    const factors: PriceQualityFactor[] = [
      {
        key: 'age',
        labelRo: 'Vechimea observației',
        score: ageScore,
        weight: w.age,
        contribution: Math.round((ageScore * w.age / totalWeight) * 10) / 10,
        detailRo: ageDetail
      },
      {
        key: 'source',
        labelRo: 'Sursa datelor',
        score: sourceScore,
        weight: w.source,
        contribution: Math.round((sourceScore * w.source / totalWeight) * 10) / 10,
        detailRo: sourceDetail
      },
      {
        key: 'promo_validity',
        labelRo: 'Context promoție / ofertă',
        score: promoScore,
        weight: w.promoValidity,
        contribution: Math.round((promoScore * w.promoValidity / totalWeight) * 10) / 10,
        detailRo: promoDetail
      },
      {
        key: 'product_validity',
        labelRo: 'Ambalaj și produs',
        score: productScore,
        weight: w.productValidity,
        contribution: Math.round((productScore * w.productValidity / totalWeight) * 10) / 10,
        detailRo: productDetail
      },
      {
        key: 'unit_consistency',
        labelRo: 'Consistența unităților',
        score: unitScore,
        weight: w.unitConsistency,
        contribution: Math.round((unitScore * w.unitConsistency / totalWeight) * 10) / 10,
        detailRo: unitDetail
      },
      {
        key: 'anomaly',
        labelRo: 'Absența anomaliilor de preț',
        score: anomalyScore,
        weight: w.anomaly,
        contribution: Math.round((anomalyScore * w.anomaly / totalWeight) * 10) / 10,
        detailRo: anomalyDetail
      },
      {
        key: 'confirmations',
        labelRo: 'Confirmări și verificare',
        score: confirmScore,
        weight: w.confirmations,
        contribution: Math.round((confirmScore * w.confirmations / totalWeight) * 10) / 10,
        detailRo: confirmDetail
      }
    ];

    const score = Math.min(
      100,
      Math.max(
        0,
        Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight)
      )
    );

    // Deterministic priority: SUSPICIOUS > UNVERIFIED > STALE > VERIFIED > VERIFIED_RECENTLY
    // Historical observations NEVER become EXPIRED.
    let status: PriceDataQualityStatus;
    if (hasFatalAnomaly || hasSuspiciousAnomaly || isSyntheticSource) {
      status = 'SUSPICIOUS';
    } else if (
      missingSource ||
      ageDays === null ||
      obsVerifStatus === 'pending' ||
      (!isTrustedSource && obsVerifStatus !== 'verified' && confirmations < 2)
    ) {
      status = 'UNVERIFIED';
    } else if (ageDays > verifiedDays) {
      status = 'STALE';
      reasons.push(`Preț mai vechi de ${verifiedDays} de zile.`);
    } else if (ageDays <= recentDays) {
      status = 'VERIFIED_RECENTLY';
      reasons.push(`Confirmat prin observație recentă (≤ ${recentDays} zile).`);
    } else {
      status = 'VERIFIED';
      reasons.push(`Observație verificată din ultimele ${verifiedDays} de zile.`);
    }

    if (historicalContextNoteRo && !reasons.includes(historicalContextNoteRo)) {
      reasons.push(historicalContextNoteRo);
    }

    const labelRo =
      status === 'STALE'
        ? `Preț vechi (> ${verifiedDays} zile)`
        : OBSERVATION_QUALITY_LABELS_RO[status];

    const descriptions: Record<PriceDataQualityStatus, string> = {
      VERIFIED_RECENTLY: `Confirmat prin observație recentă din ultimele ${recentDays} zile.`,
      VERIFIED: `Observație istorică verificată din ultimele ${verifiedDays} de zile.`,
      STALE: `Preț mai vechi de ${verifiedDays} de zile — util pentru istoric, dar necesită reconfirmare la raft.`,
      UNVERIFIED: 'Observație neverificată sau fără confirmare suficientă.',
      EXPIRED: 'Expirat.',
      SUSPICIOUS: 'Observație suspectă sau inconsistentă — păstrată marcată în audit și exclusă din mediile RON.'
    };

    const isUsableForComparison =
      status !== 'SUSPICIOUS' &&
      status !== 'UNVERIFIED' &&
      supportedCurrency &&
      Number.isFinite(numericPrice) &&
      numericPrice > 0 &&
      (normalizedCurrency === '' || normalizedCurrency === 'RON' || normalizedCurrency === 'LEI');

    const isReliableForOptimization =
      isUsableForComparison && (status === 'VERIFIED_RECENTLY' || status === 'VERIFIED');

    const hasEnoughDataForScore = !missingSource && ageDays !== null && !hasFatalAnomaly && Boolean(product || effectiveConfirmations !== undefined);

    return {
      status,
      labelRo,
      descriptionRo: descriptions[status],
      score,
      hasEnoughDataForScore,
      subjectType: 'observation',
      methodologyVersion: PRICE_QUALITY_METHODOLOGY_VERSION,
      ageHours,
      lastVerifiedAt: lastVerifiedIso,
      isUsableForComparison,
      isReliableForOptimization,
      historicalContextNoteRo,
      canonicalProductId,
      originalProductId,
      factors,
      reasons
    };
  }

  /**
   * Clasifică determinist un lot de observații ale unui produs, calculând un reper median robust
   * și confirmările încrucișate fără a șterge observațiile suspecte.
   */
  static classifyObservationBatch(
    observations: PriceObservationQualityInput[],
    options: Omit<ClassifyObservationQualityOptions, 'confirmationsCount'> = {}
  ): ClassifyObservationBatchResult {
    const cfg = options.config ? mergeConfig(options.config) : this.activeConfig;
    const now = options.now || new Date();
    const nowMs = now.getTime();
    const todayStr = now.toISOString().slice(0, 10);

    const prebuiltAliasIndex = options.aliasSource
      ? buildCanonicalAliasIndex(options.aliasSource)
      : undefined;
    const targetId = options.expectedProductId || options.product?.id;
    const targetCanonicalDetail =
      prebuiltAliasIndex && targetId ? resolveCanonicalProductDetail(targetId, prebuiltAliasIndex) : null;
    const obsCanonicalCache = prebuiltAliasIndex
      ? new Map<string, ReturnType<typeof resolveCanonicalProductDetail>>()
      : null;

    const tsCache = new Map<string, TimestampAnalysis>();
    const getCachedTimestamp = (rawDate: unknown): TimestampAnalysis => {
      if (typeof rawDate === 'string') {
        const existing = tsCache.get(rawDate);
        if (existing) return existing;
        const computed = analyzeTimestamp(rawDate, now);
        tsCache.set(rawDate, computed);
        return computed;
      }
      return analyzeTimestamp(rawDate, now);
    };

    const len = observations.length;
    const cachedTsByIdx = new Array<TimestampAnalysis | undefined>(len);
    const dayKeyByIdx = new Array<string>(len);
    const cleanCandidatePrices: number[] = [];
    const confirmationCounts = new Map<string, Set<string>>();

    for (let i = 0; i < len; i++) {
      const obs = observations[i];
      if (!obs) continue;
      const sourceKey = String(obs.source ?? '').trim().toLowerCase();
      const priceNum = typeof obs.price === 'number' ? obs.price : Number(obs.price);
      const ts = getCachedTimestamp(obs.date);
      cachedTsByIdx[i] = ts;
      if (
        !SYNTHETIC_SOURCES.has(sourceKey) &&
        !MISSING_SOURCE_TOKENS.has(sourceKey) &&
        isRonCurrency(obs.currency) &&
        Number.isFinite(priceNum) &&
        priceNum > 0 &&
        ts.state === 'valid'
      ) {
        if (TRUSTED_EXACT_SOURCES.has(sourceKey) || obs.verificationStatus === 'verified') {
          cleanCandidatePrices.push(priceNum);
        }
        const dayKey = `${(obs.storeId || '').toLowerCase()}|${ts.isoDate}|${priceNum.toFixed(2)}`;
        dayKeyByIdx[i] = dayKey;
        let sources = confirmationCounts.get(dayKey);
        if (!sources) {
          sources = new Set<string>();
          confirmationCounts.set(dayKey, sources);
        }
        sources.add(sourceKey || obs.id);
      } else {
        dayKeyByIdx[i] = '';
      }
    }

    const batchMedian =
      options.historicalBaselinePrice && options.historicalBaselinePrice > 0
        ? options.historicalBaselinePrice
        : cleanCandidatePrices.length >= 3
        ? computeMedian(cleanCandidatePrices)
        : options.product?.baseReferencePrice && options.product.baseReferencePrice > 0
        ? options.product.baseReferencePrice
        : null;

    const assessmentsById: Record<string, PriceDataQualityAssessment> = {};
    const summary = {
      total: len,
      verifiedRecently: 0,
      verified: 0,
      stale: 0,
      unverified: 0,
      suspicious: 0
    };

    const sharedCtx: InternalObservationContext = {
      cfg,
      nowMs,
      todayStr,
      skipAliasCheck: !prebuiltAliasIndex,
      targetCanonicalDetail,
      historicalBaselinePrice: batchMedian,
      confirmationsCount: undefined
    };

    for (let i = 0; i < len; i++) {
      const obs = observations[i];
      if (!obs) continue;
      const obsKey = obs.id || `obs-${i}`;
      const dayKey = dayKeyByIdx[i];
      const confCount = dayKey ? confirmationCounts.get(dayKey)?.size || 0 : 0;

      if (prebuiltAliasIndex && obsCanonicalCache) {
        let obsDetail = obsCanonicalCache.get(obs.productId);
        if (!obsDetail) {
          obsDetail = resolveCanonicalProductDetail(obs.productId, prebuiltAliasIndex);
          obsCanonicalCache.set(obs.productId, obsDetail);
        }
        sharedCtx.obsCanonicalDetail = obsDetail;
      } else {
        sharedCtx.obsCanonicalDetail = undefined;
      }

      sharedCtx.tsAnalysis = cachedTsByIdx[i];
      sharedCtx.confirmationsCount = confCount || undefined;

      const assessment = this.classifyObservationCore(obs, options, sharedCtx);

      assessmentsById[obsKey] = assessment;
      if (assessment.status === 'VERIFIED_RECENTLY') summary.verifiedRecently++;
      else if (assessment.status === 'VERIFIED') summary.verified++;
      else if (assessment.status === 'STALE') summary.stale++;
      else if (assessment.status === 'UNVERIFIED') summary.unverified++;
      else if (assessment.status === 'SUSPICIOUS') summary.suspicious++;
    }

    return {
      assessmentsById,
      baselineUsed: batchMedian,
      summary
    };
  }

  /**
   * Validare contextuală centralizată: dată colectare/expirare, sursă, magazin, produs,
   * regiune, condiții promoție (card fidelitate / cupon / cantitate minimă).
   */
  static validateOfferForContext(
    offer: ProductOffer,
    options: ValidateOfferContextOptions = {}
  ): OfferContextValidationResult {
    const assessment = this.classifyOffer(offer, {
      product: options.product,
      aliasSource: options.aliasSource,
      config: options.config,
      now: options.now
    });

    const reasons = [...assessment.reasons];
    const includeStaleOffers = options.includeStaleOffers ?? true;
    const useLoyaltyCards = options.useLoyaltyCards ?? true;
    const useCoupons = options.useCoupons ?? false;

    const normalizeStore = (val?: string) =>
      (val || '').toLowerCase().trim().replace(/^store-/, '').replace(/-chain$/, '').replace(/[^a-z0-9-]/g, '');

    if (options.storeId && normalizeStore(offer.storeId) !== normalizeStore(options.storeId)) {
      reasons.push(`Oferta aparține altui magazin (${offer.storeId}) decât cel evaluat (${options.storeId}).`);
    }

    if (options.product && offer.productId !== options.product.id) {
      let sameCanonicalProduct = false;
      if (options.aliasSource || options.product.canonicalProductId) {
        const source = options.aliasSource ?? [options.product];
        const offerDetail = resolveCanonicalProductDetail(offer.productId, source);
        const prodDetail = resolveCanonicalProductDetail(options.product.id, source);
        sameCanonicalProduct = Boolean(
          offerDetail.found &&
          !offerDetail.cycleDetected &&
          offerDetail.canonicalId &&
          prodDetail.found &&
          !prodDetail.cycleDetected &&
          prodDetail.canonicalId &&
          offerDetail.canonicalId === prodDetail.canonicalId
        );
      }
      if (!sameCanonicalProduct) {
        reasons.push(`Oferta aparține produsului ${offer.productId}, nu produsului ${options.product.id}.`);
      }
    }

    if (options.region !== undefined) {
      const offReg = (offer.region || '').toLowerCase().trim();
      const reqReg = (options.region || '').toLowerCase().trim();
      const isOffNational = !offReg || offReg === 'național' || offReg === 'national' || offReg === 'romania' || offReg === 'toate';
      const isReqNational = !reqReg || reqReg === 'național' || reqReg === 'national' || reqReg === 'romania' || reqReg === 'toate';
      if (!isOffNational && (isReqNational || (!offReg.includes(reqReg) && !reqReg.includes(offReg)))) {
        reasons.push(`Oferta este valabilă doar în regiunea ${offer.region}, nu pentru ${options.region || 'Național'}.`);
      }
    }

    if (!includeStaleOffers && assessment.status === 'STALE') {
      reasons.push('Preț considerat vechi conform politicii stricte de prospețime.');
    }

    const requiresLoyaltyCard = Boolean(offer.loyaltyCardRequired);
    const promoText = (offer.promoDetails || '').toLowerCase();
    const requiresCoupon = Boolean(offer.couponRequired || offer.couponCode || /\b(cupon|voucher|cod\s+promo)\b/i.test(promoText));
    const minQuantityRequired =
      offer.minQuantityForPromo && offer.minQuantityForPromo > 1 ? Math.floor(offer.minQuantityForPromo) : null;

    const hasFallbackRegularPrice = Boolean(
      (offer.normalPrice && offer.normalPrice > 0) || (offer.originalPrice && offer.originalPrice > 0)
    );

    if (requiresLoyaltyCard && !useLoyaltyCards && !hasFallbackRegularPrice) {
      reasons.push('Promoția necesită card de fidelitate și nu are preț standard fără card.');
    }
    if (requiresCoupon && !useCoupons && !hasFallbackRegularPrice) {
      reasons.push('Promoția necesită cupon activat și nu are preț standard alternativ.');
    }
    if (minQuantityRequired && options.requestedQuantity !== undefined && options.requestedQuantity < minQuantityRequired && !hasFallbackRegularPrice) {
      reasons.push(`Promoția necesită minimum ${minQuantityRequired} unități.`);
    }

    const valid =
      assessment.isUsableForComparison &&
      (includeStaleOffers || assessment.status !== 'STALE') &&
      reasons.length === assessment.reasons.length;

    return {
      valid,
      reasons,
      assessment,
      requiresLoyaltyCard,
      requiresCoupon,
      minQuantityRequired
    };
  }
}
