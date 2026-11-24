// src/services/PriceQualityClassifier.ts
// Motor centralizat, configurabil și auditabil pentru clasificarea calității prețurilor (V1)

import type {
  PriceDataQualityAssessment,
  PriceDataQualityStatus,
  PriceQualityClassifierConfig,
  PriceQualityFactor,
  Product,
  ProductOffer
} from '../types.js';
import { type CanonicalAliasSource, resolveCanonicalProductDetail } from './ProductIdentityService.js';

export const PRICE_QUALITY_METHODOLOGY_VERSION = 'v1.0.0';

export const DEFAULT_PRICE_QUALITY_CONFIG: PriceQualityClassifierConfig = {
  recentlyVerifiedMaxHours: 24,
  verifiedMaxHours: 72,
  staleMaxHours: 168, // 7 zile (ciclu săptămânal standard de catalog retail)
  expiredMaxHours: 168,
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

export interface ClassifyOfferQualityOptions {
  product?: Product;
  config?: Partial<PriceQualityClassifierConfig>;
  confirmationsCount?: number;
  now?: Date;
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

function parseOfferTimestamp(offer: ProductOffer): { timestampMs: number | null; iso: string | null } {
  const candidate = offer.lastVerifiedAt || offer.lastChecked || offer.observationDate;
  if (!candidate) return { timestampMs: null, iso: null };

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(candidate.trim())
    ? `${candidate.trim()}T12:00:00.000Z`
    : candidate.trim();

  const ms = new Date(normalized).getTime();
  if (!Number.isFinite(ms)) return { timestampMs: null, iso: null };
  return { timestampMs: ms, iso: new Date(ms).toISOString() };
}

function normalizeUnitToken(u?: string): string {
  return (u || '').trim().toLowerCase().replace(/^ron\//, 'lei/');
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

    // 1. Age of observation / verification
    const { timestampMs, iso: lastVerifiedIso } = parseOfferTimestamp(offer);
    const ageHours =
      timestampMs !== null
        ? Math.round((Math.max(0, now.getTime() - timestampMs) / (1000 * 60 * 60)) * 10) / 10
        : null;

    const hasFutureValidUntil = Boolean(offer.validUntil && offer.validUntil >= todayStr);

    const expiredThresholdHours = Math.max(cfg.staleMaxHours, cfg.expiredMaxHours ?? cfg.staleMaxHours);
    let ageScore = 0;
    let ageDetail = 'Lipsă dată validă de verificare.';
    if (ageHours === null) {
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
    const missingSource = !sourceKey || sourceKey === 'unknown' || sourceKey === 'none' || sourceKey === 'null';
    let sourceScore = 50;
    let sourceDetail = `Sursă: ${offer.source}.`;
    if (missingSource) {
      sourceScore = 0;
      sourceDetail = 'Lipsă sursă declarată — nu poate fi prezentat ca preț verificat.';
      reasons.push('Prețul nu are sursă declarată și nu poate fi prezentat ca verificat.');
    } else if (sourceKey === 'official_feed' || sourceKey === 'partner_api' || sourceKey === 'verified' || sourceKey === 'authorized_api') {
      sourceScore = 100;
      sourceDetail = 'Sursă oficială / acreditată.';
    } else if (sourceKey === 'public_catalog_feed' || sourceKey === 'affiliate_feed' || sourceKey === 'manual_import') {
      sourceScore = 85;
      sourceDetail = 'Catalog public / import verificat.';
    } else if (sourceKey === 'receipt_ocr' || sourceKey === 'user_reported') {
      sourceScore = 70;
      sourceDetail = 'Observație raportată de utilizator sau extrasă de pe bon.';
    } else if (sourceKey === 'estimated' || sourceKey === 'demo') {
      sourceScore = 10;
      sourceDetail = 'Date demonstrative sau estimate (neacreditate pentru comparație live).';
      reasons.push('Sursa ofertei este demonstrativă sau estimată.');
    } else {
      sourceScore = 40;
      reasons.push('Sursă de date neacreditată oficial.');
    }

    // 3. Promo validity (inclusiv verificare validFrom .. validUntil)
    const validFromStr = offer.validFrom ? String(offer.validFrom).slice(0, 10) : undefined;
    const validUntilStr = offer.validUntil ? String(offer.validUntil).slice(0, 10) : undefined;
    const isPromoExpired = Boolean(validUntilStr && validUntilStr < todayStr);
    const isPromoNotYetActive = Boolean(validFromStr && validFromStr > todayStr);
    const hasInvalidPromoRange = Boolean(validFromStr && validUntilStr && validFromStr > validUntilStr);
    const hasInvalidPromoBounds =
      hasInvalidPromoRange ||
      Boolean(offer.isPromo && offer.normalPrice && offer.promoPrice && offer.promoPrice > offer.normalPrice + 0.01) ||
      Boolean(offer.loyaltyCardRequired && !offer.loyaltyCardName) ||
      Boolean(offer.loyaltyPrice && offer.normalPrice && offer.loyaltyPrice >= offer.normalPrice);

    let promoScore = 100;
    let promoDetail = 'Fără promoție sau promoție în termen.';
    if (hasInvalidPromoRange) {
      promoScore = 0;
      promoDetail = `Perioadă promoție invalidă (${validFromStr} – ${validUntilStr}).`;
      reasons.push(`Perioada promoției este invalidă (${validFromStr} > ${validUntilStr}).`);
    } else if (isPromoExpired) {
      promoScore = 0;
      promoDetail = `Promoție/ofertă expirată la ${validUntilStr}.`;
      reasons.push(`Oferta a expirat la data de ${validUntilStr}.`);
    } else if (isPromoNotYetActive) {
      promoScore = 0;
      promoDetail = `Promoție/ofertă neactivă încă (începe la ${validFromStr}).`;
      reasons.push(`Promoția nu este încă activă (începe la ${validFromStr}).`);
    } else if (hasInvalidPromoBounds) {
      promoScore = 25;
      promoDetail = 'Date promoționale sau card de fidelitate inconsistente.';
      reasons.push('Condițiile promoției sau ale cardului de fidelitate sunt inconsistente.');
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
    const hasForeignMeasureCurrency = /^(eur|usd|gbp|€|\$)\b/i.test(rawMeasure);
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
      if (normalizeUnitToken(offer.unitPriceMeasure) !== expectedMeasure) {
        unitScore = 30;
        unitDetail = `Neconcordanță unitate: așteptat ${expectedMeasure}, primit ${offer.unitPriceMeasure}.`;
        reasons.push(`Neconcordanță între unitatea produsului (${expectedMeasure}) și ofertă (${offer.unitPriceMeasure}).`);
      }
    }

    // 6. Price anomalies, currency & structural validity
    let anomalyScore = 100;
    let anomalyDetail = 'Fără anomalii detectate.';
    let hasFatalAnomaly = false;
    let hasSuspiciousAnomaly = false;

    const normalizedCurrency = (offer.currency || 'RON').trim().toUpperCase();
    const isSupportedCurrency = normalizedCurrency === 'RON' || normalizedCurrency === 'LEI';

    if (!isSupportedCurrency || hasForeignMeasureCurrency) {
      anomalyScore = 0;
      hasFatalAnomaly = true;
      anomalyDetail = `Monedă nesuportată (${offer.currency || rawMeasure}); optimizarea acceptă exclusiv RON.`;
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
    } else if (product?.baseReferencePrice && product.baseReferencePrice > 0) {
      const ratio = (offer.price - product.baseReferencePrice) / product.baseReferencePrice;
      if (ratio > cfg.suspiciousDeviationHighRatio) {
        anomalyScore = 30;
        hasSuspiciousAnomaly = true;
        anomalyDetail = `Creștere atipică +${Math.round(ratio * 100)}% față de reperul de ${product.baseReferencePrice.toFixed(2)} RON.`;
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

    // Weighted transparent calculation
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

    // Deterministic priority status resolution
    let status: PriceDataQualityStatus;
    if (hasFatalAnomaly || hasSuspiciousAnomaly || hasInvalidPromoBounds) {
      status = 'SUSPICIOUS';
    } else if (
      verifStatus === 'expired' ||
      isPromoExpired ||
      (!hasFutureValidUntil && ageHours !== null && ageHours > expiredThresholdHours)
    ) {
      status = 'EXPIRED';
    } else if (missingSource || isPromoNotYetActive || verifStatus === 'pending' || sourceKey === 'estimated' || ageHours === null) {
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
      !missingSource &&
      !isPromoNotYetActive &&
      status !== 'EXPIRED' &&
      status !== 'SUSPICIOUS' &&
      offer.price > 0 &&
      sourceKey !== 'estimated' &&
      sourceKey !== 'demo' &&
      verifStatus !== 'demo' &&
      verifStatus !== 'rejected' &&
      verifStatus !== 'isolated';

    const isReliableForOptimization =
      isUsableForComparison && !missingSource && (status === 'VERIFIED_RECENTLY' || status === 'VERIFIED');

    const descriptions: Record<PriceDataQualityStatus, string> = {
      VERIFIED_RECENTLY: 'Preț verificat în ultimele 24h, fără anomalii și cu unități consecvente.',
      VERIFIED: 'Preț verificat în intervalul normal de actualizare (24–72h).',
      STALE: 'Preț verificat anterior; poate necesita reconfirmare la raft.',
      UNVERIFIED: 'Ofertă încă neverificată sau fără confirmare completă.',
      EXPIRED: 'Ofertă sau promoție expirată — exclusă din optimizările active.',
      SUSPICIOUS: 'Anomalie de preț sau date inconsistente — exclusă din calculele sigure.'
    };

    return {
      status,
      labelRo: QUALITY_STATUS_LABELS_RO[status],
      descriptionRo: descriptions[status],
      score,
      methodologyVersion: PRICE_QUALITY_METHODOLOGY_VERSION,
      ageHours,
      lastVerifiedAt: lastVerifiedIso,
      isUsableForComparison,
      isReliableForOptimization,
      factors,
      reasons
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
