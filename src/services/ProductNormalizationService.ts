import type { Product, RetailerProductRecord, UnitType } from '../types.js';
import type { CatalogExtractedOffer } from '../indexing/catalog/catalogTypes.js';

export type BrandQuality =
  | 'verified_brand'
  | 'extracted_from_title'
  | 'placeholder'
  | 'corrupt_or_non_brand'
  | 'missing';

export interface BrandNormalizationResult {
  originalBrand: string | null;
  normalizedBrand: string | null;
  brandQuality: BrandQuality;
  confidence: number; // 0..1
  isPrivateLabel: boolean;
  reasons: string[];
}

export interface NormalizedPackagingResult {
  originalQuantity: number | null;
  originalUnit: string | null;
  packCount: number;
  isMultipack: boolean;
  isSuspiciousMultipack: boolean;
  unitPackageQuantity: number | null;
  unitPackageUnit: UnitType | null;
  totalQuantity: number | null;
  totalUnit: UnitType | null;
  normalizedMetricValue: number | null; // g, ml, or buc
  normalizedMetricUnit: 'g' | 'ml' | 'buc' | null;
  unitNormalizedMetricValue: number | null; // single unit g, ml, or buc
  packagingStructureKey: string | null;
  isVariableWeight: boolean;
  hasMissingQuantity: boolean;
  hasContradictoryAttributes: boolean;
  contradictionReasons: string[];
}

export interface PackagingComparisonResult {
  comparable: boolean;
  incompatibleUnitFamily: boolean;
  variableWeightConflict: boolean;
  totalQuantityMatch: boolean;
  totalRatio: number;
  exactStructureMatch: boolean;
  differentStructureSameTotal: boolean;
  reason?: string;
}

export interface VariantAttributes {
  percentages: string[];
  coffeeForm?: 'boabe' | 'macinata' | 'capsule' | 'solubila' | 'paduri';
  sugarFree: boolean;
  lactoseFree: boolean;
  decaf: boolean;
  glutenFree: boolean;
  alcoholFree: boolean;
  hasAlcoholIndicator: boolean;
  bio: boolean;
  flourOrBreadKind?: 'alba' | 'neagra_integrala';
  chocolateKind?: 'lapte' | 'neagra' | 'alba';
  dairyProcessing?: 'uht' | 'proaspat';
  flavors: string[];
  extraVariantTokens: string[];
}

export interface TitleNormalizationResult {
  originalTitle: string;
  cleanedTitle: string;
  normalizedTitle: string;
  normalizedDescriptiveTitle: string;
  ocrCorrected: boolean;
  promoStripped: boolean;
  variantAttributes: VariantAttributes;
  isInsufficientlyDescriptive: boolean;
  insufficiencyReasons: string[];
}

export type BarcodeQuality =
  | 'valid_universal'
  | 'variable_weight_or_internal'
  | 'invalid_check_digit'
  | 'invalid_format'
  | 'suspicious'
  | 'missing';

export interface BarcodeValidationResult {
  originalBarcode: string | null;
  digitsOnly: string;
  format: 'EAN-8' | 'UPC-A' | 'EAN-13' | 'GTIN-14' | 'INVALID' | 'EMPTY';
  isValidFormat: boolean;
  isValidCheckDigit: boolean;
  isVariableWeight: boolean;
  isSuspicious: boolean;
  quality: BarcodeQuality;
  isEligibleForAutoMatch: boolean;
  normalizedPrimaryBarcode: string | null;
  normalizedGtin13: string | null;
  normalizedEquivalentBarcodes: string[];
  reasons: string[];
}

export interface NormalizedProductAuditRecord {
  productId: string;
  originalName: string;
  originalBrand: string | null;
  originalBarcode: string | null;
  brand: BrandNormalizationResult;
  packaging: NormalizedPackagingResult;
  title: TitleNormalizationResult;
  barcode: BarcodeValidationResult;
  isCanonicalRoot: boolean;
}

export interface CatalogDataQualityReport {
  generatedAt: string;
  dataSource: 'postgresql' | 'supabase_readonly' | 'storage_service' | 'mock_data' | 'custom_dataset';
  readOnlyVerified: boolean;
  summary: {
    totalProductsAnalyzed: number;
    canonicalProductsCount: number;
    aliasProductsCount: number;
    validBrandsCount: number;
    verifiedExplicitBrandsCount: number;
    extractedFromTitleBrandsCount: number;
    placeholderBrandsCount: number;
    suspectOrCorruptBrandsCount: number;
    missingBrandsCount: number;
    productsWithoutQuantityCount: number;
    productsWithMultipackCount: number;
    productsWithSuspiciousMultipackCount: number;
    productsWithValidBarcodeCount: number;
    productsWithInvalidBarcodeCount: number;
    productsWithInvalidCheckDigitCount: number;
    productsWithSuspiciousBarcodeCount: number;
    productsWithVariableWeightBarcodeCount: number;
    productsWithoutBarcodeCount: number;
    productsWithVariableWeightCount: number;
    insufficientlyDescriptiveTitlesCount: number;
    productsWithContradictoryAttributesCount: number;
  };
  retailerProductsSummary?: {
    totalRecords: number;
    withBarcodeCount: number;
    withValidBarcodeCount: number;
    withInvalidOrVariableBarcodeCount: number;
    withPlaceholderOrCorruptBrandCount: number;
  };
  stagingOffersSummary?: {
    totalRecords: number;
    withMultipackCount: number;
    withValidBarcodeCount: number;
    withInvalidBarcodeCount: number;
    withPlaceholderBrandCount: number;
  };
  samples: {
    placeholderBrands: Array<{ id: string; name: string; originalBrand: string | null; recoveredBrand: string | null }>;
    corruptBrands: Array<{ id: string; name: string; originalBrand: string | null; reasons: string[] }>;
    multipacks: Array<{ id: string; name: string; packCount: number; unitQty: number | null; unit: string | null; total: number | null; totalUnit: string | null }>;
    suspiciousMultipacks: Array<{ id: string; name: string; reasons: string[] }>;
    invalidBarcodes: Array<{ id: string; name: string; barcode: string; quality: BarcodeQuality; reasons: string[] }>;
    variableWeightProducts: Array<{ id: string; name: string; barcode: string | null }>;
    insufficientTitles: Array<{ id: string; name: string; reasons: string[] }>;
    contradictoryAttributes: Array<{ id: string; name: string; reasons: string[] }>;
  };
}

export function stripDiacriticsLower(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PLACEHOLDER_BRAND_EXACT = new Set([
  '',
  '-',
  '--',
  '---',
  '.',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'unknown',
  'generic',
  'marca necunoscuta',
  'marca magazin',
  'marca proprie',
  'brand necunoscut',
  'fara brand',
  'fara marca',
  'import',
  'romania',
  'origine ue',
  'origine ue / ro',
  'origine ro',
  'ue',
  'ro',
  'proaspat',
  'brutaria magazinului',
  'divers',
  'diverse',
  'altele',
  'altul',
  'no brand',
  'store brand'
]);

const CORRUPT_BRAND_PATTERNS: RegExp[] = [
  /\n|\r/,
  /%/,
  /\b(?:lei|ron)\b/i,
  /\b\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|cl|dl|l|litri|litru|buc|role|cm|mm|m)\b/i,
  /^\d+(?:[.,]\d+)?$/,
  /\b(?:calitatea\s+[i1]|cal\.?\s*[i1]|fara\s+alcool|cu\s+alcool|glazura\s+gheata|produs\s+congelat|deodorant\s+spray|bere\s+blonda|bere\s+bruna|cafea\s+macinata|cafea\s+boabe|vin\s+alb|vin\s+rosu|amestec\s+bere|apa\s+minerala|apa\s+plata|lapte\s+de\s+vaca|fara\s+zahar|fara\s+lactoza|si\s+suc)\b/i
];

interface CuratedBrandEntry {
  canonical: string;
  aliases: string[];
  isPrivateLabel?: boolean;
}

