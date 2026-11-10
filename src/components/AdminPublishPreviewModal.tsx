import React from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  X,
  Package,
  Layers,
  Tag,
  Store,
  ArrowRight,
  TrendingUp,
  AlertCircle
} from 'lucide-react';

export interface PublishPreviewData {
  toPublishCount: number;
  newProductsCount: number;
  existingUpdatedCount: number;
  unchangedProductsCount: number;
  newOffersCount: number;
  updatedOffersCount: number;
  priceChangesCount: number;
  itemsWithoutPriceCount: number;
  needsReviewCount: number;
  retailersInvolved: string[];
  sampleItems: { id: string; title: string; price: number; retailerId: string; isNewProduct: boolean }[];
  errors: string[];
}

interface AdminPublishPreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  preview: PublishPreviewData | null;
  isPublishing: boolean;
}

export const AdminPublishPreviewModal: React.FC<AdminPublishPreviewModalProps> = ({
  open,
  onClose,
  onConfirm,
  preview,
  isPublishing
}) => {
  if (!open || !preview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                Rezumat Înainte de Publicare în Catalogul Public
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Verificați modificările canonice și ofertele ce vor fi persistate în PostgreSQL Supabase.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPublishing}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Breakdown Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/70">
            <div className="text-[11px] font-semibold text-emerald-800">Produse Noi</div>
            <div className="text-xl font-extrabold text-emerald-700 mt-0.5">{preview.newProductsCount}</div>
            <div className="text-[10px] text-emerald-600">create în catalog</div>
          </div>

          <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200/70">
            <div className="text-[11px] font-semibold text-sky-800">Produse Actualizate</div>
            <div className="text-xl font-extrabold text-sky-700 mt-0.5">{preview.existingUpdatedCount}</div>
            <div className="text-[10px] text-sky-600">asociate canonic</div>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-[11px] font-semibold text-slate-700">Prețuri Modificate</div>
            <div className="text-xl font-extrabold text-slate-900 mt-0.5">{preview.priceChangesCount}</div>
            <div className="text-[10px] text-slate-500">istoric append-only</div>
          </div>

          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/70">
            <div className="text-[11px] font-semibold text-amber-800">Fără Preț (Izolate)</div>
            <div className="text-xl font-extrabold text-amber-700 mt-0.5">{preview.itemsWithoutPriceCount}</div>
            <div className="text-[10px] text-amber-600">protejate de suprascriere</div>
          </div>
        </div>

        {/* Retailers Involved */}
        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-600 font-medium">
            <Store className="w-4 h-4 text-emerald-600" />
            <span>Retaileri implicați în lot:</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {preview.retailersInvolved.map(r => (
              <span key={r} className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 font-bold uppercase text-[10px] text-slate-700">
                {r}
              </span>
            ))}
          </div>
        </div>

        {/* Warnings & Errors */}
        {preview.errors.length > 0 && (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-rose-700">
              <AlertCircle className="w-4 h-4" />
              <span>Avertizări identificate la validare ({preview.errors.length}):</span>
            </div>
            <ul className="list-disc list-inside text-[11px] text-rose-800 space-y-0.5 pl-1">
              {preview.errors.slice(0, 3).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Sample Items Preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span>Mostră articole ({preview.sampleItems.length} din {preview.toPublishCount}):</span>
            <span className="text-slate-400 font-normal">Total oferte gata de publicare: {preview.toPublishCount}</span>
          </div>
          <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 max-h-48 overflow-y-auto text-xs">
            {preview.sampleItems.map(item => (
              <div key={item.id} className="p-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                <div className="flex items-center gap-2 truncate">
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold uppercase text-slate-600">
                    {item.retailerId}
                  </span>
                  <span className="font-semibold text-slate-800 truncate">{item.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.isNewProduct && (
                    <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                      PRODUS NOU
                    </span>
                  )}
                  <span className="font-extrabold text-emerald-700">{item.price.toFixed(2)} lei</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100">
          <span className="text-[11px] text-slate-500 text-center sm:text-left">
            Publicarea este ireversibilă și va actualiza comparatoarele de prețuri live.
          </span>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              disabled={isPublishing}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-xs cursor-pointer transition-colors"
            >
              Anulează
            </button>
            <button
              onClick={onConfirm}
              disabled={isPublishing || preview.toPublishCount === 0}
              className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isPublishing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Se publică în PostgreSQL...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirmă & Publică ({preview.toPublishCount} oferte)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
