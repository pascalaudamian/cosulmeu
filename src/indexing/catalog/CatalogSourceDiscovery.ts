// src/indexing/catalog/CatalogSourceDiscovery.ts
// Descoperire automată a cataloagelor publice pentru retailerii din România

import * as cheerio from 'cheerio';
import { CatalogSource, CatalogDocument, CatalogFormat } from './catalogTypes.js';
import { CatalogDownloader } from './CatalogDownloader.js';
import { STORES } from '../../data/mockData.js';

import { INITIAL_CATALOG_SOURCES } from './initialCatalogSources.js';

export { INITIAL_CATALOG_SOURCES };

export const RETAILER_WEB_FALLBACK_URLS: Record<string, string[]> = {
  lidl: [
    'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219',
    'https://www.lidl.ro'
  ],
  kaufland: [
    'https://www.kaufland.ro/oferte/oferte-saptamanale.html',
    'https://www.kaufland.ro/oferte/oferte-curente.html',
    'https://www.kaufland.ro'
  ],
  carrefour: [
    'https://carrefour.ro/campanii/oferte-saptamanale',
    'https://www.carrefour.ro/supermarket-online',
    'https://www.carrefour.ro'
  ],
  penny: [
    'https://www.penny.ro/oferte',
    'https://www.penny.ro'
  ],
  auchan: [
    'https://www.auchan.ro/promotii',
    'https://www.auchan.ro/',
    'https://www.auchan.ro/oferte-si-promotii-cataloage'
  ],
  profi: [
    'https://www.profi.ro/oferte/',
    'https://www.profi.ro/reviste-ro/',
    'https://www.profi.ro'
  ],
  'mega-image': [
    'https://www.mega-image.ro/Mega-Promotia-Saptamanii/c/7_newcateg',
    'https://www.mega-image.ro/oferte',
    'https://www.mega-image.ro'
  ],
  metro: [
    'https://www.metro.ro/oferte',
    'https://www.metro.ro/cataloagele-metro',
    'https://www.metro.ro'
  ],
  selgros: [
    'https://www.selgros.ro/oferte',
    'https://www.selgros.ro'
  ],
  supeco: [
    'https://www.supeco.ro/cataloage',
    'https://www.supeco.ro'
  ],
  'la-cocos': [
    'https://lacocos.ro/oferte',
    'https://lacocos.ro'
  ],
  cora: [
    'https://carrefour.ro/campanii/oferte-saptamanale',
    'https://www.carrefour.ro'
  ],
  freshful: [
    'https://www.freshful.ro/oferte',
    'https://www.freshful.ro'
  ],
  sezamo: [
    'https://www.sezamo.ro/oferte',
    'https://www.sezamo.ro'
  ],
  diana: ['https://magazinelediana.ro'],
  anabella: ['https://anabella.ro'],
  unicarm: ['https://www.unicarm.ro'],
  remarkt: ['https://remarkt.ro']
};

