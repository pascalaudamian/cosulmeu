// src/indexing/catalog/CatalogParserEngine.ts
// Motor unificat de parsare a cataloagelor (HTML, PDF, CSV, XML)

import * as cheerio from 'cheerio';
import { CatalogFormat } from './catalogTypes.js';

export interface RawParsedOffer {
  rawTitle: string;
  rawBrand?: string;
  rawBarcode?: string;
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
    retailerId?: string
  ): Promise<ParseResult> {
    try {
      if (format === 'html') {
        const htmlText = typeof content === 'string' ? content : content.toString('utf-8');
        if (retailerId === 'carrefour') {
          return CatalogParserEngine.parseCarrefourCatalog(htmlText);
        } else if (retailerId === 'penny') {
          return CatalogParserEngine.parsePennyCatalog(htmlText);
        } else if (retailerId === 'mega-image') {
          return CatalogParserEngine.parseMegaImageCatalog(htmlText);
        } else if (retailerId === 'auchan') {
          return CatalogParserEngine.parseAuchanOnlineStore(htmlText);
        }
        return CatalogParserEngine.parseHtmlCatalog(htmlText, retailerId);
      } else if (format === 'pdf') {
        const buffer = typeof content === 'string' ? Buffer.from(content) : content;
        return await CatalogParserEngine.parsePdfCatalog(buffer);
      } else if (format === 'csv') {
        const csvText = typeof content === 'string' ? content : content.toString('utf-8');
        return CatalogParserEngine.parseCsvCatalog(csvText);
      } else if (format === 'xml') {
        const xmlText = typeof content === 'string' ? content : content.toString('utf-8');
        return CatalogParserEngine.parseXmlCatalog(xmlText);
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

  /**
   * Parsează cataloage HTML (inclusiv suport avansat pentru structura Lidl România)
   */
  static parseHtmlCatalog(html: string, retailerId?: string): ParseResult {
    const $ = cheerio.load(html);
    const offers: RawParsedOffer[] = [];
    const products: RawCatalogProduct[] = [];
    const warnings: string[] = [];

    // 1. Verificare JSON-LD structurat
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const text = $(el).html();
        if (!text) return;
        const data = JSON.parse(text);
        const items = Array.isArray(data) ? data : data['@graph'] || [data];
        for (const item of items) {
          if (item['@type'] === 'Product' || item.offers) {
            const offerObj = item.offers || {};
            const price = parseFloat(offerObj.price || item.price);
            if (!isNaN(price) && price > 0 && item.name) {
              offers.push({
                rawTitle: item.name.trim(),
                rawBrand: item.brand?.name || (typeof item.brand === 'string' ? item.brand : undefined),
                rawBarcode: item.gtin13 || item.gtin8 || item.sku,
                rawCategory: typeof item.category === 'string' ? item.category : undefined,
                normalPrice: price,
                effectivePrice: price,
                currency: offerObj.priceCurrency || 'RON',
                isPromo: Boolean(offerObj.discount || offerObj.priceValidUntil),
                validUntil: offerObj.priceValidUntil,
                confidenceScore: 0.95
              });
            }
          }
        }
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
            const cleanedPrice = priceText.replace(/[^\d,.]/g, '').replace(',', '.');
            normalPrice = parseFloat(cleanedPrice);
          }

          if (isNaN(normalPrice) || normalPrice <= 0) return;

          // Determinare gramaj / unitate
          if (!rawPackaging) {
            rawPackaging = data.price?.packaging?.text || data.packaging || $(el).find('.m-price__subline, .pricebox__basic-quantity').text().trim();
          }

          let pkgQty: number | undefined = undefined;
          let pkgUnit: string | undefined = undefined;

          if (rawPackaging) {
            const pkgMatch = rawPackaging.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
            if (pkgMatch) {
              pkgQty = parseFloat(pkgMatch[1].replace(',', '.'));
              pkgUnit = pkgMatch[2].toLowerCase();
            }
          }

          const effectivePrice = loyaltyPrice || promoPrice || normalPrice;
          if (isLidlPlus || Boolean(data.price?.loyaltyCardPrice || $(el).find('.lidl-plus, [data-loyalty]').length > 0)) {
            isLidlPlus = true;
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
            isPromo: Boolean(promoPrice || isLidlPlus || data.price?.discount),
            promoDetails: promoDetails || (isLidlPlus ? 'Preț exclusiv cu aplicația Lidl Plus' : promoPrice ? `Reducere promoțională de la ${normalPrice} lei` : undefined),
            loyaltyCardName: isLidlPlus ? 'Lidl Plus' : undefined,
            validFrom,
            validUntil,
            imageUrl: data.image || $(el).find('img').first().attr('src'),
            confidenceScore: 0.95
          });
        } catch (err: any) {
          warnings.push(`Eroare la parsarea unui card Lidl: ${err.message}`);
        }
      });
    }

    // 3. Parsare generică HTML carduri (pentru alte pagini de oferte sau cataloage online)
    if (offers.length === 0) {
      $('[class*="product"], [class*="offer"], [class*="card"], article').each((_, el) => {
        const title = $(el).find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim();
        const priceText = $(el).find('[class*="price"], .pret').first().text().trim();

        if (title.length >= 3 && priceText) {
          const matchPrice = priceText.match(/(\d+(?:[.,]\d+)?)\s*(?:lei|ron)?/i);
          if (matchPrice) {
            const parsedPrice = parseFloat(matchPrice[1].replace(',', '.'));
            if (!isNaN(parsedPrice) && parsedPrice > 0 && parsedPrice < 10000) {
              // Verificare dacă nu am adăugat deja exact aceeași denumire
              if (!offers.some(o => o.rawTitle.toLowerCase() === title.toLowerCase())) {
                offers.push({
                  rawTitle: title,
                  normalPrice: parsedPrice,
                  effectivePrice: parsedPrice,
                  currency: 'RON',
                  isPromo: /reducere|promo|discount|oferta/i.test($(el).text()),
                  confidenceScore: 0.75
                });
              }
            }
          }
        }
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
        if (title.length < 3 || seenProducts.has(key)) return;
        seenProducts.add(key);
        const packaging = String(data.packaging || data.price?.packaging?.text || $(el).find('.m-price__subline, .pricebox__basic-quantity').text() || '');
        const packageMatch = packaging.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
        products.push({
          rawTitle: title,
          rawBrand: typeof data.brand === 'string' ? data.brand : data.brand?.name,
          rawCategory: typeof data.category === 'string' ? data.category : data.category?.name,
          rawBarcode: data.gtin13 || data.gtin8 || data.sku,
          packageQuantity: packageMatch ? parseFloat(packageMatch[1].replace(',', '.')) : undefined,
          packageUnit: packageMatch?.[2]?.toLowerCase(),
          imageUrl: data.image || $(el).find('img').first().attr('src'),
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
            if (seenTitles.has(key) || /^(product|item|offer|category|brand)$/i.test(title)) continue;
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
      const priceRegex = /(\d+(?:[.,]\d{1,2}))\s*(?:lei|ron)/i;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(priceRegex);

        if (match) {
          const price = parseFloat(match[1].replace(',', '.'));
          if (isNaN(price) || price <= 0 || price > 5000) continue;

          let titleCandidate = line.replace(match[0], '').replace(/[.,\-_:;*]/g, ' ').trim();

          // Dacă titlul pe aceeași linie e prea scurt, combină cu linia precedentă
          if (titleCandidate.length < 3 && i > 0 && lines[i - 1].length >= 3) {
            titleCandidate = lines[i - 1];
          }

          if (titleCandidate.length >= 3) {
            // Extragere gramaj dacă există
            const pkgMatch = titleCandidate.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
            let pkgQty: number | undefined = undefined;
            let pkgUnit: string | undefined = undefined;
            if (pkgMatch) {
              pkgQty = parseFloat(pkgMatch[1].replace(',', '.'));
              pkgUnit = pkgMatch[2].toLowerCase();
            }

            const isPromo = /reducere|promo|discount|-?\d+%/i.test(line) || (i > 0 && /reducere|promo/i.test(lines[i - 1]));
            const normKey = titleCandidate.toLowerCase();
            if (!seenTitles.has(normKey)) {
              seenTitles.add(normKey);
              offers.push({
                rawTitle: titleCandidate,
                normalPrice: price,
                effectivePrice: price,
                currency: 'RON',
                packageQuantity: pkgQty,
                packageUnit: pkgUnit,
                isPromo,
                confidenceScore: Math.round(ocrConfidence * 0.8) / 100
              });
            }
          }
        }
      }

      // Euristică 2: Cataloage de supermarket tip revistă/pliant (prețuri decimale standalone adiacente denumirilor de produse)
      const disclaimers = [
        'limita stocului', 'consumului personal', 'toate imaginile', 'termeni si conditii',
        'studiu yougov', 'drepturi rezervate', 'oferta se aplica', 'reducerea este valabila',
        'declaratie', 'black friday', 'kaufland card', 'card fidelitate', 'pagina'
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

        if (disclaimers.some(d => lower.includes(d))) continue;
        if (line.length > 80 || line.length < 3) continue;

        const hasKeyword = foodKeywords.some(kw => lower.includes(kw));
        if (!hasKeyword) continue;

        // Căutare preț numeric standalone în proximitate (+/- 5 linii)
        let foundPrice: number | null = null;
        let promoPct: string | null = null;

        for (let offset = -5; offset <= 5; offset++) {
          const neighbor = lines[i + offset];
          if (!neighbor) continue;
          if (/^\d{1,3}[.,]\d{2}$/.test(neighbor)) {
            const val = parseFloat(neighbor.replace(',', '.'));
            if (val >= 0.5 && val <= 500) {
              foundPrice = val;
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
            const packageMatch = line.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
            products.push({
              rawTitle: line,
              rawBrand: i > 0 && lines[i - 1].length <= 30 ? lines[i - 1] : undefined,
              packageQuantity: packageMatch ? parseFloat(packageMatch[1].replace(',', '.')) : undefined,
              packageUnit: packageMatch?.[2]?.toLowerCase(),
              confidenceScore: Math.round(ocrConfidence * 0.6) / 100
            });
          }
        }

        if (foundPrice) {
          let pkgQty: number | undefined = undefined;
          let pkgUnit: string | undefined = undefined;

          for (let offset = -2; offset <= 2; offset++) {
            const neighbor = lines[i + offset];
            if (!neighbor) continue;
            const m = neighbor.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
            if (m) {
              pkgQty = parseFloat(m[1].replace(',', '.'));
              pkgUnit = m[2].toLowerCase();
              break;
            }
          }

          let brand: string | undefined = undefined;
          if (i > 0) {
            const prev = lines[i - 1];
            if (
              prev.length >= 2 &&
              prev.length <= 25 &&
              !disclaimers.some(d => prev.toLowerCase().includes(d)) &&
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

          if (cleanTitle.length >= 3 && !disclaimers.some(d => cleanTitle.toLowerCase().includes(d))) {
            const normKey = cleanTitle.toLowerCase();
            if (!seenTitles.has(normKey)) {
              seenTitles.add(normKey);
              offers.push({
                rawTitle: cleanTitle,
                rawBrand: brand,
                normalPrice: foundPrice,
                effectivePrice: foundPrice,
                currency: 'RON',
                packageQuantity: pkgQty,
                packageUnit: pkgUnit,
                isPromo: Boolean(promoPct),
                confidenceScore: 0.85
              });
            }
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
  static parseCarrefourCatalog(html: string): ParseResult {
    const $ = cheerio.load(html);
    const offers: RawParsedOffer[] = [];
    const warnings: string[] = [];

    $('.product_info').each((_, el) => {
      try {
        const title = ($(el).find('.product_title span').first().text().trim() || $(el).find('.product_title').first().text().trim());
        if (!title || title.length < 2) return;

        // Price wrappers
        const fullPriceInt = $(el).find('.Price_priceWrapperFull__HAvIg').first().text().trim();
        const decimalCurrency = $(el).find('.Price_priceWrapperDecimalCurrency__52Dsm').first().text().trim();
        const promoPriceNum = parseFloat(`${fullPriceInt}.${decimalCurrency.replace(/[^0-9]/g, '')}`);

        // Strike through price (regular price)
        const strikeInt = $(el).find('.Price_priceWrapperStrikeThrough__EvRr7 .Price_priceWrapperFull__HAvIg').text().trim();
        const strikeDec = $(el).find('.Price_priceWrapperStrikeThrough__EvRr7 .Price_priceWrapperDecimalCurrency__52Dsm').text().trim();
        const strikePriceNum = strikeInt ? parseFloat(`${strikeInt}.${strikeDec.replace(/[^0-9]/g, '')}`) : undefined;

        const isLoyalty = $(el).find('.PricesComponent_loyalty__Xl2Oq').length > 0;

        const normalPrice = strikePriceNum && !isNaN(strikePriceNum) ? strikePriceNum : promoPriceNum;
        const effectivePrice = !isNaN(promoPriceNum) && promoPriceNum > 0 ? promoPriceNum : normalPrice;
        let loyaltyPrice: number | undefined = undefined;

        if (isLoyalty) {
          loyaltyPrice = effectivePrice;
        }

        if (isNaN(effectivePrice) || effectivePrice <= 0) return;

        // Gramaj / volum din titlu
        let packageQuantity: number | undefined = undefined;
        let packageUnit: string | undefined = undefined;
        const pkgMatch = title.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
        if (pkgMatch) {
          packageQuantity = parseFloat(pkgMatch[1].replace(',', '.'));
          packageUnit = pkgMatch[2].toLowerCase();
        }

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
          unitPrice,
          unitPriceMeasure,
          isPromo: effectivePrice < normalPrice || isLoyalty,
          promoDetails: isLoyalty
            ? 'Ofertă cu cardul de fidelitate Carrefour Act For Good'
            : (discountPercentage ? `Reducere promoțională -${discountPercentage}%` : undefined),
          loyaltyCardName: isLoyalty ? 'Act For Good' : undefined,
          loyaltyCardRequired: isLoyalty,
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
  static parsePennyCatalog(html: string): ParseResult {
    const $ = cheerio.load(html);
    const offers: RawParsedOffer[] = [];
    const warnings: string[] = [];

    $('[data-test="product-tile"]').each((_, el) => {
      try {
        const title = $(el).find('[data-test="product-title"]').text().trim();
        if (!title) return;

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
          const num = parseFloat(valStr.replace(/[^\d,.]/g, '').replace(',', '.'));
          if (!isNaN(num) && num > 0) {
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

        let packageQuantity: number | undefined = undefined;
        let packageUnit: string | undefined = undefined;
        const pkgMatch = pieceDesc.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i) || title.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
        if (pkgMatch) {
          packageQuantity = parseFloat(pkgMatch[1].replace(',', '.'));
          packageUnit = pkgMatch[2].toLowerCase();
        }

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
          unitPrice,
          unitPriceMeasure,
          isPromo: Boolean(loyaltyPrice || (effectivePrice < standardPrice)),
          promoDetails: loyaltyPrice ? `Preț avantajos cu PENNY Card (-${discountPercentage || 0}%)` : undefined,
          loyaltyCardName: loyaltyPrice ? 'PENNY Card' : undefined,
          loyaltyCardRequired: Boolean(loyaltyPrice),
          validFrom,
          validUntil,
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
  static parseMegaImageCatalog(content: string): ParseResult {
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
              const priceMatch = line.match(/^(\d+(?:[.,]\d{2})?)\s*(?:LEI(?:\/BUC\.?|\/KG|\/L)?)?$/i);
              if (priceMatch && i > 0) {
                const rawPrice = parseFloat(priceMatch[1].replace(',', '.'));
                if (rawPrice > 0.1 && rawPrice < 1000) {
                  let title = lines[i - 1];
                  if (i > 1 && (lines[i - 1].startsWith('AMBALAT') || lines[i - 1].startsWith('CAL.') || lines[i - 1].match(/^\d+\s*(?:G|KG|ML|L|BUC)/i))) {
                    title = `${lines[i - 2]} ${lines[i - 1]}`;
                  }
                  if (
                    !title ||
                    title.length < 3 ||
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
                    const nextLine = lines[j];
                    if (nextLine.includes('CARD CONNECT') || nextLine.includes('CONNECT')) {
                      hasLoyalty = true;
                    }
                    const discMatch = nextLine.match(/-\s*(\d+)\s*%/);
                    if (discMatch) {
                      discount = parseInt(discMatch[1], 10);
                    }
                    const pMatch = nextLine.match(/^(\d{1,4}(?:[.,]\d{2})?)\s*(?:LEI)?/i);
                    if (pMatch && !loyaltyPrice && j !== i) {
                      let p2 = parseFloat(pMatch[1].replace(',', '.'));
                      if (p2 > 100 && !pMatch[1].includes('.') && !pMatch[1].includes(',')) {
                        p2 = p2 / 100;
                      }
                      if (p2 > 0.1 && p2 !== rawPrice) {
                        loyaltyPrice = p2;
                      }
                    }
                  }

                  let packageQuantity: number | undefined = undefined;
                  let packageUnit: string | undefined = undefined;
                  const pkgMatch = title.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
                  if (pkgMatch) {
                    packageQuantity = parseFloat(pkgMatch[1].replace(',', '.'));
                    packageUnit = pkgMatch[2].toLowerCase();
                  }

                  const effectivePrice = loyaltyPrice || rawPrice;

                  offers.push({
                    rawTitle: title,
                    normalPrice: rawPrice,
                    promoPrice: !hasLoyalty && loyaltyPrice && loyaltyPrice < rawPrice ? loyaltyPrice : undefined,
                    loyaltyPrice: hasLoyalty ? loyaltyPrice : undefined,
                    effectivePrice,
                    currency: 'RON',
                    priceType: hasLoyalty ? 'loyalty_card' : (effectivePrice < rawPrice ? 'promotional' : 'standard'),
                    discountPercentage: discount,
                    packageQuantity,
                    packageUnit,
                    isPromo: hasLoyalty || Boolean(discount),
                    promoDetails: hasLoyalty
                      ? `Ofertă exclusivă cu Card Connect Mega Image (-${discount || 20}%)`
                      : (discount ? `Reducere -${discount}%` : undefined),
                    loyaltyCardName: hasLoyalty ? 'Card Connect' : undefined,
                    loyaltyCardRequired: hasLoyalty,
                    validFrom,
                    validUntil,
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
        return this.parseHtmlCatalog(content, 'mega-image');
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

              let packageQuantity: number | undefined = undefined;
              let packageUnit: string | undefined = undefined;
              const pkgMatch = p.productName.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc|cl|m|cm)\b/i);
              if (pkgMatch) {
                packageQuantity = parseFloat(pkgMatch[1].replace(',', '.'));
                packageUnit = pkgMatch[2].toLowerCase();
              }

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
              const imageUrl = sku.images?.[0]?.imageUrl;
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
                if (img && img.imageUrl) imageUrl = img.imageUrl;
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

              let packageQuantity: number | undefined = undefined;
              let packageUnit: string | undefined = undefined;
              const pkgMatch = p.productName.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc|cl|m|cm)\b/i);
              if (pkgMatch) {
                packageQuantity = parseFloat(pkgMatch[1].replace(',', '.'));
                packageUnit = pkgMatch[2].toLowerCase();
              }

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
                      imageUrl: typeof item.image === 'string' ? item.image : (Array.isArray(item.image) ? item.image[0] : undefined),
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
  static parseCsvCatalog(csvText: string): ParseResult {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return { success: false, offers: [], totalExtracted: 0, format: 'csv', error: 'Fișier CSV fără rânduri de date.' };
    }

    const header = lines[0].toLowerCase().split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
    const nameIdx = header.findIndex(h => h.includes('produs') || h.includes('name') || h.includes('denumire') || h.includes('title'));
    const priceIdx = header.findIndex(h => h.includes('pret') || h.includes('price') || h.includes('valoare'));
    const barcodeIdx = header.findIndex(h => h.includes('barcode') || h.includes('ean') || h.includes('gtin') || h.includes('cod'));
    const brandIdx = header.findIndex(h => h.includes('brand') || h.includes('marca'));

    if (nameIdx === -1 || priceIdx === -1) {
      return { success: false, offers: [], totalExtracted: 0, format: 'csv', error: 'Coloanele "denumire" și "pret" nu au fost identificate în antetul CSV.' };
    }

    const offers: RawParsedOffer[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
      const title = cols[nameIdx];
      const rawPrice = cols[priceIdx]?.replace(',', '.');
      const price = parseFloat(rawPrice);

      if (title && !isNaN(price) && price > 0) {
        offers.push({
          rawTitle: title,
          rawBrand: brandIdx !== -1 ? cols[brandIdx] : undefined,
          rawBarcode: barcodeIdx !== -1 ? cols[barcodeIdx] : undefined,
          normalPrice: price,
          effectivePrice: price,
          currency: 'RON',
          isPromo: false,
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
  static parseXmlCatalog(xmlText: string): ParseResult {
    const $ = cheerio.load(xmlText, { xmlMode: true });
    const offers: RawParsedOffer[] = [];

    $('item, product, offer, element').each((_, el) => {
      const title = $(el).find('name, title, denumire').first().text().trim();
      const rawPrice = $(el).find('price, pret, valoare').first().text().trim().replace(',', '.');
      const price = parseFloat(rawPrice);
      const barcode = $(el).find('barcode, ean, gtin').first().text().trim();
      const brand = $(el).find('brand, marca').first().text().trim();

      if (title && !isNaN(price) && price > 0) {
        offers.push({
          rawTitle: title,
          rawBrand: brand || undefined,
          rawBarcode: barcode || undefined,
          normalPrice: price,
          effectivePrice: price,
          currency: 'RON',
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
