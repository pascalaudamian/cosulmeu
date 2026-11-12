// src/components/AdminStagingOfferDrawer.tsx
// Drawer complet pentru inspecția tehnică detaliată a unei oferte din Staging Queue
// Date brute, normalizare, potrivire canonică, document sursă, avertismente și acțiuni

import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ExternalLink,
  Package,
  Tag,
  Store,
  Barcode,
  Calendar,
  Layers,
  Sparkles,
  RefreshCw,
  Search,
  Check,
  Percent,
  Clock,
  ShieldCheck,
  Edit3,
  Plus
} from 'lucide-react';
import { CatalogExtractedOffer } from '../indexing/catalog/catalogTypes.js';

interface AdminStagingOfferDrawerProps {
  offer: CatalogExtractedOffer | null;
  onClose: () => void;
  onApprove: (offerId: string) => Promise<void>;
  onReject: (offerId: string, reason?: string) => Promise<void>;
  onViewDocument?: (documentId: string) => void;
  adminToken: string;
}

export const AdminStagingOfferDrawer: React.FC<AdminStagingOfferDrawerProps> = ({
  offer,
  onClose,
  onApprove,
  onReject,
  onViewDocument,
  adminToken
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('Date incomplete sau neconforme');
  const [isSearchingProduct, setIsSearchingProduct] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isLinkingProduct, setIsLinkingProduct] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!offer) return null;

  const normalPrice = Number(offer.normalPrice || 0);
  const promoPrice = Number(offer.promoPrice || 0);
  const effectivePrice = Number(offer.effectivePrice || 0);
  const discountPercent = normalPrice > 0 && promoPrice > 0 && promoPrice < normalPrice
    ? Math.round(((normalPrice - promoPrice) / normalPrice) * 100)
    : 0;

  // Validation Warnings
  const warnings: string[] = [];
  if (!effectivePrice || effectivePrice <= 0) {
    warnings.push('Preț nul sau lipsă în catalog (promoție non-standard sau eroare OCR).');
  }
  if (discountPercent > 65) {
    warnings.push(`Discount neobișnuit de mare (${discountPercent}%). Verifică prețul de bază.`);
  }
  if (!offer.rawBarcode && !offer.retailerSku) {
    warnings.push('Fără cod de bare (EAN) sau SKU retailer. Potrivirea se bazează pe text.');
  }
  if (offer.matchConfidence && offer.matchConfidence < 0.6) {
    warnings.push(`Încredere scăzută în potrivirea automată (${Math.round(offer.matchConfidence * 100)}%).`);
  }

  const handleSearchCanonical = async () => {
    if (!productSearchTerm.trim()) return;
    setIsSearchingProduct(true);
    try {
      const res = await fetch(`/api/admin/products-detailed?limit=5&search=${encodeURIComponent(productSearchTerm)}`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (res.ok) {
        const json = await res.json();
        setSearchResults(json.products || []);
      }
    } catch {
    } finally {
      setIsSearchingProduct(false);
    }
  };

  const handleLinkProduct = async (product: any) => {
    setIsLinkingProduct(true);
    try {
      const res = await fetch(`/api/admin/catalog-importer/staging/${offer.id}/review`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'approve',
          matchedProductId: product.id,
          matchedProductName: product.name,
          matchMethod: 'manual',
          matchConfidence: 1.0,
          userEmail: 'admin@cosulmeu.ro'
        })
      });
      if (res.ok) {
        setMessage({ type: 'success', text: `Asociat cu succes la „${product.name}”!` });
        setTimeout(() => {
          onApprove(offer.id);
        }, 800);
      }
    } catch {
      setMessage({ type: 'error', text: 'Eroare la asocierea produsului canonic.' });
    } finally {
      setIsLinkingProduct(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-lg text-xs font-black uppercase tracking-wider bg-slate-900 text-white">
                {offer.retailerId}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${
                  offer.stagingStatus === 'VALIDATED'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : offer.stagingStatus === 'APPROVED'
                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                    : offer.stagingStatus === 'PUBLISHED'
                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                    : offer.stagingStatus === 'REJECTED'
                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                    : 'bg-amber-100 text-amber-900 border border-amber-200'
                }`}
              >
                {offer.stagingStatus}
              </span>
              <span className="text-[11px] font-mono text-slate-400">ID: {offer.id.slice(0, 14)}...</span>
            </div>
            <h2 className="text-lg font-black text-slate-900 leading-snug">{offer.rawTitle}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs text-slate-700">
          {message && (
            <div
              className={`p-3 rounded-xl font-bold flex items-center gap-2 ${
                message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}

          {/* Warnings Banner */}
          {warnings.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-1.5">
              <div className="font-extrabold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Atenționări de Validare ({warnings.length})</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-amber-800 text-[11px] font-medium">
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Pricing Overview Box */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-2.5 bg-white rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Preț Normal</div>
              <div className="text-base font-black text-slate-700 mt-1">
                {normalPrice > 0 ? `${normalPrice.toFixed(2)} lei` : '—'}
              </div>
            </div>
            <div className="p-2.5 bg-white rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Preț Promo</div>
              <div className="text-base font-black text-rose-600 mt-1">
                {promoPrice > 0 ? `${promoPrice.toFixed(2)} lei` : '—'}
              </div>
            </div>
            <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200">
              <div className="text-[10px] font-bold text-emerald-800 uppercase">Preț Efectiv</div>
              <div className="text-base font-black text-emerald-700 mt-1">
                {effectivePrice > 0 ? `${effectivePrice.toFixed(2)} lei` : 'NESPECIFICAT'}
              </div>
            </div>
            <div className="p-2.5 bg-white rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Discount</div>
              <div className="text-base font-black text-slate-900 mt-1">
                {discountPercent > 0 ? `-${discountPercent}%` : '0%'}
              </div>
            </div>
          </div>

          {/* 1. Date Brute Extrase */}
          <div className="space-y-3">
            <h3 className="font-black uppercase tracking-wider text-slate-500 text-[11px] flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-slate-600" />
              <span>1. Date Brute Extrase din Document</span>
            </h3>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
              <div className="p-3 flex justify-between gap-4">
                <span className="font-semibold text-slate-500">Titlu Catalog:</span>
                <span className="font-bold text-slate-900 text-right">{offer.rawTitle}</span>
              </div>
              <div className="p-3 flex justify-between gap-4">
                <span className="font-semibold text-slate-500">Brand Extras:</span>
                <span className="font-bold text-slate-800">{offer.rawBrand || 'Nespecificat (Marcă Retailer)'}</span>
              </div>
              <div className="p-3 flex justify-between gap-4">
                <span className="font-semibold text-slate-500">Cod de bare (EAN):</span>
                <span className="font-mono font-bold text-slate-800">{offer.rawBarcode || 'Lipsă din catalog'}</span>
              </div>
              <div className="p-3 flex justify-between gap-4">
                <span className="font-semibold text-slate-500">SKU Retailer:</span>
                <span className="font-mono text-slate-800">{offer.retailerSku || 'Lipsă'}</span>
              </div>
              <div className="p-3 flex justify-between gap-4">
                <span className="font-semibold text-slate-500">Cantitate / Unitate Extrasă:</span>
                <span className="font-bold text-slate-800">
                  {offer.packageQuantity || 1} {offer.packageUnit || 'buc'}
                </span>
              </div>
              <div className="p-3 flex justify-between gap-4">
                <span className="font-semibold text-slate-500">Perioadă Valabilitate Promo:</span>
                <span className="font-semibold text-slate-700">
                  {offer.validFrom ? new Date(offer.validFrom).toLocaleDateString('ro-RO') : 'Start catalog'} —{' '}
                  {offer.validTo ? new Date(offer.validTo).toLocaleDateString('ro-RO') : 'Final catalog'}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Potrivire Produs Canonic */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-black uppercase tracking-wider text-slate-500 text-[11px] flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-slate-600" />
                <span>2. Potrivire Produs Canonic (Catalog Central)</span>
              </h3>
              <button
                type="button"
                onClick={() => setProductSearchTerm(offer.rawBrand || offer.rawTitle.split(' ')[0])}
                className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center gap-1"
              >
                <Edit3 className="w-3 h-3" />
                <span>Schimbă asocierea</span>
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
              {offer.matchedProductId ? (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">{offer.matchedProductName}</div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">ID: {offer.matchedProductId}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-bold">
                        Metodă: {offer.matchMethod || 'fuzzy'}
                      </span>
                      {offer.matchConfidence !== undefined && (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md text-[10px] font-bold">
                          Încredere: {Math.round(offer.matchConfidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="p-2 rounded-xl bg-emerald-50 text-emerald-700">
                    <CheckCircle2 className="w-5 h-5" />
                  </span>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 rounded-xl text-amber-900 border border-amber-100 flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Niciun produs canonic existent identificat. La aprobare, va fi creat automat un produs nou în catalog.
                  </span>
                </div>
              )}

              {/* Manual Linker Search Box */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="text-[11px] font-bold text-slate-600">Caută alt produs canonic existent:</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={productSearchTerm}
                    onChange={e => setProductSearchTerm(e.target.value)}
                    placeholder="Introdu nume sau brand produs..."
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 text-xs outline-none focus:border-emerald-500"
                    onKeyDown={e => e.key === 'Enter' && handleSearchCanonical()}
                  />
                  <button
                    type="button"
                    onClick={handleSearchCanonical}
                    disabled={isSearchingProduct}
                    className="px-3 py-1.5 bg-slate-900 text-white rounded-xl font-bold text-xs hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isSearchingProduct ? '...' : 'Caută'}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden mt-2 max-h-48 overflow-y-auto">
                    {searchResults.map(p => (
                      <div key={p.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50 gap-2">
                        <div>
                          <div className="font-bold text-slate-800 text-[11px]">{p.name}</div>
                          <div className="text-[10px] text-slate-400">
                            {p.brand} • {p.category}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleLinkProduct(p)}
                          disabled={isLinkingProduct}
                          className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-bold text-[10px] hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Asociază
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3. Document Sursă & Trasabilitate */}
          <div className="space-y-3">
            <h3 className="font-black uppercase tracking-wider text-slate-500 text-[11px] flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-600" />
              <span>3. Document Sursă & Trasabilitate Pipeline</span>
            </h3>
            <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-500">ID Document Sursă:</span>
                <span className="font-mono text-slate-800 font-bold">{offer.documentId}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-500">Data Extragerii:</span>
                <span className="text-slate-800 font-medium">
                  {offer.createdAt ? new Date(offer.createdAt).toLocaleString('ro-RO') : 'Recent'}
                </span>
              </div>
              {offer.reviewedBy && (
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-500">Validat de:</span>
                  <span className="text-emerald-700 font-bold">
                    {offer.reviewedBy} ({offer.reviewedAt ? new Date(offer.reviewedAt).toLocaleString('ro-RO') : ''})
                  </span>
                </div>
              )}
              {onViewDocument && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => onViewDocument(offer.documentId)}
                    className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Vezi Documentul Original Descărcat</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50"
          >
            Închide
          </button>

          <div className="w-full sm:w-auto flex items-center gap-2">
            {!showRejectInput ? (
              <button
                type="button"
                onClick={() => setShowRejectInput(true)}
                disabled={isProcessing}
                className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-xs transition-colors disabled:opacity-50"
              >
                Respinge Oferta
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  placeholder="Motiv respingere..."
                  className="px-2.5 py-1.5 rounded-lg border border-rose-300 text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setIsProcessing(true);
                    await onReject(offer.id, rejectionReason);
                    setIsProcessing(false);
                    onClose();
                  }}
                  className="px-3 py-1.5 bg-rose-600 text-white rounded-lg font-bold text-xs hover:bg-rose-700"
                >
                  Confirmă
                </button>
                <button
                  type="button"
                  onClick={() => setShowRejectInput(false)}
                  className="px-2 py-1.5 text-slate-400 hover:text-slate-600 text-xs"
                >
                  Anulează
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={async () => {
                setIsProcessing(true);
                await onApprove(offer.id);
                setIsProcessing(false);
                onClose();
              }}
              disabled={isProcessing}
              className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{offer.stagingStatus === 'VALIDATED' ? 'Aprobă din nou' : 'Validează & Aprobă'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
