// src/indexing/IndexingScheduler.ts
// Scheduler și Worker Zilnic cu Lock Distribuit, Rate Limiting, Backoff Exponențial și Circuit Breaker

import { RetailerRegistry } from './RetailerRegistry';
import { getCollectorForRetailer } from './RetailerCollectors';
import { ProcessingPipeline } from './ProcessingPipeline';
import { BatchProcessingResult, CollectorStatus } from './types';
import { getPool } from '../db/index';

export interface SchedulerStatus {
  isRunning: boolean;
  isShuttingDown: boolean;
  timezone: string;
  nextScheduledRun: string;
  activeLock: string | null;
  activeWorkersCount: number;
}

export class IndexingScheduler {
  private static isRunning = false;
  private static isShuttingDown = false;
  private static timerId: NodeJS.Timeout | null = null;
  private static timezone = 'Europe/Bucharest';
  private static currentLockKey: string | null = null;
  private static activeJobsCount = 0;

  // In-memory lock fallback
  private static inMemoryLocks: Map<string, { lockedBy: string; expiresAt: number }> = new Map();

  /**
   * Încearcă să obțină un lock distribuit pentru prevenirea execuțiilor concurente
   */
  static async acquireLock(lockKey: string, lockedBy: string, ttlSeconds = 900): Promise<boolean> {
    const pool = getPool();
    const now = Date.now();

    if (pool) {
      try {
        const client = await pool.connect();
        try {
          const res = await client.query(
            `INSERT INTO indexing_locks (lock_key, locked_at, locked_by, expires_at)
             VALUES ($1, NOW(), $2, NOW() + ($3 || ' seconds')::interval)
             ON CONFLICT (lock_key) DO UPDATE
             SET locked_at = NOW(),
                 locked_by = EXCLUDED.locked_by,
                 expires_at = NOW() + ($3 || ' seconds')::interval
             WHERE indexing_locks.expires_at < NOW()
             RETURNING lock_key`,
            [lockKey, lockedBy, ttlSeconds]
          );

          const acquired = res.rows.length > 0;
          if (acquired) this.currentLockKey = lockKey;
          return acquired;
        } finally {
          client.release();
        }
      } catch (err: any) {
        console.warn('Eroare la obținerea lock-ului în DB, fallback pe lock în memorie:', err.message);
      }
    }

    // Fallback în memorie
    const existing = this.inMemoryLocks.get(lockKey);
    if (existing && existing.expiresAt > now) {
      return false; // Lock deja deținut de alt proces activ
    }

    this.inMemoryLocks.set(lockKey, {
      lockedBy,
      expiresAt: now + ttlSeconds * 1000
    });
    this.currentLockKey = lockKey;
    return true;
  }

  /**
   * Eliberează lock-ul deținut
   */
  static async releaseLock(lockKey: string): Promise<void> {
    const pool = getPool();
    this.inMemoryLocks.delete(lockKey);

    if (this.currentLockKey === lockKey) {
      this.currentLockKey = null;
    }

    if (pool) {
      try {
        await pool.query('DELETE FROM indexing_locks WHERE lock_key = $1', [lockKey]);
      } catch {
        // Ignorare non-fatală
      }
    }
  }

