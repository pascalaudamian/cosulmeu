// src/services/IndexerScheduler.ts
// Serviciu de planificare zilnică cu advisory lock PostgreSQL pentru CollectionWorker

import { getPool } from '../db/index.ts';
import { CollectionWorker, CollectionWorkerSummary } from './CollectionWorker.ts';

export interface IndexerSchedulerStatus {
  isRunning: boolean;
  isExecuting: boolean;
  timezone: string;
  targetHour: number;
  targetMinute: number;
  checkIntervalMs: number;
  nextScheduledRun: string;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastResult: CollectionWorkerSummary | null;
  lockMethod: 'pg_advisory_lock' | 'memory_fallback';
}

export class IndexerScheduler {
  private static isRunning = false;
  private static isExecuting = false;
  private static timerId: NodeJS.Timeout | null = null;
  private static timezone = 'Europe/Bucharest';
  private static targetHour = 4; // Ora 04:00 AM Europe/Bucharest
  private static targetMinute = 0;
  private static checkIntervalMs = 60000; // Verifică la fiecare 60 de secunde
  private static lastRunDateStr: string | null = null;
  private static lastRunStartedAt: string | null = null;
  private static lastRunCompletedAt: string | null = null;
  private static lastResult: CollectionWorkerSummary | null = null;

  // Fallback mutex în memorie pentru medii fără PostgreSQL activ (ex: modul demo_memory)
  private static isMemoryLockHeld = false;

  /**
   * Execută explicit interogarea de blocare consultativă în PostgreSQL.
   * Asigură că un singur proces/worker poate rula sarcina la un moment dat.
   */
  static async acquireAdvisoryLock(pg: { query: (sql: string, params?: any[]) => Promise<any> }, lockId = 1): Promise<void> {
    // Apel specific cerut de arhitectura de sincronizare sigură
    await pg.query(`SELECT pg_advisory_lock(${lockId})`);
  }

  /**
   * Eliberează blocarea consultativă în PostgreSQL
   */
  static async releaseAdvisoryLock(pg: { query: (sql: string, params?: any[]) => Promise<any> }, lockId = 1): Promise<void> {
    await pg.query(`SELECT pg_advisory_unlock(${lockId})`);
  }

  /**
   * Execută o funcție de lucru protejată de un PostgreSQL advisory lock (sau fallback în memorie)
   */
  static async runWithAdvisoryLock<T>(workerFn: () => Promise<T>, lockId = 1): Promise<T> {
    const pool = getPool();

    if (pool) {
      const client = await pool.connect();
      let lockAcquired = false;
      try {
        // Apel standard PostgreSQL advisory lock
        await client.query(`SELECT pg_advisory_lock(${lockId})`);
        lockAcquired = true;
        this.isExecuting = true;
        return await workerFn();
      } finally {
        this.isExecuting = false;
        if (lockAcquired) {
          try {
            await client.query(`SELECT pg_advisory_unlock(${lockId})`);
          } catch (unlockErr: any) {
            console.warn('⚠️ Eroare la eliberarea advisory lock în PostgreSQL:', unlockErr.message);
          }
        }
        client.release();
      }
    }

    // Fallback în memorie dacă instanța PostgreSQL nu este conectată (mod demo_memory)
    if (this.isMemoryLockHeld) {
      throw new Error(`Advisory lock (${lockId}) este deja deținut de o altă execuție concurentă.`);
    }

    this.isMemoryLockHeld = true;
    this.isExecuting = true;
    try {
      return await workerFn();
    } finally {
      this.isMemoryLockHeld = false;
      this.isExecuting = false;
    }
  }

