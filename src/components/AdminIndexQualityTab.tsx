// src/components/AdminIndexQualityTab.tsx
// FAZA 5: Panou Administrativ de Monitorizare a Calității Datelor de Preț (STRICT READ-ONLY pe datele de preț)
// Reutilizează PriceQualityClassifier, ProductIdentityService și infrastructura existentă Coșul Meu.

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Clock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  BarChart3,
  Calendar,
  Search,
  Download,
  ExternalLink,
  FileSearch,
  Database,
  GitBranch,
  History,
  X,
  Play,
  Sliders,
  Info
} from 'lucide-react';
import type {
  PriceDataQualityStatus,
  PriceQualityAnomalySeverity,
  PriceQualityAnomalyType,
  PriceQualityClassifiedRecord,
  PriceQualityInvestigationStatus,
  PriceQualityMonitoringAnomaly,
  PriceQualityMonitoringOverview,
  PriceQualityMonitoringRun
} from '../types.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { STORES } from '../data/mockData.js';
import { getQualityStatusDisplay } from '../styles/designTokens.js';
import { EmptyState, ErrorState, LoadingState, QualityStatusBadge } from './ui/StateFeedback.js';

interface AdminIndexQualityTabProps {
  adminToken: string;
  onRefreshAll?: () => void;
  onSelectProduct?: (productId: string) => void;
}

type QualitySectionId =
  | 'overview'
  | 'anomalies'
  | 'expired'
  | 'sources'
  | 'canonical'
  | 'history';

const SECTION_TABS: Array<{ id: QualitySectionId; label: string; shortLabel: string }> = [
  { id: 'overview', label: 'A. Prezentare generală', shortLabel: 'Prezentare' },
  { id: 'anomalies', label: 'B. Prețuri suspecte & anomalii', shortLabel: 'Suspecte' },
  { id: 'expired', label: 'C. Oferte expirate', shortLabel: 'Expirate' },
  { id: 'sources', label: 'D. Calitatea surselor', shortLabel: 'Surse' },
  { id: 'canonical', label: 'E. Integritate canonică', shortLabel: 'Canonică' },
  { id: 'history', label: 'F. Istoric monitorizare', shortLabel: 'Istoric' }
];

const STATUS_META: Array<{
  key: PriceDataQualityStatus;
  labelRo: string;
  barClass: string;
  badgeClass: string;
}> = [
  {
    key: 'VERIFIED_RECENTLY',
    labelRo: getQualityStatusDisplay('VERIFIED_RECENTLY').labelRo,
    barClass: 'bg-emerald-500',
    badgeClass: getQualityStatusDisplay('VERIFIED_RECENTLY').badgeClass
  },
  {
    key: 'VERIFIED',
    labelRo: getQualityStatusDisplay('VERIFIED').labelRo,
    barClass: 'bg-sky-500',
    badgeClass: getQualityStatusDisplay('VERIFIED').badgeClass
  },
  {
    key: 'STALE',
    labelRo: getQualityStatusDisplay('STALE').labelRo,
    barClass: 'bg-amber-400',
    badgeClass: getQualityStatusDisplay('STALE').badgeClass
  },
  {
    key: 'UNVERIFIED',
    labelRo: getQualityStatusDisplay('UNVERIFIED').labelRo,
    barClass: 'bg-slate-400',
    badgeClass: getQualityStatusDisplay('UNVERIFIED').badgeClass
  },
  {
    key: 'EXPIRED',
    labelRo: getQualityStatusDisplay('EXPIRED').labelRo,
    barClass: 'bg-orange-500',
    badgeClass: getQualityStatusDisplay('EXPIRED').badgeClass
  },
  {
    key: 'SUSPICIOUS',
    labelRo: getQualityStatusDisplay('SUSPICIOUS').labelRo,
    barClass: 'bg-rose-500',
    badgeClass: getQualityStatusDisplay('SUSPICIOUS').badgeClass
  }
];

const ANOMALY_TYPE_OPTIONS: Array<{ value: PriceQualityAnomalyType | 'all'; label: string }> = [
  { value: 'all', label: 'Toate tipurile de anomalii' },
  { value: 'zero_or_negative_price', label: 'Preț zero sau negativ' },
  { value: 'extreme_price_outlier', label: 'Variație extremă / outlier' },
  { value: 'inconsistent_promotion', label: 'Promoție inconsistentă' },
  { value: 'incompatible_currency', label: 'Monedă incompatibilă cu RON' },
  { value: 'invalid_timestamp', label: 'Dată / timestamp invalid' },
  { value: 'untrusted_demo_or_estimated_source', label: 'Sursă demo / estimată' },
  { value: 'unit_or_weight_conflict', label: 'Conflict unitate / gramaj' },
  { value: 'expired_offer_active', label: 'Ofertă expirată marcată activă' },
  { value: 'invalid_canonical_identity', label: 'Identitate canonică invalidă' },
  { value: 'conflicting_multi_source_prices', label: 'Prețuri contradictorii multi-sursă' }
];

const INVESTIGATION_LABELS_RO: Record<PriceQualityInvestigationStatus, string> = {
  open: 'Deschisă',
  investigated: 'Investigată',
  confirmed_anomaly: 'Anomalie confirmată',
  false_positive: 'Fals pozitiv',
  needs_source_check: 'Necesită verificare sursă'
};

