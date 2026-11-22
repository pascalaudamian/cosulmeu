import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GitCompare,
  HelpCircle,
  History,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle
} from 'lucide-react';
import type {
  ShadowMatchCandidate,
  ShadowMatchDecisionCategory,
  ShadowReviewAuditEntry,
  ShadowReviewCandidateView,
  ShadowReviewDecisionRecord,
  ShadowReviewOverviewStats,
  ShadowReviewStatus
} from '../types.js';

interface AdminShadowReviewTabProps {
  adminToken: string;
}

type CategoryFilter = 'inspectable' | ShadowMatchDecisionCategory | 'all';
type StatusFilter = 'all' | ShadowReviewStatus;
type SortOption = 'score_desc' | 'score_asc' | 'generated_desc';

const REVIEW_STATUS_LABELS: Record<ShadowReviewStatus, { label: string; className: string }> = {
  pending_review: {
    label: 'În așteptare',
    className:
      'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
  },
  confirmed_same_product: {
    label: 'Confirmat același produs',
    className:
      'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/70'
  },
  confirmed_different_product: {
    label: 'Confirmat produse diferite',
    className:
      'text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800/70'
  },
  needs_more_information: {
    label: 'Necesită informații',
    className:
      'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/70'
  },
  dismissed: {
    label: 'Respins / Ignorat',
    className:
      'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700'
  }
};

const DECISION_CATEGORY_STYLES: Record<ShadowMatchDecisionCategory, { label: string; className: string }> = {
  HIGH_CONFIDENCE: {
    label: 'HIGH_CONFIDENCE',
    className:
      'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/70'
  },
  REVIEW: {
    label: 'REVIEW',
    className:
      'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/70'
  },
  BLOCKED: {
    label: 'BLOCKED',
    className:
      'text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800/70'
  },
  LOW_CONFIDENCE: {
    label: 'LOW_CONFIDENCE',
    className:
      'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
  }
};

