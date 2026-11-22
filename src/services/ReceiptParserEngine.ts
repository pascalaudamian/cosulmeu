import {
  ConfidenceLevel,
  Product,
  ProductCategory,
  Receipt,
  ReceiptConfidenceBand,
  ReceiptConfidenceBreakdown,
  ReceiptItem,
  ReceiptMatchCandidate,
  ReceiptValidationStatus,
  ReceiptVatEntry,
  Store,
  UnitType,
  UserPriceObservation
} from '../types.js';
import { STORES } from '../data/mockData.js';
import {
  buildCanonicalAliasIndex,
  CanonicalAliasIndex,
  resolveCanonicalProductId
} from './ProductIdentityService.js';
import {
  areVariantAttributesCompatible,
  normalizeTitleAndVariants,
  validateAndNormalizeBarcode
} from './ProductNormalizationService.js';

export interface ReceiptOcrQualityInput {
  isBlurry?: boolean;
  blurScore?: number;
  isOverexposed?: boolean;
  isUnderexposed?: boolean;
  isTruncated?: boolean;
  brightness?: number;
  ocrTextConfidence?: number; // 0-100
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  matchingReceiptId?: string;
  matchReason?: string;
  confidence: 'exact' | 'probable' | 'none';
}

const KNOWN_RETAILERS: Array<{
  storeId: string;
  storeName: string;
  patterns: RegExp[];
}> = [
  {
    storeId: 'kaufland',
    storeName: 'Kaufland România',
    patterns: [/\bkaufland\b/i, /\bro1599110\b/i, /\b32482920\b/i]
  },
  {
    storeId: 'lidl',
    storeName: 'Lidl România',
    patterns: [/\blidl\b/i, /\blidl\s+discount\b/i, /\blidl\s+plus\b/i, /\bro22891860\b/i]
  },
  {
    storeId: 'carrefour',
    storeName: 'Carrefour România',
    patterns: [/\bcarrefour\b/i, /\bsupermarket\s+carrefour\b/i, /\bcarrefour\s+express\b/i, /\bmarket\s+carrefour\b/i, /\bact\s+for\s+good\b/i]
  },
  {
    storeId: 'penny',
    storeName: 'Penny Market',
    patterns: [/\bpenny\b/i, /\brewe\s+romania\b/i, /\bpenny\s+market\b/i]
  },
  {
    storeId: 'auchan',
    storeName: 'Auchan România',
    patterns: [/\bauchan\b/i, /\bmyauchan\b/i]
  },
  {
    storeId: 'profi',
    storeName: 'Profi Rom Food',
    patterns: [/\bprofi\b/i, /\bprofi\s+rom\s+food\b/i, /\bprofi\s+city\b/i, /\bprofi\s+go\b/i]
  },
  {
    storeId: 'mega-image',
    storeName: 'Mega Image',
    patterns: [/\bmega\s*image\b/i, /\bshop\s*&\s*go\b/i, /\bgusturi\s+romanesti\b/i]
  },
  {
    storeId: 'metro',
    storeName: 'Metro Cash & Carry',
    patterns: [/\bmetro\b/i, /\bmetro\s+cash\b/i, /\bfine\s+life\b/i, /\baro\b/i]
  }
];

const ABBREVIATION_MAP: Array<[RegExp, string]> = [
  [/\bLAP\.?\b/gi, 'Lapte'],
  [/\bIAU\.?\b/gi, 'Iaurt'],
  [/\bPAIN\.?\b/gi, 'Pâine'],
  [/\bPIEP\.?\b/gi, 'Piept'],
  [/\bPULP\.?\b/gi, 'Pulpe'],
  [/\bZAH\.?\b/gi, 'Zahăr'],
  [/\bFAIN\.?\b/gi, 'Făină'],
  [/\bSMANT\.?\b/gi, 'Smântână'],
  [/\bTELEM\.?\b/gi, 'Telemea'],
  [/\bCASC\.?\b/gi, 'Cașcaval'],
  [/\bBAN\.?\b/gi, 'Banane'],
  [/\bROSI\.?\b/gi, 'Roșii'],
  [/\bCART\.?\b/gi, 'Cartofi'],
  [/\bAPA\s+MIN\.?\b/gi, 'Apă minerală'],
  [/\bAPA\s+PL\.?\b/gi, 'Apă plată'],
  [/\bDET\.?\b/gi, 'Detergent'],
  [/\bHART\.?\s*IG\.?\b/gi, 'Hârtie igienică'],
  [/\bCAFEA\s+MAC\.?\b/gi, 'Cafea măcinată'],
  [/\bCIOC\.?\b/gi, 'Ciocolată'],
  [/\bSUC\s+NAT\.?\b/gi, 'Suc natural'],
  [/\bSUC\s+CARB\.?\b/gi, 'Băutură carbogazoasă'],
  [/\bPUI\s+GRILL\b/gi, 'Pui grill'],
  [/\bCHIF\.?\b/gi, 'Chifle'],
  [/\bCOV\.?\b/gi, 'Covrigi'],
  [/\bSGR\s+AMB\.?\b/gi, 'Garanție SGR']
];

const NON_PRODUCT_FOOTER_RE =
  /^(?:total(?:\s+(?:lei|ron|de\s+plata|general|bon))?|subtotal|sub-total|rest(?:\s+de\s+plata)?|numerar|cash|card(?:\s+bancar)?|visa|mastercard|maestro|tichete|bon\s+fiscal|nr\.?\s*bon|c\.?i\.?f\.?|c\.?u\.?i\.?|vat|tva\b|cota\s+tva|data\b|ora\b|z\s*nr|serie\s+fiscala|multumim|va\s+multumim|operator|casier|casa\s+nr|tid\b|mid\b|auth\b|rrn\b|tranzactie|aprobata|pos\b|banca\b|str\.?|bd\.?|sos\.?|cal\.?|mun\.?|jud\.?|sector\s+\d)/i;

const SGR_LINE_RE =
  /\b(?:sgr|returo|garantie\s+ambalaj|ambalaj\s+sgr|taxa\s+sgr|garantie\s+sgr|gar\.\s*sgr)\b/i;

const DISCOUNT_OR_COUPON_RE =
  /\b(?:reducere|discount|cupon|voucher|rabat|economie|promo(?:tie)?\s+card|lidl\s+plus\s+reducere|kaufland\s+card|bonus)\b/i;

const COUPON_LINE_RE = /\b(?:cupon|voucher|tichet\s+valoric|bonus\s+fidelitate)\b/i;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function stripDiacritics(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function parseRomanianDecimal(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  let text = raw
    .replace(/\u00a0/g, ' ')
    .replace(/(?:lei|ron)/gi, '')
    .trim();

  if (!text) return null;

  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1).trim();
  } else if (text.startsWith('+')) {
    text = text.slice(1).trim();
  }

  text = text.replace(/\s+/g, '');

  // Romanian thousand separator + decimal comma: 1.299,50 -> 1299.50
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,3}$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    // 1.299 -> 1299 only when three digits after dot
    text = text.replace(/\./g, '');
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{1,3}$/.test(text)) {
    // US thousands: 1,299.50
    text = text.replace(/,/g, '');
  } else if (/^\d+,\d{1,4}$/.test(text)) {
    text = text.replace(',', '.');
  } else if (!/^\d+(?:\.\d{1,4})?$/.test(text)) {
    return null;
  }

  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * Validates GS1 check digits (EAN-8, UPC-A / GTIN-12, EAN-13, GTIN-14).
 * Prevents internal store PLUs or random numbers from being misclassified as EANs.
 */
export function isValidEanBarcode(candidate?: string | null): boolean {
  const res = validateAndNormalizeBarcode(candidate);
  return res.isValidFormat && res.isValidCheckDigit && !res.isSuspicious;
}

