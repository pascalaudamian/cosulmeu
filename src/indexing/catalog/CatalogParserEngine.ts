// src/indexing/catalog/CatalogParserEngine.ts
// Motor unificat de parsare a cataloagelor (HTML, PDF, CSV, XML)

import * as cheerio from 'cheerio';
import { CatalogFormat } from './catalogTypes.js';
import { validatePublicHttpUrl } from '../../utils/urlSecurity.js';
import { PriceExtractor, PriceProofType } from './PriceExtractor.js';
import { normalizeBrand } from '../../services/ProductNormalizationService.js';

export interface RawParsedOffer {
  rawTitle: string;
  rawBrand?: string;
  rawBarcode?: string;
  retailerSku?: string;
  rawCategory?: string;
  normalPrice: number;
  promoPrice?: number;
  loyaltyPrice?: number;
  effectivePrice: number;
  currency: string;
  priceType?: 'standard' | 'promotional' | 'loyalty_card' | 'b2b_wholesale';
  discountPercentage?: number;
  packageQuantity?: number;
  packageUnit?: string;
  weight?: number;
  volume?: number;
  packageSize?: string;
  priceProofType?: PriceProofType;
  unitPrice?: number;
  unitPriceMeasure?: string;
  isPromo: boolean;
  promoDetails?: string;
  loyaltyCardName?: string;
  loyaltyCardRequired?: boolean;
  validFrom?: string;
  validUntil?: string;
  imageUrl?: string;
  catalogUrl?: string;
  sourcePageUrl?: string;
  storeOrRegion?: string;
  targetAudience?: 'general' | 'horeca' | 'traders';
  confidenceScore: number;
}

export interface RawCatalogProduct {
  rawTitle: string;
  rawBrand?: string;
  rawCategory?: string;
  rawBarcode?: string;
  packageQuantity?: number;
  packageUnit?: string;
  imageUrl?: string;
  confidenceScore: number;
}

export interface ParseResult {
  success: boolean;
  offers: RawParsedOffer[];
  products?: RawCatalogProduct[];
  totalExtracted: number;
  format: CatalogFormat;
  ocrConfidence?: number;
  error?: string;
  warnings?: string[];
}

export class CatalogParserEngine {
  /**
   * Parsează automat conținutul în funcție de format
   */
  static async parseCatalog(
    content: Buffer | string,
    format: CatalogFormat,
    retailerId?: string,
    baseUrl?: string
  ): Promise<ParseResult> {
    try {
      if (format === 'pdf') {
        const buffer = typeof content === 'string' ? Buffer.from(content) : content;
        const head = buffer.subarray(0, 512).toString('utf-8').trim().toLowerCase();
        if (!head.startsWith('%pdf') && (head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<body') || head.includes('<head'))) {
          return CatalogParserEngine.parseCatalog(buffer.toString('utf-8'), 'html', retailerId, baseUrl);
        }
        return await CatalogParserEngine.parsePdfCatalog(buffer);
      } else if (format === 'html') {
        const htmlText = typeof content === 'string' ? content : content.toString('utf-8');
        if (retailerId === 'carrefour') {
          const res = CatalogParserEngine.parseCarrefourCatalog(htmlText, baseUrl);
          return res.offers.length > 0 ? res : CatalogParserEngine.parseHtmlCatalog(htmlText, retailerId, baseUrl);
        } else if (retailerId === 'penny') {
          const res = CatalogParserEngine.parsePennyCatalog(htmlText, baseUrl);
          return res.offers.length > 0 ? res : CatalogParserEngine.parseHtmlCatalog(htmlText, retailerId, baseUrl);
        } else if (retailerId === 'mega-image') {
          const res = CatalogParserEngine.parseMegaImageCatalog(htmlText, baseUrl);
          return res.offers.length > 0 ? res : CatalogParserEngine.parseHtmlCatalog(htmlText, retailerId, baseUrl);
        } else if (retailerId === 'auchan') {
          const res = CatalogParserEngine.parseAuchanOnlineStore(htmlText, baseUrl);
          return res.offers.length > 0 ? res : CatalogParserEngine.parseHtmlCatalog(htmlText, retailerId, baseUrl);
        }
        return CatalogParserEngine.parseHtmlCatalog(htmlText, retailerId, baseUrl);
      } else if (format === 'csv') {
        const csvText = typeof content === 'string' ? content : content.toString('utf-8');
        return CatalogParserEngine.parseCsvCatalog(csvText, baseUrl);
      } else if (format === 'xml') {
        const xmlText = typeof content === 'string' ? content : content.toString('utf-8');
        return CatalogParserEngine.parseXmlCatalog(xmlText, baseUrl);
      } else {
        return {
          success: false,
          offers: [],
          totalExtracted: 0,
          format,
          error: `Format nesuportat: ${format}`
        };
      }
    } catch (err: any) {
      return {
        success: false,
        offers: [],
        totalExtracted: 0,
        format,
        error: `Eroare la parsarea catalogului: ${err.message}`
      };
    }
  }

  private static parseNumericPrice(raw: unknown): number {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Number(raw.toFixed(2)) : 0;
    if (typeof raw !== 'string') return 0;
    return PriceExtractor.parseExplicitPriceField(raw) || 0;
  }

  private static resolveImageUrl(rawUrl?: unknown, baseUrl?: string): string | undefined {
    let candidate = '';
    if (Array.isArray(rawUrl)) {
      for (const item of rawUrl) {
        const resolved = this.resolveImageUrl(item, baseUrl);
        if (resolved) return resolved;
      }
      return undefined;
    }
    if (rawUrl && typeof rawUrl === 'object') {
      const obj = rawUrl as Record<string, unknown>;
      candidate = String(obj.url || obj.src || obj.imageUrl || obj.contentUrl || '').trim();
    } else if (typeof rawUrl === 'string') {
      candidate = rawUrl.trim();
    }

    if (!candidate) return undefined;
    const lower = candidate.toLowerCase();
    if (
      lower.startsWith('data:') ||
      lower.startsWith('javascript:') ||
      lower.startsWith('file:') ||
      lower.startsWith('vbscript:') ||
      lower.startsWith('blob:') ||
      lower.includes('1x1.') ||
      lower.includes('pixel.') ||
      lower.includes('spacer') ||
      lower.includes('blank.gif')
    ) {
      return undefined;
    }

    try {
      if (candidate.startsWith('//')) {
        candidate = `https:${candidate}`;
      }
      const resolved = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        return undefined;
      }
      if (resolved.pathname.toLowerCase().endsWith('.svg')) {
        return undefined;
      }
      const safety = validatePublicHttpUrl(resolved.href);
      if (!safety.safe || !safety.normalizedUrl) {
        return undefined;
      }
      return safety.normalizedUrl;
    } catch {
      return undefined;
    }
  }

  private static extractCardImageUrl(
    $: cheerio.CheerioAPI,
    card: cheerio.Cheerio<any>,
    baseUrl?: string
  ): string | undefined {
    const imgs = card.find('img');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs.eq(i);
      const attrs = [
        img.attr('data-src'),
        img.attr('data-lazy-src'),
        img.attr('data-original'),
        img.attr('data-image'),
        img.attr('src')
      ];
      for (const attr of attrs) {
        const resolved = this.resolveImageUrl(attr, baseUrl);
        if (resolved) return resolved;
      }
      const srcset = img.attr('data-srcset') || img.attr('srcset');
      if (srcset) {
        const firstSrc = srcset.split(',')[0]?.trim().split(/\s+/)[0];
        const resolved = this.resolveImageUrl(firstSrc, baseUrl);
        if (resolved) return resolved;
      }
    }

    const sources = card.find('picture source');
    for (let i = 0; i < sources.length; i++) {
      const srcset = sources.eq(i).attr('data-srcset') || sources.eq(i).attr('srcset');
      if (srcset) {
        const firstSrc = srcset.split(',')[0]?.trim().split(/\s+/)[0];
        const resolved = this.resolveImageUrl(firstSrc, baseUrl);
        if (resolved) return resolved;
      }
    }

