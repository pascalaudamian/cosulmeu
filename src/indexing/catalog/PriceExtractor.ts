// src/indexing/catalog/PriceExtractor.ts
// Motor contextual strict pentru extragerea și validarea prețurilor vs cantități/ambalaje.
// Previne confuzia dintre gramaje/volume (0,33 L, 100 g, 654 ml), procente (33%) sau coduri (CCM 7.3) și prețuri de vânzare.

import { UnitType } from '../../types.ts';

export type PriceProofType =
  | 'currency_label'
  | 'price_selector'
  | 'contextual_decimal'
  | 'explicit_field'
  | 'rejected_quantity'
  | 'rejected_percent'
  | 'rejected_noise'
  | 'none';

export type PriceValidationStatus = 'VALID' | 'WARNING' | 'INVALID' | 'MISSING';

export interface ExtractedPriceResult {
  value: number | null;
  currency: 'RON' | null;
  proofType: PriceProofType;
  rawMatch?: string;
  warnings: string[];
}

export interface SafePackagingResult {
  packageQuantity?: number;
  packageUnit?: UnitType;
  weight?: number;
  volume?: number;
  packageSize?: string;
  packCount?: number;
  unitPackageQuantity?: number;
  unitPackageUnit?: UnitType;
}

export interface OfferPriceValidationResult {
  status: PriceValidationStatus;
  code?: string;
  reasons: string[];
  warnings: string[];
}

