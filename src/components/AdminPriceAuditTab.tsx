// src/components/AdminPriceAuditTab.tsx
// Modul administrativ dedicat: "Audit Prețuri și Corectare Importuri"

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Filter,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X
} from 'lucide-react';
import {
  PriceAuditCategory,
  PriceAuditItem,
  PriceAuditSummary,
  PriceAuditBatchPreviewItem
} from '../types.js';

interface AdminPriceAuditTabProps {
  adminToken: string;
  onRefreshAll?: () => void;
}

const CATEGORY_OPTIONS: { id: PriceAuditCategory; label: string }[] = [
  { id: 'confirmed_wrong', label: 'Prețuri Greșite / Confuzie Cantitate' },
  { id: 'suspect_unverified', label: 'Prețuri Suspecte Neverificate' },
  { id: 'isolated', label: 'Oferte Izolate' },
  { id: 'valid_verified', label: 'Prețuri Valide Verificate' },
  { id: 'all', label: 'Toate Ofertele' }
];

const RETAILER_FILTERS = [
  { id: 'toate', label: 'Toți retailerii' },
  { id: 'kaufland', label: 'Kaufland' },
  { id: 'lidl', label: 'Lidl' },
  { id: 'mega-image', label: 'Mega Image' },
  { id: 'penny', label: 'Penny' },
  { id: 'carrefour', label: 'Carrefour' },
  { id: 'auchan', label: 'Auchan' },
  { id: 'profi', label: 'Profi' },
  { id: 'metro', label: 'Metro' }
];

