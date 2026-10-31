import { Store, Product, ProductOffer, PriceObservation, ShoppingList, Receipt, UserProfile, DataSource, SourceSyncRun, ProductMatchCandidate } from '../types';

export const STORES: Store[] = [
  {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    chain: 'Lidl România',
    brandColor: 'bg-blue-600',
    accentColor: 'text-blue-600',
    type: 'discounter',
    rating: 4.6,
    locationsCount: 350,
    sampleAddress: 'Bd. Iuliu Maniu 111, București',
    isPartner: false
  },
  {
    id: 'kaufland',
    name: 'Kaufland',
    slug: 'kaufland',
    chain: 'Kaufland România',
    brandColor: 'bg-red-600',
    accentColor: 'text-red-600',
    type: 'hypermarket',
    rating: 4.5,
    locationsCount: 180,
    sampleAddress: 'Str. Barbu Văcărescu 120, București',
    isPartner: false
  },
  {
    id: 'carrefour',
    name: 'Carrefour',
    slug: 'carrefour',
    chain: 'Carrefour România',
    brandColor: 'bg-sky-600',
    accentColor: 'text-sky-600',
    type: 'hypermarket',
    rating: 4.4,
    locationsCount: 420,
    sampleAddress: 'Băneasa Shopping City, București',
    isPartner: true
  },
  {
    id: 'penny',
    name: 'Penny',
    slug: 'penny',
    chain: 'Penny România',
    brandColor: 'bg-amber-600',
    accentColor: 'text-amber-600',
    type: 'discounter',
    rating: 4.3,
    locationsCount: 380,
    sampleAddress: 'Șos. Pantelimon 250, București',
    isPartner: false
  },
  {
    id: 'auchan',
    name: 'Auchan',
    slug: 'auchan',
    chain: 'Auchan România',
    brandColor: 'bg-rose-600',
    accentColor: 'text-rose-600',
    type: 'hypermarket',
    rating: 4.3,
    locationsCount: 440,
    sampleAddress: 'Titan Shopping Center, București',
    isPartner: false
  },
  {
    id: 'profi',
    name: 'Profi',
    slug: 'profi',
    chain: 'Profi Rom Food',
    brandColor: 'bg-emerald-700',
    accentColor: 'text-emerald-700',
    type: 'proximity',
    rating: 4.1,
    locationsCount: 1650,
    sampleAddress: 'Str. Baba Novac 16, București',
    isPartner: false
  },
  {
    id: 'mega-image',
    name: 'Mega Image',
    slug: 'mega-image',
    chain: 'Mega Image',
    brandColor: 'bg-red-700',
    accentColor: 'text-red-700',
    type: 'supermarket',
    rating: 4.2,
    locationsCount: 950,
    sampleAddress: 'Piața Romană 9, București',
    isPartner: false
  },
  {
    id: 'metro',
    name: 'Metro Cash & Carry',
    slug: 'metro',
    chain: 'Metro România',
    brandColor: 'bg-yellow-500',
    accentColor: 'text-blue-900',
    type: 'hypermarket',
    rating: 4.4,
    locationsCount: 30,
    sampleAddress: 'Bd. Iuliu Maniu 500, București Militari',
    isPartner: false
  }
];