const COMMERCIAL_PRICE_CUE_RE = /\b(?:pre[țt](?:\s*(?:nou|vechi|promo|promo[țt]ional|redus|standard|normal|club|card|lidl\s*plus|kaufland\s*card))?|ofert[ăa]|reducere\s+la|doar|acum|super\s*pre[țt]|cel\s+mai\s+mic\s+pre[țt])\b/i;
const CURRENCY_AFTER_RE = /(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:lei|ron)\b/gi;
const CURRENCY_BEFORE_RE = /\b(?:lei|ron)\s*[:\-]?\s*(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;

const UNIT_ATTACHED_NUMBER_RE = /(\d+(?:[.,]\d+)?)\s*(?:kg|gr|g|ml|cl|dl|l|litri|litru|buc(?:ati|ăți|\.)?|role|rol[ăa]|pachet(?:e)?|set(?:uri)?|capsule|tablete|plicuri|perechi|cm|mm|m|m2|m²|mp|g\/m2|g\/m²|g\/mp|km|kw|w|v|hz|mah|gb|tb|mb|mp|ani|luni|zile|%)/i;

const NOISE_HEADER_PATTERNS: RegExp[] = [
  /\b(?:CCM\s*\d+(?:[.,]\d+)?|Taxonomie\s+UE|Activit[ăa][țt]i\s+economice|Raport\s+(?:anual|de\s+sustenabilitate|ESG)|EBITDA|GRI\s+\d+|EU\s+Taxonomy)\b/i,
  /^Produse\s+din\s+magazinele\s+/i,
  /^(?:Oferta\s+este\s+valabil[ăa]|Valabil\s+[îi]n\s+perioada|[ÎI]n\s+limita\s+stocului|Imaginile\s+sunt\s+cu\s+titlu|Toate\s+pre[țt]urile\s+sunt|Promo[țt]ie\s+valabil[ăa]|S[ăa]pt[ăa]m[âa]na\s+viitoare|Cataloage\s+și\s+oferte|Vezi\s+toate\s+ofertele|Descarc[ăa]\s+catalogul|Newsletter|Politica\s+de\s+confiden[țt]ialitate)/i,
  /^(?:De\s+(?:luni|mar[țt]i|miercuri|joi|vineri|s[âa]mb[ăa]t[ăa]|duminic[ăa])(?:\s*,?\s*\d{1,2}[./-]\d{1,2})?|Din\s+\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)$/i,
  /^(?:Lactate(?:\s*[șs]i|\s*,)?\s*ou[ăa]|Fructe\s+[șs]i\s+legume|Carne\s+[șs]i\s+pe[șs]te|Panifica[țt]ie|B[ăa]uturi|Produse\s+congelate|Produse\s+de\s+baz[ăa]|Cur[ăa][țt]enie|Igien[ăa]\s+personal[ăa]|Articole\s+nealimentare|Ofertele\s+s[ăa]pt[ăa]m[âa]nii|Super\s+ofert[ăa]|Mega\s+ofert[ăa])$/i,
  /^de\s+plastic\s+sau\s+/i,
  /^[\d.,\s%\-+/*()]+(?:lei|ron)?$/i,
  /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?(?:\s*[-–]\s*\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)?$/
];

const COMMON_VOLUME_WEIGHT_DECIMALS = new Set([0.1, 0.15, 0.2, 0.25, 0.27, 0.275, 0.3, 0.33, 0.35, 0.4, 0.44, 0.45, 0.5, 0.6, 0.7, 0.75]);

export function parseLocalizedNumericToken(token: string): number | null {
  if (!token) return null;
  let cleaned = token.trim().replace(/\s+/g, '');
  if (!cleaned) return null;

  // Format românesc/european: 1.299,00 -> 1299.00
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(',', '.');
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }

  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(2));
}

export class PriceExtractor {
  /**
   * Detectează titluri non-produs: bannere legale, categorii goale, date calendaristice, rapoarte sustenabilitate.
   */
  static isNoiseOrNonProductTitle(title: string): boolean {
    const trimmed = (title || '').trim();
    if (trimmed.length < 2) return true;
    if (!/[a-zA-ZăâîșțĂÂÎȘȚ]/.test(trimmed)) return true;

    for (const pattern of NOISE_HEADER_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }

    // Respinge texte lungi care par fraze juridice/note de subsol
    if (trimmed.length > 160 && /\b(?:valabil[ăa]|stocului|magazinele|regulament|taxonomie|raport)\b/i.test(trimmed)) {
      return true;
    }

    return false;
  }

  /**
   * Verifică dacă un text conține un număr atașat unei unități fizice, procent sau cod model (NU preț).
   */
  static isLikelyQuantityOrPercentToken(snippet: string): 'quantity' | 'percent' | null {
    const s = (snippet || '').trim();
    if (!s) return null;
    if (/\d+(?:[.,]\d+)?\s*%/.test(s)) return 'percent';
    // Verifică dacă numărul este urmat imediat de o unitate și NU este urmat de lei/ron
    if (
      /^(?:[-+]?\s*)?\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|cl|dl|l|litri|litru|buc(?:ati|ăți|\.)?|role|rol[ăa]|pachet(?:e)?|set(?:uri)?|capsule|tablete|plicuri|perechi|cm|mm|m|m2|m²|mp|g\/m2|g\/m²|km|kw|w|v|hz|gb|tb|mb)\b/i.test(
        s
      )
    ) {
      return 'quantity';
    }
    // Ex: 3+3 bucăți, 6x0.33 L, 4 x 250g
    if (/^\d+\s*(?:\+\s*\d+|[x×]\s*\d+(?:[.,]\d+)?)\s*(?:buc|kg|g|ml|l|role|plicuri)?\b/i.test(s)) {
      return 'quantity';
    }
    return null;
  }

  /**
   * Extrage prețul dintr-un fragment text folosind dovadă comercială (monedă lei/RON, selector dedicat sau context explicit).
   * Nu returnează niciodată cantitatea (0,33 L, 100 g), procentele (33%) sau datele (11.11.2026) ca preț.
   */
  static extractPriceWithContext(
    text: string,
    options?: {
      requireCommercialContext?: boolean;
      allowBareDecimalInPriceElement?: boolean;
      isPriceElement?: boolean;
      contextWindow?: string;
    }
  ): ExtractedPriceResult {
    const raw = (text || '').replace(/\u00a0/g, ' ').trim();
    const warnings: string[] = [];

    if (!raw) {
      return { value: null, currency: null, proofType: 'none', warnings };
    }

    // Eliminăm datele calendaristice (ex: 11.11.2026, 04.11-10.11.2026) și codurile de bare din evaluare
    const sanitized = raw
      .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ')
      .replace(/\b\d{1,2}\.\d{1,2}\s*[-–]\s*\d{1,2}\.\d{1,2}\b/g, ' ')
      .replace(/\b\d{8,14}\b/g, ' ');

    // 1. Căutare explicită cu monedă (ex: "12,99 lei", "8.49 RON", "RON 12,99")
    const currencyMatches: { value: number; rawMatch: string; index: number }[] = [];
    for (const regex of [CURRENCY_AFTER_RE, CURRENCY_BEFORE_RE]) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(sanitized)) !== null) {
        const val = parseLocalizedNumericToken(m[1]);
        if (val !== null && val >= 0.1 && val <= 50000) {
          // Ne asigurăm că imediat înainte nu este ceva de tipul "de la 100 g lei" (improbabil, dar verificăm)
          const beforeSnippet = sanitized.slice(Math.max(0, m.index - 12), m.index + m[0].length);
          if (!/\b(?:kg|g|ml|l|buc)\s*(?:lei|ron)/i.test(beforeSnippet)) {
            currencyMatches.push({ value: val, rawMatch: m[0].trim(), index: m.index });
          }
        }
      }
    }

    if (currencyMatches.length > 0) {
      // Dacă sunt mai multe prețuri în același text cu monedă, preferăm ultimul dacă e "vechi -> nou" sau primul valid
      const chosen = currencyMatches[0];
      return {
        value: chosen.value,
        currency: 'RON',
        proofType: 'currency_label',
        rawMatch: chosen.rawMatch,
        warnings
      };
    }

    // 2. Verificăm dacă textul este de fapt o cantitate, procent sau greutate
    const nonPriceKind = PriceExtractor.isLikelyQuantityOrPercentToken(sanitized);
    if (nonPriceKind === 'percent') {
      return { value: null, currency: null, proofType: 'rejected_percent', rawMatch: raw, warnings: ['Procent de reducere respins ca preț.'] };
    }
    if (nonPriceKind === 'quantity') {
      return { value: null, currency: null, proofType: 'rejected_quantity', rawMatch: raw, warnings: ['Cantitate/ambalaj respinsă ca preț.'] };
    }

    // Eliminăm explicit orice număr urmat de unități (kg, g, ml, l, cl, buc, role, %, etc.)
    const withoutUnits = sanitized.replace(
      /(?<![a-zA-Z0-9])\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|cl|dl|l|litri|litru|buc(?:ati|ăți|\.)?|role|rol[ăa]|pachet(?:e)?|set(?:uri)?|capsule|tablete|plicuri|perechi|cm|mm|m|m2|m²|mp|g\/m2|g\/m²|km|kw|w|v|hz|gb|tb|mb|ani|luni|zile|%)\b/gi,
      ' '
    );
    // Eliminăm și model codes alfanumerice (ex: 55UA73003LA, A800SE-4G, CCM 7.3)
    const withoutModels = withoutUnits
      .replace(/\b[A-Z]{1,4}\s*\d+(?:[.,]\d+)?\b/g, ' ')
      .replace(/\b\d+[A-Za-z][A-Za-z0-9\-]*\b/g, ' ')
      .replace(/\b[A-Za-z]+\d+[A-Za-z0-9\-]*\b/g, ' ');

    // 3. Dacă provine dintr-un selector HTML explicit de preț (fără class unit-price/per-kg/per-l)
    if (options?.isPriceElement || options?.allowBareDecimalInPriceElement) {
      // Căutăm format decimal 12,99 / 12.99 sau întreg doar în selector dedicat de preț
      const decMatch = withoutModels.match(/(?<![\d.,])\d{1,5}[.,]\d{2}(?![\d.,])/);
      if (decMatch) {
        const val = parseLocalizedNumericToken(decMatch[0]);
        if (val !== null && val >= 0.1 && val <= 50000) {
          return {
            value: val,
            currency: 'RON',
            proofType: 'price_selector',
            rawMatch: decMatch[0],
            warnings
          };
        }
      }
      // Dacă elementul de preț conține doar un număr întreg curat (ex: "15" lângă badge RON sau în .k-price-tag__price)
      const pureClean = withoutModels.trim();
      if (/^\d{1,4}$/.test(pureClean)) {
        const intVal = parseLocalizedNumericToken(pureClean);
        if (intVal !== null && intVal >= 1 && intVal <= 5000) {
          return {
            value: intVal,
            currency: 'RON',
            proofType: 'price_selector',
            rawMatch: pureClean,
            warnings
          };
        }
      }
    }

    // 4. Context comercial explicit (ex: "Preț: 8,49" fără "lei", sau fereastră de context cu cue comercial)
    const fullContext = `${options?.contextWindow || ''} ${raw}`;
    const hasCommercialCue = COMMERCIAL_PRICE_CUE_RE.test(fullContext);
    if (!options?.requireCommercialContext || hasCommercialCue) {
      // Necesită zecimale (NN,NN sau NN.NN) ca să nu prindem numere de pagină/bucăți
      const decMatch = withoutModels.match(/(?<![\d.,])\d{1,4}[.,]\d{2}(?![\d.,])/);
      if (decMatch) {
        const val = parseLocalizedNumericToken(decMatch[0]);
        if (val !== null && val >= 0.2 && val <= 50000) {
          if (hasCommercialCue) {
            return {
              value: val,
              currency: 'RON',
              proofType: 'contextual_decimal',
              rawMatch: decMatch[0],
              warnings
            };
          }
          // Fără cue comercial explicit, respingem valorile tipice de volum/greutate (0.25, 0.33, 0.5, 0.75)
          if (!COMMON_VOLUME_WEIGHT_DECIMALS.has(val) && val >= 1.0) {
            return {
              value: val,
              currency: 'RON',
              proofType: 'contextual_decimal',
              rawMatch: decMatch[0],
              warnings: ['Preț zecimal extras fără sufix explicit lei/RON.']
            };
          }
        }
      }
    }

    return { value: null, currency: null, proofType: 'none', warnings };
  }

  /**
   * Parsează un câmp explicit de preț din CSV, XML, JSON API sau bon fiscal.
   * Respinge valori care conțin unități fizice (ex: "250 ml", "100 g") sau procente ("33%").
   */
  static parseExplicitPriceField(raw: string | number | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || raw <= 0 || raw > 50000) return null;
      return Number(raw.toFixed(2));
    }

    const str = String(raw).replace(/\u00a0/g, ' ').trim();
    if (!str) return null;

    if (/^[-−–]\s*\d/.test(str)) {
      return null;
    }
    if (UNIT_ATTACHED_NUMBER_RE.test(str) && !/\b(?:lei|ron)\b/i.test(str)) {
      return null;
    }
    if (/%/.test(str)) {
      return null;
    }

    const extracted = PriceExtractor.extractPriceWithContext(str, {
      requireCommercialContext: false,
      isPriceElement: true
    });
    return extracted.value;
  }

  /**
   * Extrage în siguranță cantitatea și unitatea de ambalare fără a corupe codurile de produs (ex: 55UA73003LA, A800SE-4G, 160 g/m²).
   */
  static extractPackagingSafely(text: string): SafePackagingResult {
    const raw = (text || '').replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
    if (!raw) return {};

    // Eliminăm întâi specificațiile non-ambalaj (g/m², dimensiuni cm/mm/m, 4G/5G, rezoluții, lame/capete)
    const cleaned = raw
      .replace(/\b\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?){1,3}\s*(?:cm|mm|m|inch|")\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*g\/m[²2]\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\s*g\/mp\b/gi, ' ')
      .replace(/\b[A-Z0-9]+-[2345]G\b/gi, ' ')
      .replace(/\b(?:2\.4G|5\.0G)\b/gi, ' ')
      .replace(/(?<![\d.,-])\b(?:3G|4G|5G)\b/gi, ' ')
      .replace(/\b\d{2,3}[A-Z]{2}\d+[A-Z0-9]*\b/g, ' ')
      .replace(/\b(?:cu\s+)?\d+\s+(?:lame|capete|viteze|trepte|programe|straturi|culori)\b/gi, ' ');

    // 1. Multipack: ex. "6 x 0,33 l", "4x125 g", "2 x 1 L"
    const multiMatch = cleaned.match(
      /(?<![a-zA-Z0-9\-/])(\d{1,2})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|dl|l)\b(?![a-zA-Z0-9/²\-])/i
    );
    if (multiMatch) {
      const count = Number.parseInt(multiMatch[1], 10);
      const perUnitRaw = Number.parseFloat(multiMatch[2].replace(',', '.'));
      let unitRaw = multiMatch[3].toLowerCase();
      if (unitRaw === 'gr') unitRaw = 'g';
      if (Number.isFinite(count) && count > 0 && count <= 48 && Number.isFinite(perUnitRaw) && perUnitRaw > 0) {
        let perUnitNormalized = perUnitRaw;
        let finalUnit: UnitType = unitRaw as UnitType;
        if (unitRaw === 'cl') {
          perUnitNormalized = perUnitRaw * 10;
          finalUnit = 'ml';
        } else if (unitRaw === 'dl') {
          perUnitNormalized = perUnitRaw * 100;
          finalUnit = 'ml';
        }
        const totalQty = Number((count * perUnitNormalized).toFixed(3));
        const res = PriceExtractor.buildPackagingResult(totalQty, finalUnit, `${count}x${multiMatch[2]} ${multiMatch[3]}`);
        res.packCount = count;
        res.unitPackageQuantity = Number(perUnitNormalized.toFixed(3));
        res.unitPackageUnit = finalUnit;
        return res;
      }
    }

    // 2. Cantitate simplă: ex. "0,33 L", "250 ml", "100 g", "1,5 kg", "6 buc"
    const singleMatch = cleaned.match(
      /(?<![a-zA-Z0-9\-/])(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|cl|dl|l|buc(?:ăți|ati|\.)?|pachet|role)\b(?![a-zA-Z0-9/²\-])/i
    );
    if (singleMatch) {
      const qty = Number.parseFloat(singleMatch[1].replace(',', '.'));
      let unitRaw = singleMatch[2].toLowerCase().replace('.', '');
      if (unitRaw === 'gr') unitRaw = 'g';
      if (unitRaw === 'bucăți' || unitRaw === 'bucati') unitRaw = 'buc';
      if (unitRaw === 'role') unitRaw = 'buc';

      if (Number.isFinite(qty) && qty > 0) {
        let normalizedQty = qty;
        let finalUnit: UnitType = (['kg', 'g', 'l', 'ml', 'buc', 'pachet'].includes(unitRaw) ? unitRaw : 'buc') as UnitType;
        if (unitRaw === 'cl') {
          normalizedQty = Number((qty * 10).toFixed(2));
          finalUnit = 'ml';
        } else if (unitRaw === 'dl') {
          normalizedQty = Number((qty * 100).toFixed(2));
          finalUnit = 'ml';
        }

        // Guard împotriva numerelor absurde extrase greșit drept grame/litri (ex: > 25000g / 100L)
        if ((finalUnit === 'g' || finalUnit === 'ml') && normalizedQty > 25000) {
          return {};
        }
        if ((finalUnit === 'kg' || finalUnit === 'l') && normalizedQty > 100) {
          return {};
        }

        const res = PriceExtractor.buildPackagingResult(normalizedQty, finalUnit, `${singleMatch[1]} ${singleMatch[2]}`);
        res.packCount = 1;
        res.unitPackageQuantity = normalizedQty;
        res.unitPackageUnit = finalUnit;
        return res;
      }
    }

    return {};
  }

  private static buildPackagingResult(qty: number, unit: UnitType, packageSize: string): SafePackagingResult {
    const res: SafePackagingResult = {
      packageQuantity: qty,
      packageUnit: unit,
      packageSize
    };
    if (unit === 'g' || unit === 'kg') {
      res.weight = qty;
    } else if (unit === 'ml' || unit === 'l') {
      res.volume = qty;
    }
    return res;
  }

  /**
   * Verifică dacă un preț mic (0.20 - 1.49 RON) are justificare comercială validă (ex: 100g mezel/carne, chiflă, plic condimente 13g, doză bere/apă).
   */
  static isValidSmallCommercialPrice(title: string, price: number): boolean {
    if (price < 0.2) return false;
    if (price >= 1.5) return true;
    const t = (title || '').toLowerCase();

    // Produse vândute la 100g sau bucată mică / plic / doză
    if (
      /\b(?:100\s*g|per\s*100\s*g|\/\s*100\s*g|chifl[ăa]|covrig|corn|pate|cafea\s+.*?\d{1,2}\s*g|amigo\s+13|ness|condiment|plic|conserv[ăa]\s+mic|iaurt\s+mic|ap[ăa]\s+0[.,]5|argus|aro\s+candela|pulpe\s+pui|pui\s+grill|ceaf[ăa]|cotlet|br[âa]nz[ăa]|ca[șs]caval|ro[șs]ii|banane|cartofi|ceap[ăa]|morcovi)\b/i.test(
        t
      )
    ) {
      return true;
    }
    // Dacă prețul >= 0.89 și nu este identic cu o fracție tipică de litru/gramaj din titlu, este plauzibil
    if (price >= 0.89) {
      return true;
    }
    return false;
  }

  /**
   * Detectează dacă valoarea prețului este de fapt cantitatea/volumul/greutatea produsului (ex: 0,33 pentru 0,33 L, 654 pentru 654 ml, 0,25 pentru 250 ml).
   */
  static detectQuantityAsPrice(params: {
    title: string;
    effectivePrice: number;
    packageQuantity?: number;
    packageUnit?: string;
    rawPriceText?: string;
    proofType?: PriceProofType;
  }): { isConfused: boolean; reason?: string } {
    const { title, effectivePrice, packageQuantity, packageUnit, rawPriceText, proofType } = params;
    if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
      return { isConfused: false };
    }

    if (rawPriceText && PriceExtractor.isLikelyQuantityOrPercentToken(rawPriceText)) {
      return {
        isConfused: true,
        reason: `Textul sursă pentru preț („${rawPriceText}”) conține o unitate fizică sau procent, nu un preț comercial.`
      };
    }

    // Extragem și din titlu pentru a prinde cazuri în care packageQuantity nu era populat
    const titlePkg = PriceExtractor.extractPackagingSafely(title);
    const qty = packageQuantity && packageQuantity > 0 ? packageQuantity : titlePkg.packageQuantity;
    const unit = (packageUnit || titlePkg.packageUnit || '').toLowerCase();

    if (qty && qty > 0) {
      // Potrivire exactă (ex: 0.33 L -> 0.33; 0.75 L -> 0.75; 654 ml -> 654; 670 g -> 670; 900 g -> 900)
      if (Math.abs(effectivePrice - qty) < 0.005) {
        if (['g', 'ml', 'kg', 'l'].includes(unit) && (effectivePrice < 2 || effectivePrice >= 90)) {
          return {
            isConfused: true,
            reason: `Prețul extras (${effectivePrice} RON) este identic cu cantitatea ambalajului (${qty} ${unit}).`
          };
        }
      }

      // Conversie ml -> L sau g -> kg (ex: 250 ml -> 0.25, 275 ml -> 0.27/0.28, 330 ml -> 0.33, 750 ml -> 0.75, 100 g -> 0.10)
      if ((unit === 'ml' || unit === 'g') && qty >= 50) {
        const converted = qty / 1000;
        const truncated2 = Math.floor(converted * 100) / 100;
        if (Math.abs(effectivePrice - converted) < 0.015 || Math.abs(effectivePrice - truncated2) < 0.005) {
          return {
            isConfused: true,
            reason: `Prețul extras (${effectivePrice} RON) corespunde conversiei volumului/greutății (${qty} ${unit} = ${converted} ${unit === 'ml' ? 'L' : 'kg'}).`
          };
        }
      }

      // Titlu cu mențiune explicită a aceluiași decimal (ex: "BOTTLEGREEN 0.275", "Cuvee de Purcari 0.75 L", "Carlsberg 0.33 L")
      const priceFixed2 = effectivePrice.toFixed(2);
      const priceFixedComma = priceFixed2.replace('.', ',');
      if (
        effectivePrice < 1.5 &&
        (title.includes(priceFixed2) || title.includes(priceFixedComma)) &&
        /\b(?:l|ml|g|kg|cl|buc|%)\b/i.test(title)
      ) {
        return {
          isConfused: true,
          reason: `Prețul (${effectivePrice} RON) este identic cu valoarea numerică a ambalajului din denumirea produsului.`
        };
      }
    }

    // Fără dovadă comercială explicită (lei/RON), valori tipice de volum sub 0.85 lei sunt extrem de suspecte
    if (effectivePrice < 0.85 && proofType !== 'currency_label') {
      if (COMMON_VOLUME_WEIGHT_DECIMALS.has(Number(effectivePrice.toFixed(2)))) {
        return {
          isConfused: true,
          reason: `Prețul sub-unitar (${effectivePrice} RON) corespunde unui volum standard de ambalaj fără confirmare monetară.`
        };
      }
    }

    return { isConfused: false };
  }

  /**
   * Validare completă pre-publicare (VALID | WARNING | INVALID | MISSING) pentru oferte extrase / staging / publicare.
   */
  static validateOfferPrice(input: {
    title: string;
    normalPrice?: number | null;
    promoPrice?: number | null;
    loyaltyPrice?: number | null;
    effectivePrice?: number | null;
    unitPrice?: number | null;
    packageQuantity?: number | null;
    packageUnit?: string | null;
    rawPriceText?: string;
    proofType?: PriceProofType;
    isVerifiedOverride?: boolean;
  }): OfferPriceValidationResult {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const title = (input.title || '').trim();

    if (PriceExtractor.isNoiseOrNonProductTitle(title)) {
      return {
        status: 'INVALID',
        code: 'NOISE_OR_HEADER_TITLE',
        reasons: [`Denumirea „${title}” reprezintă un antet, banner, categorie sau text non-produs.`],
        warnings
      };
    }

    const eff = input.effectivePrice;
    if (eff === null || eff === undefined || !Number.isFinite(eff) || eff <= 0) {
      return {
        status: 'MISSING',
        code: 'MISSING_PRICE',
        reasons: ['Prețul comercial lipsește sau nu a putut fi confirmat din sursă.'],
        warnings
      };
    }

    if (eff < 0.15) {
      return {
        status: 'INVALID',
        code: 'UNREALISTIC_LOW_PRICE',
        reasons: [`Prețul (${eff.toFixed(2)} RON) este sub pragul minim comercial plauzibil (0.15 RON).`],
        warnings
      };
    }

    if (eff > 50000) {
      return {
        status: 'INVALID',
        code: 'EXTREME_HIGH_PRICE',
        reasons: [`Prețul (${eff.toFixed(2)} RON) depășește pragul maxim admis (50.000 RON).`],
        warnings
      };
    }

    const norm = input.normalPrice;
    const promo = input.promoPrice;

    if (norm !== null && norm !== undefined && Number.isFinite(norm) && norm > 0) {
      if (eff > norm + 0.01) {
        return {
          status: 'INVALID',
          code: 'EFFECTIVE_GT_NORMAL',
          reasons: [`Prețul efectiv (${eff.toFixed(2)} RON) depășește prețul normal (${norm.toFixed(2)} RON).`],
          warnings
        };
      }
      if (promo !== null && promo !== undefined && Number.isFinite(promo) && promo > 0) {
        if (promo > norm + 0.01) {
          return {
            status: 'INVALID',
            code: 'PROMO_GT_NORMAL',
            reasons: [`Prețul promoțional (${promo.toFixed(2)} RON) este mai mare decât prețul normal (${norm.toFixed(2)} RON).`],
            warnings
          };
        }
        const discountRatio = (norm - promo) / norm;
        if (discountRatio > 0.9) {
          return {
            status: 'INVALID',
            code: 'EXTREME_DISCOUNT',
            reasons: [
              `Reducere extremă (${Math.round(discountRatio * 100)}%: ${norm.toFixed(2)} -> ${promo.toFixed(2)} RON), posibilă eroare de parsare.`
            ],
            warnings
          };
        }
      }
    }

    if (!input.isVerifiedOverride) {
      const qtyCheck = PriceExtractor.detectQuantityAsPrice({
        title,
        effectivePrice: eff,
        packageQuantity: input.packageQuantity ?? undefined,
        packageUnit: input.packageUnit ?? undefined,
        rawPriceText: input.rawPriceText,
        proofType: input.proofType
      });

      if (qtyCheck.isConfused) {
        return {
          status: 'INVALID',
          code: 'QUANTITY_AS_PRICE',
          reasons: [qtyCheck.reason || 'Prețul pare confundat cu cantitatea sau volumul ambalajului.'],
          warnings
        };
      }

      if (eff < 0.85 && !PriceExtractor.isValidSmallCommercialPrice(title, eff)) {
        return {
          status: 'WARNING',
          code: 'SUSPECT_SUB_UNIT_PRICE',
          reasons: [`Preț sub-unitar suspect (${eff.toFixed(2)} RON) pentru „${title}” — necesită confirmare manuală.`],
          warnings: ['Preț sub 0.85 RON fără context specific per 100g / bucată mică.']
        };
      }
    }

    if (input.unitPrice !== null && input.unitPrice !== undefined && Number.isFinite(input.unitPrice)) {
      if (input.unitPrice > 25000 && !/\b(?:șofran|sofran|vanilie|trufe|cosmetic|parfum|ser|crem[ăa]|ulei\s+esen[țt]ial)\b/i.test(title)) {
        warnings.push(`Preț unitar foarte ridicat (${input.unitPrice.toFixed(2)}).`);
      }
    }

    return {
      status: reasons.length > 0 ? 'INVALID' : 'VALID',
      reasons,
      warnings
    };
  }
}
