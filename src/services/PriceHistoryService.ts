import { PriceObservation, Product } from '../types';
import { StorageService } from './StorageService';
import { PRODUCT_OFFERS, STORES } from '../data/mockData';

export interface ProductPriceStats {
  productId: string;
  currentLowestPrice: number;
  currentLowestStoreName: string;
  minRecordedPrice: number;
  maxRecordedPrice: number;
  averagePrice: number;
  lastPaidPrice?: number;
  lastPaidStoreName?: string;
  trendPercentage: number; // e.g. -5.2 (%)
  observationsCount: number;
  historyPoints: { date: string; price: number; storeName: string; source: string }[];
}

export class PriceHistoryService {
  /**
   * Get price history stats and observation timeline for a specific product
   */
  static getProductPriceStats(productId: string): ProductPriceStats {
    const observations = StorageService.getPriceObservations().filter(
      obs => obs.productId === productId
    );

    // Current valid offers from dynamic storage
    const currentOffers = StorageService.getProductOffers().filter(
      o => o.productId === productId && (o.verificationStatus !== 'expired' && (!o.validUntil || o.validUntil >= new Date().toISOString().split('T')[0]))
    );
    let currentLowestPrice = Infinity;
    let currentLowestStoreName = '-';

    for (const off of currentOffers) {
      if (off.price < currentLowestPrice) {
        currentLowestPrice = off.price;
        const st = STORES.find(s => s.id === off.storeId);
        currentLowestStoreName = st ? st.name : off.storeId;
      }
    }

    if (currentLowestPrice === Infinity) {
      currentLowestPrice = 0;
    }

    // Combine observation points with current offers if no observations exist yet
    const timeline: { date: string; price: number; storeName: string; source: string }[] = [];

    // Sort observations chronologically
    const sortedObs = [...observations].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    for (const obs of sortedObs) {
      const st = STORES.find(s => s.id === obs.storeId);
      timeline.push({
        date: obs.date,
        price: obs.price,
        storeName: st ? st.name : obs.storeId,
        source: obs.source === 'verified' ? 'Bon fiscal confirmat' : 'Ofertă magazin'
      });
    }

    // If current lowest offer isn't in timeline, append today
    if (currentLowestPrice > 0) {
      timeline.push({
        date: new Date().toISOString().split('T')[0],
        price: currentLowestPrice,
        storeName: currentLowestStoreName,
        source: 'Ofertă curentă'
      });
    }

    // Find min, max, avg
    const allPrices = timeline.map(t => t.price).filter(p => p > 0);
    const minRecordedPrice = allPrices.length > 0 ? Math.min(...allPrices) : currentLowestPrice;
    const maxRecordedPrice = allPrices.length > 0 ? Math.max(...allPrices) : currentLowestPrice;
    const averagePrice = allPrices.length > 0
      ? Math.round((allPrices.reduce((a, b) => a + b, 0) / allPrices.length) * 100) / 100
      : currentLowestPrice;

    // Check last paid from user's confirmed receipts
    const receipts = StorageService.getReceipts();
    let lastPaidPrice: number | undefined;
    let lastPaidStoreName: string | undefined;

    for (const rec of receipts) {
      const match = rec.items.find(i => i.matchedProductId === productId);
      if (match) {
        lastPaidPrice = match.unitPrice;
        lastPaidStoreName = rec.storeName;
        break; // receipts are ordered latest first
      }
    }

    // Calculate trend percentage (first observed price vs latest)
    let trendPercentage = 0;
    if (timeline.length >= 2) {
      const firstPrice = timeline[0].price;
      const latestPrice = timeline[timeline.length - 1].price;
      if (firstPrice > 0) {
        trendPercentage = Math.round(((latestPrice - firstPrice) / firstPrice) * 1000) / 10;
      }
    }

    return {
      productId,
      currentLowestPrice: currentLowestPrice === Infinity ? 0 : currentLowestPrice,
      currentLowestStoreName,
      minRecordedPrice,
      maxRecordedPrice,
      averagePrice,
      lastPaidPrice,
      lastPaidStoreName,
      trendPercentage,
      observationsCount: timeline.length,
      historyPoints: timeline
    };
  }

  /**
   * Filter history points by timeframe in days (30, 90, 365)
   */
  static filterPointsByDays(
    points: { date: string; price: number; storeName: string; source: string }[],
    days: number
  ) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const filtered = points.filter(p => new Date(p.date) >= cutoffDate);
    // If fewer than 2 points in window, include all points so chart displays nicely
    return filtered.length >= 2 ? filtered : points;
  }
}
