import * as cheerio from 'cheerio';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader.ts';

async function testFullLidl() {
  const url = 'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219';
  const res = await CatalogDownloader.downloadCatalog(url);
  const $ = cheerio.load(res.text || '');

  const items: any[] = [];

  $('[data-grid-data]').each((i, el) => {
    try {
      const raw = $(el).attr('data-grid-data');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const data = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!data) return;

      const title = data.fullTitle || data.title || data.keyfacts?.fullTitle || data.keyfacts?.title;
      if (!title) return;

      let brand: string | undefined = undefined;
      if (typeof data.brand === 'string') {
        brand = data.brand;
      } else if (data.brand && typeof data.brand.name === 'string') {
        brand = data.brand.name;
      } else if (data.keyfacts?.brand) {
        brand = typeof data.keyfacts.brand === 'string' ? data.keyfacts.brand : data.keyfacts.brand?.name;
      }
      if (brand === '-' || brand === '') brand = undefined;

      let normalPrice = 0;
      let promoPrice: number | undefined = undefined;
      let loyaltyPrice: number | undefined = undefined;
      let packagingText: string | undefined = undefined;
      let validFrom: string | undefined = undefined;
      let validUntil: string | undefined = undefined;
      let isLidlPlus = false;
      let promoDetails: string | undefined = undefined;

      if (data.regionsPrices) {
        const reg1 = (data.regionsPrices['1'] || Object.values(data.regionsPrices)[0]) as any;
        if (reg1) {
          if (reg1.currentLidlPlusPrice) {
            isLidlPlus = true;
            const lp = reg1.currentLidlPlusPrice;
            loyaltyPrice = typeof lp.price?.price === 'number' ? lp.price.price : parseFloat(String(lp.price?.price || '').replace(',', '.'));
            packagingText = lp.price?.packaging?.text || lp.packaging?.text;
            validFrom = lp.price?.startDate?.slice(0, 10);
            validUntil = lp.price?.endDate?.slice(0, 10);

            if (lp.price?.basePrice?.text) {
              const matchBase = lp.price.basePrice.text.match(/(\d+(?:[.,]\d+)?)\s*lei/i);
              if (matchBase) {
                normalPrice = parseFloat(matchBase[1].replace(',', '.'));
              }
            }
            if (lp.highlightText || lp.price?.discount?.discountText) {
              promoDetails = `Lidl Plus ${lp.highlightText || lp.price?.discount?.discountText}`;
            }
          } else if (reg1.currentPrice) {
            const cp = reg1.currentPrice;
            const p = typeof cp.price === 'number' ? cp.price : parseFloat(String(cp.price || '').replace(',', '.'));
            if (!isNaN(p) && p > 0) normalPrice = p;
            packagingText = cp.packaging?.text;
            validFrom = cp.startDate?.slice(0, 10);
            validUntil = cp.endDate?.slice(0, 10);
            if (cp.discount?.price) {
              promoPrice = typeof cp.discount.price === 'number' ? cp.discount.price : parseFloat(String(cp.discount.price).replace(',', '.'));
            }
          }
        }
      }

      if (normalPrice <= 0 && data.price?.price) {
        const p = typeof data.price.price === 'number' ? data.price.price : parseFloat(String(data.price.price).replace(',', '.'));
        if (!isNaN(p) && p > 0) normalPrice = p;
        if (data.price?.discount?.price) {
          promoPrice = parseFloat(String(data.price.discount.price).replace(',', '.'));
        }
        if (data.price?.loyaltyCardPrice) {
          loyaltyPrice = parseFloat(String(data.price.loyaltyCardPrice).replace(',', '.'));
          isLidlPlus = true;
        }
      }

      if (!packagingText) {
        packagingText = data.price?.packaging?.text || data.packaging;
      }

      if (normalPrice <= 0 && loyaltyPrice && loyaltyPrice > 0) {
        normalPrice = loyaltyPrice;
      }

      if (normalPrice <= 0) return;

      const effectivePrice = loyaltyPrice || promoPrice || normalPrice;

      items.push({
        index: items.length + 1,
        title,
        brand,
        packagingText,
        normalPrice,
        promoPrice,
        loyaltyPrice,
        effectivePrice,
        isPromo: Boolean(promoPrice || isLidlPlus),
        promoDetails,
        loyaltyCardName: isLidlPlus ? 'Lidl Plus' : undefined,
        validFrom,
        validUntil,
        canonicalUrl: data.canonicalUrl ? `https://www.lidl.ro${data.canonicalUrl}` : url
      });
    } catch (e: any) {
      console.error(e.message);
    }
  });

  console.log(`Extracted ${items.length} complete items with prices!`);
  for (let i = 0; i < 10; i++) {
    console.log(`\n=== Oferta #${i + 1} ===`);
    console.log(JSON.stringify(items[i], null, 2));
  }
}

testFullLidl();
