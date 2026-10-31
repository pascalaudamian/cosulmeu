// src/indexing/RetailerRegistry.ts
// Registrul Centralizat al celor 7 Retaileri din România pentru Motorul de Indexare

import { RetailerRegistryEntry, CollectorStatus, CollectorAccessMethod, BatchProcessingResult } from './types';
import { getPool } from '../db/index';

export const INITIAL_RETAILER_ENTRIES: RetailerRegistryEntry[] = [
  {
    retailerId: 'lidl',
    sourceId: 'src-lidl-collector',
    name: 'Lidl România',
    chain: 'Lidl România',
    accessMethod: 'official_feed',
    status: 'configured',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 20,
    maxBatchItems: 500,
    timeoutMs: 10000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'Configurat pentru import manual/dry-run pe format oficial CSV/XML. Sincronizarea automată web așteaptă validarea formală a canalului.',
    offersCount: 8,
    autoMatchRate: 92,
    pendingCandidatesCount: 1,
    isProtectedByAuth: true,
    requiresPartnerToken: false
  },
  {
    retailerId: 'kaufland',
    sourceId: 'src-kaufland-collector',
    name: 'Kaufland România',
    chain: 'Kaufland România',
    accessMethod: 'authorized_api',
    status: 'pending_authorization',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 15,
    maxBatchItems: 400,
    timeoutMs: 10000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'În așteptarea acreditării oficiale de acces la API-ul național deschis (Consiliul Concurenței / Parteneriat Kaufland).',
    offersCount: 7,
    autoMatchRate: 88,
    pendingCandidatesCount: 0,
    isProtectedByAuth: true,
    requiresPartnerToken: true
  },
  {
    retailerId: 'carrefour',
    sourceId: 'src-carrefour-collector',
    name: 'Carrefour România',
    chain: 'Carrefour România',
    accessMethod: 'official_feed',
    status: 'pending_authorization',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 20,
    maxBatchItems: 500,
    timeoutMs: 10000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'În așteptarea configurării credențialelor de acces la feed-ul oficial de produse și promoții.',
    offersCount: 7,
    autoMatchRate: 90,
    pendingCandidatesCount: 0,
    isProtectedByAuth: true,
    requiresPartnerToken: true
  },
  {
    retailerId: 'penny',
    sourceId: 'src-penny-collector',
    name: 'Penny România',
    chain: 'Penny România',
    accessMethod: 'manual_import',
    status: 'disabled',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 15,
    maxBatchItems: 300,
    timeoutMs: 8000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'Dezactivat - necesită acord formal de reutilizare a datelor și confirmarea specificației de format.',
    offersCount: 6,
    autoMatchRate: 85,
    pendingCandidatesCount: 0,
    isProtectedByAuth: true,
    requiresPartnerToken: false
  },
  {
    retailerId: 'auchan',
    sourceId: 'src-auchan-collector',
    name: 'Auchan România',
    chain: 'Auchan România',
    accessMethod: 'authorized_api',
    status: 'pending_authorization',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 15,
    maxBatchItems: 400,
    timeoutMs: 10000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'În așteptarea aprobării accesului la feed-ul oficial B2B / API autorizat.',
    offersCount: 6,
    autoMatchRate: 87,
    pendingCandidatesCount: 0,
    isProtectedByAuth: true,
    requiresPartnerToken: true
  },
  {
    retailerId: 'profi',
    sourceId: 'src-profi-collector',
    name: 'Profi Rom Food',
    chain: 'Profi Rom Food',
    accessMethod: 'manual_import',
    status: 'disabled',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 15,
    maxBatchItems: 300,
    timeoutMs: 8000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'Dezactivat - fără specificație tehnică autorizată pentru prețurile specifice magazinelor de proximitate.',
    offersCount: 5,
    autoMatchRate: 80,
    pendingCandidatesCount: 0,
    isProtectedByAuth: true,
    requiresPartnerToken: false
  },
  {
    retailerId: 'mega-image',
    sourceId: 'src-mega-image-collector',
    name: 'Mega Image',
    chain: 'Mega Image',
    accessMethod: 'authorized_api',
    status: 'pending_authorization',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 15,
    maxBatchItems: 350,
    timeoutMs: 10000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'Necesită token de acces la catalogul de date deschise și acord de reutilizare necomercială/comercială.',
    offersCount: 6,
    autoMatchRate: 86,
    pendingCandidatesCount: 0,
    isProtectedByAuth: true,
    requiresPartnerToken: true
  },
  {
    retailerId: 'metro',
    sourceId: 'src-metro-collector',
    name: 'Metro Cash & Carry România',
    chain: 'Metro România',
    accessMethod: 'public_catalog_feed',
    status: 'pending_authorization',
    collectionIntervalSeconds: 86400,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Bucharest',
    rateLimitRpm: 15,
    maxBatchItems: 400,
    timeoutMs: 10000,
    maxRetries: 3,
    consecutiveFailures: 0,
    suspensionReason: 'În așteptarea configurării accesului la catalogul public digital / acreditare prețuri engros și retail Metro România.',
    offersCount: 6,
    autoMatchRate: 85,
    pendingCandidatesCount: 0,
    isProtectedByAuth: true,
    requiresPartnerToken: true
  }
];

