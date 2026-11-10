import { Store, Product, ProductOffer, PriceObservation, ShoppingList, Receipt, UserProfile, DataSource, SourceSyncRun, ProductMatchCandidate } from '../types.js';

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

export const PRODUCT_OFFERS: ProductOffer[] = [];

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

export const INITIAL_SYNC_RUNS: SourceSyncRun[] = [];

export const INITIAL_MATCH_CANDIDATES: ProductMatchCandidate[] = [];

export const PRICE_OBSERVATIONS: PriceObservation[] = [];

export const INITIAL_SHOPPING_LISTS: ShoppingList[] = [];

export const SAMPLE_RECEIPTS: Receipt[] = [];

export const INITIAL_USER_PROFILE: UserProfile = {
  name: 'Utilizator',
  email: '',
  city: 'București',
  preferredStores: [],
  monthlySavingsGoal: 0,
  notificationsEnabled: false,
  defaultTransportCostEstimate: 0,
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