function formatScorePct(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

function formatDateTimeRo(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

export const AdminShadowReviewTab: React.FC<AdminShadowReviewTabProps> = ({ adminToken }) => {
  const [overview, setOverview] = useState<ShadowReviewOverviewStats | null>(null);
  const [items, setItems] = useState<ShadowReviewCandidateView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [limit] = useState(20);
  const [availableRetailers, setAvailableRetailers] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  const [decisionCategory, setDecisionCategory] = useState<CategoryFilter>('inspectable');
  const [reviewStatus, setReviewStatus] = useState<StatusFilter>('all');
  const [retailer, setRetailer] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [sort, setSort] = useState<SortOption>('score_desc');

  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Selected candidate detail
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [detailCandidate, setDetailCandidate] = useState<ShadowMatchCandidate | null>(null);
  const [detailReview, setDetailReview] = useState<ShadowReviewDecisionRecord | null>(null);
  const [detailAudit, setDetailAudit] = useState<ShadowReviewAuditEntry[]>([]);
  const [canConfirmSameProduct, setCanConfirmSameProduct] = useState<boolean>(false);
  const [confirmationBlockReason, setConfirmationBlockReason] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    targetStatus: ShadowReviewStatus;
    title: string;
    description: string;
  } | null>(null);
  const [reasonInput, setReasonInput] = useState<string>('');
  const [notesInput, setNotesInput] = useState<string>('');
  const [isSubmittingDecision, setIsSubmittingDecision] = useState<boolean>(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadCandidatesList = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const qs = new URLSearchParams({
        decisionCategory,
        reviewStatus,
        retailer,
        category,
        search: debouncedSearch,
        sort,
        page: String(page),
        limit: String(limit)
      });
      const res = await fetch(`/api/admin/shadow-matching/reviews?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Nu s-au putut încărca candidații pentru Human Review.');
      }
      setOverview(data.overview || null);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setAvailableRetailers(data.availableRetailers || []);
      setAvailableCategories(data.availableCategories || []);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Eroare la încărcarea listei de candidați.' });
    } finally {
      setIsLoadingList(false);
    }
  }, [adminToken, decisionCategory, reviewStatus, retailer, category, debouncedSearch, sort, page, limit]);

  useEffect(() => {
    loadCandidatesList();
  }, [loadCandidatesList]);

  const loadCandidateDetail = useCallback(
    async (candidateId: string) => {
      setSelectedCandidateId(candidateId);
      setIsLoadingDetail(true);
      try {
        const res = await fetch(`/api/admin/shadow-matching/reviews/${encodeURIComponent(candidateId)}`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Nu s-au putut încărca detaliile candidatului.');
        }
        setDetailCandidate(data.candidate);
        setDetailReview(data.review);
        setDetailAudit(data.auditHistory || []);
        setCanConfirmSameProduct(Boolean(data.canConfirmSameProduct));
        setConfirmationBlockReason(data.confirmationBlockReason || null);
      } catch (err: any) {
        setFeedback({ type: 'error', text: err.message || 'Eroare la deschiderea detaliilor.' });
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [adminToken]
  );

  const openDecisionModal = (targetStatus: ShadowReviewStatus) => {
    if (!detailCandidate) return;
    const labelMap: Record<ShadowReviewStatus, { title: string; description: string; defaultReason: string }> = {
      confirmed_same_product: {
        title: 'Confirmă același produs',
        description:
          'Marchează perechea ca fiind același produs comercial. În Faza 2 NU se execută merge și nu se modifică identitatea canonică.',
        defaultReason: 'Produse echivalente comercial verificate manual (brand, cantitate și variantă).'
      },
      confirmed_different_product: {
        title: 'Confirmă produse diferite',
        description:
          'Marchează perechea ca produse distincte care nu trebuie asociate în etapele viitoare.',
        defaultReason: 'Produse diferite după inspecția manuală a titlului, brandului sau ambalajului.'
      },
      needs_more_information: {
        title: 'Necesită informații suplimentare',
        description:
          'Păstrează candidatul în așteptare pentru verificare suplimentară (EAN, etichetă sau catalog).',
        defaultReason: 'Lipsesc suficiente dovezi privind EAN-ul sau varianta exactă.'
      },
      dismissed: {
        title: 'Dismiss candidat',
        description: 'Închide recomandarea fără confirmare de asociere.',
        defaultReason: 'Candidat irelevant sau insuficient susținut pentru revizie ulterioară.'
      },
      pending_review: {
        title: 'Resetează la pending_review',
        description: 'Readuce statusul la pending_review și înregistrează motivul în jurnalul de audit.',
        defaultReason: 'Resetare manuală pentru reevaluare.'
      }
    };
    const meta = labelMap[targetStatus];
    setReasonInput(meta.defaultReason);
    setNotesInput(detailReview?.notes || '');
    setConfirmModal({
      targetStatus,
      title: meta.title,
      description: meta.description
    });
  };

  const handleSubmitDecision = async () => {
    if (!confirmModal || !detailCandidate) return;
    if (reasonInput.trim().length < 3) {
      setFeedback({ type: 'error', text: 'Motivul deciziei trebuie să conțină cel puțin 3 caractere.' });
      return;
    }

    setIsSubmittingDecision(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/admin/shadow-matching/reviews/${encodeURIComponent(detailCandidate.candidateId)}/decision`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            status: confirmModal.targetStatus,
            reason: reasonInput.trim(),
            notes: notesInput.trim() || null,
            expectedVersion: detailReview?.version
          })
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Nu s-a putut salva decizia de review.');
      }

      setConfirmModal(null);
      setFeedback({
        type: 'success',
        text: data.idempotentReplay
          ? `Decizia pentru ${detailCandidate.candidateId} era deja salvată cu aceleași date.`
          : `Decizia „${REVIEW_STATUS_LABELS[data.decision.status as ShadowReviewStatus].label}” a fost salvată în audit (versiunea v${data.decision.version}, fără merge).`
      });

      await Promise.all([loadCandidatesList(), loadCandidateDetail(detailCandidate.candidateId)]);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Eroare la salvarea deciziei.' });
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Strict Faza 2 Notice */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Human Review Panel — Candidați Shadow Matching
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Inspecție manuală side-by-side cu evidențe explicabile și decizii auditate. Faza 2 NU execută merge și nu modifică produsele, ofertele sau istoricul de preț.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Mod Read-Only Catalog · Zero Merge
          </span>
          <button
            type="button"
            onClick={() => {
              loadCandidatesList();
              if (selectedCandidateId) loadCandidateDetail(selectedCandidateId);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
            Reîncarcă
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-medium flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Overview KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          {
            label: 'Total Pending',
            value: overview?.totalPending ?? 0,
            hint: 'HIGH + REVIEW neevaluate',
            tone: 'text-slate-900 dark:text-slate-100'
          },
          {
            label: 'HIGH_CONFIDENCE',
            value: overview?.highConfidenceCount ?? 0,
            hint: 'Candidați eligibili >= 88%',
            tone: 'text-emerald-700 dark:text-emerald-400'
          },
          {
            label: 'REVIEW',
            value: overview?.reviewCount ?? 0,
            hint: 'Necesită inspecție (68–87%)',
            tone: 'text-amber-700 dark:text-amber-400'
          },
          {
            label: 'Confirmat identic',
            value: overview?.confirmedSameProductCount ?? 0,
            hint: 'Decizie manuală salvată',
            tone: 'text-emerald-700 dark:text-emerald-400'
          },
          {
            label: 'Confirmat diferit',
            value: overview?.confirmedDifferentProductCount ?? 0,
            hint: 'Separare confirmată',
            tone: 'text-rose-700 dark:text-rose-400'
          },
          {
            label: 'Info suplimentare',
            value: overview?.needsMoreInformationCount ?? 0,
            hint: 'Necesită verificare extra',
            tone: 'text-amber-700 dark:text-amber-400'
          },
          {
            label: 'Dismissed',
            value: overview?.dismissedCount ?? 0,
            hint: `Blocked: ${overview?.blockedCount ?? 0} · Low: ${overview?.lowConfidenceCount ?? 0}`,
            tone: 'text-slate-600 dark:text-slate-400'
          }
        ].map(card => (
          <div
            key={card.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5"
          >
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
              {card.label}
            </div>
            <div className={`text-xl font-bold tabular-nums mt-1 ${card.tone}`}>
              {card.value.toLocaleString('ro-RO')}
            </div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate">
              {card.hint}
            </div>
          </div>
        ))}
      </div>

      {/* Filters & Sorting Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Caută după titlu, brand, EAN/barcode, ID..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-emerald-500"
            />
          </div>

          <select
            value={decisionCategory}
            onChange={e => {
              setDecisionCategory(e.target.value as CategoryFilter);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-emerald-500"
          >
            <option value="inspectable">Inspectabile (HIGH + REVIEW)</option>
            <option value="HIGH_CONFIDENCE">Doar HIGH_CONFIDENCE</option>
            <option value="REVIEW">Doar REVIEW</option>
            <option value="BLOCKED">BLOCKED (doar inspecție)</option>
            <option value="LOW_CONFIDENCE">LOW_CONFIDENCE (doar inspecție)</option>
            <option value="all">Toate categoriile</option>
          </select>

          <select
            value={reviewStatus}
            onChange={e => {
              setReviewStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-emerald-500"
          >
            <option value="all">Toate statusurile review</option>
            <option value="pending_review">pending_review</option>
            <option value="confirmed_same_product">confirmed_same_product</option>
            <option value="confirmed_different_product">confirmed_different_product</option>
            <option value="needs_more_information">needs_more_information</option>
            <option value="dismissed">dismissed</option>
          </select>

          <select
            value={retailer}
            onChange={e => {
              setRetailer(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-emerald-500"
          >
            <option value="all">Toți retailerii</option>
            {availableRetailers.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <select
              value={category}
              onChange={e => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className="w-1/2 px-2.5 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-emerald-500"
            >
              <option value="all">Toate categ.</option>
              {availableCategories.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={sort}
              onChange={e => {
                setSort(e.target.value as SortOption);
                setPage(1);
              }}
              className="w-1/2 px-2.5 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-emerald-500"
            >
              <option value="score_desc">Scor desc</option>
              <option value="score_asc">Scor asc</option>
              <option value="generated_desc">Actualizat recent</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Split Workspace: List Table + Side-by-Side Comparison Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Candidate List */}
        <div className={`${selectedCandidateId ? 'xl:col-span-6' : 'xl:col-span-12'} bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Candidați detectați ({total.toLocaleString('ro-RO')})
            </span>
            <span className="tabular-nums">
              Pagina {page} / {totalPages}
            </span>
          </div>

          {isLoadingList ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Se încarcă candidații Shadow Matching...
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Niciun candidat nu corespunde filtrelor selectate
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Schimbă filtrul de categorie (ex. Inspectabile / Toate) sau termenul de căutare.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3">ID & Pereche</th>
                    <th className="py-2.5 px-3">Scor</th>
                    <th className="py-2.5 px-3">Categorie</th>
                    <th className="py-2.5 px-3">Risc</th>
                    <th className="py-2.5 px-3">Status review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {items.map(({ candidate, review }) => {
                    const isSelected = selectedCandidateId === candidate.candidateId;
                    const catStyle = DECISION_CATEGORY_STYLES[candidate.decisionCategory];
                    const revStyle = REVIEW_STATUS_LABELS[review.status];
                    return (
                      <tr
                        key={candidate.candidateId}
                        onClick={() => loadCandidateDetail(candidate.candidateId)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-3 px-3 align-top">
                          <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                            {candidate.candidateId} · {formatDateTimeRo(candidate.generatedAt)}
                          </div>
                          <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">
                            <span className="uppercase text-[10px] text-slate-500 dark:text-slate-400 mr-1.5">
                              {candidate.sourceRetailer}:
                            </span>
                            {candidate.sourceTitle}
                          </div>
                          <div className="mt-0.5 text-slate-700 dark:text-slate-300 line-clamp-1">
                            <span className="uppercase text-[10px] text-slate-500 dark:text-slate-400 mr-1.5">
                              {candidate.targetRetailer}:
                            </span>
                            {candidate.targetTitle}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top tabular-nums font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatScorePct(candidate.matchingScore)}
                        </td>
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold ${catStyle.className}`}>
                            {catStyle.label}
                          </span>
                        </td>
                        <td className="py-3 px-3 align-top whitespace-nowrap text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          {candidate.falsePositiveRisk}
                        </td>
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-semibold ${revStyle.className}`}>
                            {revStyle.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </button>
              <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 cursor-pointer"
              >
                Următor
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Side-by-Side Candidate Inspection & Decision Panel */}
        {selectedCandidateId && (
          <div className="xl:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-5">
            {isLoadingDetail || !detailCandidate || !detailReview ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                Se încarcă detaliile side-by-side...
              </div>
            ) : (
              <>
                {/* Inspector Header */}
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {detailCandidate.candidateId}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${
                          DECISION_CATEGORY_STYLES[detailCandidate.decisionCategory].className
                        }`}
                      >
                        {detailCandidate.decisionCategory}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${
                          REVIEW_STATUS_LABELS[detailReview.status].className
                        }`}
                      >
                        {REVIEW_STATUS_LABELS[detailReview.status].label}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                      Scor: <strong className="text-slate-800 dark:text-slate-200">{formatScorePct(detailCandidate.matchingScore)}</strong> · Metodă: {detailCandidate.matchingMethod} · Versiune review: v{detailReview.version}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCandidateId(null)}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                    aria-label="Închide panoul de comparație"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Explanation & Conflict Warning */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-3 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">Explicație motor Shadow Matching</div>
                  <p>{detailCandidate.explanation}</p>
                  {detailCandidate.differentStructureSameTotal && (
                    <div className="pt-1 text-rose-700 dark:text-rose-400 font-semibold">
                      Conflict structură ambalaj: aceeași cantitate totală, dar structură diferită ({detailCandidate.sourcePackagingStructure} vs {detailCandidate.targetPackagingStructure}).
                    </div>
                  )}
                  {detailCandidate.variantAttributes.conflictReasons.length > 0 && (
                    <div className="pt-1 text-rose-700 dark:text-rose-400 font-semibold">
                      Conflict variante: {detailCandidate.variantAttributes.conflictReasons.join(' ')}
                    </div>
                  )}
                </div>

                {/* Side-by-Side Comparison: Product A vs Product B */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    {
                      label: 'Produs A (Sursă)',
                      id: detailCandidate.sourceProductId,
                      retailer: detailCandidate.sourceRetailer,
                      title: detailCandidate.sourceTitle,
                      normalizedTitle: detailCandidate.normalizedSourceTitle,
                      brand: detailCandidate.sourceBrand,
                      quantity: detailCandidate.sourceQuantity,
                      unit: detailCandidate.sourceUnit,
                      structure: detailCandidate.sourcePackagingStructure,
                      barcode: detailCandidate.sourceBarcode,
                      category: detailCandidate.sourceCategory
                    },
                    {
                      label: 'Produs B (Țintă)',
                      id: detailCandidate.targetProductId,
                      retailer: detailCandidate.targetRetailer,
                      title: detailCandidate.targetTitle,
                      normalizedTitle: detailCandidate.normalizedTargetTitle,
                      brand: detailCandidate.targetBrand,
                      quantity: detailCandidate.targetQuantity,
                      unit: detailCandidate.targetUnit,
                      structure: detailCandidate.targetPackagingStructure,
                      barcode: detailCandidate.targetBarcode,
                      category: detailCandidate.targetCategory
                    }
                  ].map(side => (
                    <div
                      key={side.label}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">{side.label}</span>
                        <span className="uppercase font-semibold text-[11px] text-emerald-700 dark:text-emerald-400">
                          {side.retailer}
                        </span>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Titlu original</div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{side.title}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400">Titlu normalizat</div>
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          {side.normalizedTitle || '—'}
                        </div>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 pt-1 text-[11px]">
                        <div>
                          <dt className="text-slate-400">Brand</dt>
                          <dd className="font-medium text-slate-800 dark:text-slate-200">{side.brand || 'lipsă'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Cantitate / Unitate</dt>
                          <dd className="font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                            {side.quantity || 'lipsă'}{side.unit ? ` (${side.unit})` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Structură ambalaj</dt>
                          <dd className="font-mono text-slate-800 dark:text-slate-200">{side.structure || '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Barcode / EAN</dt>
                          <dd className="font-mono text-slate-800 dark:text-slate-200">{side.barcode || 'lipsă'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">Categorie</dt>
                          <dd className="text-slate-700 dark:text-slate-300">{side.category || '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">ID Produs</dt>
                          <dd className="font-mono text-[10px] text-slate-500 truncate" title={side.id}>
                            {side.id}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>

                {/* Real Engine Score Breakdown */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Componente reale scor ({formatScorePct(detailCandidate.matchingScore)})
                  </div>
                  {detailCandidate.scoreBreakdown ? (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px]">
                      {[
                        ['GTIN/GS1', detailCandidate.scoreBreakdown.gtinScore],
                        ['Brand', detailCandidate.scoreBreakdown.brandScore],
                        ['Titlu', detailCandidate.scoreBreakdown.titleScore],
                        ['Ambalaj', detailCandidate.scoreBreakdown.packagingScore],
                        ['Variantă/Cat.', detailCandidate.scoreBreakdown.variantCategoryScore],
                        ['Penalizări', detailCandidate.scoreBreakdown.penalties]
                      ].map(([lbl, val]) => (
                        <div key={String(lbl)} className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2">
                          <div className="text-[10px] text-slate-400">{lbl}</div>
                          <div className="font-bold tabular-nums text-slate-900 dark:text-slate-100">
                            {Number(val).toFixed(3)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 dark:text-slate-400">Componente scor indisponibile.</div>
                  )}
                </div>

                {/* Evidence: Positive & Negative */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                    <div className="font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" />
                      Dovezi pozitive ({detailCandidate.positiveEvidence.length})
                    </div>
                    {detailCandidate.positiveEvidence.length === 0 ? (
                      <div className="text-[11px] text-slate-400">Nicio dovadă pozitivă.</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {detailCandidate.positiveEvidence.map((ev, idx) => (
                          <li key={`${ev.code}-${idx}`} className="border-t border-slate-100 dark:border-slate-800 pt-1.5 first:border-t-0 first:pt-0">
                            <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                              <span>{ev.label}</span>
                              {ev.weight !== undefined && (
                                <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-400 tabular-nums">
                                  +{ev.weight}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">{ev.detail}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                    <div className="font-bold text-rose-800 dark:text-rose-400 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4" />
                      Dovezi negative / Conflicte ({detailCandidate.negativeEvidence.length})
                    </div>
                    {detailCandidate.negativeEvidence.length === 0 ? (
                      <div className="text-[11px] text-slate-400">Nicio dovadă negativă sau conflict detectat.</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {detailCandidate.negativeEvidence.map((ev, idx) => (
                          <li key={`${ev.code}-${idx}`} className="border-t border-slate-100 dark:border-slate-800 pt-1.5 first:border-t-0 first:pt-0">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{ev.label}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">{ev.detail}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Hard Guards Evaluation */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Hard Guards ({detailCandidate.hardGuardResults.allPassed ? 'Toate trecute' : `${detailCandidate.hardGuardResults.failedGuards.length} blocate`})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                    {detailCandidate.hardGuardResults.checks.map(chk => (
                      <div
                        key={chk.code}
                        className={`rounded-lg border px-2.5 py-1.5 ${
                          chk.passed
                            ? 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 text-slate-700 dark:text-slate-300'
                            : 'border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300'
                        }`}
                      >
                        <div className="font-mono font-semibold text-[10px]">
                          {chk.passed ? 'PASS' : 'BLOCK'} · {chk.code}
                        </div>
                        <div className="text-[11px] opacity-90 mt-0.5">{chk.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Human Review Actions */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Acțiuni Human Review (Faza 2)
                    </div>
                    {detailReview.reviewedAt && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Ultima decizie: {detailReview.reviewerEmail} · {formatDateTimeRo(detailReview.reviewedAt)}
                      </div>
                    )}
                  </div>

                  {!canConfirmSameProduct && confirmationBlockReason && (
                    <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-[11px] text-rose-800 dark:text-rose-200 font-medium">
                      {confirmationBlockReason}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!canConfirmSameProduct}
                      onClick={() => openDecisionModal('confirmed_same_product')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Confirmă același produs
                    </button>

                    <button
                      type="button"
                      onClick={() => openDecisionModal('confirmed_different_product')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Confirmă produse diferite
                    </button>

                    <button
                      type="button"
                      onClick={() => openDecisionModal('needs_more_information')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/50 cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      Necesită info suplimentare
                    </button>

                    <button
                      type="button"
                      onClick={() => openDecisionModal('dismissed')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      Dismiss
                    </button>

                    {detailReview.status !== 'pending_review' && (
                      <button
                        type="button"
                        onClick={() => openDecisionModal('pending_review')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset pending
                      </button>
                    )}
                  </div>
                </div>

                {/* Audit History */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <History className="w-4 h-4 text-slate-500" />
                    Istoric audit review ({detailAudit.length})
                  </div>
                  {detailAudit.length === 0 ? (
                    <div className="text-[11px] text-slate-400">Nicio acțiune de review înregistrată încă.</div>
                  ) : (
                    <ul className="space-y-2 text-[11px]">
                      {detailAudit.map(entry => (
                        <li key={entry.id} className="border-t border-slate-100 dark:border-slate-800 pt-2 first:border-t-0 first:pt-0">
                          <div className="flex items-center justify-between font-semibold text-slate-800 dark:text-slate-200">
                            <span>
                              {entry.previousStatus} → {entry.newStatus} (v{entry.version})
                            </span>
                            <span className="text-slate-400 tabular-nums">{formatDateTimeRo(entry.timestamp)}</span>
                          </div>
                          <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                            Motiv: {entry.reason}
                            {entry.notes ? ` · Note: ${entry.notes}` : ''}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Reviewer verificat: {entry.reviewerId} ({entry.reviewerEmail})
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmModal && detailCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{confirmModal.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{confirmModal.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={isSubmittingDecision}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 text-xs space-y-1">
              <div className="font-mono text-[10px] text-slate-400">{detailCandidate.candidateId}</div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {detailCandidate.sourceRetailer}: {detailCandidate.sourceTitle}
              </div>
              <div className="text-slate-700 dark:text-slate-300">
                {detailCandidate.targetRetailer}: {detailCandidate.targetTitle}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Motiv decizie (obligatoriu, min. 3 caractere)
                </label>
                <input
                  type="text"
                  value={reasonInput}
                  onChange={e => setReasonInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
                  placeholder="Explică motivul deciziei..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Note suplimentare (opțional)
                </label>
                <textarea
                  rows={2}
                  value={notesInput}
                  onChange={e => setNotesInput(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
                  placeholder="Observații pentru auditul Fazei 2/3..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                disabled={isSubmittingDecision}
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                Anulează
              </button>
              <button
                type="button"
                disabled={isSubmittingDecision || reasonInput.trim().length < 3}
                onClick={handleSubmitDecision}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {isSubmittingDecision ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Se salvează...
                  </>
                ) : (
                  'Confirmă decizia'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
