// src/indexing/catalog/initialCatalogSources.ts
// Configurația statică inițială a surselor de cataloage (browser-safe, fără dependențe Node.js)

import { CatalogSource } from './catalogTypes.js';

export const INITIAL_CATALOG_SOURCES: CatalogSource[] = [
  {
    id: 'cat-src-lidl',
    retailerId: 'lidl',
    retailerName: 'Lidl România',
    name: 'Cataloage & Reviste Online Lidl',
    catalogUrl: 'https://www.lidl.ro/c/cataloage-online/s10019911',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Catalog online oficial săptămânal și campanii tematice Lidl Plus; extragere publică transparentă.'
  },
  {
    id: 'cat-src-kaufland',
    retailerId: 'kaufland',
    retailerName: 'Kaufland România',
    name: 'Cataloage cu Reduceri & Reviste Promoționale Kaufland',
    catalogUrl: 'https://www.kaufland.ro/cataloage-cu-reduceri.html',
    format: 'pdf',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Catalog oficial săptămânal PDF descărcabil din portalul Kaufland România / rețeaua CDN Schwarz.'
  },
  {
    id: 'cat-src-carrefour',
    retailerId: 'carrefour',
    retailerName: 'Carrefour România',
    name: 'Cataloage Promoționale Carrefour Market & Hipermarket',
    catalogUrl: 'https://carrefour.ro/corporate/cataloage?tip=market',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Hub oficial de cataloage și oferte săptămânale Carrefour Market; extragere produse promoționale din portalul web.'
  },
  {
    id: 'cat-src-penny',
    retailerId: 'penny',
    retailerName: 'Penny România',
    name: 'Pliante Săptămânale & Oferte PENNY Card',
    catalogUrl: 'https://www.penny.ro/vezi-pliantele-saptamanii',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Pliante săptămânale oficiale și catalog de oferte PENNY cu diferențiere preț standard vs. preț cu PENNY Card.'
  },
  {
    id: 'cat-src-auchan',
    retailerId: 'auchan',
    retailerName: 'Auchan România',
    name: 'Magazin Online Oficial & Promoții Auchan',
    catalogUrl: 'https://www.auchan.ro/cataloagele-auchan',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 1,
    authRequired: false,
    legalStatusNotice: 'Magazin online oficial și catalog săptămânal de promoții Auchan România; extragere publică transparentă cu diferențiere oferte MyCLUB.'
  },
  {
    id: 'cat-src-auchan-cataloage',
    retailerId: 'auchan',
    retailerName: 'Auchan România',
    name: 'Catalog Auchan – Cataloagele Auchan',
    catalogUrl: 'https://www.auchan.ro/cataloagele-auchan',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Sursă oficială secundară păstrată activă pentru cataloagele digitale Auchan și ofertele descărcabile.'
  },
  {
    id: 'cat-src-auchan-catalog',
    retailerId: 'auchan',
    retailerName: 'Auchan România',
    name: 'Auchan – Catalogul & Revistele Digitale',
    catalogUrl: 'https://www.auchan.ro/cataloagele-auchan/catalog-auchan',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Cataloage și reviste promoționale digitale oficiale Auchan România; extragere publică transparentă oferte.'
  },
  {
    id: 'cat-src-profi',
    retailerId: 'profi',
    retailerName: 'Profi Rom Food',
    name: 'Reviste Promoționale Profi Loco & City',
    catalogUrl: 'https://www.profi.ro/reviste-ro/',
    format: 'pdf',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Sursă activată pentru importul catalogului public Profi Rom Food; respectă limitele de acces și termenii publicați.'
  },
  {
    id: 'cat-src-mega-image',
    retailerId: 'mega-image',
    retailerName: 'Mega Image',
    name: 'Reviste Promo Online & Catalog Lunar Mega Image',
    catalogUrl: 'https://www.mega-image.ro/promotii-online/reviste-promo-online/revista-promo',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Reviste promoționale și catalog lunar distribuite public prin platforma de publicații online Publitas.'
  },
  {
    id: 'cat-src-mega-image-revista',
    retailerId: 'mega-image',
    retailerName: 'Mega Image',
    name: 'Mega Image – Revista Promo Curentă',
    catalogUrl: 'https://www.mega-image.ro/promotii-online/reviste-promo-online/revista-promo',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Revista promoțională curentă Mega Image cu diferențiere oferte Card Connect.'
  },
  {
    id: 'cat-src-metro',
    retailerId: 'metro',
    retailerName: 'Metro Cash & Carry România',
    name: 'Cataloage Metro HoReCa & Revânzători',
    catalogUrl: 'https://www.metro.ro/cataloagele-metro',
    format: 'pdf',
    status: 'active',
    updateFrequencyDays: 14,
    authRequired: false,
    legalStatusNotice: 'Sursă activată pentru importul catalogului public Metro Cash & Carry România; respectă limitele de acces și termenii publicați.'
  }
];
