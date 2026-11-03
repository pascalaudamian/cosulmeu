import * as cheerio from 'cheerio';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader.ts';

async function inspectRawItem() {
  const url = 'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219';
  const res = await CatalogDownloader.downloadCatalog(url);
  const $ = cheerio.load(res.text || '');

  // Look at items 1 to 5
  $('[data-grid-data]').slice(0, 5).each((i, el) => {
    const raw = $(el).attr('data-grid-data');
    console.log(`\n================ Item ${i + 1} Raw Keys ================`);
    try {
      const parsed = JSON.parse(raw || '{}');
      const data = Array.isArray(parsed) ? parsed[0] : parsed;
      console.log('Keys:', Object.keys(data));
      console.log('price:', JSON.stringify(data.price));
      console.log('regionsPrices:', JSON.stringify(data.regionsPrices));
      console.log('keyfacts:', JSON.stringify(data.keyfacts));
      console.log('DOM price:', $(el).find('[class*="price"]').text().trim());
      console.log('DOM subline:', $(el).find('[class*="subline"]').text().trim());
      console.log('DOM full card text:', $(el).text().replace(/\s+/g, ' ').trim().slice(0, 150));
    } catch (e: any) {
      console.error(e.message);
    }
  });
}

inspectRawItem();
