// src/components/AdminCatalogImporterTab.tsx
// Panou administrativ pentru Catalog Importer: Descoperire, Descărcare, Parsare, Staging și Publicare

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Download,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Check,
  X,
  Play,
  FileText,
  Clock,
  Sparkles,
  ArrowRight,
  Filter,
  Plus,
  Eye,
  Info,
  Calendar,
  AlertCircle
} from 'lucide-react';
import {
  CatalogSource,
  CatalogDocument,
  CatalogExtractedOffer,
  CatalogImportRun,
  CatalogImporterStats,
  CatalogImportError
} from '../indexing/catalog/catalogTypes';

interface AdminCatalogImporterTabProps {
  adminToken: string;
}

export const AdminCatalogImporterTab: React.FC<AdminCatalogImporterTabProps> = ({ adminToken }) => {
  const [subTab, setSubTab] = useState<'staging' | 'documents' | 'sources' | 'runs'>('staging');
  const [stats, setStats] = useState<CatalogImporterStats | null>(null);
  const [sources, setSources] = useState<CatalogSource[]>([]);
  const [documents, setDocuments] = useState<CatalogDocument[]>([]);
  const [stagingOffers, setStagingOffers] = useState<CatalogExtractedOffer[]>([]);
  const [importRuns, setImportRuns] = useState<CatalogImportRun[]>([]);
  const [importErrors, setImportErrors] = useState<CatalogImportError[]>([]);

  // Filter & Search
  const [stagingFilter, setStagingFilter] = useState<'toate' | 'NEEDS_REVIEW' | 'VALIDATED' | 'PUBLISHED' | 'REJECTED'>('NEEDS_REVIEW');
  const [retailerFilter, setRetailerFilter] = useState<string>('toate');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Execution states
  const [isRunningPilot, setIsRunningPilot] = useState<boolean>(false);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New source form modal
  const [showAddSourceModal, setShowAddSourceModal] = useState<boolean>(false);
  const [newSourceUrl, setNewSourceUrl] = useState<string>('');
  const [newSourceName, setNewSourceName] = useState<string>('');
  const [newSourceRetailer, setNewSourceRetailer] = useState<string>('lidl');
  const [newSourceFormat, setNewSourceFormat] = useState<'html' | 'pdf' | 'csv' | 'xml'>('html');
  const [isSubmittingSource, setIsSubmittingSource] = useState<boolean>(false);

  // Helper fetch with Bearer token
  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...(options.headers || {}),
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    };
    return fetch(url, { ...options, headers });
  };

  const loadAllData = async () => {
    try {
      // Stats
      const statsRes = await fetchWithAuth('/api/admin/catalog-importer/stats');
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.stats);
      }

      // Sources
      const srcRes = await fetchWithAuth('/api/admin/catalog-importer/sources');
      if (srcRes.ok) {
        const data = await srcRes.json();
        setSources(data.sources || []);
      }

      // Documents
      const docRes = await fetchWithAuth('/api/admin/catalog-importer/documents');
      if (docRes.ok) {
        const data = await docRes.json();
        setDocuments(data.documents || []);
      }

      // Staging
      const stgRes = await fetchWithAuth(`/api/admin/catalog-importer/staging?status=${stagingFilter}&retailerId=${retailerFilter}&search=${encodeURIComponent(searchQuery)}`);
      if (stgRes.ok) {
        const data = await stgRes.json();
        setStagingOffers(data.offers || []);
      }

      // Runs
      const runRes = await fetchWithAuth('/api/admin/catalog-importer/runs');
      if (runRes.ok) {
        const data = await runRes.json();
        setImportRuns(data.runs || []);
      }

      // Errors
      const errRes = await fetchWithAuth('/api/admin/catalog-importer/errors');
      if (errRes.ok) {
        const data = await errRes.json();
        setImportErrors(data.errors || []);
      }
    } catch (err: any) {
      console.error('Eroare la încărcarea datelor Catalog Importer:', err);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [stagingFilter, retailerFilter, adminToken]);

  // Handle Pilot Import (Lidl România)
  const handleRunPilot = async () => {
    setIsRunningPilot(true);
    setActionMessage(null);
    try {
      const res = await fetchWithAuth('/api/admin/catalog-importer/run-pilot', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage({
          type: 'success',
          text: `Catalogul Lidl a fost descărcat și procesat: ${data.result.totalExtracted} oferte extrase, ${data.result.published} publicate direct în catalog.`
        });
      } else {
        setActionMessage({ type: 'error', text: data.error || data.message || 'Importul pilot a eșuat.' });
      }
      await loadAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare de rețea: ${err.message}` });
    } finally {
      setIsRunningPilot(false);
    }
  };

  // Handle Discovery
  const handleDiscover = async () => {
    setIsDiscovering(true);
    setActionMessage(null);
    try {
      const res = await fetchWithAuth('/api/admin/catalog-importer/discover', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: `Descoperire finalizată: ${data.documentsCount} documente identificate.` });
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Descoperirea a eșuat.' });
      }
      await loadAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare: ${err.message}` });
    } finally {
      setIsDiscovering(false);
    }
  };

  // Handle Process Single Document
  const handleProcessDocument = async (docId: string) => {
    setProcessingDocId(docId);
    setActionMessage(null);
    try {
      const res = await fetchWithAuth(`/api/admin/catalog-importer/process-document/${docId}`, {
        method: 'POST',
        body: JSON.stringify({ autoPublish: true })
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: `Document procesat cu succes (${data.extractedCount} oferte extrase).` });
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Procesarea a eșuat.' });
      }
      await loadAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare: ${err.message}` });
    } finally {
      setProcessingDocId(null);
    }
  };

  // Handle Staging Review (Approve / Reject)
  const handleReviewOffer = async (id: string, action: 'approve' | 'reject') => {
    try {
      const res = await fetchWithAuth(`/api/admin/catalog-importer/staging/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        setStagingOffers(prev => prev.filter(o => o.id !== id));
        loadAllData();
      }
    } catch (err) {
      console.error('Eroare la revizuirea ofertei:', err);
    }
  };

  // Handle Publish All Validated
  const handlePublishValidated = async () => {
    setIsPublishing(true);
    setActionMessage(null);
    try {
      const res = await fetchWithAuth('/api/admin/catalog-importer/publish-validated', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage({ type: 'success', text: `Au fost publicate ${data.publishedCount} oferte validate în catalogul public.` });
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Publicarea a eșuat.' });
      }
      await loadAllData();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare: ${err.message}` });
    } finally {
      setIsPublishing(false);
    }
  };

  // Handle Add Source with SSRF Validation
  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingSource(true);
    setActionMessage(null);
    try {
      const res = await fetchWithAuth('/api/admin/catalog-importer/sources', {
        method: 'POST',
        body: JSON.stringify({
          retailerId: newSourceRetailer,
          name: newSourceName,
          catalogUrl: newSourceUrl,
          format: newSourceFormat,
          status: 'active'
        })
      });
      const data = await res.json();
      if (data.success) {
        setShowAddSourceModal(false);
        setNewSourceUrl('');
        setNewSourceName('');
        setActionMessage({ type: 'success', text: 'Sursa a fost validată anti-SSRF și adăugată.' });
        loadAllData();
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Eroare la adăugarea sursei.' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: `Eroare: ${err.message}` });
    } finally {
      setIsSubmittingSource(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Controls */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 rounded-2xl p-6 text-white shadow-xl border border-emerald-700/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-2 border border-emerald-500/30">
              <BookOpen className="w-3.5 h-3.5" />
              Catalog Importer Engine
            </div>
            <h2 className="text-2xl font-bold">Import Automat Cataloage & Indexare Prețuri</h2>
            <p className="text-sm text-slate-300 mt-1 max-w-2xl">
              Descoperire automată, descărcare securizată cu protecție SSRF, extragere structurată (HTML, PDF, OCR, CSV)
              și publicare în două etape (Staging → Validare → Catalog Public).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRunPilot}
              disabled={isRunningPilot}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-medium text-sm transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer"
            >
              {isRunningPilot ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              <span>Rulează Pilot Lidl Live</span>
            </button>

            <button
              onClick={handleDiscover}
              disabled={isDiscovering}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm border border-slate-700 transition-all cursor-pointer"
            >
              {isDiscovering ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>Descoperă Documente</span>
            </button>

            <button
              onClick={() => setShowAddSourceModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 font-medium text-sm transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Adaugă URL Sursă</span>
            </button>
          </div>
        </div>

        {/* Action Message Alert */}
        {actionMessage && (
          <div className={`mt-4 p-3.5 rounded-xl text-sm flex items-start gap-2.5 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
              : 'bg-rose-500/20 text-rose-200 border border-rose-500/30'
          }`}>
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
            )}
            <span>{actionMessage.text}</span>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-6 border-t border-slate-700/60">
          <div className="bg-slate-800/60 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <span className="text-xs text-slate-400">Surse Retaileri</span>
            <div className="text-xl font-bold mt-0.5 text-white">
              {stats?.activeSources || 1} <span className="text-xs text-slate-400 font-normal">/ {stats?.totalSources || 8}</span>
            </div>
          </div>

          <div className="bg-slate-800/60 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <span className="text-xs text-slate-400">Documente Cataloage</span>
            <div className="text-xl font-bold mt-0.5 text-white">{stats?.totalDocuments || 0}</div>
          </div>

          <div className="bg-slate-800/60 backdrop-blur rounded-xl p-3 border border-slate-700/50">
            <span className="text-xs text-slate-400">Oferte Extrase</span>
            <div className="text-xl font-bold mt-0.5 text-emerald-400">{stats?.totalExtractedOffers || 0}</div>
          </div>

          <div className="bg-slate-800/60 backdrop-blur rounded-xl p-3 border border-amber-500/30">
            <span className="text-xs text-amber-300">În Revizuire (Staging)</span>
            <div className="text-xl font-bold mt-0.5 text-amber-400">{stats?.stagedPendingReview || 0}</div>
          </div>

          <div className="bg-slate-800/60 backdrop-blur rounded-xl p-3 border border-blue-500/30">
            <span className="text-xs text-blue-300">Validate (Pregătite)</span>
            <div className="text-xl font-bold mt-0.5 text-blue-400">{stats?.stagedValidated || 0}</div>
          </div>

          <div className="bg-slate-800/60 backdrop-blur rounded-xl p-3 border border-emerald-500/40">
            <span className="text-xs text-emerald-300">Publicate în Catalog</span>
            <div className="text-xl font-bold mt-0.5 text-emerald-400">{stats?.totalPublished || 0}</div>
          </div>
        </div>
      </div>

      {/* Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubTab('staging')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              subTab === 'staging'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Coadă de Staging</span>
            {(stats?.stagedPendingReview || 0) > 0 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-amber-400 text-amber-950 font-bold">
                {stats?.stagedPendingReview}
              </span>
            )}
          </button>

          <button
            onClick={() => setSubTab('documents')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              subTab === 'documents'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Documente Descărcate</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-slate-200 text-slate-700">
              {documents.length}
            </span>
          </button>

          <button
            onClick={() => setSubTab('sources')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              subTab === 'sources'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Retaileri & Surse (8)</span>
          </button>

          <button
            onClick={() => setSubTab('runs')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer flex items-center gap-2 ${
              subTab === 'runs'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Jurnal Rulări & Erori</span>
          </button>
        </div>

        {subTab === 'staging' && (stats?.stagedValidated || 0) > 0 && (
          <button
            onClick={handlePublishValidated}
            disabled={isPublishing}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            {isPublishing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>Publică ({stats?.stagedValidated}) Validate în Catalog</span>
          </button>
        )}
      </div>

      {/* SUB-TAB 1: COADĂ DE STAGING */}
      {subTab === 'staging' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Stare:
              </span>
              {(['toate', 'NEEDS_REVIEW', 'VALIDATED', 'PUBLISHED', 'REJECTED'] as const).map(st => (
                <button
                  key={st}
                  onClick={() => setStagingFilter(st)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    stagingFilter === st
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st === 'toate' && 'Toate'}
                  {st === 'NEEDS_REVIEW' && 'Necesită Revizuire'}
                  {st === 'VALIDATED' && 'Validate'}
                  {st === 'PUBLISHED' && 'Publicate'}
                  {st === 'REJECTED' && 'Respinse'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <select
                value={retailerFilter}
                onChange={e => setRetailerFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
              >
                <option value="toate">Toți Retailerii</option>
                <option value="lidl">Lidl România</option>
                <option value="kaufland">Kaufland</option>
                <option value="carrefour">Carrefour</option>
                <option value="penny">Penny</option>
                <option value="auchan">Auchan</option>
                <option value="profi">Profi</option>
                <option value="mega-image">Mega Image</option>
                <option value="metro">Metro</option>
              </select>

              <div className="relative flex-1 md:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Caută în oferte extrase..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadAllData()}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Staging Items List */}
          {stagingOffers.length === 0 ? (
            <div className="bg-white p-12 text-center rounded-2xl border border-dashed border-slate-300">
              <Layers className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-700">Nu există oferte în coada selectată</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Apasă pe butonul <strong>„Rulează Pilot Lidl Live”</strong> din antet pentru a descărca și popula automat ofertele săptămânale reale.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                    <tr>
                      <th className="p-3">Produs Extras din Catalog</th>
                      <th className="p-3">Retailer</th>
                      <th className="p-3">Preț Brut & Promo</th>
                      <th className="p-3">Preț Unitar</th>
                      <th className="p-3">Asociere Catalog (Matching)</th>
                      <th className="p-3">Stare Staging</th>
                      <th className="p-3 text-right">Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stagingOffers.map(item => (
                      <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 max-w-xs">
                          <div className="font-semibold text-slate-800 line-clamp-2">{item.rawTitle}</div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                            {item.rawBrand && <span className="bg-slate-100 px-1.5 py-0.5 rounded font-medium">{item.rawBrand}</span>}
                            {item.packageQuantity && <span>{item.packageQuantity} {item.packageUnit}</span>}
                            {item.rawBarcode && <span>GTIN: {item.rawBarcode}</span>}
                          </div>
                        </td>

                        <td className="p-3">
                          <span className="capitalize font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                            {item.retailerId}
                          </span>
                        </td>

                        <td className="p-3">
                          <div className="text-sm font-bold text-slate-900">
                            {item.effectivePrice.toFixed(2)} {item.currency}
                          </div>
                          {item.normalPrice !== item.effectivePrice && (
                            <div className="text-[11px] text-slate-400 line-through">
                              {item.normalPrice.toFixed(2)} lei
                            </div>
                          )}
                          {item.isPromo && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-rose-50 text-rose-600 text-[10px] font-bold">
                              {item.loyaltyCardName ? `Card ${item.loyaltyCardName}` : 'Promoție'}
                            </span>
                          )}
                        </td>

                        <td className="p-3">
                          <div className="font-medium text-slate-700">
                            {item.unitPrice?.toFixed(2)} {item.unitPriceMeasure}
                          </div>
                          {item.validUntil && (
                            <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <Calendar className="w-3 h-3" /> Până la {item.validUntil}
                            </div>
                          )}
                        </td>

                        <td className="p-3 max-w-xs">
                          {item.matchedProductName ? (
                            <div>
                              <div className="font-semibold text-emerald-700 line-clamp-1">{item.matchedProductName}</div>
                              <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  item.matchConfidence >= 0.85 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {Math.round(item.matchConfidence * 100)}% încredere
                                </span>
                                <span>{item.matchMethod}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-amber-600 font-medium flex items-center gap-1 text-[11px]">
                              <AlertCircle className="w-3.5 h-3.5" /> Neasociat în catalog
                            </div>
                          )}

                          {item.validationErrors && item.validationErrors.length > 0 && (
                            <div className="text-[10px] text-rose-600 mt-1 line-clamp-1">
                              ⚠️ {item.validationErrors[0]}
                            </div>
                          )}
                        </td>

                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                            item.stagingStatus === 'PUBLISHED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : item.stagingStatus === 'VALIDATED'
                              ? 'bg-blue-100 text-blue-800'
                              : item.stagingStatus === 'REJECTED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {item.stagingStatus}
                          </span>
                        </td>

                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.stagingStatus !== 'PUBLISHED' && item.stagingStatus !== 'VALIDATED' && (
                              <button
                                onClick={() => handleReviewOffer(item.id, 'approve')}
                                title="Aprobă și validează pentru publicare"
                                className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {item.stagingStatus !== 'REJECTED' && (
                              <button
                                onClick={() => handleReviewOffer(item.id, 'reject')}
                                title="Respinge ofertă invalidă"
                                className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: DOCUMENTE DESCOPERITE */}
      {subTab === 'documents' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Documente Cataloage Înregistrate</h3>
            <span className="text-xs text-slate-500">{documents.length} documente totale</span>
          </div>

          <div className="divide-y divide-slate-100">
            {documents.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs">
                Niciun document descoperit. Apasă pe „Descoperă Documente” sau rulează importul pilot Lidl.
              </div>
            ) : (
              documents.map(doc => (
                <div key={doc.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                        {doc.format}
                      </span>
                      <h4 className="font-semibold text-slate-900 text-sm">{doc.title}</h4>
                      <span className="text-xs text-slate-400 capitalize">({doc.retailerId})</span>
                    </div>

                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-3">
                      <span>URL: <a href={doc.documentUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline inline-flex items-center gap-0.5">{doc.documentUrl.slice(0, 45)}... <ExternalLink className="w-3 h-3" /></a></span>
                      {doc.fileSizeBytes && <span>Dimensiune: {Math.round(doc.fileSizeBytes / 1024)} KB</span>}
                      {doc.sha256Checksum && <span>SHA-256: {doc.sha256Checksum.slice(0, 10)}...</span>}
                      {doc.ocrConfidence && <span>Încredere OCR: {doc.ocrConfidence}%</span>}
                    </div>

                    <div className="flex items-center gap-2 pt-1 text-[11px]">
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        doc.downloadStatus === 'downloaded' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        Descărcare: {doc.downloadStatus}
                      </span>
                      <span className={`px-2 py-0.5 rounded font-bold ${
                        doc.parseStatus === 'parsed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        Parsare: {doc.parseStatus}
                      </span>
                      <span className="text-slate-600 font-medium">
                        Extrase: {doc.rawExtractedCount} | Validate: {doc.validatedCount} | Publicate: {doc.publishedCount}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleProcessDocument(doc.id)}
                      disabled={processingDocId === doc.id}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {processingDocId === doc.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      <span>Procesează Acum</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: SURSE & RETAILERI (8) */}
      {subTab === 'sources' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sources.map(src => (
            <div key={src.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-base">{src.retailerName}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-bold uppercase">
                      {src.format}
                    </span>
                  </div>
                  <h4 className="text-xs text-slate-500 font-medium mt-0.5">{src.name}</h4>
                </div>

                <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  src.status === 'active'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : src.status === 'pending_authorization'
                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                }`}>
                  {src.status === 'active' && 'Activ (Pilot)'}
                  {src.status === 'pending_authorization' && 'În Așteptare Autorizare'}
                  {src.status === 'disabled' && 'Dezactivat'}
                </span>
              </div>

              <div className="bg-slate-50 rounded-lg p-2.5 text-xs text-slate-600 font-mono break-all flex items-center justify-between">
                <span>{src.catalogUrl}</span>
                <a href={src.catalogUrl} target="_blank" rel="noreferrer" className="text-emerald-600 hover:text-emerald-700 ml-2">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="text-xs text-slate-600 bg-slate-50/80 rounded-lg p-2.5 border border-slate-200/60 flex items-start gap-2">
                <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <span>{src.legalStatusNotice}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB-TAB 4: JURNAL RULĂRI & ERORI */}
      {subTab === 'runs' && (
        <div className="space-y-6">
          {/* Import Runs */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-800">Istoric Rulări Import Catalog</h3>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {importRuns.length === 0 ? (
                <div className="p-8 text-center text-slate-500">Nicio rulare înregistrată încă.</div>
              ) : (
                importRuns.map(run => (
                  <div key={run.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{run.retailerId.toUpperCase()}</span>
                        <span className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                          run.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}>
                          {run.status}
                        </span>
                        <span className="text-slate-400 text-[11px]">{new Date(run.startedAt).toLocaleString('ro-RO')}</span>
                      </div>
                      <div className="text-slate-600 mt-1 flex flex-wrap gap-4 text-[11px]">
                        <span>Extrase: <strong>{run.totalRawExtracted}</strong></span>
                        <span>Auto-potrivite: <strong>{run.autoMatchedCount}</strong></span>
                        <span>Revizuire: <strong>{run.needsReviewCount}</strong></span>
                        <span>Publicate: <strong className="text-emerald-600">{run.publishedCount}</strong></span>
                        {run.durationMs && <span>Durată: {run.durationMs}ms</span>}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Import Errors */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-rose-50/50">
              <h3 className="text-sm font-bold text-rose-900">Jurnal Erori & Excepții de Catalog</h3>
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {importErrors.length === 0 ? (
                <div className="p-8 text-center text-emerald-600 font-medium">
                  Nu au fost raportate erori de parsare sau descărcare catalog.
                </div>
              ) : (
                importErrors.map(err => (
                  <div key={err.id} className="p-4 flex items-start gap-3 bg-rose-50/20">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-rose-800 flex items-center gap-2">
                        <span>[{err.stage.toUpperCase()}] {err.retailerId}</span>
                        <span className="text-slate-400 text-[10px] font-normal">{new Date(err.createdAt).toLocaleTimeString('ro-RO')}</span>
                      </div>
                      <p className="text-slate-700 mt-0.5">{err.message}</p>
                      {err.errorDetail && <p className="text-slate-500 font-mono text-[10px] mt-1">{err.errorDetail}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL ADAUGARE SURSA NOUA */}
      {showAddSourceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">Adăugare Sursă Catalog Public</h3>
              <button onClick={() => setShowAddSourceModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSource} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Retailer</label>
                <select
                  value={newSourceRetailer}
                  onChange={e => setNewSourceRetailer(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="lidl">Lidl România</option>
                  <option value="kaufland">Kaufland</option>
                  <option value="carrefour">Carrefour</option>
                  <option value="penny">Penny</option>
                  <option value="auchan">Auchan</option>
                  <option value="profi">Profi</option>
                  <option value="mega-image">Mega Image</option>
                  <option value="metro">Metro</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Denumire Sursă</label>
                <input
                  type="text"
                  placeholder="ex: Catalog Săptămânal Oferte Digitale"
                  value={newSourceName}
                  onChange={e => setNewSourceName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">URL Catalog Public (Validat anti-SSRF)</label>
                <input
                  type="url"
                  placeholder="https://www.lidl.ro/..."
                  value={newSourceUrl}
                  onChange={e => setNewSourceUrl(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-[11px]"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Sunt permise exclusiv domeniile oficiale ale retailerilor din România (lidl.ro, kaufland.ro etc.). Adresele IP private și locale sunt blocate automat.
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Format Conținut</label>
                <select
                  value={newSourceFormat}
                  onChange={e => setNewSourceFormat(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="html">HTML (Pagină web / Grid oferte)</option>
                  <option value="pdf">PDF (Revistă / Pliant digital)</option>
                  <option value="csv">CSV (Tabel structurat)</option>
                  <option value="xml">XML (Feed agregare)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddSourceModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSource}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-1.5"
                >
                  {isSubmittingSource ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span>Validează și Salvează Sursa</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