    return undefined;
  }

  private static extractOffersFromJsonLdNode(node: any, offers: RawParsedOffer[], baseUrl?: string): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) {
        this.extractOffersFromJsonLdNode(child, offers, baseUrl);
      }
      return;
    }

    if (Array.isArray(node['@graph'])) {
      this.extractOffersFromJsonLdNode(node['@graph'], offers, baseUrl);
    }

    if (node.mainEntity) {
      this.extractOffersFromJsonLdNode(node.mainEntity, offers, baseUrl);
    }

    if (Array.isArray(node.itemListElement)) {
      for (const listEl of node.itemListElement) {
        this.extractOffersFromJsonLdNode(listEl?.item || listEl, offers, baseUrl);
      }
    }

    const rawType = node['@type'];
    const types = Array.isArray(rawType) ? rawType.map(String) : rawType ? [String(rawType)] : [];
    const isProduct = types.some(t => t === 'Product' || t === 'IndividualProduct');

    if ((isProduct || node.offers) && typeof node.name === 'string' && !PriceExtractor.isNoiseOrNonProductTitle(node.name)) {
      const rawOffers = Array.isArray(node.offers)
        ? node.offers
        : Array.isArray(node.offers?.offers)
          ? node.offers.offers
          : node.offers
            ? [node.offers]
            : [];
      const offerObj = rawOffers[0] || {};
      const price = this.parseNumericPrice(
        offerObj.price ?? offerObj.lowPrice ?? node.price
      );

      if (price > 0 && price < 50000) {
        const listPrice = this.parseNumericPrice(offerObj.highPrice ?? offerObj.priceSpecification?.price);
        const normalPrice = listPrice > price ? listPrice : price;
        const promoPrice = listPrice > price ? price : undefined;
        const imageUrl = this.resolveImageUrl(node.image, baseUrl);
        const pkg = PriceExtractor.extractPackagingSafely(node.name);
        const check = PriceExtractor.validateOfferPrice({
          title: node.name.trim(),
          normalPrice,
          promoPrice,
          effectivePrice: price,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          proofType: 'explicit_field'
        });

        if (check.status !== 'INVALID' && check.status !== 'MISSING') {
          offers.push({
            rawTitle: node.name.trim(),
            rawBrand: node.brand?.name || (typeof node.brand === 'string' ? node.brand : undefined),
            rawBarcode: node.gtin13 || node.gtin8 || node.gtin || node.sku,
            rawCategory: typeof node.category === 'string' ? node.category : undefined,
            normalPrice,
            promoPrice,
            effectivePrice: price,
            currency: offerObj.priceCurrency || 'RON',
            packageQuantity: pkg.packageQuantity,
            packageUnit: pkg.packageUnit,
            weight: pkg.weight,
            volume: pkg.volume,
            packageSize: pkg.packageSize,
            priceProofType: 'explicit_field',
            isPromo: Boolean(promoPrice || offerObj.discount || offerObj.priceValidUntil),
            validUntil: offerObj.priceValidUntil ? String(offerObj.priceValidUntil).slice(0, 10) : undefined,
            imageUrl,
            catalogUrl: node.url || offerObj.url,
            confidenceScore: 0.95
          });
        }
      }
    }
  }

  /**
   * Parsează cataloage HTML (inclusiv suport avansat pentru structura Lidl România și pagini web retaileri)
   */
  static parseHtmlCatalog(html: string, retailerId?: string, baseUrl?: string): ParseResult {
    const $ = cheerio.load(html);
    const offers: RawParsedOffer[] = [];
    const products: RawCatalogProduct[] = [];
    const warnings: string[] = [];

    // 1. Verificare JSON-LD structurat (inclusiv ItemList, OfferCatalog, @graph)
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const text = $(el).html();
        if (!text) return;
        const data = JSON.parse(text);
        this.extractOffersFromJsonLdNode(data, offers, baseUrl);
      } catch {
        // Ignorăm blocurile JSON-LD invalide
      }
    });

    // 2. Parsare specifică Lidl România dacă sunt detectate elemente de tip data-grid-data sau nuc-a-carousel-item
    const gridElements = $('[data-grid-data]');
    if (gridElements.length > 0) {
      gridElements.each((_, el) => {
        try {
          const rawAttr = $(el).attr('data-grid-data');
          if (!rawAttr) return;
          const parsed = JSON.parse(rawAttr);
          const data = Array.isArray(parsed) ? parsed[0] : parsed;
          if (!data) return;

          const title = data.fullTitle || data.title || data.keyfacts?.fullTitle || data.keyfacts?.title || $(el).find('h3, .article-title').text().trim();
          if (!title) return;

          let brand: string | undefined = undefined;
          if (typeof data.brand === 'string') {
            brand = data.brand;
          } else if (data.brand && typeof data.brand.name === 'string') {
            brand = data.brand.name;
          } else if (data.keyfacts?.brand) {
            brand = typeof data.keyfacts.brand === 'string' ? data.keyfacts.brand : data.keyfacts.brand?.name;
          }
          if (brand === '-' || brand === '') brand = undefined;

          // Extragere prețuri din regionsPrices (Lidl regional/național) sau direct din price
          let normalPrice = 0;
          let promoPrice: number | undefined = undefined;
          let loyaltyPrice: number | undefined = undefined;
          let rawPackaging: string | undefined = undefined;
          let validFrom = data.validFrom;
          let validUntil = data.validUntil;
          let isLidlPlus = false;
          let promoDetails: string | undefined = undefined;

          if (data.regionsPrices) {
            const reg1 = (data.regionsPrices['1'] || Object.values(data.regionsPrices)[0]) as any;
            if (reg1) {
              if (reg1.currentLidlPlusPrice) {
                isLidlPlus = true;
                const lp = reg1.currentLidlPlusPrice;
                const pVal = lp.price?.price;
                loyaltyPrice = typeof pVal === 'number' ? pVal : parseFloat(String(pVal || '').replace(',', '.'));
                rawPackaging = lp.price?.packaging?.text || lp.packaging?.text;
                validFrom = lp.price?.startDate?.slice(0, 10) || validFrom;
                validUntil = lp.price?.endDate?.slice(0, 10) || validUntil;

                if (lp.price?.basePrice?.text) {
                  const matchBase = lp.price.basePrice.text.match(/(\d+(?:[.,]\d+)?)\s*lei/i);
                  if (matchBase) {
                    normalPrice = parseFloat(matchBase[1].replace(',', '.'));
                  }
                }
                if (lp.highlightText || lp.price?.discount?.discountText) {
                  promoDetails = `Lidl Plus ${lp.highlightText || lp.price?.discount?.discountText}`;
                }
              } else if (reg1.currentPrice) {
                const cp = reg1.currentPrice;
                const p = typeof cp.price === 'number' ? cp.price : parseFloat(String(cp.price || '').replace(',', '.'));
                if (!isNaN(p) && p > 0) normalPrice = p;
                rawPackaging = cp.packaging?.text;
                validFrom = cp.startDate?.slice(0, 10) || validFrom;
                validUntil = cp.endDate?.slice(0, 10) || validUntil;
                if (cp.discount?.price) {
                  promoPrice = typeof cp.discount.price === 'number' ? cp.discount.price : parseFloat(String(cp.discount.price).replace(',', '.'));
                }
              }
            }
          }

          // Fallback din data.price dacă nu a fost identificat prin regionsPrices
          if (normalPrice <= 0 && data.price?.price) {
            const p = typeof data.price.price === 'number' ? data.price.price : parseFloat(String(data.price.price).replace(',', '.'));
            if (!isNaN(p) && p > 0) normalPrice = p;
            if (data.price?.discount?.price) {
              promoPrice = parseFloat(String(data.price.discount.price).replace(',', '.'));
            }
            if (data.price?.loyaltyCardPrice) {
              loyaltyPrice = parseFloat(String(data.price.loyaltyCardPrice).replace(',', '.'));
              isLidlPlus = true;
            }
          }

          if (normalPrice <= 0 && loyaltyPrice && loyaltyPrice > 0) {
            normalPrice = loyaltyPrice;
          }

          // Fallback din DOM-ul cardului
          if (normalPrice <= 0) {
            const priceText = $(el).find('.m-price__price, .pricebox__price, .a-price').first().text().trim();
            const extractedDomPrice = PriceExtractor.extractPriceWithContext(priceText, { isPriceElement: true });
            normalPrice = extractedDomPrice.value || 0;
          }

          if (isNaN(normalPrice) || normalPrice <= 0) return;
          if (PriceExtractor.isNoiseOrNonProductTitle(title)) return;

          // Determinare gramaj / unitate în siguranță
          if (!rawPackaging) {
            rawPackaging = data.price?.packaging?.text || data.packaging || $(el).find('.m-price__subline, .pricebox__basic-quantity').text().trim();
          }

          const pkg = PriceExtractor.extractPackagingSafely(`${rawPackaging || ''} ${title}`);
          const pkgQty = pkg.packageQuantity;
          const pkgUnit = pkg.packageUnit;

          const effectivePrice = loyaltyPrice || promoPrice || normalPrice;
          if (isLidlPlus || Boolean(data.price?.loyaltyCardPrice || $(el).find('.lidl-plus, [data-loyalty]').length > 0)) {
            isLidlPlus = true;
          }

          const check = PriceExtractor.validateOfferPrice({
            title,
            normalPrice,
            promoPrice,
            loyaltyPrice,
            effectivePrice,
            packageQuantity: pkgQty,
            packageUnit: pkgUnit,
            proofType: 'price_selector'
          });
          if (check.status === 'INVALID' || check.status === 'MISSING') {
            warnings.push(`Ofertă Lidl respinsă la validare (${title}): ${check.reasons.join(' ')}`);
            return;
          }

          offers.push({
            rawTitle: title,
            rawBrand: brand,
            rawCategory: typeof data.category === 'string' ? data.category : (data.category?.name || 'Alimente'),
            normalPrice,
            promoPrice,
            loyaltyPrice,
            effectivePrice,
            currency: 'RON',
            packageQuantity: pkgQty,
            packageUnit: pkgUnit,
            weight: pkg.weight,
            volume: pkg.volume,
            packageSize: pkg.packageSize,
            priceProofType: 'price_selector',
            isPromo: Boolean(promoPrice || isLidlPlus || data.price?.discount),
            promoDetails: promoDetails || (isLidlPlus ? 'Preț exclusiv cu aplicația Lidl Plus' : promoPrice ? `Reducere promoțională de la ${normalPrice} lei` : undefined),
            loyaltyCardName: isLidlPlus ? 'Lidl Plus' : undefined,
            validFrom,
            validUntil,
            imageUrl: this.resolveImageUrl(data.image, baseUrl) || this.extractCardImageUrl($, $(el), baseUrl),
            confidenceScore: 0.95
          });
        } catch (err: any) {
          warnings.push(`Eroare la parsarea unui card Lidl: ${err.message}`);
        }
      });
    }

    // 2b. Parsare specifică Kaufland România (.k-product-tile) — separă strict prețul de .k-product-tile__unit-price (gramaj/volum)
    const kauflandTiles = $('.k-product-tile');
    if (kauflandTiles.length > 0) {
      const seenKaufland = new Set<string>();
      kauflandTiles.each((_, el) => {
        try {
          const tile = $(el);
          const subtitle = tile.find('.k-product-tile__subtitle').first().text().replace(/\s+/g, ' ').trim();
          const mainTitle = tile.find('.k-product-tile__title').first().text().replace(/\s+/g, ' ').trim();
          const rawTitle = subtitle && mainTitle && !mainTitle.toLowerCase().startsWith(subtitle.toLowerCase())
            ? `${subtitle} ${mainTitle}`.trim()
            : (mainTitle || subtitle).trim();

          if (!rawTitle || PriceExtractor.isNoiseOrNonProductTitle(rawTitle)) return;

          const subtitleBrandCheck = normalizeBrand(subtitle && mainTitle ? subtitle : undefined, rawTitle);
          const cleanKauflandBrand = subtitleBrandCheck.normalizedBrand || undefined;

          // Excludem explicit .k-product-tile__unit-price din prețuri; îl folosim strict pentru gramaj/ambalaj!
          const unitInfoText = tile.find('.k-product-tile__unit-price, .k-product-tile__base-price').first().text().trim();
          const currentPriceRaw = tile.find('.k-price-tag__price:not(.k-price-tag__old-price):not([class*="old"])').first().text().trim();
          const oldPriceRaw = tile.find('.k-price-tag__old-price').first().text().trim();
          const loyaltyPriceRaw = tile.find('.k-price-tag--loyalty .k-price-tag__price, .k-product-tile__loyalty-price').first().text().trim();

          const currentExtracted = PriceExtractor.extractPriceWithContext(currentPriceRaw, { isPriceElement: true });
          const oldExtracted = PriceExtractor.extractPriceWithContext(oldPriceRaw, { isPriceElement: true });
          const loyaltyExtracted = PriceExtractor.extractPriceWithContext(loyaltyPriceRaw, { isPriceElement: true });

          const pkg = PriceExtractor.extractPackagingSafely(`${unitInfoText} ${rawTitle}`);
          const currentPrice = currentExtracted.value || 0;
          const oldPrice = oldExtracted.value || 0;
          const loyaltyPrice = loyaltyExtracted.value || undefined;
          const effectivePrice = loyaltyPrice && loyaltyPrice > 0 ? loyaltyPrice : currentPrice;

          if (!effectivePrice || effectivePrice <= 0) {
            const pKey = rawTitle.toLowerCase();
            if (!seenKaufland.has(pKey)) {
              seenKaufland.add(pKey);
              products.push({
                rawTitle,
                rawBrand: cleanKauflandBrand,
                packageQuantity: pkg.packageQuantity,
                packageUnit: pkg.packageUnit,
                imageUrl: this.extractCardImageUrl($, tile, baseUrl || 'https://www.kaufland.ro'),
                confidenceScore: 0.7
              });
            }
            return;
          }

          const normalPrice = oldPrice > effectivePrice ? oldPrice : (currentPrice > effectivePrice ? currentPrice : effectivePrice);
          const promoPrice = !loyaltyPrice && normalPrice > effectivePrice ? effectivePrice : undefined;
          const check = PriceExtractor.validateOfferPrice({
            title: rawTitle,
            normalPrice,
            promoPrice,
            loyaltyPrice,
            effectivePrice,
            packageQuantity: pkg.packageQuantity,
            packageUnit: pkg.packageUnit,
            rawPriceText: currentPriceRaw,
            proofType: currentExtracted.proofType
          });

          if (check.status === 'INVALID' || check.status === 'MISSING') {
            warnings.push(`Ofertă Kaufland respinsă (${rawTitle}): ${check.reasons.join(' ')}`);
            return;
          }

          const key = `${rawTitle.toLowerCase()}__${effectivePrice}`;
          if (seenKaufland.has(key)) return;
          seenKaufland.add(key);

          const discountTag = tile.find('.k-price-tag__discount').first().text().trim();
          const discNumMatch = discountTag.match(/(\d+)\s*%/);
          const discountPercentage = discNumMatch
            ? parseInt(discNumMatch[1], 10)
            : (normalPrice > effectivePrice ? Math.round(((normalPrice - effectivePrice) / normalPrice) * 100) : undefined);

          let unitPrice: number | undefined;
          let unitPriceMeasure: string | undefined;
          const basePerUnitMatch = unitInfoText.match(/1\s*(kg|l|buc)\s*=\s*(\d+(?:[.,]\d+)?)\s*(?:lei|ron)/i);
          if (basePerUnitMatch) {
            unitPrice = parseFloat(basePerUnitMatch[2].replace(',', '.'));
            unitPriceMeasure = `lei/${basePerUnitMatch[1].toLowerCase()}`;
          }

          offers.push({
            rawTitle,
            rawBrand: cleanKauflandBrand,
            normalPrice,
            promoPrice,
            loyaltyPrice,
            effectivePrice,
            currency: 'RON',
            priceType: loyaltyPrice ? 'loyalty_card' : promoPrice ? 'promotional' : 'standard',
            discountPercentage,
            packageQuantity: pkg.packageQuantity,
            packageUnit: pkg.packageUnit,
            weight: pkg.weight,
            volume: pkg.volume,
            packageSize: pkg.packageSize,
            unitPrice,
            unitPriceMeasure,
            priceProofType: currentExtracted.proofType,
            isPromo: Boolean(promoPrice || loyaltyPrice || discountTag),
            promoDetails: loyaltyPrice
              ? `Ofertă Kaufland Card${discountPercentage ? ` (-${discountPercentage}%)` : ''}`
              : (discountPercentage ? `Reducere Kaufland -${discountPercentage}%` : (discountTag || undefined)),
            loyaltyCardName: loyaltyPrice ? 'Kaufland Card' : undefined,
            loyaltyCardRequired: Boolean(loyaltyPrice),
            imageUrl: this.extractCardImageUrl($, tile, baseUrl || 'https://www.kaufland.ro'),
            confidenceScore: 0.94
          });
        } catch (err: any) {
          warnings.push(`Eroare parsare tile Kaufland: ${err.message}`);
        }
      });
    }

    // 3. Parsare generică HTML carduri (pentru pagini web ale retailerilor sau cataloage online)
    if (offers.length === 0) {
      const seenTitles = new Set<string>();
      $('.product-card, .product-item, .product-tile, .product-box, [data-product-id], [data-testid*="product"], [class*="product"], [class*="offer"], [class*="card"], article').each((_, el) => {
        const card = $(el);
        const title = card.find('h2, h3, h4, .product-name, .title, .name, [data-qa="product-title"], [class*="title"], [class*="name"]').first().text().trim();
        if (title.length < 3 || PriceExtractor.isNoiseOrNonProductTitle(title)) return;

        const titleKey = title.toLowerCase();
        if (seenTitles.has(titleKey)) return;

        const currentPriceEl = card.find(
          '.current-price, .promo-price, [data-qa="price-current"], [class*="price"]:not([class*="old"]):not([class*="original"]):not([class*="strike"]):not([class*="unit"]):not([class*="base"]):not([class*="per-kg"]):not([class*="per-l"]):not([class*="weight"]):not([class*="qty"]), .pret, .valoare'
        ).first();
        const oldPriceEl = card.find('.old-price, .original-price, .cut-price, .pret-vechi, [data-qa="price-original"], [class*="old-price"], [class*="original-price"], del, s').first();
        const loyaltyPriceEl = card.find('.loyalty-price, .card-price, .pret-card, [data-qa="price-loyalty"]').first();

        const currentText = currentPriceEl.text().trim();
        const oldText = oldPriceEl.text().trim();
        const loyaltyText = loyaltyPriceEl.text().trim();

        const currentRes = PriceExtractor.extractPriceWithContext(currentText, {
          isPriceElement: currentPriceEl.length > 0,
          requireCommercialContext: false
        });
        const oldRes = PriceExtractor.extractPriceWithContext(oldText, {
          isPriceElement: oldPriceEl.length > 0,
          requireCommercialContext: false
        });
        const loyaltyRes = PriceExtractor.extractPriceWithContext(loyaltyText, {
          isPriceElement: loyaltyPriceEl.length > 0,
          requireCommercialContext: false
        });

        const currentPrice = currentRes.value || 0;
        const oldPrice = oldRes.value || 0;
        const loyaltyPrice = loyaltyRes.value || 0;

        const effectivePrice = loyaltyPrice > 0 ? loyaltyPrice : currentPrice;
        if (!Number.isFinite(effectivePrice) || effectivePrice <= 0 || effectivePrice >= 50000) return;

        const normalPrice = oldPrice > effectivePrice ? oldPrice : (currentPrice > effectivePrice ? currentPrice : effectivePrice);
        const promoPrice = !loyaltyPrice && normalPrice > effectivePrice ? effectivePrice : undefined;
        const brand = card.find('.brand, .manufacturer, [data-qa="product-brand"]').first().text().trim() || undefined;
        const barcode = card.attr('data-ean') || card.attr('data-sku') || undefined;
        const imageUrl = this.extractCardImageUrl($, card, baseUrl);
        const pkg = PriceExtractor.extractPackagingSafely(title);

        const validation = PriceExtractor.validateOfferPrice({
          title,
          normalPrice,
          promoPrice,
          loyaltyPrice: loyaltyPrice > 0 ? loyaltyPrice : undefined,
          effectivePrice,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          rawPriceText: loyaltyPrice > 0 ? loyaltyText : currentText,
          proofType: loyaltyPrice > 0 ? loyaltyRes.proofType : currentRes.proofType
        });

        if (validation.status === 'INVALID' || validation.status === 'MISSING') {
          warnings.push(`Ofertă HTML generică respinsă (${title}): ${validation.reasons.join(' ')}`);
          return;
        }

        const promoBadge = card.find('.badge, .promo-label, .reducere, .discount-tag').first().text().trim();
        const isPromo = Boolean(promoPrice || loyaltyPrice || /reducere|promo|discount|oferta/i.test(card.text()));

        seenTitles.add(titleKey);
        offers.push({
          rawTitle: title,
          rawBrand: brand,
          rawBarcode: barcode,
          normalPrice,
          promoPrice,
          loyaltyPrice: loyaltyPrice > 0 ? loyaltyPrice : undefined,
          effectivePrice,
          currency: 'RON',
          priceType: loyaltyPrice > 0 ? 'loyalty_card' : promoPrice ? 'promotional' : 'standard',
          discountPercentage: normalPrice > effectivePrice ? Math.round(((normalPrice - effectivePrice) / normalPrice) * 100) : undefined,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          weight: pkg.weight,
          volume: pkg.volume,
          packageSize: pkg.packageSize,
          priceProofType: loyaltyPrice > 0 ? loyaltyRes.proofType : currentRes.proofType,
          isPromo,
          promoDetails: promoBadge || undefined,
          loyaltyCardName: loyaltyPrice > 0 && retailerId ? `${retailerId.toUpperCase()} Card` : undefined,
          loyaltyCardRequired: loyaltyPrice > 0,
          imageUrl,
          confidenceScore: 0.78
        });
      });
    }

    if (offers.length === 0) {
      const seenProducts = new Set<string>();
      $('[data-grid-data], [class*="product"], [class*="offer"], [class*="card"], article').each((_, el) => {
        let data: any = {};
        const rawAttr = $(el).attr('data-grid-data');
        if (rawAttr) {
          try { data = JSON.parse(rawAttr); data = Array.isArray(data) ? data[0] || {} : data; } catch { data = {}; }
        }
        const title = String(data.fullTitle || data.title || data.keyfacts?.fullTitle || $(el).find('h2, h3, h4, .article-title, [class*="title"], [class*="name"]').first().text() || '').trim();
        const key = title.toLowerCase();
        if (title.length < 3 || PriceExtractor.isNoiseOrNonProductTitle(title) || seenProducts.has(key)) return;
        seenProducts.add(key);
        const packaging = String(data.packaging || data.price?.packaging?.text || $(el).find('.m-price__subline, .pricebox__basic-quantity').text() || '');
        const pkg = PriceExtractor.extractPackagingSafely(`${packaging} ${title}`);
        products.push({
          rawTitle: title,
          rawBrand: typeof data.brand === 'string' ? data.brand : data.brand?.name,
          rawCategory: typeof data.category === 'string' ? data.category : data.category?.name,
          rawBarcode: data.gtin13 || data.gtin8 || data.sku,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          imageUrl: this.resolveImageUrl(data.image, baseUrl) || this.extractCardImageUrl($, $(el), baseUrl),
          confidenceScore: rawAttr ? 0.8 : 0.55
        });
      });

      if (products.length === 0) {
        const seenTitles = new Set<string>();
        $('script:not([type="application/ld+json"])').each((_, script) => {
          const source = $(script).html() || '';
          const titlePattern = /(?:fullTitle|productName|productTitle|name)\\s*["']?\\s*[:=]\\s*["']([^"']{3,160})["']/gi;
          let match: RegExpExecArray | null;
          while ((match = titlePattern.exec(source))) {
            const title = match[1].replace(/\\\\u0026/g, '&').trim();
            const key = title.toLowerCase();
            if (seenTitles.has(key) || PriceExtractor.isNoiseOrNonProductTitle(title) || /^(product|item|offer|category|brand)$/i.test(title)) continue;
            seenTitles.add(key);
            products.push({ rawTitle: title, confidenceScore: 0.45 });
          }
        });
      }
    }

    return {
      success: offers.length > 0,
      offers,
      products,
      totalExtracted: offers.length,
      format: 'html',
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Parsează cataloage PDF (folosind pdf-parse și extragere euristică de oferte din text și tabele)
   */
  static async parsePdfCatalog(pdfBuffer: Buffer): Promise<ParseResult> {
    try {
      let text = '';
      try {
        const pdfModule: any = await import('pdf-parse');
        if (pdfModule.PDFParse) {
          const parser = new pdfModule.PDFParse({ data: pdfBuffer });
          if (typeof parser.load === 'function') await parser.load();
          const res = await parser.getText();
          text = typeof res === 'string' ? res : res?.text || '';
        } else if (typeof pdfModule.default === 'function') {
          const res = await pdfModule.default(pdfBuffer);
          text = res?.text || '';
        }
      } catch {
        text = pdfBuffer.toString('utf-8');
      }

      if (!text.trim()) {
        return {
          success: false,
          offers: [],
          totalExtracted: 0,
          format: 'pdf',
          ocrConfidence: 10,
          error: 'Documentul PDF pare scanat fără strat de text (OCR absent) sau corupt.'
        };
      }

      // Respinge documente non-comerciale (rapoarte sustenabilitate, taxonomie UE, audituri ESG)
      if (/\b(?:Taxonomie\s+UE|Activit[ăa][țt]i\s+economice|Raport\s+(?:anual|de\s+sustenabilitate)|CCM\s*\d+(?:[.,]\d+)?|EU\s+Taxonomy)\b/i.test(text) && !/\b(?:lei|ron)\b/i.test(text)) {
        return {
          success: false,
          offers: [],
          totalExtracted: 0,
          format: 'pdf',
          ocrConfidence: 0,
          error: 'Documentul PDF pare un raport corporativ/sustenabilitate fără prețuri comerciale.'
        };
      }

      // Calcul scor încredere OCR/Text pe baza frecvenței termenilor specifici de retail alimentar
      const groceryKeywords = ['lei', 'ron', 'kg', 'buc', 'reducere', 'lapte', 'paine', 'carne', 'ulei', 'pret', 'oferta', 'feliat', 'bio'];
      let keywordHits = 0;
      const lowerText = text.toLowerCase();
      for (const kw of groceryKeywords) {
        if (lowerText.includes(kw)) keywordHits++;
      }
      const ocrConfidence = Math.min(100, Math.round((keywordHits / groceryKeywords.length) * 100) + 20);

      const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      const offers: RawParsedOffer[] = [];
      const products: RawCatalogProduct[] = [];
      const seenTitles = new Set<string>();

      // Euristică 1: Linii cu preț explicit și monedă ("4,99 lei", "12.50 RON")
      const priceRegex = /(\d+(?:[.,]\d{1,2}))\s*(?:lei|ron)\b/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(priceRegex);

        if (match) {
          const extracted = PriceExtractor.extractPriceWithContext(line, { requireCommercialContext: true });
          const price = extracted.value;
          if (!price || price <= 0 || price > 50000) continue;

          let titleCandidate = line.replace(match[0], '').replace(/[.,\-_:;*]/g, ' ').trim();

          // Dacă titlul pe aceeași linie e prea scurt, combină cu linia precedentă
          if (titleCandidate.length < 3 && i > 0 && lines[i - 1].length >= 3) {
            titleCandidate = lines[i - 1];
          }

          if (titleCandidate.length >= 3 && !PriceExtractor.isNoiseOrNonProductTitle(titleCandidate)) {
            const pkg = PriceExtractor.extractPackagingSafely(titleCandidate);
            const check = PriceExtractor.validateOfferPrice({
              title: titleCandidate,
              normalPrice: price,
              effectivePrice: price,
              packageQuantity: pkg.packageQuantity,
              packageUnit: pkg.packageUnit,
              rawPriceText: match[0],
              proofType: extracted.proofType
            });
            if (check.status === 'INVALID' || check.status === 'MISSING') continue;

            const isPromo = /reducere|promo|discount|-?\d+%/i.test(line) || (i > 0 && /reducere|promo/i.test(lines[i - 1]));
            const normKey = titleCandidate.toLowerCase();
            if (!seenTitles.has(normKey)) {
              seenTitles.add(normKey);
              offers.push({
                rawTitle: titleCandidate,
                normalPrice: price,
                effectivePrice: price,
                currency: 'RON',
                packageQuantity: pkg.packageQuantity,
                packageUnit: pkg.packageUnit,
                weight: pkg.weight,
                volume: pkg.volume,
                packageSize: pkg.packageSize,
                priceProofType: extracted.proofType,
                isPromo,
                confidenceScore: Math.round(ocrConfidence * 0.8) / 100
              });
            }
          }
        }
      }

      // Euristică 2: Cataloage de supermarket tip revistă/pliant (verificând strict separarea de cantități)
      const disclaimers = [
        'limita stocului', 'consumului personal', 'toate imaginile', 'termeni si conditii',
        'studiu yougov', 'drepturi rezervate', 'oferta se aplica', 'reducerea este valabila',
        'declaratie', 'black friday', 'kaufland card', 'card fidelitate', 'pagina',
        'de plastic', 'taxonomie', 'activitati economice', 'valabila in perioada'
      ];

      const foodKeywords = [
        'cafea', 'lapte', 'paine', 'pâine', 'carne', 'iaurt', 'ulei', 'bere', 'apa', 'apă',
        'orez', 'zahar', 'zahăr', 'faina', 'făină', 'cotlet', 'muschi', 'mușchi', 'salam',
        'cascaval', 'cașcaval', 'branza', 'brânză', 'unt', 'mere', 'banane', 'rosii', 'roșii',
        'cartofi', 'ceapa', 'ceapă', 'ciocolata', 'ciocolată', 'biscuiti', 'biscuiți', 'oua', 'ouă',
        'pui', 'somon', 'detergent', 'balsam', 'sampon', 'șampon', 'crenvursti', 'crenvurști',
        'sunca', 'șuncă', 'file', 'pulpe', 'porc', 'vita', 'vită', 'legume', 'fructe'
      ];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lower = line.toLowerCase();

        if (disclaimers.some(d => lower.includes(d)) || PriceExtractor.isNoiseOrNonProductTitle(line)) continue;
        if (line.length > 80 || line.length < 3) continue;

        const hasKeyword = foodKeywords.some(kw => lower.includes(kw));
        if (!hasKeyword) continue;

        // Căutare preț în proximitate (+/- 4 linii), interzicând liniile urmate de unități fizice (ex: "0,33" urmat de "L")
        let foundPrice: number | null = null;
        let foundProof: PriceProofType = 'none';
        let foundRawPrice = '';
        let promoPct: string | null = null;

        let pkgCtxText = line;
        for (let o = -2; o <= 2; o++) {
          if (lines[i + o]) pkgCtxText += ` ${lines[i + o]}`;
        }
        const pkg = PriceExtractor.extractPackagingSafely(pkgCtxText);

        for (let offset = -4; offset <= 4; offset++) {
          const idxNeighbor = i + offset;
          const neighbor = lines[idxNeighbor];
          if (!neighbor) continue;

          const nextNeighbor = lines[idxNeighbor + 1] || '';
          const joinedWithNext = `${neighbor} ${nextNeighbor}`.trim();
          // Dacă numărul este urmat de unitate fizică pe linia următoare (ex: "0,33" \n "L"), nu este preț!
          if (/^\d{1,4}(?:[.,]\d{1,2})?\s*(?:kg|gr|g|ml|cl|l|buc|role|%)\b/i.test(joinedWithNext)) {
            continue;
          }

          const neighborRes = PriceExtractor.extractPriceWithContext(neighbor, {
            requireCommercialContext: false,
            contextWindow: lines[idxNeighbor - 1] || ''
          });
          if (neighborRes.value !== null && neighborRes.value >= 0.5 && neighborRes.value <= 5000) {
            const qtyCheck = PriceExtractor.detectQuantityAsPrice({
              title: line,
              effectivePrice: neighborRes.value,
              packageQuantity: pkg.packageQuantity,
              packageUnit: pkg.packageUnit,
              rawPriceText: neighbor,
              proofType: neighborRes.proofType
            });
            if (!qtyCheck.isConfused) {
              foundPrice = neighborRes.value;
              foundProof = neighborRes.proofType;
              foundRawPrice = neighbor;
              break;
            }
          }

          const pctMatch = neighbor.match(/-(\d{1,2})%/);
          if (pctMatch) {
            promoPct = pctMatch[1];
          }
        }

        if (!foundPrice) {
          const productKey = line.toLowerCase();
          if (!seenTitles.has(productKey)) {
            seenTitles.add(productKey);
            products.push({
              rawTitle: line,
              rawBrand: i > 0 && lines[i - 1].length <= 30 ? lines[i - 1] : undefined,
              packageQuantity: pkg.packageQuantity,
              packageUnit: pkg.packageUnit,
              confidenceScore: Math.round(ocrConfidence * 0.6) / 100
            });
          }
          continue;
        }

        let brand: string | undefined = undefined;
        if (i > 0) {
          const prev = lines[i - 1];
          if (
            prev.length >= 2 &&
            prev.length <= 25 &&
            !disclaimers.some(d => prev.toLowerCase().includes(d)) &&
            !PriceExtractor.isNoiseOrNonProductTitle(prev) &&
            !/^\d+/.test(prev) &&
            !prev.includes('--')
          ) {
            brand = prev;
          }
        }

        let cleanTitle = (brand ? `${brand} ${line}` : line)
          .replace(/^-\d{1,2}%\s*/, '')
          .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '')
          .replace(/S\d+-[A-Z0-9_-]+/g, '')
          .trim();

        if (cleanTitle.length >= 3 && !disclaimers.some(d => cleanTitle.toLowerCase().includes(d)) && !PriceExtractor.isNoiseOrNonProductTitle(cleanTitle)) {
          const priceCheck = PriceExtractor.validateOfferPrice({
            title: cleanTitle,
            normalPrice: foundPrice,
            effectivePrice: foundPrice,
            packageQuantity: pkg.packageQuantity,
            packageUnit: pkg.packageUnit,
            rawPriceText: foundRawPrice,
            proofType: foundProof
          });
          if (priceCheck.status === 'INVALID' || priceCheck.status === 'MISSING') {
            continue;
          }

          const normKey = cleanTitle.toLowerCase();
          if (!seenTitles.has(normKey)) {
            seenTitles.add(normKey);
            offers.push({
              rawTitle: cleanTitle,
              rawBrand: brand,
              normalPrice: foundPrice,
              effectivePrice: foundPrice,
              currency: 'RON',
              packageQuantity: pkg.packageQuantity,
              packageUnit: pkg.packageUnit,
              weight: pkg.weight,
              volume: pkg.volume,
              packageSize: pkg.packageSize,
              priceProofType: foundProof,
              isPromo: Boolean(promoPct),
              confidenceScore: 0.85
            });
          }
        }
      }

      return {
        success: offers.length > 0,
        offers,
        products,
        totalExtracted: offers.length || products.length,
        format: 'pdf',
        ocrConfidence
      };
    } catch (err: any) {
      return {
        success: false,
        offers: [],
        totalExtracted: 0,
        format: 'pdf',
        ocrConfidence: 0,
        error: `Eroare la parsarea PDF: ${err.message}`
      };
    }
  }

  /**
   * Parsează catalogul oficial Carrefour Market & Promoții Săptămânale
   */
  static parseCarrefourCatalog(html: string, baseUrl?: string): ParseResult {
    const $ = cheerio.load(html);
    const offers: RawParsedOffer[] = [];
    const warnings: string[] = [];

    $('.product_info').each((_, el) => {
      try {
        const title = ($(el).find('.product_title span').first().text().trim() || $(el).find('.product_title').first().text().trim());
        if (!title || PriceExtractor.isNoiseOrNonProductTitle(title)) return;

        // Price wrappers
        const fullPriceInt = $(el).find('.Price_priceWrapperFull__HAvIg').first().text().trim().replace(/[^\d]/g, '');
        const decimalCurrency = $(el).find('.Price_priceWrapperDecimalCurrency__52Dsm').first().text().trim().replace(/[^\d]/g, '');
        const promoPriceNum = fullPriceInt
          ? parseFloat(decimalCurrency ? `${fullPriceInt}.${decimalCurrency.slice(0, 2)}` : fullPriceInt)
          : NaN;

        // Strike through price (regular price)
        const strikeInt = $(el).find('.Price_priceWrapperStrikeThrough__EvRr7 .Price_priceWrapperFull__HAvIg').text().trim().replace(/[^\d]/g, '');
        const strikeDec = $(el).find('.Price_priceWrapperStrikeThrough__EvRr7 .Price_priceWrapperDecimalCurrency__52Dsm').text().trim().replace(/[^\d]/g, '');
        const strikePriceNum = strikeInt
          ? parseFloat(strikeDec ? `${strikeInt}.${strikeDec.slice(0, 2)}` : strikeInt)
          : undefined;

        const isLoyalty = $(el).find('.PricesComponent_loyalty__Xl2Oq').length > 0;

        const normalPrice = strikePriceNum && !isNaN(strikePriceNum) ? strikePriceNum : promoPriceNum;
        const effectivePrice = !isNaN(promoPriceNum) && promoPriceNum > 0 ? promoPriceNum : normalPrice;
        let loyaltyPrice: number | undefined = undefined;

        if (isLoyalty) {
          loyaltyPrice = effectivePrice;
        }

        if (isNaN(effectivePrice) || effectivePrice <= 0) return;

        // Gramaj / volum din titlu în siguranță
        const pkg = PriceExtractor.extractPackagingSafely(title);
        const packageQuantity = pkg.packageQuantity;
        const packageUnit = pkg.packageUnit;

        const check = PriceExtractor.validateOfferPrice({
          title,
          normalPrice: normalPrice || effectivePrice,
          promoPrice: !isLoyalty && effectivePrice < normalPrice ? effectivePrice : undefined,
          loyaltyPrice,
          effectivePrice,
          packageQuantity,
          packageUnit,
          proofType: 'price_selector'
        });
        if (check.status === 'INVALID' || check.status === 'MISSING') return;

        let discountPercentage: number | undefined = undefined;
        if (normalPrice > effectivePrice) {
          discountPercentage = Math.round(((normalPrice - effectivePrice) / normalPrice) * 100);
        }

        let unitPrice: number | undefined = undefined;
        let unitPriceMeasure: string | undefined = undefined;
        if (packageQuantity && packageUnit) {
          if (packageUnit === 'g') {
            unitPrice = parseFloat(((effectivePrice / packageQuantity) * 1000).toFixed(2));
            unitPriceMeasure = 'lei/kg';
          } else if (packageUnit === 'kg') {
            unitPrice = parseFloat((effectivePrice / packageQuantity).toFixed(2));
            unitPriceMeasure = 'lei/kg';
          } else if (packageUnit === 'ml') {
            unitPrice = parseFloat(((effectivePrice / packageQuantity) * 1000).toFixed(2));
            unitPriceMeasure = 'lei/l';
          } else if (packageUnit === 'l') {
            unitPrice = parseFloat((effectivePrice / packageQuantity).toFixed(2));
            unitPriceMeasure = 'lei/l';
          }
        }

        const cardContainer = $(el).closest('.product_card, .product-card, .product_wrapper, article, li').first();
        const imageUrl =
          this.extractCardImageUrl($, $(el), baseUrl || 'https://carrefour.ro') ||
          (cardContainer.length > 0
            ? this.extractCardImageUrl($, cardContainer, baseUrl || 'https://carrefour.ro')
            : undefined);

        offers.push({
          rawTitle: title,
          normalPrice: normalPrice || effectivePrice,
          promoPrice: !isLoyalty && effectivePrice < normalPrice ? effectivePrice : undefined,
          loyaltyPrice,
          effectivePrice,
          currency: 'RON',
          priceType: isLoyalty ? 'loyalty_card' : (effectivePrice < normalPrice ? 'promotional' : 'standard'),
          discountPercentage,
          packageQuantity,
          packageUnit,
          weight: pkg.weight,
          volume: pkg.volume,
          packageSize: pkg.packageSize,
          priceProofType: 'price_selector',
          unitPrice,
          unitPriceMeasure,
          isPromo: effectivePrice < normalPrice || isLoyalty,
          promoDetails: isLoyalty
            ? 'Ofertă cu cardul de fidelitate Carrefour Act For Good'
            : (discountPercentage ? `Reducere promoțională -${discountPercentage}%` : undefined),
          loyaltyCardName: isLoyalty ? 'Act For Good' : undefined,
          loyaltyCardRequired: isLoyalty,
          imageUrl,
          storeOrRegion: 'Carrefour Market',
          targetAudience: 'general',
          confidenceScore: 0.95
        });
      } catch {
        // continue
      }
    });

    return {
      success: offers.length > 0,
      offers,
      totalExtracted: offers.length,
      format: 'html',
      warnings
    };
  }

  /**
   * Parsează catalogul de oferte săptămânale oficiale PENNY România
   */
  static parsePennyCatalog(html: string, baseUrl?: string): ParseResult {
    const $ = cheerio.load(html);
    const offers: RawParsedOffer[] = [];
    const warnings: string[] = [];

    $('[data-test="product-tile"]').each((_, el) => {
      try {
        const title = $(el).find('[data-test="product-title"]').text().trim();
        if (!title || PriceExtractor.isNoiseOrNonProductTitle(title)) return;
        const imageUrl = this.extractCardImageUrl($, $(el), baseUrl || 'https://www.penny.ro');

        const pieceDesc = $(el).find('[data-test="product-information-piece-description"]').text().trim();
        const validityText = $(el).find('[data-test="product-price-validity"]').text().trim();

        let validFrom: string | undefined = undefined;
        let validUntil: string | undefined = undefined;
        const dateMatches = validityText.match(/(\d{2}\.\d{2}\.\d{4})/g);
        if (dateMatches && dateMatches.length >= 2) {
          const [d1, m1, y1] = dateMatches[0].split('.');
          const [d2, m2, y2] = dateMatches[1].split('.');
          validFrom = `${y1}-${m1}-${d1}`;
          validUntil = `${y2}-${m2}-${d2}`;
        }

        let standardPrice = 0;
        let loyaltyPrice: number | undefined = undefined;

        $(el).find('[data-test="product-price-type"]').each((_, pt) => {
          const label = $(pt).find('[data-test="product-price-type-price-label"]').text().trim().toLowerCase();
          const valStr = $(pt).find('[data-test="product-price-type-value"] .ws-product-price-value__main').text().trim();
          const extracted = PriceExtractor.extractPriceWithContext(valStr, { isPriceElement: true });
          const num = extracted.value;
          if (num && num > 0) {
            if (label.includes('fără penny card') || label.includes('fara')) {
              standardPrice = num;
            } else if (label.includes('cu penny card')) {
              loyaltyPrice = num;
            } else if (standardPrice === 0) {
              standardPrice = num;
            }
          }
        });

        if (standardPrice === 0 && loyaltyPrice) {
          standardPrice = loyaltyPrice;
        }

        const effectivePrice = loyaltyPrice || standardPrice;
        if (isNaN(effectivePrice) || effectivePrice <= 0) return;

        const pkg = PriceExtractor.extractPackagingSafely(`${pieceDesc} ${title}`);
        const packageQuantity = pkg.packageQuantity;
        const packageUnit = pkg.packageUnit;

        const check = PriceExtractor.validateOfferPrice({
          title,
          normalPrice: standardPrice,
          promoPrice: !loyaltyPrice && effectivePrice < standardPrice ? effectivePrice : undefined,
          loyaltyPrice,
          effectivePrice,
          packageQuantity,
          packageUnit,
          proofType: 'price_selector'
        });
        if (check.status === 'INVALID' || check.status === 'MISSING') return;

        const unitPriceLabel = $(el).find('[data-test="product-price-type-label"]').first().text().trim();
        let unitPrice: number | undefined = undefined;
        let unitPriceMeasure: string | undefined = undefined;
        if (unitPriceLabel) {
          const upMatch = unitPriceLabel.match(/(\d+(?:[.,]\d+)?)\s*lei/i);
          if (upMatch) {
            unitPrice = parseFloat(upMatch[1].replace(',', '.'));
            unitPriceMeasure = unitPriceLabel.toLowerCase().includes('kg') ? 'lei/kg' : unitPriceLabel.toLowerCase().includes('l') ? 'lei/l' : 'lei/buc';
          }
        }

        let discountPercentage: number | undefined = undefined;
        if (loyaltyPrice && standardPrice > loyaltyPrice) {
          discountPercentage = Math.round(((standardPrice - loyaltyPrice) / standardPrice) * 100);
        }

        offers.push({
          rawTitle: title,
          normalPrice: standardPrice,
          promoPrice: !loyaltyPrice && effectivePrice < standardPrice ? effectivePrice : undefined,
          loyaltyPrice,
          effectivePrice,
          currency: 'RON',
          priceType: loyaltyPrice ? 'loyalty_card' : 'standard',
          discountPercentage,
          packageQuantity,
          packageUnit,
          weight: pkg.weight,
          volume: pkg.volume,
          packageSize: pkg.packageSize,
          priceProofType: 'price_selector',
          unitPrice,
          unitPriceMeasure,
          isPromo: Boolean(loyaltyPrice || (effectivePrice < standardPrice)),
          promoDetails: loyaltyPrice ? `Preț avantajos cu PENNY Card (-${discountPercentage || 0}%)` : undefined,
          loyaltyCardName: loyaltyPrice ? 'PENNY Card' : undefined,
          loyaltyCardRequired: Boolean(loyaltyPrice),
          validFrom,
          validUntil,
          imageUrl,
          storeOrRegion: 'PENNY România Național',
          targetAudience: 'general',
          confidenceScore: 0.98
        });
      } catch {
        // continue
      }
    });

    return {
      success: offers.length > 0,
      offers,
      totalExtracted: offers.length,
      format: 'html',
      warnings
    };
  }

  /**
   * Parsează revista promoțională și catalogul lunar Mega Image (Publitas spreads.json)
   */
  static parseMegaImageCatalog(content: string, baseUrl?: string): ParseResult {
    const offers: RawParsedOffer[] = [];
    const warnings: string[] = [];

    try {
      let spreads: any[] = [];
      const trimmed = content.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          spreads = Array.isArray(parsed) ? parsed : (parsed.spreads || []);
        } catch {
          // fallback
        }
      }

      if (spreads.length > 0) {
        for (const spread of spreads) {
          for (const page of (spread.pages || [])) {
            if (!page.text) continue;
            const text: string = page.text;
            // Respinge pagini din rapoarte corporative / ESG / Taxonomie UE (ex: CCM 7.3)
            if (/\b(?:Taxonomie\s+UE|Activit[ăa][țt]i\s+economice|Raport\s+(?:anual|de\s+sustenabilitate)|CCM\s*\d+(?:[.,]\d+)?|EBITDA|EU\s+Taxonomy)\b/i.test(text) && !/\bLEI\b/i.test(text)) {
              warnings.push('Pagină Publitas Mega Image ignorată (document corporativ/sustenabilitate, nu catalog de prețuri).');
              continue;
            }
            const pageImageUrl = this.resolveImageUrl(
              page.images?.[0]?.url || page.image || page.thumbnailUrl || spread.images?.[0]?.url,
              baseUrl || 'https://www.mega-image.ro'
            );
            const normalizedText = text.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
            const lines = normalizedText.split('\n').map((l: string) => l.trim()).filter(Boolean);

            let validFrom: string | undefined = undefined;
            let validUntil: string | undefined = undefined;
            const dateMatch = normalizedText.match(/(\d{2}\.\d{2})\s*[-–]\s*(\d{2}\.\d{2}\.(\d{4}))/);
            if (dateMatch) {
              const y = dateMatch[3];
              const [d1, m1] = dateMatch[1].split('.');
              const [d2, m2] = dateMatch[2].split('.');
              validFrom = `${y}-${m1}-${d1}`;
              validUntil = `${y}-${m2}-${d2}`;
            }

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              // Necesită explicit LEI/RON pe linie SAU linie decimală neatașată unei unități fizice
              const nextLine = lines[i + 1] || '';
              if (/^(?:kg|gr|g|ml|cl|l|buc|role|%)\b/i.test(nextLine)) continue;

              const priceMatch = line.match(/^(\d{1,4}(?:[.,]\d{2})?)\s*(LEI(?:\/BUC\.?|\/KG|\/L)?|RON)$/i)
                || (normalizedText.toUpperCase().includes('LEI') ? line.match(/^(\d{1,4}[.,]\d{2})$/) : null);

              if (priceMatch && i > 0) {
                const rawPrice = parseFloat(priceMatch[1].replace(',', '.'));
                const hasCurrencySuffix = Boolean(priceMatch[2]);
                if (rawPrice >= 0.2 && rawPrice < 5000) {
                  let title = lines[i - 1];
                  if (i > 1 && (lines[i - 1].startsWith('AMBALAT') || lines[i - 1].startsWith('CAL.') || lines[i - 1].match(/^\d+\s*(?:G|KG|ML|L|BUC)/i))) {
                    title = `${lines[i - 2]} ${lines[i - 1]}`;
                  }
                  if (
                    !title ||
                    PriceExtractor.isNoiseOrNonProductTitle(title) ||
                    title.includes('LEI') ||
                    title.includes('Nr.') ||
                    title.startsWith('DOAR') ||
                    title.includes('BUN PENTRU') ||
                    title.startsWith('-') ||
                    title.includes('%')
                  ) {
                    continue;
                  }

                  let loyaltyPrice: number | undefined = undefined;
                  let hasLoyalty = false;
                  let discount: number | undefined = undefined;

                  for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
                    const lookLine = lines[j];
                    if (lookLine.includes('CARD CONNECT') || lookLine.includes('CONNECT')) {
                      hasLoyalty = true;
                    }
                    const discMatch = lookLine.match(/-\s*(\d+)\s*%/);
                    if (discMatch) {
                      discount = parseInt(discMatch[1], 10);
                    }
                    // Preț secundar STRICT dacă are LEI/RON sau zecimal explicit după CARD CONNECT (fără p2 / 100!)
                    const pMatch = lookLine.match(/^(\d{1,4}(?:[.,]\d{2})?)\s*(LEI|RON)\b/i)
                      || (hasLoyalty ? lookLine.match(/^(\d{1,4}[.,]\d{2})$/) : null);
                    if (pMatch && !loyaltyPrice && j !== i) {
                      const p2 = parseFloat(pMatch[1].replace(',', '.'));
                      if (p2 >= 0.2 && p2 < 5000 && p2 !== rawPrice) {
                        loyaltyPrice = p2;
                      }
                    }
                  }

                  const pkg = PriceExtractor.extractPackagingSafely(title);
                  const effectivePrice = loyaltyPrice || rawPrice;
                  const validation = PriceExtractor.validateOfferPrice({
                    title,
                    normalPrice: rawPrice,
                    promoPrice: !hasLoyalty && loyaltyPrice && loyaltyPrice < rawPrice ? loyaltyPrice : undefined,
                    loyaltyPrice: hasLoyalty ? loyaltyPrice : undefined,
                    effectivePrice,
                    packageQuantity: pkg.packageQuantity,
                    packageUnit: pkg.packageUnit,
                    rawPriceText: line,
                    proofType: hasCurrencySuffix ? 'currency_label' : 'contextual_decimal'
                  });
                  if (validation.status === 'INVALID' || validation.status === 'MISSING') {
                    continue;
                  }

                  offers.push({
                    rawTitle: title,
                    normalPrice: rawPrice,
                    promoPrice: !hasLoyalty && loyaltyPrice && loyaltyPrice < rawPrice ? loyaltyPrice : undefined,
                    loyaltyPrice: hasLoyalty ? loyaltyPrice : undefined,
                    effectivePrice,
                    currency: 'RON',
                    priceType: hasLoyalty ? 'loyalty_card' : (effectivePrice < rawPrice ? 'promotional' : 'standard'),
                    discountPercentage: discount,
                    packageQuantity: pkg.packageQuantity,
                    packageUnit: pkg.packageUnit,
                    weight: pkg.weight,
                    volume: pkg.volume,
                    packageSize: pkg.packageSize,
                    priceProofType: hasCurrencySuffix ? 'currency_label' : 'contextual_decimal',
                    isPromo: hasLoyalty || Boolean(discount),
                    promoDetails: hasLoyalty
                      ? `Ofertă exclusivă cu Card Connect Mega Image (-${discount || 20}%)`
                      : (discount ? `Reducere -${discount}%` : undefined),
                    loyaltyCardName: hasLoyalty ? 'Card Connect' : undefined,
                    loyaltyCardRequired: hasLoyalty,
                    validFrom,
                    validUntil,
                    imageUrl: pageImageUrl,
                    storeOrRegion: 'Mega Image România',
                    targetAudience: 'general',
                    confidenceScore: 0.92
                  });
                }
              }
            }
          }
        }
      } else {
        return this.parseHtmlCatalog(content, 'mega-image', baseUrl);
      }
    } catch (err: any) {
      warnings.push(`Eroare la parsarea Publitas Mega Image: ${err.message}`);
    }

    const uniqueMap = new Map<string, RawParsedOffer>();
    for (const o of offers) {
      const key = `${o.rawTitle.toLowerCase()}-${o.effectivePrice}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, o);
      }
    }

    const uniqueOffers = Array.from(uniqueMap.values());

    return {
      success: uniqueOffers.length > 0,
      offers: uniqueOffers,
      totalExtracted: uniqueOffers.length,
      format: 'html',
      warnings
    };
  }

  /**
   * Parsează produsele, prețurile și promoțiile direct din magazinul online oficial Auchan România (auchan.ro)
   * Suportă starea VTEX IO Apollo __STATE__, răspunsuri REST JSON (/api/catalog_system/pub/products/search)
   * și metadate Schema.org Product JSON-LD din paginile de produs.
   */
  static parseAuchanOnlineStore(content: Buffer | string, pageUrl?: string): ParseResult {
    const offers: RawParsedOffer[] = [];
    const warnings: string[] = [];
    const text = typeof content === 'string' ? content : content.toString('utf-8');
    const trimmed = text.trim();

    try {
      // 1. Încercare parsare directă dacă conținutul este un JSON array (de ex. din API-ul public de căutare VTEX)
      if (trimmed.startsWith('[') || (trimmed.startsWith('{') && !trimmed.includes('<html') && !trimmed.includes('<!DOCTYPE'))) {
        try {
          const parsed = JSON.parse(trimmed);
          const productList: any[] = Array.isArray(parsed) ? parsed : (parsed.products || parsed.items || []);
          if (productList.length > 0) {
            for (const p of productList) {
              if (!p || !p.productName) continue;
              const sku = p.items?.[0];
              if (!sku) continue;
              const seller = sku.sellers?.[0];
              const commOffer = seller?.commertialOffer;
              if (!commOffer || typeof commOffer.Price !== 'number') continue;

              const normalPrice = commOffer.ListPrice && commOffer.ListPrice > commOffer.Price
                ? commOffer.ListPrice
                : commOffer.Price;
              const effectivePrice = commOffer.Price;

              let isMyClub = false;
              let discountPercentage: number | undefined = undefined;
              let validFrom: string | undefined = undefined;
              let validUntil: string | undefined = undefined;
              let promoDetails: string | undefined = undefined;

              if (commOffer.discountHighlights && commOffer.discountHighlights.length > 0) {
                for (const dh of commOffer.discountHighlights) {
                  const dhName = dh.name || '';
                  promoDetails = dhName;
                  if (/myclub|blueloyalty/i.test(dhName)) {
                    isMyClub = true;
                    const dMatch = dhName.match(/BLUELOYALTY_(\d+(?:\.\d+)?)/i) || dhName.match(/(\d+)%\s*REDUCERE/i);
                    if (dMatch) discountPercentage = Math.round(parseFloat(dMatch[1]));
                    const dateMatch = dhName.match(/START-DATE_(\d{2}\/\d{2}\/\d{4})_END-DATE_(\d{2}\/\d{2}\/\d{4})/i);
                    if (dateMatch) {
                      const [m1, d1, y1] = dateMatch[1].split('/');
                      const [m2, d2, y2] = dateMatch[2].split('/');
                      validFrom = `${y1}-${m1}-${d1}`;
                      validUntil = `${y2}-${m2}-${d2}`;
                    }
                  }
                }
              }

              if (!discountPercentage && normalPrice > effectivePrice) {
                discountPercentage = Math.round(((normalPrice - effectivePrice) / normalPrice) * 100);
              }

              const pkg = PriceExtractor.extractPackagingSafely(p.productName);
              const packageQuantity = pkg.packageQuantity;
              const packageUnit = pkg.packageUnit;

              let unitPrice: number | undefined = undefined;
              let unitPriceMeasure: string | undefined = undefined;
              if (packageQuantity && packageUnit) {
                if (packageUnit === 'g') {
                  unitPrice = Math.round((effectivePrice / (packageQuantity / 1000)) * 100) / 100;
                  unitPriceMeasure = 'lei/kg';
                } else if (packageUnit === 'kg') {
                  unitPrice = Math.round((effectivePrice / packageQuantity) * 100) / 100;
                  unitPriceMeasure = 'lei/kg';
                } else if (packageUnit === 'ml') {
                  unitPrice = Math.round((effectivePrice / (packageQuantity / 1000)) * 100) / 100;
                  unitPriceMeasure = 'lei/l';
                } else if (packageUnit === 'l') {
                  unitPrice = Math.round((effectivePrice / packageQuantity) * 100) / 100;
                  unitPriceMeasure = 'lei/l';
                } else if (packageUnit === 'buc') {
                  unitPrice = Math.round((effectivePrice / packageQuantity) * 100) / 100;
                  unitPriceMeasure = 'lei/buc';
                }
              }

              const isPromo = isMyClub || Boolean(effectivePrice < normalPrice);
              const imageUrl = this.resolveImageUrl(sku.images?.[0]?.imageUrl, pageUrl || 'https://www.auchan.ro');
              const productUrl = p.link ? (p.link.startsWith('http') ? p.link : `https://www.auchan.ro${p.link}`) : undefined;

              offers.push({
                rawTitle: p.productName,
                rawBrand: p.brand,
                rawBarcode: sku.ean || undefined,
                rawCategory: p.categories?.[0] || undefined,
                normalPrice,
                promoPrice: !isMyClub && effectivePrice < normalPrice ? effectivePrice : undefined,
                loyaltyPrice: isMyClub ? effectivePrice : undefined,
                effectivePrice,
                currency: 'RON',
                priceType: isMyClub ? 'loyalty_card' : (effectivePrice < normalPrice ? 'promotional' : 'standard'),
                discountPercentage,
                packageQuantity,
                packageUnit,
                unitPrice,
                unitPriceMeasure,
                isPromo,
                promoDetails: isMyClub ? `Ofertă exclusivă cu Card MyCLUB Auchan (-${discountPercentage || 20}%)` : promoDetails,
                loyaltyCardName: isMyClub ? 'Card MyCLUB Auchan' : undefined,
                loyaltyCardRequired: isMyClub,
                validFrom,
                validUntil: validUntil || (commOffer.PriceValidUntil ? commOffer.PriceValidUntil.split('T')[0] : undefined),
                imageUrl,
                catalogUrl: productUrl,
                sourcePageUrl: pageUrl || 'https://www.auchan.ro/promotii',
                storeOrRegion: 'Magazin Online Național Auchan România',
                targetAudience: 'general',
                confidenceScore: 0.95
              });
            }
          }
        } catch {
          // continuă la parsarea HTML
        }
      }

      // 2. Extragere din HTML: State VTEX IO (__STATE__)
      const startTag = `data-varname="__STATE__">`;
      let startIdx = text.indexOf(startTag);
      if (startIdx === -1) {
        startIdx = text.indexOf(`data-var="__STATE__">`);
      }

      if (startIdx !== -1) {
        const scriptStart = text.indexOf('<script>', startIdx);
        const scriptEnd = text.indexOf('</script>', scriptStart);
        if (scriptStart !== -1 && scriptEnd !== -1) {
          try {
            const jsonText = text.substring(scriptStart + 8, scriptEnd);
            const state = JSON.parse(jsonText);
            const productKeys = Object.keys(state).filter(k => k.startsWith('Product:sp-') || (k.startsWith('Product:') && !k.includes('.')));

            for (const pKey of productKeys) {
              const p = state[pKey];
              if (!p || !p.productName) continue;

              const itemsRef = p['items({"filter":"ALL_AVAILABLE"})'] || p.items || [];
              if (!itemsRef.length) continue;

              const skuRef = itemsRef[0];
              const sku = (skuRef.id && state[skuRef.id]) ? state[skuRef.id] : skuRef;
              if (!sku) continue;

              const sellersRef = sku.sellers || [];
              if (!sellersRef.length) continue;

              const sellerRef = sellersRef[0];
              const seller = (sellerRef.id && state[sellerRef.id]) ? state[sellerRef.id] : sellerRef;
              if (!seller || !seller.commertialOffer) continue;

              const offerRef = seller.commertialOffer;
              const offer = (offerRef.id && state[offerRef.id]) ? state[offerRef.id] : offerRef;
              if (!offer || typeof offer.Price !== 'number') continue;

              let imageUrl: string | undefined = undefined;
              if (sku.images && sku.images.length > 0) {
                const imgRef = sku.images[0];
                const img = (imgRef.id && state[imgRef.id]) ? state[imgRef.id] : imgRef;
                if (img && img.imageUrl) {
                  imageUrl = this.resolveImageUrl(img.imageUrl, pageUrl || 'https://www.auchan.ro');
                }
              }

              let isMyClub = false;
              let discountPercentage: number | undefined = undefined;
              let validFrom: string | undefined = undefined;
              let validUntil: string | undefined = undefined;
              let promoDetails: string | undefined = undefined;

              if (offer.discountHighlights && offer.discountHighlights.length > 0) {
                for (const dhRef of offer.discountHighlights) {
                  const dh = (dhRef.id && state[dhRef.id]) ? state[dhRef.id] : dhRef;
                  if (dh && dh.name) {
                    promoDetails = dh.name;
                    if (/myclub|blueloyalty/i.test(dh.name)) {
                      isMyClub = true;
                      const dMatch = dh.name.match(/BLUELOYALTY_(\d+(?:\.\d+)?)/i) || dh.name.match(/(\d+)%\s*REDUCERE/i);
                      if (dMatch) discountPercentage = Math.round(parseFloat(dMatch[1]));
                      const dateMatch = dh.name.match(/START-DATE_(\d{2}\/\d{2}\/\d{4})_END-DATE_(\d{2}\/\d{2}\/\d{4})/i);
                      if (dateMatch) {
                        const [m1, d1, y1] = dateMatch[1].split('/');
                        const [m2, d2, y2] = dateMatch[2].split('/');
                        validFrom = `${y1}-${m1}-${d1}`;
                        validUntil = `${y2}-${m2}-${d2}`;
                      }
                    }
                  }
                }
              }

              const normalPrice = offer.ListPrice && offer.ListPrice > offer.Price ? offer.ListPrice : offer.Price;
              const effectivePrice = offer.Price;

              if (!discountPercentage && normalPrice > effectivePrice) {
                discountPercentage = Math.round(((normalPrice - effectivePrice) / normalPrice) * 100);
              }

              const pkg = PriceExtractor.extractPackagingSafely(p.productName);
              const packageQuantity = pkg.packageQuantity;
              const packageUnit = pkg.packageUnit;

              let unitPrice: number | undefined = undefined;
              let unitPriceMeasure: string | undefined = undefined;
              if (packageQuantity && packageUnit) {
                if (packageUnit === 'g') {
                  unitPrice = Math.round((effectivePrice / (packageQuantity / 1000)) * 100) / 100;
                  unitPriceMeasure = 'lei/kg';
                } else if (packageUnit === 'kg') {
                  unitPrice = Math.round((effectivePrice / packageQuantity) * 100) / 100;
                  unitPriceMeasure = 'lei/kg';
                } else if (packageUnit === 'ml') {
                  unitPrice = Math.round((effectivePrice / (packageQuantity / 1000)) * 100) / 100;
                  unitPriceMeasure = 'lei/l';
                } else if (packageUnit === 'l') {
                  unitPrice = Math.round((effectivePrice / packageQuantity) * 100) / 100;
                  unitPriceMeasure = 'lei/l';
                } else if (packageUnit === 'buc') {
                  unitPrice = Math.round((effectivePrice / packageQuantity) * 100) / 100;
                  unitPriceMeasure = 'lei/buc';
                }
              }

              const isPromo = isMyClub || Boolean(effectivePrice < normalPrice);
              const productUrl = p.link ? (p.link.startsWith('http') ? p.link : `https://www.auchan.ro${p.link}`) : undefined;

              offers.push({
                rawTitle: p.productName,
                rawBrand: p.brand,
                rawBarcode: sku.ean || undefined,
                rawCategory: p.categories?.json?.[0] || undefined,
                normalPrice,
                promoPrice: !isMyClub && effectivePrice < normalPrice ? effectivePrice : undefined,
                loyaltyPrice: isMyClub ? effectivePrice : undefined,
                effectivePrice,
                currency: 'RON',
                priceType: isMyClub ? 'loyalty_card' : (effectivePrice < normalPrice ? 'promotional' : 'standard'),
                discountPercentage,
                packageQuantity,
                packageUnit,
                unitPrice,
                unitPriceMeasure,
                isPromo,
                promoDetails: isMyClub ? `Ofertă exclusivă cu Card MyCLUB Auchan (-${discountPercentage || 20}%)` : promoDetails,
                loyaltyCardName: isMyClub ? 'Card MyCLUB Auchan' : undefined,
                loyaltyCardRequired: isMyClub,
                validFrom,
                validUntil: validUntil || (offer.PriceValidUntil ? offer.PriceValidUntil.split('T')[0] : undefined),
                imageUrl,
                catalogUrl: productUrl,
                sourcePageUrl: pageUrl || 'https://www.auchan.ro/promotii',
                storeOrRegion: 'Magazin Online Național Auchan România',
                targetAudience: 'general',
                confidenceScore: 0.95
              });
            }
          } catch (err: any) {
            warnings.push(`Eroare la parsarea __STATE__ Auchan: ${err.message}`);
          }
        }
      }

      // 3. Fallback Schema.org JSON-LD dacă nu au fost extrase oferte din __STATE__
      if (offers.length === 0 && text.includes('application/ld+json')) {
        const ldMatches = text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
        if (ldMatches) {
          for (const m of ldMatches) {
            try {
              const contentInside = m.replace(/<script type="application\/ld\+json">|<\/script>/g, '').trim();
              const ld = JSON.parse(contentInside);
              const ldList = Array.isArray(ld) ? ld : [ld];
              for (const item of ldList) {
                if (item['@type'] === 'Product' && item.name && item.offers) {
                  const offerObj = Array.isArray(item.offers.offers) ? item.offers.offers[0] : item.offers;
                  const price = typeof offerObj?.price === 'number' ? offerObj.price : parseFloat(offerObj?.price || '0');
                  if (price > 0) {
                    offers.push({
                      rawTitle: item.name,
                      rawBrand: typeof item.brand === 'object' ? item.brand?.name : item.brand,
                      rawBarcode: item.sku || item.mpn || undefined,
                      normalPrice: price,
                      effectivePrice: price,
                      currency: offerObj?.priceCurrency || 'RON',
                      priceType: 'standard',
                      isPromo: false,
                      validUntil: offerObj?.priceValidUntil ? offerObj.priceValidUntil.split('T')[0] : undefined,
                      imageUrl: this.resolveImageUrl(item.image, pageUrl || 'https://www.auchan.ro'),
                      catalogUrl: item['@id'] || pageUrl,
                      sourcePageUrl: pageUrl || 'https://www.auchan.ro/',
                      storeOrRegion: 'Magazin Online Național Auchan România',
                      targetAudience: 'general',
                      confidenceScore: 0.90
                    });
                  }
                }
              }
            } catch {
              // ignore invalid JSON-LD block
            }
          }
        }
      }
    } catch (err: any) {
      warnings.push(`Eroare generală la parsarea magazinului online Auchan: ${err.message}`);
    }

    // Deduplicare
    const uniqueMap = new Map<string, RawParsedOffer>();
    for (const o of offers) {
      const key = `${o.rawTitle.toLowerCase()}-${o.effectivePrice}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, o);
      }
    }
    const uniqueOffers = Array.from(uniqueMap.values());

    return {
      success: uniqueOffers.length > 0,
      offers: uniqueOffers,
      totalExtracted: uniqueOffers.length,
      format: 'html',
      warnings
    };
  }

  /**
   * Parsează cataloage în format CSV
   */
  static parseCsvCatalog(csvText: string, baseUrl?: string): ParseResult {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return { success: false, offers: [], totalExtracted: 0, format: 'csv', error: 'Fișier CSV fără rânduri de date.' };
    }

    const splitCsvRow = (row: string, sep: string): string[] => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let idx = 0; idx < row.length; idx++) {
        const ch = row[idx];
        if (ch === '"') {
          if (inQuotes && row[idx + 1] === '"') {
            current += '"';
            idx++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (!inQuotes && ch === sep) {
          cells.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current.trim().replace(/^["']|["']$/g, ''));
      return cells;
    };

    const firstLine = lines[0];
    const separator = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
    const header = splitCsvRow(firstLine.toLowerCase(), separator);
    const nameIdx = header.findIndex(h => h.includes('produs') || h.includes('name') || h.includes('denumire') || h.includes('title'));
    const priceIdx = header.findIndex(h => h === 'price' || h === 'pret' || h === 'valoare' || (!h.includes('normal') && (h.includes('pret') || h.includes('price'))));
    const normalPriceIdx = header.findIndex(h => h.includes('normal') || h.includes('vechi') || h.includes('original'));
    const barcodeIdx = header.findIndex(h => h.includes('barcode') || h.includes('ean') || h.includes('gtin') || h.includes('cod'));
    const brandIdx = header.findIndex(h => h.includes('brand') || h.includes('marca'));
    const imageIdx = header.findIndex(h => h.includes('image') || h.includes('imagine') || h.includes('img') || h.includes('poza') || h.includes('photo'));

    if (nameIdx === -1 || priceIdx === -1) {
      return { success: false, offers: [], totalExtracted: 0, format: 'csv', error: 'Coloanele "denumire" și "pret" nu au fost identificate în antetul CSV.' };
    }

    const offers: RawParsedOffer[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvRow(lines[i], separator);
      const title = cols[nameIdx];
      const rawPrice = cols[priceIdx];
      const price = PriceExtractor.parseExplicitPriceField(rawPrice);
      const parsedNormal = normalPriceIdx !== -1 ? PriceExtractor.parseExplicitPriceField(cols[normalPriceIdx]) : null;
      const normalPrice = parsedNormal && parsedNormal >= (price || 0) ? parsedNormal : price;

      if (title && !PriceExtractor.isNoiseOrNonProductTitle(title) && price !== null && price > 0) {
        const pkg = PriceExtractor.extractPackagingSafely(title);
        const check = PriceExtractor.validateOfferPrice({
          title,
          normalPrice: normalPrice ?? price,
          promoPrice: normalPrice && normalPrice > price ? price : undefined,
          effectivePrice: price,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          rawPriceText: rawPrice,
          proofType: 'explicit_field'
        });
        if (check.status === 'INVALID' || check.status === 'MISSING') continue;

        offers.push({
          rawTitle: title,
          rawBrand: brandIdx !== -1 ? cols[brandIdx] : undefined,
          rawBarcode: barcodeIdx !== -1 ? cols[barcodeIdx] : undefined,
          imageUrl: imageIdx !== -1 ? this.resolveImageUrl(cols[imageIdx], baseUrl) : undefined,
          normalPrice: normalPrice ?? price,
          promoPrice: normalPrice && normalPrice > price ? price : undefined,
          effectivePrice: price,
          currency: 'RON',
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          weight: pkg.weight,
          volume: pkg.volume,
          packageSize: pkg.packageSize,
          priceProofType: 'explicit_field',
          isPromo: Boolean(normalPrice && normalPrice > price),
          confidenceScore: 0.95
        });
      }
    }

    return {
      success: offers.length > 0,
      offers,
      totalExtracted: offers.length,
      format: 'csv'
    };
  }

  /**
   * Parsează cataloage în format XML
   */
  static parseXmlCatalog(xmlText: string, baseUrl?: string): ParseResult {
    const $ = cheerio.load(xmlText, { xmlMode: true });
    const offers: RawParsedOffer[] = [];

    $('item, product, offer, element').each((_, el) => {
      const title = $(el).find('name, title, denumire').first().text().trim();
      const rawPrice = $(el).find('price, pret, valoare').first().text().trim();
      const price = PriceExtractor.parseExplicitPriceField(rawPrice);
      const barcode = $(el).find('barcode, ean, gtin').first().text().trim();
      const brand = $(el).find('brand, marca').first().text().trim();
      const rawImage = $(el).find('image, image_url, imageUrl, img, imagine, picture').first().text().trim();
      const imageUrl = this.resolveImageUrl(rawImage, baseUrl);

      if (title && !PriceExtractor.isNoiseOrNonProductTitle(title) && price !== null && price > 0) {
        const pkg = PriceExtractor.extractPackagingSafely(title);
        const check = PriceExtractor.validateOfferPrice({
          title,
          normalPrice: price,
          effectivePrice: price,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          rawPriceText: rawPrice,
          proofType: 'explicit_field'
        });
        if (check.status === 'INVALID' || check.status === 'MISSING') return;

        offers.push({
          rawTitle: title,
          rawBrand: brand || undefined,
          rawBarcode: barcode || undefined,
          imageUrl,
          normalPrice: price,
          effectivePrice: price,
          currency: 'RON',
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          weight: pkg.weight,
          volume: pkg.volume,
          packageSize: pkg.packageSize,
          priceProofType: 'explicit_field',
          isPromo: false,
          confidenceScore: 0.95
        });
      }
    });

    return {
      success: offers.length > 0,
      offers,
      totalExtracted: offers.length,
      format: 'xml'
    };
  }
}