const CURATED_BRANDS: CuratedBrandEntry[] = [
  // Retail private labels (valid brands, flagged as private label)
  { canonical: 'Pilos', aliases: ['pilos'], isPrivateLabel: true },
  { canonical: 'Cămara Noastră', aliases: ['camara noastra'], isPrivateLabel: true },
  { canonical: 'Milbona', aliases: ['milbona'], isPrivateLabel: true },
  { canonical: 'K-Classic', aliases: ['k-classic', 'k classic'], isPrivateLabel: true },
  { canonical: 'Aro', aliases: ['aro'], isPrivateLabel: true },
  { canonical: 'Fine Life', aliases: ['fine life'], isPrivateLabel: true },
  { canonical: 'Gusturi Românești', aliases: ['gusturi romanesti'], isPrivateLabel: true },
  { canonical: 'Mega Image', aliases: ['mega image', '365 mega', 'gusturi romanesti'], isPrivateLabel: true },
  { canonical: '365', aliases: ['365'], isPrivateLabel: true },
  { canonical: 'Delhaize', aliases: ['delhaize'], isPrivateLabel: true },
  { canonical: 'Boni', aliases: ['boni'], isPrivateLabel: true },
  { canonical: 'Carrefour', aliases: ['carrefour classic', 'carrefour bio', 'carrefour extra', 'carrefour original', 'simpl'], isPrivateLabel: true },
  { canonical: 'Auchan', aliases: ['auchan bio', 'gama auchan', 'poucet'], isPrivateLabel: true },
  { canonical: 'Hanul Boieresc', aliases: ['hanul boieresc'], isPrivateLabel: true },
  { canonical: 'San Fabio', aliases: ['san fabio'], isPrivateLabel: true },
  { canonical: 'Pikok', aliases: ['pikok'], isPrivateLabel: true },
  { canonical: 'Dulano', aliases: ['dulano'], isPrivateLabel: true },
  { canonical: 'Argus', aliases: ['argus'], isPrivateLabel: true },
  { canonical: 'Solevita', aliases: ['solevita'], isPrivateLabel: true },
  { canonical: 'Freeway', aliases: ['freeway'], isPrivateLabel: true },
  { canonical: 'Sondey', aliases: ['sondey'], isPrivateLabel: true },
  { canonical: 'Favorina', aliases: ['favorina'], isPrivateLabel: true },
  { canonical: 'Fin Carré', aliases: ['fin carre'], isPrivateLabel: true },
  { canonical: 'Deluxe', aliases: ['deluxe'], isPrivateLabel: true },
  { canonical: 'Cien', aliases: ['cien'], isPrivateLabel: true },
  { canonical: 'W5', aliases: ['w5'], isPrivateLabel: true },
  { canonical: 'Floralys', aliases: ['floralys'], isPrivateLabel: true },
  { canonical: 'Proxi', aliases: ['proxi'], isPrivateLabel: true },
  { canonical: 'Casa Blanca', aliases: ['casa blanca'], isPrivateLabel: true },
  // Dairy & eggs
  { canonical: 'Napolact', aliases: ['napolact'] },
  { canonical: 'Zuzu', aliases: ['zuzu'] },
  { canonical: 'Albalact', aliases: ['albalact'] },
  { canonical: 'Olympus', aliases: ['olympus'] },
  { canonical: 'Hochland', aliases: ['hochland'] },
  { canonical: 'Danone', aliases: ['danone'] },
  { canonical: 'Activia', aliases: ['activia'] },
  { canonical: 'Actimel', aliases: ['actimel'] },
  { canonical: 'La Dorna', aliases: ['la dorna', 'ladorna'] },
  { canonical: 'Delaco', aliases: ['delaco'] },
  { canonical: 'President', aliases: ['president'] },
  { canonical: 'Covalact', aliases: ['covalact'] },
  { canonical: 'Rarăul', aliases: ['raraul'] },
  { canonical: 'Müller', aliases: ['muller'] },
  { canonical: 'Alpro', aliases: ['alpro'] },
  { canonical: 'Lurpak', aliases: ['lurpak'] },
  { canonical: 'Kerrygold', aliases: ['kerrygold'] },
  { canonical: 'Toneli', aliases: ['toneli'] },
  // Bakery & staples
  { canonical: 'Vel Pitar', aliases: ['vel pitar'] },
  { canonical: 'Dobrogea', aliases: ['dobrogea'] },
  { canonical: 'Boromir', aliases: ['boromir'] },
  { canonical: 'Băneasa', aliases: ['baneasa'] },
  { canonical: 'Mărgăritar', aliases: ['margaritar'] },
  { canonical: 'Diamant', aliases: ['diamant'] },
  { canonical: 'Barilla', aliases: ['barilla'] },
  { canonical: 'Scotti', aliases: ['risco scotti', 'riso scotti', 'scotti'] },
  { canonical: 'Monte Banato', aliases: ['monte banato'] },
  { canonical: 'Untdelemn de la Bunica', aliases: ['untdelemn de la bunica', 'de la bunica'] },
  { canonical: 'Spornic', aliases: ['spornic'] },
  { canonical: 'Floriol', aliases: ['floriol'] },
  { canonical: 'Alce Nero', aliases: ['alce nero'] },
  { canonical: 'Panzani', aliases: ['panzani'] },
  { canonical: 'Knorr', aliases: ['knorr'] },
  { canonical: 'Maggi', aliases: ['maggi'] },
  { canonical: 'Delikat', aliases: ['delikat'] },
  { canonical: 'Vegeta', aliases: ['vegeta'] },
  { canonical: 'Dr. Oetker', aliases: ['dr oetker', 'dr. oetker'] },
  { canonical: 'Heinz', aliases: ['heinz'] },
  { canonical: "Hellmann's", aliases: ["hellmann's", 'hellmanns'] },
  { canonical: 'Olympia', aliases: ['olympia'] },
  { canonical: 'Râureni', aliases: ['raureni'] },
  // Meat & deli
  { canonical: 'Agricola', aliases: ['agricola'] },
  { canonical: 'CocoRico', aliases: ['cocorico'] },
  { canonical: 'Cris-Tim', aliases: ['cris-tim', 'cristim', 'cris tim'] },
  { canonical: 'Comtim', aliases: ['comtim'] },
  { canonical: 'Meda', aliases: ['meda'] },
  { canonical: 'Aldis', aliases: ['aldis'] },
  { canonical: 'Matache Măcelaru', aliases: ['matache macelaru'] },
  { canonical: 'Fox', aliases: ['fox'] },
  { canonical: 'Caroli', aliases: ['caroli'] },
  { canonical: 'Campofrio', aliases: ['campofrio'] },
  { canonical: 'Sissi', aliases: ['sissi'] },
  { canonical: 'Pena', aliases: ['pena'] },
  // Coffee & sweets
  { canonical: 'Jacobs', aliases: ['jacobs'] },
  { canonical: 'Lavazza', aliases: ['lavazza'] },
  { canonical: 'Nescafé', aliases: ['nescafe'] },
  { canonical: 'Tchibo', aliases: ['tchibo'] },
  { canonical: 'Illy', aliases: ['illy'] },
  { canonical: 'Julius Meinl', aliases: ['julius meinl'] },
  { canonical: 'Doncafe', aliases: ['doncafe'] },
  { canonical: 'Fortuna', aliases: ['fortuna'] },
  { canonical: 'Amigo', aliases: ['amigo'] },
  { canonical: 'Milka', aliases: ['milka'] },
  { canonical: 'Poiana', aliases: ['poiana'] },
  { canonical: 'Kandia', aliases: ['kandia'] },
  { canonical: 'Heidi', aliases: ['heidi'] },
  { canonical: 'Lindt', aliases: ['lindt'] },
  { canonical: 'Ritter Sport', aliases: ['ritter sport'] },
  { canonical: 'Oreo', aliases: ['oreo'] },
  { canonical: 'Belvita', aliases: ['belvita'] },
  { canonical: 'Nutella', aliases: ['nutella'] },
  { canonical: 'Ferrero', aliases: ['ferrero', 'rocher'] },
  { canonical: 'Kinder', aliases: ['kinder'] },
  { canonical: 'Rom', aliases: ['rom autentic'] },
  { canonical: "Lay's", aliases: ["lay's", 'lays'] },
  { canonical: 'Chio', aliases: ['chio'] },
  { canonical: 'Pringles', aliases: ['pringles'] },
  { canonical: 'TUC', aliases: ['tuc'] },
  // Drinks
  { canonical: 'Borsec', aliases: ['borsec'] },
  { canonical: 'Dorna', aliases: ['dorna'] },
  { canonical: 'Bucovina', aliases: ['bucovina'] },
  { canonical: 'Aqua Carpatica', aliases: ['aqua carpatica'] },
  { canonical: 'Izvorul Minunilor', aliases: ['izvorul minunilor'] },
  { canonical: 'Zizin', aliases: ['zizin'] },
  { canonical: 'Biborțeni', aliases: ['biborteni'] },
  { canonical: 'Coca-Cola', aliases: ['coca-cola', 'coca cola'] },
  { canonical: 'Pepsi', aliases: ['pepsi'] },
  { canonical: 'Fanta', aliases: ['fanta'] },
  { canonical: 'Sprite', aliases: ['sprite'] },
  { canonical: 'Mirinda', aliases: ['mirinda'] },
  { canonical: '7Up', aliases: ['7up', '7 up'] },
  { canonical: 'Schweppes', aliases: ['schweppes'] },
  { canonical: 'Tymbark', aliases: ['tymbark'] },
  { canonical: 'Prigat', aliases: ['prigat'] },
  { canonical: 'Cappy', aliases: ['cappy'] },
  { canonical: 'Santal', aliases: ['santal'] },
  { canonical: 'Monster', aliases: ['monster'] },
  { canonical: 'Red Bull', aliases: ['red bull'] },
  { canonical: 'Hell', aliases: ['hell energy'] },
  { canonical: 'Ursus', aliases: ['ursus'] },
  { canonical: 'Timișoreana', aliases: ['timisoreana'] },
  { canonical: 'Ciuc', aliases: ['ciuc'] },
  { canonical: 'Bergenbier', aliases: ['bergenbier'] },
  { canonical: 'Stella Artois', aliases: ['stella artois'] },
  { canonical: "Beck's", aliases: ["beck's", 'becks'] },
  { canonical: 'Heineken', aliases: ['heineken'] },
  { canonical: 'Tuborg', aliases: ['tuborg'] },
  { canonical: 'Carlsberg', aliases: ['carlsberg'] },
  { canonical: 'Peroni', aliases: ['peroni'] },
  { canonical: 'Kozel', aliases: ['kozel'] },
  { canonical: 'Staropramen', aliases: ['staropramen'] },
  // Cleaning, care & appliances observed in catalog
  { canonical: 'Fairy', aliases: ['fairy'] },
  { canonical: 'Ariel', aliases: ['ariel'] },
  { canonical: 'Tide', aliases: ['tide'] },
  { canonical: 'Persil', aliases: ['persil'] },
  { canonical: 'Perwoll', aliases: ['perwoll'] },
  { canonical: 'Lenor', aliases: ['lenor'] },
  { canonical: 'Silan', aliases: ['silan'] },
  { canonical: 'Coccolino', aliases: ['coccolino'] },
  { canonical: 'Domestos', aliases: ['domestos'] },
  { canonical: 'Dero', aliases: ['dero'] },
  { canonical: 'Savex', aliases: ['savex'] },
  { canonical: 'Sano', aliases: ['sano'] },
  { canonical: 'Finish', aliases: ['finish'] },
  { canonical: 'Somat', aliases: ['somat'] },
  { canonical: 'Nivea', aliases: ['nivea'] },
  { canonical: 'Dove', aliases: ['dove'] },
  { canonical: 'Colgate', aliases: ['colgate'] },
  { canonical: 'Oral-B', aliases: ['oral-b', 'oral b'] },
  { canonical: 'Sensodyne', aliases: ['sensodyne'] },
  { canonical: 'Lacalut', aliases: ['lacalut'] },
  { canonical: 'Zewa', aliases: ['zewa'] },
  { canonical: 'Pampers', aliases: ['pampers'] },
  { canonical: "L'Oréal", aliases: ["l'oreal", 'loreal', "l'oréal"] },
  { canonical: 'Garnier', aliases: ['garnier'] },
  { canonical: 'Gillette', aliases: ['gillette'] },
  { canonical: 'Rexona', aliases: ['rexona'] },
  { canonical: 'Old Spice', aliases: ['old spice'] },
  { canonical: 'Tefal', aliases: ['tefal'] },
  { canonical: 'Philips', aliases: ['philips'] },
  { canonical: 'Russell Hobbs', aliases: ['russell hobbs'] },
  { canonical: 'Bosch', aliases: ['bosch'] },
  { canonical: 'Samsung', aliases: ['samsung'] },
  { canonical: 'Rowenta', aliases: ['rowenta'] }
];

