import {
  PriceSourceAdapter,
  RawPriceRecord,
  ValidatedPriceRecord,
  ValidationResult,
  InvalidPriceRecord,
  SourceImportResult
} from './PriceSourceAdapter';
import {
  ProductOffer,
  SourceSyncRun,
  ProductMatchCandidate,
  UnitType,
  PriceObservation
} from '../types';
import { StorageService } from '../services/StorageService';
import { ProductMatcher } from '../services/ProductMatcher';
import { STORES } from '../data/mockData';

export class FileImportAdapter implements PriceSourceAdapter {
  readonly id: string;
  readonly name: string;
  readonly type = 'official_file' as const;
  readonly defaultStoreId: string;

  constructor(id = 'src-official-file', name = 'Import Fișier CSV/XML', defaultStoreId = 'lidl') {
    this.id = id;
    this.name = name;
    this.defaultStoreId = defaultStoreId;
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async getLastSync(): Promise<SourceSyncRun | null> {
    const runs = StorageService.getSyncRuns().filter(r => r.sourceId === this.id);
    return runs[0] || null;
  }

  /**
   * Parse CSV content into RawPriceRecords
   */
  static parseCSV(csvContent: string): RawPriceRecord[] {
    const lines = csvContent
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

    if (lines.length < 2) return [];

    // Detect separator: comma or semicolon or tab
    const firstLine = lines[0];
    let sep = ',';
    if (firstLine.includes(';') && !firstLine.includes(',')) sep = ';';
    if (firstLine.includes('\t')) sep = '\t';

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === sep && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

    const records: RawPriceRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = parseLine(lines[i]);
      if (parts.length === 0 || (parts.length === 1 && !parts[0])) continue;

      const obj: any = {};
      headers.forEach((h, idx) => {
        obj[h] = parts[idx] !== undefined ? parts[idx] : '';
      });

      // Flexible column mapping
      const rawName = obj.denumire || obj.nume || obj.produs || obj.name || obj.title || obj.articol || parts[0];
      const priceRaw = obj.pret || obj.price || obj.valoare || obj.pret_ron || obj.pretron || parts[1];
      const barcode = obj.cod_bare || obj.codbare || obj.ean || obj.gtin || obj.barcode || obj.cod_ean || obj.codean || '';
      const brand = obj.marca || obj.brand || '';
      const packageSize = obj.gramaj || obj.cantitate || obj.marime || obj.package_size || obj.packagesize || '';
      const unit = obj.unitate || obj.unit || obj.unitate_masura || obj.unitatemasura || '';
      const promoDetails = obj.promotie || obj.promo || obj.promo_details || '';
      const validUntil = obj.valabil_pana || obj.valabilpana || obj.valid_until || obj.expira || '';
      const loyaltyCard = obj.card_fidelitate || obj.cardfidelitate || obj.card || obj.loyalty || obj.loyalty_card || obj.loyaltycardrequired || '';

      records.push({
        rawName,
        price: priceRaw,
        barcode,
        brand,
        packageWeightOrVolume: packageSize,
        packageUnit: unit,
        promoDetails,
        validUntil,
        loyaltyCardRequired:
          loyaltyCard === 'true' ||
          loyaltyCard === '1' ||
          loyaltyCard === 'da' ||
          typeof loyaltyCard === 'string' && loyaltyCard.length > 2,
        loyaltyCardName: typeof loyaltyCard === 'string' && loyaltyCard.length > 2 ? loyaltyCard : undefined
      });
    }

    return records;
  }

  /**
   * Parse simple XML content into RawPriceRecords
   */
  static parseXML(xmlContent: string): RawPriceRecord[] {
    const records: RawPriceRecord[] = [];
    const itemRegex = /<(?:item|product|produs|oferta)>([\s\S]*?)<\/(?:item|product|produs|oferta)>/gi;
    let match;

    while ((match = itemRegex.exec(xmlContent)) !== null) {
      const content = match[1];
      const getTag = (tag: string) => {
        const tMatch = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(content);
        return tMatch ? tMatch[1].trim() : '';
      };

      const rawName = getTag('name') || getTag('denumire') || getTag('title');
      const price = getTag('price') || getTag('pret');
      const barcode = getTag('barcode') || getTag('ean') || getTag('gtin');
      const brand = getTag('brand') || getTag('marca');
      const packageSize = getTag('gramaj') || getTag('weight') || getTag('package_size');
      const unit = getTag('unit') || getTag('unitate');
      const promoDetails = getTag('promo') || getTag('promo_details');
      const validUntil = getTag('valid_until') || getTag('valabil_pana');
      const loyaltyCard = getTag('loyalty_card') || getTag('card_fidelitate');

      if (rawName && price) {
        records.push({
          rawName,
          price,
          barcode,
          brand,
          packageWeightOrVolume: packageSize,
          packageUnit: unit,
          promoDetails,
          validUntil,
          loyaltyCardRequired: !!loyaltyCard,
          loyaltyCardName: loyaltyCard || undefined
        });
      }
    }

    return records;
  }

