import { Product, ProductMatchCandidate, UnitType } from '../types';
import { StorageService } from './StorageService';

export class ProductMatcher {
  /**
   * Remove diacritics and normalize text for comparison
   */
  static normalizeText(text: string): string {
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
   * Match a raw item to an existing catalog product
   */
  static matchProduct(params: {
    rawName: string;
    barcode?: string;
    brand?: string;
    packageWeightOrVolume?: number;
    packageUnit?: UnitType;
    category?: string;
  }): {
    matchedProduct?: Product;
    confidence: number;
    matchMethod: 'gtin_exact' | 'name_brand_similarity' | 'manual';
    candidate?: ProductMatchCandidate;
  } {
    const allProducts = StorageService.getAllProducts();

    // 1. Exact Barcode Match (GTIN / EAN)
    if (params.barcode && params.barcode.trim()) {
      const cleanBarcode = params.barcode.trim();
      const exactBarcodeMatch = allProducts.find(p => p.barcode && p.barcode.trim() === cleanBarcode);
      if (exactBarcodeMatch) {
        return {
          matchedProduct: exactBarcodeMatch,
          confidence: 1.0,
          matchMethod: 'gtin_exact'
        };
      }
    }

    // 2. Name & Brand Token Similarity
    const inputTokens = this.tokenize(params.rawName);
    const inputBrandNorm = params.brand ? this.normalizeText(params.brand) : '';

    let bestMatch: Product | null = null;
    let highestScore = 0;

    for (const product of allProducts) {
      // Incompatibility guard: if units are completely incompatible (e.g. liters vs kg)
      if (params.packageUnit) {
        const isLiquidA = ['l', 'ml'].includes(params.packageUnit);
        const isLiquidB = ['l', 'ml'].includes(product.packageUnit);
        if (isLiquidA !== isLiquidB && product.packageUnit !== 'buc') {
          continue; // Incompatible units: do not match liquid with solid
        }
      }

      const productTokens = this.tokenize(product.name);
      const productBrandNorm = this.normalizeText(product.brand);

      // Calculate token intersection with Romanian inflection/stem matching (prefix >= 4 chars)
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

      // Brand match bonus
      let brandScore = 0.5; // neutral if no brand given
      if (inputBrandNorm && productBrandNorm) {
        if (inputBrandNorm.includes(productBrandNorm) || productBrandNorm.includes(inputBrandNorm)) {
          brandScore = 1.0;
        } else {
          brandScore = 0.1; // penalized for conflicting brands
        }
      }

      // Weight similarity bonus with unit normalization (convert g->kg, ml->l)
      let weightScore = 0.8;
      if (params.packageWeightOrVolume && product.packageWeightOrVolume) {
        let normW1 = params.packageWeightOrVolume;
        if (params.packageUnit === 'g' || params.packageUnit === 'ml') normW1 = normW1 / 1000;

        let normW2 = product.packageWeightOrVolume;
        if (product.packageUnit === 'g' || product.packageUnit === 'ml') normW2 = normW2 / 1000;

        const ratio = Math.min(normW1, normW2) / Math.max(normW1, normW2);
        weightScore = ratio >= 0.85 ? 1.0 : ratio;
      }

      // Weighted total confidence
      const compositeScore = Math.round((jaccardScore * 0.50 + brandScore * 0.30 + weightScore * 0.20) * 100) / 100;

      if (compositeScore > highestScore) {
        highestScore = compositeScore;
        bestMatch = product;
      }
    }

    if (bestMatch && highestScore >= 0.68) {
      return {
        matchedProduct: bestMatch,
        confidence: highestScore,
        matchMethod: 'name_brand_similarity'
      };
    } else if (bestMatch && highestScore >= 0.45) {
      // Create pending confirmation candidate
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
        matchedProduct: undefined, // Do not auto-merge uncertain products
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
