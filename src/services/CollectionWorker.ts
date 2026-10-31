// src/services/CollectionWorker.ts
// Worker pentru colectarea, parsarea, normalizarea și actualizarea prețurilor din surse autorizate
// și descoperirea țintită a produselor de pe bonurile fiscale (Receipt Discovery Loop)

import { RetailerRegistry } from '../indexing/RetailerRegistry.ts';
import { getCollectorForRetailer } from '../indexing/RetailerCollectors.ts';
import { ProcessingPipeline } from '../indexing/ProcessingPipeline.ts';
import { BatchProcessingResult } from '../indexing/types.ts';
import { IndexingMonitor } from '../indexing/IndexingMonitor.ts';
import { ScrapingEngine } from '../scraping/ScrapingEngine.ts';
import { StorageService } from './StorageService.ts';
import { PriceIndexer } from '../indexing/PriceIndexer.ts';
import { PromotionIndexer } from '../indexing/PromotionIndexer.ts';
import { ProductOffer } from '../types.ts';

export interface CollectionWorkerSummary {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  totalRetailersChecked: number;
  retailersExecuted: number;
  successfulBatches: number;
  partialBatches: number;
  failedBatches: number;
  totalOffersProcessed: number;
  totalObservationsAppended: number;
  batchResults: BatchProcessingResult[];
  discoveredReceiptItemsCount?: number;
  errors: string[];
}

export class CollectionWorker {
  private static isRunning = false;

  /**
   * Indică dacă CollectionWorker are o execuție în curs
   */
  static isBusy(): boolean {
    return this.isRunning;
  }

  /**
   * Execută căutarea țintită pentru produsele noi identificate de pe bonuri fiscale
   */
  static async discoverPendingReceiptProducts(options: { dryRun?: boolean; maxItems?: number } = {}): Promise<{
    processedCount: number;
    matchedCount: number;
    offersCreatedCount: number;
    promotionsCreatedCount: number;
  }> {
    const pendingItems = StorageService.getReceiptProducts().filter(i => i.targetSearchStatus === 'pending');
    const itemsToProcess = pendingItems.slice(0, options.maxItems || 10);

    let matchedCount = 0;
    let offersCreatedCount = 0;
    let promotionsCreatedCount = 0;

    const activeRetailers = RetailerRegistry.getAllRetailers().filter(
      r => r.status === 'active' || r.status === 'configured'
    );

    for (const item of itemsToProcess) {
      let itemMatched = false;

      for (const retailer of activeRetailers) {
        try {
          // Căutare țintită de produs pe baza numelui de pe bon
          const candidates = await ScrapingEngine.searchTargetedProduct({
            retailerId: retailer.retailerId,
            query: item.rawName
          });

          if (candidates.length > 0) {
            itemMatched = true;

            // Pregătim oferte pentru candidați
            const offers: ProductOffer[] = candidates.map((c, idx) => ({
              id: `off-disc-${retailer.retailerId}-${Date.now()}-${idx}`,
              productId: item.matchedProductId || `prod-disc-${item.id}`,
              storeId: retailer.retailerId,
              price: c.promoPrice || c.normalPrice,
              originalPrice: c.promoPrice ? c.normalPrice : undefined,
              unitPrice: c.normalPrice,
              unitPriceMeasure: 'lei/buc',
              isPromo: Boolean(c.promoPrice),
              promoDetails: c.promoDescription,
              observationDate: new Date().toISOString().split('T')[0],
              source: 'official_feed',
              confidenceLevel: 'medium',
              verificationStatus: 'verified',
              lastChecked: new Date().toISOString().split('T')[0]
            }));

            if (!options.dryRun) {
              const res = await PriceIndexer.indexPrices(offers);
              offersCreatedCount += res.acceptedOffersCount;

              // Extragem promoții dacă există reduceri
              const promos = candidates
                .filter(c => c.promoPrice && c.promoPrice < c.normalPrice)
                .map((c, idx) => ({
                  id: `promo-disc-${retailer.retailerId}-${Date.now()}-${idx}`,
                  retailerId: retailer.retailerId,
                  title: c.rawName,
                  description: c.promoDescription || 'Promoție identificată din căutare țintită',
                  normalPrice: c.normalPrice,
                  promoPrice: c.promoPrice!,
                  startsAt: c.promoPeriod?.from,
                  endsAt: c.promoPeriod?.until,
                  discoveredAt: new Date().toISOString()
                }));

              if (promos.length > 0) {
                const promoRes = await PromotionIndexer.indexPromotions(promos);
                promotionsCreatedCount += promoRes.promotionsIndexedCount;
              }
            }
          }
        } catch (err: any) {
          console.warn(`Eroare căutare țintită ${item.rawName} la ${retailer.name}:`, err.message);
        }
      }

      if (!options.dryRun) {
        StorageService.updateReceiptProductStatus(
          item.id,
          itemMatched ? 'matched' : 'searched'
        );
      }

      if (itemMatched) matchedCount++;
    }

    return {
      processedCount: itemsToProcess.length,
      matchedCount,
      offersCreatedCount,
      promotionsCreatedCount
    };
  }

