import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  X,
  Package,
  Store,
  AlertCircle,
  Trash2,
  Search,
  RefreshCw,
  ExternalLink,
  FileText,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type {
  PublishPreviewData,
  PublishPreviewItem
} from '../indexing/catalog/CatalogStagingManager.js';

export type { PublishPreviewData, PublishPreviewItem };

interface AdminPublishPreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCleanUnpublished: () => void;
  onRefreshPreview?: () => void;
  preview: PublishPreviewData | null;
  isPublishing: boolean;
  isCleaning: boolean;
  isRefreshingPreview?: boolean;
  publishErrorMessage: string | null;
  cleanupErrorMessage: string | null;
  hasConflict?: boolean;
}

const ITEMS_PER_PAGE = 50;

export const AdminPublishPreviewModal: React.FC<AdminPublishPreviewModalProps> = ({
  open,
  onClose,
  onConfirm,
  onCleanUnpublished,
  onRefreshPreview,
  preview,
  isPublishing,
  isCleaning,
  isRefreshingPreview = false,
  publishErrorMessage,
  cleanupErrorMessage,
  hasConflict = false
}) => {
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [retailerFilter, setRetailerFilter] = useState<string>('toate');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showAllItems, setShowAllItems] = useState<boolean>(false);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSearchTerm('');
      setRetailerFilter('toate');
      setCurrentPage(1);
      setShowAllItems(false);
      setConfirmingCleanup(false);
    }
  }, [open, preview?.previewSnapshotHash]);

  const allItems: PublishPreviewItem[] = useMemo(() => {
    if (!preview) return [];
    if (Array.isArray(preview.items) && preview.items.length > 0) return preview.items;
    return Array.isArray(preview.sampleItems) ? preview.sampleItems : [];
  }, [preview]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return allItems.filter(item => {
      if (retailerFilter !== 'toate' && item.retailerId !== retailerFilter) return false;
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        (item.brand || '').toLowerCase().includes(query) ||
        (item.ean || '').toLowerCase().includes(query) ||
        (item.retailerSku || '').toLowerCase().includes(query) ||
        (item.retailerName || item.retailerId).toLowerCase().includes(query) ||
        (item.documentTitle || '').toLowerCase().includes(query)
      );
    });
  }, [allItems, searchTerm, retailerFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const displayedItems = showAllItems
    ? filteredItems
    : filteredItems.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  if (!open || !preview) return null;

  const existingOffersDisplay = preview.existingOffersCount ?? preview.updatedOffersCount ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-preview-title"
        className="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 p-5 sm:p-6 shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 id="publish-preview-title" className="text-lg font-extrabold text-slate-900 tracking-tight">
                Rezumat Înainte de Publicare în Catalogul Public
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Verificați produsele și ofertele aprobate care vor fi persistate în PostgreSQL Supabase.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {onRefreshPreview && (
              <button
                type="button"
                onClick={onRefreshPreview}
                disabled={isPublishing || isCleaning || isRefreshingPreview}
                title="Reîncarcă previzualizarea din PostgreSQL"
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingPreview ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Reîncarcă</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isPublishing || isCleaning}
              aria-label="Închide previzualizarea"
              className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {/* Indicators Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/70">
              <div className="text-[11px] font-semibold text-emerald-800">Produse Noi</div>
              <div className="text-xl font-extrabold text-emerald-700 mt-0.5">
                {preview.newProductsCount.toLocaleString('ro-RO')}
              </div>
              <div className="text-[10px] text-emerald-600">create în catalog</div>
            </div>

            <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200/70">
              <div className="text-[11px] font-semibold text-sky-800">Produse Actualizate</div>
              <div className="text-xl font-extrabold text-sky-700 mt-0.5">
                {preview.existingUpdatedCount.toLocaleString('ro-RO')}
              </div>
              <div className="text-[10px] text-sky-600">asociate canonic</div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="text-[11px] font-semibold text-slate-700">Prețuri Modificate</div>
              <div className="text-xl font-extrabold text-slate-900 mt-0.5">
                {preview.priceChangesCount.toLocaleString('ro-RO')}
              </div>
              <div className="text-[10px] text-slate-500">istoric append-only</div>
            </div>

            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/70">
              <div className="text-[11px] font-semibold text-amber-800">Fără Preț (Izolate)</div>
              <div className="text-xl font-extrabold text-amber-700 mt-0.5">
                {preview.itemsWithoutPriceCount.toLocaleString('ro-RO')}
              </div>
              <div className="text-[10px] text-amber-600">protejate de publicare</div>
            </div>

            <div className="p-3 rounded-2xl bg-teal-50 border border-teal-200/70">
              <div className="text-[11px] font-semibold text-teal-800">Oferte Noi</div>
              <div className="text-xl font-extrabold text-teal-700 mt-0.5">
                {preview.newOffersCount.toLocaleString('ro-RO')}
              </div>
              <div className="text-[10px] text-teal-600">inserate în catalog</div>
            </div>

            <div className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200/70">
              <div className="text-[11px] font-semibold text-indigo-800">Oferte Existente</div>
              <div className="text-xl font-extrabold text-indigo-700 mt-0.5">
                {existingOffersDisplay.toLocaleString('ro-RO')}
              </div>
              <div className="text-[10px] text-indigo-600">actualizate incremental</div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-900 text-white border border-slate-800 col-span-2 sm:col-span-2 lg:col-span-1">
              <div className="text-[11px] font-semibold text-slate-300">Total Pregătite</div>
              <div className="text-xl font-extrabold text-emerald-400 mt-0.5">
                {preview.toPublishCount.toLocaleString('ro-RO')}
              </div>
              <div className="text-[10px] text-slate-400">eligibile acum</div>
            </div>
          </div>

          {/* Retailers Involved */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-slate-600 font-medium">
              <Store className="w-4 h-4 text-emerald-600" />
              <span>Retaileri implicați ({preview.retailersInvolved.length}):</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {preview.retailersInvolved.length > 0 ? (
                preview.retailersInvolved.map(r => (
                  <span
                    key={r}
                    className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 font-bold uppercase text-[10px] text-slate-700"
                  >
                    {r}
                  </span>
                ))
              ) : (
                <span className="text-slate-400 italic">Niciun retailer implicat</span>
              )}
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
                {preview.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {publishErrorMessage && (
            <div role="alert" className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-rose-800">
                  {hasConflict
                    ? 'Conflict de sincronizare: lista ofertelor aprobate s-a modificat.'
                    : 'Publicarea nu a fost confirmată în baza de date.'}
                </div>
                {hasConflict && onRefreshPreview && (
                  <button
                    type="button"
                    onClick={onRefreshPreview}
                    disabled={isRefreshingPreview}
                    className="px-3 py-1 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshingPreview ? 'animate-spin' : ''}`} />
                    <span>Reîncarcă Previzualizarea</span>
                  </button>
                )}
              </div>
              <p className="break-words">{publishErrorMessage}</p>
              <p className="text-rose-700">Ofertele aprobate rămân intacte în staging și pot fi publicate după actualizarea previzualizării.</p>
            </div>
          )}

          {cleanupErrorMessage && (
            <div role="alert" className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
              <div className="font-bold text-rose-800">Curățarea nu a reușit.</div>
              <p className="mt-1 break-words">{cleanupErrorMessage}</p>
            </div>
          )}

          {/* Full List of Eligible Offers */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-800">
                Toate ofertele aprobate și validate pentru publicare ({filteredItems.length} din {preview.toPublishCount}):
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Caută produs, EAN, SKU..."
                    className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs text-slate-800 outline-none focus:border-emerald-500 w-52"
                  />
                </div>

                {preview.retailersInvolved.length > 1 && (
                  <select
                    value={retailerFilter}
                    onChange={e => {
                      setRetailerFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 outline-none"
                  >
                    <option value="toate">Toți retailerii</option>
                    {preview.retailersInvolved.map(r => (
                      <option key={r} value={r}>
                        {r.toUpperCase()}
                      </option>
                    ))}
                  </select>
                )}

                {filteredItems.length > ITEMS_PER_PAGE && (
                  <button
                    type="button"
                    onClick={() => setShowAllItems(prev => !prev)}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    {showAllItems ? `Paginare (${ITEMS_PER_PAGE})` : `Arată toate (${filteredItems.length})`}
                  </button>
                )}
              </div>
            </div>

            {displayedItems.length > 0 ? (
              <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 max-h-[38vh] overflow-y-auto text-xs bg-white">
                {displayedItems.map(item => {
                  const hasValidImage = item.imageUrl && !brokenImages.has(item.id);
                  const np = Number(item.normalPrice || item.price);
                  const ep = Number(item.price || 0);
                  const disc =
                    item.discountPercentage !== undefined && item.discountPercentage > 0
                      ? item.discountPercentage
                      : np > ep && np > 0
                      ? Math.round(((np - ep) / np) * 100)
                      : 0;

                  return (
                    <div
                      key={item.id}
                      className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {hasValidImage ? (
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            onError={() => setBrokenImages(prev => new Set(prev).add(item.id))}
                            className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0 bg-slate-50"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                            <Package className="w-5 h-5" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold uppercase text-slate-700">
                              {item.retailerName || item.retailerId}
                            </span>
                            <span className="font-bold text-slate-900 break-words">{item.title}</span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                            <span>
                              Cantitate: <strong className="text-slate-700">{item.packageQuantity || 1} {item.packageUnit || 'buc'}</strong>
                            </span>
                            {item.ean && (
                              <span className="font-mono">
                                EAN: <strong className="text-slate-700">{item.ean}</strong>
                              </span>
                            )}
                            {item.retailerSku && (
                              <span className="font-mono">
                                SKU: <strong className="text-slate-700">{item.retailerSku}</strong>
                              </span>
                            )}
                            {item.matchedProductName && (
                              <span className="text-sky-700 font-medium truncate max-w-xs">
                                Canonic: {item.matchedProductName}
                              </span>
                            )}
                          </div>

                          {(item.documentTitle || item.documentUrl) && (
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                              <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                              {item.documentUrl ? (
                                <a
                                  href={item.documentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-700 hover:underline flex items-center gap-1 truncate max-w-md"
                                >
                                  <span>{item.documentTitle || item.documentUrl}</span>
                                  <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                </a>
                              ) : (
                                <span className="truncate max-w-md">{item.documentTitle}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap sm:flex-col sm:items-end justify-between gap-1.5 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold ${
                              item.isNewProduct
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-sky-100 text-sky-800'
                            }`}
                          >
                            {item.canonicalStatus || (item.isNewProduct ? 'PRODUS NOU' : 'PRODUS EXISTENT')}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold ${
                              item.offerAction === 'PREȚ MODIFICAT'
                                ? 'bg-amber-100 text-amber-800'
                                : item.offerAction === 'OFERTĂ ACTUALIZATĂ'
                                ? 'bg-indigo-100 text-indigo-800'
                                : item.offerAction === 'FĂRĂ SCHIMBĂRI'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-teal-100 text-teal-800'
                            }`}
                          >
                            {item.offerAction || 'OFERTĂ NOUĂ'}
                          </span>
                        </div>

                        <div className="flex items-baseline gap-2">
                          {np > ep && (
                            <span className="text-[11px] text-slate-400 line-through">
                              {np.toFixed(2)} lei
                            </span>
                          )}
                          <span className="text-sm font-extrabold text-emerald-700">
                            {ep.toFixed(2)} lei
                          </span>
                          {disc > 0 && (
                            <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                              -{disc}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-8 text-center border border-slate-200 rounded-2xl text-slate-400 text-xs">
                {allItems.length === 0
                  ? 'Nu există oferte validate și aprobate pentru publicare.'
                  : 'Nicio ofertă nu corespunde filtrului curent.'}
              </div>
            )}

            {!showAllItems && totalPages > 1 && (
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 pt-1">
                <span>
                  Pagina {safePage} din {totalPages} ({filteredItems.length} oferte)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Anterior</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Următor</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-slate-100 bg-slate-50/70 shrink-0">
          {confirmingCleanup ? (
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-2" role="alertdialog" aria-label="Confirmare ștergere din staging">
              <p className="text-xs font-bold text-amber-900">Elimini {preview.cleanupOfferIds.length} oferte nepublicate din staging?</p>
              <p className="text-[11px] text-amber-800">
                Această acțiune șterge doar înregistrările din staging. Produsele, ofertele publice și istoricul prețurilor nu sunt modificate. Înregistrările deja publicate sunt protejate.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingCleanup(false)}
                  disabled={isCleaning}
                  className="px-3 py-2 rounded-xl border border-amber-300 text-amber-900 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  Păstrează
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingCleanup(false);
                    onCleanUnpublished();
                  }}
                  disabled={isCleaning}
                  className="px-3 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {isCleaning ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Elimină din staging
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                Publicarea actualizează catalogul live. Anularea nu modifică baza de date.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingCleanup(true)}
                  disabled={isPublishing || isCleaning || preview.cleanupOfferIds.length === 0}
                  className="px-3 py-2.5 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Curăță staging ({preview.cleanupOfferIds.length})
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPublishing || isCleaning}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-semibold text-xs cursor-pointer transition-colors"
                >
                  Anulează
                </button>
                <button
                  type="button"
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
    </div>
  );
};
