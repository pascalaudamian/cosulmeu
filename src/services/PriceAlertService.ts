import {
  InAppPriceNotification,
  PriceAlert,
  PriceAlertEvaluationOutcome,
  PriceAlertRearmState,
  PriceAlertTriggerEvent,
  PriceAlertType,
  PriceDataQualityAssessment,
  PriceHistoryInterval,
  PriceObservation,
  Product,
  ProductOffer,
  ShoppingList,
  Store
} from '../types.js';
import { STORES } from '../data/mockData.js';
import { BasketOptimizerService } from './BasketOptimizerService.js';
import { PriceComparisonService } from './PriceComparisonService.js';
import { PriceHistoryService } from './PriceHistoryService.js';
import { isRonCurrency, PriceQualityClassifier } from './PriceQualityClassifier.js';
import {
  buildCanonicalAliasIndex,
  type CanonicalAliasSource,
  resolveCanonicalProductDetail,
  resolveCanonicalProductId
} from './ProductIdentityService.js';

const NOTIFICATIONS_STORAGE_KEY = 'cosulmeu_in_app_price_notifications_v1';
const MS_PER_HOUR = 60 * 60 * 1000;
const MAX_TRIGGER_HISTORY_ENTRIES = 25;

export const DEFAULT_ALERT_COOLDOWN_HOURS = 24;
export const DEFAULT_WATCH_COOLDOWN_HOURS = 72;
export const DEFAULT_WATCH_MIN_DROP_PERCENT = 5;
export const DEFAULT_ANY_DROP_MIN_PERCENT = 0.1;

function normalizeStoreLookup(value: string): string {
  return (value || '').toLowerCase().replace(/^store-/, '').replace(/-chain$/, '').trim();
}

function findStoreName(storeId: string | undefined, stores: Store[]): string {
  if (!storeId) return 'Magazin';
  const key = normalizeStoreLookup(storeId);
  const found = stores.find(
    s => s.id === storeId || normalizeStoreLookup(s.id) === key || normalizeStoreLookup(s.slug || '') === key
  );
  return found?.name || storeId;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeUnitToken(unit?: string): string {
  return (unit || '').trim().toLowerCase().replace(/^ron\//, 'lei/');
}

function convertPackageToBaseMeasure(
  value: number | undefined,
  unitRaw?: string
): { family: 'mass' | 'volume' | 'count'; baseValue: number } | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const token = normalizeUnitToken(unitRaw).replace(/^lei\//, '');
  if (token === 'kg') return { family: 'mass', baseValue: value * 1000 };
  if (token === 'g') return { family: 'mass', baseValue: value };
  if (token === 'mg') return { family: 'mass', baseValue: value / 1000 };
  if (token === 'l') return { family: 'volume', baseValue: value * 1000 };
  if (token === 'ml') return { family: 'volume', baseValue: value };
  if (token === 'cl') return { family: 'volume', baseValue: value * 10 };
  if (token === 'buc' || token === 'pachet' || token === 'set' || token === 'cutie') {
    return { family: 'count', baseValue: value };
  }
  return null;
}

export interface EligibleOfferCheckResult {
  eligible: boolean;
  reasonRo?: string;
  assessment?: PriceDataQualityAssessment;
  canonicalProductId?: string;
}

function buildTriggerEvent(
  event: Omit<PriceAlertTriggerEvent, 'id'>
): PriceAlertTriggerEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...event
  };
}

function appendTriggerHistory(
  existing: PriceAlertTriggerEvent[] | undefined,
  nextEvent: PriceAlertTriggerEvent
): PriceAlertTriggerEvent[] {
  const list = Array.isArray(existing) ? existing : [];
  return [nextEvent, ...list].slice(0, MAX_TRIGGER_HISTORY_ENTRIES);
}

