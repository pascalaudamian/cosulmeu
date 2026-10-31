// src/indexing/IndexingMonitor.ts
// Modul centralizat de monitorizare și telemetrie pentru Motorul de Indexare

import { IndexingMonitorStats, IndexingRunRecord } from './types';
import { RetailerRegistry } from './RetailerRegistry';
import { StorageService } from '../services/StorageService';
import { getPool } from '../db/index';

export class IndexingMonitor {
  /**
   * Înregistrează o execuție de indexare în baza de date și în stocarea locală
   */
  static async recordRun(run: IndexingRunRecord): Promise<void> {
    const pool = getPool();
    if (pool) {
      try {
        const client = await pool.connect();
        try {
          await client.query(
            `INSERT INTO indexing_runs (
              id, job_id, retailer_id, started_at, completed_at, status,
              products_collected, promotions_collected, errors_count, duration_ms, summary, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (id) DO UPDATE SET
              completed_at = EXCLUDED.completed_at,
              status = EXCLUDED.status,
              products_collected = EXCLUDED.products_collected,
              promotions_collected = EXCLUDED.promotions_collected,
              errors_count = EXCLUDED.errors_count,
              duration_ms = EXCLUDED.duration_ms,
              summary = EXCLUDED.summary`,
            [
              run.id,
              run.jobId || null,
              run.retailerId,
              run.startedAt,
              run.completedAt || null,
              run.status,
              run.productsCollected,
              run.promotionsCollected,
              run.errorsCount,
              run.durationMs,
              run.summary
            ]
          );
        } finally {
          client.release();
        }
      } catch (err: any) {
        console.warn('Eroare persistență DB în IndexingMonitor:', err.message);
      }
    }

    StorageService.addIndexingRun(run);
  }

  /**
   * Calculează statisticile agregate de sănătate ale sistemului de indexare
   */
  static getStats(): IndexingMonitorStats {
    const retailers = RetailerRegistry.getAllRetailers();
    const offers = StorageService.getProductOffers();
    const observations = StorageService.getPriceObservations();
    const promotions = StorageService.getPromotions();
    const receiptProducts = StorageService.getReceiptProducts();
    const runs = StorageService.getIndexingRuns();

    const activeRetailers = retailers.filter(r => r.status === 'active' || r.status === 'configured');
    const degradedRetailers = retailers.filter(r => r.status === 'degraded');
    const pausedRetailers = retailers.filter(r => r.status === 'paused');

    let systemHealth: 'healthy' | 'degraded' | 'paused' = 'healthy';
    if (degradedRetailers.length > 0) {
      systemHealth = 'degraded';
    } else if (pausedRetailers.length === retailers.length) {
      systemHealth = 'paused';
    }

    const totalAutoMatch = retailers.reduce((sum, r) => sum + (r.autoMatchRate || 0), 0);
    const averageAutoMatchRate = retailers.length > 0 ? Math.round(totalAutoMatch / retailers.length) : 0;

    const pendingReceiptCount = receiptProducts.filter(p => p.targetSearchStatus === 'pending').length;

    // Calculăm timestamp-ul ultimei rulări
    let lastRunTimestamp: string | undefined;
    for (const r of retailers) {
      if (r.lastRunAt && (!lastRunTimestamp || r.lastRunAt > lastRunTimestamp)) {
        lastRunTimestamp = r.lastRunAt;
      }
    }

    // Următoarea rulare estimată (zilnic la 04:00 Europe/Bucharest)
    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + 1);
    nextRun.setHours(4, 0, 0, 0);

    return {
      activeRetailersCount: activeRetailers.length,
      totalRetailersCount: retailers.length,
      totalOffersCount: offers.length,
      totalObservationsCount: observations.length,
      totalPromotionsCount: promotions.length,
      pendingReceiptProductsCount: pendingReceiptCount,
      lastRunTimestamp,
      nextRunTimestamp: nextRun.toISOString(),
      averageAutoMatchRate,
      systemHealth,
      recentRuns: runs.slice(0, 10)
    };
  }
}