const PRIVATE_LABEL_CANONICAL_SET = new Set(
  CURATED_BRANDS.filter(b => b.isPrivateLabel).map(b => stripDiacriticsLower(b.canonical))
);

// Build sorted alias lookup (longest aliases first so multi-word brands win cleanly)
const SORTED_BRAND_ALIASES: Array<{ entry: CuratedBrandEntry; alias: string; regex: RegExp }> = [];
for (const entry of CURATED_BRANDS) {
  for (const alias of entry.aliases) {
    SORTED_BRAND_ALIASES.push({
      entry,
      alias,
      regex: new RegExp(`(?<![a-z0-9])${escapeRegExp(alias)}(?![a-z0-9])`, 'i')
    });
  }
}
SORTED_BRAND_ALIASES.sort((a, b) => b.alias.length - a.alias.length);

function extractKnownBrandFromTitle(rawTitle?: string | null): { brand: string; confidence: number; isPrivateLabel: boolean } | null {
  if (!rawTitle || typeof rawTitle !== 'string') return null;
  const normTitle = stripDiacriticsLower(rawTitle)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normTitle || normTitle.length < 3) return null;

  for (const candidate of SORTED_BRAND_ALIASES) {
    const match = candidate.regex.exec(normTitle);
    if (!match) continue;
    // Higher confidence when brand is at the start or multi-character clear word
    const atStart = match.index <= 2 || normTitle.slice(0, match.index).trim().split(' ').length <= 2;
    // Extra guard for short/ambiguous 2-3 char tokens like "aro", "fox", "w5", "365"
    if (candidate.alias.length <= 3) {
      // Short brands must appear either near beginning or preceded/followed by separator or product context
      if (match.index > 16) continue;
    }
    const confidence = atStart ? 0.92 : 0.84;
    return {
      brand: candidate.entry.canonical,
      confidence,
      isPrivateLabel: Boolean(candidate.entry.isPrivateLabel)
    };
  }
  return null;
}

function matchCuratedBrandExact(raw: string): CuratedBrandEntry | null {
  const norm = stripDiacriticsLower(raw).replace(/\s+/g, ' ').trim();
  if (!norm) return null;
  for (const candidate of SORTED_BRAND_ALIASES) {
    if (norm === candidate.alias) {
      return candidate.entry;
    }
  }
  return null;
}

/**
 * ETAPA 2: Central brand normalization.
 * Preserves originalBrand, returns normalizedBrand = null for placeholder/corrupt/missing brands,
 * or extracts conservatively from title when verified/clear.
 */