  /**
   * Validate records against strict data schema
   */
  validateRecords(records: RawPriceRecord[]): ValidationResult {
    const valid: ValidatedPriceRecord[] = [];
    const invalid: InvalidPriceRecord[] = [];
    let duplicatesCount = 0;

    const seenKeys = new Set<string>();
    const todayStr = new Date().toISOString().split('T')[0];

    records.forEach((rec, idx) => {
      const rowNumber = idx + 1;

      // 1. Name validation
      if (!rec.rawName || rec.rawName.trim().length < 2) {
        invalid.push({ record: rec, reason: 'Denumire produs lipsă sau invalidă', rowNumber });
        return;
      }

      // 2. Price validation (numeric, positive, non-zero, non-NaN)
      const rawPriceStr = String(rec.price).trim().replace(',', '.');
      const parsedPrice = parseFloat(rawPriceStr);

      if (
        isNaN(parsedPrice) ||
        parsedPrice <= 0 ||
        !isFinite(parsedPrice) ||
        rawPriceStr.startsWith('-') ||
        !/^[+-]?\d+(\.\d+)?$/.test(rawPriceStr)
      ) {
        invalid.push({ record: rec, reason: `Preț invalid (${rec.price}). Trebuie să fie o valoare numerică pozitivă`, rowNumber });
        return;
      }

      // 3. Duplicate detection within file
      const dedupKey = (rec.barcode && rec.barcode.trim())
        ? `bar_${rec.barcode.trim()}`
        : `name_${rec.rawName.trim().toLowerCase()}_${(rec.brand || '').trim().toLowerCase()}`;

      if (seenKeys.has(dedupKey)) {
        duplicatesCount++;
        invalid.push({ record: rec, reason: 'Înregistrare duplicată detectată în fișier', rowNumber });
        return;
      }
      seenKeys.add(dedupKey);

      // 4. Package size & unit normalization
      let pkgSize = parseFloat(String(rec.packageWeightOrVolume || '1').replace(',', '.'));
      if (isNaN(pkgSize) || pkgSize <= 0) pkgSize = 1;

      let pkgUnit: UnitType = 'buc';
      const rawUnit = (rec.packageUnit || rec.unit || '').toLowerCase().trim();
      if (rawUnit.includes('kg') || rawUnit === 'kilogram') pkgUnit = 'kg';
      else if (rawUnit.includes('g') || rawUnit === 'gram') pkgUnit = 'g';
      else if (rawUnit.includes('ml')) pkgUnit = 'ml';
      else if (rawUnit.includes('l') || rawUnit === 'litru' || rawUnit === 'litri') pkgUnit = 'l';
      else if (rawUnit.includes('pachet') || rawUnit.includes('set')) pkgUnit = 'pachet';
      else pkgUnit = 'buc';

      let normalizedUnit: 'kg' | 'l' | 'buc' = 'buc';
      let unitPrice = parsedPrice;

      if (pkgUnit === 'kg') {
        normalizedUnit = 'kg';
        unitPrice = parsedPrice / pkgSize;
      } else if (pkgUnit === 'g') {
        normalizedUnit = 'kg';
        unitPrice = (parsedPrice / pkgSize) * 1000;
      } else if (pkgUnit === 'l') {
        normalizedUnit = 'l';
        unitPrice = parsedPrice / pkgSize;
      } else if (pkgUnit === 'ml') {
        normalizedUnit = 'l';
        unitPrice = (parsedPrice / pkgSize) * 1000;
      } else {
        normalizedUnit = 'buc';
        unitPrice = parsedPrice / pkgSize;
      }

      unitPrice = Math.round(unitPrice * 100) / 100;
      const unitPriceMeasure = normalizedUnit === 'kg' ? 'lei/kg' : normalizedUnit === 'l' ? 'lei/l' : 'lei/buc';

      // 5. Validity check
      let isExpired = false;
      let validUntil: string | undefined = undefined;
      if (rec.validUntil && /^\d{4}-\d{2}-\d{2}$/.test(rec.validUntil.trim())) {
        validUntil = rec.validUntil.trim();
        if (validUntil < todayStr) {
          isExpired = true;
        }
      }

      valid.push({
        rawName: rec.rawName.trim(),
        barcode: rec.barcode?.trim(),
        brand: rec.brand?.trim(),
        category: rec.category?.trim(),
        price: parsedPrice,
        originalPrice: rec.originalPrice ? parseFloat(String(rec.originalPrice).replace(',', '.')) : undefined,
        packageWeightOrVolume: pkgSize,
        packageUnit: pkgUnit,
        normalizedUnit,
        unitPrice,
        unitPriceMeasure,
        isPromo: Boolean(rec.promoDetails || rec.originalPrice),
        promoDetails: rec.promoDetails?.trim(),
        loyaltyCardRequired: Boolean(rec.loyaltyCardRequired),
        loyaltyCardName: rec.loyaltyCardName?.trim() || undefined,
        validUntil,
        isExpired
      });
    });

    return { valid, invalid, duplicatesCount };
  }