export const PRODUCTS: Product[] = [
  {
    id: 'prod-lapte-1',
    name: 'Lapte proaspăt 1.5% grăsime 1L',
    brand: 'Napolact',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941014002341',
    isRomanianProduct: true,
    baseReferencePrice: 6.89
  },
  {
    id: 'prod-lapte-pilos',
    name: 'Lapte UHT 1.5% 1L',
    brand: 'Pilos / Marcă proprie',
    category: 'Lactate și ouă',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '20194812',
    baseReferencePrice: 5.29
  },
  {
    id: 'prod-oua-m10',
    name: 'Ouă proaspete M 10 buc',
    brand: 'Toneli / Din Ogradă',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 10,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    barcode: '5941889001221',
    isRomanianProduct: true,
    baseReferencePrice: 11.49
  },
  {
    id: 'prod-telemea-vaca',
    name: 'Telemea de vacă în saramură 350g',
    brand: 'Hochland',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.35,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941234005612',
    baseReferencePrice: 16.99
  },
  {
    id: 'prod-iaurt-grecesc',
    name: 'Iaurt grecesc 10% grăsime 400g',
    brand: 'Olympus',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.4,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5201123498112',
    baseReferencePrice: 7.49
  },
  {
    id: 'prod-unt-82',
    name: 'Unt de masă 82% grăsime 200g',
    brand: 'Albalact',
    category: 'Lactate și ouă',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.2,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941014008912',
    isRomanianProduct: true,
    baseReferencePrice: 12.99
  },
  {
    id: 'prod-paine-toast',
    name: 'Pâine feliată albă Toast 500g',
    brand: 'Vel Pitar',
    category: 'Panificație',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941033001091',
    isRomanianProduct: true,
    baseReferencePrice: 4.89
  },
  {
    id: 'prod-bagheta',
    name: 'Baghetă clasică 250g',
    brand: 'Brutăria Magazinului',
    category: 'Panificație',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.25,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '2000000002501',
    baseReferencePrice: 1.89
  },
  {
    id: 'prod-piept-pui',
    name: 'Piept de pui dezosat fără piele 1kg',
    brand: 'Agricola / CocoRico',
    category: 'Carne și pește',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941199003310',
    isRomanianProduct: true,
    baseReferencePrice: 28.50
  },
  {
    id: 'prod-carne-tocata',
    name: 'Carne tocată amestec porc-vită 500g',
    brand: 'Comtim / Cris-Tim',
    category: 'Carne și pește',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941044007123',
    isRomanianProduct: true,
    baseReferencePrice: 14.50
  },
  {
    id: 'prod-somon-file',
    name: 'File de somon proaspăt 100g (la kg)',
    brand: 'Proaspăt',
    category: 'Carne și pește',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '2800101000000',
    baseReferencePrice: 84.90
  },
  {
    id: 'prod-banane',
    name: 'Banane calitatea I (la kg)',
    brand: 'Import',
    category: 'Fructe și legume',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '2000000004011',
    baseReferencePrice: 6.99
  },
  {
    id: 'prod-cartofi',
    name: 'Cartofi albi de consum (sac 2.5kg)',
    brand: 'România',
    category: 'Fructe și legume',
    defaultUnit: 'kg',
    packageWeightOrVolume: 2.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941022009012',
    isRomanianProduct: true,
    baseReferencePrice: 8.99 // pt sacul de 2.5kg = ~3.60 lei/kg
  },
  {
    id: 'prod-rosii',
    name: 'Roșii ciorchine 1kg',
    brand: 'Origine UE / RO',
    category: 'Fructe și legume',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '2000000004087',
    baseReferencePrice: 9.99
  },
  {
    id: 'prod-mere',
    name: 'Mere Idared românești 1kg',
    brand: 'Livezile Românești',
    category: 'Fructe și legume',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941099008812',
    isRomanianProduct: true,
    baseReferencePrice: 4.89
  },
  {
    id: 'prod-ulei-fl-soarelui',
    name: 'Ulei de floarea-soarelui 1L',
    brand: 'Untdelemn de la Bunica / Spornic',
    category: 'Produse de bază',
    defaultUnit: 'l',
    packageWeightOrVolume: 1,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941031002011',
    isRomanianProduct: true,
    baseReferencePrice: 6.99
  },
  {
    id: 'prod-faina-000',
    name: 'Făină albă de grâu Superioară 000 1kg',
    brand: 'Băneasa',
    category: 'Produse de bază',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941029001123',
    isRomanianProduct: true,
    baseReferencePrice: 3.49
  },
  {
    id: 'prod-zahar-1kg',
    name: 'Zahăr cristal alb 1kg',
    brand: 'Mărgăritar / Diamant',
    category: 'Produse de bază',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '5941045001923',
    baseReferencePrice: 4.39
  },
  {
    id: 'prod-paste-spaghetti',
    name: 'Paste Spaghetti n.5 500g',
    brand: 'Barilla',
    category: 'Produse de bază',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '8076809513753',
    baseReferencePrice: 6.29
  },
  {
    id: 'prod-orez-bob-rotund',
    name: 'Orez cu bob rotund 1kg',
    brand: 'Scotti',
    category: 'Produse de bază',
    defaultUnit: 'kg',
    packageWeightOrVolume: 1,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '8001860181014',
    baseReferencePrice: 7.89
  },
  {
    id: 'prod-apa-borsec',
    name: 'Apă minerală naturală carbogazoasă 2L',
    brand: 'Borsec',
    category: 'Băuturi',
    defaultUnit: 'buc',
    packageWeightOrVolume: 2,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5941005001012',
    isRomanianProduct: true,
    baseReferencePrice: 3.49
  },
  {
    id: 'prod-cafea-jacobs',
    name: 'Cafea măcinată Kronung 500g',
    brand: 'Jacobs',
    category: 'Băuturi',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.5,
    packageUnit: 'kg',
    normalizedUnit: 'kg',
    barcode: '8711000504123',
    baseReferencePrice: 26.50
  },
  {
    id: 'prod-detergent-fairy',
    name: 'Detergent de vase Lemon 800ml',
    brand: 'Fairy',
    category: 'Curățenie',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.8,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '5410076451290',
    baseReferencePrice: 12.99
  },
  {
    id: 'prod-hartie-igienica',
    name: 'Hârtie igienică 3 straturi 8 role',
    brand: 'Zewa Deluxe Pure White',
    category: 'Igienă personală',
    defaultUnit: 'buc',
    packageWeightOrVolume: 8,
    packageUnit: 'buc',
    normalizedUnit: 'buc',
    barcode: '7322540891234',
    baseReferencePrice: 21.90
  },
  {
    id: 'prod-pasta-dinti',
    name: 'Pastă de dinți Total Clean Mint 75ml',
    brand: 'Colgate',
    category: 'Igienă personală',
    defaultUnit: 'buc',
    packageWeightOrVolume: 0.075,
    packageUnit: 'l',
    normalizedUnit: 'l',
    barcode: '8718951239101',
    baseReferencePrice: 13.90
  }
];

