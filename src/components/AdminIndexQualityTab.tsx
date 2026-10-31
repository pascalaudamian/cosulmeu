// src/components/AdminIndexQualityTab.tsx
// Componentă dedicată pentru tab-ul "Calitatea Indexului" (Price Quality Monitor & Price Freshness Score)

import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Clock,
  AlertTriangle,
  RefreshCw,
  Sliders,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Calendar,
  Layers,
  ArrowRight,
  Filter,
  Search,
  Zap,
  Info,
  Check,
  X,
  FileText,
  AlertOctagon
} from 'lucide-react';
import {
  IndexQualityOverview,
  RetailerQualityMetrics,
  QualityAnomalyRecord,
  RecollectionTask,
  DailyQualityReportRecord,
  PriceFreshnessThresholds,
  PriceQualityWeights,
  PriceFreshnessStatus
} from '../indexing/types';
import { PriceComparisonService } from '../services/PriceComparisonService';
import { STORES } from '../data/mockData';

interface AdminIndexQualityTabProps {
  adminToken: string;
  onRefreshAll?: () => void;
}

export const AdminIndexQualityTab: React.FC<AdminIndexQualityTabProps> = ({ adminToken, onRefreshAll }) => {
  const [overview, setOverview] = useState<IndexQualityOverview | null>(null);
  const [retailers, setRetailers] = useState<RetailerQualityMetrics[]>([]);
  const [anomalies, setAnomalies] = useState<QualityAnomalyRecord[]>([]);
  const [queue, setQueue] = useState<RecollectionTask[]>([]);
  const [reports, setReports] = useState<DailyQualityReportRecord[]>([]);
  const [config, setConfig] = useState<{ thresholds: PriceFreshnessThresholds; weights: PriceQualityWeights } | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isProcessingQueue, setIsProcessingQueue] = useState<boolean>(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);

  // Filters
  const [filterRetailer, setFilterRetailer] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchQualityData = async () => {
    setIsLoading(true);
    try {
      const authHeaders: Record<string, string> = adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {};
      const [overviewRes, retailersRes, anomaliesRes, queueRes, reportsRes, configRes] = await Promise.all([
        fetch('/api/quality/overview', { headers: authHeaders }),
        fetch('/api/quality/retailers', { headers: authHeaders }),
        fetch('/api/quality/anomalies', { headers: authHeaders }),
        fetch('/api/quality/queue', { headers: authHeaders }),
        fetch('/api/quality/reports', { headers: authHeaders }),
        fetch('/api/quality/config', { headers: authHeaders })
      ]);

      const [overviewData, retailersData, anomaliesData, queueData, reportsData, configData] = await Promise.all([
        overviewRes.json(),
        retailersRes.json(),
        anomaliesRes.json(),
        queueRes.json(),
        reportsRes.json(),
        configRes.json()
      ]);

      if (overviewData.success && overviewData.overview) setOverview(overviewData.overview);
      if (retailersData.success && retailersData.retailers) setRetailers(retailersData.retailers);
      if (anomaliesData.success && anomaliesData.anomalies) setAnomalies(anomaliesData.anomalies);
      if (queueData.success && queueData.queue) setQueue(queueData.queue);
      if (reportsData.success && reportsData.reports) setReports(reportsData.reports);
      if (configData.success && configData.config) setConfig(configData.config);
    } catch (err: any) {
      console.error('Eroare la încărcarea datelor de calitate:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQualityData();
  }, []);

  // Handle resolving an anomaly
  const handleResolveAnomaly = async (id: string, resolution: 'resolved_approved' | 'resolved_rejected') => {
    try {
      const res = await fetch(`/api/quality/anomalies/${id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ resolution })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({
          type: 'success',
          text: `Anomalia a fost soluționată ca "${resolution === 'resolved_approved' ? 'Aprobată (modificare validă)' : 'Respinsă'}".`
        });
        fetchQualityData();
        if (onRefreshAll) onRefreshAll();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Nu s-a putut soluționa anomalia.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare rețea: ${err.message}` });
    }
  };

  // Generate recollection queue tasks
  const handleGenerateQueue = async () => {
    try {
      const res = await fetch('/api/quality/queue/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ type: 'success', text: data.message });
        fetchQualityData();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Eroare la generarea cozii.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare: ${err.message}` });
    }
  };

  // Run recollection batch
  const handleRunQueue = async () => {
    setIsProcessingQueue(true);
    try {
      const res = await fetch('/api/quality/queue/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ maxTasks: 5 })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ type: 'success', text: data.message });
        fetchQualityData();
        if (onRefreshAll) onRefreshAll();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Eroare la procesarea lotului.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare: ${err.message}` });
    } finally {
      setIsProcessingQueue(false);
    }
  };

  // Generate daily quality report
  const handleGenerateReport = async () => {
    setIsGeneratingReport(true);
    try {
      const res = await fetch('/api/quality/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ date: new Date().toISOString().split('T')[0] })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ type: 'success', text: data.message });
        fetchQualityData();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Eroare la generarea raportului.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare: ${err.message}` });
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Filtered anomalies list
  const filteredAnomalies = useMemo(() => {
    return anomalies.filter(a => {
      if (filterRetailer !== 'all' && a.retailerId !== filterRetailer) return false;
      if (filterSeverity !== 'all' && a.severity !== filterSeverity) return false;
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = a.productName.toLowerCase().includes(query);
        const matchesDetails = a.details.toLowerCase().includes(query);
        if (!matchesName && !matchesDetails) return false;
      }
      return true;
    });
  }, [anomalies, filterRetailer, filterSeverity, filterStatus, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Banner Notificare Acțiuni */}
      {actionMessage && (
        <div
          className={`p-4 rounded-2xl text-xs flex items-center justify-between border ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header & Quick Controls */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-xs border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h2 className="text-base sm:text-lg font-bold tracking-tight">
              Price Quality Monitor & Freshness Score
            </h2>
            <span className="px-2 py-0.5 rounded-md bg-emerald-950 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono font-bold">
              MONITORIZARE CONTINUĂ
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Sistem automat de audit și evaluare a prospețimii prețurilor (0–24h foarte recent, 24–48h recent, 48–72h vechi, &gt;72h expirat) și a scorului de calitate (0–100) pe cei 8 retaileri din România.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleGenerateReport}
            disabled={isGeneratingReport}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
          >
            {isGeneratingReport ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-emerald-400" />}
            <span>Raport Zilnic</span>
          </button>

          <button
            onClick={() => setShowConfigModal(!showConfigModal)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>Ponderi & Praguri</span>
          </button>

          <button
            onClick={fetchQualityData}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold transition-colors cursor-pointer"
            title="Reîmprospătează datele de calitate"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI CARDS: Calitatea & Prospețimea Indexului */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            Produse Monitorizate
          </span>
          <span className="text-xl sm:text-2xl font-black text-slate-900 block">
            {overview?.totalTrackedProducts || 0}
          </span>
          <span className="text-[10px] text-slate-500 mt-1 block">În toate magazinele</span>
        </div>

        <div className="bg-white rounded-2xl border border-emerald-200/80 bg-emerald-50/20 p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block mb-1">
            Foarte Recente (&lt;24h)
          </span>
          <span className="text-xl sm:text-2xl font-black text-emerald-700 block">
            {overview?.veryRecentCount || 0}
          </span>
          <span className="text-[10px] text-emerald-600 mt-1 block">Prospețime maximă</span>
        </div>

        <div className="bg-white rounded-2xl border border-sky-200/80 bg-sky-50/20 p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider block mb-1">
            Recente (24–48h)
          </span>
          <span className="text-xl sm:text-2xl font-black text-sky-700 block">
            {overview?.recentCount || 0}
          </span>
          <span className="text-[10px] text-sky-600 mt-1 block">Interval optim</span>
        </div>

        <div className="bg-white rounded-2xl border border-amber-200/80 bg-amber-50/20 p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block mb-1">
            Vechi (48–72h)
          </span>
          <span className="text-xl sm:text-2xl font-black text-amber-700 block">
            {overview?.staleCount || 0}
          </span>
          <span className="text-[10px] text-amber-600 mt-1 block">Necesită verificare</span>
        </div>

        <div className="bg-white rounded-2xl border border-rose-200/80 bg-rose-50/20 p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block mb-1">
            Expirate (&gt;72h)
          </span>
          <span className="text-xl sm:text-2xl font-black text-rose-700 block">
            {overview?.expiredCount || 0}
          </span>
          <span className="text-[10px] text-rose-600 mt-1 block">Excluse din coș</span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-900 bg-slate-900 text-white p-4 shadow-2xs">
          <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">
            Medie Quality Score
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-black text-white">
              {overview?.averageQualityScore || 0}
            </span>
            <span className="text-xs text-slate-400 font-bold">/100</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Freshness: {overview?.averageFreshnessScore || 0}/100
          </span>
        </div>
      </div>

      {/* MODAL CONFIGURARE PRAGURI & PONDERI */}
      {showConfigModal && config && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-900">
                Configurare Parametri: Praguri de Prospețime & Ponderi de Calitate
              </h3>
            </div>
            <button
              onClick={() => setShowConfigModal(false)}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Praguri de Prospețime (ore) */}
            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-600" />
                Praguri de Prospețime (Ore de la Ultima Observație)
              </h4>
              <p className="text-[11px] text-slate-500">
                Starea se calculează în funcție de numărul de ore scurse de la ultima observare sau verificare validă a prețului.
              </p>

              <div className="space-y-2 pt-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Foarte recent (ore maxime): {config.thresholds.veryRecentHours}h
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="36"
                    value={config.thresholds.veryRecentHours}
                    onChange={e =>
                      setConfig({
                        ...config,
                        thresholds: { ...config.thresholds, veryRecentHours: Number(e.target.value) }
                      })
                    }
                    className="w-full accent-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Recent (ore maxime): {config.thresholds.recentHours}h
                  </label>
                  <input
                    type="range"
                    min="24"
                    max="60"
                    value={config.thresholds.recentHours}
                    onChange={e =>
                      setConfig({
                        ...config,
                        thresholds: { ...config.thresholds, recentHours: Number(e.target.value) }
                      })
                    }
                    className="w-full accent-sky-600"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Vechi (ore maxime până la expirare): {config.thresholds.staleHours}h
                  </label>
                  <input
                    type="range"
                    min="48"
                    max="120"
                    value={config.thresholds.staleHours}
                    onChange={e =>
                      setConfig({
                        ...config,
                        thresholds: { ...config.thresholds, staleHours: Number(e.target.value) }
                      })
                    }
                    className="w-full accent-amber-600"
                  />
                </div>
              </div>
            </div>

            {/* Ponderi Price Quality Score */}
            <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-emerald-600" />
                Ponderi Calitate Preț (Formula de calcul: 0–100)
              </h4>
              <p className="text-[11px] text-slate-500">
                Ponderile influențează scorul final de încredere acordat ofertelor prezentate consumatorilor.
              </p>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 rounded-xl bg-white border border-slate-200">
                  <span className="font-bold text-slate-800 block">Prospețime:</span>
                  <span className="text-slate-500">{(config.weights.freshness * 100).toFixed(0)}%</span>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-200">
                  <span className="font-bold text-slate-800 block">Validitate format:</span>
                  <span className="text-slate-500">{(config.weights.formatValidity * 100).toFixed(0)}%</span>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-200">
                  <span className="font-bold text-slate-800 block">Sursă & URL:</span>
                  <span className="text-slate-500">{(config.weights.sourceProvenance * 100).toFixed(0)}%</span>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-200">
                  <span className="font-bold text-slate-800 block">Potrivire GTIN:</span>
                  <span className="text-slate-500">{(config.weights.productMatchConfidence * 100).toFixed(0)}%</span>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-200">
                  <span className="font-bold text-slate-800 block">Concordanță gramaj:</span>
                  <span className="text-slate-500">{(config.weights.unitConsistency * 100).toFixed(0)}%</span>
                </div>
                <div className="p-2 rounded-xl bg-white border border-slate-200">
                  <span className="font-bold text-slate-800 block">Verificare reușită:</span>
                  <span className="text-slate-500">{(config.weights.verificationStatus * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/quality/config', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${adminToken}`
                    },
                    body: JSON.stringify(config)
                  });
                  const data = await res.json();
                  if (res.ok && data.success) {
                    setActionMessage({ type: 'success', text: 'Parametrii au fost salvați.' });
                    setShowConfigModal(false);
                    fetchQualityData();
                  }
                } catch (e: any) {
                  alert(e.message);
                }
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
            >
              Salvează Parametrii
            </button>
          </div>
        </div>
      )}

      {/* GRAFICE & SECȚIUNI ANALITICE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GRAFIC 1: Distribuția și Evoluția Prospețimii */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">
                1. Evoluția Prospețimii Prețurilor (Ultimele 7 Zile)
              </h3>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase">Trend Zilnic</span>
          </div>

          {/* Histogramă Evolutivă 7 Zile */}
          <div className="h-44 flex items-end justify-between gap-2 pt-4 px-2 border-b border-slate-100">
            {overview?.freshnessEvolution7d?.map((item, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <span className="text-[10px] font-bold text-slate-700">{item.freshnessScore}%</span>
                <div
                  className="w-full max-w-[28px] bg-sky-500 rounded-t-lg transition-all duration-300 relative group"
                  style={{ height: `${item.freshnessScore}%` }}
                >
                  <div className="hidden group-hover:block absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-md whitespace-nowrap z-10">
                    Prospețime: {item.freshnessScore}/100<br />
                    Calitate: {item.qualityScore}/100
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">{item.date}</span>
              </div>
            ))}
          </div>

          {/* Bară de compoziție segmentată */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-bold text-slate-700">Compoziția actuală a indexului</span>
              <span className="text-slate-400 text-[11px]">{overview?.totalTrackedProducts} prețuri</span>
            </div>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex">
              <div
                style={{
                  width: `${overview?.totalTrackedProducts ? ((overview.veryRecentCount / overview.totalTrackedProducts) * 100) : 0}%`
                }}
                className="bg-emerald-500"
                title="Foarte recente"
              />
              <div
                style={{
                  width: `${overview?.totalTrackedProducts ? ((overview.recentCount / overview.totalTrackedProducts) * 100) : 0}%`
                }}
                className="bg-sky-500"
                title="Recente"
              />
              <div
                style={{
                  width: `${overview?.totalTrackedProducts ? ((overview.staleCount / overview.totalTrackedProducts) * 100) : 0}%`
                }}
                className="bg-amber-400"
                title="Vechi"
              />
              <div
                style={{
                  width: `${overview?.totalTrackedProducts ? ((overview.expiredCount / overview.totalTrackedProducts) * 100) : 0}%`
                }}
                className="bg-rose-500"
                title="Expirate"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> &lt;24h ({overview?.veryRecentCount})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-sky-500" /> 24-48h ({overview?.recentCount})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> 48-72h ({overview?.staleCount})
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-rose-500" /> &gt;72h ({overview?.expiredCount})
              </span>
            </div>
          </div>
        </div>

        {/* GRAFIC 2: Anomalii Detectate în Ultimele 7 Zile */}
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-rose-600" />
              <h3 className="text-sm font-bold text-slate-900">
                2. Anomalii Detectate în Ultimele 7 Zile
              </h3>
            </div>
            <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
              {overview?.anomaliesCount || 0} active
            </span>
          </div>

          <div className="h-44 flex items-end justify-between gap-2 pt-4 px-2 border-b border-slate-100">
            {overview?.anomaliesTimeline7d?.map((item, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <span className="text-[10px] font-bold text-slate-700">{item.count}</span>
                <div
                  className="w-full max-w-[28px] bg-rose-400 rounded-t-lg transition-all duration-300"
                  style={{ height: `${Math.min(100, item.count * 20)}%` }}
                />
                <span className="text-[10px] text-slate-400 font-mono">{item.date}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500">
            Sistemul semnalează automat fluctuațiile suspecte &gt;50%, prețurile 0 sau negative, anomaliile de card de fidelitate și produsele asociate incert fără a respinge automat datele brute.
          </p>
        </div>
      </div>

      {/* MONITORIZARE INDIVIDUALĂ RETAILERI (Tabel & Indicatori de Calitate) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">
                3. Monitorizare Individuală pe Retailer (Calitate & Stare Tehnică)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Statusul este determinat strict pe baza validității rezultatelor reale colectate, nu doar a absenței erorilor.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {retailers.length} retaileri monitorizați
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-2.5 px-3">Retailer</th>
                <th className="py-2.5 px-3">Stare Colector</th>
                <th className="py-2.5 px-3">Scor Calitate</th>
                <th className="py-2.5 px-3">Prospețime</th>
                <th className="py-2.5 px-3">Produse</th>
                <th className="py-2.5 px-3">Promoții</th>
                <th className="py-2.5 px-3">Expirate</th>
                <th className="py-2.5 px-3">Rată Succes</th>
                <th className="py-2.5 px-3">Ultima Execuție</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {retailers.map(r => {
                const storeMeta = STORES.find(s => s.id === r.retailerId);
                return (
                  <tr key={r.retailerId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-bold text-slate-900 flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: storeMeta?.brandColor || '#64748b' }}
                      />
                      <span>{r.retailerName}</span>
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase ${
                          r.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : r.status === 'RUNNING'
                            ? 'bg-sky-100 text-sky-800'
                            : r.status === 'WAITING_FOR_AUTHORIZATION'
                            ? 'bg-amber-100 text-amber-800'
                            : r.status === 'DEGRADED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>

                    <td className="py-3 px-3 font-bold">
                      <span
                        className={`${
                          r.avgQualityScore >= 80
                            ? 'text-emerald-700'
                            : r.avgQualityScore >= 50
                            ? 'text-amber-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {r.avgQualityScore}/100
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <span className="text-slate-600 font-semibold">{r.avgFreshnessScore}/100</span>
                    </td>

                    <td className="py-3 px-3 font-semibold text-slate-800">{r.trackedProductsCount}</td>
                    <td className="py-3 px-3 text-emerald-700 font-semibold">{r.activePromotionsCount}</td>
                    <td className="py-3 px-3">
                      <span className={r.expiredPricesCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}>
                        {r.expiredPricesCount}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${r.successRate >= 80 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                            style={{ width: `${r.successRate}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] text-slate-600">{r.successRate}%</span>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                      {r.lastExecution ? new Date(r.lastExecution).toLocaleDateString('ro-RO') : 'Niciodată'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* COADĂ DE SARCINI PENTRU RECOLECTARE ȘI REVERIFICARE */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-900">
                4. Coadă de Sarcini pentru Reverificare & Recolectare Prioritară
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ierarhie strictă: 1. Prețuri expirate &bull; 2. Anomalii &bull; 3. Potriviri incerte &bull; 4. Frecvente pe bonuri &bull; 5. Promoții pe cale să expire.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateQueue}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Generează Coadă</span>
            </button>

            <button
              onClick={handleRunQueue}
              disabled={isProcessingQueue || queue.filter(t => t.status === 'queued').length === 0}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isProcessingQueue ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              <span>Rulează Recolectare Lot ({queue.filter(t => t.status === 'queued').length})</span>
            </button>
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="py-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-semibold text-slate-700">Coada de recolectare este goală.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Toate prețurile sunt confirmate sau nu au fost identificate cereri noi de reverificare.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
            {queue.slice(0, 10).map(task => (
              <div key={task.id} className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/60">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                        task.priority === 1
                          ? 'bg-rose-100 text-rose-800'
                          : task.priority === 2
                          ? 'bg-amber-100 text-amber-800'
                          : task.priority === 3
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      Prioritate {task.priority}
                    </span>
                    <span className="font-bold text-slate-900">{task.productName}</span>
                    <span className="text-[11px] text-slate-500 uppercase font-mono">({task.retailerId})</span>
                  </div>
                  <p className="text-[11px] text-slate-600">{task.reason}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] uppercase ${
                      task.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-700 font-bold'
                        : task.status === 'in_progress'
                        ? 'bg-sky-50 text-sky-700 font-bold'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {task.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ANOMALII DETECTATE ȘI ALERTE ADMINISTRATIVE */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <h3 className="text-sm font-bold text-slate-900">
                5. Jurnal & Alerte Anomalii de Preț
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Fluctuații majore, carduri de fidelitate raportate eronat sau scăderi bruște de preț ce necesită validare manuală.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter Retailer */}
            <select
              value={filterRetailer}
              onChange={e => setFilterRetailer(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white"
            >
              <option value="all">Toți Retailerii</option>
              {STORES.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>

            {/* Filter Severity */}
            <select
              value={filterSeverity}
              onChange={e => setFilterSeverity(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white"
            >
              <option value="all">Toate Severitățile</option>
              <option value="high">Severitate Ridicată</option>
              <option value="medium">Severitate Medie</option>
              <option value="low">Severitate Scăzută</option>
            </select>

            {/* Search Query */}
            <div className="relative">
              <input
                type="text"
                placeholder="Caută produs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-7 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-700 placeholder:text-slate-400 w-36 sm:w-44"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
            </div>
          </div>
        </div>

        {filteredAnomalies.length === 0 ? (
          <div className="py-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-semibold text-slate-700">Nu au fost găsite anomalii active conform filtrelor.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
            {filteredAnomalies.map(anom => (
              <div key={anom.id} className="p-4 text-xs space-y-2 hover:bg-slate-50/70 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        anom.severity === 'high'
                          ? 'bg-rose-100 text-rose-800'
                          : anom.severity === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {anom.severity}
                    </span>
                    <span className="font-bold text-slate-900 text-sm">{anom.productName}</span>
                    <span className="text-slate-400 text-[11px] font-mono">({anom.retailerId})</span>
                  </div>

                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(anom.detectedAt).toLocaleString('ro-RO')}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600 text-[11px]">
                  <span>Preț Observat: <strong className="text-slate-900">{PriceComparisonService.formatRon(anom.currentPrice)}</strong></span>
                  {anom.previousPrice && (
                    <span>Preț Anterior: <span className="line-through text-slate-400">{PriceComparisonService.formatRon(anom.previousPrice)}</span></span>
                  )}
                  {anom.deviationPercentage && (
                    <span className="text-rose-600 font-bold">Variație: {anom.deviationPercentage}%</span>
                  )}
                </div>

                <p className="text-xs text-rose-700 bg-rose-50/60 p-2.5 rounded-xl border border-rose-200/60 font-medium">
                  {anom.details}
                </p>

                {anom.status === 'pending_review' ? (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleResolveAnomaly(anom.id, 'resolved_approved')}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Aprobă (Modificare Reală la Raft)</span>
                    </button>

                    <button
                      onClick={() => handleResolveAnomaly(anom.id, 'resolved_rejected')}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-700 font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Respinge Ca Eronat</span>
                    </button>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Soluționat ca: <strong>{anom.status}</strong> de către {anom.reviewedBy || 'admin'}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RAPOARTE ZILNICE AUTOMATE DE CALITATE */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              6. Istoric Rapoarte Zilnice de Calitate a Datelor
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {reports.length} rapoarte generate
          </span>
        </div>

        {reports.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">
            Nu a fost generat încă un raport zilnic. Folosește butonul „Raport Zilnic” de sus pentru a genera primul raport.
          </p>
        ) : (
          <div className="space-y-3">
            {reports.slice(0, 5).map(rep => (
              <div key={rep.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">Raport Data: {rep.reportDate}</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      Scor: {rep.overallAverageQualityScore}/100
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Generat la: {new Date(rep.generatedAt).toLocaleTimeString('ro-RO')}
                  </span>
                </div>
                <p className="text-slate-600">{rep.summary}</p>
                <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                  <span>Monitorizate: <strong>{rep.totalTrackedProducts}</strong></span>
                  <span>Expirate: <strong className="text-rose-600">{rep.totalExpiredPrices}</strong></span>
                  <span>Anomalii: <strong className="text-amber-600">{rep.totalAnomaliesCount}</strong></span>
                  <span>Promoții Noi: <strong className="text-emerald-600">{rep.totalNewPromotions}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
