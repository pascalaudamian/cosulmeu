import type {
  ShadowMatchCandidate,
  ShadowMatchDecisionCategory,
  ShadowMatchingReport,
  ShadowReviewAuditEntry,
  ShadowReviewCandidateView,
  ShadowReviewDecisionRecord,
  ShadowReviewOverviewStats,
  ShadowReviewStatus
} from '../types.js';
import { getPool } from '../db/index.js';
import { StorageService } from './StorageService.js';

export interface VerifiedAdminReviewer {
  reviewerId: string;
  reviewerEmail: string;
  authSource: 'admin_bearer_token' | 'supabase_admin_session';
  ipAddress?: string;
}

export interface ShadowReviewListParams {
  decisionCategory?: 'inspectable' | ShadowMatchDecisionCategory | 'all';
  reviewStatus?: 'all' | ShadowReviewStatus;
  retailer?: string;
  category?: string;
  search?: string;
  sort?: 'score_desc' | 'score_asc' | 'generated_desc';
  page?: number;
  limit?: number;
}

export interface ShadowReviewListResult {
  overview: ShadowReviewOverviewStats;
  items: ShadowReviewCandidateView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  availableRetailers: string[];
  availableCategories: string[];
  dataSource: ShadowMatchingReport['dataSource'];
  readOnlyCatalogVerified: true;
  autoMergeExecuted: false;
}

export interface SubmitShadowReviewDecisionInput {
  candidateId: string;
  status: ShadowReviewStatus;
  reason: string;
  notes?: string | null;
  expectedVersion?: number;
  reviewer: VerifiedAdminReviewer;
}

export type SubmitShadowReviewDecisionResult =
  | {
      ok: true;
      statusCode: 200;
      idempotentReplay: boolean;
      autoMergeExecuted: false;
      candidate: ShadowMatchCandidate;
      decision: ShadowReviewDecisionRecord;
      auditEntry: ShadowReviewAuditEntry | null;
    }
  | {
      ok: false;
      statusCode: 400 | 404 | 409;
      code:
        | 'CANDIDATE_NOT_FOUND'
        | 'GUARD_BLOCKED_CANNOT_CONFIRM'
        | 'LOW_CONFIDENCE_CANNOT_CONFIRM'
        | 'VERSION_CONFLICT'
        | 'INVALID_INPUT';
      error: string;
      currentVersion?: number;
      currentDecision?: ShadowReviewDecisionRecord;
    };

const CACHE_TTL_MS = 15_000;
let cachedReport: { report: ShadowMatchingReport; fetchedAt: number } | null = null;
const activeLocks = new Set<string>();

function createDefaultDecisionRecord(candidate: ShadowMatchCandidate): ShadowReviewDecisionRecord {
  return {
    candidateId: candidate.candidateId,
    status: 'pending_review',
    reviewerId: '',
    reviewerEmail: '',
    authSource: 'admin_bearer_token',
    reason: '',
    notes: null,
    reviewedAt: null,
    updatedAt: candidate.generatedAt,
    version: 0,
    decisionCategorySnapshot: candidate.decisionCategory,
    matchingScoreSnapshot: candidate.matchingScore
  };
}

export class ShadowReviewService {
  static clearCache(): void {
    cachedReport = null;
  }

  private static async loadReport(): Promise<ShadowMatchingReport> {
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';
    if (!isIsolated && cachedReport && Date.now() - cachedReport.fetchedAt < CACHE_TTL_MS) {
      return cachedReport.report;
    }

    // Dynamic import avoids circular runtime initialization issues with DatabaseService
    const { DatabaseService } = await import('../db/index.js');
    const report = await DatabaseService.getShadowMatchingReport({
      includeLowConfidence: true,
      maxReportCandidates: 2000,
      maxCandidatesPerProduct: 25,
      sampleLimit: 50
    });

    if (!isIsolated) {
      cachedReport = { report, fetchedAt: Date.now() };
    }
    return report;
  }

