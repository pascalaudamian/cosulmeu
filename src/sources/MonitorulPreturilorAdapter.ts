import {
  PriceSourceAdapter,
  RawPriceRecord,
  ValidationResult,
  SourceImportResult
} from './PriceSourceAdapter';
import { SourceSyncRun, ProductOffer, ProductMatchCandidate } from '../types';
import { StorageService } from '../services/StorageService';

export class MonitorulPreturilorAdapter implements PriceSourceAdapter {
  readonly id = 'src-monitorul-preturilor';
  readonly name = 'Monitorul Prețurilor (Consiliul Concurenței)';
  readonly type = 'authorized_api' as const;

  private isAuthorized = false;
  private apiKey: string | null = null;
  private endpointUrl: string | null = null;

  constructor(apiKey?: string, endpointUrl?: string) {
    this.apiKey = apiKey || null;
    this.endpointUrl = endpointUrl || null;
    this.isAuthorized = Boolean(this.apiKey && this.endpointUrl);
  }

  /**
   * Explains the formal protocol and authorization status
   */
  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    if (!this.isAuthorized) {
      return {
        available: false,
        reason:
          'Integrarea cu Monitorul Prețurilor este pregătită arhitectural, dar dezactivată implicit conform regulamentului. ' +
          'Aplicația Coșul Meu nu folosește endpoint-uri obținute prin inginerie inversă sau neautorizate. ' +
          'Pentru activare, este necesară obținerea unei chei oficiale de acces acordate de Consiliul Concurenței.'
      };
    }
    return { available: true };
  }

  async getLastSync(): Promise<SourceSyncRun | null> {
    const runs = StorageService.getSyncRuns().filter(r => r.sourceId === this.id);
    return runs[0] || null;
  }

  validateRecords(records: RawPriceRecord[]): ValidationResult {
    return {
      valid: [],
      invalid: records.map(r => ({ record: r, reason: 'Sursă inactivă în așteptarea autorizării' })),
      duplicatesCount: 0
    };
  }

  normalize(): { offers: ProductOffer[]; matchCandidates: ProductMatchCandidate[] } {
    return { offers: [], matchCandidates: [] };
  }

  async importData(): Promise<SourceImportResult> {
    const startedAt = new Date().toISOString();
    const completedAt = new Date().toISOString();

    const syncRun: SourceSyncRun = {
      id: `sync-mp-${Date.now()}`,
      sourceId: this.id,
      sourceName: this.name,
      startedAt,
      completedAt,
      status: 'failed',
      recordsProcessed: 0,
      recordsImported: 0,
      duplicatesFound: 0,
      invalidRecords: 0,
      errors: [
        'Sursa „Monitorul Prețurilor” necesită autorizare oficială din partea Consiliul Concurenței României.'
      ],
      summary: 'Import respins: cheie API autorizată lipsă. Consultați ghidul de solicitare oficială din panoul de administrare.'
    };

    StorageService.addSyncRun(syncRun);

    return {
      success: false,
      syncRun,
      importedOffers: [],
      matchCandidates: [],
      summaryMessage: syncRun.summary
    };
  }

  /**
   * Documentation on how to request formal access from Consiliul Concurenței
   */
  static getAuthorizationGuide(): {
    institution: string;
    project: string;
    legalBasis: string;
    contactEmail: string;
    steps: string[];
  } {
    return {
      institution: 'Consiliul Concurenței din România',
      project: 'Monitorul Prețurilor Produselor Alimentare (monitorulpreturilor.info)',
      legalBasis: 'Legea nr. 544/2001 privind liberul acces la informațiile de interes public & Directiva Europeană Open Data (2019/1024)',
      contactEmail: 'contact@consiliulconcurentei.ro',
      steps: [
        '1. Transmiterea unei cereri formale de acces la datele deschise sau API ale platformei Monitorul Prețurilor în baza Legii 544/2001.',
        '2. Precizarea scopului civic și necomercial / de informare a consumatorilor pentru aplicația „Coșul Meu”.',
        '3. Semnarea acordului de parteneriat sau obținerea credențialelor tehnice agreate (API Token & Rate Limits).',
        '4. Configurarea variabilei de mediu `MONITORUL_PRETURILOR_API_KEY` în panoul securizat al serverului.',
        '5. Activarea sincronizării periodice din interfața de administrare.'
      ]
    };
  }
}
