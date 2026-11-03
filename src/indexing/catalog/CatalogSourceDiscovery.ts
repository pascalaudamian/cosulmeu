// src/indexing/catalog/CatalogSourceDiscovery.ts
// Descoperire automată a cataloagelor publice pentru cei 8 retaileri din România

import * as cheerio from 'cheerio';
import { CatalogSource, CatalogDocument, CatalogFormat } from './catalogTypes';
import { CatalogDownloader } from './CatalogDownloader';

export const INITIAL_CATALOG_SOURCES: CatalogSource[] = [
  {
    id: 'cat-src-lidl',
    retailerId: 'lidl',
    retailerName: 'Lidl România',
    name: 'Catalog Săptămânal Oferte Lidl & Lidl Plus',
    catalogUrl: 'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 7,
    authRequired: false,
    legalStatusNotice: 'Catalog public accesibil online; indexare civică cu respectarea frecvenței de apelare și politețe scraper.'
  },
  {
    id: 'cat-src-kaufland',
    retailerId: 'kaufland',
    retailerName: 'Kaufland România',
    name: 'Revistă Digitală Săptămânală Kaufland',
    catalogUrl: 'https://www.kaufland.ro/oferte/catalog-saptamanal.html',
    format: 'html',
    status: 'pending_authorization',
    updateFrequencyDays: 7,
    authRequired: true,
    legalStatusNotice: 'În curs de validare autorizare acces feed deschis / parteneriat național.'
  },
  {
    id: 'cat-src-carrefour',
    retailerId: 'carrefour',
    retailerName: 'Carrefour România',
    name: 'Cataloage Hipermarket & Promoții Carrefour',
    catalogUrl: 'https://carrefour.ro/cataloage',
    format: 'html',
    status: 'pending_authorization',
    updateFrequencyDays: 7,
    authRequired: true,
    legalStatusNotice: 'În curs de autorizare acces canal oficial de oferte și promoții.'
  },
  {
    id: 'cat-src-penny',
    retailerId: 'penny',
    retailerName: 'Penny România',
    name: 'Pliante și Cataloage Naționale Penny',
    catalogUrl: 'https://www.penny.ro/cataloage',
    format: 'pdf',
    status: 'disabled',
    updateFrequencyDays: 7,
    authRequired: true,
    legalStatusNotice: 'Dezactivat temporar – necesită acord explicit de reutilizare și confirmare format PDF/OCR.'
  },
  {
    id: 'cat-src-auchan',
    retailerId: 'auchan',
    retailerName: 'Auchan România',
    name: 'Cataloage Promoționale Auchan Hipermarket',
    catalogUrl: 'https://www.auchan.ro/cataloage-promotii',
    format: 'html',
    status: 'pending_authorization',
    updateFrequencyDays: 7,
    authRequired: true,
    legalStatusNotice: 'În așteptarea acreditării tehnice pentru integrarea cataloagelor oficiale.'
  },
  {
    id: 'cat-src-profi',
    retailerId: 'profi',
    retailerName: 'Profi Rom Food',
    name: 'Reviste Promoționale Profi Loco & City',
    catalogUrl: 'https://www.profi.ro/reviste-profi/',
    format: 'pdf',
    status: 'disabled',
    updateFrequencyDays: 7,
    authRequired: true,
    legalStatusNotice: 'Dezactivat temporar până la standardizarea distribuției regionale a cataloagelor.'
  },
  {
    id: 'cat-src-mega-image',
    retailerId: 'mega-image',
    retailerName: 'Mega Image',
    name: 'Revista cu Oferte & Promoții Mega Image',
    catalogUrl: 'https://www.mega-image.ro/promotii',
    format: 'html',
    status: 'pending_authorization',
    updateFrequencyDays: 7,
    authRequired: true,
    legalStatusNotice: 'În așteptarea acreditării oficiale de parteneriat.'
  },
  {
    id: 'cat-src-metro',
    retailerId: 'metro',
    retailerName: 'Metro Cash & Carry România',
    name: 'Cataloage Horeca & Gastro Metro',
    catalogUrl: 'https://www.metro.ro/oferte/cataloage',
    format: 'pdf',
    status: 'pending_authorization',
    updateFrequencyDays: 14,
    authRequired: true,
    legalStatusNotice: 'Necesită acord B2B pentru colectarea automată a ofertelor de volum.'
  }
];

export class CatalogSourceDiscovery {
  /**
   * Descoperă documente noi pentru o sursă de catalog
   */
  static async discoverDocumentsForSource(source: CatalogSource): Promise<CatalogDocument[]> {
    if (source.status === 'disabled') {
      return [];
    }

    const discovered: CatalogDocument[] = [];
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split('T')[0];

    // Dacă este sursa activă Lidl
    if (source.retailerId === 'lidl') {
      // Pentru Lidl, pagina săptămânală funcționează ca un document catalog HTML dinamic
      discovered.push({
        id: `doc-lidl-${todayStr}`,
        sourceId: source.id,
        retailerId: 'lidl',
        documentUrl: source.catalogUrl,
        title: `Catalog Săptămânal Lidl (${todayStr})`,
        format: 'html',
        validFrom: todayStr,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso
      });
      return discovered;
    }

    // Pentru alte surse, efectuăm o verificare preliminară dacă sunt active
    const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, { timeoutMs: 8000 });
    if (!downloadRes.ok || !downloadRes.text) {
      return [];
    }

    const $ = cheerio.load(downloadRes.text);
    const pdfLinks: string[] = [];

    $('a[href*=".pdf"], a[href*="catalog"], a[href*="pliant"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.endsWith('.pdf') || href.includes('/catalog/'))) {
        try {
          const absoluteUrl = new URL(href, source.catalogUrl).toString();
          if (!pdfLinks.includes(absoluteUrl)) {
            pdfLinks.push(absoluteUrl);
          }
        } catch {
          // ignore invalid relative url
        }
      }
    });

    for (let i = 0; i < Math.min(3, pdfLinks.length); i++) {
      const docUrl = pdfLinks[i];
      const isPdf = docUrl.endsWith('.pdf');
      discovered.push({
        id: `doc-${source.retailerId}-${todayStr}-${i + 1}`,
        sourceId: source.id,
        retailerId: source.retailerId,
        documentUrl: docUrl,
        title: `Catalog ${source.retailerName} (${todayStr} #${i + 1})`,
        format: isPdf ? 'pdf' : 'html',
        validFrom: todayStr,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso
      });
    }

    return discovered;
  }
}
