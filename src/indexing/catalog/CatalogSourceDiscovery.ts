// src/indexing/catalog/CatalogSourceDiscovery.ts
// Descoperire automată a cataloagelor publice pentru retailerii din România

import * as cheerio from 'cheerio';
import { CatalogSource, CatalogDocument, CatalogFormat } from './catalogTypes.js';
import { CatalogDownloader } from './CatalogDownloader.js';

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
    name: 'Auchan – Magazin Online Oficial',
    catalogUrl: 'https://www.auchan.ro/',
    format: 'html',
    status: 'active',
    updateFrequencyDays: 1,
    authRequired: false,
    legalStatusNotice: 'Magazin online oficial și catalog săptămânal de promoții Auchan România; extragere publică transparentă cu diferențiere oferte MyCLUB.'
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
    catalogUrl: 'https://www.mega-image.ro/promotii-online/reviste-promo-online',
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

export class CatalogSourceDiscovery {
  /**
   * Descoperă documente noi pentru o sursă de catalog oficială
   */
  static async discoverDocumentsForSource(source: CatalogSource): Promise<CatalogDocument[]> {
    if (source.status === 'disabled') {
      return [];
    }

    const discovered: CatalogDocument[] = [];
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split('T')[0];

    // -------------------------------------------------------------------------
    // 1. LIDL ROMÂNIA
    // Punct oficial: https://www.lidl.ro/c/cataloage-online/s10019911
    // -------------------------------------------------------------------------
    if (source.retailerId === 'lidl') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, { timeoutMs: 15000 });
        if (downloadRes.ok && downloadRes.text) {
          const flyerLinks: { url: string; slug: string }[] = [];
          const regex = /href="([^"]*\/cataloage\/([^"\/]+)\/ar\/0)"/g;
          let m: RegExpExecArray | null;
          while ((m = regex.exec(downloadRes.text)) !== null) {
            const slug = m[2];
            // Filtrăm cataloagele de produse (excludem notele de informare clienți)
            if (!slug.includes('nota-de-informare') && !slug.includes('serviciul-clien')) {
              flyerLinks.push({ url: m[1], slug });
            }
          }

          // Descoperim metadatele oficiale prin endpoint-ul v4 Schwarz Leaflet
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

                discovered.push({
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

        // Adăugăm și pagina activă cu ofertele săptămânale curente (cu grid-data complet)
        discovered.push({
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

        return discovered;
      } catch (err: any) {
        console.warn('Eroare descoperire Lidl:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // 2. KAUFLAND ROMÂNIA
    // Punct oficial: https://www.kaufland.ro/cataloage-cu-reduceri.html
    // -------------------------------------------------------------------------
    if (source.retailerId === 'kaufland') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, { timeoutMs: 15000 });
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

            discovered.push({
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

          if (discovered.length > 0) return discovered;
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Kaufland:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // 3. CARREFOUR ROMÂNIA
    // Punct oficial: https://carrefour.ro/corporate/cataloage?tip=market
    // -------------------------------------------------------------------------
    if (source.retailerId === 'carrefour') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, { timeoutMs: 15000 });
        if (downloadRes.ok && downloadRes.text) {
          // Identificăm campaniile și cataloagele active din `row catalogues-items`
          const $ = cheerio.load(downloadRes.text);
          const campaignLinks: { url: string; title: string }[] = [];

          $('.catalogues-items a').each((_, el) => {
            const href = $(el).attr('href');
            const imgAlt = $(el).find('img').attr('alt') || 'Catalog Carrefour';
            if (href && href.startsWith('http')) {
              campaignLinks.push({ url: href, title: imgAlt });
            }
          });

          // Adăugăm catalogul săptămânal principal Carrefour Market
          discovered.push({
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

          // Dacă sunt campanii tematice adăugate în pagină (ex: Black Friday, carte)
          for (const camp of campaignLinks.slice(0, 2)) {
            if (!camp.url.includes('oferte-saptamanale') && !camp.url.includes('catalogsearch')) {
              discovered.push({
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

          return discovered;
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Carrefour:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // 4. PENNY ROMÂNIA
    // Punct oficial: https://www.penny.ro/vezi-pliantele-saptamanii
    // -------------------------------------------------------------------------
    if (source.retailerId === 'penny') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, { timeoutMs: 15000 });
        if (downloadRes.ok && downloadRes.text) {
          // Descoperim linkul către pliantul național curent (Rewe Leaflet)
          const reweMatches = downloadRes.text.match(/https:\/\/files\.rewe\.co\.at\/PennyIntLeaflet\/RO\/[^\s"']+/gi) || [];
          const leafletUrl = reweMatches[0];

          // Adăugăm catalogul oficial săptămânal de oferte Penny (cu preț PENNY Card și standard)
          discovered.push({
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

          return discovered;
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Penny:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // 5. MEGA IMAGE
    // Punct oficial: https://www.mega-image.ro/promotii-online/reviste-promo-online
    // -------------------------------------------------------------------------
    if (source.retailerId === 'mega-image') {
      try {
        const downloadRes = await CatalogDownloader.downloadCatalog(source.catalogUrl, { timeoutMs: 15000 });
        if (downloadRes.ok && downloadRes.text) {
          // Accesează pagina revistei promoționale pentru a extrage slug-ul Publitas curent
          const promoPageUrl = 'https://www.mega-image.ro/promotii-online/reviste-promo-online/revista-promo';
          const promoRes = await fetch(promoPageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          let publitasSlug = 'revista-nr-43-2026';
          if (promoRes.ok) {
            const promoHtml = await promoRes.text();
            const slugMatch = promoHtml.match(/view\.publitas\.com\/mega-image\/([a-zA-Z0-9_\-]+)\/page\/1/);
            if (slugMatch) {
              publitasSlug = slugMatch[1];
            }
          }

          // Documentul 1: Revista Promoțională Săptămânală
          const spreadsUrl = `https://view.publitas.com/mega-image/${publitasSlug}/spreads.json`;
          discovered.push({
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

          // Documentul 2: Promoția Săptămânii (online catalog)
          discovered.push({
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

          return discovered;
        }
      } catch (err: any) {
        console.warn('Eroare descoperire Mega Image:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // 6. AUCHAN ROMÂNIA
    // Punct oficial principal: Magazinul online https://www.auchan.ro/promotii
    // Puncte de explorat:
    // - https://www.auchan.ro/promotii (Toate promoțiile curente din magazinul online)
    // - https://www.auchan.ro/ofertele-saptamanii
    // - https://www.auchan.ro/oferte-si-promotii-cataloage
    // - Fallback secundar: https://www.auchan.ro/cataloagele-auchan
    // -------------------------------------------------------------------------
    if (source.retailerId === 'auchan') {
      try {
        if (source.id === 'cat-src-auchan-catalog' || source.catalogUrl.includes('catalog-auchan')) {
          // Sursa: Auchan Catalog Digital (https://www.auchan.ro/cataloagele-auchan/catalog-auchan)
          discovered.push({
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

          discovered.push({
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
        } else {
          // Sursa: Magazinul Online Auchan (https://www.auchan.ro/promotii & https://www.auchan.ro/)
          discovered.push({
            id: `doc-auchan-promotii-${todayStr}`,
            sourceId: source.id,
            retailerId: 'auchan',
            documentUrl: 'https://www.auchan.ro/promotii',
            title: `Promoții & Reduceri Magazin Online Auchan (${todayStr})`,
            format: 'html',
            validFrom: todayStr,
            storeOrRegion: 'Magazin Online Național Auchan România',
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

          discovered.push({
            id: `doc-auchan-store-home-${todayStr}`,
            sourceId: source.id,
            retailerId: 'auchan',
            documentUrl: 'https://www.auchan.ro/',
            title: `Magazin Online Oficial Auchan – Produse Recomandate (${todayStr})`,
            format: 'html',
            validFrom: todayStr,
            storeOrRegion: 'Magazin Online Național Auchan România',
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

          discovered.push({
            id: `doc-auchan-oferte-cataloage-${todayStr}`,
            sourceId: source.id,
            retailerId: 'auchan',
            documentUrl: 'https://www.auchan.ro/oferte-si-promotii-cataloage',
            title: `Oferte și Promoții din Catalog Auchan (${todayStr})`,
            format: 'html',
            validFrom: todayStr,
            storeOrRegion: 'Magazin Online Național Auchan România',
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

        return discovered;
      } catch (err: any) {
        console.warn('Eroare descoperire Auchan:', err.message);
      }
    }

    // -------------------------------------------------------------------------
    // 7. PROFI ROM FOOD
    // Punct oficial: https://www.profi.ro/reviste-ro/
    // -------------------------------------------------------------------------
    if (source.retailerId === 'profi') {
      // Sursă protejată de Cloudflare WAF (HTTP 403 Challenge)
      // Conform regulilor de etică civică, accesul este documentat și marcat BLOCKED
      return [];
    }

    // -------------------------------------------------------------------------
    // 7. METRO CASH & CARRY
    // Punct oficial: https://www.metro.ro/cataloagele-metro
    // -------------------------------------------------------------------------
    if (source.retailerId === 'metro') {
      // Sursă protejată de Akamai Bot Manager (HTTP 403) și rezervată clienților B2B autorizați
      return [];
    }

    return discovered;
  }
}