export function normalizeBrand(rawBrand?: string | null, rawTitle?: string | null): BrandNormalizationResult {
  const originalBrand = typeof rawBrand === 'string' && rawBrand.trim().length > 0 ? rawBrand.trim() : null;
  const reasons: string[] = [];

  if (originalBrand) {
    const cleanedCandidate = originalBrand
      .replace(/\s*\/\s*marc[ăa]\s+proprie\b/gi, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const norm = stripDiacriticsLower(cleanedCandidate);

    // 1. Placeholder check
    if (
      PLACEHOLDER_BRAND_EXACT.has(norm) ||
      PLACEHOLDER_BRAND_EXACT.has(stripDiacriticsLower(originalBrand.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()))
    ) {
      reasons.push(`Brand placeholder detectat („${originalBrand}”).`);
      const recovered = extractKnownBrandFromTitle(rawTitle);
      if (recovered) {
        return {
          originalBrand,
          normalizedBrand: recovered.brand,
          brandQuality: 'extracted_from_title',
          confidence: recovered.confidence,
          isPrivateLabel: recovered.isPrivateLabel,
          reasons: [...reasons, `Brand real identificat în titlu: ${recovered.brand}.`]
        };
      }
      return {
        originalBrand,
        normalizedBrand: null,
        brandQuality: 'placeholder',
        confidence: 0,
        isPrivateLabel: false,
        reasons
      };
    }

    // 2. Corrupt / non-brand subtitle check
    const isCorrupt =
      CORRUPT_BRAND_PATTERNS.some(re => re.test(originalBrand)) ||
      cleanedCandidate.length > 42 ||
      cleanedCandidate.length < 2 ||
      !/[a-zA-ZăâîșțĂÂÎȘȚ]/.test(cleanedCandidate);

    if (isCorrupt) {
      reasons.push(`Valoare de brand coruptă sau non-brand („${originalBrand.replace(/\n/g, ' / ')}”).`);
      const recovered = extractKnownBrandFromTitle(rawTitle);
      if (recovered) {
        return {
          originalBrand,
          normalizedBrand: recovered.brand,
          brandQuality: 'extracted_from_title',
          confidence: recovered.confidence,
          isPrivateLabel: recovered.isPrivateLabel,
          reasons: [...reasons, `Brand real recuperat din titlu: ${recovered.brand}.`]
        };
      }
      return {
        originalBrand,
        normalizedBrand: null,
        brandQuality: 'corrupt_or_non_brand',
        confidence: 0,
        isPrivateLabel: false,
        reasons
      };
    }

    // 3. Valid explicit brand — canonicalize if in dictionary or keep clean original casing
    const curated = matchCuratedBrandExact(cleanedCandidate);
    if (curated) {
      return {
        originalBrand,
        normalizedBrand: curated.canonical,
        brandQuality: 'verified_brand',
        confidence: 1.0,
        isPrivateLabel: Boolean(curated.isPrivateLabel),
        reasons: []
      };
    }

    // Composite e.g. "Agricola / CocoRico" or "Mărgăritar / Diamant"
    if (cleanedCandidate.includes('/')) {
      const parts = cleanedCandidate.split('/').map(p => p.trim()).filter(Boolean);
      const validParts = parts.filter(p => !PLACEHOLDER_BRAND_EXACT.has(stripDiacriticsLower(p)));
      if (validParts.length > 0) {
        const firstCurated = matchCuratedBrandExact(validParts[0]);
        const isPriv = validParts.some(vp => PRIVATE_LABEL_CANONICAL_SET.has(stripDiacriticsLower(vp)));
        return {
          originalBrand,
          normalizedBrand: firstCurated ? firstCurated.canonical : validParts.join(' / '),
          brandQuality: 'verified_brand',
          confidence: 0.95,
          isPrivateLabel: isPriv,
          reasons: []
        };
      }
    }

    const isPriv = PRIVATE_LABEL_CANONICAL_SET.has(norm);
    return {
      originalBrand,
      normalizedBrand: cleanedCandidate,
      brandQuality: 'verified_brand',
      confidence: 0.95,
      isPrivateLabel: isPriv,
      reasons: []
    };
  }

  // 4. Missing explicit brand -> conservative extraction from title
  const fromTitle = extractKnownBrandFromTitle(rawTitle);
  if (fromTitle) {
    return {
      originalBrand: null,
      normalizedBrand: fromTitle.brand,
      brandQuality: 'extracted_from_title',
      confidence: fromTitle.confidence,
      isPrivateLabel: fromTitle.isPrivateLabel,
      reasons: [`Brand extras din titlu cu certitudine ${Math.round(fromTitle.confidence * 100)}%: ${fromTitle.brand}.`]
    };
  }

  return {
    originalBrand: null,
    normalizedBrand: null,
    brandQuality: 'missing',
    confidence: 0,
    isPrivateLabel: false,
    reasons: ['Brand absent și neidentificabil sigur din titlu.']
  };
}

/**
 * ETAPA 3: Quantity, unit & multipack normalization.
 */
function canonicalizeUnit(rawUnit?: string | null): UnitType | null {
  if (!rawUnit || typeof rawUnit !== 'string') return null;
  const u = stripDiacriticsLower(rawUnit).replace(/\./g, '').trim();
  if (!u) return null;
  if (['g', 'gr', 'gram', 'grame'].includes(u)) return 'g';
  if (['kg', 'kgr', 'kilogram', 'kilograme'].includes(u)) return 'kg';
  if (['ml', 'mililitri', 'mililitru'].includes(u)) return 'ml';
  if (['l', 'lt', 'litru', 'litri'].includes(u)) return 'l';
  if (['cl', 'dl'].includes(u)) return 'ml';
  if (['buc', 'bucata', 'bucati', 'role', 'rola', 'capsule', 'tablete', 'plicuri', 'perechi'].includes(u)) return 'buc';
  if (['pachet', 'pachete', 'pac', 'set', 'seturi'].includes(u)) return 'pachet';
  return null;
}

function toMetricBase(qty: number, unit: UnitType | 'cl' | 'dl'): { value: number; unit: 'g' | 'ml' | 'buc' } {
  if (unit === 'kg') return { value: Number((qty * 1000).toFixed(3)), unit: 'g' };
  if (unit === 'g') return { value: Number(qty.toFixed(3)), unit: 'g' };
  if (unit === 'l') return { value: Number((qty * 1000).toFixed(3)), unit: 'ml' };
  if (unit === 'dl') return { value: Number((qty * 100).toFixed(3)), unit: 'ml' };
  if (unit === 'cl') return { value: Number((qty * 10).toFixed(3)), unit: 'ml' };
  if (unit === 'ml') return { value: Number(qty.toFixed(3)), unit: 'ml' };
  return { value: Number(qty.toFixed(3)), unit: 'buc' };
}

function fromMetricBase(metricValue: number, metricUnit: 'g' | 'ml' | 'buc'): { qty: number; unit: UnitType } {
  if (metricUnit === 'g') {
    if (metricValue >= 1000) return { qty: Number((metricValue / 1000).toFixed(4)), unit: 'kg' };
    return { qty: Number(metricValue.toFixed(3)), unit: 'g' };
  }
  if (metricUnit === 'ml') {
    if (metricValue >= 1000) return { qty: Number((metricValue / 1000).toFixed(4)), unit: 'l' };
    return { qty: Number(metricValue.toFixed(3)), unit: 'ml' };
  }
  return { qty: Number(metricValue.toFixed(3)), unit: 'buc' };
}

function sanitizeTextForPackagingExtraction(rawTitle: string): string {
  return (rawTitle || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    // Physical dimensions like "488 x 244 x 122 cm" or "200x140 cm" or "120 x 80 mm"
    .replace(/\b\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?){1,3}\s*(?:cm|mm|m|inch|")\b/gi, ' ')
    // Surface weights & power/electrical ratings & resolutions
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g\/m[²2]|g\/mp|m[²2]|mp|w|kw|v|hz|mah|gb|tb|mb|dpi|rpm|bar|lumen)\b/gi, ' ')
    .replace(/\b[A-Z0-9]+-[2345]G\b/gi, ' ')
    .replace(/\b(?:2\.4G|5\.0G)\b/gi, ' ')
    .replace(/(?<![\d.,-])\b(?:3G|4G|5G)\b/gi, ' ')
    .replace(/\b\d{2,3}[A-Z]{2}\d+[A-Z0-9]*\b/g, ' ')
    // Non-food piece counts on tools/appliances (e.g. "cu 3 lame", "cu 4 capete")
    .replace(/\b(?:cu\s+)?\d+\s+(?:lame|capete|viteze|trepte|programe|straturi|culori|functii|funcții)\b/gi, ' ');
}

export function normalizeQuantityAndMultipack(input: {
  rawTitle?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPriceMeasure?: string | null;
  barcode?: string | null;
  isSoldByWeight?: boolean | null;
}): NormalizedPackagingResult {
  const rawTitle = typeof input.rawTitle === 'string' ? input.rawTitle : '';
  const normTitleLower = stripDiacriticsLower(rawTitle);
  const contradictionReasons: string[] = [];

  const originalQuantity =
    input.quantity !== undefined && input.quantity !== null && Number.isFinite(Number(input.quantity)) && Number(input.quantity) > 0
      ? Number(input.quantity)
      : null;
  const originalUnit = typeof input.unit === 'string' && input.unit.trim() ? input.unit.trim() : null;

  // Variable-weight indicator check (VRAC, /kg, per kg, barcode prefix 20..29)
  const cleanDigits = (input.barcode || '').replace(/\D/g, '');
  const isVariableBarcode = cleanDigits.length >= 8 && /^2[0-9]/.test(cleanDigits);
  const isVariableWeightTitle =
    /\b(?:vrac|la\s+kg|la\s+kilogram|pret\s+(?:per|pe)\s*kg|\/\s*kg|\/\s*100\s*g|per\s+100\s*g|greutate\s+variabila|(?:vandut\s+|pret\s+)?(?:la|pe)\s+cantar)\b/i.test(
      normTitleLower
    );
  const isVariableWeight = Boolean(input.isSoldByWeight || isVariableWeightTitle || isVariableBarcode);

  const cleanedForPkg = sanitizeTextForPackagingExtraction(rawTitle);

  let titlePackCount = 1;
  let titleUnitQty: number | null = null;
  let titleUnitType: UnitType | null = null;
  let titleMetricVal: number | null = null;
  let titleMetricUnit: 'g' | 'ml' | 'buc' | null = null;
  let isSuspiciousMultipack = false;

  // 1. Check multipack pattern in title: e.g. "2 x 500 g", "6x1L", "4X0.33L", "5+1 x 0.5 l"
  const multiMatch = cleanedForPkg.match(
    /(?<![a-zA-Z0-9\-/.,])(\d{1,3})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|kgr|gr|g|ml|cl|dl|litri|litru|lt|l|buc(?:ati|ăți|\.)?|role|plicuri|capsule|tablete)\b(?![a-zA-Z0-9/²\-])/i
  );

  // Also check explicit "N+M" or "pachet N x ..." if no direct NxQ
  const plusPackMatch = !multiMatch
    ? cleanedForPkg.match(/\b(\d{1,2})\s*\+\s*(\d{1,2})\s*(?:gratis\s+)?(?:x\s*)?(?:buc|doze|sticle|pachete|role)?\b/i)
    : null;

  if (multiMatch) {
    const rawCount = Number.parseInt(multiMatch[1], 10);
    const rawPerUnit = Number.parseFloat(multiMatch[2].replace(',', '.'));
    const rawUnitStr = stripDiacriticsLower(multiMatch[3]).replace(/\./g, '');
    const parsedUnit = rawUnitStr === 'cl' || rawUnitStr === 'dl' ? (rawUnitStr as 'cl' | 'dl') : canonicalizeUnit(rawUnitStr);

    if (Number.isFinite(rawCount) && rawCount > 0 && Number.isFinite(rawPerUnit) && rawPerUnit > 0 && parsedUnit) {
      const unitMetric = toMetricBase(rawPerUnit, parsedUnit);
      const totalMetric = Number((rawCount * unitMetric.value).toFixed(3));
      if (rawCount > 48 || (unitMetric.unit !== 'buc' && totalMetric > 60000)) {
        isSuspiciousMultipack = true;
        contradictionReasons.push(`Multipack suspect (${rawCount} x ${rawPerUnit} ${rawUnitStr}).`);
      }
      if (rawCount >= 1 && rawCount <= 48) {
        titlePackCount = rawCount;
        const unitDisplay = fromMetricBase(unitMetric.value, unitMetric.unit);
        titleUnitQty = unitDisplay.qty;
        titleUnitType = unitDisplay.unit;
        titleMetricVal = totalMetric;
        titleMetricUnit = unitMetric.unit;
      }
    }
  } else {
    // 2. Single package expression in title: "500 gr", "1,5 kg", "0.33 L", "250ml", "8 role"
    const singleRegex =
      /(?<![a-zA-Z0-9\-/.,])(\d+(?:[.,]\d+)?)\s*(kg|kgr|gr|g|ml|cl|dl|litri|litru|lt|l|buc(?:ati|ăți|\.)?|role|pachet(?:e)?|capsule|tablete|plicuri)\b(?![a-zA-Z0-9/²\-])/gi;
    const candidates: Array<{ qty: number; metricVal: number; metricUnit: 'g' | 'ml' | 'buc'; unit: UnitType }> = [];
    let sm: RegExpExecArray | null;
    while ((sm = singleRegex.exec(cleanedForPkg)) !== null) {
      const qty = Number.parseFloat(sm[1].replace(',', '.'));
      const uLower = stripDiacriticsLower(sm[2]).replace(/\./g, '');
      const uRaw = uLower === 'cl' || uLower === 'dl' ? (uLower as 'cl' | 'dl') : canonicalizeUnit(uLower);
      if (!Number.isFinite(qty) || qty <= 0 || !uRaw) continue;
      const metric = toMetricBase(qty, uRaw);
      if ((metric.unit === 'g' || metric.unit === 'ml') && metric.value > 50000) continue;
      if (metric.unit === 'buc' && metric.value > 500) continue;
      const display = fromMetricBase(metric.value, metric.unit);
      candidates.push({ qty: display.qty, metricVal: metric.value, metricUnit: metric.unit, unit: display.unit });
    }
    if (candidates.length > 0) {
      // Prefer physical weight/volume (g/ml) over generic count ("buc") when both appear
      const chosen = candidates.find(c => c.metricUnit !== 'buc') || candidates[0];
      titleUnitQty = chosen.qty;
      titleUnitType = chosen.unit;
      titleMetricVal = chosen.metricVal;
      titleMetricUnit = chosen.metricUnit;
      if (plusPackMatch) {
        const p1 = Number.parseInt(plusPackMatch[1], 10);
        const p2 = Number.parseInt(plusPackMatch[2], 10);
        if (p1 > 0 && p2 > 0 && p1 + p2 <= 24) {
          titlePackCount = p1 + p2;
        }
      }
    }
  }

  // Canonicalize explicit DB/input fields
  const canonInputUnit = canonicalizeUnit(originalUnit);
  let inputMetricVal: number | null = null;
  let inputMetricUnit: 'g' | 'ml' | 'buc' | null = null;
  if (originalQuantity !== null && canonInputUnit) {
    const m = toMetricBase(originalQuantity, canonInputUnit);
    inputMetricVal = m.value;
    inputMetricUnit = m.unit;
  }

  // Detect contradictory DB vs Title attributes (without mutating original values silently!)
  if (inputMetricVal !== null && inputMetricUnit && titleMetricVal !== null && titleMetricUnit) {
    if (inputMetricUnit !== titleMetricUnit && !(inputMetricUnit === 'buc' && titleMetricUnit !== 'buc')) {
      contradictionReasons.push(
        `Unitate contradictorie: atribut stocat (${originalQuantity} ${originalUnit}) vs titlu (${titleMetricVal} ${titleMetricUnit}).`
      );
    } else if (inputMetricUnit === titleMetricUnit) {
      const ratio = Math.min(inputMetricVal, titleMetricVal) / Math.max(inputMetricVal, titleMetricVal);
      if (ratio < 0.75) {
        if (titlePackCount > 1 && Math.abs(inputMetricVal - titleMetricVal / titlePackCount) <= 1.0) {
          contradictionReasons.push(
            `Multipack neagregat în DB: titlul indică ${titlePackCount} unități (total ${titleMetricVal} ${titleMetricUnit}), dar în câmpul cantității apare o singură unitate (${inputMetricVal} ${inputMetricUnit}).`
          );
        } else {
          contradictionReasons.push(
            `Cantitate contradictorie: atribut stocat (${originalQuantity} ${originalUnit}) vs titlu (${titleMetricVal} ${titleMetricUnit}).`
          );
        }
      }
    }
  }

  // Guard for suspicious explicit values like "Aparat de ras cu 3 lame" stored as "3 l"
  if (
    originalQuantity &&
    canonInputUnit === 'l' &&
    /\b(?:aparat\s+de\s+ras|lame|rezerve|epilator|tigaie|oala|piscina|bec|led|set\s+\d+)\b/i.test(normTitleLower) &&
    !/\b\d+(?:[.,]\d+)?\s*(?:l|ml|litri)\b/i.test(normTitleLower)
  ) {
    contradictionReasons.push(
      `Unitate probabil eronată pe produs nealimentar/accesoriu (${originalQuantity} ${originalUnit} în loc de buc).`
    );
  }

  // Choose authoritative normalized view (title multipack/explicit weight preferred if DB lacks unit or contradicts on packCount)
  let finalPackCount = titlePackCount;
  let finalMetricVal: number | null = titleMetricVal ?? inputMetricVal;
  let finalMetricUnit: 'g' | 'ml' | 'buc' | null = titleMetricUnit ?? inputMetricUnit;

  // If title gave only count (e.g. "2x" with implicit unit) and input gave g/ml, use input's metric unit if compatible
  if (titlePackCount === 1 && inputMetricVal !== null && inputMetricUnit && titleMetricVal !== null && titleMetricUnit === inputMetricUnit) {
    // Prefer whichever is more specific, keep ratio-aligned
    finalMetricVal = titleMetricVal;
  }
  if (inputMetricVal !== null && inputMetricUnit && titleMetricUnit === 'buc' && inputMetricUnit !== 'buc') {
    finalMetricVal = inputMetricVal;
    finalMetricUnit = inputMetricUnit;
  }

  // Determine missing quantity (DB often fills default 1 buc even when title has no quantity and product isn't 1 buc)
  const hasExplicitQuantityInTitle = titleMetricVal !== null;
  const hasExplicitWeightOrVolumeInInput = Boolean(originalQuantity && canonInputUnit && canonInputUnit !== 'buc' && canonInputUnit !== 'pachet');
  const hasExplicitMultiBucInInput = Boolean(originalQuantity && originalQuantity > 1 && canonInputUnit === 'buc');
  const hasMissingQuantity = !hasExplicitQuantityInTitle && !hasExplicitWeightOrVolumeInInput && !hasExplicitMultiBucInInput && !isVariableWeight;

  if (finalMetricVal === null || finalMetricUnit === null) {
    return {
      originalQuantity,
      originalUnit,
      packCount: finalPackCount,
      isMultipack: finalPackCount > 1,
      isSuspiciousMultipack,
      unitPackageQuantity: null,
      unitPackageUnit: null,
      totalQuantity: null,
      totalUnit: null,
      normalizedMetricValue: null,
      normalizedMetricUnit: null,
      unitNormalizedMetricValue: null,
      packagingStructureKey: isVariableWeight ? 'variable_weight' : null,
      isVariableWeight,
      hasMissingQuantity,
      hasContradictoryAttributes: contradictionReasons.length > 0,
      contradictionReasons
    };
  }

  const unitMetricVal = Number((finalMetricVal / finalPackCount).toFixed(3));
  const unitDisplay = fromMetricBase(unitMetricVal, finalMetricUnit);
  const totalDisplay = fromMetricBase(finalMetricVal, finalMetricUnit);

  const packagingStructureKey = isVariableWeight
    ? 'variable_weight'
    : `${finalPackCount}x${Math.round(unitMetricVal * 1000) / 1000}${finalMetricUnit}`;

  return {
    originalQuantity,
    originalUnit,
    packCount: finalPackCount,
    isMultipack: finalPackCount > 1,
    isSuspiciousMultipack,
    unitPackageQuantity: titleUnitQty ?? unitDisplay.qty,
    unitPackageUnit: titleUnitType ?? unitDisplay.unit,
    totalQuantity: totalDisplay.qty,
    totalUnit: totalDisplay.unit,
    normalizedMetricValue: finalMetricVal,
    normalizedMetricUnit: finalMetricUnit,
    unitNormalizedMetricValue: unitMetricVal,
    packagingStructureKey,
    isVariableWeight,
    hasMissingQuantity,
    hasContradictoryAttributes: contradictionReasons.length > 0,
    contradictionReasons
  };
}

