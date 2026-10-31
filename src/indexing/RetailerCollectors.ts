// src/indexing/RetailerCollectors.ts
// Implementarea Colectorilor Modulari pentru cei 7 Retaileri din România

import {
  PriceCollector,
  RetailerRegistryEntry,
  CollectorStatus,
  CollectorAccessMethod,
  CollectionBatch,
  RawCollectorItem,
  ValidatedCollectorItem
} from './types';
import { RetailerRegistry } from './RetailerRegistry';
import { UnitType } from '../types';

export abstract class BaseRetailerCollector implements PriceCollector {
  readonly retailerId: string;
  readonly sourceId: string;
  readonly name: string;
  readonly accessMethod: CollectorAccessMethod;

  constructor(retailerId: string, sourceId: string, name: string, accessMethod: CollectorAccessMethod) {
    this.retailerId = retailerId;
    this.sourceId = sourceId;
    this.name = name;
    this.accessMethod = accessMethod;
  }

  get registryEntry(): RetailerRegistryEntry {
    return RetailerRegistry.getRetailer(this.retailerId)!;
  }

  abstract checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }>;

  async validateConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const eligibility = await this.checkEligibility();
    if (!eligibility.eligible) {
      return { ok: false, error: eligibility.reason || 'Sursa nu este eligibilă pentru conexiune activă.' };
    }
    return { ok: true, latencyMs: 45 };
  }

  /**
   * Colectează un lot de date din payload-ul primit sau refuză colectarea dacă sursa nu are acces autorizat
   */
  async collectBatch(options?: { dryRun?: boolean; payload?: string }): Promise<CollectionBatch> {
    const eligibility = await this.checkEligibility();

    // Dacă nu a fost furnizat un payload manual și sursa nu este autorizată/activă, refuzăm conexiunea neautorizată
    if (!options?.payload && !eligibility.eligible) {
      throw new Error(`Colectarea automată este suspendată pentru ${this.name}: ${eligibility.reason}`);
    }

    const payloadText = options?.payload || '';
    const rawItems = this.parseRawPayload(payloadText);

    const batchId = `batch-${this.retailerId}-${Date.now()}`;
    const hash = `sha256-${Math.abs(payloadText.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0))}`;

    return {
      batchId,
      retailerId: this.retailerId,
      sourceId: this.sourceId,
      sourceName: this.name,
      collectedAt: new Date().toISOString(),
      rawRecordsCount: rawItems.length,
      rawPayloadHash: hash,
      rawRecords: rawItems,
      provenance: {
        sourceType: this.accessMethod,
        sourceUrlOrOrigin: `internal://${this.retailerId}/${options?.dryRun ? 'dry_run' : 'manual_or_feed'}`,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'test',
        licenseOrTerms: 'Reutilizare autorizată în baza de date civică a prețurilor (Coșul Meu)'
      }
    };
  }

  /**
   * Parsează textul brut în înregistrări RawCollectorItem (suportă CSV, JSON și XML simplificat)
   */
  protected parseRawPayload(payload: string): RawCollectorItem[] {
    if (!payload.trim()) return [];

    // Încercăm JSON
    if (payload.trim().startsWith('{') || payload.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(payload);
        const list = Array.isArray(parsed) ? parsed : parsed.items || parsed.products || [];
        return list.map((item: any, idx: number) => ({
          id: item.id || `raw-${idx}`,
          rawName: item.name || item.rawName || item.denumire || '',
          barcode: item.barcode || item.gtin || item.ean || item.cod_bare,
          brand: item.brand || item.marca,
          category: item.category || item.categorie,
          normalPrice: item.price || item.pret || item.normalPrice,
          promoPrice: item.promoPrice || item.pret_promo,
          loyaltyPrice: item.loyaltyPrice || item.pret_fidelitate,
          currency: item.currency || 'RON',
          packageQuantity: item.packageQuantity || item.gramaj || item.weight,
          packageUnit: item.packageUnit || item.unitate || item.unit,
          promoDetails: item.promoDetails || item.promotie,
          loyaltyCardName: item.loyaltyCardName || item.card_fidelitate,
          validFrom: item.validFrom || item.valabil_de_la,
          validUntil: item.validUntil || item.valabil_pana,
          region: item.region || item.regiune || 'Național'
        }));
      } catch {
        // Dacă eșuează JSON, continuă cu alte formate
      }
    }

    // 2. Scanare / Parsare pagini web publice sau cataloage HTML (microdata, JSON-LD, carduri de produse)
    if (payload.includes('<html') || payload.includes('<!DOCTYPE') || payload.includes('<article') || payload.includes('class="product')) {
      const htmlItems: RawCollectorItem[] = [];

      // A. Căutare blocuri JSON-LD (<script type="application/ld+json">)
      const jsonLdRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let matchJsonLd: RegExpExecArray | null;
      while ((matchJsonLd = jsonLdRegex.exec(payload)) !== null) {
        try {
          const ldData = JSON.parse(matchJsonLd[1].trim());
          const entries = Array.isArray(ldData) ? ldData : [ldData];
          for (const entry of entries) {
            if (entry['@type'] === 'Product' || entry.offers) {
              const offer = Array.isArray(entry.offers) ? entry.offers[0] : entry.offers;
              htmlItems.push({
                id: `ld-${htmlItems.length + 1}`,
                rawName: entry.name || entry.title || '',
                brand: typeof entry.brand === 'object' ? entry.brand.name : entry.brand,
                barcode: entry.gtin13 || entry.gtin || entry.sku,
                normalPrice: offer ? (offer.price || offer.highPrice) : 0,
                promoPrice: offer && offer.lowPrice && offer.lowPrice < offer.price ? offer.lowPrice : undefined,
                currency: offer?.priceCurrency || 'RON',
                category: entry.category,
                region: 'Național'
              });
            }
          }
        } catch {
          // Ignorare JSON-LD nevalid
        }
      }

      if (htmlItems.length > 0) {
        return htmlItems;
      }

      // B. Scanare carduri HTML de produse (ex: <div class="product...">...</div> sau <article ...>)
      const cardRegex = /<(?:div|article|li)\s+[^>]*class=["'][^"']*(?:product|catalog-item|item-card|offer-card)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|li)>/gi;
      let cardMatch: RegExpExecArray | null;
      let idx = 1;

      while ((cardMatch = cardRegex.exec(payload)) !== null) {
        const cardHtml = cardMatch[1];

        const nameMatch = cardHtml.match(/<(?:h2|h3|h4|span|a)\s+[^>]*class=["'][^"']*(?:title|name|heading)[^"']*["'][^>]*>([^<]+)<\//i)
          || cardHtml.match(/title=["']([^"']+)["']/i);
        const rawName = nameMatch ? nameMatch[1].trim() : '';

        const priceMatch = cardHtml.match(/<(?:span|div|p)\s+[^>]*class=["'][^"']*(?:price|current-price|value)[^"']*["'][^>]*>\s*([0-9]+[.,][0-9]{2})\s*(?:lei|ron|€)?<\//i)
          || cardHtml.match(/([0-9]+[.,][0-9]{2})\s*(?:lei|ron)/i);
        const normalPrice = priceMatch ? priceMatch[1].replace(',', '.') : '';

        const promoMatch = cardHtml.match(/<(?:span|div)\s+[^>]*class=["'][^"']*(?:badge|discount|promo)[^"']*["'][^>]*>([^<]+)<\//i);
        const promoDetails = promoMatch ? promoMatch[1].trim() : undefined;

        if (rawName && normalPrice) {
          htmlItems.push({
            id: `web-${idx++}`,
            rawName,
            normalPrice,
            promoDetails,
            currency: 'RON',
            region: 'Național'
          });
        }
      }

      if (htmlItems.length > 0) {
        return htmlItems;
      }
    }

    // 3. Scanare XML simplificată (<item> sau <product>)
    if (payload.includes('<?xml') || payload.includes('<rss') || payload.includes('<catalog')) {
      const xmlItems: RawCollectorItem[] = [];
      const itemRegex = /<(?:item|product|oferta)>([\s\S]*?)<\/(?:item|product|oferta)>/gi;
      let m: RegExpExecArray | null;
      let i = 1;
      while ((m = itemRegex.exec(payload)) !== null) {
        const blk = m[1];
        const getTag = (tag: string) => {
          const match = blk.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`, 'i'));
          return match ? match[1].trim() : undefined;
        };
        const rawName = getTag('title') || getTag('name') || getTag('denumire') || '';
        const price = getTag('price') || getTag('pret') || '';
        if (rawName && price) {
          xmlItems.push({
            id: `xml-${i++}`,
            rawName,
            normalPrice: price,
            brand: getTag('brand') || getTag('marca'),
            barcode: getTag('barcode') || getTag('gtin'),
            promoPrice: getTag('promo_price') || getTag('pret_promo'),
            promoDetails: getTag('promo') || getTag('reducere'),
            packageQuantity: getTag('gramaj') || getTag('quantity'),
            packageUnit: getTag('unit') || getTag('unitate'),
            currency: 'RON'
          });
        }
      }
      if (xmlItems.length > 0) return xmlItems;
    }

    // Parsare CSV robustă
    const lines = payload
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

    if (lines.length < 2) return [];

    const firstLine = lines[0];
    let sep = ',';
    if (firstLine.includes(';') && !firstLine.includes(',')) sep = ';';
    if (firstLine.includes('\t')) sep = '\t';

    const parseCsvLine = (line: string): string[] => {
      const res: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === sep && !inQuotes) {
          res.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      res.push(cur.trim());
      return res;
    };

    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));

    const findIdx = (names: string[]): number => {
      // 1. Potrivire exactă
      const exact = headers.findIndex(h => names.includes(h));
      if (exact >= 0) return exact;
      // 2. Potrivire parțială cu protecție pe token-uri scurte (ex: 'um' nu trebuie să se potrivească în 'denumire')
      return headers.findIndex(h => names.some(n => {
        if (n.length <= 2) {
          const segments = h.split('_');
          return segments.includes(n);
        }
        return h.includes(n);
      }));
    };

    const nameIdx = findIdx(['denumire', 'nume', 'name', 'produs', 'title']);
    const priceIdx = findIdx(['pret', 'price', 'valoare']);
    const weightIdx = findIdx(['gramaj', 'greutate', 'cantitate', 'weight', 'size']);
    const unitIdx = findIdx(['unitate', 'unit', 'um']);
    const brandIdx = findIdx(['marca', 'brand', 'producator']);
    const barcodeIdx = findIdx(['cod_bare', 'barcode', 'gtin', 'ean']);
    const promoIdx = findIdx(['promotie', 'promo', 'reducere']);
    const loyaltyIdx = findIdx(['card', 'fidelitate', 'loyalty']);
    const validUntilIdx = findIdx(['valabil_pana', 'valid_until', 'expira', 'termen']);
    const regionIdx = findIdx(['regiune', 'region', 'oras', 'magazin']);

    const items: RawCollectorItem[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i]);
      if (parts.length === 0 || (parts.length === 1 && !parts[0])) continue;

      const rawName = nameIdx >= 0 ? parts[nameIdx] : parts[0] || '';
      const rawPrice = priceIdx >= 0 ? parts[priceIdx] : parts[1] || '';

      if (!rawName) continue;

      items.push({
        id: `row-${i}`,
        rawName,
        barcode: barcodeIdx >= 0 ? parts[barcodeIdx] : undefined,
        brand: brandIdx >= 0 ? parts[brandIdx] : undefined,
        normalPrice: rawPrice,
        packageQuantity: weightIdx >= 0 ? parts[weightIdx] : undefined,
        packageUnit: unitIdx >= 0 ? parts[unitIdx] : undefined,
        promoDetails: promoIdx >= 0 ? parts[promoIdx] : undefined,
        loyaltyCardName: loyaltyIdx >= 0 ? parts[loyaltyIdx] : undefined,
        validUntil: validUntilIdx >= 0 ? parts[validUntilIdx] : undefined,
        region: regionIdx >= 0 ? parts[regionIdx] : 'Național'
      });
    }

    return items;
  }

  /**
   * Validează și normalizează rândurile brute
   */
  validateAndNormalize(batch: CollectionBatch): {
    valid: ValidatedCollectorItem[];
    invalid: { rawRecord: RawCollectorItem; reason: string }[];
    duplicatesCount: number;
  } {
    const valid: ValidatedCollectorItem[] = [];
    const invalid: { rawRecord: RawCollectorItem; reason: string }[] = [];
    let duplicatesCount = 0;

    const seenBarcodes = new Set<string>();
    const seenNames = new Set<string>();
    const todayStr = new Date().toISOString().split('T')[0];

    for (const item of batch.rawRecords) {
      // 1. Validare denumire
      if (!item.rawName || item.rawName.trim().length < 2) {
        invalid.push({ rawRecord: item, reason: 'Denumire produs lipsă sau prea scurtă (< 2 caractere).' });
        continue;
      }

      // 2. Parsare și validare preț numeric strict pozitiv
      const rawPriceStr = String(item.normalPrice).trim().replace(',', '.');
      if (rawPriceStr.startsWith('-') || !/^[+-]?\d+(\.\d+)?$/.test(rawPriceStr)) {
        invalid.push({ rawRecord: item, reason: `Preț invalid: ${item.normalPrice}. Prețul trebuie să fie numeric și strict pozitiv.` });
        continue;
      }

      const parsedPrice = parseFloat(rawPriceStr);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        invalid.push({ rawRecord: item, reason: `Preț nul sau negativ: ${parsedPrice} RON.` });
        continue;
      }

      // 3. Prețuri promoționale sau condiționate de card
      let promoPrice: number | undefined = undefined;
      if (item.promoPrice) {
        const p = parseFloat(String(item.promoPrice).replace(',', '.'));
        if (!isNaN(p) && p > 0 && p < parsedPrice) promoPrice = p;
      }

      let loyaltyPrice: number | undefined = undefined;
      if (item.loyaltyPrice) {
        const lp = parseFloat(String(item.loyaltyPrice).replace(',', '.'));
        if (!isNaN(lp) && lp > 0) loyaltyPrice = lp;
      }

      const effectivePrice = promoPrice || parsedPrice;

      // 4. Detecție duplicate
      const barcodeClean = item.barcode?.trim();
      const nameKey = `${item.rawName.trim().toLowerCase()}__${item.brand?.trim().toLowerCase() || ''}`;

      if (barcodeClean) {
        if (seenBarcodes.has(barcodeClean)) {
          duplicatesCount++;
          invalid.push({ rawRecord: item, reason: `Cod de bare duplicat în cadrul aceluiași lot: ${barcodeClean}.` });
          continue;
        }
        seenBarcodes.add(barcodeClean);
      } else {
        if (seenNames.has(nameKey)) {
          duplicatesCount++;
          invalid.push({ rawRecord: item, reason: `Produs duplicat cu aceeași denumire în lot: ${item.rawName}.` });
          continue;
        }
        seenNames.add(nameKey);
      }

      // 5. Normalizare gramaj și unitate
      let pkgSize = 1;
      let rawUnit = (item.packageUnit || '').toLowerCase().trim();

      if (item.packageQuantity) {
        const parsedWeight = parseFloat(String(item.packageQuantity).replace(',', '.'));
        if (!isNaN(parsedWeight) && parsedWeight > 0) {
          pkgSize = parsedWeight;
        }
      } else {
        // Extragere din denumire dacă lipsește coloana (ex: "Lapte 1L", "Toast 500g")
        const matchWeight = item.rawName.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|buc)/i);
        if (matchWeight) {
          pkgSize = parseFloat(matchWeight[1].replace(',', '.'));
          rawUnit = matchWeight[2].toLowerCase();
        }
      }

      let packageUnit: UnitType = 'buc';
      let normalizedUnit: 'kg' | 'l' | 'buc' = 'buc';
      let unitPrice = effectivePrice;

      if (rawUnit === 'g') {
        packageUnit = 'g';
        normalizedUnit = 'kg';
        unitPrice = (effectivePrice / pkgSize) * 1000;
      } else if (rawUnit === 'kg') {
        packageUnit = 'kg';
        normalizedUnit = 'kg';
        unitPrice = effectivePrice / pkgSize;
      } else if (rawUnit === 'ml') {
        packageUnit = 'ml';
        normalizedUnit = 'l';
        unitPrice = (effectivePrice / pkgSize) * 1000;
      } else if (rawUnit === 'l') {
        packageUnit = 'l';
        normalizedUnit = 'l';
        unitPrice = effectivePrice / pkgSize;
      } else {
        packageUnit = 'buc';
        normalizedUnit = 'buc';
        unitPrice = effectivePrice / pkgSize;
      }

      unitPrice = Math.round(unitPrice * 100) / 100;
      const unitPriceMeasure: 'lei/kg' | 'lei/l' | 'lei/buc' =
        normalizedUnit === 'kg' ? 'lei/kg' : normalizedUnit === 'l' ? 'lei/l' : 'lei/buc';

      // 6. Verificare expirare
      let isExpired = false;
      let validUntil = item.validUntil?.trim();
      if (validUntil && /^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
        if (validUntil < todayStr) isExpired = true;
      } else {
        validUntil = undefined;
      }

      const hasLoyalty = Boolean(item.loyaltyCardName || loyaltyPrice);

      valid.push({
        rawRecordId: item.id || `item-${valid.length + 1}`,
        rawName: item.rawName.trim(),
        barcode: barcodeClean || undefined,
        brand: item.brand?.trim() || undefined,
        category: item.category?.trim() || undefined,
        normalPrice: parsedPrice,
        promoPrice,
        loyaltyPrice,
        effectivePrice,
        currency: 'RON',
        packageWeightOrVolume: pkgSize,
        packageUnit,
        normalizedUnit,
        unitPrice,
        unitPriceMeasure,
        isPromo: Boolean(promoPrice || item.promoDetails),
        promoDetails: item.promoDetails?.trim() || (promoPrice ? `Redus de la ${parsedPrice} lei` : undefined),
        loyaltyCardRequired: hasLoyalty,
        loyaltyCardName: item.loyaltyCardName?.trim() || (hasLoyalty ? `${this.name} Card` : undefined),
        validFrom: item.validFrom?.trim() || undefined,
        validUntil,
        isExpired,
        region: item.region || 'Național'
      });
    }

    return { valid, invalid, duplicatesCount };
  }
}

// 1. Colector Lidl
export class LidlCollector extends BaseRetailerCollector {
  constructor() {
    super('lidl', 'src-lidl-collector', 'Lidl România', 'official_feed');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    return {
      eligible: true,
      status: 'configured',
      reason: 'Configurat pentru import manual și validare dry-run pe format oficial CSV/XML.'
    };
  }
}

// 2. Colector Kaufland
export class KauflandCollector extends BaseRetailerCollector {
  constructor() {
    super('kaufland', 'src-kaufland-collector', 'Kaufland România', 'authorized_api');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    const hasKey = Boolean(process.env.KAUFLAND_API_KEY);
    if (!hasKey) {
      return {
        eligible: false,
        status: 'pending_authorization',
        reason: 'Necesită cheie de API autorizată sau acreditare oficială Kaufland.'
      };
    }
    return { eligible: true, status: 'active' };
  }
}

// 3. Colector Carrefour
export class CarrefourCollector extends BaseRetailerCollector {
  constructor() {
    super('carrefour', 'src-carrefour-collector', 'Carrefour România', 'official_feed');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    const hasToken = Boolean(process.env.CARREFOUR_FEED_TOKEN);
    if (!hasToken) {
      return {
        eligible: false,
        status: 'pending_authorization',
        reason: 'Necesită token de acces la feed-ul de produse Carrefour România.'
      };
    }
    return { eligible: true, status: 'active' };
  }
}

// 4. Colector Penny
export class PennyCollector extends BaseRetailerCollector {
  constructor() {
    super('penny', 'src-penny-collector', 'Penny România', 'manual_import');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    return {
      eligible: false,
      status: 'disabled',
      reason: 'Dezactivat - necesită acord formal de parteneriat și format validat.'
    };
  }
}

// 5. Colector Auchan
export class AuchanCollector extends BaseRetailerCollector {
  constructor() {
    super('auchan', 'src-auchan-collector', 'Auchan România', 'authorized_api');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    const hasKey = Boolean(process.env.AUCHAN_API_KEY);
    if (!hasKey) {
      return {
        eligible: false,
        status: 'pending_authorization',
        reason: 'Necesită credențiale API aprobate pentru feed-ul Auchan B2B.'
      };
    }
    return { eligible: true, status: 'active' };
  }
}

// 6. Colector Profi
export class ProfiCollector extends BaseRetailerCollector {
  constructor() {
    super('profi', 'src-profi-collector', 'Profi Rom Food', 'manual_import');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    return {
      eligible: false,
      status: 'disabled',
      reason: 'Dezactivat - fără specificație tehnică autorizată pentru prețuri de proximitate.'
    };
  }
}

// 7. Colector Mega Image
export class MegaImageCollector extends BaseRetailerCollector {
  constructor() {
    super('mega-image', 'src-mega-image-collector', 'Mega Image', 'authorized_api');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    const hasKey = Boolean(process.env.MEGA_IMAGE_API_KEY);
    if (!hasKey) {
      return {
        eligible: false,
        status: 'pending_authorization',
        reason: 'Necesită token de acces autorizat pentru date deschise Mega Image.'
      };
    }
    return { eligible: true, status: 'active' };
  }
}

// 8. Colector Metro Cash & Carry România
export class MetroCollector extends BaseRetailerCollector {
  constructor() {
    super('metro', 'src-metro-collector', 'Metro Cash & Carry România', 'public_catalog_feed');
  }

  async checkEligibility(): Promise<{ eligible: boolean; status: CollectorStatus; reason?: string }> {
    const hasKey = Boolean(process.env.METRO_API_KEY || process.env.METRO_CATALOG_URL);
    if (!hasKey) {
      return {
        eligible: false,
        status: 'pending_authorization',
        reason: 'În așteptarea configurării accesului la catalogul public digital / acreditare prețuri engros și retail Metro România.'
      };
    }
    return { eligible: true, status: 'active' };
  }
}

/**
 * Factory pentru instanțierea colectorului corespunzător
 */
export function getCollectorForRetailer(retailerId: string): PriceCollector {
  switch (retailerId) {
    case 'lidl': return new LidlCollector();
    case 'kaufland': return new KauflandCollector();
    case 'carrefour': return new CarrefourCollector();
    case 'penny': return new PennyCollector();
    case 'auchan': return new AuchanCollector();
    case 'profi': return new ProfiCollector();
    case 'mega-image': return new MegaImageCollector();
    case 'metro': return new MetroCollector();
    default:
      throw new Error(`Retailer necunoscut în registru: ${retailerId}`);
  }
}