  /**
   * Normalize and match records with catalog
   */
  normalize(records: ValidatedPriceRecord[], storeId: string): {
    offers: ProductOffer[];
    matchCandidates: ProductMatchCandidate[];
  } {
    const offers: ProductOffer[] = [];
    const matchCandidates: ProductMatchCandidate[] = [];
    const todayStr = new Date().toISOString().split('T')[0];

    for (const rec of records) {
      const matchResult = ProductMatcher.matchProduct({
        rawName: rec.rawName,
        barcode: rec.barcode,
        brand: rec.brand,
        packageWeightOrVolume: rec.packageWeightOrVolume,
        packageUnit: rec.packageUnit,
        category: rec.category
      });

      let targetProductId = matchResult.matchedProduct?.id;

      if (matchResult.candidate) {
        matchCandidates.push(matchResult.candidate);
      }

      // If matched, build offer for that product
      if (targetProductId) {
        const offer: ProductOffer = {
          id: `off-${storeId}-${targetProductId}`,
          productId: targetProductId,
          storeId,
          sourceId: this.id,
          price: rec.price,
          originalPrice: rec.originalPrice,
          unitPrice: rec.unitPrice,
          unitPriceMeasure: rec.unitPriceMeasure,
          isPromo: rec.isPromo,
          promoDetails: rec.promoDetails,
          loyaltyCardRequired: rec.loyaltyCardRequired,
          loyaltyCardName: rec.loyaltyCardName,
          validUntil: rec.validUntil,
          observationDate: todayStr,
          source: 'official_feed',
          confidenceLevel: matchResult.confidence >= 0.9 ? 'high' : 'medium',
          verificationStatus: rec.isExpired ? 'expired' : 'verified',
          lastChecked: todayStr
        };
        offers.push(offer);
      }
    }

    return { offers, matchCandidates };
  }

  /**
   * Execute file import with safe synchronization logging
   */
  async importData(payload: {
    content: string;
    format: 'csv' | 'xml';
    storeId?: string;
    dryRun?: boolean;
  }): Promise<SourceImportResult> {
    const startedAt = new Date().toISOString();
    const targetStoreId = payload.storeId || this.defaultStoreId;

    const rawRecords = payload.format === 'xml'
      ? FileImportAdapter.parseXML(payload.content)
      : FileImportAdapter.parseCSV(payload.content);

    const validation = this.validateRecords(rawRecords);
    const { offers, matchCandidates } = this.normalize(validation.valid, targetStoreId);

    const completedAt = new Date().toISOString();
    const hasErrors = validation.invalid.length > 0;
    const status: 'success' | 'partial' | 'failed' =
      validation.valid.length === 0 && rawRecords.length > 0
        ? 'failed'
        : hasErrors
        ? 'partial'
        : 'success';

    const syncRun: SourceSyncRun = {
      id: `sync-${Date.now()}`,
      sourceId: this.id,
      sourceName: this.name,
      startedAt,
      completedAt,
      status,
      recordsProcessed: rawRecords.length,
      recordsImported: payload.dryRun ? 0 : offers.length,
      duplicatesFound: validation.duplicatesCount,
      invalidRecords: validation.invalid.length,
      errors: validation.invalid.map(inv => `Rând ${inv.rowNumber || '?'}: ${inv.reason} (${inv.record.rawName})`),
      summary: `Procesate ${rawRecords.length} linii: ${validation.valid.length} valide, ${offers.length} asociate cu catalogul, ${validation.invalid.length} erori.`
    };

    if (!payload.dryRun) {
      // 1. Commit offers into StorageService
      StorageService.addOrUpdateOffers(offers);

      // 2. Commit price observations (history preservation)
      const newObservations: PriceObservation[] = offers.map(off => ({
        id: `obs-file-${off.storeId}-${off.productId}-${off.observationDate}`,
        productId: off.productId,
        storeId: off.storeId,
        sourceId: this.id,
        price: off.price,
        date: off.observationDate,
        loyaltyCardUsed: off.loyaltyCardRequired,
        source: 'official_feed'
      }));
      StorageService.addPriceObservations(newObservations);

      // 3. Save match candidates for manual review
      if (matchCandidates.length > 0) {
        StorageService.addMatchCandidates(matchCandidates);
      }

      // 4. Register sync run in audit log
      StorageService.addSyncRun(syncRun);
    }

    return {
      success: status !== 'failed',
      syncRun,
      importedOffers: offers,
      matchCandidates,
      summaryMessage: syncRun.summary
    };
  }
}

/**
 * Pre-configured adapter specifically for Lidl price files
 */
export class LidlPriceFileAdapter extends FileImportAdapter {
  constructor() {
    super('src-lidl-file', 'Fișier Oficial Prețuri Lidl (CSV/XML)', 'lidl');
  }
}