/**
 * ETAPA 3: Compares two normalized packaging specs.
 * Distinguishes total quantity equivalence (500g total) from packaging structure (1x500g vs 2x250g vs 5x100g).
 */
export function compareNormalizedPackaging(a: NormalizedPackagingResult, b: NormalizedPackagingResult): PackagingComparisonResult {
  if (a.isVariableWeight !== b.isVariableWeight) {
    return {
      comparable: false,
      incompatibleUnitFamily: false,
      variableWeightConflict: true,
      totalQuantityMatch: false,
      totalRatio: 0,
      exactStructureMatch: false,
      differentStructureSameTotal: false,
      reason: 'Produs la greutate variabilă vs ambalaj fix.'
    };
  }

  if (a.normalizedMetricValue === null || b.normalizedMetricValue === null || !a.normalizedMetricUnit || !b.normalizedMetricUnit) {
    return {
      comparable: false,
      incompatibleUnitFamily: false,
      variableWeightConflict: false,
      totalQuantityMatch: false,
      totalRatio: 1,
      exactStructureMatch: false,
      differentStructureSameTotal: false
    };
  }

  if (a.normalizedMetricUnit !== b.normalizedMetricUnit) {
    // Allow 'buc' fallback only if one is missing weight/volume and explicitly 'buc' vs 'buc'
    return {
      comparable: false,
      incompatibleUnitFamily: true,
      variableWeightConflict: false,
      totalQuantityMatch: false,
      totalRatio: 0,
      exactStructureMatch: false,
      differentStructureSameTotal: false,
      reason: `Familii de unități incompatibile: ${a.normalizedMetricUnit} vs ${b.normalizedMetricUnit}.`
    };
  }

  const maxV = Math.max(a.normalizedMetricValue, b.normalizedMetricValue);
  const minV = Math.min(a.normalizedMetricValue, b.normalizedMetricValue);
  const totalRatio = maxV > 0 ? Number((minV / maxV).toFixed(4)) : 0;
  const totalQuantityMatch = totalRatio >= 0.98;
  const samePackCount = a.packCount === b.packCount;

  const exactStructureMatch = totalQuantityMatch && samePackCount;
  const differentStructureSameTotal = totalQuantityMatch && !samePackCount;

  return {
    comparable: true,
    incompatibleUnitFamily: false,
    variableWeightConflict: false,
    totalQuantityMatch,
    totalRatio,
    exactStructureMatch,
    differentStructureSameTotal,
    reason: differentStructureSameTotal
      ? `Cantitate totală echivalentă (${a.normalizedMetricValue}${a.normalizedMetricUnit}), dar structură de ambalaj diferită (${a.packagingStructureKey} vs ${b.packagingStructureKey}).`
      : undefined
  };
}

/**
 * ETAPA 4: Title normalization preserving relevant variant attributes.
 */
const FLAVOR_KEYWORDS = [
  'ciocolata',
  'capsuni',
  'vanilie',
  'zmeura',
  'lamaie',
  'portocale',
  'banane',
  'alune',
  'caramel',
  'menta',
  'visine',
  'cirese',
  'ananas',
  'piersici',
  'caise',
  'afine',
  'fructe de padure',
  'cacao',
  'migdale',
  'fistic',
  'cocos',
  'scortisoara',
  'usturoi',
  'boia',
  'chili',
  'piper',
  'busuioc',
  'oregano',
  'lime',
  'grapefruit',
  'mar verde',
  'pepene'
];

const GENERIC_NON_DESCRIPTIVE_WORDS = new Set([
  'produs',
  'produse',
  'articol',
  'oferta',
  'promotie',
  'super',
  'mega',
  'divers',
  'diverse',
  'generic',
  'item',
  'unknown',
  'necunoscut'
]);

