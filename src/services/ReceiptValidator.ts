import type { Receipt, ReceiptItem, ReceiptVatEntry } from '../types.js';

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const SGR_NAME = /\b(?:sgr|returo|garantie|ambalaj)\b/i;

export interface ReceiptValidationOptions {
  lineTolerance?: number;
  receiptTolerance?: number;
}

export class ReceiptValidator {
  static validate(receipt: Receipt, options: ReceiptValidationOptions = {}): Receipt {
    const lineTolerance = options.lineTolerance ?? 0.02;
    const receiptTolerance = options.receiptTolerance ?? 0.05;
    const reasons: string[] = [];
    const vatByRate = new Map<number, { taxableAmount: number; vatAmount: number; grossAmount: number }>();

    const items = receipt.items.map((item): ReceiptItem => {
      const isSgr = item.isSgr ?? SGR_NAME.test(item.rawName);
      const itemReasons: string[] = [];
      const validQuantity = Number.isFinite(item.quantity) && item.quantity > 0;
      const validUnitPrice = Number.isFinite(item.unitPrice) && item.unitPrice >= 0;
      const validTotal = Number.isFinite(item.totalPrice) && item.totalPrice >= 0;
      const expectedTotal = validQuantity && validUnitPrice ? round2(item.quantity * item.unitPrice) : 0;
      const discrepancy = validTotal ? round2(Math.abs(expectedTotal - item.totalPrice)) : Number.POSITIVE_INFINITY;
      const tolerance = item.isWeighted || (validQuantity && item.quantity % 1 !== 0) ? Math.max(lineTolerance, 0.03) : lineTolerance;
      const mathValid = validQuantity && validUnitPrice && validTotal && discrepancy <= tolerance;

      if (!validQuantity) itemReasons.push('Cantitate lipsă sau invalidă.');
      if (!validUnitPrice || !validTotal) itemReasons.push('Preț lipsă sau invalid.');
      if (validQuantity && validUnitPrice && validTotal && !mathValid) {
        itemReasons.push(`Cantitate × preț unitar = ${expectedTotal.toFixed(2)} lei, dar subtotalul extras este ${item.totalPrice.toFixed(2)} lei.`);
      }
      if (item.confidence === 'low' || (item.confidenceScore !== undefined && item.confidenceScore < 60)) {
        itemReasons.push('Încredere OCR scăzută.');
      }
      if (item.matchStatus === 'ambiguous') itemReasons.push('Potrivirea produsului este ambiguă.');

      if (!isSgr && validTotal && item.vatRate !== undefined && Number.isFinite(item.vatRate) && item.vatRate >= 0) {
        const discount = Math.min(Math.max(item.discount || 0, 0), item.totalPrice);
        const grossAmount = Math.max(0, item.totalPrice - discount);
        const vatAmount = round2(grossAmount * item.vatRate / (100 + item.vatRate));
        const rate = round2(item.vatRate);
        const entry = vatByRate.get(rate) || { taxableAmount: 0, vatAmount: 0, grossAmount: 0 };
        entry.taxableAmount = round2(entry.taxableAmount + grossAmount - vatAmount);
        entry.vatAmount = round2(entry.vatAmount + vatAmount);
        entry.grossAmount = round2(entry.grossAmount + grossAmount);
        vatByRate.set(rate, entry);
      }

      if (itemReasons.length) reasons.push(`Linia „${item.rawName}”: ${itemReasons.join(' ')}`);
      return {
        ...item,
        isSgr,
        mathValid,
        mathDiscrepancy: Number.isFinite(discrepancy) ? discrepancy : undefined,
        requiresManualReview: itemReasons.length > 0,
        manualReviewReasons: itemReasons
      };
    });

    const sgrTotal = round2(items.reduce((sum, item) => sum + (item.isSgr ? Math.max(0, item.totalPrice) : 0), 0));
    const productSubtotal = round2(items.reduce((sum, item) => sum + (!item.isSgr && !item.isCouponOrDiscountLine ? Math.max(0, item.totalPrice) : 0), 0));
    const discountTotal = round2(Math.max(0, receipt.discountTotal || 0));
    const calculatedTotal = round2(Math.max(0, productSubtotal + sgrTotal - discountTotal));
    const printedTotal = round2(receipt.printedTotal ?? receipt.total);
    const discrepancyAmount = round2(Math.abs(calculatedTotal - printedTotal));
    const vatBreakdown: ReceiptVatEntry[] = [...vatByRate.entries()].map(([rate, amounts]) => ({
      rate,
      taxableAmount: amounts.taxableAmount,
      vatAmount: amounts.vatAmount,
      grossAmount: amounts.grossAmount
    }));
    const vatTotal = round2(vatBreakdown.reduce((sum, entry) => sum + (entry.vatAmount || 0), 0));

    if (discrepancyAmount > receiptTolerance) {
      reasons.push(`Totalul calculat (${calculatedTotal.toFixed(2)} lei) diferă de totalul imprimat (${printedTotal.toFixed(2)} lei).`);
    }
    if (receipt.vatTotal !== undefined && Math.abs(round2(receipt.vatTotal) - vatTotal) > receiptTolerance) {
      reasons.push(`TVA calculat (${vatTotal.toFixed(2)} lei) diferă de TVA-ul extras (${round2(receipt.vatTotal).toFixed(2)} lei).`);
    }

    const hasInvalidLine = items.some(item => item.requiresManualReview);
    const validationStatus = items.length === 0 || printedTotal < 0
      ? 'INVALID'
      : discrepancyAmount > receiptTolerance || hasInvalidLine || !receipt.storeId || receipt.storeId === 'unknown'
        ? 'NEEDS_REVIEW'
        : 'VALID';

    return {
      ...receipt,
      items,
      subtotal: productSubtotal,
      sgrTotal,
      vatTotal,
      vatBreakdown,
      printedTotal,
      calculatedTotal,
      discrepancyAmount,
      validationStatus,
      validationReasons: reasons
    };
  }
}
