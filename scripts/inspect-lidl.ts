import * as cheerio from 'cheerio';
import { CatalogDownloader } from '../src/indexing/catalog/CatalogDownloader.ts';

async function inspectHtml() {
  const url = 'https://www.lidl.ro/c/ofertele-saptamanale-lidl-plus/a10106219';
  const res = await CatalogDownloader.downloadCatalog(url);
  const $ = cheerio.load(res.text || '');

  console.log('Title:', $('title').text().trim());
  console.log('data-grid-data count:', $('[data-grid-data]').length);

  $('[data-grid-data]').each((i, el) => {
    console.log(`\n--- Item ${i + 1} ---`);
    console.log('Attr data-grid-data:', $(el).attr('data-grid-data'));
  });

  console.log('\narticle elements count:', $('article').length);
  console.log('.nuc-a-carousel-item count:', $('.nuc-a-carousel-item').length);
  console.log('.od-product-card count:', $('.od-product-card').length);
  console.log('.product-grid-box-redesign count:', $('.product-grid-box-redesign').length);
  console.log('.product-grid-box count:', $('.product-grid-box').length);
  console.log('[data-product-id] count:', $('[data-product-id]').length);

  // Check script tags for data
  $('script').each((i, el) => {
    const content = $(el).html() || '';
    if (content.includes('gridData') || content.includes('products') || content.includes('canonicalUrl')) {
      console.log(`Script ${i} length: ${content.length}, preview: ${content.slice(0, 150)}...`);
    }
  });

  // Check grocery or offers sections on Lidl
  console.log('Other catalog/offers sections links on Lidl:');
  const sections: string[] = [];
  $('a[href*="/c/"]').each((i, el) => {
    const href = $(el).attr('href');
    if (href && !sections.includes(href) && (href.includes('oferte') || href.includes('alimente') || href.includes('catalog') || href.includes('saptam'))) {
      sections.push(href);
      console.log(`Section: ${href} | Text: ${$(el).text().replace(/\s+/g, ' ').trim()}`);
    }
  });
}

inspectHtml().catch(console.error);