export function normalizeTitleAndVariants(rawTitle?: string | null): TitleNormalizationResult {
  const originalTitle = typeof rawTitle === 'string' ? rawTitle : '';
  if (!originalTitle.trim()) {
    return {
      originalTitle,
      cleanedTitle: '',
      normalizedTitle: '',
      normalizedDescriptiveTitle: '',
      ocrCorrected: false,
      promoStripped: false,
      variantAttributes: {
        percentages: [],
        sugarFree: false,
        lactoseFree: false,
        decaf: false,
        glutenFree: false,
        alcoholFree: false,
        hasAlcoholIndicator: false,
        bio: false,
        flavors: [],
        extraVariantTokens: []
      },
      isInsufficientlyDescriptive: true,
      insufficiencyReasons: ['Titlu gol sau lipsă.']
    };
  }

  // 1. Clean whitespace, newlines, control chars, conservative OCR artifacts
  let cleaned = originalTitle
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[•|*_~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let ocrCorrected = false;
  // Conservative OCR fixes: letter O inside numeric weights/volumes/percentages (e.g. 5OOg -> 500g, 1.5O -> 1.50, 25Oml -> 250ml)
  const beforeOcr = cleaned;
  cleaned = cleaned
    .replace(/\b(\d)[Oo]+(?=\s*(?:g|gr|kg|ml|l|buc|%)\b)/g, (_, d) => `${d}${'0'.repeat(_.length - 1)}`)
    .replace(/\b(\d{1,3})[Oo](\d?)(?=\s*(?:g|gr|kg|ml|l|buc|%)\b)/gi, (_, a, b) => `${a}0${b}`)
    .replace(/\b([Ll])apt3\b/g, '$1apte')
    .replace(/\b([Pp])ain3\b/g, '$1âine');
  if (cleaned !== beforeOcr) ocrCorrected = true;

  // Strip promo noise expressions WITHOUT touching variant/formulation/weight cues
  const beforePromo = cleaned;
  cleaned = cleaned
    .replace(/\b(?:ofert[ăa]\s+s[ăa]pt[ăa]m[âaî]nii|ofert[ăa]\s+special[ăa]|super\s+pre[țtţ]|pre[țtţ]\s+redus|mega\s+ofert[ăa]|reducere\s*-?\d+%|lidl\s+plus|kaufland\s+card|penny\s+card|myclub\s+auchan|super\s+weekend|de\s+luni|de\s+joi)\b/gi, ' ')
    .replace(/\bnou!/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const promoStripped = cleaned !== beforePromo;

  // Normalize comma in decimal units and normalize "500 gr"/"500g" -> "500 g", "1,5 lt" -> "1.5 l"
  const normBase = stripDiacriticsLower(cleaned)
    .replace(/(\d+),(\d+)/g, '$1.$2')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:grame|gram|gr|g)\b\.?/g, '$1 g')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:kilograme|kilogram|kgr|kg)\b\.?/g, '$1 kg')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:mililitri|mililitru|ml)\b\.?/g, '$1 ml')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:litri|litru|lt|l)\b\.?/g, '$1 l')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:bucati|bucata|buc\.?)\b/g, '$1 buc')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1%')
    .replace(/(?<=\d)\s*([x×])\s*(?=\d)/g, ' x ')
    .replace(/×/g, ' x ')
    .replace(/[^a-z0-9.%+\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Expand conservative common abbreviations without destroying words
  const normalizedTitle = normBase
    .replace(/\bpt\b/g, 'pentru')
    .replace(/\bsi\b/g, 'si')
    .replace(/\bdecof\.?\b/g, 'decofeinizata')
    .replace(/\bmgr\.?\b/g, 'margarina')
    .replace(/\bsm\.?\s+(?=\d)/g, 'smantana ')
    .replace(/\bcs\b/g, 'cascaval')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract protected Variant Attributes BEFORE any token comparison
  const percentages = Array.from(
    new Set(
      (normalizedTitle.match(/\b\d+(?:\.\d+)?%/g) || []).map(p => p.replace(/\s+/g, ''))
    )
  ).sort();

  let coffeeForm: VariantAttributes['coffeeForm'];
  if (/\b(?:boabe|cafea\s+boabe|whole\s+bean)\b/.test(normalizedTitle)) {
    coffeeForm = 'boabe';
  } else if (/\b(?:capsule|nespresso|dolce\s+gusto|tassimo|lor\s+capsule)\b/.test(normalizedTitle)) {
    coffeeForm = 'capsule';
  } else if (/\b(?:paduri|pad-uri|senseo)\b/.test(normalizedTitle)) {
    coffeeForm = 'paduri';
  } else if (/\b(?:solubila|instant|ness|nescafe\s+brasero|jacobs\s+cronat)\b/.test(normalizedTitle)) {
    coffeeForm = 'solubila';
  } else if (/\b(?:macinata|cafea\s+macinata|ground)\b/.test(normalizedTitle)) {
    coffeeForm = 'macinata';
  }

  const sugarFree = /\b(?:fara\s+zahar|no\s+added\s+sugar|zero\s+zahar|zero|diet|light|sugar\s+free|stevia)\b/.test(
    normalizedTitle
  );
  const lactoseFree = /\b(?:fara\s+lactoza|lactose\s+free|delactozat)\b/.test(normalizedTitle);
  const decaf = /\b(?:decofeinizata|decofeinizat|fara\s+cofeina|decaf)\b/.test(normalizedTitle);
  const glutenFree = /\b(?:fara\s+gluten|gluten\s+free)\b/.test(normalizedTitle);
  const alcoholFree =
    /\b(?:fara\s+alcool|non\s+alcoholic|0\.0%|0%|alcohol\s+free)\b/.test(normalizedTitle) &&
    !/\b(?:40%|37\.5%|12%|5%)\s*alcool\b/.test(normalizedTitle);
  const hasAlcoholIndicator =
    !alcoholFree &&
    (/\b(?:cu\s+alcool|alcool\s+\d|vodka|whisky|tuica|palinca|rom\s+\d|vin\s+(?:alb|rosu|rose)|bere)\b/.test(
      normalizedTitle
    ) ||
      percentages.some(p => parseFloat(p) >= 3.0 && /\b(?:bere|vin|cidru|lichior|vodka|gin|whisky)\b/.test(normalizedTitle)));

  const bio = /\b(?:bio|ecologic|ecologica|organic)\b/.test(normalizedTitle);

  let flourOrBreadKind: VariantAttributes['flourOrBreadKind'];
  if (/\b(?:neagra|secara|integrala|integral|graham|cu\s+seminte)\b/.test(normalizedTitle)) {
    flourOrBreadKind = 'neagra_integrala';
  } else if (/\b(?:alba|alb)\b/.test(normalizedTitle)) {
    flourOrBreadKind = 'alba';
  }

  let chocolateKind: VariantAttributes['chocolateKind'];
  if (/\bciocolata\b/.test(normalizedTitle)) {
    if (/\b(?:neagra|amaruie|dark)\b/.test(normalizedTitle)) chocolateKind = 'neagra';
    else if (/\b(?:alba|white)\b/.test(normalizedTitle)) chocolateKind = 'alba';
    else if (/\b(?:cu\s+lapte|milk)\b/.test(normalizedTitle)) chocolateKind = 'lapte';
  }

  let dairyProcessing: VariantAttributes['dairyProcessing'];
  if (/\buht\b/.test(normalizedTitle)) dairyProcessing = 'uht';
  else if (/\bproaspat\b|\bpasteurizat\b/.test(normalizedTitle)) dairyProcessing = 'proaspat';

  const flavors = FLAVOR_KEYWORDS.filter(f => new RegExp(`\\b${escapeRegExp(f)}\\b`).test(normalizedTitle));
  const extraVariantTokens = Array.from(
    new Set([
      ...percentages,
      ...(coffeeForm ? [coffeeForm] : []),
      ...(sugarFree ? ['fara_zahar'] : []),
      ...(lactoseFree ? ['fara_lactoza'] : []),
      ...(decaf ? ['fara_cofeina'] : []),
      ...(glutenFree ? ['fara_gluten'] : []),
      ...(alcoholFree ? ['fara_alcool'] : []),
      ...(bio ? ['bio'] : []),
      ...(flourOrBreadKind ? [flourOrBreadKind] : []),
      ...(chocolateKind ? [`choc_${chocolateKind}`] : []),
      ...flavors
    ])
  ).sort();

  // Build normalizedDescriptiveTitle (strip standalone packaging tokens while retaining descriptive & variant tokens)
  const normalizedDescriptiveTitle = normalizedTitle
    .replace(/\b\d{1,3}\s*x\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|buc)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|buc|pachet|role)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Check if title is insufficiently descriptive
  const substantiveTokens = normalizedDescriptiveTitle
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !/^\d+(?:\.\d+)?%?$/.test(t) && !GENERIC_NON_DESCRIPTIVE_WORDS.has(t));

  const insufficiencyReasons: string[] = [];
  if (cleaned.length < 4) {
    insufficiencyReasons.push('Titlu prea scurt (< 4 caractere).');
  }
  if (substantiveTokens.length === 0) {
    insufficiencyReasons.push('Titlu lipsit de cuvinte descriptive (doar cifre/unități/cuvinte generice).');
  } else if (substantiveTokens.length === 1 && substantiveTokens[0].length < 5) {
    insufficiencyReasons.push(`Titlu prea vag (un singur cuvânt scurt: „${substantiveTokens[0]}”).`);
  }

  return {
    originalTitle,
    cleanedTitle: cleaned,
    normalizedTitle,
    normalizedDescriptiveTitle,
    ocrCorrected,
    promoStripped,
    variantAttributes: {
      percentages,
      coffeeForm,
      sugarFree,
      lactoseFree,
      decaf,
      glutenFree,
      alcoholFree,
      hasAlcoholIndicator,
      bio,
      flourOrBreadKind,
      chocolateKind,
      dairyProcessing,
      flavors,
      extraVariantTokens
    },
    isInsufficientlyDescriptive: insufficiencyReasons.length > 0,
    insufficiencyReasons
  };
}

/**
 * Checks strict variant compatibility so distinct product variants are NEVER merged.
 */