export function expandRomanianReceiptAbbreviation(rawName: string): string {
  let out = (rawName || '').replace(/\s+/g, ' ').trim();
  if (!out) return '';
  for (const [pattern, replacement] of ABBREVIATION_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function inferCategoryFromName(name: string): ProductCategory {
  const n = stripDiacritics(name);
  if (/\b(?:banane|mere|pere|rosii|castraveti|cartofi|ceapa|morcovi|ardei|salata|lamai|portocale|fructe|legume)\b/.test(n)) {
    return 'Fructe și legume';
  }
  if (/\b(?:lapte|iaurt|unt|smantana|telemea|cascaval|branza|oua|kefir|sana)\b/.test(n)) {
    return 'Lactate și ouă';
  }
  if (/\b(?:carne|pui|piept|pulpe|porc|vita|peste|somon|ton|mezel|sunca|salam|carnati|mici)\b/.test(n)) {
    return 'Carne și pește';
  }
  if (/\b(?:paine|toast|bagheta|chifle|franzela|covrigi|croissant|cozonac|faina)\b/.test(n)) {
    return 'Panificație';
  }
  if (/\b(?:apa|suc|bere|vin|cola|pepsi|cafea|ceai|energizant|bautura|sgr|garantie)\b/.test(n)) {
    return 'Băuturi';
  }
  if (/\b(?:congelat|inghetata|pizza\s+cong|mazare\s+cong)\b/.test(n)) {
    return 'Produse congelate';
  }
  if (/\b(?:detergent|balsam\s+rufe|clor|dezinfectant|solutie\s+curat|bureti|saci\s+menaj)\b/.test(n)) {
    return 'Curățenie';
  }
  if (/\b(?:sapun|sampon|gel\s+dus|pasta\s+dinti|periuta|hartie\s+igienica|servetele|deodorant)\b/.test(n)) {
    return 'Igienă personală';
  }
  if (/\b(?:ulei|zahar|orez|paste|spaghete|malai|sare|otet|conserve|ciocolata|biscuiti)\b/.test(n)) {
    return 'Produse de bază';
  }
  return 'Alte produse';
}

export function identifyRetailer(
  rawTextOrName: string,
  availableStores: Store[] = STORES
): { storeId: string; storeName: string; confidence: number } {
  const input = rawTextOrName || '';
  for (const chain of KNOWN_RETAILERS) {
    if (chain.patterns.some(p => p.test(input))) {
      const storeMatch = availableStores.find(
        s =>
          s.id === chain.storeId ||
          stripDiacritics(s.slug) === chain.storeId ||
          stripDiacritics(s.name).includes(stripDiacritics(chain.storeId))
      );
      return {
        storeId: storeMatch?.id || chain.storeId,
        storeName: storeMatch?.name || chain.storeName,
        confidence: 96
      };
    }
  }

  const normInput = stripDiacritics(input);
  for (const store of availableStores) {
    const chainNorm = stripDiacritics(store.chain || store.name);
    if (chainNorm && normInput.includes(chainNorm)) {
      return {
        storeId: store.id,
        storeName: store.name,
        confidence: 90
      };
    }
  }

  return {
    storeId: 'unknown',
    storeName: input.trim() ? input.trim().slice(0, 60) : 'Magazin neidentificat',
    confidence: input.trim() ? 45 : 20
  };
}

export function classifyConfidenceBand(score: number): ReceiptConfidenceBand {
  if (score >= 95) return 'high_confidence';
  if (score >= 80) return 'good_confidence';
  if (score >= 60) return 'uncertain';
  return 'needs_correction';
}

export function confidenceBandToLevel(score: number): ConfidenceLevel {
  if (score >= 85) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

export function confidenceBandLabel(band: ReceiptConfidenceBand): string {
  switch (band) {
    case 'high_confidence':
      return 'Încredere ridicată (95–100)';
    case 'good_confidence':
      return 'Încredere bună (80–94)';
    case 'uncertain':
      return 'Incert (60–79)';
    case 'needs_correction':
      return 'Necesită corectare (<60)';
  }
}

function normalizeDateString(rawDate?: string | null): string | null {
  if (!rawDate) return null;
  const trimmed = rawDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const dmy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    const mNum = Number(month);
    const dNum = Number(day);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${year}-${month}-${day}`;
    }
  }
  return null;
}

function extractCodesFromText(line: string): { eanCode?: string; internalCode?: string } {
  const tokens = line.match(/\b\d{4,14}\b/g) || [];
  let eanCode: string | undefined;
  let internalCode: string | undefined;

  for (const token of tokens) {
    if (!eanCode && isValidEanBarcode(token)) {
      eanCode = token;
    } else if (!internalCode && token.length >= 4 && token.length <= 10) {
      internalCode = token;
    }
  }
  return { eanCode, internalCode };
}

function normalizeUnitToken(rawUnit?: string | null): UnitType {
  const u = stripDiacritics(rawUnit || '');
  if (['kg', 'kgr'].includes(u)) return 'kg';
  if (['g', 'gr', 'grame'].includes(u)) return 'g';
  if (['l', 'lt', 'litru', 'litri'].includes(u)) return 'l';
  if (['ml'].includes(u)) return 'ml';
  if (['pac', 'pachet', 'set'].includes(u)) return 'pachet';
  return 'buc';
}

function extractInlinePackage(name: string): { weightOrVolume?: number; unit?: UnitType } {
  const m = (name || '').match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|lt)\b/i);
  if (!m) return {};
  const val = parseRomanianDecimal(m[1]);
  if (val === null || val <= 0) return {};
  return { weightOrVolume: val, unit: normalizeUnitToken(m[2]) };
}

/**
 * Deduplicate boundary lines when a long receipt is photographed in multiple overlapping pages.
 */
export function mergeMultiPageOcrTexts(pagesText: string[]): string {
  if (pagesText.length <= 1) return pagesText[0] || '';
  const mergedLines: string[] = [];

  for (let p = 0; p < pagesText.length; p++) {
    const currentLines = pagesText[p]
      .split(/\r?\n/)
      .map(l => l.trimEnd())
      .filter(l => l.trim().length > 0);

    if (p === 0) {
      mergedLines.push(...currentLines);
      continue;
    }

    // Check up to 5 lines overlap between tail of mergedLines and head of currentLines
    let overlapCount = 0;
    const maxCheck = Math.min(5, mergedLines.length, currentLines.length);
    for (let k = maxCheck; k >= 1; k--) {
      const tail = mergedLines.slice(-k).map(l => stripDiacritics(l));
      const head = currentLines.slice(0, k).map(l => stripDiacritics(l));
      if (tail.every((line, idx) => line === head[idx])) {
        overlapCount = k;
        break;
      }
    }

    mergedLines.push(...currentLines.slice(overlapCount));
  }

  return mergedLines.join('\n');
}

/**
 * Contextual Romanian thermal receipt parser.
 * Parses header, retailer, items (1-line and 2-line formats), weighted goods, line discounts, coupons, SGR, VAT summary, payment method, and totals.
 */
export function parseReceiptOcrText(
  rawOcrText: string,
  availableStores: Store[] = STORES
): Partial<Receipt> & { items: ReceiptItem[] } {
  const normalizedInput = (rawOcrText || '').replace(/\r\n/g, '\n');
  const lines = normalizedInput
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const headerWindow = lines.slice(0, Math.min(10, lines.length)).join(' ');
  const retailer = identifyRetailer(headerWindow || normalizedInput, availableStores);

  // Extract date and time
  let date: string | undefined;
  let time: string | undefined;
  let fiscalNumber: string | undefined;
  let receiptNumber: string | undefined;
  let paymentMethod: string | undefined;
  let storeAddress: string | undefined;
  let printedTotal: number | undefined;
  let printedSubtotal: number | undefined;
  let couponsTotal = 0;
  let sgrTotal = 0;
  const vatBreakdown: ReceiptVatEntry[] = [];

  for (const line of lines) {
    if (!date) {
      const dm = line.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
      if (dm) {
        const parsedDate = normalizeDateString(dm[1]);
        if (parsedDate) date = parsedDate;
      }
    }
    if (!time) {
      const tm = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
      if (tm) {
        time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
      }
    }
    if (!fiscalNumber) {
      const cifMatch = line.match(/\b(?:C\.?I\.?F\.?|C\.?U\.?I\.?|CIF)\s*[:.]?\s*(RO\s*\d{4,12}|\d{6,12})\b/i);
      if (cifMatch) {
        fiscalNumber = cifMatch[1].replace(/\s+/g, '');
      }
    }
    if (!receiptNumber) {
      const bnMatch = line.match(/\b(?:BON\s*(?:FISCAL\s*)?(?:NR\.?|#)|NR\.?\s*BON|BF\s*(?:NR\.?)?)\s*[:#.]?\s*([A-Z0-9-]{1,20})\b/i);
      if (bnMatch) {
        receiptNumber = bnMatch[1].trim();
      }
    }
    if (!storeAddress && /\b(?:STR\.?|BD\.?|B-DUL|CALEA|SOS\.?|PIATA|SECTOR|BUCURESTI|CLUJ|TIMISOARA|IASI|BRASOV|CONSTANTA)\b/i.test(line)) {
      if (!KNOWN_RETAILERS.some(r => r.patterns.some(p => p.test(line)))) {
        storeAddress = line.slice(0, 120);
      }
    }
    if (!paymentMethod) {
      if (/\b(?:CARD\s*BANCAR|VISA|MASTERCARD|MAESTRO|CARD|POS)\b/i.test(line)) {
        paymentMethod = /visa/i.test(line)
          ? 'Card Visa'
          : /mastercard/i.test(line)
            ? 'Card Mastercard'
            : 'Card bancar';
      } else if (/\b(?:NUMERAR|CASH)\b/i.test(line)) {
        paymentMethod = 'Numerar';
      } else if (/\b(?:TICHETE\s*DE\s*MASA|CARD\s*MASA|EDENRED|SODEXO|UP)\b/i.test(line)) {
        paymentMethod = 'Tichete / Card masă';
      }
    }

    // Printed subtotal / total
    const totalMatch = line.match(/^(?:TOTAL\s*(?:DE\s*PLATA|GENERAL|LEI|RON|BON)?)\s*[:=]?\s*(-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|-?\d+(?:[.,]\d{2}))\s*(?:lei|ron)?$/i);
    if (totalMatch && !/subtotal|sub-total|economie|reduceri/i.test(line)) {
      const v = parseRomanianDecimal(totalMatch[1]);
      if (v !== null && v > 0) printedTotal = round2(v);
    }
    const subtotalMatch = line.match(/^(?:SUBTOTAL|SUB-TOTAL)\s*[:=]?\s*(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))\s*(?:lei|ron)?$/i);
    if (subtotalMatch) {
      const v = parseRomanianDecimal(subtotalMatch[1]);
      if (v !== null && v >= 0) printedSubtotal = round2(v);
    }

    // VAT lines e.g.: "TVA A 9%: 2,45" or "A=9.00%  TVA 1,23"
    const vatMatch = line.match(/\b(?:TVA|COTA)\s*([A-D])?\s*[:=]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%.*?(\d+(?:[.,]\d{2}))\b/i);
    if (vatMatch) {
      const rate = parseRomanianDecimal(vatMatch[2]);
      const vatAmt = parseRomanianDecimal(vatMatch[3]);
      if (rate !== null && vatAmt !== null) {
        vatBreakdown.push({
          code: vatMatch[1]?.toUpperCase(),
          rate: round2(rate),
          vatAmount: round2(vatAmt)
        });
      }
    }
  }

  const items: ReceiptItem[] = [];
  let pendingQtySpec: {
    quantity: number;
    unit: UnitType;
    unitPrice: number;
    isWeighted: boolean;
    rawLine: string;
  } | null = null;
  let pendingNameOnly: {
    rawName: string;
    eanCode?: string;
    internalCode?: string;
    rawLine: string;
  } | null = null;

  const qtyExprRe =
    /^(\d+(?:[.,]\d{1,3})?)\s*(kg|g|gr|l|ml|buc|pachet)?\s*[x×*]\s*(\d+(?:[.,]\d{2,3}))(?:\s*(?:lei|ron)(?:\/(?:kg|buc|l))?)?(?:\s+([ABCD]))?$/i;

  const lineWithPriceAtEndRe =
    /^(.+?)\s+(-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|-?\d+(?:[.,]\d{2}))\s*(?:lei|ron)?\s*(?:([ABCD])|9%|19%|5%)?$/i;

  const qtyInlineAndPriceRe =
    /^(.+?)\s+(\d+(?:[.,]\d{1,3})?)\s*(kg|g|gr|l|ml|buc|pachet)?\s*[x×*]\s*(\d+(?:[.,]\d{2,3}))\s*(?:lei|ron)?(?:\s*=\s*)?\s+(\d+(?:[.,]\d{2}))\s*(?:lei|ron)?\s*([ABCD])?$/i;

  const qtyLineWithTotalRe =
    /^(\d+(?:[.,]\d{1,3})?)\s*(kg|g|gr|l|ml|buc|pachet)?\s*[x×*]\s*(\d+(?:[.,]\d{2,3}))(?:\s*(?:lei|ron)(?:\/(?:kg|buc|l))?)?\s*(?:=\s*)?\s+(\d+(?:[.,]\d{2}))\s*(?:lei|ron)?\s*([ABCD])?$/i;

  const vatLetterToRate = (letter?: string): number | undefined => {
    if (!letter) return undefined;
    const upper = letter.toUpperCase();
    if (upper === 'A') return 9;
    if (upper === 'B') return 19;
    if (upper === 'C') return 5;
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip obvious header/footer metadata lines unless inside discount/SGR
    if (
      NON_PRODUCT_FOOTER_RE.test(line) &&
      !SGR_LINE_RE.test(line) &&
      !DISCOUNT_OR_COUPON_RE.test(line)
    ) {
      pendingQtySpec = null;
      pendingNameOnly = null;
      continue;
    }

    // 1. Check for standalone discount / coupon line attaching to previous item or receipt coupon
    if (DISCOUNT_OR_COUPON_RE.test(line)) {
      const m = line.match(/(-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|-?\d+(?:[.,]\d{2}))\s*(?:lei|ron)?\s*[ABCD]?$/i);
      const discVal = m ? Math.abs(parseRomanianDecimal(m[1]) || 0) : 0;
      if (discVal > 0) {
        if (COUPON_LINE_RE.test(line) && items.length === 0) {
          couponsTotal = round2(couponsTotal + discVal);
          continue;
        }
        if (COUPON_LINE_RE.test(line) && /\b(?:bon|cos|general|total|voucher)\b/i.test(line)) {
          couponsTotal = round2(couponsTotal + discVal);
          continue;
        }
        if (items.length > 0 && !COUPON_LINE_RE.test(line)) {
          const prev = items[items.length - 1];
          prev.discount = round2((prev.discount || 0) + discVal);
          continue;
        }
        if (COUPON_LINE_RE.test(line)) {
          couponsTotal = round2(couponsTotal + discVal);
          continue;
        }
      }
    }

    // 2. Check for SGR deposit line
    if (SGR_LINE_RE.test(line)) {
      const sgrPriceMatch = line.match(/(\d+(?:[.,]\d{2}))\s*(?:lei|ron)?\s*[ABCD]?$/i);
      const sgrQtyMatch = line.match(/(\d+)\s*[x×*]\s*(0[.,]50)/i);
      const lineSgrTotal = sgrPriceMatch ? parseRomanianDecimal(sgrPriceMatch[1]) : 0.5;
      if (lineSgrTotal !== null && lineSgrTotal > 0) {
        const qty = sgrQtyMatch ? Number(sgrQtyMatch[1]) : Math.max(1, Math.round(lineSgrTotal / 0.5));
        const unitP = sgrQtyMatch ? 0.5 : round2(lineSgrTotal / qty);
        sgrTotal = round2(sgrTotal + lineSgrTotal);
        items.push({
          id: `ri-${items.length + 1}`,
          rawName: line.replace(/\s+\d+(?:[.,]\d{2})\s*(?:lei|ron)?\s*[ABCD]?$/i, '').trim() || 'Garanție SGR',
          normalizedName: 'Garanție ambalaj SGR',
          quantity: qty,
          unit: 'buc',
          unitPrice: unitP,
          totalPrice: round2(lineSgrTotal),
          discount: 0,
          isSgr: true,
          confidence: 'high',
          confidenceScore: 98,
          category: 'Alte produse',
          provenance: {
            rawName: 'ocr',
            quantity: 'ocr',
            unitPrice: 'ocr',
            totalPrice: 'ocr'
          },
          rawLineText: line
        });
        pendingQtySpec = null;
        pendingNameOnly = null;
        continue;
      }
    }

    // 3. Single-line full item: "LAPTE NAPOLACT 2 x 4,50 9,00 A"
    const inlineFull = line.match(qtyInlineAndPriceRe);
    if (inlineFull) {
      const namePart = inlineFull[1].trim();
      const qty = parseRomanianDecimal(inlineFull[2]) || 1;
      const unit = normalizeUnitToken(inlineFull[3] || (String(qty).includes('.') ? 'kg' : 'buc'));
      const unitP = parseRomanianDecimal(inlineFull[4]) || 0;
      const totalP = parseRomanianDecimal(inlineFull[5]) || round2(qty * unitP);
      const { eanCode, internalCode } = extractCodesFromText(namePart);
      const cleanedName = namePart.replace(/\b\d{8,14}\b/g, '').trim();

      items.push({
        id: `ri-${items.length + 1}`,
        rawName: cleanedName,
        normalizedName: expandRomanianReceiptAbbreviation(cleanedName),
        eanCode,
        internalCode,
        quantity: round3(qty),
        unit,
        unitPrice: round2(unitP),
        totalPrice: round2(totalP),
        discount: 0,
        vatRate: vatLetterToRate(inlineFull[6]),
        isWeighted: unit === 'kg' || (qty % 1 !== 0),
        confidence: 'high',
        category: inferCategoryFromName(cleanedName),
        provenance: { rawName: 'ocr', quantity: 'ocr', unitPrice: 'ocr', totalPrice: 'ocr' },
        rawLineText: line
      });
      pendingQtySpec = null;
      pendingNameOnly = null;
      continue;
    }

    // 4. Two-line Lidl/Kaufland top qty line: "2 x 4,50" or "0,750 kg x 12,99 lei/kg"
    const qtyOnlyMatch = line.match(qtyExprRe);
    if (qtyOnlyMatch) {
      const qty = parseRomanianDecimal(qtyOnlyMatch[1]);
      const unitPrice = parseRomanianDecimal(qtyOnlyMatch[3]);
      if (qty !== null && qty > 0 && unitPrice !== null && unitPrice >= 0) {
        const unit = normalizeUnitToken(qtyOnlyMatch[2] || (qty % 1 !== 0 ? 'kg' : 'buc'));
        // If previous line was a product name waiting for its price line, wait for total? No, if no total on qty line, next line may hold total or we calculate if needed.
        if (pendingNameOnly) {
          const totalP = round2(qty * unitPrice);
          items.push({
            id: `ri-${items.length + 1}`,
            rawName: pendingNameOnly.rawName,
            normalizedName: expandRomanianReceiptAbbreviation(pendingNameOnly.rawName),
            eanCode: pendingNameOnly.eanCode,
            internalCode: pendingNameOnly.internalCode,
            quantity: round3(qty),
            unit,
            unitPrice: round2(unitPrice),
            totalPrice: totalP,
            discount: 0,
            vatRate: vatLetterToRate(qtyOnlyMatch[4]),
            isWeighted: unit === 'kg' || qty % 1 !== 0,
            confidence: 'medium',
            category: inferCategoryFromName(pendingNameOnly.rawName),
            provenance: { rawName: 'ocr', quantity: 'ocr', unitPrice: 'ocr', totalPrice: 'calculated' },
            rawLineText: `${pendingNameOnly.rawLine} | ${line}`
          });
          pendingNameOnly = null;
          pendingQtySpec = null;
        } else {
          pendingQtySpec = {
            quantity: round3(qty),
            unit,
            unitPrice: round2(unitPrice),
            isWeighted: unit === 'kg' || qty % 1 !== 0,
            rawLine: line
          };
        }
        continue;
      }
    }

    // 5. Qty + unitPrice + lineTotal line (Carrefour/Kaufland/Auchan style after name line): "0,750 kg x 12,99 = 9,74 A"
    const qtyWithTotalMatch = line.match(qtyLineWithTotalRe);
    if (qtyWithTotalMatch && pendingNameOnly) {
      const qty = parseRomanianDecimal(qtyWithTotalMatch[1]) || 1;
      const unit = normalizeUnitToken(qtyWithTotalMatch[2] || (qty % 1 !== 0 ? 'kg' : 'buc'));
      const unitP = parseRomanianDecimal(qtyWithTotalMatch[3]) || 0;
      const totalP = parseRomanianDecimal(qtyWithTotalMatch[4]) || round2(qty * unitP);

      items.push({
        id: `ri-${items.length + 1}`,
        rawName: pendingNameOnly.rawName,
        normalizedName: expandRomanianReceiptAbbreviation(pendingNameOnly.rawName),
        eanCode: pendingNameOnly.eanCode,
        internalCode: pendingNameOnly.internalCode,
        quantity: round3(qty),
        unit,
        unitPrice: round2(unitP),
        totalPrice: round2(totalP),
        discount: 0,
        vatRate: vatLetterToRate(qtyWithTotalMatch[5]),
        isWeighted: unit === 'kg' || qty % 1 !== 0,
        confidence: 'high',
        category: inferCategoryFromName(pendingNameOnly.rawName),
        provenance: { rawName: 'ocr', quantity: 'ocr', unitPrice: 'ocr', totalPrice: 'ocr' },
        rawLineText: `${pendingNameOnly.rawLine} | ${line}`
      });
      pendingNameOnly = null;
      pendingQtySpec = null;
      continue;
    }

    // 6. Product line ending with price: "LAPTE NAPOLACT 1L  9,00 A" or "DISCOUNT -1,50"
    const endPriceMatch = line.match(lineWithPriceAtEndRe);
    if (endPriceMatch) {
      const label = endPriceMatch[1].trim();
      const priceVal = parseRomanianDecimal(endPriceMatch[2]);
      const vatRate = vatLetterToRate(endPriceMatch[3]);

      // Negative price line usually represents an inline discount on preceding item
      if (priceVal !== null && priceVal < 0 && items.length > 0) {
        items[items.length - 1].discount = round2((items[items.length - 1].discount || 0) + Math.abs(priceVal));
        pendingQtySpec = null;
        pendingNameOnly = null;
        continue;
      }

      if (
        priceVal !== null &&
        priceVal > 0 &&
        /[a-zA-ZăâîșțĂÂÎȘȚ]{2,}/.test(label) &&
        !NON_PRODUCT_FOOTER_RE.test(label)
      ) {
        const { eanCode, internalCode } = extractCodesFromText(label);
        const cleanedLabel = label.replace(/\b\d{8,14}\b/g, '').replace(/\s+/g, ' ').trim();

        const qty = pendingQtySpec ? pendingQtySpec.quantity : 1;
        const unit = pendingQtySpec ? pendingQtySpec.unit : 'buc';
        const unitP = pendingQtySpec ? pendingQtySpec.unitPrice : round2(priceVal / qty);
        const unitProvenance = pendingQtySpec ? 'ocr' : qty === 1 ? 'ocr' : 'calculated';

        items.push({
          id: `ri-${items.length + 1}`,
          rawName: cleanedLabel,
          normalizedName: expandRomanianReceiptAbbreviation(cleanedLabel),
          eanCode,
          internalCode,
          quantity: round3(qty),
          unit,
          unitPrice: round2(unitP),
          totalPrice: round2(priceVal),
          discount: 0,
          vatRate,
          isWeighted: pendingQtySpec?.isWeighted || unit === 'kg',
          confidence: 'high',
          category: inferCategoryFromName(cleanedLabel),
          provenance: {
            rawName: 'ocr',
            quantity: pendingQtySpec ? 'ocr' : 'calculated',
            unitPrice: unitProvenance,
            totalPrice: 'ocr'
          },
          rawLineText: pendingQtySpec ? `${pendingQtySpec.rawLine} | ${line}` : line
        });
        pendingQtySpec = null;
        pendingNameOnly = null;
        continue;
      }
    }

    // 7. Standalone product name line (expecting qty x price on next line)
    if (/[a-zA-ZăâîșțĂÂÎȘȚ]{2,}/.test(line) && !NON_PRODUCT_FOOTER_RE.test(line)) {
      const { eanCode, internalCode } = extractCodesFromText(line);
      pendingNameOnly = {
        rawName: line.replace(/\b\d{8,14}\b/g, '').replace(/\s+/g, ' ').trim(),
        eanCode,
        internalCode,
        rawLine: line
      };
    }
  }

  const productGrossSum = round2(items.filter(i => !i.isSgr).reduce((sum, i) => sum + i.totalPrice, 0));
  const itemDiscountSum = round2(items.reduce((sum, i) => sum + (i.discount || 0), 0));
  const totalDiscount = round2(itemDiscountSum + couponsTotal);
  const vatTotal = round2(vatBreakdown.reduce((sum, v) => sum + (v.vatAmount || 0), 0));

  const computedTotal = round2(Math.max(0, productGrossSum + sgrTotal - totalDiscount));
  const finalPrintedTotal = printedTotal ?? computedTotal;

  return {
    storeId: retailer.storeId,
    storeName: retailer.storeName,
    storeAddress,
    fiscalNumber,
    receiptNumber,
    date: date || new Date().toISOString().slice(0, 10),
    time: time || undefined,
    items,
    subtotal: printedSubtotal ?? productGrossSum,
    discountTotal: totalDiscount,
    couponsTotal: round2(couponsTotal),
    sgrTotal: round2(sgrTotal),
    vatTotal: vatTotal > 0 ? vatTotal : undefined,
    vatBreakdown: vatBreakdown.length > 0 ? vatBreakdown : undefined,
    printedTotal: finalPrintedTotal,
    calculatedTotal: computedTotal,
    total: finalPrintedTotal,
    currency: 'RON',
    paymentMethod,
    rawOcrText: normalizedInput
  };
}

/**
 * Validates mathematical consistency across receipt lines and totals without modifying printed totals.
 */
export function validateReceiptMath(receipt: Receipt): Receipt {
  const reasons: string[] = [];
  let lineMismatchCount = 0;

  const validatedItems = receipt.items.map(item => {
    const qty = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    const unitPrice = Number.isFinite(item.unitPrice) ? item.unitPrice : 0;
    const totalPrice = Number.isFinite(item.totalPrice) ? item.totalPrice : 0;

    // For weighted items (e.g. 0.750 kg * 12.99 = 9.7425 -> 9.74 or 9.75), allow 0.03 RON rounding
    const expectedLineTotal = round2(qty * unitPrice);
    const diff = round2(Math.abs(expectedLineTotal - totalPrice));
    const tolerance = item.isWeighted || qty % 1 !== 0 ? 0.03 : 0.02;
    const mathValid = unitPrice >= 0 && totalPrice >= 0 && diff <= tolerance;

    if (!mathValid) {
      lineMismatchCount++;
      reasons.push(
        `Linia "${item.rawName}": ${qty} × ${unitPrice.toFixed(2)} = ${expectedLineTotal.toFixed(2)} lei, dar pe bon apare ${totalPrice.toFixed(2)} lei (diferență ${diff.toFixed(2)} lei).`
      );
    }

    return {
      ...item,
      mathValid,
      mathDiscrepancy: diff
    };
  });

  const nonSgrItems = validatedItems.filter(i => !i.isSgr && !i.isCouponOrDiscountLine);
  const sgrItems = validatedItems.filter(i => i.isSgr);

  const productsGross = round2(nonSgrItems.reduce((sum, item) => sum + item.totalPrice, 0));
  const itemDiscounts = round2(nonSgrItems.reduce((sum, item) => sum + (item.discount || 0), 0));
  const sgrFromLines = round2(sgrItems.reduce((sum, item) => sum + item.totalPrice, 0));
  const effectiveSgrTotal = round2(Math.max(sgrFromLines, receipt.sgrTotal || 0));
  const effectiveCouponsTotal = round2(receipt.couponsTotal || 0);
  const effectiveDiscountTotal = round2(Math.max(itemDiscounts + effectiveCouponsTotal, receipt.discountTotal || 0));

  const calculatedTotal = round2(Math.max(0, productsGross + effectiveSgrTotal - effectiveDiscountTotal));
  const printedTotal = round2(receipt.printedTotal ?? receipt.total);
  const discrepancyAmount = round2(Math.abs(calculatedTotal - printedTotal));

  if (discrepancyAmount > 0.05) {
    reasons.push(
      `Diferență de ${discrepancyAmount.toFixed(2)} lei între suma calculată (${calculatedTotal.toFixed(2)} lei) și totalul imprimat pe bon (${printedTotal.toFixed(2)} lei).`
    );
  }

  if (nonSgrItems.length === 0) {
    reasons.push('Nu au fost identificate produse comerciale valide pe bon.');
  }

  if (receipt.storeId === 'unknown') {
    reasons.push('Retailerul nu a fost identificat cu certitudine.');
  }

  let validationStatus: ReceiptValidationStatus = 'VALID';
  if (nonSgrItems.length === 0 && printedTotal <= 0) {
    validationStatus = 'INVALID';
  } else if (
    discrepancyAmount > 0.05 ||
    lineMismatchCount > 0 ||
    receipt.storeId === 'unknown' ||
    !receipt.date
  ) {
    validationStatus = 'NEEDS_REVIEW';
  }

  return {
    ...receipt,
    items: validatedItems,
    sgrTotal: effectiveSgrTotal,
    couponsTotal: effectiveCouponsTotal,
    discountTotal: effectiveDiscountTotal,
    printedTotal,
    calculatedTotal,
    discrepancyAmount,
    validationStatus,
    validationReasons: reasons
  };
}

/**
 * Computes field-by-field and overall confidence scores (0-100).
 */
export function computeReceiptConfidence(
  receipt: Receipt,
  quality?: ReceiptOcrQualityInput
): Receipt {
  const qualityPenalty =
    (quality?.isBlurry ? 18 : 0) +
    (quality?.isOverexposed ? 15 : 0) +
    (quality?.isUnderexposed ? 12 : 0) +
    (quality?.isTruncated ? 22 : 0);

  const ocrBase = Math.max(
    45,
    Math.min(100, (quality?.ocrTextConfidence ?? 92) - qualityPenalty)
  );

  // Retailer score
  const retailerKnown = STORES.some(s => s.id === receipt.storeId);
  const retailerScore = Math.round(
    Math.max(25, Math.min(100, (retailerKnown ? 97 : 52) - qualityPenalty * 0.5))
  );

  // Date score
  const validDateFormat = /^\d{4}-\d{2}-\d{2}$/.test(receipt.date || '');
  const dateScore = Math.round(
    Math.max(30, Math.min(100, (validDateFormat ? 96 : 45) - qualityPenalty * 0.5))
  );

  // Item scores
  const scoredItems = receipt.items.map(item => {
    const productScore = Math.round(
      Math.max(
        30,
        Math.min(
          100,
          (item.rawName.trim().length >= 3 ? ocrBase : 45) -
            (item.matchStatus === 'ambiguous' ? 8 : 0)
        )
      )
    );
    const quantityScore = Math.round(
      Math.max(30, Math.min(100, item.quantity > 0 ? (item.provenance?.quantity === 'manual' ? 100 : ocrBase) : 35))
    );
    const unitPriceScore = Math.round(
      Math.max(
        25,
        Math.min(
          100,
          item.unitPrice > 0
            ? (item.mathValid === false ? Math.min(58, ocrBase - 25) : ocrBase)
            : 30
        )
      )
    );
    const lineTotalScore = Math.round(
      Math.max(
        25,
        Math.min(
          100,
          item.totalPrice > 0
            ? (item.mathValid === false ? Math.min(55, ocrBase - 28) : ocrBase + 2)
            : 30
        )
      )
    );

    const itemScore = Math.round(
      productScore * 0.25 + quantityScore * 0.2 + unitPriceScore * 0.3 + lineTotalScore * 0.25
    );

    return {
      ...item,
      confidenceScore: itemScore,
      confidence: confidenceBandToLevel(itemScore),
      confidenceDetails: {
        product: productScore,
        quantity: quantityScore,
        unitPrice: unitPriceScore,
        lineTotal: lineTotalScore
      }
    };
  });

  const itemsAverage = scoredItems.length
    ? Math.round(scoredItems.reduce((sum, it) => sum + (it.confidenceScore || 0), 0) / scoredItems.length)
    : 35;

  const discrepancy = receipt.discrepancyAmount ?? 0;
  const totalScore = Math.round(
    Math.max(
      25,
      Math.min(
        100,
        (receipt.total > 0 ? ocrBase : 35) - (discrepancy > 0.05 ? Math.min(40, discrepancy * 8 + 15) : 0)
      )
    )
  );

  const overall = Math.round(
    retailerScore * 0.15 + dateScore * 0.1 + totalScore * 0.3 + itemsAverage * 0.45
  );
  const band = classifyConfidenceBand(overall);

  const confidenceScores: ReceiptConfidenceBreakdown = {
    overall,
    band,
    retailer: retailerScore,
    date: dateScore,
    total: totalScore,
    itemsAverage
  };

  let validationStatus = receipt.validationStatus || 'VALID';
  const validationReasons = [...(receipt.validationReasons || [])];
  if (overall < 60 && validationStatus === 'VALID') {
    validationStatus = 'NEEDS_REVIEW';
    validationReasons.push(`Scor general de încredere scăzut (${overall}/100). Verifică datele extrase.`);
  }

  return {
    ...receipt,
    items: scoredItems,
    confidenceScores,
    validationStatus,
    validationReasons
  };
}

/**
 * Matches receipt line items strictly against canonical catalog products.
 * Order: 1. Valid EAN -> 2. Normalized tokens + brand + package quantity/unit + variant guards.
 * If ambiguous, leaves matchedProductId unset and returns ranked matchCandidates for manual user confirmation.
 */
export function matchReceiptItemsToCatalog(
  items: ReceiptItem[],
  catalogProducts: Product[],
  aliasSource?: CanonicalAliasIndex | Map<string, string> | Record<string, string>
): ReceiptItem[] {
  const stopWords = new Set(['de', 'la', 'si', 'in', 'cu', 'fara', 'buc', 'kg', 'g', 'l', 'ml']);
  const tokenize = (text: string): string[] =>
    stripDiacritics(text)
      .replace(/[^a-z0-9%.\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !stopWords.has(t));

  const aliasIndex = buildCanonicalAliasIndex(aliasSource ?? catalogProducts);
  const productsById = new Map(catalogProducts.map(p => [p.id, p]));
  const toCanonical = (prod: Product): Product => {
    const cid = resolveCanonicalProductId(prod.id, aliasIndex);
    return cid && productsById.has(cid) ? productsById.get(cid)! : prod;
  };
  const canonicalCatalogProducts = catalogProducts.filter(p => {
    if (p.canonicalProductId) return false;
    const cid = resolveCanonicalProductId(p.id, aliasIndex);
    return !cid || cid === p.id;
  });
  const scorePool = canonicalCatalogProducts.length > 0 ? canonicalCatalogProducts : catalogProducts;

  return items.map(item => {
    if (item.isSgr || item.isCouponOrDiscountLine) {
      return {
        ...item,
        matchStatus: 'unmatched',
        matchCandidates: []
      };
    }

    // Preserve explicit manual selection if present (promoting any alias to canonical root)
    if (item.provenance?.matchedProductId === 'manual' && item.matchedProductId) {
      const canonManualId = resolveCanonicalProductId(item.matchedProductId, aliasIndex) || item.matchedProductId;
      const manualProduct = productsById.get(canonManualId) || productsById.get(item.matchedProductId);
      if (manualProduct) {
        const canonical = toCanonical(manualProduct);
        return {
          ...item,
          matchedProductId: canonical.id,
          matchedProductName: canonical.name,
          matchStatus: 'matched'
        };
      }
    }

    // 1. Strict valid EAN match (searching all products including aliases, promoting to canonical parent)
    if (item.eanCode && isValidEanBarcode(item.eanCode)) {
      const exactEan = catalogProducts.find(
        p => p.barcode && p.barcode.replace(/\D/g, '') === item.eanCode!.replace(/\D/g, '')
      );
      if (exactEan) {
        const canonicalEan = toCanonical(exactEan);
        const cand: ReceiptMatchCandidate = {
          productId: canonicalEan.id,
          productName: canonicalEan.name,
          brand: canonicalEan.brand,
          packageWeightOrVolume: canonicalEan.packageWeightOrVolume,
          packageUnit: canonicalEan.packageUnit,
          score: 1.0,
          matchMethod: 'ean_exact'
        };
        return {
          ...item,
          matchedProductId: canonicalEan.id,
          matchedProductName: canonicalEan.name,
          matchStatus: 'matched',
          matchCandidates: [cand]
        };
      }
    }

    // 2. Normalized name + brand + quantity/unit scoring (strictly over canonical products)
    const expanded = item.normalizedName || expandRomanianReceiptAbbreviation(item.rawName);
    const itemTokens = tokenize(`${item.rawName} ${expanded}`);
    const itemPkg = extractInlinePackage(item.rawName);
    const itemNorm = stripDiacritics(`${item.rawName} ${expanded}`);
    const itemVariantMeta = normalizeTitleAndVariants(`${item.rawName} ${expanded}`);

    const scored: ReceiptMatchCandidate[] = [];

    for (const product of scorePool) {
      // Variant guards: fat percentage, zero/diet, lactose-free, coffee form, alcohol-free, flavors
      const itemPct = itemNorm.match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1]?.replace(',', '.');
      const prodPct = stripDiacritics(product.name).match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1]?.replace(',', '.');
      if (itemPct && prodPct && itemPct !== prodPct) continue;

      const prodNorm = stripDiacritics(product.name);
      const itemZero = /\b(?:zero|diet|light|fara\s+zahar)\b/.test(itemNorm);
      const prodZero = /\b(?:zero|diet|light|fara\s+zahar)\b/.test(prodNorm);
      if (itemZero !== prodZero) continue;

      const prodVariantMeta = normalizeTitleAndVariants(product.name);
      if (!areVariantAttributesCompatible(itemVariantMeta.variantAttributes, prodVariantMeta.variantAttributes).compatible) {
        continue;
      }

      const prodTokens = tokenize(`${product.name} ${product.brand}`);
      if (itemTokens.length === 0 || prodTokens.length === 0) continue;

      const matches = itemTokens.filter(t1 =>
        prodTokens.some(t2 => t1 === t2 || (t1.length >= 4 && t2.length >= 4 && (t1.startsWith(t2.slice(0, 4)) || t2.startsWith(t1.slice(0, 4)))))
      );
      if (matches.length === 0) continue;

      const tokenScore = matches.length / new Set([...itemTokens, ...prodTokens]).size;
      const coverage = matches.length / Math.max(1, itemTokens.length);

      let brandBonus = 0;
      const brandNorm = stripDiacritics(product.brand || '');
      if (brandNorm && brandNorm.length >= 3 && itemNorm.includes(brandNorm)) {
        brandBonus = 0.18;
      }

      let pkgScore = 0.08;
      if (itemPkg.weightOrVolume && itemPkg.unit && product.packageWeightOrVolume) {
        const isLiqA = ['l', 'ml'].includes(itemPkg.unit);
        const isLiqB = ['l', 'ml'].includes(product.packageUnit);
        if (isLiqA !== isLiqB && product.packageUnit !== 'buc') {
          continue;
        }
        const normA = ['g', 'ml'].includes(itemPkg.unit) ? itemPkg.weightOrVolume / 1000 : itemPkg.weightOrVolume;
        const normB = ['g', 'ml'].includes(product.packageUnit) ? product.packageWeightOrVolume / 1000 : product.packageWeightOrVolume;
        const ratio = Math.min(normA, normB) / Math.max(normA, normB);
        if (ratio < 0.72) continue;
        pkgScore = ratio >= 0.92 ? 0.18 : 0.1;
      }

      const finalScore = Math.min(0.99, round3(tokenScore * 0.5 + coverage * 0.32 + brandBonus + pkgScore));
      if (finalScore >= 0.42) {
        const canonical = toCanonical(product);
        scored.push({
          productId: canonical.id,
          productName: canonical.name,
          brand: canonical.brand,
          packageWeightOrVolume: canonical.packageWeightOrVolume,
          packageUnit: canonical.packageUnit,
          score: finalScore,
          matchMethod: 'name_brand_quantity'
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const dedupedCandidates: ReceiptMatchCandidate[] = [];
    const seenCanonIds = new Set<string>();
    for (const c of scored) {
      if (seenCanonIds.has(c.productId)) continue;
      seenCanonIds.add(c.productId);
      dedupedCandidates.push(c);
      if (dedupedCandidates.length >= 4) break;
    }

    if (dedupedCandidates.length === 0) {
      return {
        ...item,
        matchedProductId: undefined,
        matchedProductName: undefined,
        matchStatus: 'unmatched',
        matchCandidates: []
      };
    }

    const best = dedupedCandidates[0];
    const second = dedupedCandidates[1];
    const clearWinner = best.score >= 0.72 && (!second || best.score - second.score >= 0.12);

    if (clearWinner) {
      return {
        ...item,
        matchedProductId: best.productId,
        matchedProductName: best.productName,
        matchStatus: 'matched',
        matchCandidates: dedupedCandidates
      };
    }

    // Ambiguous: do not force a match
    return {
      ...item,
      matchedProductId: undefined,
      matchedProductName: undefined,
      matchStatus: 'ambiguous',
      matchCandidates: dedupedCandidates
    };
  });
}

/**
 * Generates a deterministic content fingerprint for duplicate receipt detection.
 */
export function computeReceiptFingerprint(receipt: Pick<Receipt, 'storeId' | 'storeName' | 'date' | 'time' | 'receiptNumber' | 'total' | 'items'>): string {
  const storeKey = stripDiacritics(receipt.storeId || receipt.storeName || '');
  const dateKey = (receipt.date || '').slice(0, 10);
  const totalKey = round2(Number(receipt.total || 0)).toFixed(2);
  const itemKeys = (receipt.items || [])
    .filter(i => !i.isCouponOrDiscountLine)
    .map(i => `${stripDiacritics(i.rawName)}:${round3(i.quantity)}:${round2(i.totalPrice).toFixed(2)}`)
    .sort()
    .join('|');

  const rawSignature = `${storeKey}::${dateKey}::${totalKey}::${itemKeys}`;
  // Deterministic 64-bit FNV-1a hex string (runs identically in browser & Node without async subtle)
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < rawSignature.length; i++) {
    const c = rawSignature.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `rcp-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Detects duplicate receipts while avoiding false positives for distinct purchases on the same day with the same total.
 */
export function detectDuplicateReceipts(
  candidate: Receipt,
  existingReceipts: Receipt[]
): DuplicateDetectionResult {
  const candidateStore = stripDiacritics(candidate.storeId || candidate.storeName);
  const candidateDate = (candidate.date || '').slice(0, 10);
  const candidateTotal = round2(candidate.total || 0);
  const candidateFingerprint = candidate.contentFingerprint || computeReceiptFingerprint(candidate);
  const candidateReceiptNum = stripDiacritics(candidate.receiptNumber || candidate.fiscalNumber || '');

  const candidateItemSigs = new Set(
    candidate.items
      .filter(i => !i.isSgr)
      .map(i => `${stripDiacritics(i.rawName)}:${round2(i.totalPrice).toFixed(2)}`)
  );

  for (const existing of existingReceipts) {
    if (existing.id === candidate.id) continue;

    const existingStore = stripDiacritics(existing.storeId || existing.storeName);
    const existingDate = (existing.date || '').slice(0, 10);
    const existingTotal = round2(existing.total || 0);

    if (candidateStore !== existingStore || candidateDate !== existingDate) {
      continue;
    }

    const existingReceiptNum = stripDiacritics(existing.receiptNumber || existing.fiscalNumber || '');
    // If both have explicit receipt numbers and they differ, they are definitely distinct receipts!
    if (
      candidateReceiptNum &&
      existingReceiptNum &&
      candidateReceiptNum !== existingReceiptNum
    ) {
      continue;
    }

    // Exact fingerprint match
    const existingFingerprint = existing.contentFingerprint || computeReceiptFingerprint(existing);
    if (candidateFingerprint === existingFingerprint) {
      return {
        isDuplicate: true,
        matchingReceiptId: existing.id,
        matchReason: `Bon identic deja salvat pentru ${existing.storeName} din data ${existingDate} (${existingTotal.toFixed(2)} lei).`,
        confidence: 'exact'
      };
    }

    // Same store + date + receiptNumber + total
    if (
      candidateReceiptNum &&
      existingReceiptNum &&
      candidateReceiptNum === existingReceiptNum &&
      Math.abs(candidateTotal - existingTotal) <= 0.05
    ) {
      return {
        isDuplicate: true,
        matchingReceiptId: existing.id,
        matchReason: `Numărul bonului (${existing.receiptNumber || existing.fiscalNumber}) există deja pentru ${existing.storeName} la ${existingDate}.`,
        confidence: 'exact'
      };
    }

    // Near match: same total + same time (or missing time) + high item overlap (>= 70%)
    if (Math.abs(candidateTotal - existingTotal) <= 0.05) {
      const sameTimeOrMissing = !candidate.time || !existing.time || candidate.time === existing.time;
      if (!sameTimeOrMissing) {
        // Different purchase time with different items -> distinct receipt
        continue;
      }

      const existingSigs = new Set(
        existing.items
          .filter(i => !i.isSgr)
          .map(i => `${stripDiacritics(i.rawName)}:${round2(i.totalPrice).toFixed(2)}`)
      );
      const unionSize = new Set([...candidateItemSigs, ...existingSigs]).size;
      const commonCount = [...candidateItemSigs].filter(sig => existingSigs.has(sig)).length;
      const overlap = unionSize > 0 ? commonCount / unionSize : 0;

      if (overlap >= 0.7) {
        return {
          isDuplicate: true,
          matchingReceiptId: existing.id,
          matchReason: `Bon foarte similar (${Math.round(overlap * 100)}% produse identice, ${existingTotal.toFixed(2)} lei) deja înregistrat la ${existing.storeName}.`,
          confidence: 'probable'
        };
      }
    }
  }

  return { isDuplicate: false, confidence: 'none' };
}

/**
 * Full pipeline: normalizes extracted receipt (or raw OCR text), validates math, computes confidence scores,
 * matches items against catalog candidates, and computes content fingerprint.
 */
export function buildAnalyzedReceipt(params: {
  extracted?: Partial<Receipt> & { items?: any[] };
  rawOcrText?: string;
  availableStores?: Store[];
  catalogProducts?: Product[];
  ocrQuality?: ReceiptOcrQualityInput;
  existingReceipts?: Receipt[];
}): Receipt {
  const stores = params.availableStores || STORES;
  const products = params.catalogProducts || [];

  const textParsed = params.rawOcrText
    ? parseReceiptOcrText(params.rawOcrText, stores)
    : undefined;

  const base = params.extracted || {};
  const retailer = identifyRetailer(
    [base.storeId, base.storeName, params.rawOcrText?.slice(0, 200)].filter(Boolean).join(' '),
    stores
  );

  const rawItems = Array.isArray(base.items) && base.items.length > 0
    ? base.items
    : (textParsed?.items || []);

  const normalizedItems: ReceiptItem[] = rawItems.map((it: any, idx: number) => {
    const rawName = String(it.rawName || 'Produs').trim();
    const isSgr = Boolean(it.isSgr) || SGR_LINE_RE.test(rawName);
    const isCoupon = Boolean(it.isCouponOrDiscountLine) || COUPON_LINE_RE.test(rawName);
    const qty = parseRomanianDecimal(it.quantity) ?? 1;
    const unitPrice = parseRomanianDecimal(it.unitPrice) ?? 0;
    const totalPrice = parseRomanianDecimal(it.totalPrice) ?? round2(qty * unitPrice);
    const discount = Math.max(0, parseRomanianDecimal(it.discount) ?? 0);
    const candidateCode = typeof it.eanCode === 'string'
      ? it.eanCode
      : typeof it.barcode === 'string'
        ? it.barcode
        : undefined;
    const extractedCodes = extractCodesFromText(rawName);
    const validEan = candidateCode && isValidEanBarcode(candidateCode)
      ? candidateCode.replace(/\D/g, '')
      : extractedCodes.eanCode;
    const internalCode = it.internalCode || (!validEan && candidateCode ? candidateCode : extractedCodes.internalCode);

    const unit: UnitType = it.unit
      ? normalizeUnitToken(it.unit)
      : qty % 1 !== 0
        ? 'kg'
        : 'buc';

    return {
      id: it.id || `ri-${Date.now()}-${idx}`,
      rawName,
      normalizedName: it.normalizedName || expandRomanianReceiptAbbreviation(rawName),
      matchedProductId: it.matchedProductId || undefined,
      matchedProductName: it.matchedProductName || undefined,
      eanCode: validEan,
      internalCode,
      quantity: round3(qty > 0 ? qty : 1),
      unit,
      unitPrice: round2(unitPrice),
      totalPrice: round2(totalPrice),
      discount: round2(discount),
      vatRate: it.vatRate != null ? Number(it.vatRate) : undefined,
      isWeighted: Boolean(it.isWeighted) || unit === 'kg' || qty % 1 !== 0,
      isSgr,
      isCouponOrDiscountLine: isCoupon,
      confidence: 'medium',
      category: (it.category as ProductCategory) || inferCategoryFromName(rawName),
      provenance: it.provenance || {
        rawName: 'ocr',
        quantity: it.quantity != null ? 'ocr' : 'calculated',
        unitPrice: it.unitPrice != null ? 'ocr' : 'calculated',
        totalPrice: it.totalPrice != null ? 'ocr' : 'calculated',
        discount: 'ocr'
      },
      rawLineText: it.rawLineText || rawName
    };
  });

  const matchedItems = matchReceiptItemsToCatalog(normalizedItems, products);

  const sgrTotal = round2(
    parseRomanianDecimal(base.sgrTotal) ??
    textParsed?.sgrTotal ??
    matchedItems.filter(i => i.isSgr).reduce((s, i) => s + i.totalPrice, 0)
  );
  const couponsTotal = round2(
    parseRomanianDecimal(base.couponsTotal) ?? textParsed?.couponsTotal ?? 0
  );
  const printedTotal = round2(
    parseRomanianDecimal(base.printedTotal ?? base.total) ?? textParsed?.printedTotal ?? 0
  );
  const discountTotal = round2(
    parseRomanianDecimal(base.discountTotal) ??
    textParsed?.discountTotal ??
    matchedItems.reduce((s, i) => s + (i.discount || 0), 0) + couponsTotal
  );
  const subtotal = round2(
    parseRomanianDecimal(base.subtotal) ??
    textParsed?.subtotal ??
    matchedItems.filter(i => !i.isSgr).reduce((s, i) => s + i.totalPrice, 0)
  );

  const date = normalizeDateString(base.date) || textParsed?.date || new Date().toISOString().slice(0, 10);

  const initialReceipt: Receipt = {
    id: base.id || `rec-${Date.now()}`,
    storeId: retailer.storeId,
    storeName: retailer.storeName,
    storeAddress: base.storeAddress || textParsed?.storeAddress,
    fiscalNumber: base.fiscalNumber || textParsed?.fiscalNumber,
    receiptNumber: base.receiptNumber || textParsed?.receiptNumber,
    date,
    time: base.time || textParsed?.time,
    items: matchedItems,
    subtotal,
    discountTotal,
    couponsTotal,
    sgrTotal,
    vatTotal: base.vatTotal ?? textParsed?.vatTotal,
    vatBreakdown: base.vatBreakdown || textParsed?.vatBreakdown,
    printedTotal,
    total: printedTotal,
    currency: 'RON',
    paymentMethod: base.paymentMethod || textParsed?.paymentMethod,
    createdAt: base.createdAt || new Date().toISOString(),
    processedAt: new Date().toISOString(),
    verifiedStatus: 'draft',
    rawOcrText: params.rawOcrText || textParsed?.rawOcrText
  };

  const mathValidated = validateReceiptMath(initialReceipt);
  const scored = computeReceiptConfidence(mathValidated, params.ocrQuality);
  const contentFingerprint = computeReceiptFingerprint(scored);

  const duplicateCheck = params.existingReceipts?.length
    ? detectDuplicateReceipts({ ...scored, contentFingerprint }, params.existingReceipts)
    : { isDuplicate: false, confidence: 'none' as const };

  return {
    ...scored,
    contentFingerprint,
    originalExtractedData: {
      storeName: scored.storeName,
      date: scored.date,
      time: scored.time,
      receiptNumber: scored.receiptNumber,
      printedTotal: scored.printedTotal,
      sgrTotal: scored.sgrTotal,
      couponsTotal: scored.couponsTotal,
      items: scored.items.map(it => ({
        rawName: it.rawName,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        discount: it.discount,
        eanCode: it.eanCode
      }))
    },
    duplicateWarning: duplicateCheck.isDuplicate
      ? {
          isDuplicate: true,
          matchingReceiptId: duplicateCheck.matchingReceiptId,
          matchReason: duplicateCheck.matchReason
        }
      : undefined
  };
}

/**
 * Builds private personal price history observations from a confirmed receipt.
 * Excludes SGR and non-product discount lines, and computes effectivePaidUnitPrice.
 */
export function buildUserPriceObservations(
  receipt: Receipt,
  userId?: string
): UserPriceObservation[] {
  const sourceLabel = `${receipt.storeName} • ${receipt.date}${receipt.receiptNumber ? ` (#${receipt.receiptNumber})` : ''}`;

  return receipt.items
    .filter(item => !item.isSgr && !item.isCouponOrDiscountLine && item.quantity > 0 && item.totalPrice >= 0)
    .map(item => {
      const discount = Math.max(0, item.discount || 0);
      const totalPaid = round2(Math.max(0, item.totalPrice - discount));
      const effectivePaidUnitPrice = round2(totalPaid / Math.max(0.001, item.quantity));

      return {
        id: `upo-${receipt.id}-${item.id}`,
        userId,
        receiptId: receipt.id,
        receiptItemId: item.id,
        productId: item.matchedProductId || undefined,
        productName: item.matchedProductName || item.normalizedName || item.rawName,
        storeId: receipt.storeId !== 'unknown' ? receipt.storeId : undefined,
        storeName: receipt.storeName,
        purchaseDate: receipt.date,
        quantity: round3(item.quantity),
        unit: item.unit || 'buc',
        unitPrice: round2(item.unitPrice),
        discount: round2(discount),
        effectivePaidUnitPrice,
        totalPaid,
        currency: 'RON',
        sourceReceiptLabel: sourceLabel,
        isSgr: false
      };
    });
}