  /**
   * Collects all inspectable + sampled Shadow candidates without altering their evidence or identity.
   */
  private static collectAllCandidatesFromReport(report: ShadowMatchingReport): ShadowMatchCandidate[] {
    const byId = new Map<string, ShadowMatchCandidate>();
    const pushAll = (list: ShadowMatchCandidate[] | undefined) => {
      for (const c of list || []) {
        if (c && c.candidateId && !byId.has(c.candidateId)) {
          byId.set(c.candidateId, c);
        }
      }
    };
    pushAll(report.candidates);
    pushAll(report.samples?.highConfidence);
    pushAll(report.samples?.review);
    pushAll(report.samples?.blocked);
    pushAll(report.samples?.lowConfidence);
    pushAll(report.samples?.differentStructureSameTotal);
    return Array.from(byId.values());
  }

  private static async loadPersistedReviewsAndAudit(): Promise<{
    reviewsByCandidateId: Map<string, ShadowReviewDecisionRecord>;
    auditEntries: ShadowReviewAuditEntry[];
  }> {
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';
    const pool = isIsolated ? null : getPool();

    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_email, user_id, target_id, details, created_at
           FROM admin_audit_logs
           WHERE target_type = 'shadow_candidate'
             AND action = 'shadow_match_review_decision'
           ORDER BY created_at ASC`
        );

        const reviewsByCandidateId = new Map<string, ShadowReviewDecisionRecord>();
        const auditEntriesDesc: ShadowReviewAuditEntry[] = [];

        for (const row of res.rows) {
          const d = (row.details || {}) as Record<string, any>;
          const candidateId = String(row.target_id || d.candidateId || '');
          if (!candidateId) continue;

          const timestamp = row.created_at
            ? new Date(row.created_at).toISOString()
            : String(d.timestamp || new Date().toISOString());

          const decision: ShadowReviewDecisionRecord = {
            candidateId,
            status: (d.newStatus || 'pending_review') as ShadowReviewStatus,
            reviewerId: String(d.reviewerId || row.user_id || 'admin-bearer-authenticated'),
            reviewerEmail: String(d.reviewerEmail || row.user_email || 'admin@system.local'),
            authSource: (d.authSource || 'admin_bearer_token') as ShadowReviewDecisionRecord['authSource'],
            reason: String(d.reason || ''),
            notes: d.notes ?? null,
            reviewedAt: d.newStatus === 'pending_review' ? null : String(d.reviewedAt || timestamp),
            updatedAt: timestamp,
            version: Number(d.version) || 1,
            decisionCategorySnapshot: (d.decisionCategorySnapshot || 'REVIEW') as ShadowMatchDecisionCategory,
            matchingScoreSnapshot: Number(d.matchingScoreSnapshot) || 0
          };
          reviewsByCandidateId.set(candidateId, decision);

          auditEntriesDesc.unshift({
            id: String(row.id),
            candidateId,
            previousStatus: (d.previousStatus || 'pending_review') as ShadowReviewStatus,
            newStatus: (d.newStatus || 'pending_review') as ShadowReviewStatus,
            reviewerId: decision.reviewerId,
            reviewerEmail: decision.reviewerEmail,
            reason: decision.reason,
            notes: decision.notes ?? null,
            timestamp,
            version: decision.version
          });
        }

        if (res.rows.length > 0) {
          return { reviewsByCandidateId, auditEntries: auditEntriesDesc };
        }
      } catch {
        // Fallback smoothly to in-memory StorageService if PG audit table is unavailable
      }
    }

    const storedReviews = StorageService.getShadowMatchReviews();
    const reviewsByCandidateId = new Map<string, ShadowReviewDecisionRecord>();
    for (const r of storedReviews) {
      reviewsByCandidateId.set(r.candidateId, r);
    }
    const auditEntries = StorageService.getShadowReviewAuditLogs();
    return { reviewsByCandidateId, auditEntries };
  }

  private static async persistReviewAndAudit(params: {
    decision: ShadowReviewDecisionRecord;
    auditEntry: ShadowReviewAuditEntry;
    ipAddress?: string;
  }): Promise<void> {
    const isIsolated = process.env.COSUL_MEU_ISOLATED_TEST === '1';
    const pool = isIsolated ? null : getPool();

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO admin_audit_logs (id, user_email, user_id, action, target_type, target_id, details, ip_address, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            params.auditEntry.id,
            params.decision.reviewerEmail,
            params.decision.reviewerId,
            'shadow_match_review_decision',
            'shadow_candidate',
            params.decision.candidateId,
            JSON.stringify({
              candidateId: params.decision.candidateId,
              previousStatus: params.auditEntry.previousStatus,
              newStatus: params.decision.status,
              reviewerId: params.decision.reviewerId,
              reviewerEmail: params.decision.reviewerEmail,
              authSource: params.decision.authSource,
              reason: params.decision.reason,
              notes: params.decision.notes ?? null,
              reviewedAt: params.decision.reviewedAt,
              version: params.decision.version,
              decisionCategorySnapshot: params.decision.decisionCategorySnapshot,
              matchingScoreSnapshot: params.decision.matchingScoreSnapshot,
              timestamp: params.auditEntry.timestamp
            }),
            params.ipAddress || null
          ]
        );
        return;
      } catch {
        // Fall back to StorageService in-memory store if PG write fails
      }
    }

    const existing = StorageService.getShadowMatchReviews().filter(
      r => r.candidateId !== params.decision.candidateId
    );
    StorageService.saveShadowMatchReviews([params.decision, ...existing]);
    StorageService.addShadowReviewAuditLog(params.auditEntry);
  }

  static computeOverviewStats(
    report: ShadowMatchingReport,
    allCandidates: ShadowMatchCandidate[],
    reviewsByCandidateId: Map<string, ShadowReviewDecisionRecord>
  ): ShadowReviewOverviewStats {
    let totalPending = 0;
    let confirmedSameProductCount = 0;
    let confirmedDifferentProductCount = 0;
    let needsMoreInformationCount = 0;
    let dismissedCount = 0;

    const inspectable = allCandidates.filter(
      c => c.decisionCategory === 'HIGH_CONFIDENCE' || c.decisionCategory === 'REVIEW'
    );

    for (const c of inspectable) {
      const status = reviewsByCandidateId.get(c.candidateId)?.status || 'pending_review';
      if (status === 'pending_review') totalPending++;
      else if (status === 'confirmed_same_product') confirmedSameProductCount++;
      else if (status === 'confirmed_different_product') confirmedDifferentProductCount++;
      else if (status === 'needs_more_information') needsMoreInformationCount++;
      else if (status === 'dismissed') dismissedCount++;
    }

    // Include any non-inspectable candidates that were marked needs_more_information / dismissed
    for (const c of allCandidates) {
      if (c.decisionCategory === 'HIGH_CONFIDENCE' || c.decisionCategory === 'REVIEW') continue;
      const status = reviewsByCandidateId.get(c.candidateId)?.status;
      if (status === 'confirmed_different_product') confirmedDifferentProductCount++;
      else if (status === 'needs_more_information') needsMoreInformationCount++;
      else if (status === 'dismissed') dismissedCount++;
    }

    return {
      totalInspectableCount: report.summary.highConfidenceCount + report.summary.reviewCount,
      totalPending,
      highConfidenceCount: report.summary.highConfidenceCount,
      reviewCount: report.summary.reviewCount,
      blockedCount: report.summary.blockedCount,
      lowConfidenceCount: report.summary.lowConfidenceCount,
      confirmedSameProductCount,
      confirmedDifferentProductCount,
      needsMoreInformationCount,
      dismissedCount
    };
  }

  static async listCandidates(params: ShadowReviewListParams = {}): Promise<ShadowReviewListResult> {
    const report = await this.loadReport();
    const allCandidates = this.collectAllCandidatesFromReport(report);
    const { reviewsByCandidateId } = await this.loadPersistedReviewsAndAudit();

    const overview = this.computeOverviewStats(report, allCandidates, reviewsByCandidateId);

    const decisionFilter = params.decisionCategory || 'inspectable';
    const statusFilter = params.reviewStatus || 'all';
    const retailerFilter = (params.retailer || 'all').trim().toLowerCase();
    const categoryFilter = (params.category || 'all').trim().toLowerCase();
    const searchNeedle = (params.search || '').trim().toLowerCase();
    const sort = params.sort || 'score_desc';
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));

    const retailerSet = new Set<string>();
    const categorySet = new Set<string>();
    for (const c of allCandidates) {
      if (c.sourceRetailer) retailerSet.add(c.sourceRetailer);
      if (c.targetRetailer) retailerSet.add(c.targetRetailer);
      if (c.sourceCategory) categorySet.add(c.sourceCategory);
      if (c.targetCategory) categorySet.add(c.targetCategory);
    }

    const joined: ShadowReviewCandidateView[] = allCandidates.map(candidate => ({
      candidate,
      review: reviewsByCandidateId.get(candidate.candidateId) || createDefaultDecisionRecord(candidate)
    }));

    const filtered = joined.filter(({ candidate, review }) => {
      if (decisionFilter === 'inspectable') {
        if (candidate.decisionCategory !== 'HIGH_CONFIDENCE' && candidate.decisionCategory !== 'REVIEW') {
          return false;
        }
      } else if (decisionFilter !== 'all' && candidate.decisionCategory !== decisionFilter) {
        return false;
      }

      if (statusFilter !== 'all' && review.status !== statusFilter) {
        return false;
      }

      if (retailerFilter !== 'all' && retailerFilter !== 'toate') {
        const srcRet = candidate.sourceRetailer.toLowerCase();
        const tgtRet = candidate.targetRetailer.toLowerCase();
        if (srcRet !== retailerFilter && tgtRet !== retailerFilter) {
          return false;
        }
      }

      if (categoryFilter !== 'all' && categoryFilter !== 'toate') {
        const srcCat = (candidate.sourceCategory || '').toLowerCase();
        const tgtCat = (candidate.targetCategory || '').toLowerCase();
        if (srcCat !== categoryFilter && tgtCat !== categoryFilter) {
          return false;
        }
      }

      if (searchNeedle) {
        const haystack = [
          candidate.candidateId,
          candidate.sourceProductId,
          candidate.targetProductId,
          candidate.sourceTitle,
          candidate.targetTitle,
          candidate.normalizedSourceTitle || '',
          candidate.normalizedTargetTitle || '',
          candidate.sourceBrand || '',
          candidate.targetBrand || '',
          candidate.sourceBarcode || '',
          candidate.targetBarcode || '',
          candidate.sourceRetailer,
          candidate.targetRetailer
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchNeedle)) {
          return false;
        }
      }

      return true;
    });

    filtered.sort((a, b) => {
      if (sort === 'score_asc') {
        const diff = a.candidate.matchingScore - b.candidate.matchingScore;
        if (Math.abs(diff) > 1e-6) return diff;
      } else if (sort === 'generated_desc') {
        const timeDiff =
          new Date(b.review.updatedAt || b.candidate.generatedAt).getTime() -
          new Date(a.review.updatedAt || a.candidate.generatedAt).getTime();
        if (timeDiff !== 0) return timeDiff;
      } else {
        // score_desc default: HIGH_CONFIDENCE -> REVIEW -> score desc
        const scoreDiff = b.candidate.matchingScore - a.candidate.matchingScore;
        if (Math.abs(scoreDiff) > 1e-6) return scoreDiff;
      }
      return a.candidate.candidateId.localeCompare(b.candidate.candidateId);
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * limit;
    const items = filtered.slice(startIdx, startIdx + limit);

    return {
      overview,
      items,
      total,
      page: safePage,
      limit,
      totalPages,
      availableRetailers: Array.from(retailerSet).sort(),
      availableCategories: Array.from(categorySet).sort(),
      dataSource: report.dataSource,
      readOnlyCatalogVerified: true,
      autoMergeExecuted: false
    };
  }

  static async getCandidateDetail(candidateId: string): Promise<{
    found: true;
    candidate: ShadowMatchCandidate;
    review: ShadowReviewDecisionRecord;
    auditHistory: ShadowReviewAuditEntry[];
    canConfirmSameProduct: boolean;
    confirmationBlockReason: string | null;
    autoMergeExecuted: false;
  } | {
    found: false;
    error: string;
  }> {
    const trimmedId = (candidateId || '').trim();
    if (!trimmedId) {
      return { found: false, error: 'ID-ul candidatului lipsește.' };
    }

    const report = await this.loadReport();
    const allCandidates = this.collectAllCandidatesFromReport(report);
    const candidate = allCandidates.find(c => c.candidateId === trimmedId);
    if (!candidate) {
      return { found: false, error: `Candidatul '${trimmedId}' nu a fost găsit.` };
    }

    const { reviewsByCandidateId, auditEntries } = await this.loadPersistedReviewsAndAudit();
    const review = reviewsByCandidateId.get(trimmedId) || createDefaultDecisionRecord(candidate);
    const auditHistory = auditEntries.filter(e => e.candidateId === trimmedId);

    let canConfirmSameProduct = true;
    let confirmationBlockReason: string | null = null;
    if (candidate.decisionCategory === 'BLOCKED') {
      canConfirmSameProduct = false;
      confirmationBlockReason =
        'Candidat BLOCKED de hard guards — confirmarea ca același produs este blocată în Faza 2.';
    } else if (candidate.decisionCategory === 'LOW_CONFIDENCE') {
      canConfirmSameProduct = false;
      confirmationBlockReason =
        'Candidat LOW_CONFIDENCE — dovezile sunt insuficiente pentru confirmarea ca același produs în Faza 2.';
    }

    return {
      found: true,
      candidate,
      review,
      auditHistory,
      canConfirmSameProduct,
      confirmationBlockReason,
      autoMergeExecuted: false
    };
  }

  static async submitDecision(input: SubmitShadowReviewDecisionInput): Promise<SubmitShadowReviewDecisionResult> {
    const candidateId = (input.candidateId || '').trim();
    const reason = (input.reason || '').trim();
    const notes = input.notes !== undefined && input.notes !== null ? input.notes.trim() || null : null;

    if (!candidateId || reason.length < 3) {
      return {
        ok: false,
        statusCode: 400,
        code: 'INVALID_INPUT',
        error: 'candidateId și reason (minim 3 caractere) sunt obligatorii.'
      };
    }

    // Per-candidate serialized critical section to guarantee clean optimistic concurrency
    if (activeLocks.has(candidateId)) {
      return {
        ok: false,
        statusCode: 409,
        code: 'VERSION_CONFLICT',
        error: 'O altă operațiune de review este în curs pentru acest candidat. Reîncercați.'
      };
    }
    activeLocks.add(candidateId);

    try {
      const report = await this.loadReport();
      const allCandidates = this.collectAllCandidatesFromReport(report);
      const candidate = allCandidates.find(c => c.candidateId === candidateId);

      if (!candidate) {
        return {
          ok: false,
          statusCode: 404,
          code: 'CANDIDATE_NOT_FOUND',
          error: `Candidatul '${candidateId}' nu există.`
        };
      }

      // SAFETY RULE (ETAPA 5): NEVER allow confirming BLOCKED or LOW_CONFIDENCE candidates
      if (input.status === 'confirmed_same_product') {
        if (candidate.decisionCategory === 'BLOCKED') {
          return {
            ok: false,
            statusCode: 400,
            code: 'GUARD_BLOCKED_CANNOT_CONFIRM',
            error:
              'Candidatul este blocat de hard guards (BLOCKED) și nu poate fi confirmat ca același produs în Faza 2.'
          };
        }
        if (candidate.decisionCategory === 'LOW_CONFIDENCE') {
          return {
            ok: false,
            statusCode: 400,
            code: 'LOW_CONFIDENCE_CANNOT_CONFIRM',
            error:
              'Candidatul are încredere scăzută (LOW_CONFIDENCE) și nu poate fi confirmat ca același produs în Faza 2.'
          };
        }
      }

      const { reviewsByCandidateId } = await this.loadPersistedReviewsAndAudit();
      const current = reviewsByCandidateId.get(candidateId) || createDefaultDecisionRecord(candidate);

      if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
        return {
          ok: false,
          statusCode: 409,
          code: 'VERSION_CONFLICT',
          error: `Conflict de versiune: versiunea așteptată (${input.expectedVersion}) diferă de versiunea curentă (${current.version}).`,
          currentVersion: current.version,
          currentDecision: current
        };
      }

      // Idempotent submission check (same target state, reason & notes on an already recorded version or default pending)
      if (
        (current.version > 0 || input.status === 'pending_review') &&
        current.status === input.status &&
        current.reason === reason &&
        (current.notes || null) === notes
      ) {
        return {
          ok: true,
          statusCode: 200,
          idempotentReplay: true,
          autoMergeExecuted: false,
          candidate,
          decision: current,
          auditEntry: null
        };
      }

      if (current.version === 0 && input.status === 'pending_review') {
        return {
          ok: true,
          statusCode: 200,
          idempotentReplay: true,
          autoMergeExecuted: false,
          candidate,
          decision: current,
          auditEntry: null
        };
      }

      const nowIso = new Date().toISOString();
      const nextVersion = current.version + 1;

      // STRICT ANTI-SPOOFING: Reviewer identity ALWAYS comes strictly from authenticated server context
      const decision: ShadowReviewDecisionRecord = {
        candidateId,
        status: input.status,
        reviewerId: input.reviewer.reviewerId,
        reviewerEmail: input.reviewer.reviewerEmail,
        authSource: input.reviewer.authSource,
        reason,
        notes,
        reviewedAt: input.status === 'pending_review' ? null : nowIso,
        updatedAt: nowIso,
        version: nextVersion,
        decisionCategorySnapshot: candidate.decisionCategory,
        matchingScoreSnapshot: candidate.matchingScore
      };

      const auditEntry: ShadowReviewAuditEntry = {
        id: `shd-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        candidateId,
        previousStatus: current.status,
        newStatus: input.status,
        reviewerId: input.reviewer.reviewerId,
        reviewerEmail: input.reviewer.reviewerEmail,
        reason,
        notes,
        timestamp: nowIso,
        version: nextVersion
      };

      await this.persistReviewAndAudit({
        decision,
        auditEntry,
        ipAddress: input.reviewer.ipAddress
      });

      return {
        ok: true,
        statusCode: 200,
        idempotentReplay: false,
        autoMergeExecuted: false,
        candidate,
        decision,
        auditEntry
      };
    } finally {
      activeLocks.delete(candidateId);
    }
  }

  static async listAuditEntries(params?: {
    candidateId?: string;
    limit?: number;
  }): Promise<{ entries: ShadowReviewAuditEntry[]; total: number }> {
    const { auditEntries } = await this.loadPersistedReviewsAndAudit();
    const limit = Math.min(200, Math.max(1, Number(params?.limit) || 50));
    const filtered = params?.candidateId
      ? auditEntries.filter(e => e.candidateId === params.candidateId)
      : auditEntries;
    return {
      entries: filtered.slice(0, limit),
      total: filtered.length
    };
  }
}
