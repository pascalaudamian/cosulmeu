import * as cheerio from 'cheerio';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader.ts';

async function detailItems() {
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

      const title = data.fullTitle || data.title || data.keyfacts?.title;
      let price = data.price?.price;
      let regionsPriceObj: any = null;
      if (data.regionsPrices) {
        regionsPriceObj = Object.values(data.regionsPrices)[0];
        if (!price) {
          price = regionsPriceObj?.currentPrice?.price;
        }
      }

      const discount = data.price?.discount?.price || regionsPriceObj?.currentPrice?.discount?.price;
      const loyaltyPrice = data.price?.loyaltyCardPrice || regionsPriceObj?.currentPrice?.loyaltyCardPrice;
      const packaging = data.price?.packaging?.text || regionsPriceObj?.currentPrice?.packaging?.text || data.packaging;
      const brand = typeof data.brand === 'string' ? data.brand : (data.brand?.name || data.keyfacts?.brand);
      const startDate = regionsPriceObj?.currentPrice?.startDate || data.price?.startDate;
      const endDate = regionsPriceObj?.currentPrice?.endDate || data.price?.endDate;

      items.push({
        index: items.length + 1,
        title,
        brand: brand && brand !== '-' ? brand : undefined,
        packaging,
        normalPrice: price,
        promoPrice: discount,
        loyaltyPrice,
        startDate: startDate ? startDate.slice(0, 10) : undefined,
        endDate: endDate ? endDate.slice(0, 10) : undefined,
        canonicalUrl: data.canonicalUrl ? `https://www.lidl.ro${data.canonicalUrl}` : url
      });
    } catch {}
  });

  console.log('Total items parsed:', items.length);
  for (let i = 0; i < 10; i++) {
    console.log(`\n=== Oferta #${i + 1} ===`);
    console.log(JSON.stringify(items[i], null, 2));
  }
}

detailItems();
