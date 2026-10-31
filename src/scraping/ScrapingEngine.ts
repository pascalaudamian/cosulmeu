// src/scraping/ScrapingEngine.ts
// Motor de Web Scraping Politicos și Țintit pentru Retailerii din România
// Folosește Cheerio pentru HTML static și o abstracție Playwright pentru pagini dinamice

import * as cheerio from 'cheerio';
import { ScrapedProductCandidate, PromotionRecord } from '../indexing/types';
import { UnitType } from '../types';

export interface ScrapingRequestOptions {
  retailerId: string;
  url?: string;
  query?: string;
  htmlContent?: string;
  timeoutMs?: number;
  useDynamicEngine?: boolean; // Activează driverul dinamic Playwright
}

export interface ScrapingRateLimitState {
  lastRequestTime: number;
  tokens: number;
  maxTokens: number;
  refillRatePerSec: number;
}

export interface DynamicBrowserDriver {
  renderPage(url: string, waitForSelector?: string): Promise<string>;
}

export class ScrapingEngine {
  private static rateLimiters: Map<string, ScrapingRateLimitState> = new Map();
  private static dynamicDriver: DynamicBrowserDriver | null = null;

  // Header rotativ politicos cu identificare transparentă și respect civic
  private static userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CosulMeuCivicBot/1.0 (+https://cosulmeu.ro/civic-data)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CosulMeuCivicBot/1.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CosulMeuCivicBot/1.0'
  ];

  /**
   * Configurează un driver dinamic extern (de exemplu Playwright headless browser)
   */
  static setDynamicDriver(driver: DynamicBrowserDriver | null) {
    this.dynamicDriver = driver;
  }

  /**
   * Rate limiting token bucket per retailer
   */
  static async throttleRetailer(retailerId: string, requestsPerMinute: number = 20): Promise<void> {
    const now = Date.now();
    let limiter = this.rateLimiters.get(retailerId);

    if (!limiter) {
      limiter = {
        lastRequestTime: now,
        tokens: requestsPerMinute,
        maxTokens: requestsPerMinute,
        refillRatePerSec: requestsPerMinute / 60
      };
      this.rateLimiters.set(retailerId, limiter);
    }

    const elapsedSeconds = (now - limiter.lastRequestTime) / 1000;
    limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + elapsedSeconds * limiter.refillRatePerSec);
    limiter.lastRequestTime = now;