function formatPriceRon(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} lei`;
}

function getCategoryLabel(cat: Exclude<PriceAuditCategory, 'all'>): { label: string; className: string } {
  switch (cat) {
    case 'confirmed_wrong':
      return { label: 'Confirmat Greșit', className: 'text-rose-700 bg-rose-50 border-rose-200' };
    case 'suspect_unverified':
      return { label: 'Suspect Neverificat', className: 'text-amber-700 bg-amber-50 border-amber-200' };
    case 'isolated':
      return { label: 'Izolat', className: 'text-slate-700 bg-slate-100 border-slate-300' };
    case 'valid_verified':
    default:
      return { label: 'Verificat Valid', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  }
}

export const AdminPriceAuditTab: React.FC<AdminPriceAuditTabProps> = ({ adminToken, onRefreshAll }) => {
  const [summary, setSummary] = useState<PriceAuditSummary | null>(null);
  const [items, setItems] = useState<PriceAuditItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [limit] = useState<number>(25);

  const [category, setCategory] = useState<PriceAuditCategory>('confirmed_wrong');
  const [retailerId, setRetailerId] = useState<string>('toate');
  const [search, setSearch] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Editare individuală
  const [editingItem, setEditingItem] = useState<PriceAuditItem | null>(null);
  const [editPriceInput, setEditPriceInput] = useState<string>('');
  const [editNormalPriceInput, setEditNormalPriceInput] = useState<string>('');
  const [editReasonInput, setEditReasonInput] = useState<string>('');
  const [isSubmittingSingle, setIsSubmittingSingle] = useState<boolean>(false);

  // Preview și confirmare lot
  const [batchModal, setBatchModal] = useState<{
    action: 'fix_price' | 'isolate' | 'verify';
    previews: PriceAuditBatchPreviewItem[];
    errors: string[];
  } | null>(null);
  const [isPreviewingBatch, setIsPreviewingBatch] = useState<boolean>(false);
  const [isApplyingBatch, setIsApplyingBatch] = useState<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const loadAuditData = useCallback(async () => {
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({
        category,
        retailerId,
        search: debouncedSearch,
        page: String(page),
        limit: String(limit)
      });
      const res = await fetch(`/api/admin/price-audit?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Nu s-au putut încărca datele de audit.');
      }
      setSummary(data.summary);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Eroare la încărcarea auditului de prețuri.' });
    } finally {
      setIsLoading(false);
    }
  }, [adminToken, category, retailerId, debouncedSearch, page, limit]);

  useEffect(() => {
    if (adminToken) {
      loadAuditData();
    }
  }, [adminToken, loadAuditData]);

  const openFixModal = (item: PriceAuditItem) => {
    const suggested = item.extractedEffectivePrice && item.extractedEffectivePrice > 0 ? item.extractedEffectivePrice : '';
    setEditingItem(item);
    setEditPriceInput(suggested ? String(suggested) : '');
    setEditNormalPriceInput(item.extractedNormalPrice ? String(item.extractedNormalPrice) : '');
    setEditReasonInput('Corectare preț pe baza documentului sursă verificat');
  };

  const handleSingleAction = async (
    item: PriceAuditItem,
    action: 'fix_price' | 'isolate' | 'verify',
    overridePrice?: number,
    overrideNormal?: number | null,
    reasonText?: string
  ) => {
    setIsSubmittingSingle(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/admin/price-audit/remediate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          dryRun: false,
          offerId: item.offerId,
          action,
          newPrice: overridePrice,
          newNormalPrice: overrideNormal ?? undefined,
          reason: reasonText || item.auditReason
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.errors?.[0] || json.error || 'Operațiunea nu a putut fi aplicată.');
      }
      setEditingItem(null);
      setActionMessage({
        type: 'success',
        text:
          action === 'fix_price'
            ? `Prețul pentru „${item.productName}” a fost actualizat la ${overridePrice?.toFixed(2)} lei.`
            : action === 'isolate'
            ? `Oferta „${item.productName}” a fost izolată din catalogul public.`
            : `Oferta „${item.productName}” a fost confirmată ca validă.`
      });
      await loadAuditData();
      if (onRefreshAll) onRefreshAll();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Eroare la remedierea ofertei.' });
    } finally {
      setIsSubmittingSingle(false);
    }
  };

  const handleOpenBatchPreview = async (action: 'isolate' | 'verify' | 'fix_price') => {
    const selectedItems = items.filter(it => selectedIds.has(it.offerId));
    if (selectedItems.length === 0) return;

    const payloadItems = selectedItems
      .map(it => {
        if (action === 'fix_price') {
          if (!it.extractedEffectivePrice || it.extractedEffectivePrice <= 0) return null;
          return {
            offerId: it.offerId,
            action: 'fix_price' as const,
            newPrice: it.extractedEffectivePrice,
            newNormalPrice: it.extractedNormalPrice ?? undefined,
            reason: 'Sincronizare din prețul extras verificat'
          };
        }
        return {
          offerId: it.offerId,
          action,
          reason:
            action === 'isolate'
              ? 'Izolare în lot din Audit Prețuri (anomalie cantitate/preț)'
              : 'Confirmare în lot din Audit Prețuri'
        };
      })
      .filter(Boolean);

    if (payloadItems.length === 0) {
      setActionMessage({
        type: 'error',
        text: 'Niciuna dintre ofertele selectate nu are un preț extras valid în staging pentru corecție automată.'
      });
      return;
    }

    setIsPreviewingBatch(true);
    try {
      const res = await fetch('/api/admin/price-audit/preview-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ dryRun: true, items: payloadItems })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Previzualizarea lotului a eșuat.');
      }
      setBatchModal({
        action,
        previews: json.previews || [],
        errors: json.errors || []
      });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Eroare la generarea previzualizării.' });
    } finally {
      setIsPreviewingBatch(false);
    }
  };

  const handleConfirmBatch = async () => {
    if (!batchModal || batchModal.previews.length === 0) return;
    setIsApplyingBatch(true);
    try {
      const payloadItems = batchModal.previews.map(p => ({
        offerId: p.offerId,
        action: p.action,
        newPrice: p.action === 'fix_price' ? p.newPrice : undefined,
        reason: p.reason
      }));

      const res = await fetch('/api/admin/price-audit/remediate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ dryRun: false, items: payloadItems })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.errors?.[0] || json.error || 'Aplicarea în lot a eșuat.');
      }
      setBatchModal(null);
      setSelectedIds(new Set());
      setActionMessage({
        type: 'success',
        text: `Remediere finalizată: ${json.affectedOffersCount} oferte actualizate (${json.updatedProductsCount} produse canonice, ${json.updatedStagingCount} staging).`
      });
      await loadAuditData();
      if (onRefreshAll) onRefreshAll();
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Eroare la aplicarea remedierii în lot.' });
    } finally {
      setIsApplyingBatch(false);
    }
  };

  const toggleAllVisible = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(items.map(i => i.offerId)));
    } else {
      setSelectedIds(new Set());
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">
            Audit Prețuri și Corectare Importuri
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Detectarea confuziei dintre cantitate/volum și preț, compararea cu documentul sursă și izolarea ofertelor neverificate din catalogul public.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAuditData}
          disabled={isLoading}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Reîncarcă Auditul</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {actionMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Strip (Single-elevation, tabular-nums, no clutter) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Total Oferte DB</div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
            {(summary?.totalPublishedOffers ?? 0).toLocaleString('ro-RO')}
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide">Confuzie Cantitate / Preț</div>
          <div className="text-2xl font-extrabold text-rose-700 tabular-nums mt-1">
            {(summary?.quantityConfusedCount ?? 0).toLocaleString('ro-RO')}
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">Oferte Suspecte</div>
          <div className="text-2xl font-extrabold text-amber-700 tabular-nums mt-1">
            {(summary?.suspectCount ?? 0).toLocaleString('ro-RO')}
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">Oferte Izolate</div>
          <div className="text-2xl font-extrabold text-slate-800 tabular-nums mt-1">
            {(summary?.isolatedCount ?? 0).toLocaleString('ro-RO')}
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200">
          <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Verificate & Valide</div>
          <div className="text-2xl font-extrabold text-emerald-700 tabular-nums mt-1">
            {(summary?.verifiedCount ?? 0).toLocaleString('ro-RO')}
          </div>
        </div>
      </div>

      {/* Category Segmented Controls + Search & Retailer Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
          {CATEGORY_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setCategory(opt.id);
                setPage(1);
                setSelectedIds(new Set());
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                category === opt.id
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Caută după produs, brand sau motiv anomalie (ex: Carlsberg, Agros, CCM)..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              value={retailerId}
              onChange={e => {
                setRetailerId(e.target.value);
                setPage(1);
                setSelectedIds(new Set());
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 bg-white focus:outline-none focus:border-emerald-500"
            >
              {RETAILER_FILTERS.map(r => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Batch selection action bar */}
        {selectedIds.size > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-bold text-slate-800 tabular-nums">
              {selectedIds.size} oferte selectate
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isPreviewingBatch}
                onClick={() => handleOpenBatchPreview('fix_price')}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Previzualizează Corectare din Sursă
              </button>
              <button
                type="button"
                disabled={isPreviewingBatch}
                onClick={() => handleOpenBatchPreview('isolate')}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Izolează Lotul Selectat
              </button>
              <button
                type="button"
                disabled={isPreviewingBatch}
                onClick={() => handleOpenBatchPreview('verify')}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Confirmă Valide
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Audit Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="p-3 w-9">
                  <input
                    type="checkbox"
                    aria-label="Selectează toate ofertele din pagină"
                    checked={items.length > 0 && items.every(i => selectedIds.has(i.offerId))}
                    onChange={e => toggleAllVisible(e.target.checked)}
                    className="rounded accent-emerald-600 cursor-pointer"
                  />
                </th>
                <th className="p-3 font-bold">Retailer & Produs</th>
                <th className="p-3 font-bold">Ambalaj</th>
                <th className="p-3 font-bold text-right">Preț DB Curent</th>
                <th className="p-3 font-bold text-right">Preț Extras Sursă</th>
                <th className="p-3 font-bold">Motiv / Anomalie</th>
                <th className="p-3 font-bold">Status</th>
                <th className="p-3 font-bold text-right">Acțiuni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={8} className="p-3">
                      <div className="h-5 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-slate-500 text-xs">
                    Nicio ofertă nu corespunde filtrelor selectate în această categorie de audit.
                  </td>
                </tr>
              ) : (
                items.map(item => {
                  const statusMeta = getCategoryLabel(item.auditCategory);
                  return (
                    <tr key={item.offerId} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`Selectează ${item.productName}`}
                          checked={selectedIds.has(item.offerId)}
                          onChange={e => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(item.offerId);
                            else next.delete(item.offerId);
                            setSelectedIds(next);
                          }}
                          className="rounded accent-emerald-600 cursor-pointer"
                        />
                      </td>
                      <td className="p-3 max-w-[260px]">
                        <div className="text-[11px] font-bold uppercase text-slate-500">{item.storeName}</div>
                        <div className="font-bold text-slate-900 truncate" title={item.productName}>
                          {item.productName}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{item.brand}</span>
                          {item.sourceDocumentUrl && (
                            <a
                              href={item.sourceDocumentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-700 hover:underline inline-flex items-center gap-0.5"
                            >
                              <span>Document sursă</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-slate-700 tabular-nums whitespace-nowrap">
                        {item.packageWeightOrVolume} {item.packageUnit}
                      </td>
                      <td className="p-3 text-right font-mono font-bold tabular-nums text-slate-900 whitespace-nowrap">
                        <div>{formatPriceRon(item.currentPrice)}</div>
                        <div className="text-[10px] text-slate-500 font-normal">
                          {item.unitPrice.toFixed(2)} {item.unitPriceMeasure}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-emerald-700">
                          {formatPriceRon(item.extractedEffectivePrice)}
                        </div>
                        {item.extractedNormalPrice && item.extractedNormalPrice !== item.extractedEffectivePrice && (
                          <div className="text-[10px] text-slate-400 line-through">
                            {formatPriceRon(item.extractedNormalPrice)}
                          </div>
                        )}
                      </td>
                      <td className="p-3 max-w-[260px] text-slate-600 leading-snug">
                        {item.auditReason}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-semibold ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openFixModal(item)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Corectează</span>
                          </button>
                          {item.verificationStatus !== 'isolated' && (
                            <button
                              type="button"
                              disabled={isSubmittingSingle}
                              onClick={() => handleSingleAction(item, 'isolate')}
                              className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <Lock className="w-3 h-3" />
                              <span>Izolează</span>
                            </button>
                          )}
                          {item.auditCategory !== 'valid_verified' && (
                            <button
                              type="button"
                              disabled={isSubmittingSingle}
                              onClick={() => handleSingleAction(item, 'verify')}
                              className="px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              <ShieldCheck className="w-3 h-3" />
                              <span>Validează</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <span className="tabular-nums">
            Total: <strong>{total.toLocaleString('ro-RO')}</strong> oferte · Pagina {page} din {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-3 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            >
              Următor
            </button>
          </div>
        </div>
      </div>

      {/* Modal Editare Individuală */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Corectare Preț Ofertă</h3>
                <p className="text-xs text-slate-600 mt-0.5">{editingItem.productName} ({editingItem.storeName})</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Preț curent în DB:</span>
                <span className="font-mono font-bold text-rose-700 tabular-nums">{formatPriceRon(editingItem.currentPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ambalaj canonic:</span>
                <span className="font-semibold text-slate-800">{editingItem.packageWeightOrVolume} {editingItem.packageUnit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Preț extras staging:</span>
                <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                  {formatPriceRon(editingItem.extractedEffectivePrice)}
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Preț efectiv verificat (RON)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.15"
                  value={editPriceInput}
                  onChange={e => setEditPriceInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                  placeholder="Ex: 5.79"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Preț normal / de referință (opțional, RON)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.15"
                  value={editNormalPriceInput}
                  onChange={e => setEditNormalPriceInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                  placeholder="Ex: 6.99"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Notă audit / sursă verificare</label>
                <input
                  type="text"
                  value={editReasonInput}
                  onChange={e => setEditReasonInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="button"
                disabled={isSubmittingSingle || !editPriceInput || Number(editPriceInput) <= 0}
                onClick={() =>
                  handleSingleAction(
                    editingItem,
                    'fix_price',
                    Number(editPriceInput),
                    editNormalPriceInput ? Number(editNormalPriceInput) : null,
                    editReasonInput
                  )
                }
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingSingle ? 'Se salvează...' : 'Salvează Prețul Verificat'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Previzualizare & Confirmare Lot */}
      {batchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Confirmare Remediere în Lot ({batchModal.previews.length} oferte)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Verifică diferențele înainte de scrierea definitivă în baza de date.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBatchModal(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {batchModal.errors.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                <strong>Avertismente validare:</strong> {batchModal.errors.join(' ')}
              </div>
            )}

            <div className="overflow-y-auto border border-slate-200 rounded-xl flex-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                  <tr>
                    <th className="p-2.5 font-bold">Produs</th>
                    <th className="p-2.5 font-bold">Retailer</th>
                    <th className="p-2.5 font-bold text-right">Preț Vechi</th>
                    <th className="p-2.5 font-bold text-right">Preț / Status Nou</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batchModal.previews.map(p => (
                    <tr key={p.offerId}>
                      <td className="p-2.5 font-semibold text-slate-800">{p.productName}</td>
                      <td className="p-2.5 uppercase text-slate-500">{p.storeId}</td>
                      <td className="p-2.5 text-right font-mono tabular-nums text-rose-700">
                        {p.oldPrice.toFixed(2)} lei ({p.oldVerificationStatus})
                      </td>
                      <td className="p-2.5 text-right font-mono tabular-nums text-emerald-700 font-bold">
                        {p.newPrice !== undefined ? `${p.newPrice.toFixed(2)} lei` : 'Izolat'} ({p.newVerificationStatus})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setBatchModal(null)}
                disabled={isApplyingBatch}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={handleConfirmBatch}
                disabled={isApplyingBatch || batchModal.previews.length === 0}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isApplyingBatch ? 'Se aplică...' : `Aplică Modificările (${batchModal.previews.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
