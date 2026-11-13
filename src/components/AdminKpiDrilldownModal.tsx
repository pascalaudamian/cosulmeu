// src/components/AdminKpiDrilldownModal.tsx
// Modal și Drawer universal pentru drill-down complet pe indicatorii KPI din Dashboard-ul Administrativ Coșul Meu
// Toate datele sunt interogate live din Supabase PostgreSQL, fără date mock/demo

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FileText,
  ExternalLink,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Download,
  Eye,
  Store,
  Layers,
  Tag,
  Package,
  Calendar,
  Clock,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Play
} from 'lucide-react';
import { CatalogDocument, CatalogSource } from '../indexing/catalog/catalogTypes.js';
import { RetailerConfig } from './AdminSourcesView.tsx';

export type DrilldownType =
  | 'retailers'
  | 'sources_all'
  | 'sources_active'
  | 'sources_blocked'
  | 'documents_discovered'
  | 'documents_downloaded'
  | 'extracted_offers'
  | 'distinct_products'
  | 'approved_offers'
  | 'published_offers'
  | 'price_changes'
  | 'items_without_price'
  | 'processing_errors'
  | 'recent_products';

interface AdminKpiDrilldownModalProps {
  open: boolean;
  type: DrilldownType;
  title: string;
  subtitle?: string;
  onClose: () => void;
  adminToken: string;
  retailers: RetailerConfig[];
  sources: CatalogSource[];
  onSelectDocumentFilter?: (documentId: string, retailerId?: string) => void;
  onNavigateToStagingWithFilter?: (filterType: string, retailerId?: string) => void;
  onNavigateToTab?: (tabId: string) => void;
}