    if (limiter.tokens < 1) {
      const waitMs = Math.ceil(((1 - limiter.tokens) / limiter.refillRatePerSec) * 1000);
      await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 5000)));
      limiter.tokens = 1;
    }

    limiter.tokens -= 1;
  }

  /**
   * Extrage numărul și unitatea de măsură dintr-un text
   */
  static parseQuantity(text: string): { weightOrVol: number; unit: UnitType } {
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc|pachet|tablete|capsule)/i);
    if (!match) {
      return { weightOrVol: 1, unit: 'buc' };
    }

    const rawNum = parseFloat(match[1].replace(',', '.'));
    const rawUnit = match[2].toLowerCase();

    switch (rawUnit) {
      case 'kg': return { weightOrVol: rawNum, unit: 'kg' };
      case 'g': return { weightOrVol: rawNum, unit: 'g' };
      case 'l': return { weightOrVol: rawNum, unit: 'l' };
      case 'ml': return { weightOrVol: rawNum, unit: 'ml' };
      case 'pachet': return { weightOrVol: rawNum, unit: 'pachet' };
      default: return { weightOrVol: rawNum, unit: 'buc' };
    }
  }

  /**
   * Normalizare preț numeric românesc (ex: "12,99 Lei" -> 12.99)
   */
  static parsePrice(raw: string | number | undefined): number {
    if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
    if (!raw) return 0;
    const cleaned = String(raw).replace(/[^\d.,]/g, '').replace(',', '.');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  /**
   * Parsare pagină statică prin Cheerio
   */
  static parseStaticHtml(html: string, retailerId: string, sourceUrl?: string): ScrapedProductCandidate[] {
    const $ = cheerio.load(html);
    const results: ScrapedProductCandidate[] = [];
    const collectedAt = new Date().toISOString();

    // 1. Încercare de parsare a metadatelor structurate JSON-LD (Schema.org / Product)
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const text = $(el).html();
        if (!text) return;
        const data = JSON.parse(text);
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type'] === 'IndividualProduct') {
            const rawName = item.name || '';
            const brand = typeof item.brand === 'object' ? item.brand?.name : item.brand;
            const barcode = item.gtin13 || item.gtin || item.sku;
            const offers = item.offers || {};
            const price = this.parsePrice(offers.price || offers.lowPrice);

            if (rawName && price > 0) {
              const { weightOrVol, unit } = this.parseQuantity(rawName);
              results.push({
                rawName,
                brand,
                barcode,
                normalPrice: price,
                packageWeightOrVolume: weightOrVol,
                packageUnit: unit,
                sourceUrl: sourceUrl || item.url,
                collectedAt
              });
            }
          }
        }
      } catch {
        // Ignorăm JSON-LD invalid
      }
    });

    if (results.length > 0) {
      return results;
    }

    // 2. Selectoare DOM euristice pentru supermarketurile din România
    const productCards = $('.product-card, .product-item, .tile, article, [data-product-id]');

    productCards.each((_, el) => {
      const card = $(el);

      // Titlu / Denumire
      const nameEl = card.find('.title, .product-name, h2, h3, .name, [data-qa="product-title"]').first();
      const rawName = nameEl.text().trim();
      if (!rawName) return;

      // Brand
      const brandEl = card.find('.brand, .manufacturer, [data-qa="product-brand"]').first();
      const brand = brandEl.text().trim() || undefined;

      // Prețuri
      const currentPriceEl = card.find('.price, .current-price, .promo-price, .valoare, [data-qa="price-current"]').first();
      const oldPriceEl = card.find('.old-price, .original-price, .cut-price, .pret-vechi, [data-qa="price-original"]').first();
      const loyaltyPriceEl = card.find('.loyalty-price, .card-price, .pret-card, [data-qa="price-loyalty"]').first();

      const currentPrice = this.parsePrice(currentPriceEl.text());
      const oldPrice = this.parsePrice(oldPriceEl.text());
      const loyaltyPrice = loyaltyPriceEl.length ? this.parsePrice(loyaltyPriceEl.text()) : undefined;

      if (currentPrice <= 0) return;

      // Carduri fidelitate specifice retailerilor
      let promoDescription: string | undefined = undefined;
      const promoBadge = card.find('.badge, .promo-label, .reducere, .discount-tag').first();
      if (promoBadge.length) {
        promoDescription = promoBadge.text().trim();
      }

      // Gramaj / Volum
      const { weightOrVol, unit } = this.parseQuantity(rawName);

      // EAN / SKU
      const barcode = card.attr('data-ean') || card.attr('data-sku') || undefined;

      results.push({
        rawName,
        brand,
        packageWeightOrVolume: weightOrVol,
        packageUnit: unit,
        barcode,
        normalPrice: oldPrice > currentPrice ? oldPrice : currentPrice,
        promoPrice: oldPrice > currentPrice ? currentPrice : undefined,
        loyaltyPrice: loyaltyPrice && loyaltyPrice > 0 ? loyaltyPrice : undefined,
        promoDescription,
        sourceUrl: sourceUrl || undefined,
        collectedAt
      });
    });

    return results;
  }

  /**
   * Căutare țintită de produse (Discover by Receipt Query)
   * NU parcurge întregul magazin, ci doar interoghează produsele cerute.
   */
  static async searchTargetedProduct(options: ScrapingRequestOptions): Promise<ScrapedProductCandidate[]> {
    await this.throttleRetailer(options.retailerId);

    // Dacă avem conținut HTML injectat (pentru teste sau feed-uri descărcate)
    if (options.htmlContent) {
      return this.parseStaticHtml(options.htmlContent, options.retailerId, options.url);
    }

    // Dacă avem driver dinamic și este solicitat
    if (options.useDynamicEngine && this.dynamicDriver && options.url) {
      try {
        const renderedHtml = await this.dynamicDriver.renderPage(options.url, '.product-item, .tile');
        return this.parseStaticHtml(renderedHtml, options.retailerId, options.url);
      } catch (err: any) {
        console.warn(`Dynamic rendering fallback for ${options.retailerId}:`, err.message);
      }
    }

    // În absența unui endpoint activ de rețea sau în mediu sandbox,
    // motorul furnizează rezultate doar dacă accesul este autorizat și specificat.
    return [];
  }

  /**
   * Extrage promoțiile active dintr-o pagină de oferte
   */
  static extractPromotions(html: string, retailerId: string, sourceUrl?: string): PromotionRecord[] {
    const candidates = this.parseStaticHtml(html, retailerId, sourceUrl);
    const nowIso = new Date().toISOString();

    return candidates
      .filter(c => (c.promoPrice && c.promoPrice > 0) || (c.loyaltyPrice && c.loyaltyPrice > 0) || Boolean(c.promoDescription))
      .map((c, idx) => ({
        id: `promo-${retailerId}-${Date.now()}-${idx}`,
        retailerId,
        barcode: c.barcode,
        brand: c.brand,
        title: c.rawName,
        description: c.promoDescription || 'Promoție catalog curent',
        normalPrice: c.normalPrice,
        promoPrice: c.promoPrice || c.normalPrice,
        loyaltyPrice: c.loyaltyPrice,
        loyaltyCardName: c.loyaltyPrice ? `${retailerId.toUpperCase()} Card` : undefined,
        startsAt: c.promoPeriod?.from,
        endsAt: c.promoPeriod?.until,
        sourceUrl: c.sourceUrl || sourceUrl,
        discoveredAt: nowIso
      }));
  }

}