export function areVariantAttributesCompatible(
  a: VariantAttributes,
  b: VariantAttributes
): { compatible: boolean; conflictReasons: string[] } {
  const conflictReasons: string[] = [];

  if (a.percentages.length > 0 && b.percentages.length > 0) {
    const shared = a.percentages.some(p => b.percentages.includes(p));
    if (!shared) {
      conflictReasons.push(`Procentaj/concentrație diferită: ${a.percentages.join(', ')} vs ${b.percentages.join(', ')}.`);
    }
  }
  if (a.coffeeForm && b.coffeeForm && a.coffeeForm !== b.coffeeForm) {
    conflictReasons.push(`Formă cafea diferită: ${a.coffeeForm} vs ${b.coffeeForm}.`);
  }
  if (a.sugarFree !== b.sugarFree) {
    conflictReasons.push('Variantă fără zahăr/zero/diet vs variantă standard.');
  }
  if (a.lactoseFree !== b.lactoseFree) {
    conflictReasons.push('Variantă fără lactoză vs variantă standard.');
  }
  if (a.decaf !== b.decaf) {
    conflictReasons.push('Variantă decofeinizată vs standard.');
  }
  if (a.glutenFree !== b.glutenFree) {
    conflictReasons.push('Variantă fără gluten vs standard.');
  }
  if (a.alcoholFree !== b.alcoholFree && (a.hasAlcoholIndicator || b.hasAlcoholIndicator)) {
    conflictReasons.push('Variantă fără alcool vs produs cu alcool.');
  }
  if (a.bio !== b.bio) {
    conflictReasons.push('Variantă Bio/Ecologic vs convențional.');
  }
  if (a.flourOrBreadKind && b.flourOrBreadKind && a.flourOrBreadKind !== b.flourOrBreadKind) {
    conflictReasons.push(`Tip panificație/făină diferit: ${a.flourOrBreadKind} vs ${b.flourOrBreadKind}.`);
  }
  if (a.chocolateKind && b.chocolateKind && a.chocolateKind !== b.chocolateKind) {
    conflictReasons.push(`Tip ciocolată diferit: ${a.chocolateKind} vs ${b.chocolateKind}.`);
  }
  if (a.dairyProcessing && b.dairyProcessing && a.dairyProcessing !== b.dairyProcessing) {
    conflictReasons.push(`Procesare lactat diferită: ${a.dairyProcessing} vs ${b.dairyProcessing}.`);
  }
  if (a.flavors.length > 0 && b.flavors.length > 0) {
    const aSet = new Set(a.flavors);
    const hasSharedFlavor = b.flavors.some(f => aSet.has(f));
    if (!hasSharedFlavor) {
      conflictReasons.push(`Aromă diferită: ${a.flavors.join(', ')} vs ${b.flavors.join(', ')}.`);
    }
  }

  return {
    compatible: conflictReasons.length === 0,
    conflictReasons
  };
}

/**
 * ETAPA 5: Barcode validation & normalization (EAN-8, UPC-A, EAN-13, GTIN-14, Mod-10, 20..29 variable weight).
 */