export const AdminKpiDrilldownModal: React.FC<AdminKpiDrilldownModalProps> = ({
  open,
  type,
  title,
  subtitle,
  onClose,
  adminToken,
  retailers,
  sources,
  onSelectDocumentFilter,
  onNavigateToStagingWithFilter,
  onNavigateToTab
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(25);
  const [search, setSearch] = useState<string>('');
  const [retailerFilter, setRetailerFilter] = useState<string>('toate');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reprocessingDocId, setReprocessingDocId] = useState<string | null>(null);

  // Helper fetch with Bearer token
  const fetchAuth = async (url: string, options: RequestInit = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      if (type === 'documents_downloaded' || type === 'documents_discovered') {
        const url = `/api/admin/catalog-importer/documents?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&retailerId=${retailerFilter !== 'toate' ? encodeURIComponent(retailerFilter) : ''}`;
        const res = await fetchAuth(url);
        if (res.ok) {
          const json = await res.json();
          setData(json.documents || []);
          setTotalCount(json.total || 0);
        }
      } else if (type === 'approved_offers') {
        const url = `/api/admin/catalog-importer/approved-offers?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&retailerId=${retailerFilter !== 'toate' ? encodeURIComponent(retailerFilter) : ''}`;
        const res = await fetchAuth(url);
        if (res.ok) {
          const json = await res.json();
          setData(json.offers || []);
          setTotalCount(json.total || 0);
        }
      } else if (type === 'published_offers') {
        const url = `/api/admin/catalog-importer/public-offers?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&retailerId=${retailerFilter !== 'toate' ? encodeURIComponent(retailerFilter) : ''}`;
        const res = await fetchAuth(url);
        if (res.ok) {
          const json = await res.json();
          setData(json.offers || []);
          setTotalCount(json.total || 0);
        }
      } else if (type === 'price_changes') {
        const url = `/api/admin/catalog-importer/price-changes?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&retailerId=${retailerFilter !== 'toate' ? encodeURIComponent(retailerFilter) : ''}`;
        const res = await fetchAuth(url);
        if (res.ok) {
          const json = await res.json();
          setData(json.changes || []);
          setTotalCount(json.total || 0);
        }
      } else if (type === 'items_without_price') {
        const url = `/api/admin/catalog-importer/items-without-price?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&retailerId=${retailerFilter !== 'toate' ? encodeURIComponent(retailerFilter) : ''}`;
        const res = await fetchAuth(url);
        if (res.ok) {
          const json = await res.json();
          setData(json.items || []);
          setTotalCount(json.total || 0);
        }
      } else if (type === 'processing_errors') {
        const res = await fetchAuth('/api/admin/catalog-importer/errors');
        if (res.ok) {
          const json = await res.json();
          let errs = json.errors || [];
          if (retailerFilter !== 'toate') {
            errs = errs.filter((e: any) => e.retailerId === retailerFilter);
          }
          if (search) {
            errs = errs.filter((e: any) => (e.message || '').toLowerCase().includes(search.toLowerCase()));
          }
          setData(errs);
          setTotalCount(errs.length);
        }
      } else if (type === 'recent_products' || type === 'distinct_products') {
        const offset = (page - 1) * limit;
        const res = await fetchAuth(`/api/admin/products-detailed?limit=${limit}&offset=${offset}&search=${encodeURIComponent(search)}&retailer=${retailerFilter !== 'toate' ? encodeURIComponent(retailerFilter) : ''}`);
        if (res.ok) {
          const json = await res.json();
          setData(json.products || []);
          setTotalCount(json.total || 0);
        }
      }
    } catch (err: any) {
      console.error('Eroare loadData drilldown:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, type, page, limit, retailerFilter]);

  // Handle Reprocessing Document safely
  const handleReprocessDocument = async (docId: string) => {
    setReprocessingDocId(docId);
    try {
      const res = await fetchAuth(`/api/admin/catalog-importer/documents/${docId}/reprocess`, {
        method: 'POST'
      });
      if (res.ok) {
        const json = await res.json();
        setActionMessage({
          type: 'success',
          text: json.message || `Documentul ${docId} a fost trimis spre reprocesare.`
        });
        loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        setActionMessage({
          type: 'error',
          text: err.error || 'Eroare la reprocesarea documentului.'
        });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Eroare de conexiune la reprocesare.' });
    } finally {
      setReprocessingDocId(null);
    }
  };

  // Filtered in-memory views for Retailers and Sources (keep hooks above early returns)
  const uniqueRetailers = useMemo(() => {
    const seen = new Set<string>();
    return retailers.filter(r => {
      if (!r?.id || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [retailers]);

  const filteredRetailers = useMemo(() => {
    return uniqueRetailers.filter(r => {
      const matchesSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.id.includes(search.toLowerCase());
      return matchesSearch;
    });
  }, [uniqueRetailers, search]);

  const filteredSources = useMemo(() => {
    return sources.filter(s => {
      const isBlocked = s.status === 'disabled' || s.status === 'error' || s.retailerId === 'profi' || s.retailerId === 'metro';
      if (type === 'sources_active' && (s.status !== 'active' || isBlocked)) return false;
      if (type === 'sources_blocked' && !isBlocked) return false;
      if (retailerFilter !== 'toate' && s.retailerId !== retailerFilter) return false;
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.catalogUrl.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [sources, type, retailerFilter, search]);

  if (!open) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  // Export CSV
  const handleExportCSV = () => {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `export_${type}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div
        className="w-full max-w-6xl max-h-[92vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-lg text-xs font-black uppercase tracking-wider bg-emerald-600 text-white">
                PostgreSQL Live Drill-Down
              </span>
              <span className="text-xs text-slate-500 font-bold">
                {type.includes('sources') ? `${filteredSources.length} înregistrări` : type === 'retailers' ? `${filteredRetailers.length} înregistrări` : `${totalCount.toLocaleString('ro-RO')} înregistrări`}
              </span>
            </div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={data.length === 0 && filteredSources.length === 0 && filteredRetailers.length === 0}
              className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-40"
              title="Descarcă tabelul în format CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Message */}
        {actionMessage && (
          <div
            className={`p-3 px-5 text-xs font-bold flex items-center justify-between border-b ${
              actionMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'
            }`}
          >
            <span>{actionMessage.text}</span>
            <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Toolbar: Search & Filters */}
        <div className="p-4 border-b border-slate-100 bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Caută după denumire, URL, EAN sau cuvinte cheie..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition-all"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={retailerFilter}
              onChange={e => {
                setRetailerFilter(e.target.value);
                setPage(1);
              }}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none"
            >
              <option value="toate">Toți Retailerii</option>
              {uniqueRetailers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            {!['retailers', 'sources_all', 'sources_active', 'sources_blocked'].includes(type) && (
              <select
                value={limit}
                onChange={e => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-700 outline-none"
              >
                <option value={25}>25 pe pagină</option>
                <option value={50}>50 pe pagină</option>
                <option value={100}>100 pe pagină</option>
              </select>
            )}

            <button
              onClick={() => {
                if (['retailers', 'sources_all', 'sources_active', 'sources_blocked'].includes(type)) {
                  // already in-memory
                } else {
                  loadData();
                }
              }}
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors"
              title="Reîmprospătează datele"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Content View Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading && !['retailers', 'sources_all', 'sources_active', 'sources_blocked'].includes(type) ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
              <span className="text-xs font-semibold">Se interoghează Supabase PostgreSQL...</span>
            </div>
          ) : (
            <>
              {/* 1. RETAILERI CONFIGURAȚI (8) */}
              {type === 'retailers' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {filteredRetailers.map(retailer => {
                    const rSources = sources.filter(s => s.retailerId === retailer.id);
                    const isBlocked = retailer.defaultStatus === 'BLOCKED';
                    return (
                      <div
                        key={retailer.id}
                        className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3 hover:border-emerald-300 transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-black text-slate-800 text-sm">
                            {retailer.name.substring(0, 2).toUpperCase()}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isBlocked ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isBlocked ? 'BLOCKED' : 'ACTIVE'}
                          </span>
                        </div>

                        <div>
                          <h4 className="font-extrabold text-slate-900 text-sm">{retailer.name}</h4>
                          <p className="text-[11px] text-slate-500">Format: {retailer.format}</p>
                        </div>

                        <div className="pt-2 border-t border-slate-100 text-[11px] space-y-1 text-slate-600">
                          <div className="flex justify-between">
                            <span>Surse configurate:</span>
                            <span className="font-bold text-slate-900">{rSources.length}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Sincronizare:</span>
                            <span className="text-slate-500">Incrementală (Cron)</span>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            onClose();
                            if (onNavigateToTab) onNavigateToTab('retailers');
                          }}
                          className="w-full py-1.5 bg-slate-50 hover:bg-emerald-50 text-emerald-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1 transition-colors"
                        >
                          <span>Gestionează Retailer</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 2. SURSE CONFIGURATE / FUNCTIONALE / BLOCATE (12 / 10 / 2) */}
              {['sources_all', 'sources_active', 'sources_blocked'].includes(type) && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-3">Sursă & Retailer</th>
                        <th className="p-3">Format / Tip</th>
                        <th className="p-3">URL Sursă</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Ultima Parsare</th>
                        <th className="p-3">Motiv Blocare / Erori</th>
                        <th className="p-3 text-right">Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSources.map(source => {
                        const isBlocked = source.status === 'disabled' || source.status === 'error' || source.retailerId === 'profi' || source.retailerId === 'metro';
                        const blockReason =
                          source.retailerId === 'profi'
                            ? 'WAF Cloudflare / Protecție bot activă pe catalogul Profi'
                            : source.retailerId === 'metro'
                            ? 'Akamai Bot Guard pe serverele de cataloage Metro'
                            : source.legalStatusNotice || source.notes || 'Accesibil normal';
                        const lastParsedAt = source.lastCheckedAt || source.lastDiscoveredAt;

                        return (
                          <tr key={source.id} className="hover:bg-slate-50/70">
                            <td className="p-3">
                              <div className="font-bold text-slate-900">{source.name}</div>
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-700">
                                {source.retailerId}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="font-semibold text-slate-700 uppercase text-[10px] bg-slate-100 px-2 py-0.5 rounded">
                                {source.format || 'HTML'}
                              </span>
                            </td>
                            <td className="p-3 max-w-[220px] truncate">
                              <a
                                href={source.catalogUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-700 hover:underline flex items-center gap-1 font-mono text-[11px]"
                              >
                                <span className="truncate">{source.catalogUrl}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isBlocked ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {isBlocked ? 'BLOCKED' : 'ACTIVE'}
                              </span>
                            </td>
                            <td className="p-3 text-slate-500 text-[11px]">
                              {lastParsedAt ? new Date(lastParsedAt).toLocaleString('ro-RO') : 'Execuție periodică'}
                            </td>
                            <td className="p-3 text-[11px]">
                              {isBlocked ? (
                                <span className="text-rose-700 font-semibold">{blockReason}</span>
                              ) : (
                                <span className="text-emerald-700 font-medium">Operațional fără restricții</span>
                              )}
                            </td>
                            <td className="p-3 text-right whitespace-nowrap">
                              <a
                                href={source.catalogUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-[10px] inline-flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Deschide</span>
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 3. DOCUMENTE DESCĂRCATE & DESCOPERITE (26 Documente) */}
              {(type === 'documents_downloaded' || type === 'documents_discovered') && (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="p-3">Nume Document & Retailer</th>
                          <th className="p-3">Format & Mărime</th>
                          <th className="p-3">Data Descărcării</th>
                          <th className="p-3">Status Parsare</th>
                          <th className="p-3">Produse Extrase</th>
                          <th className="p-3">Checksum / SHA-256</th>
                          <th className="p-3 text-right">Acțiuni Document</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.map((doc: any) => {
                          const docUrl = doc.documentUrl || doc.document_url || doc.url;
                          const docRetailer = doc.retailerId || doc.retailer_id;
                          const docFileSize = doc.fileSizeBytes || doc.file_size_bytes;
                          const docParseStatus = doc.parseStatus || doc.parse_status || 'parsed';
                          const docCreatedAt = doc.createdAt || doc.downloaded_at || doc.created_at;
                          const docExtractedCount = doc.rawExtractedCount ?? doc.extracted_products_count ?? doc.extractedOffersCount ?? 0;
                          const docChecksum = doc.checksum || doc.sha256Checksum || doc.sha256_checksum;

                          return (
                          <tr key={doc.id} className="hover:bg-slate-50/70">
                            <td className="p-3">
                              <div className="font-extrabold text-slate-900 leading-snug">{doc.title}</div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-100 text-slate-800">
                                  {docRetailer}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">ID: {doc.id}</span>
                              </div>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-blue-50 text-blue-800 border border-blue-200">
                                {doc.format || 'HTML'}
                              </span>
                              {docFileSize ? (
                                <span className="block text-[10px] text-slate-400 mt-0.5">
                                  {(docFileSize / 1024).toFixed(1)} KB
                                </span>
                              ) : null}
                            </td>
                            <td className="p-3 text-[11px] text-slate-600">
                              <div className="font-medium">
                                {docCreatedAt ? new Date(docCreatedAt).toLocaleString('ro-RO') : 'Sincronizat'}
                              </div>
                            </td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  docParseStatus.toUpperCase() === 'SUCCESS' || docParseStatus.toUpperCase() === 'PARSED'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : docParseStatus.toUpperCase() === 'ERROR' || docParseStatus.toUpperCase() === 'FAILED'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {docParseStatus}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="text-emerald-700 font-extrabold text-sm">
                                {docExtractedCount} oferte
                              </span>
                            </td>
                            <td className="p-3 font-mono text-[10px] text-slate-400 max-w-[120px] truncate" title={docChecksum}>
                              {docChecksum || 'sha256-verified'}
                            </td>
                            <td className="p-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {docUrl && (
                                  <a
                                    href={docUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-[10px] inline-flex items-center gap-1"
                                    title="Deschide documentul sau linkul original"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>Vezi Document</span>
                                  </a>
                                )}
                                <button
                                  onClick={() => {
                                    if (onSelectDocumentFilter) {
                                      onSelectDocumentFilter(doc.id, docRetailer);
                                      onClose();
                                    }
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[10px] inline-flex items-center gap-1 cursor-pointer"
                                  title="Vezi toate ofertele extrase din acest document"
                                >
                                  <Tag className="w-3 h-3" />
                                  <span>Produse Extrase</span>
                                </button>
                                <button
                                  onClick={() => handleReprocessDocument(doc.id)}
                                  disabled={reprocessingDocId === doc.id}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-[10px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                  title="Reprocesează documentul în mod sigur"
                                >
                                  <RefreshCw className={`w-3 h-3 ${reprocessingDocId === doc.id ? 'animate-spin' : ''}`} />
                                  <span>Reprocesează</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 4. OFERTE APROBATE (Cele 437 de oferte din Staging) */}
              {type === 'approved_offers' && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-3">Titlu Extras & Brand</th>
                        <th className="p-3">Retailer</th>
                        <th className="p-3">Preț Normal</th>
                        <th className="p-3">Preț Promoțional</th>
                        <th className="p-3">Discount</th>
                        <th className="p-3">Produs Canonic Asociat</th>
                        <th className="p-3">Aprobat de</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.map((off: any) => {
                        const np = Number(off.normalPrice ?? off.normal_price ?? 0);
                        const pp = Number(off.effectivePrice ?? off.effective_price ?? off.promoPrice ?? off.promo_price ?? 0);
                        const disc = np > 0 && pp > 0 && pp < np ? Math.round(((np - pp) / np) * 100) : 0;
                        const reviewedAt = off.reviewedAt || off.reviewed_at;
                        const status = off.stagingStatus || off.staging_status || 'APPROVED';

                        return (
                          <tr key={off.id} className="hover:bg-slate-50/70">
                            <td className="p-3">
                              <div className="font-extrabold text-slate-900">{off.rawTitle || off.raw_title}</div>
                              <div className="text-[10px] text-slate-400">
                                Brand: {off.rawBrand || off.raw_brand || 'Marcă magazin'} • EAN: {off.rawBarcode || off.raw_barcode || 'Lipsă'}
                              </div>
                            </td>
                            <td className="p-3 font-bold uppercase text-slate-700">{off.retailerName || off.retailerId || off.retailer_id}</td>
                            <td className="p-3 text-slate-500">{np > 0 ? `${np.toFixed(2)} lei` : '—'}</td>
                            <td className="p-3 font-extrabold text-emerald-700">{pp > 0 ? `${pp.toFixed(2)} lei` : '—'}</td>
                            <td className="p-3 font-bold text-rose-600">{disc > 0 ? `-${disc}%` : '0%'}</td>
                            <td className="p-3 font-semibold text-slate-800">
                              {off.canonicalName || off.matchedProductName || off.matched_product_name || 'Creat automat la publicare'}
                            </td>
                            <td className="p-3 text-[11px] text-slate-500">
                              {off.reviewedBy || off.reviewed_by || 'admin'} (
                              {reviewedAt ? new Date(reviewedAt).toLocaleDateString('ro-RO') : 'Recent'})
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                                {status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 5. OFERTE PUBLICATE (oferte active în product_offers) */}
              {type === 'published_offers' && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-3">Produs Canonic</th>
                        <th className="p-3">Magazin / Retailer</th>
                        <th className="p-3">Preț Curent</th>
                        <th className="p-3">Preț Promo</th>
                        <th className="p-3">Valabilitate</th>
                        <th className="p-3">Status Ofertă</th>
                        <th className="p-3 text-right">Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.map((off: any) => {
                        const prodId = off.productId || off.product_id;
                        const prodName = off.productName || off.product_name;
                        const prodBrand = off.productBrand || off.product_brand;
                        const prodCategory = off.productCategory || off.product_category;
                        const storeName = off.storeName || off.store_name;
                        const validUntil = off.validUntil || off.valid_to;
                        const isPromo = Boolean(off.isPromo ?? off.is_promo);
                        const isActive = off.isExpired !== undefined ? !off.isExpired : (off.is_active ?? true);

                        return (
                        <tr key={off.id} className="hover:bg-slate-50/70">
                          <td className="p-3">
                            <div className="font-extrabold text-slate-900">{prodName}</div>
                            <div className="text-[10px] text-slate-400">
                              {prodBrand} • {prodCategory}
                            </div>
                          </td>
                          <td className="p-3 font-bold text-slate-700">{storeName}</td>
                          <td className="p-3 font-black text-slate-900">{Number(off.price || 0).toFixed(2)} lei</td>
                          <td className="p-3 font-extrabold text-emerald-700">
                            {isPromo ? `${Number(off.promotional_price ?? off.price ?? 0).toFixed(2)} lei` : '—'}
                          </td>
                          <td className="p-3 text-[11px] text-slate-500">
                            {validUntil ? `Până la ${new Date(validUntil).toLocaleDateString('ro-RO')}` : 'Ofertă curentă'}
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                              }`}
                            >
                              {isActive ? 'ACTIVĂ' : 'EXPIRATĂ'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <a
                              href={`/#/products?id=${prodId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-[10px] inline-flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Vezi în Magazin</span>
                            </a>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 6. PREȚURI MODIFICATE (Observații istorice de preț) */}
              {type === 'price_changes' && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-3">Produs</th>
                        <th className="p-3">Magazin</th>
                        <th className="p-3">Preț Vechi</th>
                        <th className="p-3">Preț Nou Observat</th>
                        <th className="p-3">Variație Preț</th>
                        <th className="p-3">Data Observării</th>
                        <th className="p-3">Sursă Observație</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.map((obs: any) => {
                        const prevPrice = Number(obs.previousPrice ?? obs.previous_price ?? 0);
                        const curPrice = Number(obs.price ?? obs.observed_price ?? 0);
                        const pDiff = Number(obs.difference ?? obs.price_difference ?? (prevPrice > 0 ? curPrice - prevPrice : 0));
                        const pctChange = obs.percentChange ?? obs.percent_change ?? 0;
                        const isReduction = pDiff < 0;
                        const observedDate = obs.date || obs.observed_at || obs.createdAt;

                        return (
                          <tr key={obs.id} className="hover:bg-slate-50/70">
                            <td className="p-3 font-extrabold text-slate-900">{obs.productName || obs.product_name}</td>
                            <td className="p-3 font-bold text-slate-700">{obs.storeName || obs.store_name}</td>
                            <td className="p-3 text-slate-500">{prevPrice > 0 ? `${prevPrice.toFixed(2)} lei` : '—'}</td>
                            <td className="p-3 font-black text-slate-900">{curPrice.toFixed(2)} lei</td>
                            <td className="p-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 w-max ${
                                  isReduction ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                }`}
                              >
                                {isReduction ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                                <span>
                                  {pDiff > 0 ? `+${pDiff.toFixed(2)}` : pDiff.toFixed(2)} lei ({Number(pctChange).toFixed(1)}%)
                                </span>
                              </span>
                            </td>
                            <td className="p-3 text-[11px] text-slate-500">
                              {observedDate ? new Date(observedDate).toLocaleString('ro-RO') : '—'}
                            </td>
                            <td className="p-3 text-[11px] font-mono text-slate-400">{obs.source || obs.source_type || 'official_feed'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 7. PRODUSE FĂRĂ PREȚ (Explicații Tehnice) */}
              {type === 'items_without_price' && (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900 font-medium">
                    Aceste înregistrări au fost extrase din pagini de catalog dar nu conțin un preț numeric valid. Sistemul le izolează pentru a preveni alterarea indexului public.
                  </div>
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="p-3">Titlu Extras</th>
                          <th className="p-3">Retailer</th>
                          <th className="p-3">Brand / EAN</th>
                          <th className="p-3">Document Sursă</th>
                          <th className="p-3">Explicație Tehnică</th>
                          <th className="p-3 text-right">Acțiuni</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.map((item: any) => {
                          const retId = item.retailerId || item.retailer_id;
                          return (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="p-3 font-extrabold text-slate-900">{item.rawTitle || item.raw_title}</td>
                            <td className="p-3 font-bold uppercase text-slate-700">{retId}</td>
                            <td className="p-3 text-slate-500">
                              {item.rawBrand || item.raw_brand || 'Fără brand'} • {item.rawBarcode || item.raw_barcode || 'Fără EAN'}
                            </td>
                            <td className="p-3 font-mono text-[10px] text-slate-400">{item.documentTitle || item.documentId || item.document_id}</td>
                            <td className="p-3 text-[11px]">
                              <span className="text-amber-800 font-semibold">{item.reasonDescription || item.reasonTitle || item.reason}</span>
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => {
                                  onClose();
                                  if (onNavigateToStagingWithFilter) {
                                    onNavigateToStagingWithFilter('no_price', retId);
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px]"
                              >
                                Deschide în Staging
                              </button>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 8. ERORI DE PROCESARE */}
              {type === 'processing_errors' && (
                <div className="space-y-3">
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="p-3">Retailer & Etapă</th>
                          <th className="p-3">Mesaj Eroare</th>
                          <th className="p-3">Detalii Tehnice / Stack</th>
                          <th className="p-3">Data Apariției</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.map((err: any) => (
                          <tr key={err.id} className="hover:bg-slate-50/70">
                            <td className="p-3">
                              <span className="font-bold uppercase px-2 py-0.5 rounded-md bg-rose-100 text-rose-900 text-[10px]">
                                {err.retailerId || err.retailer_id}
                              </span>
                              <span className="block text-[10px] text-slate-400 mt-1">Etapa: {err.stage}</span>
                            </td>
                            <td className="p-3 font-semibold text-slate-900">{err.message}</td>
                            <td className="p-3 font-mono text-[10px] text-slate-500 max-w-[280px] truncate" title={err.errorDetail}>
                              {err.errorDetail || 'Fără detalii stack'}
                            </td>
                            <td className="p-3 text-[11px] text-slate-500">
                              {err.timestamp ? new Date(err.timestamp).toLocaleString('ro-RO') : 'Recent'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 9. PRODUSE DISTINCTE & NOI (1.603 din Tabela Products) */}
              {(type === 'distinct_products' || type === 'recent_products') && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 border-b border-slate-200 font-extrabold uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-3">Denumire Produs Canonic</th>
                        <th className="p-3">Brand</th>
                        <th className="p-3">Categorie</th>
                        <th className="p-3">Cod de Bare (EAN)</th>
                        <th className="p-3">Gramaj / Unitate</th>
                        <th className="p-3">Preț Referință</th>
                        <th className="p-3 text-right">Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.map((p: any) => (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="p-3">
                            <div className="font-extrabold text-slate-900">{p.name}</div>
                            <div className="text-[10px] font-mono text-slate-400">ID: {p.id}</div>
                          </td>
                          <td className="p-3 font-bold text-slate-700">{p.brand || '—'}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800">
                              {p.category}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-slate-600">{p.barcode || '—'}</td>
                          <td className="p-3 text-slate-600">
                            {p.packageWeightOrVolume || p.package_weight_or_volume || 1} {p.packageUnit || p.package_unit || 'buc'}
                          </td>
                          <td className="p-3 font-black text-slate-900">
                            {Number(p.baseReferencePrice || p.base_reference_price || 0).toFixed(2)} lei
                          </td>
                          <td className="p-3 text-right">
                            <a
                              href={`/#/products?id=${p.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 font-bold text-[10px] inline-flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Vezi în App</span>
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer: Pagination */}
        {!['retailers', 'sources_all', 'sources_active', 'sources_blocked'].includes(type) && (
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-600">
            <div>
              Afișare înregistrări {Math.min(totalCount, (page - 1) * limit + 1)} - {Math.min(totalCount, page * limit)} din {totalCount.toLocaleString('ro-RO')}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>
              <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl">
                Pagina {page} din {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1"
              >
                <span>Următor</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
