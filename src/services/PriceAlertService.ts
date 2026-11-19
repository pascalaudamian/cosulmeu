import {
  InAppPriceNotification,
  PriceAlert,
  PriceAlertType,
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

const NOTIFICATIONS_STORAGE_KEY = 'cosulmeu_in_app_price_notifications_v1';

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
        return 'Orice reducere de preț';
      case 'interval_low':
        return `Minim istoric (${intervalDays || 90} zile)`;
      case 'below_target':
      default:
        return 'Preț sub prag';
    }
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
      discountPercentForTarget?: number; // ex: 10 => prag cu 10% sub cel mai mic preț curent
    }
  ): {
    createdAlerts: PriceAlert[];
    skippedExistingCount: number;
    unmatchedItemNames: string[];
  } {
    const alertType: PriceAlertType = options?.alertType || 'below_target';
    const intervalDays: PriceHistoryInterval | undefined =
      alertType === 'interval_low' ? (options?.intervalDays || 90) : undefined;
    const discountPct = options?.discountPercentForTarget ?? 10;

    const existingKeys = new Set(
      existingAlerts.map(a => `${a.productId}:${a.alertType || 'below_target'}:${a.intervalDays || ''}`)
    );
    const seenInBatch = new Set<string>();
    const createdAlerts: PriceAlert[] = [];
    const unmatchedItemNames: string[] = [];
    let skippedExistingCount = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const item of list.items) {
      const match = BasketOptimizerService.matchItemToProduct(item, products);
      if (match.status !== 'matched' || !match.product) {
        unmatchedItemNames.push(item.name);
        continue;
      }

      const product = match.product;
      const dedupeAlertKey = `${product.id}:${alertType}:${intervalDays || ''}`;
      if (existingKeys.has(dedupeAlertKey) || seenInBatch.has(dedupeAlertKey)) {
        skippedExistingCount++;
        continue;
      }

      const validOffers = offers
        .filter(o => o.productId === product.id && PriceComparisonService.isOfferValid(o, product))
        .sort((a, b) => a.price - b.price);

      const bestOffer = validOffers[0];
      const currentLowestPrice = bestOffer ? bestOffer.price : 0;
      const baseline = currentLowestPrice > 0 ? currentLowestPrice : (product.baseReferencePrice || 0);

      let targetPrice = baseline;
      if (alertType === 'below_target' && baseline > 0) {
        targetPrice = Math.max(0.1, Math.round(baseline * (1 - discountPct / 100) * 100) / 100);
      } else if (targetPrice <= 0) {
        targetPrice = 0.01;
      }

      seenInBatch.add(dedupeAlertKey);
      createdAlerts.push({
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        productId: product.id,
        productName: `${product.name}${product.brand ? ` (${product.brand})` : ''}`,
        targetPrice,
        currentLowestPrice,
        lowestStoreId: bestOffer?.storeId,
        createdAt: today,
        isActive: true,
        alertType,
        intervalDays,
        sourceListId: list.id,
        lastEvaluatedPrice: currentLowestPrice > 0 ? currentLowestPrice : undefined
      });
    }

    return { createdAlerts, skippedExistingCount, unmatchedItemNames };
  }

  /**
   * Evaluează idempotent toate alertele active și generează notificări în aplicație fără duplicate.
   * Alertele dezactivate (`isActive: false`) sunt ignorate complet.
   * Deduplicarea folosește amprenta exactă a observației (offer/obsDate/store/preț) pentru a nu re-declanșa
   * aceeași observație chiar dacă evaluarea rulează în zile diferite.
   */
  static evaluateAlerts(params: {
    alerts: PriceAlert[];
    offers: ProductOffer[];
    products?: Product[];
    observations?: PriceObservation[];
    stores?: Store[];
    existingNotifications?: InAppPriceNotification[];
    now?: Date;
  }): {
    updatedAlerts: PriceAlert[];
    newNotifications: InAppPriceNotification[];
  } {
    const now = params.now ?? new Date();
    const nowIso = now.toISOString();
    const stores = params.stores ?? STORES;
    const productsById = new Map((params.products ?? []).map(p => [p.id, p]));
    const observations = (params.observations ?? []).filter(
      obs =>
        Number.isFinite(obs.price) &&
        obs.price > 0 &&
        obs.source !== 'demo' &&
        obs.source !== 'estimated'
    );
    const existingNotifications = params.existingNotifications ?? [];

    const existingDedupeKeys = new Set(existingNotifications.map(n => n.dedupeKey));
    const newNotifications: InAppPriceNotification[] = [];
    const updatedAlerts: PriceAlert[] = [];

    for (const alert of params.alerts) {
      if (!alert.isActive) {
        // Alertele dezactivate nu declanșează evaluări sau notificări
        updatedAlerts.push(alert);
        continue;
      }

      const alertType: PriceAlertType = alert.alertType || 'below_target';
      const matchedProduct = productsById.get(alert.productId);
      const validOffers = params.offers
        .filter(
          o =>
            o.productId === alert.productId &&
            PriceComparisonService.isOfferValid(o, matchedProduct)
        )
        .sort((a, b) => a.price - b.price);

      if (validOffers.length === 0) {
        updatedAlerts.push(alert);
        continue;
      }

      const bestOffer = validOffers[0];
      const currentPrice = Math.round(bestOffer.price * 100) / 100;
      const storeName = findStoreName(bestOffer.storeId, stores);

      let shouldTrigger = false;
      let title = '';
      let message = '';
      let previousPrice: number | undefined;
      let effectiveTarget: number | undefined = alert.targetPrice;

      if (alertType === 'below_target') {
        if (alert.targetPrice > 0 && currentPrice <= alert.targetPrice) {
          shouldTrigger = true;
          title = `Preț sub prag pentru ${alert.productName}`;
          message = `${currentPrice.toFixed(2)} lei la ${storeName} (prag țintă: ${alert.targetPrice.toFixed(2)} lei).`;
        }
      } else if (alertType === 'any_drop') {
        const refPrice =
          alert.lastEvaluatedPrice && alert.lastEvaluatedPrice > 0
            ? alert.lastEvaluatedPrice
            : alert.currentLowestPrice > 0
              ? alert.currentLowestPrice
              : alert.targetPrice;
        if (refPrice > 0 && currentPrice < refPrice - 0.009) {
          shouldTrigger = true;
          previousPrice = refPrice;
          effectiveTarget = refPrice;
          const dropPct = Math.round(((refPrice - currentPrice) / refPrice) * 1000) / 10;
          title = `Reducere detectată la ${alert.productName}`;
          message = `Prețul a scăzut la ${currentPrice.toFixed(2)} lei la ${storeName} (-${dropPct}% față de ${refPrice.toFixed(2)} lei).`;
        }
      } else if (alertType === 'interval_low') {
        const intervalDays: PriceHistoryInterval = alert.intervalDays || 90;
        const productObs = observations.filter(o => o.productId === alert.productId);
        const timeline = productObs.map(o => ({
          date: o.date,
          price: o.price,
          storeId: o.storeId,
          storeName: findStoreName(o.storeId, stores),
          source: o.source,
          sourceType: o.source
        }));
        const intervalStats = PriceHistoryService.computeIntervalStats(timeline, intervalDays, now);
        if (intervalStats.observationsCount >= 1 && intervalStats.minPrice !== null && currentPrice <= intervalStats.minPrice) {
          shouldTrigger = true;
          effectiveTarget = intervalStats.minPrice;
          title = `Minim din ultimele ${intervalDays} zile: ${alert.productName}`;
          message = `${currentPrice.toFixed(2)} lei la ${storeName} egalează sau coboară sub minimul observat în ultimele ${intervalDays} zile (${intervalStats.minPrice.toFixed(2)} lei).`;
        }
      }

      if (shouldTrigger) {
        const obsDateMarker =
          bestOffer.observationDate ||
          (bestOffer.lastVerifiedAt || bestOffer.lastChecked || '').slice(0, 10) ||
          'current';
        const offerRef = bestOffer.id || bestOffer.storeId;
        const dedupeKey = `${alert.id}:${alertType}:${offerRef}:${bestOffer.storeId}:${obsDateMarker}:${currentPrice.toFixed(2)}`;
        const alreadyNotified =
          alert.lastNotifiedKey === dedupeKey || existingDedupeKeys.has(dedupeKey);

        if (!alreadyNotified) {
          existingDedupeKeys.add(dedupeKey);
          newNotifications.push({
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            alertId: alert.id,
            dedupeKey,
            productId: alert.productId,
            productName: alert.productName,
            alertType,
            title,
            message,
            observedPrice: currentPrice,
            previousPrice,
            targetPrice: effectiveTarget,
            storeId: bestOffer.storeId,
            storeName,
            triggeredAt: nowIso,
            isRead: false
          });
        }

        updatedAlerts.push({
          ...alert,
          currentLowestPrice: currentPrice,
          lowestStoreId: bestOffer.storeId,
          lastEvaluatedPrice: currentPrice,
          lastTriggeredAt: alreadyNotified ? alert.lastTriggeredAt : nowIso,
          lastTriggeredPrice: alreadyNotified ? alert.lastTriggeredPrice : currentPrice,
          lastNotifiedKey: dedupeKey
        });
      } else {
        updatedAlerts.push({
          ...alert,
          currentLowestPrice: currentPrice,
          lowestStoreId: bestOffer.storeId,
          lastEvaluatedPrice:
            alertType === 'any_drop' && (!alert.lastEvaluatedPrice || currentPrice < alert.lastEvaluatedPrice)
              ? currentPrice
              : alert.lastEvaluatedPrice ?? currentPrice
        });
      }
    }

    return { updatedAlerts, newNotifications };
  }
}