  /**
   * Pornește planificatorul zilnic folosind setInterval
   */
  static start(options: {
    targetHour?: number;
    targetMinute?: number;
    checkIntervalMs?: number;
    timezone?: string;
  } = {}): void {
    if (this.isRunning) return;

    this.isRunning = true;
    if (options.targetHour !== undefined) this.targetHour = options.targetHour;
    if (options.targetMinute !== undefined) this.targetMinute = options.targetMinute;
    if (options.checkIntervalMs !== undefined) this.checkIntervalMs = options.checkIntervalMs;
    if (options.timezone !== undefined) this.timezone = options.timezone;

    // Înregistrare ciclu recurent prin setInterval
    this.timerId = setInterval(() => {
      this.checkAndExecute().catch(err => {
        console.error('⚠️ Eroare neașteptată în ciclul planificatorului IndexerScheduler:', err.message);
      });
    }, this.checkIntervalMs);

    if (this.timerId && typeof (this.timerId as any).unref === 'function') {
      (this.timerId as any).unref();
    }

    this.setupGracefulShutdown();
  }

  /**
   * Oprește planificatorul și curăță timer-ul activ
   */
  static stop(): void {
    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Configurează parametrii de planificare (oră, minut, fus orar, interval)
   */
  static configure(options: {
    targetHour?: number;
    targetMinute?: number;
    checkIntervalMs?: number;
    timezone?: string;
  }): void {
    if (options.targetHour !== undefined) this.targetHour = options.targetHour;
    if (options.targetMinute !== undefined) this.targetMinute = options.targetMinute;
    if (options.checkIntervalMs !== undefined) this.checkIntervalMs = options.checkIntervalMs;
    if (options.timezone !== undefined) this.timezone = options.timezone;
  }


  /**
   * Verifică dacă a sosit ora programată pentru execuția zilnică
   */
  static async checkAndExecute(): Promise<boolean> {
    if (!this.isRunning || this.isExecuting) {
      return false;
    }

    const nowRo = new Date().toLocaleString('en-US', { timeZone: this.timezone });
    const roDate = new Date(nowRo);
    const hours = roDate.getHours();
    const minutes = roDate.getMinutes();
    const todayStr = roDate.toISOString().slice(0, 10);

    // Verificăm dacă suntem la ora și minutul programat și dacă nu am rulat deja astăzi
    if (hours === this.targetHour && minutes === this.targetMinute && this.lastRunDateStr !== todayStr) {
      this.lastRunDateStr = todayStr;
      await this.triggerNow({ dryRun: false });
      return true;
    }

    return false;
  }

  /**
   * Declanșează manual colectarea, protejată prin advisory lock
   */
  static async triggerNow(options: {
    dryRun?: boolean;
    retailerIds?: string[];
    samplePayloads?: Record<string, string>;
  } = {}): Promise<CollectionWorkerSummary> {
    this.lastRunStartedAt = new Date().toISOString();

    const summary = await this.runWithAdvisoryLock(async () => {
      return await CollectionWorker.runDailyCollection(options);
    }, 1);

    this.lastRunCompletedAt = new Date().toISOString();
    this.lastResult = summary;
    return summary;
  }

  /**
   * Returnează starea completă a planificatorului
   */
  static getStatus(): IndexerSchedulerStatus {
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(this.targetHour, this.targetMinute, 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return {
      isRunning: this.isRunning,
      isExecuting: this.isExecuting,
      timezone: this.timezone,
      targetHour: this.targetHour,
      targetMinute: this.targetMinute,
      checkIntervalMs: this.checkIntervalMs,
      nextScheduledRun: nextRun.toISOString(),
      lastRunStartedAt: this.lastRunStartedAt,
      lastRunCompletedAt: this.lastRunCompletedAt,
      lastResult: this.lastResult,
      lockMethod: getPool() ? 'pg_advisory_lock' : 'memory_fallback'
    };
  }

  private static setupGracefulShutdown(): void {
    const handleExit = () => {
      this.stop();
    };

    try {
      process.once('SIGTERM', handleExit);
      process.once('SIGINT', handleExit);
    } catch {
      // Ignorare în runtime-uri speciale
    }
  }
}