export const PRODUCT_OFFERS: ProductOffer[] = [
  // Lapte Napolact 1.5% 1L
  { id: 'off-1', productId: 'prod-lapte-1', storeId: 'lidl', price: 6.49, unitPrice: 6.49, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-2', productId: 'prod-lapte-1', storeId: 'kaufland', price: 6.29, originalPrice: 6.99, unitPrice: 6.29, unitPriceMeasure: 'lei/l', isPromo: true, promoDetails: '-10% Kaufland Card', loyaltyCardRequired: true, loyaltyCardName: 'Kaufland Card', validUntil: '2026-11-05', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-3', productId: 'prod-lapte-1', storeId: 'carrefour', price: 6.89, unitPrice: 6.89, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-4', productId: 'prod-lapte-1', storeId: 'penny', price: 6.39, unitPrice: 6.39, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-5', productId: 'prod-lapte-1', storeId: 'auchan', price: 6.69, unitPrice: 6.69, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-6', productId: 'prod-lapte-1', storeId: 'profi', price: 7.19, unitPrice: 7.19, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-7', productId: 'prod-lapte-1', storeId: 'mega-image', price: 7.49, unitPrice: 7.49, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-26', lastChecked: '2026-10-26' },

  // Ouă M 10 buc
  { id: 'off-8', productId: 'prod-oua-m10', storeId: 'lidl', price: 9.99, unitPrice: 1.00, unitPriceMeasure: 'lei/buc', isPromo: true, promoDetails: 'Super Weekend', validUntil: '2026-11-01', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-9', productId: 'prod-oua-m10', storeId: 'kaufland', price: 10.49, unitPrice: 1.05, unitPriceMeasure: 'lei/buc', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-10', productId: 'prod-oua-m10', storeId: 'carrefour', price: 11.29, unitPrice: 1.13, unitPriceMeasure: 'lei/buc', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-11', productId: 'prod-oua-m10', storeId: 'penny', price: 10.19, unitPrice: 1.02, unitPriceMeasure: 'lei/buc', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-12', productId: 'prod-oua-m10', storeId: 'auchan', price: 10.99, unitPrice: 1.10, unitPriceMeasure: 'lei/buc', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-13', productId: 'prod-oua-m10', storeId: 'profi', price: 11.99, unitPrice: 1.20, unitPriceMeasure: 'lei/buc', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Pâine Vel Pitar Toast 500g
  { id: 'off-14', productId: 'prod-paine-toast', storeId: 'lidl', price: 4.49, unitPrice: 8.98, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-15', productId: 'prod-paine-toast', storeId: 'kaufland', price: 4.69, unitPrice: 9.38, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-16', productId: 'prod-paine-toast', storeId: 'carrefour', price: 4.39, originalPrice: 4.89, unitPrice: 8.78, unitPriceMeasure: 'lei/kg', isPromo: true, promoDetails: 'Top Oferte', validUntil: '2026-10-31', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-17', productId: 'prod-paine-toast', storeId: 'penny', price: 4.59, unitPrice: 9.18, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-18', productId: 'prod-paine-toast', storeId: 'auchan', price: 4.79, unitPrice: 9.58, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-19', productId: 'prod-paine-toast', storeId: 'profi', price: 5.19, unitPrice: 10.38, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Piept de pui dezosat 1kg
  { id: 'off-20', productId: 'prod-piept-pui', storeId: 'lidl', price: 26.90, originalPrice: 29.90, unitPrice: 26.90, unitPriceMeasure: 'lei/kg', isPromo: true, promoDetails: '-10% Lidl Plus', loyaltyCardRequired: true, loyaltyCardName: 'Lidl Plus', validUntil: '2026-11-05', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-21', productId: 'prod-piept-pui', storeId: 'kaufland', price: 27.50, unitPrice: 27.50, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-22', productId: 'prod-piept-pui', storeId: 'carrefour', price: 28.90, unitPrice: 28.90, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-23', productId: 'prod-piept-pui', storeId: 'penny', price: 26.49, unitPrice: 26.49, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-24', productId: 'prod-piept-pui', storeId: 'auchan', price: 28.40, unitPrice: 28.40, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-25', productId: 'prod-piept-pui', storeId: 'profi', price: 30.90, unitPrice: 30.90, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Banane 1kg
  { id: 'off-26', productId: 'prod-banane', storeId: 'lidl', price: 6.49, unitPrice: 6.49, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-27', productId: 'prod-banane', storeId: 'kaufland', price: 5.99, originalPrice: 6.99, unitPrice: 5.99, unitPriceMeasure: 'lei/kg', isPromo: true, promoDetails: 'Săptămâna Fructelor', validUntil: '2026-11-02', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-28', productId: 'prod-banane', storeId: 'carrefour', price: 6.79, unitPrice: 6.79, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-29', productId: 'prod-banane', storeId: 'penny', price: 6.29, unitPrice: 6.29, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-30', productId: 'prod-banane', storeId: 'auchan', price: 6.89, unitPrice: 6.89, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-31', productId: 'prod-banane', storeId: 'profi', price: 7.29, unitPrice: 7.29, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Ulei de floarea-soarelui 1L
  { id: 'off-32', productId: 'prod-ulei-fl-soarelui', storeId: 'lidl', price: 6.29, unitPrice: 6.29, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-33', productId: 'prod-ulei-fl-soarelui', storeId: 'kaufland', price: 5.99, unitPrice: 5.99, unitPriceMeasure: 'lei/l', isPromo: true, promoDetails: 'Preț plafonat/promo', validUntil: '2026-11-15', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-34', productId: 'prod-ulei-fl-soarelui', storeId: 'carrefour', price: 6.59, unitPrice: 6.59, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-35', productId: 'prod-ulei-fl-soarelui', storeId: 'penny', price: 6.19, unitPrice: 6.19, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-36', productId: 'prod-ulei-fl-soarelui', storeId: 'auchan', price: 6.49, unitPrice: 6.49, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Făină 000 1kg Băneasa
  { id: 'off-37', productId: 'prod-faina-000', storeId: 'lidl', price: 3.19, unitPrice: 3.19, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-38', productId: 'prod-faina-000', storeId: 'kaufland', price: 3.09, unitPrice: 3.09, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-39', productId: 'prod-faina-000', storeId: 'carrefour', price: 3.49, unitPrice: 3.49, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-40', productId: 'prod-faina-000', storeId: 'penny', price: 3.15, unitPrice: 3.15, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-41', productId: 'prod-faina-000', storeId: 'auchan', price: 3.29, unitPrice: 3.29, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Apă minerală Borsec 2L
  { id: 'off-42', productId: 'prod-apa-borsec', storeId: 'lidl', price: 3.29, unitPrice: 1.65, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-43', productId: 'prod-apa-borsec', storeId: 'kaufland', price: 3.19, unitPrice: 1.60, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-44', productId: 'prod-apa-borsec', storeId: 'carrefour', price: 3.49, unitPrice: 1.75, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-45', productId: 'prod-apa-borsec', storeId: 'penny', price: 3.25, unitPrice: 1.63, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-46', productId: 'prod-apa-borsec', storeId: 'auchan', price: 3.39, unitPrice: 1.70, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-47', productId: 'prod-apa-borsec', storeId: 'profi', price: 3.79, unitPrice: 1.90, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Detergent vase Fairy 800ml
  { id: 'off-48', productId: 'prod-detergent-fairy', storeId: 'lidl', price: 11.99, unitPrice: 14.99, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-49', productId: 'prod-detergent-fairy', storeId: 'kaufland', price: 11.49, originalPrice: 13.99, unitPrice: 14.36, unitPriceMeasure: 'lei/l', isPromo: true, promoDetails: '-18% Promoție', validUntil: '2026-11-03', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-50', productId: 'prod-detergent-fairy', storeId: 'carrefour', price: 12.89, unitPrice: 16.11, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-51', productId: 'prod-detergent-fairy', storeId: 'penny', price: 11.89, unitPrice: 14.86, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-52', productId: 'prod-detergent-fairy', storeId: 'auchan', price: 12.49, unitPrice: 15.61, unitPriceMeasure: 'lei/l', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Cafea Jacobs 500g
  { id: 'off-53', productId: 'prod-cafea-jacobs', storeId: 'lidl', price: 24.90, unitPrice: 49.80, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-25', lastChecked: '2026-10-25' },
  { id: 'off-54', productId: 'prod-cafea-jacobs', storeId: 'kaufland', price: 23.90, originalPrice: 28.50, unitPrice: 47.80, unitPriceMeasure: 'lei/kg', isPromo: true, promoDetails: 'Reducere cafea', validUntil: '2026-11-04', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-55', productId: 'prod-cafea-jacobs', storeId: 'carrefour', price: 25.90, unitPrice: 51.80, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-56', productId: 'prod-cafea-jacobs', storeId: 'penny', price: 24.49, unitPrice: 48.98, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-23', lastChecked: '2026-10-23' },
  { id: 'off-57', productId: 'prod-cafea-jacobs', storeId: 'auchan', price: 26.20, unitPrice: 52.40, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Telemea Hochland 350g
  { id: 'off-58', productId: 'prod-telemea-vaca', storeId: 'kaufland', price: 15.99, originalPrice: 17.50, unitPrice: 45.69, unitPriceMeasure: 'lei/kg', isPromo: true, promoDetails: 'Ofertă săptămânală', validUntil: '2026-11-02', source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-26', lastChecked: '2026-10-26' },
  { id: 'off-59', productId: 'prod-telemea-vaca', storeId: 'carrefour', price: 16.49, unitPrice: 47.11, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'high', verificationStatus: 'verified', observationDate: '2026-10-24', lastChecked: '2026-10-24' },
  { id: 'off-60', productId: 'prod-telemea-vaca', storeId: 'auchan', price: 16.89, unitPrice: 48.26, unitPriceMeasure: 'lei/kg', isPromo: false, source: 'demo', confidenceLevel: 'medium', verificationStatus: 'demo', observationDate: '2026-10-25', lastChecked: '2026-10-25' },

  // Exemplu de ofertă expirată pentru testarea filtrării
  { id: 'off-expired-1', productId: 'prod-lapte-1', storeId: 'lidl', price: 4.99, originalPrice: 6.49, unitPrice: 4.99, unitPriceMeasure: 'lei/l', isPromo: true, promoDetails: 'Campanie Trecută (Expirată)', validUntil: '2026-09-30', source: 'demo', confidenceLevel: 'high', verificationStatus: 'expired', observationDate: '2026-09-20', lastChecked: '2026-09-30' }
];

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'src-lidl-file',
    name: 'Fișier Oficial Prețuri Lidl (CSV/XML)',
    type: 'official_file',
    status: 'configured_manual',
    storeId: 'lidl',
    format: 'csv',
    lastSyncAt: '2026-10-26T16:30:00Z',
    importedOffersCount: 14,
    errorCount: 0,
    requiresAuth: false,
    description: 'Import structurat din fișierele de prețuri comunicate oficial. Necesită validare de schemă înainte de sincronizare automată.'
  },
  {
    id: 'src-monitorul-preturilor',
    name: 'Monitorul Prețurilor (Consiliul Concurenței)',
    type: 'authorized_api',
    status: 'pending_authorization',
    format: 'api',
    importedOffersCount: 0,
    errorCount: 0,
    requiresAuth: true,
    authDocumentation: 'Accesul oficial la datele deschise sau API ale Monitorului Prețurilor se solicită formal către Consiliul Concurenței României conform Legii 544/2001 și protocolului de interoperabilitate guvernamentală.',
    description: 'Sursa națională autorizată pentru compararea prețurilor din marile rețele de retail din România. Conector pregătit tehnic, dezactivat până la eliberarea cheilor oficiale.'
  },
  {
    id: 'src-affiliate-feed',
    name: 'Feed Parteneri Retail & Afiliere',
    type: 'affiliate_feed',
    status: 'configured_manual',
    format: 'xml',
    lastSyncAt: '2026-10-25T11:00:00Z',
    importedOffersCount: 18,
    errorCount: 0,
    requiresAuth: true,
    description: 'Feed-uri agreate de produse și promoții prin programe oficiale de retailer. Nu influențează ordinea organică a prețurilor mici.'
  },
  {
    id: 'src-verified-receipts',
    name: 'Observații Verificate din Bonuri Fiscale',
    type: 'verified_receipts',
    status: 'active',
    format: 'json',
    lastSyncAt: '2026-10-26T18:00:00Z',
    importedOffersCount: 22,
    errorCount: 0,
    requiresAuth: false,
    description: 'Prețuri extrase direct din bonurile fiscale românești confirmate de utilizatori, cu trasabilitate completă.'
  }
];

export const INITIAL_SYNC_RUNS: SourceSyncRun[] = [
  {
    id: 'sync-001',
    sourceId: 'src-lidl-file',
    sourceName: 'Fișier Oficial Prețuri Lidl (CSV/XML)',
    startedAt: '2026-10-26T16:29:40Z',
    completedAt: '2026-10-26T16:30:00Z',
    status: 'success',
    recordsProcessed: 14,
    recordsImported: 14,
    duplicatesFound: 0,
    invalidRecords: 0,
    errors: [],
    summary: 'Importat cu succes 14 oferte validate conform schemei CSV standard.'
  },
  {
    id: 'sync-002',
    sourceId: 'src-verified-receipts',
    sourceName: 'Observații Verificate din Bonuri Fiscale',
    startedAt: '2026-10-26T17:59:50Z',
    completedAt: '2026-10-26T18:00:00Z',
    status: 'success',
    recordsProcessed: 8,
    recordsImported: 8,
    duplicatesFound: 0,
    invalidRecords: 0,
    errors: [],
    summary: 'Sincronizate 8 observații de preț din bonurile Kaufland și Lidl confirmate.'
  }
];

export const INITIAL_MATCH_CANDIDATES: ProductMatchCandidate[] = [
  {
    id: 'match-1',
    sourceRawName: 'LAPTE PROASPAT 1.5% 1L CUTIE NAPOLACT',
    sourceBarcode: '5941014002341',
    sourceBrand: 'Napolact',
    sourcePackageWeightOrVolume: 1,
    sourcePackageUnit: 'l',
    matchedProductId: 'prod-lapte-1',
    matchedProductName: 'Lapte proaspăt 1.5% grăsime 1L',
    confidenceScore: 0.98,
    matchMethod: 'gtin_exact',
    status: 'auto_approved',
    createdAt: '2026-10-26T12:00:00Z'
  },
  {
    id: 'match-2',
    sourceRawName: 'OUA PROASPETE CLASA M 10 BUC TONELI',
    sourceBarcode: '5941889001221',
    sourceBrand: 'Toneli',
    sourcePackageWeightOrVolume: 10,
    sourcePackageUnit: 'buc',
    matchedProductId: 'prod-oua-m10',
    matchedProductName: 'Ouă proaspete M 10 buc',
    confidenceScore: 0.95,
    matchMethod: 'gtin_exact',
    status: 'auto_approved',
    createdAt: '2026-10-26T12:00:00Z'
  },
  {
    id: 'match-3',
    sourceRawName: 'PIEPT PUI DEZOSAT AGRICOLA RO CASEROLA',
    sourceBrand: 'Agricola',
    sourcePackageWeightOrVolume: 1,
    sourcePackageUnit: 'kg',
    matchedProductId: 'prod-piept-pui',
    matchedProductName: 'Piept de pui dezosat fără piele 1kg',
    confidenceScore: 0.82,
    matchMethod: 'name_brand_similarity',
    status: 'pending_confirmation',
    createdAt: '2026-10-26T14:30:00Z'
  }
];

export const PRICE_OBSERVATIONS: PriceObservation[] = [
  // Lapte Napolact 1L across time
  { id: 'obs-1', productId: 'prod-lapte-1', storeId: 'kaufland', price: 6.99, date: '2026-08-15', source: 'verified' },
  { id: 'obs-2', productId: 'prod-lapte-1', storeId: 'lidl', price: 6.79, date: '2026-08-28', source: 'verified' },
  { id: 'obs-3', productId: 'prod-lapte-1', storeId: 'kaufland', price: 6.49, date: '2026-09-10', source: 'verified' },
  { id: 'obs-4', productId: 'prod-lapte-1', storeId: 'carrefour', price: 6.99, date: '2026-09-22', source: 'verified' },
  { id: 'obs-5', productId: 'prod-lapte-1', storeId: 'lidl', price: 6.49, date: '2026-10-05', source: 'verified' },
  { id: 'obs-6', productId: 'prod-lapte-1', storeId: 'kaufland', price: 6.29, date: '2026-10-26', source: 'verified' },

  // Piept pui dezosat 1kg across time
  { id: 'obs-7', productId: 'prod-piept-pui', storeId: 'kaufland', price: 29.90, date: '2026-08-10', source: 'verified' },
  { id: 'obs-8', productId: 'prod-piept-pui', storeId: 'lidl', price: 28.50, date: '2026-08-25', source: 'verified' },
  { id: 'obs-9', productId: 'prod-piept-pui', storeId: 'carrefour', price: 30.90, date: '2026-09-12', source: 'verified' },
  { id: 'obs-10', productId: 'prod-piept-pui', storeId: 'penny', price: 27.90, date: '2026-09-29', source: 'verified' },
  { id: 'obs-11', productId: 'prod-piept-pui', storeId: 'lidl', price: 26.90, date: '2026-10-25', source: 'verified' },

  // Ouă M 10 buc across time
  { id: 'obs-12', productId: 'prod-oua-m10', storeId: 'lidl', price: 11.20, date: '2026-08-05', source: 'verified' },
  { id: 'obs-13', productId: 'prod-oua-m10', storeId: 'kaufland', price: 10.99, date: '2026-08-20', source: 'verified' },
  { id: 'obs-14', productId: 'prod-oua-m10', storeId: 'carrefour', price: 11.50, date: '2026-09-15', source: 'verified' },
  { id: 'obs-15', productId: 'prod-oua-m10', storeId: 'lidl', price: 9.99, date: '2026-10-25', source: 'verified' },

  // Ulei 1L across time
  { id: 'obs-16', productId: 'prod-ulei-fl-soarelui', storeId: 'kaufland', price: 7.29, date: '2026-08-12', source: 'verified' },
  { id: 'obs-17', productId: 'prod-ulei-fl-soarelui', storeId: 'lidl', price: 6.89, date: '2026-09-01', source: 'verified' },
  { id: 'obs-18', productId: 'prod-ulei-fl-soarelui', storeId: 'kaufland', price: 5.99, date: '2026-10-26', source: 'verified' }
];

export const INITIAL_SHOPPING_LISTS: ShoppingList[] = [
  {
    id: 'list-default',
    name: 'Cumpărături Săptămânale',
    createdAt: '2026-10-24T10:00:00Z',
    updatedAt: '2026-10-26T18:30:00Z',
    items: [
      {
        id: 'item-1',
        productId: 'prod-lapte-1',
        name: 'Lapte proaspăt 1.5% grăsime 1L',
        brand: 'Napolact',
        category: 'Lactate și ouă',
        quantity: 2,
        unit: 'l',
        checked: false,
        referencePrice: 6.89,
        estimatedPrice: 6.29
      },
      {
        id: 'item-2',
        productId: 'prod-oua-m10',
        name: 'Ouă proaspete M 10 buc',
        brand: 'Toneli / Din Ogradă',
        category: 'Lactate și ouă',
        quantity: 1,
        unit: 'buc',
        checked: false,
        referencePrice: 11.49,
        estimatedPrice: 9.99
      },
      {
        id: 'item-3',
        productId: 'prod-paine-toast',
        name: 'Pâine feliată albă Toast 500g',
        brand: 'Vel Pitar',
        category: 'Panificație',
        quantity: 1,
        unit: 'buc',
        checked: false,
        referencePrice: 4.89,
        estimatedPrice: 4.49
      },
      {
        id: 'item-4',
        productId: 'prod-piept-pui',
        name: 'Piept de pui dezosat fără piele 1kg',
        brand: 'Agricola / CocoRico',
        category: 'Carne și pește',
        quantity: 1.5,
        unit: 'kg',
        checked: false,
        referencePrice: 28.50,
        estimatedPrice: 26.90
      },
      {
        id: 'item-5',
        productId: 'prod-banane',
        name: 'Banane calitatea I (la kg)',
        brand: 'Import',
        category: 'Fructe și legume',
        quantity: 1.8,
        unit: 'kg',
        checked: false,
        referencePrice: 6.99,
        estimatedPrice: 5.99
      },
      {
        id: 'item-6',
        productId: 'prod-detergent-fairy',
        name: 'Detergent de vase Lemon 800ml',
        brand: 'Fairy',
        category: 'Curățenie',
        quantity: 1,
        unit: 'buc',
        checked: false,
        referencePrice: 12.99,
        estimatedPrice: 11.49
      }
    ]
  },
  {
    id: 'list-curatenie',
    name: 'Curățenie & Igienă Casă',
    createdAt: '2026-10-20T14:15:00Z',
    updatedAt: '2026-10-22T09:00:00Z',
    items: [
      {
        id: 'item-c1',
        productId: 'prod-detergent-fairy',
        name: 'Detergent de vase Lemon 800ml',
        brand: 'Fairy',
        category: 'Curățenie',
        quantity: 2,
        unit: 'buc',
        checked: true,
        referencePrice: 12.99,
        estimatedPrice: 11.49
      },
      {
        id: 'item-c2',
        productId: 'prod-hartie-igienica',
        name: 'Hârtie igienică 3 straturi 8 role',
        brand: 'Zewa Deluxe Pure White',
        category: 'Igienă personală',
        quantity: 1,
        unit: 'buc',
        checked: false,
        referencePrice: 21.90,
        estimatedPrice: 19.90
      }
    ]
  }
];

export const SAMPLE_RECEIPTS: Receipt[] = [
  {
    id: 'rec-kaufland-102',
    storeId: 'kaufland',
    storeName: 'Kaufland România',
    storeAddress: 'Str. Barbu Văcărescu 120, București',
    fiscalNumber: 'RO1599110 / BF 0042',
    date: '2026-10-22',
    time: '17:42',
    currency: 'RON',
    verifiedStatus: 'confirmed',
    createdAt: '2026-10-22T17:45:00Z',
    items: [
      {
        id: 'ri-1',
        rawName: 'LAPTE NAPOLACT 1.5% 1L',
        matchedProductId: 'prod-lapte-1',
        matchedProductName: 'Lapte proaspăt 1.5% grăsime 1L',
        quantity: 2,
        unitPrice: 6.49,
        totalPrice: 12.98,
        discount: 0,
        vatRate: 9,
        confidence: 'high',
        category: 'Lactate și ouă'
      },
      {
        id: 'ri-2',
        rawName: 'OUA PROASPETE TONELI M10',
        matchedProductId: 'prod-oua-m10',
        matchedProductName: 'Ouă proaspete M 10 buc',
        quantity: 1,
        unitPrice: 10.49,
        totalPrice: 10.49,
        discount: 1.00,
        vatRate: 9,
        confidence: 'high',
        category: 'Lactate și ouă'
      },
      {
        id: 'ri-3',
        rawName: 'PAINE VEL PITAR TOAST 500G',
        matchedProductId: 'prod-paine-toast',
        matchedProductName: 'Pâine feliată albă Toast 500g',
        quantity: 1,
        unitPrice: 4.69,
        totalPrice: 4.69,
        discount: 0,
        vatRate: 9,
        confidence: 'high',
        category: 'Panificație'
      },
      {
        id: 'ri-4',
        rawName: 'BANANE CAL. I (KG)',
        matchedProductId: 'prod-banane',
        matchedProductName: 'Banane calitatea I (la kg)',
        quantity: 1.42,
        unitPrice: 5.99,
        totalPrice: 8.51,
        discount: 0,
        vatRate: 9,
        confidence: 'high',
        category: 'Fructe și legume'
      },
      {
        id: 'ri-5',
        rawName: 'FAIRY LEMON VASE 800ML',
        matchedProductId: 'prod-detergent-fairy',
        matchedProductName: 'Detergent de vase Lemon 800ml',
        quantity: 1,
        unitPrice: 11.49,
        totalPrice: 11.49,
        discount: 2.50,
        vatRate: 19,
        confidence: 'high',
        category: 'Curățenie'
      }
    ],
    subtotal: 48.16,
    discountTotal: 3.50,
    total: 44.66
  },
  {
    id: 'rec-lidl-089',
    storeId: 'lidl',
    storeName: 'Lidl Discount',
    storeAddress: 'Bd. Timișoara 26, București',
    fiscalNumber: 'RO2289123 / BF 0189',
    date: '2026-10-18',
    time: '11:15',
    currency: 'RON',
    verifiedStatus: 'confirmed',
    createdAt: '2026-10-18T11:20:00Z',
    items: [
      {
        id: 'ri-l1',
        rawName: 'PILOS LAPTE UHT 1.5% 1L',
        matchedProductId: 'prod-lapte-pilos',
        matchedProductName: 'Lapte UHT 1.5% 1L',
        quantity: 4,
        unitPrice: 5.29,
        totalPrice: 21.16,
        discount: 0,
        vatRate: 9,
        confidence: 'high',
        category: 'Lactate și ouă'
      },
      {
        id: 'ri-l2',
        rawName: 'PIEPT PUI DEZOSAT 1KG',
        matchedProductId: 'prod-piept-pui',
        matchedProductName: 'Piept de pui dezosat fără piele 1kg',
        quantity: 1.25,
        unitPrice: 26.90,
        totalPrice: 33.62,
        discount: 3.36,
        vatRate: 9,
        confidence: 'high',
        category: 'Carne și pește'
      },
      {
        id: 'ri-l3',
        rawName: 'APA MINERALA BORSEC 2L',
        matchedProductId: 'prod-apa-borsec',
        matchedProductName: 'Apă minerală naturală carbogazoasă 2L',
        quantity: 3,
        unitPrice: 3.29,
        totalPrice: 9.87,
        discount: 0,
        vatRate: 9,
        confidence: 'high',
        category: 'Băuturi'
      }
    ],
    subtotal: 64.65,
    discountTotal: 3.36,
    total: 61.29
  }
];

export const INITIAL_USER_PROFILE: UserProfile = {
  name: 'Ștefan P.',
  email: 'pascalau.stefan@gmail.com',
  city: 'București (Sector 3)',
  preferredStores: ['lidl', 'kaufland', 'carrefour', 'penny'],
  monthlySavingsGoal: 300,
  notificationsEnabled: true,
  defaultTransportCostEstimate: 6.00, // RON
  useLoyaltyCards: true
};

export const ROMANIAN_CITIES = [
  'București (Sector 1)',
  'București (Sector 2)',
  'București (Sector 3)',
  'București (Sector 4)',
  'București (Sector 5)',
  'București (Sector 6)',
  'Cluj-Napoca',
  'Timișoara',
  'Iași',
  'Brașov',
  'Constanța',
  'Craiova',
  'Sibiu',
  'Oradea',
  'Ploiești',
  'Galați'
];
