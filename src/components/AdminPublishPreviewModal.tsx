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
  AlertCircle,
  Trash2
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
  cleanupOfferIds: string[];
  errors: string[];
}

interface AdminPublishPreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCleanUnpublished: () => void;
  preview: PublishPreviewData | null;
  isPublishing: boolean;
  isCleaning: boolean;
  publishErrorMessage: string | null;
  cleanupErrorMessage: string | null;
}

export const AdminPublishPreviewModal: React.FC<AdminPublishPreviewModalProps> = ({
  open,
  onClose,
  onConfirm,
  onCleanUnpublished,
  preview,
  isPublishing,
  isCleaning,
  publishErrorMessage,
  cleanupErrorMessage
}) => {
  const [confirmingCleanup, setConfirmingCleanup] = React.useState(false);
  if (!open || !preview) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div role="dialog" aria-modal="true" aria-labelledby="publish-preview-title" className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 id="publish-preview-title" className="text-lg font-extrabold text-slate-900 tracking-tight">
                Rezumat Înainte de Publicare în Catalogul Public
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Verificați modificările canonice și ofertele ce vor fi persistate în PostgreSQL Supabase.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isPublishing || isCleaning}
            aria-label="Închide previzualizarea"
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

        {publishErrorMessage && (
          <div role="alert" className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
            <div className="font-bold text-rose-800">Publicarea nu a fost confirmată în baza de date.</div>
            <p className="mt-1 break-words">{publishErrorMessage}</p>
            <p className="mt-1 text-rose-700">Ofertele rămân în staging și pot fi reîncercate sau eliminate mai jos.</p>
          </div>
        )}
        {cleanupErrorMessage && (
          <div role="alert" className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
            <div className="font-bold text-rose-800">Curățarea nu a reușit.</div>
            <p className="mt-1 break-words">{cleanupErrorMessage}</p>
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

        {confirmingCleanup ? (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-2" role="alertdialog" aria-label="Confirmare ștergere din staging">
            <p className="text-xs font-bold text-amber-900">Elimini {preview.cleanupOfferIds.length} oferte nepublicate din staging?</p>
            <p className="text-[11px] text-amber-800">Această acțiune șterge doar înregistrările din staging. Produsele, ofertele publice și istoricul prețurilor nu sunt modificate. Înregistrările deja publicate sunt protejate.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingCleanup(false)} disabled={isCleaning} className="px-3 py-2 rounded-xl border border-amber-300 text-amber-900 text-xs font-semibold disabled:opacity-50">Păstrează</button>
              <button type="button" onClick={() => { setConfirmingCleanup(false); onCleanUnpublished(); }} disabled={isCleaning} className="px-3 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
                {isCleaning ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Elimină din staging
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-slate-100">
            <p className="text-[11px] text-slate-500">Publicarea actualizează catalogul live. Curățarea afectează numai staging-ul.</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingCleanup(true)}
                disabled={isPublishing || isCleaning || preview.cleanupOfferIds.length === 0}
                className="px-3 py-2.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs disabled:opacity-50 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Curăță staging ({preview.cleanupOfferIds.length})
              </button>
              <button
                onClick={onClose}
                disabled={isPublishing || isCleaning}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-xs cursor-pointer transition-colors"
              >
                Anulează
              </button>
              <button
                onClick={onConfirm}
                disabled={isPublishing || isCleaning || preview.toPublishCount === 0}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
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
        )}
      </div>
    </div>
  );
};