  /**
   * Rulează un retailer individual cu limite de trafic, timeout și retry cu backoff exponențial
   */
  static async runRetailerJob(
    retailerId: string,
    options: { dryRun?: boolean; payload?: string; triggeredBy?: string } = {}
  ): Promise<BatchProcessingResult> {
    const entry = RetailerRegistry.getRetailer(retailerId);
    if (!entry) {
      throw new Error(`Retailer necunoscut în registru: ${retailerId}`);
    }

    if (this.isShuttingDown) {
      throw new Error('Sistemul se oprește. Nu se mai pot iniția colectări.');
    }

    const lockKey = `lock-retailer-${retailerId}`;
    const acquired = await this.acquireLock(lockKey, options.triggeredBy || 'manual_trigger', 300);
    if (!acquired) {
      throw new Error(`Colectarea pentru ${entry.name} este deja în curs de execuție în alt proces.`);
    }

    this.activeJobsCount++;

    try {
      const collector = getCollectorForRetailer(retailerId);

      // Verificăm eligibilitatea
      const eligibility = await collector.checkEligibility();
      if (!options.payload && !eligibility.eligible) {
        // Nu inventăm scraping pe surse neautorizate!
        RetailerRegistry.updateRetailerStatus(retailerId, eligibility.status, eligibility.reason);
        throw new Error(`Sursa ${entry.name} este suspendată / neautorizată: ${eligibility.reason}`);
      }

      // Execuție cu retry limitat și backoff exponențial (fără bucle infinite)
      let attempt = 0;
      let lastError: any = null;
      let batch: any = null;

      while (attempt < entry.maxRetries) {
        try {
          attempt++;
          // Aplicăm timeout
          batch = await Promise.race([
            collector.collectBatch(options),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout de colectare depășit (${entry.timeoutMs}ms)`)), entry.timeoutMs)
            )
          ]);
          break; // Succes
        } catch (err: any) {
          lastError = err;

          // Circuit breaker imediat pentru răspunsuri de securitate 403 Forbidden sau 429 Too Many Requests
          if (err.message?.includes('403') || err.message?.includes('429')) {
            RetailerRegistry.updateRetailerStatus(
              retailerId,
              'degraded',
              `Circuit Breaker declanșat: Răspuns de limitare sau refuz acces (${err.message})`
            );
            break;
          }

          if (attempt < entry.maxRetries) {
            const backoffDelay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 8000);
            await new Promise(res => setTimeout(res, backoffDelay));
          }
        }
      }

      if (!batch) {
        const failureResult: BatchProcessingResult = {
          batchId: `batch-err-${retailerId}-${Date.now()}`,
          retailerId,
          sourceId: entry.sourceId,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 0,
          status: 'failed',
          recordsTotal: 0,
          recordsValid: 0,
          recordsInvalid: 1,
          duplicatesFound: 0,
          autoMatchedCount: 0,
          candidatesCreatedCount: 0,
          priceChangesCount: 0,
          offersUpsertedCount: 0,
          observationsAppendedCount: 0,
          errors: [lastError?.message || 'Eroare necunoscută la colectare'],
          summary: `Colectare eșuată pentru ${entry.name}: ${lastError?.message}`,
          persisted: false,
          persistenceMode: 'demo_memory'
        };

        RetailerRegistry.recordExecution(retailerId, failureResult);
        return failureResult;
      }

      // Procesare prin pipeline
      const result = await ProcessingPipeline.processBatch(batch, { dryRun: options.dryRun });
      return result;
    } finally {
      this.activeJobsCount--;
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Pornește scheduler-ul pentru execuțiile zilnice (ora 04:00 Europe/Bucharest)
   */
  static startScheduler(options: { checkIntervalMs?: number } = {}): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isShuttingDown = false;

    const interval = options.checkIntervalMs || 60000; // Verifică în fiecare minut
    this.timerId = setInterval(() => {
      this.checkAndTriggerDailyCycle().catch(err => {
        console.warn('Eroare ciclu scheduler indexare:', err.message);
      });
    }, interval);

    // Înregistrare hook-uri de oprire corectă a procesului
    this.setupGracefulShutdown();
  }

  /**
   * Oprește scheduler-ul și eliberează resursele
   */
  static stopScheduler(): void {
    this.isShuttingDown = true;
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.currentLockKey) {
      this.releaseLock(this.currentLockKey).catch(() => {});
    }
  }

  /**
   * Returnează starea curentă a scheduler-ului
   */
  static getStatus(): SchedulerStatus {
    const now = new Date();
    // Calculează următoarea execuție programată la ora 04:00
    const nextRun = new Date(now);
    nextRun.setHours(4, 0, 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return {
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      timezone: this.timezone,
      nextScheduledRun: nextRun.toISOString(),
      activeLock: this.currentLockKey,
      activeWorkersCount: this.activeJobsCount
    };
  }

  /**
   * Verifică dacă este momentul pentru ciclul zilnic
   */
  private static async checkAndTriggerDailyCycle(): Promise<void> {
    if (this.isShuttingDown) return;

    // Obținem ora curentă în fusul orar Europe/Bucharest
    const nowRo = new Date().toLocaleString('en-US', { timeZone: this.timezone });
    const roDate = new Date(nowRo);
    const hours = roDate.getHours();
    const minutes = roDate.getMinutes();

    // Declansare doar la ora 04:00
    if (hours === 4 && minutes === 0) {
      const lockKey = 'lock-daily-indexing-cycle';
      const acquired = await this.acquireLock(lockKey, 'daily_scheduler', 1800);
      if (!acquired) {
        return; // Deja preluat de o altă instanță a serverului
      }

      try {
        const retailers = RetailerRegistry.getAllRetailers();
        for (const r of retailers) {
          // Doar sursele active sunt colectate automat!
          if (r.status === 'active') {
            await this.runRetailerJob(r.retailerId, { triggeredBy: 'daily_cron' });
            // Rate limiting politicos: pauză de 3 secunde între retaileri diferiți
            await new Promise(res => setTimeout(res, 3000));
          }
        }
      } finally {
        await this.releaseLock(lockKey);
      }
    }
  }

  private static setupGracefulShutdown(): void {
    const handleExit = () => {
      this.stopScheduler();
    };

    try {
      process.once('SIGTERM', handleExit);
      process.once('SIGINT', handleExit);
    } catch {
      // Ignorare în medii restrânse
    }
  }
}