  /**
   * Execută colectarea zilnică a prețurilor pentru retailerii configurați/activi
   */
  static async runDailyCollection(options: {
    dryRun?: boolean;
    retailerIds?: string[];
    samplePayloads?: Record<string, string>;
    includeReceiptDiscovery?: boolean;
  } = {}): Promise<CollectionWorkerSummary> {
    if (this.isRunning) {
      throw new Error('CollectionWorker este deja în curs de execuție.');
    }

    this.isRunning = true;
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const errors: string[] = [];
    const batchResults: BatchProcessingResult[] = [];

    let successfulBatches = 0;
    let partialBatches = 0;
    let failedBatches = 0;
    let totalOffersProcessed = 0;
    let totalObservationsAppended = 0;

    try {
      const allRetailers = RetailerRegistry.getAllRetailers();
      const targetRetailers = options.retailerIds && options.retailerIds.length > 0
        ? allRetailers.filter(r => options.retailerIds!.includes(r.retailerId))
        : allRetailers;

      for (const retailer of targetRetailers) {
        // Colectăm doar retailerii activi sau pe cei configurați cu payload manual / test
        const hasPayload = Boolean(options.samplePayloads && options.samplePayloads[retailer.retailerId]);
        const shouldRun = retailer.status === 'active' || (hasPayload && retailer.status === 'configured');

        if (!shouldRun) {
          continue;
        }

        try {
          const collector = getCollectorForRetailer(retailer.retailerId);
          const eligibility = await collector.checkEligibility();

          if (!hasPayload && !eligibility.eligible) {
            RetailerRegistry.updateRetailerStatus(retailer.retailerId, eligibility.status, eligibility.reason);
            continue;
          }

          const payload = options.samplePayloads ? options.samplePayloads[retailer.retailerId] : undefined;
          const batch = await collector.collectBatch({ dryRun: options.dryRun, payload });
          const result = await ProcessingPipeline.processBatch(batch, { dryRun: options.dryRun });

          batchResults.push(result);
          RetailerRegistry.recordExecution(retailer.retailerId, result);

          // Înregistrăm execuția în monitorul de telemetrie
          if (!options.dryRun) {
            await IndexingMonitor.recordRun({
              id: `run-${retailer.retailerId}-${Date.now()}`,
              retailerId: retailer.retailerId,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              status: result.status === 'complete' ? 'completed' : result.status === 'partial' ? 'completed' : 'failed',
              productsCollected: result.recordsValid,
              promotionsCollected: result.offersUpsertedCount,
              errorsCount: result.recordsInvalid,
              durationMs: result.durationMs,
              summary: result.summary
            });
          }

          if (result.status === 'complete') {
            successfulBatches++;
          } else if (result.status === 'partial') {
            partialBatches++;
          } else {
            failedBatches++;
          }

          totalOffersProcessed += result.offersUpsertedCount;
          totalObservationsAppended += result.observationsAppendedCount;

          // Pauză politicoasă între cereri pentru a respecta limitele de trafic
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (err: any) {
          failedBatches++;
          const errMsg = `Eroare colectare ${retailer.name}: ${err.message}`;
          errors.push(errMsg);
          console.error(errMsg);
        }
      }

      // Procesare opțională produse bonuri în așteptare
      let discoveredReceiptItemsCount = 0;
      if (options.includeReceiptDiscovery) {
        const discRes = await this.discoverPendingReceiptProducts({ dryRun: options.dryRun });
        discoveredReceiptItemsCount = discRes.processedCount;
      }

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      return {
        startedAt,
        completedAt,
        durationMs,
        totalRetailersChecked: targetRetailers.length,
        retailersExecuted: batchResults.length,
        successfulBatches,
        partialBatches,
        failedBatches,
        totalOffersProcessed,
        totalObservationsAppended,
        batchResults,
        discoveredReceiptItemsCount,
        errors
      };
    } finally {
      this.isRunning = false;
    }
  }
}