export class RetailerRegistry {
  private static entries: Map<string, RetailerRegistryEntry> = new Map(
    INITIAL_RETAILER_ENTRIES.map(e => [e.retailerId, { ...e }])
  );

  /**
   * Returnează toate cele 7 înregistrări de retaileri
   */
  static getAllRetailers(): RetailerRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Returnează înregistrarea unui retailer specific
   */
  static getRetailer(retailerId: string): RetailerRegistryEntry | undefined {
    return this.entries.get(retailerId);
  }

  /**
   * Actualizează statutul unui retailer (ex: paused, degraded, active, configured)
   */
  static updateRetailerStatus(
    retailerId: string,
    status: CollectorStatus,
    reason?: string
  ): RetailerRegistryEntry | undefined {
    const entry = this.entries.get(retailerId);
    if (!entry) return undefined;

    entry.status = status;
    if (reason !== undefined) {
      entry.suspensionReason = reason;
    }
    if (status === 'active' || status === 'configured') {
      entry.consecutiveFailures = 0;
    }

    this.syncToDatabase(entry);
    return { ...entry };
  }

  /**
   * Înregistrează rezultatul unei execuții (succes sau eșec) și gestionează circuit breaker-ul
   */
  static recordExecution(retailerId: string, result: BatchProcessingResult): void {
    const entry = this.entries.get(retailerId);
    if (!entry) return;

    entry.lastRunAt = result.completedAt;

    if (result.status === 'complete' || result.status === 'partial') {
      entry.lastSuccessAt = result.completedAt;
      entry.consecutiveFailures = 0;
      entry.offersCount += result.offersUpsertedCount;
      if (result.recordsValid > 0) {
        entry.autoMatchRate = Math.round((result.autoMatchedCount / result.recordsValid) * 100);
      }
      entry.pendingCandidatesCount += result.candidatesCreatedCount;

      // Dacă era degradat dar a reușit, revine la configured/active
      if (entry.status === 'degraded') {
        entry.status = 'configured';
        entry.suspensionReason = 'Recuperat automat după execuție reușită.';
      }
    } else {
      // Eșec
      entry.consecutiveFailures++;
      entry.lastErrorReason = result.errors[0] || 'Eroare necunoscută la execuție';

      // Prudent Circuit Breaker: după 3 eșecuri consecutive, degradează sursa
      if (entry.consecutiveFailures >= 3 && entry.status !== 'paused') {
        entry.status = 'degraded';
        entry.suspensionReason = `Suspendat prudent după ${entry.consecutiveFailures} eșecuri consecutive: ${entry.lastErrorReason}`;
      }
    }

    this.syncToDatabase(entry);
  }

  /**
   * Resetează registrul la starea inițială (util în teste)
   */
  static resetToDefault(): void {
    this.entries = new Map(INITIAL_RETAILER_ENTRIES.map(e => [e.retailerId, { ...e }]));
  }

  /**
   * Salvează asincron modificările în tabela retailer_collectors dacă PostgreSQL este activ
   */
  private static async syncToDatabase(entry: RetailerRegistryEntry): Promise<void> {
    const pool = getPool();
    if (!pool) return;

    try {
      await pool.query(
        `INSERT INTO retailer_collectors (
          retailer_id, source_id, name, access_method, status,
          cron_expression, timezone, rate_limit_rpm, max_batch_items,
          timeout_ms, max_retries, consecutive_failures, last_run_at,
          last_success_at, last_error_reason, suspension_reason, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        ON CONFLICT (retailer_id) DO UPDATE SET
          status = EXCLUDED.status,
          consecutive_failures = EXCLUDED.consecutive_failures,
          last_run_at = EXCLUDED.last_run_at,
          last_success_at = EXCLUDED.last_success_at,
          last_error_reason = EXCLUDED.last_error_reason,
          suspension_reason = EXCLUDED.suspension_reason,
          updated_at = NOW()`,
        [
          entry.retailerId,
          entry.sourceId,
          entry.name,
          entry.accessMethod,
          entry.status,
          entry.cronExpression,
          entry.timezone,
          entry.rateLimitRpm,
          entry.maxBatchItems,
          entry.timeoutMs,
          entry.maxRetries,
          entry.consecutiveFailures,
          entry.lastRunAt || null,
          entry.lastSuccessAt || null,
          entry.lastErrorReason || null,
          entry.suspensionReason || null
        ]
      );
    } catch {
      // Izolat fără a bloca memoria aplicației
    }
  }
}
