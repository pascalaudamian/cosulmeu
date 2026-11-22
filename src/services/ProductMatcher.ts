import { Product, ProductMatchCandidate, UnitType } from '../types.js';
import { StorageService } from './StorageService.js';
import {
  areVariantAttributesCompatible,
  compareNormalizedPackaging,
  normalizeBrand,
  normalizeQuantityAndMultipack,
  normalizeTitleAndVariants,
  stripDiacriticsLower,
  validateAndNormalizeBarcode
} from './ProductNormalizationService.js';

export class ProductMatcher {
  /**
   * Remove diacritics and normalize text for comparison
   */
  static normalizeText(text: string | any): string {
    if (!text || typeof text !== 'string') {
      return typeof text === 'number' ? String(text) : '';
    }
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract words tokens excluding common stop words
   */
  static tokenize(text: string): string[] {
    const stopWords = new Set(['de', 'la', 'si', 'in', 'cu', 'fara', 'cal', 'calitatea', 'ro', 'buc', 'kg', 'g', 'l', 'ml', 'litru', 'litri', 'grame']);
    return this.normalizeText(text)
      .split(' ')
      .filter(w => w.length > 1 && !stopWords.has(w));
  }

  /**
   * Match a raw item to an existing catalog product using Faza 1A normalized attributes.
   * Invalid or variable-weight (20..29) barcodes NEVER trigger automatic GTIN matches.
   * Placeholder/corrupt brands NEVER contribute as verified brand matches.
   * Distinct multipack structures (e.g. 1x500g vs 2x250g) NEVER silently auto-merge.
   */
  static matchProduct(params: {
    rawName: string;
    barcode?: string;
    brand?: string;
    packageWeightOrVolume?: number;
    packageUnit?: UnitType;
    category?: string;
  }, products: Product[] = StorageService.getAllProducts()): {
    matchedProduct?: Product;
    confidence: number;
    matchMethod: 'gtin_exact' | 'name_brand_similarity' | 'manual';
    candidate?: ProductMatchCandidate;
  } {
    const allProducts = products;
    const inputBarcodeVal = validateAndNormalizeBarcode(params.barcode);

    // 1. Exact Barcode Match (GTIN / EAN / UPC-A <-> EAN-13) ONLY when valid GS1 & universal
    if (inputBarcodeVal.isEligibleForAutoMatch && inputBarcodeVal.normalizedEquivalentBarcodes.length > 0) {
      const inputBcSet = new Set(inputBarcodeVal.normalizedEquivalentBarcodes);
      const barcodeMatches = allProducts.filter(p => {
        if (!p.barcode) return false;
        const pVal = validateAndNormalizeBarcode(p.barcode);
        if (!pVal.isEligibleForAutoMatch) return false;
        return pVal.normalizedEquivalentBarcodes.some(code => inputBcSet.has(code));
      });

      if (barcodeMatches.length > 0) {
        // Prefer canonical root if available
        const preferredMatch = barcodeMatches.find(p => !p.canonicalProductId) || barcodeMatches[0];
        return {
          matchedProduct: preferredMatch,
          confidence: 1.0,
          matchMethod: 'gtin_exact'
        };
      }
    }

    // 2. Pre-normalize input title, variants, brand & packaging
    const inputTitleNorm = normalizeTitleAndVariants(params.rawName);
    const inputBrandNorm = normalizeBrand(params.brand, params.rawName);
    const inputPkg = normalizeQuantityAndMultipack({
      rawTitle: params.rawName,
      quantity: params.packageWeightOrVolume,
      unit: params.packageUnit,
      barcode: params.barcode
    });
    const inputTokens = this.tokenize(inputTitleNorm.normalizedDescriptiveTitle || params.rawName);

    let bestMatch: Product | null = null;
    let highestScore = 0;

    for (const product of allProducts) {
      // Conflict Guard 0: Distinct non-empty barcodes block auto-merge
      if (params.barcode && product.barcode) {
        const prodBarcodeVal = validateAndNormalizeBarcode(product.barcode);
        if (inputBarcodeVal.digitsOnly && prodBarcodeVal.digitsOnly) {
          const inputSet = new Set(
            inputBarcodeVal.normalizedEquivalentBarcodes.length > 0
              ? inputBarcodeVal.normalizedEquivalentBarcodes
              : [inputBarcodeVal.digitsOnly]
          );
          const prodCodes =
            prodBarcodeVal.normalizedEquivalentBarcodes.length > 0
              ? prodBarcodeVal.normalizedEquivalentBarcodes
              : [prodBarcodeVal.digitsOnly];
          if (!prodCodes.some(c => inputSet.has(c))) {
            continue; // Conflicting barcodes
          }
        }
      }

      // Conflict Guard 1: Variant & formulation attributes must be compatible
      const productTitleNorm = normalizeTitleAndVariants(product.name);
      const variantCheck = areVariantAttributesCompatible(
        inputTitleNorm.variantAttributes,
        productTitleNorm.variantAttributes
      );
      if (!variantCheck.compatible) {
        continue;
      }

      // Conflict Guard 2: Packaging, unit family, variable weight & multipack structure
      const productPkg = normalizeQuantityAndMultipack({
        rawTitle: product.name,
        quantity: product.packageWeightOrVolume,
        unit: product.packageUnit,
        barcode: product.barcode,
        isSoldByWeight: product.isSoldByWeight
      });
      const pkgCmp = compareNormalizedPackaging(inputPkg, productPkg);

      if (pkgCmp.variableWeightConflict) {
        continue;
      }

      // Legacy fallback: if explicit params.packageUnit conflicts liquid vs solid with product.packageUnit
      if (params.packageUnit) {
        const isLiquidA = ['l', 'ml'].includes(params.packageUnit);
        const isLiquidB = ['l', 'ml'].includes(product.packageUnit);
        if (isLiquidA !== isLiquidB && product.packageUnit !== 'buc' && params.packageUnit !== 'buc') {
          continue;
        }
      }
      if (pkgCmp.incompatibleUnitFamily) {
        // Allow comparison only if one side merely defaulted to 'buc' without explicit weight
        const onlyCountDefault =
          (inputPkg.normalizedMetricUnit === 'buc' && !params.packageWeightOrVolume) ||
          (productPkg.normalizedMetricUnit === 'buc' && product.packageWeightOrVolume === 1 && product.packageUnit === 'buc');
        if (!onlyCountDefault) {
          continue;
        }
      }

      if (pkgCmp.comparable && pkgCmp.totalRatio < 0.75) {
        continue;
      }

      const productTokens = this.tokenize(productTitleNorm.normalizedDescriptiveTitle || product.name);
      const isTokenMatch = (t1: string, t2: string) => {
        if (t1 === t2) return true;
        if (t1.length >= 4 && t2.length >= 4 && (t1.startsWith(t2.slice(0, 4)) || t2.startsWith(t1.slice(0, 4)))) {
          return true;
        }
        return false;
      };

      const commonTokens = inputTokens.filter(t1 => productTokens.some(t2 => isTokenMatch(t1, t2)));
      const totalTokens = new Set([...inputTokens, ...productTokens]).size;
      const jaccardScore = totalTokens > 0 ? commonTokens.length / totalTokens : 0;

      // Brand score: ONLY real (verified or extracted) brands contribute bonus or conflict!
      // Placeholder / corrupt / missing brands are strictly neutral (0.5).
      const productBrandNorm = normalizeBrand(product.brand, product.name);
      let brandScore = 0.5;
      let hasRealBrandConflict = false;
      if (inputBrandNorm.normalizedBrand && productBrandNorm.normalizedBrand) {
        const b1 = stripDiacriticsLower(inputBrandNorm.normalizedBrand);
        const b2 = stripDiacriticsLower(productBrandNorm.normalizedBrand);
        if (b1 === b2 || b1.includes(b2) || b2.includes(b1)) {
          brandScore = 1.0;
        } else {
          brandScore = 0.05;
          hasRealBrandConflict = true;
        }
      }

      // Weight & packaging structure score
      let weightScore = 0.8;
      if (pkgCmp.comparable) {
        if (pkgCmp.differentStructureSameTotal) {
          // Total weight is equal (e.g. 1x500g vs 2x250g), but multipack structure differs!
          weightScore = 0.35;
        } else if (pkgCmp.totalRatio >= 0.90) {
          weightScore = 1.0;
        } else {
          weightScore = pkgCmp.totalRatio;
        }
      }

      let compositeScore = Math.round((jaccardScore * 0.50 + brandScore * 0.30 + weightScore * 0.20) * 100) / 100;

      // Safety caps: structural packaging mismatch, real brand conflict, or suspicious multipack
      // MUST NOT silently cross the 0.70 auto-match threshold.
      if (pkgCmp.differentStructureSameTotal || hasRealBrandConflict || inputPkg.isSuspiciousMultipack) {
        compositeScore = Math.min(compositeScore, 0.65);
      }

      if (compositeScore > highestScore) {
        highestScore = compositeScore;
        bestMatch = product;
      }
    }

    if (bestMatch && highestScore >= 0.70) {
      return {
        matchedProduct: bestMatch,
        confidence: highestScore,
        matchMethod: 'name_brand_similarity'
      };
    } else if (bestMatch && highestScore >= 0.45) {
      const candidate: ProductMatchCandidate = {
        id: `cand-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        sourceRawName: params.rawName,
        sourceBarcode: params.barcode,
        sourceBrand: params.brand,
        sourcePackageWeightOrVolume: params.packageWeightOrVolume,
        sourcePackageUnit: params.packageUnit,
        matchedProductId: bestMatch.id,
        matchedProductName: bestMatch.name,
        confidenceScore: highestScore,
        matchMethod: 'name_brand_similarity',
        status: 'pending_confirmation',
        createdAt: new Date().toISOString()
      };

      return {
        matchedProduct: undefined,
        confidence: highestScore,
        matchMethod: 'name_brand_similarity',
        candidate
      };
    }

    return {
      matchedProduct: undefined,
      confidence: 0,
      matchMethod: 'name_brand_similarity'
    };
  }
}