export class PriceAlertService {
  static loadLocalNotifications(): InAppPriceNotification[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const raw = window.localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  static saveLocalNotifications(notifications: InAppPriceNotification[]): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications.slice(0, 100)));
    } catch {
      // Ignore storage quota errors
    }
  }

  static getAlertTypeLabel(alertType?: PriceAlertType, intervalDays?: PriceHistoryInterval): string {
    switch (alertType) {
      case 'any_drop':
        return 'Scădere de preț';
      case 'interval_low':
        return `Minim observat (${intervalDays || 90} zile)`;
      case 'product_watch':
        return 'Urmărire produs (scăderi relevante)';
      case 'below_target':
      default:
        return 'Preț sub prag';
    }
  }

  static getRearmStateLabel(alert: Pick<PriceAlert, 'isActive' | 'rearmState'>): string {
    if (!alert.isActive) return 'Oprită';
    if (alert.rearmState === 'triggered_locked') return 'Declanșată · așteaptă revenirea';
    return 'Activă';
  }

  static getDefaultCooldownHours(alertType?: PriceAlertType): number {
    return alertType === 'product_watch' ? DEFAULT_WATCH_COOLDOWN_HOURS : DEFAULT_ALERT_COOLDOWN_HOURS;
  }

  static getDefaultMinDropPercent(alertType?: PriceAlertType): number {
    if (alertType === 'product_watch') return DEFAULT_WATCH_MIN_DROP_PERCENT;
    if (alertType === 'any_drop') return DEFAULT_ANY_DROP_MIN_PERCENT;
    return 0;
  }

  /**
   * Verifică strict eligibilitatea unei oferte pentru declanșarea alertelor:
   * - identitate canonică validă (fără ciclu, self-reference, orfan, >16 hopuri)
   * - preț pozitiv valid în RON (niciodată 0 / NaN / monedă străină)
   * - compatibilitate gramaj / unitate între ofertă și produsul de referință
   * - clasificare PriceQualityClassifier: EXCLUSIV VERIFIED_RECENTLY sau VERIFIED
   *   (exclude explicit SUSPICIOUS, UNVERIFIED, STALE, EXPIRED)
   */
  static evaluateOfferEligibility(
    offer: ProductOffer,
    product: Product | undefined,
    expectedCanonicalProductId: string,
    aliasIndex: ReturnType<typeof buildCanonicalAliasIndex>,
    now: Date,
    historicalBaselinePrice?: number | null
  ): EligibleOfferCheckResult {
    const offerDetail = resolveCanonicalProductDetail(offer.productId, aliasIndex);
    if (offerDetail.cycleDetected || (offerDetail.wasAlias && !offerDetail.found)) {
      return {
        eligible: false,
        reasonRo: 'Oferta are o referință canonică invalidă (ciclu sau alias orfan).'
      };
    }

    const offerCanonId = offerDetail.found && offerDetail.canonicalId ? offerDetail.canonicalId : offer.productId;
    if (offerCanonId !== expectedCanonicalProductId) {
      return {
        eligible: false,
        reasonRo: 'Oferta aparține altui produs canonic.'
      };
    }

    if (typeof offer.price !== 'number' || !Number.isFinite(offer.price) || offer.price <= 0) {
      return {
        eligible: false,
        reasonRo: 'Prețul ofertei este lipsă sau nepozitiv (≤ 0 RON).'
      };
    }

    if (!isRonCurrency(offer.currency)) {
      return {
        eligible: false,
        reasonRo: `Moneda ofertei (${String(offer.currency)}) nu este RON.`
      };
    }

    if (!PriceComparisonService.isOfferValid(offer, product, { aliasMap: aliasIndex, now })) {
      return {
        eligible: false,
        reasonRo: 'Oferta nu îndeplinește criteriile de validitate (expirată, demo, anomalie sau neconfirmată).'
      };
    }

    // Verificare explicită variantă / gramaj / unitate între ofertă și produs
    const offerExt = offer as ProductOffer & {
      packageWeightOrVolume?: number;
      packageUnit?: string;
    };
    if (
      product &&
      offerExt.packageWeightOrVolume !== undefined &&
      product.packageWeightOrVolume > 0
    ) {
      const offerPkgBase = convertPackageToBaseMeasure(
        offerExt.packageWeightOrVolume,
        offerExt.packageUnit || product.packageUnit
      );
      const prodPkgBase = convertPackageToBaseMeasure(product.packageWeightOrVolume, product.packageUnit);
      if (!offerPkgBase || !prodPkgBase || offerPkgBase.family !== prodPkgBase.family) {
        return {
          eligible: false,
          reasonRo: `Variantă incompatibilă de unitate între ofertă (${offerExt.packageWeightOrVolume} ${offerExt.packageUnit || ''}) și produs (${product.packageWeightOrVolume} ${product.packageUnit}).`
        };
      }
      const relDiff =
        Math.abs(offerPkgBase.baseValue - prodPkgBase.baseValue) /
        Math.max(offerPkgBase.baseValue, prodPkgBase.baseValue);
      if (relDiff > 0.05) {
        return {
          eligible: false,
          reasonRo: `Gramaj diferit între ofertă (${offerExt.packageWeightOrVolume} ${offerExt.packageUnit || product.packageUnit}) și produsul urmărit (${product.packageWeightOrVolume} ${product.packageUnit}).`
        };
      }
    }

    if (product?.normalizedUnit && offer.unitPriceMeasure) {
      const expectedMeasure = `lei/${normalizeUnitToken(product.normalizedUnit)}`;
      const actualMeasure = normalizeUnitToken(offer.unitPriceMeasure);
      if (actualMeasure !== expectedMeasure) {
        return {
          eligible: false,
          reasonRo: `Unitate de măsură incompatibilă: ofertă ${offer.unitPriceMeasure} vs produs ${expectedMeasure}.`
        };
      }
    }

    const assessment = PriceQualityClassifier.classifyOffer(offer, {
      product,
      expectedProductId: expectedCanonicalProductId,
      aliasSource: aliasIndex,
      historicalBaselinePrice: historicalBaselinePrice ?? product?.baseReferencePrice ?? null,
      now
    });

    if (assessment.status !== 'VERIFIED_RECENTLY' && assessment.status !== 'VERIFIED') {
      return {
        eligible: false,
        assessment,
        canonicalProductId: offerCanonId,
        reasonRo:
          assessment.reasons[0] ||
          `Calitatea prețului este ${assessment.labelRo} (exclusă din declanșarea alertelor).`
      };
    }

    return {
      eligible: true,
      assessment,
      canonicalProductId: offerCanonId
    };
  }

  /**
   * Reînarmează manual o alertă atunci când utilizatorul îi modifică pragul, tipul sau o reactivează.
   * Păstrează triggerHistory pentru audit, dar curăță blocajul ciclului anterior și cheia de deduplicare.
   */
  static rearmAlertManually(alert: PriceAlert, now: Date = new Date()): PriceAlert {
    const nowIso = now.toISOString();
    const shouldLogRearm = alert.rearmState === 'triggered_locked' || Boolean(alert.lastTriggeredAt);
    return {
      ...alert,
      rearmState: 'armed',
      lastRearmedAt: nowIso,
      lastTriggeredAt: undefined,
      lastNotifiedKey: undefined,
      lastSkippedReasonRo: undefined,
      triggerHistory: shouldLogRearm
        ? appendTriggerHistory(
            alert.triggerHistory,
            buildTriggerEvent({
              alertId: alert.id,
              productId: alert.productId,
              alertType: alert.alertType || 'below_target',
              outcome: 'rearmed_manual',
              observedPrice: alert.currentLowestPrice > 0 ? alert.currentLowestPrice : alert.targetPrice,
              previousPrice: alert.lastTriggeredPrice,
              storeId: alert.lowestStoreId,
              reasonRo: 'Alertă reînarmată manual prin actualizarea regulii sau reactivare.',
              evaluatedAt: nowIso
            })
          )
        : alert.triggerHistory
    };
  }

  /**
   * Creează alerte ne-duplicate din elementele unei liste de cumpărături.
   */
  static createAlertsFromShoppingList(
    list: ShoppingList,
    existingAlerts: PriceAlert[],
    products: Product[],
    offers: ProductOffer[],
    options?: {
      alertType?: PriceAlertType;
      intervalDays?: PriceHistoryInterval;
      minDropPercent?: number;
      cooldownHours?: number;
      discountPercentForTarget?: number; // ex: 10 => prag cu 10% sub cel mai mic preț curent
      aliasMap?: CanonicalAliasSource;
      now?: Date;
    }
  ): {
    createdAlerts: PriceAlert[];
    skippedExistingCount: number;
    unmatchedItemNames: string[];
  } {
    const now = options?.now ?? new Date();
    const alertType: PriceAlertType = options?.alertType || 'below_target';
    const intervalDays: PriceHistoryInterval | undefined =
      alertType === 'interval_low' ? (options?.intervalDays || 90) : undefined;
    const discountPct = options?.discountPercentForTarget ?? 10;
    const minDropPercent =
      options?.minDropPercent ??
      (alertType === 'product_watch' || alertType === 'any_drop'
        ? this.getDefaultMinDropPercent(alertType)
        : undefined);
    const cooldownHours = options?.cooldownHours ?? this.getDefaultCooldownHours(alertType);
    const aliasIndex = buildCanonicalAliasIndex(options?.aliasMap ?? products);

    const existingKeys = new Set(
      existingAlerts.map(a => {
        const detail = resolveCanonicalProductDetail(a.productId, aliasIndex);
        const canonId =
          detail.cycleDetected || (detail.wasAlias && !detail.found)
            ? `__invalid__:${a.productId}`
            : (detail.found && detail.canonicalId ? detail.canonicalId : a.productId);
        return `${canonId}:${a.alertType || 'below_target'}:${a.intervalDays || ''}`;
      })
    );
    const seenInBatch = new Set<string>();
    const createdAlerts: PriceAlert[] = [];
    const unmatchedItemNames: string[] = [];
    let skippedExistingCount = 0;
    const today = now.toISOString().slice(0, 10);

    for (const item of list.items) {
      const match = BasketOptimizerService.matchItemToProduct(item, products, aliasIndex);
      if (match.status !== 'matched' || !match.product) {
        unmatchedItemNames.push(item.name);
        continue;
      }

      const product = match.product;
      const canonicalProductId = resolveCanonicalProductId(product.id, aliasIndex) || product.id;
      const dedupeAlertKey = `${canonicalProductId}:${alertType}:${intervalDays || ''}`;
      if (existingKeys.has(dedupeAlertKey) || seenInBatch.has(dedupeAlertKey)) {
        skippedExistingCount++;
        continue;
      }

      const validOffers = offers
        .filter(o => this.evaluateOfferEligibility(o, product, canonicalProductId, aliasIndex, now).eligible)
        .sort((a, b) => a.price - b.price);

      const bestOffer = validOffers[0];
      const currentLowestPrice = bestOffer ? round2(bestOffer.price) : 0;
      const baseline = currentLowestPrice > 0 ? currentLowestPrice : (product.baseReferencePrice || 0);

      let targetPrice = baseline;
      if (alertType === 'below_target' && baseline > 0) {
        targetPrice = Math.max(0.1, round2(baseline * (1 - discountPct / 100)));
      } else if (targetPrice <= 0) {
        targetPrice = 0.01;
      }

      seenInBatch.add(dedupeAlertKey);
      createdAlerts.push({
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: canonicalProductId,
        productName: `${product.name}${product.brand ? ` (${product.brand})` : ''}`,
        targetPrice,
        currentLowestPrice,
        lowestStoreId: bestOffer?.storeId,
        createdAt: today,
        isActive: true,
        alertType,
        intervalDays,
        minDropPercent,
        cooldownHours,
        rearmState: 'armed',
        triggerCycle: 0,
        triggerHistory: [],
        sourceListId: list.id,
        lastEvaluatedPrice: currentLowestPrice > 0 ? currentLowestPrice : undefined
      });
    }

    return { createdAlerts, skippedExistingCount, unmatchedItemNames };
  }

  /**
   * Evaluează determinist și idempotent toate alertele active:
   * - exclusiv pe oferte/observații valide în RON și verificate prin PriceQualityClassifier
   * - respectă ciclu activ (`rearmState`), `cooldownHours`, `idempotencyKey`, `dedupeKey`
   * - reînarmează automat când prețul revine peste prag sau oferta declanșatoare expiră
   * - nu emite notificări duble și nu declanșează pentru alerte dezactivate (`isActive: false`)
   */
  static evaluateAlerts(params: {
    alerts: PriceAlert[];
    offers: ProductOffer[];
    products?: Product[];
    observations?: PriceObservation[];
    stores?: Store[];
    existingNotifications?: InAppPriceNotification[];
    aliasMap?: CanonicalAliasSource;
    now?: Date;
  }): {
    updatedAlerts: PriceAlert[];
    newNotifications: InAppPriceNotification[];
  } {
    const now = params.now ?? new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();
    const stores = params.stores ?? STORES;
    const productsList = params.products ?? [];
    const productsById = new Map(productsList.map(p => [p.id, p]));
    const aliasIndex = buildCanonicalAliasIndex(params.aliasMap ?? productsList);
    const rawObservations = params.observations ?? [];
    const existingNotifications = params.existingNotifications ?? [];

    const existingDedupeKeys = new Set(existingNotifications.map(n => n.dedupeKey));
    const existingIdempotencyKeys = new Set(
      existingNotifications.map(n => n.idempotencyKey).filter((k): k is string => Boolean(k))
    );
    const newNotifications: InAppPriceNotification[] = [];
    const updatedAlerts: PriceAlert[] = [];

    for (const rawAlert of params.alerts) {
      const alertDetail = resolveCanonicalProductDetail(rawAlert.productId, aliasIndex);
      if (alertDetail.cycleDetected || (alertDetail.wasAlias && !alertDetail.found)) {
        updatedAlerts.push({
          ...rawAlert,
          lastSkippedReasonRo: 'Identificator de produs invalid (ciclu canonic sau alias orfan).'
        });
        continue;
      }

      const canonicalProductId =
        alertDetail.found && alertDetail.canonicalId ? alertDetail.canonicalId : rawAlert.productId;
      const alert: PriceAlert =
        canonicalProductId !== rawAlert.productId
          ? { ...rawAlert, productId: canonicalProductId }
          : rawAlert;

      if (!alert.isActive) {
        // Alertele dezactivate nu declanșează evaluări sau notificări
        updatedAlerts.push(alert);
        continue;
      }

      const alertType: PriceAlertType = alert.alertType || 'below_target';
      const cooldownHours =
        alert.cooldownHours !== undefined && alert.cooldownHours >= 0
          ? alert.cooldownHours
          : this.getDefaultCooldownHours(alertType);
      const effectiveMinDropPct =
        alert.minDropPercent !== undefined && alert.minDropPercent > 0
          ? alert.minDropPercent
          : this.getDefaultMinDropPercent(alertType);

      const matchedProduct = productsById.get(canonicalProductId) || productsById.get(rawAlert.productId);

      // Colectăm observațiile canonice validate prin PriceQualityClassifier pentru baseline / interval_low
      const productRawObs = rawObservations.filter(o => {
        const obsDetail = resolveCanonicalProductDetail(o.productId, aliasIndex);
        if (obsDetail.cycleDetected || (obsDetail.wasAlias && !obsDetail.found)) return false;
        const obsCanonId = obsDetail.found && obsDetail.canonicalId ? obsDetail.canonicalId : o.productId;
        return obsCanonId === canonicalProductId;
      });

      const obsQualityBatch =
        productRawObs.length > 0
          ? PriceQualityClassifier.classifyObservationBatch(productRawObs, {
              product: matchedProduct,
              expectedProductId: canonicalProductId,
              aliasSource: aliasIndex,
              now
            })
          : null;

      const usableObservations = productRawObs.filter((obs, idx) => {
        if (!obsQualityBatch) return false;
        const key = obs.id || `obs-${idx}`;
        const assessment = obsQualityBatch.assessmentsById[key];
        return Boolean(assessment?.isUsableForComparison);
      });

      const baselineForAnomaly = obsQualityBatch?.baselineUsed ?? matchedProduct?.baseReferencePrice ?? null;

      // Evaluăm eligibilitatea ofertelor canonice asociate produsului
      const candidateOffers: Array<{
        offer: ProductOffer;
        check: EligibleOfferCheckResult;
      }> = [];
      let firstRejectionReason: string | undefined;

      for (const offer of params.offers) {
        const offerDetail = resolveCanonicalProductDetail(offer.productId, aliasIndex);
        if (offerDetail.cycleDetected || (offerDetail.wasAlias && !offerDetail.found)) continue;
        const offerCanonId = offerDetail.found && offerDetail.canonicalId ? offerDetail.canonicalId : offer.productId;
        if (offerCanonId !== canonicalProductId) continue;

        const check = this.evaluateOfferEligibility(
          offer,
          matchedProduct,
          canonicalProductId,
          aliasIndex,
          now,
          baselineForAnomaly
        );
        if (check.eligible) {
          candidateOffers.push({ offer, check });
        } else if (!firstRejectionReason && check.reasonRo) {
          firstRejectionReason = check.reasonRo;
        }
      }

      candidateOffers.sort((a, b) => a.offer.price - b.offer.price);

      if (candidateOffers.length === 0) {
        // Dacă oferta declanșatoare anterioară a expirat / a dispărut, reînarmăm alerta curat
        if (alert.rearmState === 'triggered_locked') {
          const skipMsg = firstRejectionReason || 'Oferta declanșatoare a expirat sau nu mai este eligibilă.';
          updatedAlerts.push({
            ...alert,
            rearmState: 'armed',
            lastRearmedAt: nowIso,
            lastSkippedReasonRo: skipMsg,
            triggerHistory: appendTriggerHistory(
              alert.triggerHistory,
              buildTriggerEvent({
                alertId: alert.id,
                productId: canonicalProductId,
                alertType,
                outcome: 'rearmed_offer_expired',
                observedPrice: alert.currentLowestPrice || 0,
                previousPrice: alert.lastTriggeredPrice,
                storeId: alert.lowestStoreId,
                reasonRo: `Alertă reînarmată automat: ${skipMsg}`,
                evaluatedAt: nowIso
              })
            )
          });
        } else {
          updatedAlerts.push({
            ...alert,
            lastSkippedReasonRo: firstRejectionReason || 'Nicio ofertă verificată eligibilă în catalog.'
          });
        }
        continue;
      }

      const bestCandidate = candidateOffers[0];
      const bestOffer = bestCandidate.offer;
      const bestAssessment = bestCandidate.check.assessment!;
      const currentPrice = round2(bestOffer.price);
      const storeName = findStoreName(bestOffer.storeId, stores);

      // Pregătim statisticile de interval dacă tipul este interval_low
      const intervalDays: PriceHistoryInterval = alert.intervalDays || 90;
      const intervalStats =
        alertType === 'interval_low'
          ? PriceHistoryService.computeIntervalStats(
              usableObservations.map(o => ({
                date: o.date,
                price: o.price,
                storeId: o.storeId,
                storeName: findStoreName(o.storeId, stores),
                source: o.source,
                sourceType: o.source
              })),
              intervalDays,
              now
            )
          : null;

      // PASUL A: Verificare reînarmare automată dacă alerta era blocată în ciclul anterior
      let workingAlert: PriceAlert = {
        ...alert,
        rearmState: alert.rearmState || 'armed',
        triggerCycle: alert.triggerCycle || 0,
        cooldownHours
      };

      if (workingAlert.rearmState === 'triggered_locked') {
        const lastTrigPrice = workingAlert.lastTriggeredPrice ?? workingAlert.targetPrice;
        const previousSourceStillEligible = workingAlert.lastSourceOfferId
          ? candidateOffers.some(c => c.offer.id === workingAlert.lastSourceOfferId)
          : true;

        let rearmedOutcome: 'rearmed_price_recovered' | 'rearmed_offer_expired' | null = null;
        let rearmReasonRo = '';

        if (alertType === 'below_target' && workingAlert.targetPrice > 0 && currentPrice > workingAlert.targetPrice + 0.009) {
          rearmedOutcome = 'rearmed_price_recovered';
          rearmReasonRo = `Prețul curent (${currentPrice.toFixed(2)} lei la ${storeName}) a revenit peste pragul de ${workingAlert.targetPrice.toFixed(2)} lei.`;
        } else if (
          alertType === 'interval_low' &&
          intervalStats?.minPrice != null &&
          currentPrice > intervalStats.minPrice + 0.009
        ) {
          rearmedOutcome = 'rearmed_price_recovered';
          rearmReasonRo = `Prețul curent (${currentPrice.toFixed(2)} lei) a urcat peste minimul observat în ultimele ${intervalDays} zile (${intervalStats.minPrice.toFixed(2)} lei).`;
        } else if (
          (alertType === 'any_drop' || alertType === 'product_watch') &&
          lastTrigPrice > 0 &&
          currentPrice > lastTrigPrice + 0.009
        ) {
          rearmedOutcome = 'rearmed_price_recovered';
          rearmReasonRo = `Prețul curent (${currentPrice.toFixed(2)} lei) a urcat față de ultimul preț declanșat (${lastTrigPrice.toFixed(2)} lei).`;
        } else if (!previousSourceStillEligible && currentPrice > lastTrigPrice + 0.009) {
          rearmedOutcome = 'rearmed_offer_expired';
          rearmReasonRo = `Oferta anterioară (${workingAlert.lastSourceOfferId}) a expirat, iar prețul actual este ${currentPrice.toFixed(2)} lei.`;
        }

        if (rearmedOutcome) {
          workingAlert = {
            ...workingAlert,
            rearmState: 'armed',
            lastRearmedAt: nowIso,
            triggerHistory: appendTriggerHistory(
              workingAlert.triggerHistory,
              buildTriggerEvent({
                alertId: workingAlert.id,
                productId: canonicalProductId,
                alertType,
                outcome: rearmedOutcome,
                observedPrice: currentPrice,
                previousPrice: lastTrigPrice,
                storeId: bestOffer.storeId,
                storeName,
                sourceOfferId: bestOffer.id,
                qualityStatus: bestAssessment.status,
                reasonRo: rearmReasonRo,
                evaluatedAt: nowIso
              })
            )
          };
        }
      }

      // PASUL B: Evaluare condiție specifică fiecărui tip de alertă
      let shouldTrigger = false;
      let title = '';
      let message = '';
      let reasonRo = '';
      let skippedReasonRo: string | undefined;
      let previousPrice: number | undefined;
      let effectiveTarget: number | undefined = workingAlert.targetPrice;
      let observedIntervalDays: PriceHistoryInterval | undefined;
      let observedObservationsCount: number | undefined;

      if (alertType === 'below_target') {
        if (workingAlert.targetPrice > 0 && currentPrice <= workingAlert.targetPrice) {
          shouldTrigger = true;
          title = `Preț sub prag pentru ${workingAlert.productName}`;
          reasonRo = `${currentPrice.toFixed(2)} lei la ${storeName} atinge pragul țintă (${workingAlert.targetPrice.toFixed(2)} lei), sursă ${bestAssessment.labelRo.toLowerCase()}.`;
          message = `${currentPrice.toFixed(2)} lei la ${storeName} (prag țintă: ${workingAlert.targetPrice.toFixed(2)} lei · ${bestAssessment.labelRo}).`;
        } else if (workingAlert.targetPrice > 0) {
          skippedReasonRo = `Prețul curent (${currentPrice.toFixed(2)} lei) este peste pragul țintă (${workingAlert.targetPrice.toFixed(2)} lei).`;
        }
      } else if (alertType === 'any_drop' || alertType === 'product_watch') {
        // Strict: NEVER fall back to unverified targetPrice!
        const refPrice =
          workingAlert.lastEvaluatedPrice && workingAlert.lastEvaluatedPrice > 0
            ? workingAlert.lastEvaluatedPrice
            : workingAlert.currentLowestPrice > 0
              ? workingAlert.currentLowestPrice
              : workingAlert.lastTriggeredPrice && workingAlert.lastTriggeredPrice > 0
                ? workingAlert.lastTriggeredPrice
                : 0;

        if (refPrice > 0 && currentPrice < refPrice - 0.009) {
          const dropPct = Math.round(((refPrice - currentPrice) / refPrice) * 1000) / 10;
          if (dropPct >= effectiveMinDropPct) {
            shouldTrigger = true;
            previousPrice = refPrice;
            effectiveTarget = refPrice;
            if (alertType === 'product_watch') {
              title = `Scădere relevantă pentru ${workingAlert.productName}`;
              reasonRo = `Preț urmărit scăzut cu -${dropPct}%: ${currentPrice.toFixed(2)} lei la ${storeName} față de reperul verificat anterior ${refPrice.toFixed(2)} lei (${bestAssessment.labelRo}).`;
              message = `Prețul a scăzut la ${currentPrice.toFixed(2)} lei la ${storeName} (-${dropPct}% față de ${refPrice.toFixed(2)} lei · ${bestAssessment.labelRo}).`;
            } else {
              title = `Reducere detectată la ${workingAlert.productName}`;
              reasonRo = `Scădere verificată de -${dropPct}% (prag minim ${effectiveMinDropPct}%): ${currentPrice.toFixed(2)} lei la ${storeName} față de ${refPrice.toFixed(2)} lei.`;
              message = `Prețul a scăzut la ${currentPrice.toFixed(2)} lei la ${storeName} (-${dropPct}% față de ${refPrice.toFixed(2)} lei).`;
            }
          } else {
            skippedReasonRo = `Scădere minoră (-${dropPct}%) sub pragul configurat de ${effectiveMinDropPct}%.`;
          }
        } else if (refPrice <= 0) {
          skippedReasonRo = 'Se stabilește reperul inițial verificat de preț.';
        } else {
          skippedReasonRo = `Fără scădere față de ultimul preț verificat (${refPrice.toFixed(2)} lei).`;
        }
      } else if (alertType === 'interval_low' && intervalStats) {
        observedIntervalDays = intervalDays;
        observedObservationsCount = intervalStats.observationsCount;
        if (intervalStats.observationsCount >= 1 && intervalStats.minPrice !== null) {
          if (currentPrice <= intervalStats.minPrice) {
            shouldTrigger = true;
            effectiveTarget = intervalStats.minPrice;
            title = `Minim din ultimele ${intervalDays} zile: ${workingAlert.productName}`;
            reasonRo = `${currentPrice.toFixed(2)} lei la ${storeName} egalează sau coboară sub minimul observat în ultimele ${intervalDays} zile (${intervalStats.minPrice.toFixed(2)} lei din ${intervalStats.observationsCount} observații verificate).`;
            message = `${currentPrice.toFixed(2)} lei la ${storeName} egalează sau coboară sub minimul observat în ultimele ${intervalDays} zile (${intervalStats.minPrice.toFixed(2)} lei · ${intervalStats.observationsCount} observații verificate).`;
          } else {
            skippedReasonRo = `Prețul curent (${currentPrice.toFixed(2)} lei) este peste minimul din ultimele ${intervalDays} zile (${intervalStats.minPrice.toFixed(2)} lei din ${intervalStats.observationsCount} observații).`;
          }
        } else {
          skippedReasonRo = `Nu există observații istorice verificate în ultimele ${intervalDays} zile.`;
        }
      }

      // PASUL C: Guard-uri deterministe de idempotență, lock pe ciclu și cooldown
      if (shouldTrigger) {
        const isStillLocked = workingAlert.rearmState === 'triggered_locked';
        const prevTriggeredPrice = workingAlert.lastTriggeredPrice ?? currentPrice;
        const isStrictlyDeeperDrop = currentPrice < prevTriggeredPrice - 0.009;

        const obsDateMarker =
          bestOffer.observationDate ||
          (bestOffer.lastVerifiedAt || bestOffer.lastChecked || '').slice(0, 10) ||
          'current';
        const offerRef = bestOffer.id || bestOffer.storeId;
        const nextCycle = (workingAlert.triggerCycle || 0) + 1;
        const dedupeKey = `${workingAlert.id}:c${nextCycle}:${alertType}:${offerRef}:${bestOffer.storeId}:${obsDateMarker}:${currentPrice.toFixed(2)}`;
        const idempotencyKey = `${workingAlert.id}:c${nextCycle}:${alertType}:${canonicalProductId}:${bestOffer.storeId}:${currentPrice.toFixed(2)}`;

        const duplicateHit =
          workingAlert.lastNotifiedKey === dedupeKey ||
          existingDedupeKeys.has(dedupeKey) ||
          existingIdempotencyKeys.has(idempotencyKey);

        const lastTriggerMs = workingAlert.lastTriggeredAt ? Date.parse(workingAlert.lastTriggeredAt) : NaN;
        const elapsedHours = Number.isFinite(lastTriggerMs) ? (nowMs - lastTriggerMs) / MS_PER_HOUR : Infinity;
        const inCooldown = cooldownHours > 0 && Number.isFinite(lastTriggerMs) && elapsedHours < cooldownHours;

        let blockedOutcome: PriceAlertEvaluationOutcome | null = null;
        let blockedReason = '';

        if (duplicateHit) {
          blockedOutcome = 'skipped_duplicate';
          blockedReason = 'Aceeași ofertă și același preț au produs deja o notificare.';
        } else if (isStillLocked && !isStrictlyDeeperDrop) {
          blockedOutcome = 'skipped_cycle_locked';
          blockedReason = `Alertă deja declanșată în ciclul curent la ${prevTriggeredPrice.toFixed(2)} lei; așteaptă revenirea prețului sau o scădere suplimentară.`;
        } else if (inCooldown) {
          const remainingHours = Math.max(1, Math.ceil(cooldownHours - elapsedHours));
          blockedOutcome = 'skipped_cooldown';
          blockedReason = `Fereastră anti-spam activă (${cooldownHours}h · ~${remainingHours}h rămase de la ultima notificare).`;
        }

        if (blockedOutcome) {
          updatedAlerts.push({
            ...workingAlert,
            currentLowestPrice: currentPrice,
            lowestStoreId: bestOffer.storeId,
            lastEvaluatedPrice: currentPrice,
            lastSkippedReasonRo: blockedReason
          });
          continue;
        }

        const newCycle = nextCycle;
        const finalIdempotencyKey = idempotencyKey;

        existingDedupeKeys.add(dedupeKey);
        existingIdempotencyKeys.add(finalIdempotencyKey);

        newNotifications.push({
          id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          alertId: workingAlert.id,
          dedupeKey,
          idempotencyKey: finalIdempotencyKey,
          productId: workingAlert.productId,
          productName: workingAlert.productName,
          alertType,
          title,
          message,
          reasonRo,
          observedPrice: currentPrice,
          previousPrice,
          targetPrice: effectiveTarget,
          storeId: bestOffer.storeId,
          storeName,
          sourceOfferId: bestOffer.id,
          qualityStatus: bestAssessment.status,
          qualityLabelRo: bestAssessment.labelRo,
          observedIntervalDays,
          observedObservationsCount,
          triggerCycle: newCycle,
          triggeredAt: nowIso,
          isRead: false
        });

        const triggerEvent = buildTriggerEvent({
          alertId: workingAlert.id,
          productId: canonicalProductId,
          alertType,
          outcome: 'triggered',
          observedPrice: currentPrice,
          targetPrice: effectiveTarget,
          previousPrice,
          storeId: bestOffer.storeId,
          storeName,
          sourceOfferId: bestOffer.id,
          qualityStatus: bestAssessment.status,
          idempotencyKey: finalIdempotencyKey,
          reasonRo,
          evaluatedAt: nowIso
        });

        updatedAlerts.push({
          ...workingAlert,
          currentLowestPrice: currentPrice,
          lowestStoreId: bestOffer.storeId,
          lastEvaluatedPrice: currentPrice,
          lastTriggeredAt: nowIso,
          lastTriggeredPrice: currentPrice,
          lastNotifiedKey: dedupeKey,
          rearmState: 'triggered_locked' as PriceAlertRearmState,
          triggerCycle: newCycle,
          lastTriggerReasonRo: reasonRo,
          lastSourceOfferId: bestOffer.id,
          lastSourceQualityStatus: bestAssessment.status,
          lastSkippedReasonRo: undefined,
          triggerHistory: appendTriggerHistory(workingAlert.triggerHistory, triggerEvent)
        });
      } else {
        // Nu s-a declanșat: actualizăm atent reperul verificat
        let nextEvaluatedPrice = currentPrice;
        if (alertType === 'any_drop' || alertType === 'product_watch') {
          const prevRef = workingAlert.lastEvaluatedPrice;
          if (!prevRef || prevRef <= 0) {
            nextEvaluatedPrice = currentPrice;
          } else if (currentPrice > prevRef) {
            // Prețul a crescut -> noul maxim verificat devine reperul de comparație pentru viitoare scăderi
            nextEvaluatedPrice = currentPrice;
          } else {
            // Scădere minoră sub minDropPercent -> păstrăm reperul anterior ca scăderile treptate să nu ocolească pragul
            nextEvaluatedPrice = prevRef;
          }
        } else {
          nextEvaluatedPrice = workingAlert.lastEvaluatedPrice ?? currentPrice;
        }

        updatedAlerts.push({
          ...workingAlert,
          currentLowestPrice: currentPrice,
          lowestStoreId: bestOffer.storeId,
          lastEvaluatedPrice: nextEvaluatedPrice,
          lastSkippedReasonRo: skippedReasonRo
        });
      }
    }

    return { updatedAlerts, newNotifications };
  }
}
