import assert from 'node:assert/strict';
import { ReceiptValidator } from '../src/services/ReceiptValidator.js';
import type { Receipt, ReceiptItem } from '../src/types.js';

const item = (overrides: Partial<ReceiptItem> = {}): ReceiptItem => ({
  id: 'line-1',
  rawName: 'Lapte 1L',
  quantity: 2,
  unitPrice: 5,
  totalPrice: 10,
  discount: 0,
  vatRate: 9,
  confidence: 'high',
  ...overrides
});

const receipt = (items: ReceiptItem[], overrides: Partial<Receipt> = {}): Receipt => ({
  id: 'receipt-1',
  storeId: 'lidl',
  storeName: 'Lidl',
  date: '2026-11-17',
  items,
  subtotal: 0,
  discountTotal: 0,
  total: 15,
  currency: 'RON',
  createdAt: '2026-11-17T12:00:00.000Z',
  verifiedStatus: 'draft',
  ...overrides
});

const validLine = item();
const sgrLine = item({
  id: 'line-sgr',
  rawName: 'Garanție SGR',
  quantity: 2,
  unitPrice: 0.5,
  totalPrice: 1,
  vatRate: undefined
});
const validated = ReceiptValidator.validate(receipt([validLine, sgrLine]));
assert.equal(validated.items[0].mathValid, true, 'valid quantity × price is accepted');
assert.equal(validated.items[1].isSgr, true, 'SGR line is detected from its name');
assert.equal(validated.sgrTotal, 1, 'SGR amount is summed separately');
assert.equal(validated.vatTotal, 0.83, 'VAT is calculated from gross taxable amount at 9%');
assert.equal(validated.calculatedTotal, 11, 'calculated total includes SGR');
assert.equal(validated.validationStatus, 'NEEDS_REVIEW', 'printed total mismatch requests review');

const mismatch = ReceiptValidator.validate(receipt([item({ totalPrice: 12 })], { total: 12 }));
assert.equal(mismatch.items[0].mathValid, false, 'line subtotal mismatch is detected');
assert.equal(mismatch.items[0].requiresManualReview, true, 'mismatched line is flagged for manual review');
assert.equal(mismatch.validationStatus, 'NEEDS_REVIEW', 'mismatched receipt requires review');

const lowConfidence = ReceiptValidator.validate(receipt([item({ confidence: 'low' })], { total: 10 }));
assert.equal(lowConfidence.items[0].requiresManualReview, true, 'low OCR confidence flags a line');
console.log('ReceiptValidator tests passed.');