export function computeGs1Mod10CheckDigit(bodyDigits: string): number {
  let sum = 0;
  for (let i = bodyDigits.length - 1, pos = 0; i >= 0; i--, pos++) {
    const d = Number(bodyDigits[i]);
    sum += d * (pos % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

function isSuspiciousNumericBarcode(digits: string): string | null {
  if (!digits) return null;
  if (/^(\d)\1+$/.test(digits)) {
    return 'Cod sintetic cu cifre identice repetate.';
  }
  if (digits === '12345678' || digits === '123456789012' || digits === '1234567890128' || digits === '0123456789012') {
    return 'Secvență sintetică de test.';
  }
  if (/^0{6,}/.test(digits)) {
    return 'Prefix excesiv de zerouri (posibil cod intern/invalid).';
  }
  return null;
}

export function validateAndNormalizeBarcode(rawBarcode?: string | null): BarcodeValidationResult {
  const originalBarcode = typeof rawBarcode === 'string' && rawBarcode.trim().length > 0 ? rawBarcode.trim() : null;
  if (!originalBarcode) {
    return {
      originalBarcode: null,
      digitsOnly: '',
      format: 'EMPTY',
      isValidFormat: false,
      isValidCheckDigit: false,
      isVariableWeight: false,
      isSuspicious: false,
      quality: 'missing',
      isEligibleForAutoMatch: false,
      normalizedPrimaryBarcode: null,
      normalizedGtin13: null,
      normalizedEquivalentBarcodes: [],
      reasons: []
    };
  }

  const digitsOnly = originalBarcode.replace(/\D/g, '');
  const reasons: string[] = [];

  if (/[a-zA-Z]/.test(originalBarcode)) {
    reasons.push(`Conține caractere non-numerice („${originalBarcode}”).`);
  }

  let format: BarcodeValidationResult['format'] = 'INVALID';
  if (digitsOnly.length === 8) format = 'EAN-8';
  else if (digitsOnly.length === 12) format = 'UPC-A';
  else if (digitsOnly.length === 13) format = 'EAN-13';
  else if (digitsOnly.length === 14) format = 'GTIN-14';

  const isValidFormat = format !== 'INVALID' && !/[a-zA-Z]/.test(originalBarcode);
  if (!isValidFormat) {
    reasons.push(`Lungime sau format invalid GS1 (${digitsOnly.length} cifre).`);
  }

  const suspiciousReason = isSuspiciousNumericBarcode(digitsOnly);
  const isSuspicious = Boolean(suspiciousReason);
  if (suspiciousReason) {
    reasons.push(suspiciousReason);
  }

  let isValidCheckDigit = false;
  if (isValidFormat) {
    const body = digitsOnly.slice(0, -1);
    const check = Number(digitsOnly.slice(-1));
    const expected = computeGs1Mod10CheckDigit(body);
    isValidCheckDigit = check === expected;
    if (!isValidCheckDigit) {
      reasons.push(`Digit de control GS1 invalid (așteptat ${expected}, primit ${check}).`);
    }
  }

  // GS1 Restricted Circulation / Variable-weight / Store-internal prefixes (20..29)
  // Valid for both EAN-13 (starts with 20..29) and EAN-8 (starts with 20..29) and GTIN-14 (0 + 20..29)
  const isVariableWeight =
    (digitsOnly.length === 13 && /^2[0-9]/.test(digitsOnly)) ||
    (digitsOnly.length === 8 && /^2[0-9]/.test(digitsOnly)) ||
    (digitsOnly.length === 14 && /^02[0-9]/.test(digitsOnly));

  if (isVariableWeight) {
    reasons.push('Cod cu prefix 20..29 (greutate variabilă / circulație internă magazin) — exclus de la auto-merge universal.');
  }

  let quality: BarcodeQuality = 'invalid_format';
  if (!isValidFormat) {
    quality = 'invalid_format';
  } else if (isSuspicious) {
    quality = 'suspicious';
  } else if (isVariableWeight) {
    quality = 'variable_weight_or_internal';
  } else if (!isValidCheckDigit) {
    quality = 'invalid_check_digit';
  } else {
    quality = 'valid_universal';
  }

  const isEligibleForAutoMatch = quality === 'valid_universal';

  // Generate normalized UPC-A <-> EAN-13 representations ONLY when check digit & format are valid
  let normalizedGtin13: string | null = null;
  const equivalents = new Set<string>();
  if (isValidFormat && isValidCheckDigit && !isSuspicious) {
    equivalents.add(digitsOnly);
    if (digitsOnly.length === 12) {
      const ean13FromUpc = `0${digitsOnly}`;
      if (computeGs1Mod10CheckDigit(ean13FromUpc.slice(0, -1)) === Number(ean13FromUpc.slice(-1))) {
        equivalents.add(ean13FromUpc);
        normalizedGtin13 = ean13FromUpc;
      }
    } else if (digitsOnly.length === 13) {
      normalizedGtin13 = digitsOnly;
      if (digitsOnly.startsWith('0')) {
        const upc12 = digitsOnly.slice(1);
        if (computeGs1Mod10CheckDigit(upc12.slice(0, -1)) === Number(upc12.slice(-1))) {
          equivalents.add(upc12);
        }
      }
    } else if (digitsOnly.length === 14 && digitsOnly.startsWith('0')) {
      const gtin13 = digitsOnly.slice(1);
      if (computeGs1Mod10CheckDigit(gtin13.slice(0, -1)) === Number(gtin13.slice(-1))) {
        equivalents.add(gtin13);
        normalizedGtin13 = gtin13;
        if (gtin13.startsWith('0')) {
          equivalents.add(gtin13.slice(1));
        }
      }
    }
  }

  return {
    originalBarcode,
    digitsOnly,
    format,
    isValidFormat,
    isValidCheckDigit,
    isVariableWeight,
    isSuspicious,
    quality,
    isEligibleForAutoMatch,
    normalizedPrimaryBarcode: isEligibleForAutoMatch ? (normalizedGtin13 || digitsOnly) : null,
    normalizedGtin13,
    normalizedEquivalentBarcodes: Array.from(equivalents),
    reasons
  };
}

/**
 * Normalizes a full catalog product in memory without mutating any original fields.
 */
export function normalizeCatalogProduct(product: Product): NormalizedProductAuditRecord {
  const brand = normalizeBrand(product.brand, product.name);
  const packaging = normalizeQuantityAndMultipack({
    rawTitle: product.name,
    quantity: product.packageWeightOrVolume,
    unit: product.packageUnit,
    barcode: product.barcode,
    isSoldByWeight: product.isSoldByWeight
  });
  const title = normalizeTitleAndVariants(product.name);
  const barcode = validateAndNormalizeBarcode(product.barcode);

  return {
    productId: product.id,
    originalName: product.name,
    originalBrand: typeof product.brand === 'string' && product.brand.trim() ? product.brand : null,
    originalBarcode: product.barcode ?? null,
    brand,
    packaging,
    title,
    barcode,
    isCanonicalRoot: !product.canonicalProductId
  };
}

/**
 * ETAPA 6: Generates a deterministic read-only Data Quality Report from catalog records.
 */
export function generateCatalogQualityReport(params: {
  products: Product[];
  retailerProducts?: RetailerProductRecord[];
  stagingOffers?: CatalogExtractedOffer[];
  dataSource: CatalogDataQualityReport['dataSource'];
  sampleLimit?: number;
}): CatalogDataQualityReport {
  const sampleLimit = Math.max(5, params.sampleLimit ?? 15);
  const products = params.products || [];

  let canonicalProductsCount = 0;
  let aliasProductsCount = 0;
  let validBrandsCount = 0;
  let verifiedExplicitBrandsCount = 0;
  let extractedFromTitleBrandsCount = 0;
  let placeholderBrandsCount = 0;
  let suspectOrCorruptBrandsCount = 0;
  let missingBrandsCount = 0;
  let productsWithoutQuantityCount = 0;
  let productsWithMultipackCount = 0;
  let productsWithSuspiciousMultipackCount = 0;
  let productsWithValidBarcodeCount = 0;
  let productsWithInvalidBarcodeCount = 0;
  let productsWithInvalidCheckDigitCount = 0;
  let productsWithSuspiciousBarcodeCount = 0;
  let productsWithVariableWeightBarcodeCount = 0;
  let productsWithoutBarcodeCount = 0;
  let productsWithVariableWeightCount = 0;
  let insufficientlyDescriptiveTitlesCount = 0;
  let productsWithContradictoryAttributesCount = 0;

  const placeholderSamples: CatalogDataQualityReport['samples']['placeholderBrands'] = [];
  const corruptBrandSamples: CatalogDataQualityReport['samples']['corruptBrands'] = [];
  const multipackSamples: CatalogDataQualityReport['samples']['multipacks'] = [];
  const suspiciousMultipackSamples: CatalogDataQualityReport['samples']['suspiciousMultipacks'] = [];
  const invalidBarcodeSamples: CatalogDataQualityReport['samples']['invalidBarcodes'] = [];
  const variableWeightSamples: CatalogDataQualityReport['samples']['variableWeightProducts'] = [];
  const insufficientTitleSamples: CatalogDataQualityReport['samples']['insufficientTitles'] = [];
  const contradictorySamples: CatalogDataQualityReport['samples']['contradictoryAttributes'] = [];

  for (const prod of products) {
    const audit = normalizeCatalogProduct(prod);
    if (audit.isCanonicalRoot) canonicalProductsCount++;
    else aliasProductsCount++;

    // Brand stats
    if (audit.brand.brandQuality === 'verified_brand') {
      validBrandsCount++;
      verifiedExplicitBrandsCount++;
    } else if (audit.brand.brandQuality === 'extracted_from_title') {
      validBrandsCount++;
      extractedFromTitleBrandsCount++;
      if (audit.brand.originalBrand && placeholderSamples.length < sampleLimit) {
        placeholderSamples.push({
          id: prod.id,
          name: prod.name,
          originalBrand: audit.brand.originalBrand,
          recoveredBrand: audit.brand.normalizedBrand
        });
      }
    } else if (audit.brand.brandQuality === 'placeholder') {
      placeholderBrandsCount++;
      if (placeholderSamples.length < sampleLimit) {
        placeholderSamples.push({
          id: prod.id,
          name: prod.name,
          originalBrand: audit.brand.originalBrand,
          recoveredBrand: audit.brand.normalizedBrand
        });
      }
    } else if (audit.brand.brandQuality === 'corrupt_or_non_brand') {
      suspectOrCorruptBrandsCount++;
      if (corruptBrandSamples.length < sampleLimit) {
        corruptBrandSamples.push({
          id: prod.id,
          name: prod.name,
          originalBrand: audit.brand.originalBrand,
          reasons: audit.brand.reasons
        });
      }
    } else {
      missingBrandsCount++;
    }

    // Packaging / Multipack stats
    if (audit.packaging.hasMissingQuantity) {
      productsWithoutQuantityCount++;
    }
    if (audit.packaging.isMultipack) {
      productsWithMultipackCount++;
      if (multipackSamples.length < sampleLimit) {
        multipackSamples.push({
          id: prod.id,
          name: prod.name,
          packCount: audit.packaging.packCount,
          unitQty: audit.packaging.unitPackageQuantity,
          unit: audit.packaging.unitPackageUnit,
          total: audit.packaging.totalQuantity,
          totalUnit: audit.packaging.totalUnit
        });
      }
    }
    if (audit.packaging.isSuspiciousMultipack) {
      productsWithSuspiciousMultipackCount++;
      if (suspiciousMultipackSamples.length < sampleLimit) {
        suspiciousMultipackSamples.push({
          id: prod.id,
          name: prod.name,
          reasons: audit.packaging.contradictionReasons
        });
      }
    }
    if (audit.packaging.isVariableWeight) {
      productsWithVariableWeightCount++;
      if (variableWeightSamples.length < sampleLimit) {
        variableWeightSamples.push({
          id: prod.id,
          name: prod.name,
          barcode: audit.originalBarcode
        });
      }
    }
    if (audit.packaging.hasContradictoryAttributes) {
      productsWithContradictoryAttributesCount++;
      if (contradictorySamples.length < sampleLimit) {
        contradictorySamples.push({
          id: prod.id,
          name: prod.name,
          reasons: audit.packaging.contradictionReasons
        });
      }
    }

    // Title quality
    if (audit.title.isInsufficientlyDescriptive) {
      insufficientlyDescriptiveTitlesCount++;
      if (insufficientTitleSamples.length < sampleLimit) {
        insufficientTitleSamples.push({
          id: prod.id,
          name: prod.name,
          reasons: audit.title.insufficiencyReasons
        });
      }
    }

    // Barcode stats
    if (audit.barcode.quality === 'missing') {
      productsWithoutBarcodeCount++;
    } else if (audit.barcode.quality === 'valid_universal') {
      productsWithValidBarcodeCount++;
    } else {
      productsWithInvalidBarcodeCount++;
      if (audit.barcode.quality === 'invalid_check_digit') productsWithInvalidCheckDigitCount++;
      if (audit.barcode.quality === 'suspicious') productsWithSuspiciousBarcodeCount++;
      if (audit.barcode.quality === 'variable_weight_or_internal') productsWithVariableWeightBarcodeCount++;
      if (invalidBarcodeSamples.length < sampleLimit) {
        invalidBarcodeSamples.push({
          id: prod.id,
          name: prod.name,
          barcode: audit.barcode.originalBarcode || '',
          quality: audit.barcode.quality,
          reasons: audit.barcode.reasons
        });
      }
    }
  }

  let retailerProductsSummary: CatalogDataQualityReport['retailerProductsSummary'];
  if (Array.isArray(params.retailerProducts)) {
    let withBarcodeCount = 0;
    let withValidBarcodeCount = 0;
    let withInvalidOrVariableBarcodeCount = 0;
    let withPlaceholderOrCorruptBrandCount = 0;
    for (const rp of params.retailerProducts) {
      if (rp.barcode) {
        withBarcodeCount++;
        const bv = validateAndNormalizeBarcode(rp.barcode);
        if (bv.quality === 'valid_universal') withValidBarcodeCount++;
        else withInvalidOrVariableBarcodeCount++;
      }
      const br = normalizeBrand(rp.scrapedBrand, rp.scrapedName);
      if (br.brandQuality === 'placeholder' || br.brandQuality === 'corrupt_or_non_brand') {
        withPlaceholderOrCorruptBrandCount++;
      }
    }
    retailerProductsSummary = {
      totalRecords: params.retailerProducts.length,
      withBarcodeCount,
      withValidBarcodeCount,
      withInvalidOrVariableBarcodeCount,
      withPlaceholderOrCorruptBrandCount
    };
  }

  let stagingOffersSummary: CatalogDataQualityReport['stagingOffersSummary'];
  if (Array.isArray(params.stagingOffers)) {
    let withMultipackCount = 0;
    let withValidBarcodeCount = 0;
    let withInvalidBarcodeCount = 0;
    let withPlaceholderBrandCount = 0;
    for (const st of params.stagingOffers) {
      const pkg = normalizeQuantityAndMultipack({
        rawTitle: st.rawTitle,
        quantity: st.packageQuantity,
        unit: st.packageUnit,
        barcode: st.rawBarcode
      });
      if (pkg.isMultipack) withMultipackCount++;
      if (st.rawBarcode) {
        const bv = validateAndNormalizeBarcode(st.rawBarcode);
        if (bv.quality === 'valid_universal') withValidBarcodeCount++;
        else withInvalidBarcodeCount++;
      }
      const br = normalizeBrand(st.rawBrand, st.rawTitle);
      if (br.brandQuality === 'placeholder' || br.brandQuality === 'corrupt_or_non_brand') {
        withPlaceholderBrandCount++;
      }
    }
    stagingOffersSummary = {
      totalRecords: params.stagingOffers.length,
      withMultipackCount,
      withValidBarcodeCount,
      withInvalidBarcodeCount,
      withPlaceholderBrandCount
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    dataSource: params.dataSource,
    readOnlyVerified: true,
    summary: {
      totalProductsAnalyzed: products.length,
      canonicalProductsCount,
      aliasProductsCount,
      validBrandsCount,
      verifiedExplicitBrandsCount,
      extractedFromTitleBrandsCount,
      placeholderBrandsCount,
      suspectOrCorruptBrandsCount,
      missingBrandsCount,
      productsWithoutQuantityCount,
      productsWithMultipackCount,
      productsWithSuspiciousMultipackCount,
      productsWithValidBarcodeCount,
      productsWithInvalidBarcodeCount,
      productsWithInvalidCheckDigitCount,
      productsWithSuspiciousBarcodeCount,
      productsWithVariableWeightBarcodeCount,
      productsWithoutBarcodeCount,
      productsWithVariableWeightCount,
      insufficientlyDescriptiveTitlesCount,
      productsWithContradictoryAttributesCount
    },
    retailerProductsSummary,
    stagingOffersSummary,
    samples: {
      placeholderBrands: placeholderSamples,
      corruptBrands: corruptBrandSamples,
      multipacks: multipackSamples,
      suspiciousMultipacks: suspiciousMultipackSamples,
      invalidBarcodes: invalidBarcodeSamples,
      variableWeightProducts: variableWeightSamples,
      insufficientTitles: insufficientTitleSamples,
      contradictoryAttributes: contradictorySamples
    }
  };
}
