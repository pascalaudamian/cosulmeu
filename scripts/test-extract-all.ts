import * as cheerio from 'cheerio';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader.ts';

async function testExtract() {
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
      if (!price && data.regionsPrices) {
        const firstRegion = Object.values(data.regionsPrices)[0] as any;
        price = firstRegion?.currentPrice?.price;
      }

      const discount = data.price?.discount?.price;
      const loyaltyPrice = data.price?.loyaltyCardPrice;
      const packaging = data.price?.packaging?.text || data.packaging;
      const brand = data.brand || data.keyfacts?.brand;
      const category = data.category || data.keyfacts?.analyticsCategory;

      items.push({
        index: i + 1,
        title,
        brand,
        packaging,
        price,
        discount,
        loyaltyPrice,
        category,
        url: data.canonicalUrl ? `https://www.lidl.ro${data.canonicalUrl}` : url
      });
    } catch (e: any) {
      console.error(`Error at index ${i}:`, e.message);
    }
  });

  console.log(`Successfully extracted ${items.length} items from data-grid-data!`);
  console.log('\nFirst 12 items:');
  console.log(JSON.stringify(items.slice(0, 12), null, 2));
}

testExtract();
