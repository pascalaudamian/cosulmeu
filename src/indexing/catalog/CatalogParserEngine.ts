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
        return this.parseHtmlCatalog(htmlText, retailerId);
      } else if (format === 'pdf') {
        const buffer = typeof content === 'string' ? Buffer.from(content) : content;
        return await this.parsePdfCatalog(buffer);
      } else if (format === 'csv') {
        const csvText = typeof content === 'string' ? content : content.toString('utf-8');
        return this.parseCsvCatalog(csvText);
      } else if (format === 'xml') {
        const xmlText = typeof content === 'string' ? content : content.toString('utf-8');
        return this.parseXmlCatalog(xmlText);
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