export const AdminIndexQualityTab: React.FC<AdminIndexQualityTabProps> = ({
  adminToken,
  onRefreshAll,
  onSelectProduct
}) => {
  const [activeSection, setActiveSection] = useState<QualitySectionId>('overview');
  const [intervalDays, setIntervalDays] = useState<number>(30);

  const [overview, setOverview] = useState<PriceQualityMonitoringOverview | null>(null);
  const [anomalies, setAnomalies] = useState<PriceQualityMonitoringAnomaly[]>([]);
  const [anomaliesTotal, setAnomaliesTotal] = useState<number>(0);
  const [anomaliesPage, setAnomaliesPage] = useState<number>(1);
  const [anomaliesTotalPages, setAnomaliesTotalPages] = useState<number>(1);

  const [records, setRecords] = useState<PriceQualityClassifiedRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState<number>(0);
  const [recordsPage, setRecordsPage] = useState<number>(1);
  const [recordsTotalPages, setRecordsTotalPages] = useState<number>(1);

  const [runs, setRuns] = useState<PriceQualityMonitoringRun[]>([]);
  const [runsTotal, setRunsTotal] = useState<number>(0);
  const [runsPage, setRunsPage] = useState<number>(1);
  const [runsTotalPages, setRunsTotalPages] = useState<number>(1);

  // Filters
  const [filterStatus, setFilterStatus] = useState<PriceDataQualityStatus | 'all'>('all');
  const [filterStore, setFilterStore] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterAnomalyType, setFilterAnomalyType] = useState<PriceQualityAnomalyType | 'all'>('all');
  const [filterSeverity, setFilterSeverity] = useState<PriceQualityAnomalySeverity | 'all'>('all');
  const [filterInvStatus, setFilterInvStatus] = useState<PriceQualityInvestigationStatus | 'all'>('all');
  const [filterFromDate, setFilterFromDate] = useState<string>('');
  const [filterToDate, setFilterToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // UI state
  const [isLoadingOverview, setIsLoadingOverview] = useState<boolean>(true);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);
  const [isRunningScan, setIsRunningScan] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showRunConfirmModal, setShowRunConfirmModal] = useState<boolean>(false);

  // Investigation Modal
  const [investigatingAnomaly, setInvestigatingAnomaly] = useState<PriceQualityMonitoringAnomaly | null>(null);
  const [invStatusInput, setInvStatusInput] = useState<PriceQualityInvestigationStatus>('investigated');
  const [invNoteInput, setInvNoteInput] = useState<string>('');
  const [invDecisionInput, setInvDecisionInput] = useState<string>('');
  const [isSavingInvestigation, setIsSavingInvestigation] = useState<boolean>(false);

  const authHeaders = useCallback((): Record<string, string> => {
    return adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
  }, [adminToken]);

  const fetchOverview = useCallback(
    async (refresh = false) => {
      setIsLoadingOverview(true);
      try {
        const res = await fetch(
          `/api/admin/quality-monitoring/overview?intervalDays=${intervalDays}&refresh=${refresh ? 'true' : 'false'}`,
          { headers: authHeaders() }
        );
        const data = await res.json();
        if (res.ok && data.success && data.overview) {
          setOverview(data.overview);
        } else {
          setActionMessage({
            type: 'error',
            text: data.error || 'Nu s-au putut încărca metricile de calitate.'
          });
        }
      } catch (err: any) {
        setActionMessage({
          type: 'error',
          text: `Eroare rețea la citirea monitorizării: ${err.message}`
        });
      } finally {
        setIsLoadingOverview(false);
      }
    },
    [intervalDays, authHeaders]
  );

  const fetchAnomalies = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const params = new URLSearchParams({
        intervalDays: String(intervalDays),
        qualityStatus: filterStatus,
        storeId: filterStore,
        source: filterSource,
        anomalyType: filterAnomalyType,
        severity: filterSeverity,
        investigationStatus: filterInvStatus,
        productQuery: searchQuery.trim(),
        page: String(anomaliesPage),
        limit: '20'
      });
      if (filterFromDate) params.set('fromDate', filterFromDate);
      if (filterToDate) params.set('toDate', filterToDate);

      const res = await fetch(`/api/admin/quality-monitoring/anomalies?${params.toString()}`, {
        headers: authHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAnomalies(data.items || []);
        setAnomaliesTotal(data.total || 0);
        setAnomaliesTotalPages(data.totalPages || 1);
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare la filtrarea anomaliilor: ${err.message}` });
    } finally {
      setIsLoadingList(false);
    }
  }, [
    intervalDays,
    filterStatus,
    filterStore,
    filterSource,
    filterAnomalyType,
    filterSeverity,
    filterInvStatus,
    filterFromDate,
    filterToDate,
    searchQuery,
    anomaliesPage,
    authHeaders
  ]);

  const fetchRecords = useCallback(
    async (recordType: 'expired_offers' | 'all') => {
      setIsLoadingList(true);
      try {
        const params = new URLSearchParams({
          intervalDays: String(intervalDays),
          recordType,
          qualityStatus: recordType === 'expired_offers' ? 'all' : filterStatus,
          storeId: filterStore,
          source: filterSource,
          productQuery: searchQuery.trim(),
          page: String(recordsPage),
          limit: '20'
        });
        if (filterFromDate) params.set('fromDate', filterFromDate);
        if (filterToDate) params.set('toDate', filterToDate);

        const res = await fetch(`/api/admin/quality-monitoring/records?${params.toString()}`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setRecords(data.items || []);
          setRecordsTotal(data.total || 0);
          setRecordsTotalPages(data.totalPages || 1);
        }
      } catch (err: any) {
        setActionMessage({ type: 'error', text: `Eroare la încărcarea înregistrărilor: ${err.message}` });
      } finally {
        setIsLoadingList(false);
      }
    },
    [intervalDays, filterStatus, filterStore, filterSource, filterFromDate, filterToDate, searchQuery, recordsPage, authHeaders]
  );

  const fetchHistory = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const res = await fetch(`/api/admin/quality-monitoring/history?page=${runsPage}&limit=15`, {
        headers: authHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRuns(data.items || []);
        setRunsTotal(data.total || 0);
        setRunsTotalPages(data.totalPages || 1);
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare la încărcarea istoricului: ${err.message}` });
    } finally {
      setIsLoadingList(false);
    }
  }, [runsPage, authHeaders]);

  useEffect(() => {
    fetchOverview(false);
  }, [fetchOverview]);

  useEffect(() => {
    if (activeSection === 'anomalies') {
      fetchAnomalies();
    } else if (activeSection === 'expired') {
      fetchRecords('expired_offers');
    } else if (activeSection === 'history') {
      fetchHistory();
    }
  }, [activeSection, fetchAnomalies, fetchRecords, fetchHistory]);

  const handleRunScan = async () => {
    setIsRunningScan(true);
    try {
      const res = await fetch('/api/admin/quality-monitoring/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({ intervalDays, maxSample: 2500 })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.overview) setOverview(data.overview);
        setActionMessage({
          type: 'success',
          text: `Verificarea a fost executată fără modificări asupra prețurilor: ${data.run.totalRecordsAnalyzed.toLocaleString('ro-RO')} înregistrări analizate, ${data.run.anomaliesDetectedCount} anomalii semnalate.`
        });
        if (activeSection === 'anomalies') fetchAnomalies();
        if (activeSection === 'expired') fetchRecords('expired_offers');
        if (activeSection === 'history') fetchHistory();
        if (onRefreshAll) onRefreshAll();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Nu s-a putut rula scanarea de calitate.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare la scanarea de calitate: ${err.message}` });
    } finally {
      setIsRunningScan(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({
        format,
        intervalDays: String(intervalDays),
        storeId: filterStore,
        source: filterSource,
        anomalyType: filterAnomalyType,
        severity: filterSeverity
      });
      const res = await fetch(`/api/admin/quality-monitoring/export?${params.toString()}`, {
        headers: authHeaders()
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setActionMessage({ type: 'error', text: errData.error || 'Exportul raportului a eșuat.' });
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cosul-meu-calitate-preturi-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setActionMessage({
        type: 'success',
        text: `Raportul ${format.toUpperCase()} a fost exportat și înregistrat în jurnalul administrativ.`
      });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare export: ${err.message}` });
    } finally {
      setIsExporting(false);
    }
  };

  const openInvestigationModal = (anom: PriceQualityMonitoringAnomaly) => {
    setInvestigatingAnomaly(anom);
    setInvStatusInput(anom.investigationStatus === 'open' ? 'investigated' : anom.investigationStatus);
    setInvNoteInput(anom.investigationNote || '');
    setInvDecisionInput(anom.investigationDecision || '');
  };

  const handleSaveInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!investigatingAnomaly) return;
    if (invNoteInput.trim().length < 3) {
      setActionMessage({ type: 'error', text: 'Nota de investigare trebuie să aibă cel puțin 3 caractere.' });
      return;
    }

    setIsSavingInvestigation(true);
    try {
      const res = await fetch(
        `/api/admin/quality-monitoring/anomalies/${encodeURIComponent(investigatingAnomaly.id)}/investigate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders()
          },
          body: JSON.stringify({
            investigationStatus: invStatusInput,
            note: invNoteInput.trim(),
            decision: invDecisionInput.trim() || null,
            anomalyKey: investigatingAnomaly.anomalyKey,
            anomalyType: investigatingAnomaly.anomalyType,
            severity: investigatingAnomaly.severity,
            targetType: investigatingAnomaly.targetType,
            observationId: investigatingAnomaly.observationId || null,
            offerId: investigatingAnomaly.offerId || null,
            productId: investigatingAnomaly.productId,
            storeId: investigatingAnomaly.storeId,
            source: investigatingAnomaly.source
          })
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        setInvestigatingAnomaly(null);
        setActionMessage({
          type: 'success',
          text: 'Investigația a fost salvată și înregistrată în jurnalul de audit fără modificarea istoricului de prețuri.'
        });
        fetchAnomalies();
        fetchOverview(false);
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Nu s-a putut salva investigația.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare rețea: ${err.message}` });
    } finally {
      setIsSavingInvestigation(false);
    }
  };

  const resetFilters = () => {
    setFilterStatus('all');
    setFilterStore('all');
    setFilterSource('all');
    setFilterAnomalyType('all');
    setFilterSeverity('all');
    setFilterInvStatus('all');
    setFilterFromDate('');
    setFilterToDate('');
    setSearchQuery('');
    setAnomaliesPage(1);
    setRecordsPage(1);
  };

  const knownSources = overview?.sourceQuality?.map(s => s.source) || [];

  return (
    <div className="space-y-5">
      {/* Feedback banner */}
      {actionMessage && (
        actionMessage.type === 'error' ? (
          <ErrorState
            compact
            variant="network"
            message={actionMessage.text}
            onRetry={() => fetchOverview(true)}
            onDismiss={() => setActionMessage(null)}
          />
        ) : (
          <div
            role="status"
            aria-live="polite"
            className="p-3.5 rounded-xl text-xs flex items-center justify-between border bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{actionMessage.text}</span>
            </div>
            <button
              type="button"
              aria-label="Închide notificarea"
              onClick={() => setActionMessage(null)}
              className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      )}

      {/* Header bar — strict SaaS discipline (no pulsing dots, unboxed inline coverage metadata) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                Monitorizare Calitate Prețuri & Integritate Catalog
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-mono">
                Read-Only pe prețuri
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Audit determinist bazat pe motorul unic <span className="font-semibold text-slate-700 dark:text-slate-200">PriceQualityClassifier</span> ({overview?.methodologyVersion || 'v1.2.0'}). Datele istorice rămân strict nemodificate.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Interval analizat"
              value={intervalDays}
              onChange={e => {
                setIntervalDays(Number(e.target.value));
                setAnomaliesPage(1);
                setRecordsPage(1);
              }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value={7}>Ultimele 7 zile</option>
              <option value={30}>Ultimele 30 zile</option>
              <option value={90}>Ultimele 90 zile</option>
              <option value={180}>Ultimele 180 zile</option>
              <option value={365}>Ultimele 365 zile</option>
            </select>

            <button
              type="button"
              onClick={() => setShowRunConfirmModal(true)}
              disabled={isRunningScan}
              className="min-h-[38px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
            >
              {isRunningScan ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Rulează verificare</span>
            </button>

            <button
              type="button"
              onClick={() => handleExport('csv')}
              disabled={isExporting}
              className="min-h-[38px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={() => handleExport('json')}
              disabled={isExporting}
              className="min-h-[38px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>

            <button
              type="button"
              aria-label="Reîncarcă sumarul din server"
              onClick={() => fetchOverview(true)}
              disabled={isLoadingOverview}
              title="Reîncarcă sumarul din server"
              className="min-w-[38px] min-h-[38px] flex items-center justify-center p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingOverview ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Coverage & Transparency Strip */}
        {overview && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span>
                Interval: <strong className="text-slate-800 dark:text-slate-200">{overview.coverage.fromDate} – {overview.coverage.toDate}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Actualizat: <strong className="text-slate-800 dark:text-slate-200">{new Date(overview.coverage.lastUpdatedAt).toLocaleString('ro-RO')}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Analizate: <strong className="text-slate-800 dark:text-slate-200">{overview.coverage.analyzedObservationsCount.toLocaleString('ro-RO')}</strong> observații și{' '}
                <strong className="text-slate-800 dark:text-slate-200">{overview.coverage.analyzedOffersCount.toLocaleString('ro-RO')}</strong> oferte
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Sursă date: <strong className="text-slate-800 dark:text-slate-200 font-mono">{overview.coverage.dataSource}</strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className={overview.coverage.isPartialSample ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                {overview.coverage.coverageNoteRo}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sub-navigation across A–F */}
      <div
        role="tablist"
        aria-label="Secțiuni monitorizare calitate"
        className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 text-xs"
      >
        {SECTION_TABS.map(tab => {
          const isActive = activeSection === tab.id;
          let countBadge: number | null = null;
          if (overview) {
            if (tab.id === 'anomalies') countBadge = overview.kpis.openAnomaliesCount;
            else if (tab.id === 'expired') countBadge = overview.kpis.expiredOffersCount;
            else if (tab.id === 'canonical') countBadge = overview.canonicalIntegrity.totalIssuesCount;
            else if (tab.id === 'sources') countBadge = overview.sourceQuality.length;
          }
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveSection(tab.id)}
              className={`min-h-[36px] px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                isActive
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-2xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="sm:hidden">{tab.shortLabel}</span>
              <span className="hidden sm:inline">{tab.label}</span>
              {countBadge !== null && (
                <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                  {countBadge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* =================================================================== */}
      {/* SECTION A: QUALITY OVERVIEW                                         */}
      {/* =================================================================== */}
      {activeSection === 'overview' && (
        <div className="space-y-5">
          {isLoadingOverview && !overview ? (
            <LoadingState variant="card" message="Se încarcă metricile de calitate..." />
          ) : !overview || !overview.hasData ? (
            <EmptyState
              icon={<Database className="w-6 h-6" />}
              title={`Nu există observații sau oferte în intervalul selectat (${intervalDays} zile)`}
              description={overview?.coverage.coverageNoteRo || 'Selectează un interval mai mare sau rulează un import de catalog.'}
              actionLabel="Reîncarcă"
              onAction={() => fetchOverview(true)}
            />
          ) : (
            <>
              {/* Key Quality KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 tabular-nums">
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Total analizat</span>
                  <span className="text-xl font-black text-slate-900 dark:text-slate-50 mt-1 block">
                    {overview.kpis.totalRecordsAnalyzed.toLocaleString('ro-RO')}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    {overview.kpis.totalObservationsAnalyzed} obs · {overview.kpis.totalOffersAnalyzed} oferte
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-rose-200 dark:border-rose-900/60 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 block">% Suspecte</span>
                  <span className="text-xl font-black text-rose-700 dark:text-rose-400 mt-1 block">
                    {overview.kpis.suspiciousPct.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    {overview.kpis.suspiciousCount} înregistrări
                  </span>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-orange-200 dark:border-orange-900/60 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 block">Oferte expirate</span>
                  <span className="text-xl font-black text-orange-700 dark:text-orange-400 mt-1 block">
                    {overview.kpis.expiredOffersCount}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Excluse din optimizare</span>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Neverificate</span>
                  <span className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1 block">
                    {overview.kpis.unverifiedCount}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Așteaptă confirmare</span>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-amber-200 dark:border-amber-900/60 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 block">Date învechite</span>
                  <span className="text-xl font-black text-amber-700 dark:text-amber-400 mt-1 block">
                    {overview.kpis.staleCount}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Peste prag prospețime</span>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Excluse</span>
                  <span className="text-xl font-black text-slate-900 dark:text-slate-50 mt-1 block">
                    {overview.kpis.excludedFromComparisonCount}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Neeligibile comparație</span>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">Scor mediu</span>
                  <span className="text-xl font-black text-slate-900 dark:text-slate-50 mt-1 block">
                    {overview.kpis.avgQualityScore !== null ? `${overview.kpis.avgQualityScore}/100` : 'N/A'}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">Calitate agregată</span>
                </div>

                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Anomalii</span>
                  <span className="text-xl font-black text-slate-900 dark:text-slate-50 mt-1 block">
                    {overview.kpis.anomaliesDetectedCount}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    {overview.kpis.openAnomaliesCount} deschise · {overview.kpis.investigatedAnomaliesCount} investigate
                  </span>
                </div>
              </div>

              {/* 6-Status Distribution & Evolution Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* 6-Status Breakdown */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      Distribuție pe cele 6 statusuri de calitate
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {overview.kpis.totalRecordsAnalyzed} total
                    </span>
                  </div>

                  {/* Segmented Bar */}
                  <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                    {STATUS_META.map(meta => {
                      const count = overview.statusDistribution[meta.key] || 0;
                      const pct = overview.kpis.totalRecordsAnalyzed
                        ? (count / overview.kpis.totalRecordsAnalyzed) * 100
                        : 0;
                      return (
                        <div
                          key={meta.key}
                          style={{ width: `${pct}%` }}
                          className={meta.barClass}
                          title={`${meta.labelRo}: ${count} (${pct.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>

                  {/* Detailed table of all 6 statuses */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs tabular-nums">
                    {STATUS_META.map(meta => {
                      const total = overview.statusDistribution[meta.key] || 0;
                      const obsCount = overview.observationStatusDistribution[meta.key] || 0;
                      const offerCount = overview.offerStatusDistribution[meta.key] || 0;
                      const pct = overview.kpis.totalRecordsAnalyzed
                        ? ((total / overview.kpis.totalRecordsAnalyzed) * 100).toFixed(1)
                        : '0.0';
                      return (
                        <div key={meta.key} className="py-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <QualityStatusBadge status={meta.key} compact />
                          </div>
                          <div className="flex items-center gap-4 text-right">
                            <span className="text-[11px] text-slate-500">
                              {obsCount} obs · {offerCount} oferte
                            </span>
                            <span className="font-bold text-slate-900 dark:text-slate-50 w-20">
                              {total} ({pct}%)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Quality Evolution Over Time (Real Dates Only) */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      Evoluția calității în timp (date reale)
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {overview.evolution.length} zile cu observații
                    </span>
                  </div>

                  {overview.evolution.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                      Nu există observații cu date valide în intervalul analizat. Nu se afișează serii simulate.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-44 flex items-end gap-1.5 pt-4 px-1 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
                        {overview.evolution.slice(-14).map(pt => {
                          const scoreHeight = Math.max(8, pt.avgScore ?? 0);
                          return (
                            <div
                              key={pt.date}
                              className="flex-1 min-w-[26px] flex flex-col items-center gap-1 h-full justify-end group relative"
                            >
                              <span className="text-[10px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                {pt.avgScore !== null ? pt.avgScore : '—'}
                              </span>
                              <div
                                className={`w-full max-w-[26px] rounded-t-md transition-all ${
                                  pt.suspiciousPct > 15
                                    ? 'bg-rose-500'
                                    : pt.suspiciousPct > 0
                                    ? 'bg-amber-500'
                                    : 'bg-sky-500'
                                }`}
                                style={{ height: `${scoreHeight}%` }}
                                title={`${pt.date}: ${pt.total} observații, ${pt.suspicious} suspecte (${pt.suspiciousPct}%), scor mediu ${pt.avgScore ?? 'N/A'}/100`}
                              />
                              <span className="text-[9px] text-slate-400 font-mono tabular-nums">
                                {pt.date.slice(5)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Barele reprezintă exclusiv zilele cu observații reale înregistrate (scor mediu zilnic și pondere suspecte).
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION B: SUSPICIOUS PRICES & ANOMALIES                            */}
      {/* =================================================================== */}
      {activeSection === 'anomalies' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                Prețuri suspecte & anomalii detectate
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Toate detectările sunt read-only și explicabile. Investigațiile se salvează în jurnalul de audit fără alterarea istoricului.
              </p>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              Resetează filtrele
            </button>
          </div>

          {/* Filter controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Caută produs sau ID..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setAnomaliesPage(1);
                }}
                className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <select
              aria-label="Filtru tip anomalie"
              value={filterAnomalyType}
              onChange={e => {
                setFilterAnomalyType(e.target.value as PriceQualityAnomalyType | 'all');
                setAnomaliesPage(1);
              }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            >
              {ANOMALY_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtru severitate"
              value={filterSeverity}
              onChange={e => {
                setFilterSeverity(e.target.value as PriceQualityAnomalySeverity | 'all');
                setAnomaliesPage(1);
              }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            >
              <option value="all">Toate severitățile</option>
              <option value="critical">Critică</option>
              <option value="high">Ridicată</option>
              <option value="medium">Medie</option>
              <option value="low">Scăzută</option>
            </select>

            <select
              aria-label="Filtru status investigare"
              value={filterInvStatus}
              onChange={e => {
                setFilterInvStatus(e.target.value as PriceQualityInvestigationStatus | 'all');
                setAnomaliesPage(1);
              }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            >
              <option value="all">Toate statusurile investigare</option>
              <option value="open">Deschise (neinvestigate)</option>
              <option value="investigated">Investigate</option>
              <option value="confirmed_anomaly">Anomalie confirmată</option>
              <option value="false_positive">Fals pozitiv</option>
              <option value="needs_source_check">Necesită verificare sursă</option>
            </select>

            <select
              aria-label="Filtru magazin"
              value={filterStore}
              onChange={e => {
                setFilterStore(e.target.value);
                setAnomaliesPage(1);
              }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            >
              <option value="all">Toate magazinele</option>
              {STORES.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtru sursă"
              value={filterSource}
              onChange={e => {
                setFilterSource(e.target.value);
                setAnomaliesPage(1);
              }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            >
              <option value="all">Toate sursele</option>
              {knownSources.map(src => (
                <option key={src} value={src}>
                  {src}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtru status calitate"
              value={filterStatus}
              onChange={e => {
                setFilterStatus(e.target.value as PriceDataQualityStatus | 'all');
                setAnomaliesPage(1);
              }}
              className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
            >
              <option value="all">Toate statusurile calitate</option>
              {STATUS_META.map(m => (
                <option key={m.key} value={m.key}>
                  {m.labelRo}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="De la data"
                value={filterFromDate}
                onChange={e => {
                  setFilterFromDate(e.target.value);
                  setAnomaliesPage(1);
                }}
                className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 text-[11px]"
              />
              <input
                type="date"
                aria-label="Până la data"
                value={filterToDate}
                onChange={e => {
                  setFilterToDate(e.target.value);
                  setAnomaliesPage(1);
                }}
                className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 text-[11px]"
              />
            </div>
          </div>

          {/* Anomalies list */}
          {isLoadingList ? (
            <div className="py-10 text-center text-xs text-slate-500">Se încarcă anomaliile...</div>
          ) : anomalies.length === 0 ? (
            <div className="py-10 text-center bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Nicio anomalie nu corespunde filtrelor selectate.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              {anomalies.map(anom => (
                <div key={anom.id} className="p-4 text-xs space-y-2.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                          anom.severity === 'critical'
                            ? 'bg-rose-600 text-white'
                            : anom.severity === 'high'
                            ? 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300'
                            : anom.severity === 'medium'
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                            : 'bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300'
                        }`}
                      >
                        {anom.severity}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                        {anom.productName}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {anom.anomalyTypeLabelRo}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-500">
                      <span>{anom.observedDate}</span>
                      <span>·</span>
                      <span
                        className={`px-2 py-0.5 rounded font-sans font-semibold ${
                          anom.investigationStatus === 'open'
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {INVESTIGATION_LABELS_RO[anom.investigationStatus]}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                    <span>
                      Magazin: <strong className="text-slate-800 dark:text-slate-200">{anom.storeName}</strong>
                    </span>
                    <span>
                      Sursă: <strong className="text-slate-800 dark:text-slate-200">{anom.sourceLabel}</strong> ({anom.source})
                    </span>
                    <span>
                      Preț: <strong className="text-slate-900 dark:text-slate-100">{PriceComparisonService.formatRon(anom.price)}</strong> ({anom.currency})
                    </span>
                    {anom.baselinePrice != null && (
                      <span>
                        Reper: <strong>{PriceComparisonService.formatRon(anom.baselinePrice)}</strong>
                      </span>
                    )}
                    {anom.deviationPct != null && (
                      <span className="text-rose-600 dark:text-rose-400 font-bold">
                        Deviație: {anom.deviationPct > 0 ? `+${anom.deviationPct}%` : `${anom.deviationPct}%`}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/60 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    {anom.reasonRo}
                  </p>

                  {anom.investigationNote && (
                    <div className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/40 px-2.5 py-1.5 rounded-lg border border-emerald-200/70 dark:border-emerald-900/60">
                      Notă admin ({anom.investigatedBy || 'admin'}): {anom.investigationNote}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => openInvestigationModal(anom)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSearch className="w-3.5 h-3.5" />
                      <span>{anom.investigationStatus === 'open' ? 'Investighează' : 'Actualizează investigația'}</span>
                    </button>

                    {onSelectProduct && anom.productId && (
                      <button
                        type="button"
                        onClick={() => onSelectProduct(anom.canonicalProductId || anom.productId)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Vezi produs & istoric</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 tabular-nums">
            <span>
              Pagina {anomaliesPage} din {anomaliesTotalPages} ({anomaliesTotal} anomalii)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={anomaliesPage <= 1}
                onClick={() => setAnomaliesPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={anomaliesPage >= anomaliesTotalPages}
                onClick={() => setAnomaliesPage(p => p + 1)}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
              >
                Următor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION C: EXPIRED OFFERS                                           */}
      {/* =================================================================== */}
      {activeSection === 'expired' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                Oferte expirate & intervale depășite
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Ofertele cu validUntil depășit sau prag de prospețime expirat sunt excluse automat din coșul optimizat, chiar dacă apar încă active în sursă.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Filtru magazin expirate"
                value={filterStore}
                onChange={e => {
                  setFilterStore(e.target.value);
                  setRecordsPage(1);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              >
                <option value="all">Toate magazinele</option>
                {STORES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Caută produs..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setRecordsPage(1);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
              />
            </div>
          </div>

          {isLoadingList ? (
            <LoadingState variant="card" message="Se încarcă ofertele expirate..." />
          ) : records.length === 0 ? (
            <EmptyState
              icon={<Clock className="w-6 h-6" />}
              title="Nu există oferte expirate conform filtrelor curente"
            />
          ) : (
            <>
              {/* Mobile stacked cards (< sm) */}
              <div className="sm:hidden space-y-2.5">
                {records.map(rec => (
                  <div
                    key={`mobile-exp-${rec.id}`}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 text-xs space-y-2 tabular-nums"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 dark:text-slate-100 block truncate">
                          {rec.productName}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                          {rec.storeName} · {rec.sourceLabel}
                        </span>
                      </div>
                      <span className="font-bold text-slate-900 dark:text-slate-100 font-mono shrink-0">
                        {PriceComparisonService.formatRon(rec.price)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                      <span className="font-mono text-orange-700 dark:text-orange-400 text-[11px]">
                        Expirat: {rec.validUntil || rec.observedDate}
                        {rec.expiredDaysAgo ? ` (-${rec.expiredDaysAgo}z)` : ''}
                      </span>
                      {onSelectProduct && (
                        <button
                          type="button"
                          onClick={() => onSelectProduct(rec.canonicalProductId || rec.productId)}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold cursor-pointer"
                        >
                          Vezi produs
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase text-slate-400">
                      <th className="py-2 px-3">Produs</th>
                      <th className="py-2 px-3">Magazin</th>
                      <th className="py-2 px-3">Sursă</th>
                      <th className="py-2 px-3">Preț</th>
                      <th className="py-2 px-3">Expirat la</th>
                      <th className="py-2 px-3">Status sursă</th>
                      <th className="py-2 px-3 text-right">Acțiune</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {records.map(rec => (
                      <tr key={rec.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                          {rec.productName}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{rec.storeName}</td>
                        <td className="py-2.5 px-3 text-slate-500">{rec.sourceLabel}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                          {PriceComparisonService.formatRon(rec.price)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-orange-700 dark:text-orange-400">
                          {rec.validUntil || rec.observedDate}
                          {rec.expiredDaysAgo ? ` (-${rec.expiredDaysAgo}z)` : ''}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                              rec.verificationStatus === 'verified'
                                ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-bold'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {rec.verificationStatus || 'necunoscut'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {onSelectProduct && (
                            <button
                              type="button"
                              onClick={() => onSelectProduct(rec.canonicalProductId || rec.productId)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                            >
                              Vezi produs
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>
              Pagina {recordsPage} din {recordsTotalPages} ({recordsTotal} oferte expirate)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={recordsPage <= 1}
                onClick={() => setRecordsPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={recordsPage >= recordsTotalPages}
                onClick={() => setRecordsPage(p => p + 1)}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
              >
                Următor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION D: SOURCE QUALITY                                           */}
      {/* =================================================================== */}
      {activeSection === 'sources' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Calitatea datelor per sursă
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evidențiază sursele cu proporție mare de prețuri suspecte, neverificate, erori repetate sau variații anormale.
            </p>
          </div>

          {!overview || overview.sourceQuality.length === 0 ? (
            <EmptyState
              icon={<Database className="w-6 h-6" />}
              title="Nu există surse cu date în intervalul selectat"
            />
          ) : (
            <>
              {/* Mobile stacked cards (< sm) */}
              <div className="sm:hidden space-y-2.5">
                {overview.sourceQuality.map(src => (
                  <div
                    key={`mobile-src-${src.source}`}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 text-xs space-y-2 tabular-nums"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 dark:text-slate-100 block truncate">
                          {src.sourceLabel}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 block truncate">{src.source}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          src.reliabilityStatus === 'healthy'
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : src.reliabilityStatus === 'warning'
                            ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                            : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {src.reliabilityLabelRo}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Total / Verif.</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {src.totalRecords} / {src.statusCounts.VERIFIED_RECENTLY + src.statusCounts.VERIFIED}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Suspecte</span>
                        <span className="font-bold text-rose-700 dark:text-rose-400">
                          {src.statusCounts.SUSPICIOUS} ({src.suspiciousPct.toFixed(1)}%)
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Scor mediu</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100">{src.avgQualityScore}/100</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold uppercase text-slate-400">
                      <th className="py-2.5 px-3">Sursă</th>
                      <th className="py-2.5 px-3">Fiabilitate</th>
                      <th className="py-2.5 px-3">Total</th>
                      <th className="py-2.5 px-3">Verificate</th>
                      <th className="py-2.5 px-3">Date învechite</th>
                      <th className="py-2.5 px-3">Neverificate</th>
                      <th className="py-2.5 px-3">Expirate</th>
                      <th className="py-2.5 px-3">Suspecte (%)</th>
                      <th className="py-2.5 px-3">Variații / Erori</th>
                      <th className="py-2.5 px-3">Scor mediu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {overview.sourceQuality.map(src => (
                      <tr key={src.source} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-slate-100">{src.sourceLabel}</div>
                          <div className="text-[10px] font-mono text-slate-400">{src.source}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              src.reliabilityStatus === 'healthy'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                                : src.reliabilityStatus === 'warning'
                                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {src.reliabilityLabelRo}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold">{src.totalRecords}</td>
                        <td className="py-2.5 px-3 text-emerald-700 dark:text-emerald-400 font-semibold">
                          {src.statusCounts.VERIFIED_RECENTLY + src.statusCounts.VERIFIED}
                        </td>
                        <td className="py-2.5 px-3 text-amber-700 dark:text-amber-400">{src.staleCount}</td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{src.unverifiedCount}</td>
                        <td className="py-2.5 px-3 text-orange-700 dark:text-orange-400">{src.expiredCount}</td>
                        <td className="py-2.5 px-3 font-bold text-rose-700 dark:text-rose-400">
                          {src.statusCounts.SUSPICIOUS} ({src.suspiciousPct.toFixed(1)}%)
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                          {src.abnormalVariationCount} var · {src.importErrorCount} erori
                        </td>
                        <td className="py-2.5 px-3 font-bold">{src.avgQualityScore}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION E: CANONICAL INTEGRITY (READ-ONLY)                          */}
      {/* =================================================================== */}
      {activeSection === 'canonical' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              Audit Integritate Identitate Canonică (Read-Only)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Detectează cicluri, auto-referințe, lanțuri peste limita de 16 niveluri, aliasuri orfane și referințe inconsistente. Nicio modificare automată nu este permisă.
            </p>
          </div>

          {overview && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-xs tabular-nums">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Produse scanate</span>
                  <span className="text-lg font-black text-slate-900 dark:text-slate-50">{overview.canonicalIntegrity.totalProductsScanned}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Rădăcini / Aliasuri OK</span>
                  <span className="text-lg font-black text-emerald-700 dark:text-emerald-400">
                    {overview.canonicalIntegrity.validCanonicalRootsCount} / {overview.canonicalIntegrity.validAliasesCount}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Auto-referințe</span>
                  <span className="text-lg font-black text-rose-600 dark:text-rose-400">{overview.canonicalIntegrity.selfReferencesCount}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Cicluri</span>
                  <span className="text-lg font-black text-rose-600 dark:text-rose-400">{overview.canonicalIntegrity.cyclesCount}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Aliasuri orfane</span>
                  <span className="text-lg font-black text-amber-600 dark:text-amber-400">{overview.canonicalIntegrity.orphanAliasesCount}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Ref. inconsistente</span>
                  <span className="text-lg font-black text-amber-600 dark:text-amber-400">{overview.canonicalIntegrity.inconsistentReferencesCount}</span>
                </div>
              </div>

              {overview.canonicalIntegrity.issues.length === 0 ? (
                <div className="py-8 text-center bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-1.5" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Nu au fost detectate probleme de integritate canonică în catalogul analizat.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs">
                  {overview.canonicalIntegrity.issues.map(issue => (
                    <div key={issue.id} className="p-3.5 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 text-[10px] font-bold uppercase">
                            {issue.issueLabelRo}
                          </span>
                          <span className="font-bold text-slate-900 dark:text-slate-100">{issue.productName}</span>
                          <span className="font-mono text-[11px] text-slate-400">({issue.productId})</span>
                        </div>
                        {onSelectProduct && issue.referencedIn === 'product' && (
                          <button
                            type="button"
                            onClick={() => onSelectProduct(issue.productId)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                          >
                            Vezi produs
                          </button>
                        )}
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{issue.reasonRo}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* SECTION F: MONITORING HISTORY                                       */}
      {/* =================================================================== */}
      {activeSection === 'history' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                Istoric rulări de monitorizare calitate
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Snapshot-urile rulate explicit sunt păstrate pentru trasabilitate și comparație istorică.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums">{runsTotal} rulări</span>
          </div>

          {isLoadingList ? (
            <div className="py-10 text-center text-xs text-slate-500">Se încarcă istoricul rulărilor...</div>
          ) : runs.length === 0 ? (
            <div className="py-10 text-center bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Nu există încă rulări salvate în istoric.
              </p>
              <button
                type="button"
                onClick={handleRunScan}
                disabled={isRunningScan}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                Rulează prima verificare acum
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-xs tabular-nums">
              {runs.map(run => (
                <div key={run.id} className="p-4 space-y-1.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100">
                        {new Date(run.runAt).toLocaleString('ro-RO')}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
                        {run.intervalDays} zile · {run.dataSource}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {run.triggeredBy} · {run.durationMs}ms
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{run.coverageNoteRo}</p>
                  <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 pt-1">
                    <span>
                      Analizate: <strong className="text-slate-800 dark:text-slate-200">{run.totalRecordsAnalyzed}</strong>
                    </span>
                    <span>
                      Suspecte: <strong className="text-rose-600 dark:text-rose-400">{run.suspiciousCount} ({run.suspiciousPct.toFixed(1)}%)</strong>
                    </span>
                    <span>
                      Anomalii: <strong className="text-slate-800 dark:text-slate-200">{run.anomaliesDetectedCount}</strong>
                    </span>
                    <span>
                      Expirate: <strong className="text-orange-600 dark:text-orange-400">{run.expiredOffersCount}</strong>
                    </span>
                    <span>
                      Canonic: <strong className="text-slate-800 dark:text-slate-200">{run.canonicalIssuesCount}</strong>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
            <span>
              Pagina {runsPage} din {runsTotalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={runsPage <= 1}
                onClick={() => setRunsPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={runsPage >= runsTotalPages}
                onClick={() => setRunsPage(p => p + 1)}
                className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
              >
                Următor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* RUN SCAN CONFIRMATION MODAL                                         */}
      {/* =================================================================== */}
      {showRunConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-scan-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 id="run-scan-confirm-title" className="text-base font-bold text-slate-900 dark:text-slate-50">
                Confirmă rularea verificării de calitate
              </h3>
              <button
                type="button"
                aria-label="Închide dialogul"
                onClick={() => setShowRunConfirmModal(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Vei executa un snapshot de audit read-only pe ultimele <strong>{intervalDays} zile</strong> (până la 2.500 de înregistrări). Prețurile și observațiile din baza de date rămân strict nemodificate.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRunConfirmModal(false)}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRunConfirmModal(false);
                  void handleRunScan();
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                Confirmă și rulează
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* INVESTIGATION MODAL (NON-DESTRUCTIVE, AUDIT-LOGGED)                 */}
      {/* =================================================================== */}
      {investigatingAnomaly && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="investigate-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 id="investigate-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-50">
                  Investigare Anomalie (Fără modificare prețuri)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {investigatingAnomaly.productName} · {investigatingAnomaly.storeName} · {investigatingAnomaly.anomalyTypeLabelRo}
                </p>
              </div>
              <button
                type="button"
                aria-label="Închide fereastra de investigare"
                onClick={() => setInvestigatingAnomaly(null)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
              {investigatingAnomaly.reasonRo}
            </div>

            <form onSubmit={handleSaveInvestigation} className="space-y-3 text-xs">
              <div>
                <label htmlFor="inv-status-select" className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Status investigare
                </label>
                <select
                  id="inv-status-select"
                  value={invStatusInput}
                  onChange={e => setInvStatusInput(e.target.value as PriceQualityInvestigationStatus)}
                  className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                >
                  <option value="investigated">Investigată</option>
                  <option value="confirmed_anomaly">Anomalie confirmată (păstrată în audit)</option>
                  <option value="false_positive">Fals pozitiv</option>
                  <option value="needs_source_check">Necesită verificare sursă</option>
                  <option value="open">Redeschide ca deschisă</option>
                </select>
              </div>

              <div>
                <label htmlFor="inv-decision-input" className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Decizie / acțiune recomandată (opțional)
                </label>
                <input
                  id="inv-decision-input"
                  type="text"
                  placeholder="ex: Verificare feed retailer următorul import"
                  value={invDecisionInput}
                  onChange={e => setInvDecisionInput(e.target.value)}
                  maxLength={120}
                  className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="inv-note-textarea" className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  Notă administrativă (obligatoriu, min. 3 caractere)
                </label>
                <textarea
                  id="inv-note-textarea"
                  rows={3}
                  required
                  placeholder="Constatări ale verificării..."
                  value={invNoteInput}
                  onChange={e => setInvNoteInput(e.target.value)}
                  maxLength={1000}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setInvestigatingAnomaly(null)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  disabled={isSavingInvestigation}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-60"
                >
                  {isSavingInvestigation ? 'Se salvează...' : 'Salvează în audit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