export class CatalogSourceDiscovery {
  /**
   * Returnează lista de URL-uri web oficiale de rezervă (pagina de oferte / site oficial)
   * utilizate când catalogul dedicat PDF/pliant este indisponibil.
   */
  static getRetailerWebFallbackUrls(
    retailerId: string,
    storeWebsiteUrl?: string,
    excludeUrls: string[] = []
  ): string[] {
    const storeFallback = STORES.find(s => s.id === retailerId);
    const knownUrls = RETAILER_WEB_FALLBACK_URLS[retailerId] || [];
    const candidates = [
      ...knownUrls,
      storeWebsiteUrl,
      storeFallback?.officialUrl,
      storeFallback?.websiteUrl
    ].filter((u): u is string => Boolean(u && typeof u === 'string' && u.trim().startsWith('http')));

    const excluded = new Set(excludeUrls.map(u => u.trim().replace(/\/+$/, '')));
    const unique: string[] = [];
    const seen = new Set<string>();

    for (const rawUrl of candidates) {
      const normalized = rawUrl.trim().replace(/\/+$/, '');
      if (excluded.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(rawUrl.trim());
    }

    return unique;
  }

  private static appendUniqueDoc(
    discovered: CatalogDocument[],
    doc: CatalogDocument
  ): void {
    const normalized = doc.documentUrl.trim().replace(/\/+$/, '');
    if (discovered.some(d => d.documentUrl.trim().replace(/\/+$/, '') === normalized)) {
      return;
    }
    discovered.push(doc);
  }

  private static appendWebFallbackDocuments(
    discovered: CatalogDocument[],
    source: CatalogSource,
    websiteUrl: string | undefined,
    todayStr: string,
    nowIso: string
  ): void {
    const webUrls = this.getRetailerWebFallbackUrls(source.retailerId, websiteUrl);
    webUrls.forEach((webUrl, idx) => {
      const isHomepage = /^https?:\/\/[^/]+\/?$/i.test(webUrl);
      this.appendUniqueDoc(discovered, {
        id: `doc-${source.retailerId}-web-${idx + 1}-${todayStr}`,
        sourceId: source.id,
        retailerId: source.retailerId,
        documentUrl: webUrl,
        title: isHomepage
          ? `Pagină Web Oficială ${source.retailerName} (Fallback Web ${todayStr})`
          : `Oferte Web Oficiale ${source.retailerName} (${todayStr})`,
        format: 'html',
        validFrom: todayStr,
        targetAudience: 'general',
        sourcePageUrl: source.catalogUrl || webUrl,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso
      });
    });
  }

  /**
   * Descoperă documente noi pentru o sursă de catalog oficială.
   * Dacă pagina sau catalogul dedicat este indisponibil, include automat paginile web oficiale ale retailerului.
   */
  static async discoverDocumentsForSource(
    source: CatalogSource,
    options?: { websiteUrl?: string }
  ): Promise<CatalogDocument[]> {
    if (source.status === 'disabled') {
      return [];
    }

    const discovered: CatalogDocument[] = [];
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split('T')[0];
    const storeRecord = STORES.find(s => s.id === source.retailerId);
    const websiteUrl = options?.websiteUrl || storeRecord?.officialUrl || storeRecord?.websiteUrl;
    const additionalAllowedDomains: string[] = [];

    if (websiteUrl) {
      try {
        additionalAllowedDomains.push(new URL(websiteUrl).hostname.replace(/^www\./, ''));
      } catch {}
    }

    // -------------------------------------------------------------------------
    // 1. LIDL ROMÂNIA
    // -------------------------------------------------------------------------
    if (source.retailerId === 'lidl') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, {
          timeoutMs: 12000,
          additionalAllowedDomains
        });
        if (downloadRes.ok && downloadRes.text) {
          const flyerLinks: { url: string; slug: string }[] = [];
          const regex = /href="([^"]*\/cataloage\/([^"\/]+)\/ar\/0)"/g;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(downloadRes.text)) !== null) {
            const slug = m[2];
            if (!slug.includes('nota-de-informare') && !slug.includes('serviciul-clien')) {
              flyerLinks.push({ url: m[1], slug });
            }
          }

          for (let i = 0; i < Math.min(2, flyerLinks.length); i++) {
            const flyer = flyerLinks[i];
            const flyerApiUrl = `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${flyer.slug}`;
            try {
              const apiRes = await fetch(flyerApiUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
              });
              if (apiRes.ok) {
                const flyerData = await apiRes.json();
                const f = flyerData.flyer;
                const pdfUrl = f?.pdfUrl || f?.hiResPdfUrl;
                const validFrom = f?.startDate || todayStr;
                const validUntil = f?.endDate || undefined;
                const title = f?.title ? `Catalog Lidl: ${f.title}` : `Catalog Săptămânal Lidl (${flyer.slug})`;

                this.appendUniqueDoc(discovered, {
                  id: `doc-lidl-${flyer.slug}`,
                  sourceId: source.id,
                  retailerId: 'lidl',
                  documentUrl: pdfUrl || flyer.url,
                  title,
                  format: pdfUrl ? 'pdf' : 'html',
                  validFrom,
                  validUntil,
                  targetAudience: 'general',
                  sourcePageUrl: source.catalogUrl,
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
            } catch {
              // Fallback la URL-ul web al catalogului
            }
          }
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Lidl:', err.message);
      }

      // Adăugăm și pagina activă cu ofertele săptămânale curente + fallback web
      this.appendUniqueDoc(discovered, {
        id: `doc-lidl-live-${todayStr}`,
        sourceId: source.id,
        retailerId: 'lidl',
        documentUrl: 'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219',
        title: `Oferte Săptămânale Lidl & Lidl Plus (${todayStr})`,
        format: 'html',
        validFrom: todayStr,
        targetAudience: 'general',
        sourcePageUrl: source.catalogUrl,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso
      });
      this.appendWebFallbackDocuments(discovered, source, websiteUrl, todayStr, nowIso);
      return discovered;
    }

    // -------------------------------------------------------------------------
    // 2. KAUFLAND ROMÂNIA
    // -------------------------------------------------------------------------
    if (source.retailerId === 'kaufland') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, {
          timeoutMs: 12000,
          additionalAllowedDomains
        });
        if (downloadRes.ok && downloadRes.text) {
          const pdfMatches = downloadRes.text.match(/https?:\/\/[^\s"'<>]+\.pdf/gi) || [];
          const uniquePdfLinks = [...new Set(pdfMatches)].filter(u =>
            u.includes('leaflets.schwarz') || u.includes('kaufland')
          );

          for (let i = 0; i < Math.min(2, uniquePdfLinks.length); i++) {
            const mainPdfUrl = uniquePdfLinks[i];
            const isNonfood = mainPdfUrl.toLowerCase().includes('nonfood');
            const title = isNonfood
              ? `Catalog Kaufland Non-Food PDF (${todayStr})`
              : `Revistă Săptămânală Kaufland PDF (${todayStr} #${i + 1})`;

            this.appendUniqueDoc(discovered, {
              id: `doc-kaufland-${todayStr}-${i + 1}`,
              sourceId: source.id,
              retailerId: 'kaufland',
              documentUrl: mainPdfUrl,
              title,
              format: 'pdf',
              validFrom: todayStr,
              targetAudience: 'general',
              sourcePageUrl: source.catalogUrl,
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
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Kaufland:', err.message);
      }

      // Include întotdeauna paginile web de oferte/site oficial ca rezervă când PDF-ul lipsește sau e blocat
      this.appendWebFallbackDocuments(discovered, source, websiteUrl, todayStr, nowIso);
      return discovered;
    }

    // -------------------------------------------------------------------------
    // 3. CARREFOUR ROMÂNIA
    // -------------------------------------------------------------------------
    if (source.retailerId === 'carrefour') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, {
          timeoutMs: 12000,
          additionalAllowedDomains
        });
        if (downloadRes.ok && downloadRes.text) {
          const $ = cheerio.load(downloadRes.text);
          const campaignLinks: { url: string; title: string }[] = [];

          $('.catalogues-items a').each((_, el) => {
            const href = $(el).attr('href');
            const imgAlt = $(el).find('img').attr('alt') || 'Catalog Carrefour';
            if (href && href.startsWith('http')) {
              campaignLinks.push({ url: href, title: imgAlt });
            }
          });

          for (const camp of campaignLinks.slice(0, 2)) {
            if (!camp.url.includes('oferte-saptamanale') && !camp.url.includes('catalogsearch')) {
              this.appendUniqueDoc(discovered, {
                id: `doc-carrefour-camp-${todayStr}-${camp.title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15)}`,
                sourceId: source.id,
                retailerId: 'carrefour',
                documentUrl: camp.url,
                title: `Campanie Carrefour: ${camp.title}`,
                format: 'html',
                validFrom: todayStr,
                storeOrRegion: 'Carrefour Market & Online',
                targetAudience: 'general',
                sourcePageUrl: source.catalogUrl,
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
          }
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Carrefour:', err.message);
      }

      // Adăugăm pagina principală de oferte săptămânale și fallback-ul pe site-ul oficial Carrefour
      this.appendUniqueDoc(discovered, {
        id: `doc-carrefour-market-${todayStr}`,
        sourceId: source.id,
        retailerId: 'carrefour',
        documentUrl: 'https://carrefour.ro/campanii/oferte-saptamanale',
        title: `Catalog Carrefour Market: Ofertele Săptămânii (${todayStr})`,
        format: 'html',
        validFrom: todayStr,
        storeOrRegion: 'Carrefour Market',
        targetAudience: 'general',
        sourcePageUrl: source.catalogUrl,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso
      });
      this.appendWebFallbackDocuments(discovered, source, websiteUrl, todayStr, nowIso);
      return discovered;
    }

    // -------------------------------------------------------------------------
    // 4. PENNY ROMÂNIA
    // -------------------------------------------------------------------------
    if (source.retailerId === 'penny') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, {
          timeoutMs: 12000,
          additionalAllowedDomains
        });
        if (downloadRes.ok && downloadRes.text) {
          const reweMatches = downloadRes.text.match(/https:\/\/files\.rewe\.co\.at\/PennyIntLeaflet\/RO\/[^\s"']+/gi) || [];
          const pdfLink = reweMatches.find(u => u.toLowerCase().endsWith('.pdf'));
          if (pdfLink) {
            this.appendUniqueDoc(discovered, {
              id: `doc-penny-pdf-${todayStr}`,
              sourceId: source.id,
              retailerId: 'penny',
              documentUrl: pdfLink,
              title: `Pliant PDF Național PENNY (${todayStr})`,
              format: 'pdf',
              validFrom: todayStr,
              targetAudience: 'general',
              sourcePageUrl: source.catalogUrl,
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
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Penny:', err.message);
      }

      this.appendUniqueDoc(discovered, {
        id: `doc-penny-oferte-${todayStr}`,
        sourceId: source.id,
        retailerId: 'penny',
        documentUrl: 'https://www.penny.ro/oferte',
        title: `Pliant Săptămânal Național PENNY (${todayStr})`,
        format: 'html',
        validFrom: todayStr,
        targetAudience: 'general',
        sourcePageUrl: source.catalogUrl,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso
      });
      this.appendWebFallbackDocuments(discovered, source, websiteUrl, todayStr, nowIso);
      return discovered;
    }

    // -------------------------------------------------------------------------
    // 5. MEGA IMAGE
    // -------------------------------------------------------------------------
    if (source.retailerId === 'mega-image') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, {
          timeoutMs: 12000,
          additionalAllowedDomains
        });
        if (downloadRes.ok && downloadRes.text) {
          let publitasSlug: string | null = null;
          const slugMatch = downloadRes.text.match(/view\.publitas\.com\/mega-image\/([a-zA-Z0-9_\-]+)\/page\/1/);
          if (slugMatch) {
            publitasSlug = slugMatch[1];
          } else {
            const promoPageUrl = 'https://www.mega-image.ro/promotii-online/reviste-promo-online/revista-promo';
            const promoRes = await CatalogDownloader.downloadCatalog(promoPageUrl, { timeoutMs: 10000 });
            if (promoRes.ok && promoRes.text) {
              const m2 = promoRes.text.match(/view\.publitas\.com\/mega-image\/([a-zA-Z0-9_\-]+)\/page\/1/);
              if (m2) publitasSlug = m2[1];
            }
          }

          if (publitasSlug) {
            const spreadsUrl = `https://view.publitas.com/mega-image/${publitasSlug}/spreads.json`;
            this.appendUniqueDoc(discovered, {
              id: `doc-mega-image-${publitasSlug}`,
              sourceId: source.id,
              retailerId: 'mega-image',
              documentUrl: spreadsUrl,
              title: `Revista Promoțională Săptămânală Mega Image (${publitasSlug})`,
              format: 'html',
              validFrom: todayStr,
              targetAudience: 'general',
              sourcePageUrl: source.catalogUrl,
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
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Mega Image:', err.message);
      }

      // Adăugăm și pagina de Promoția Săptămânii + fallback pagină web oficială
      this.appendUniqueDoc(discovered, {
        id: `doc-mega-image-promo-saptamana-${todayStr}`,
        sourceId: source.id,
        retailerId: 'mega-image',
        documentUrl: 'https://www.mega-image.ro/Mega-Promotia-Saptamanii/c/7_newcateg',
        title: `Catalog Mega Promoția Săptămânii (${todayStr})`,
        format: 'html',
        validFrom: todayStr,
        targetAudience: 'general',
        sourcePageUrl: source.catalogUrl,
        downloadStatus: 'pending',
        parseStatus: 'pending',
        rawExtractedCount: 0,
        matchedCount: 0,
        validatedCount: 0,
        publishedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso
      });
      this.appendWebFallbackDocuments(discovered, source, websiteUrl, todayStr, nowIso);
      return discovered;
    }

    // -------------------------------------------------------------------------
    // 6. AUCHAN ROMÂNIA
    // -------------------------------------------------------------------------
    if (source.retailerId === 'auchan') {
      try {
        if (source.id === 'cat-src-auchan-catalog' || source.catalogUrl.includes('catalog-auchan')) {
          this.appendUniqueDoc(discovered, {
            id: `doc-auchan-catalog-direct-${todayStr}`,
            sourceId: source.id,
            retailerId: 'auchan',
            documentUrl: 'https://www.auchan.ro/cataloagele-auchan/catalog-auchan',
            title: `Catalog Oficial Digital Auchan (${todayStr})`,
            format: 'html',
            validFrom: todayStr,
            storeOrRegion: 'Auchan Național',
            targetAudience: 'general',
            sourcePageUrl: source.catalogUrl,
            downloadStatus: 'pending',
            parseStatus: 'pending',
            rawExtractedCount: 0,
            matchedCount: 0,
            validatedCount: 0,
            publishedCount: 0,
            createdAt: nowIso,
            updatedAt: nowIso
          });

          this.appendUniqueDoc(discovered, {
            id: `doc-auchan-cataloage-hub-${todayStr}`,
            sourceId: source.id,
            retailerId: 'auchan',
            documentUrl: 'https://www.auchan.ro/cataloagele-auchan',
            title: `Pliante & Reviste Auchan România (${todayStr})`,
            format: 'html',
            validFrom: todayStr,
            storeOrRegion: 'Auchan Național',
            targetAudience: 'general',
            sourcePageUrl: source.catalogUrl,
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

        this.appendWebFallbackDocuments(discovered, source, websiteUrl, todayStr, nowIso);
        return discovered;
      } catch (err: any) {
        console.warn('Eroare descoperire Auchan:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // 7. PROFI, METRO ȘI ORICE ALT RETAILER (Descoperire PDF/oferte din HTML + fallback web)
    // -------------------------------------------------------------------------
    if (source.catalogUrl) {
      const urlLower = source.catalogUrl.toLowerCase();
      const isDirectPdfUrl = /\.pdf(\?|$)/i.test(urlLower);

      if (isDirectPdfUrl) {
        this.appendUniqueDoc(discovered, {
          id: `doc-${source.id}-${todayStr}`,
          sourceId: source.id,
          retailerId: source.retailerId,
          documentUrl: source.catalogUrl,
          title: `${source.name} (${todayStr})`,
          format: 'pdf',
          validFrom: todayStr,
          targetAudience: 'general',
          sourcePageUrl: source.catalogUrl,
          downloadStatus: 'pending',
          parseStatus: 'pending',
          rawExtractedCount: 0,
          matchedCount: 0,
          validatedCount: 0,
          publishedCount: 0,
          createdAt: nowIso,
          updatedAt: nowIso
        });
      } else {
        // Pagină web / hub HTML: încercăm să descoperim eventuale PDF-uri sau subpagini de promoții din pagină
        try {
          const hubRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, {
            timeoutMs: 10000,
            maxRetries: 1,
            additionalAllowedDomains
          });
          if (hubRes.ok && hubRes.text && !(hubRes.contentType || '').toLowerCase().includes('application/pdf')) {
            const $ = cheerio.load(hubRes.text);
            const pdfLinks = new Set<string>();
            const promoLinks = new Set<string>();

            $('a[href]').each((_, el) => {
              const rawHref = ($(el).attr('href') || '').trim();
              if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
              try {
                const resolved = new URL(rawHref, source.catalogUrl).toString();
                if (/\.pdf(\?|$)/i.test(resolved)) {
                  pdfLinks.add(resolved);
                } else if (/\/(oferte|promotii|reduceri|cataloage|revista)/i.test(resolved)) {
                  promoLinks.add(resolved);
                }
              } catch {}
            });

            let pdfIdx = 0;
            for (const pdfUrl of Array.from(pdfLinks).slice(0, 2)) {
              pdfIdx++;
              this.appendUniqueDoc(discovered, {
                id: `doc-${source.retailerId}-pdf-${pdfIdx}-${todayStr}`,
                sourceId: source.id,
                retailerId: source.retailerId,
                documentUrl: pdfUrl,
                title: `Catalog PDF ${source.retailerName} #${pdfIdx} (${todayStr})`,
                format: 'pdf',
                validFrom: todayStr,
                targetAudience: 'general',
                sourcePageUrl: source.catalogUrl,
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

            let promoIdx = 0;
            for (const promoUrl of Array.from(promoLinks).slice(0, 2)) {
              promoIdx++;
              this.appendUniqueDoc(discovered, {
                id: `doc-${source.retailerId}-promo-${promoIdx}-${todayStr}`,
                sourceId: source.id,
                retailerId: source.retailerId,
                documentUrl: promoUrl,
                title: `Pagină Oferte ${source.retailerName} #${promoIdx} (${todayStr})`,
                format: 'html',
                validFrom: todayStr,
                targetAudience: 'general',
                sourcePageUrl: source.catalogUrl,
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
          }
        } catch {
          // Continuăm către fallback-ul paginii web
        }

        // Adăugăm întotdeauna sursa configurată ca HTML (dacă formatul era marcat pdf pe o pagină web) sau formatul ei original
        const inferredFormat: CatalogFormat = source.format === 'pdf' ? 'html' : source.format;
        this.appendUniqueDoc(discovered, {
          id: `doc-${source.id}-${todayStr}`,
          sourceId: source.id,
          retailerId: source.retailerId,
          documentUrl: source.catalogUrl,
          title: `${source.name} (${todayStr})`,
          format: inferredFormat,
          validFrom: todayStr,
          targetAudience: 'general',
          sourcePageUrl: source.catalogUrl,
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
    }

    // Fallback final pe pagina web oficială a retailerului dacă nu există sau e indisponibil catalogul
    this.appendWebFallbackDocuments(discovered, source, websiteUrl, todayStr, nowIso);
    return discovered;
  }
}
