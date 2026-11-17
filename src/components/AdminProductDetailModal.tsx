import React, { useState, useEffect } from 'react';
import {
  X,
  Package,
  Store,
  Tag,
  Clock,
  TrendingDown,
  TrendingUp,
  Layers,
  Calendar,
  ExternalLink,
  Barcode,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface AdminProductDetailModalProps {
  productId: string | null;
  onClose: () => void;
  adminToken: string;
}

export const AdminProductDetailModal: React.FC<AdminProductDetailModalProps> = ({
  productId,
  onClose,
  adminToken
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/admin/products-detailed/${encodeURIComponent(productId)}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('Nu s-au putut încărca detaliile produsului.');
        return res.json();
      })
      .then(resData => {
        if (resData.success && resData.data) {
          setData(resData.data);
        } else {
          throw new Error('Răspuns invalid de la server.');
        }
      })
      .catch(err => {
        setError(err.message || 'Eroare la încărcare');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [productId, adminToken]);

  if (!productId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                  {productId}
                </span>
                {data?.product?.is_bio && (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-bold">
                    BIO
                  </span>
                )}
                {data?.product?.is_romanian_product && (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-bold">
                    PRODUS ROMÂNESC 🇷🇴
                  </span>
                )}
              </div>
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-slate-50 mt-1">
                {data?.product?.name || 'Detalii Produs Canonic'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Brand: <strong className="text-slate-700 dark:text-slate-200">{data?.product?.brand || 'Nespecificat'}</strong> • Categorie: <strong className="text-slate-700 dark:text-slate-200">{data?.product?.category}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 border-3 border-emerald-600 dark:border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Se interoghează datele canonice din PostgreSQL Supabase...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="space-y-6 text-xs">
            {/* 1. Atribute Canonice */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-slate-400 dark:text-slate-400 text-[11px] block">Gramaj / Volum:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">
                  {data?.product?.package_weight_or_volume} {data?.product?.package_unit}
                </span>
              </div>
              <div>
                <span className="text-slate-400 dark:text-slate-400 text-[11px] block">Unitate Normalizată:</span>
                <span className="font-bold text-slate-800 dark:text-slate-100 uppercase">
                  per {data?.product?.normalized_unit}
                </span>
              </div>
              <div>
                <span className="text-slate-400 dark:text-slate-400 text-[11px] block">Cod Bare (GTIN/EAN):</span>
                <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                  {data?.product?.barcode || 'Fără cod de bare'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 dark:text-slate-400 text-[11px] block">Preț Referință Bază:</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">
                  {data?.product?.base_reference_price ? `${Number(data.product.base_reference_price).toFixed(2)} lei` : '—'}
                </span>
              </div>
            </div>

            {/* 2. Oferte Curente în Supermarketuri */}
            <div className="space-y-2">
              <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Oferte Curente Active în Supermarketuri ({data?.offers?.length || 0})</span>
              </h4>
              {data?.offers && data.offers.length > 0 ? (
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {data.offers.map((off: any) => (
                    <div key={off.id} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-extrabold uppercase text-[10px] text-slate-700 dark:text-slate-200">
                          {off.store_name || off.store_id}
                        </span>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">
                            {Number(off.price).toFixed(2)} lei
                            {off.is_promo && off.normal_price && Number(off.normal_price) > Number(off.price) && (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500 line-through ml-2 font-normal">
                                {Number(off.normal_price).toFixed(2)} lei
                              </span>
                            )}
                          </div>
                          {off.loyalty_card_required && (
                            <span className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                              Necesită {off.loyalty_card_name || 'Card Fidelitate'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-slate-400 dark:text-slate-500">
                        <span>Verificat: {off.observation_date || 'Recent'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-slate-400 dark:text-slate-500">
                  Nicio ofertă de supermarket asociată în acest moment.
                </div>
              )}
            </div>

            {/* 3. Istoric Prețuri (Append-Only) */}
            <div className="space-y-2">
              <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Istoric Observații Preț (Ultimele {data?.priceHistory?.length || 0})</span>
              </h4>
              {data?.priceHistory && data.priceHistory.length > 0 ? (
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
                  {data.priceHistory.map((obs: any) => (
                    <div key={obs.id} className="p-2.5 flex items-center justify-between gap-3 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 dark:text-slate-500 font-mono">{obs.date ? new Date(obs.date).toLocaleDateString('ro-RO') : '—'}</span>
                        <span className="font-bold uppercase px-1.5 py-0.5 rounded-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px]">
                          {obs.store_id}
                        </span>
                        <span className="text-slate-600 dark:text-slate-400">{obs.source}</span>
                      </div>
                      <div className="font-extrabold text-slate-900 dark:text-slate-100">
                        {Number(obs.price).toFixed(2)} lei
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-slate-400 dark:text-slate-500">
                  Fără istoric de observații înregistrat.
                </div>
              )}
            </div>

            {/* 4. Mapări Retailer (SKU & Denumire brută) */}
            {data?.retailerMappings && data.retailerMappings.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                  <Barcode className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Mapări Retailer & Proveniență SKU</span>
                </h4>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                  {data.retailerMappings.map((rm: any) => (
                    <div key={rm.id} className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="font-bold uppercase text-slate-700 dark:text-slate-200">{rm.retailer_id}:</span>
                        <span className="text-slate-600 dark:text-slate-400 truncate max-w-sm">{rm.scraped_name}</span>
                      </div>
                      <span className="font-mono text-slate-400 dark:text-slate-500">SKU: {rm.external_sku}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 flex justify-end border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs cursor-pointer transition-colors"
          >
            Închide
          </button>
        </div>
      </div>
    </div>
  );
};
