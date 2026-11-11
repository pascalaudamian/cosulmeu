import assert from 'node:assert/strict';
import type { Product } from '../src/types.js';
import { ProductMatcher } from '../src/services/ProductMatcher.js';
import { StorageService } from '../src/services/StorageService.js';

StorageService.resetAllData();

const persistedProduct = {
  ...StorageService.getAllProducts()[0],
  id: 'persisted-product-284g',
  name: 'Gem cireșe negre 284g',
  brand: 'Marcă Magazin',
  packageWeightOrVolume: 284,
  packageUnit: 'g'
} as Product;

const match = ProductMatcher.matchProduct({
  rawName: persistedProduct.name,
  brand: persistedProduct.brand,
  packageWeightOrVolume: persistedProduct.packageWeightOrVolume,
  packageUnit: persistedProduct.packageUnit
}, [persistedProduct]);

assert.equal(match.matchedProduct?.id, persistedProduct.id);

const samePriceEvents = [
  {
    id: 'identity-test-event-1',
    productId: 'identity-test-product',
    storeId: 'lidl',
    price: 2.5,
    date: '2026-11-11',
    source: 'official_feed' as const
  },
  {
    id: 'identity-test-event-2',
    productId: 'identity-test-product',
    storeId: 'lidl',
    price: 2.5,
    date: '2026-11-11',
    source: 'official_feed' as const
  }
];

assert.equal(StorageService.addPriceObservations(samePriceEvents), 2);
assert.equal(
  StorageService.getPriceObservations().filter(event => event.productId === 'identity-test-product').length,
  2
);

console.log('Product identity and repeated-price history tests passed.');
