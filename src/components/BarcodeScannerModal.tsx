import React, { useEffect, useRef, useState } from 'react';
import {
  Barcode,
  Camera,
  CheckCircle2,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Store as StoreIcon,
  X,
  ArrowRight
} from 'lucide-react';
import { BarcodeLookupResult, Product, ProductCategory, UnitType } from '../types.js';
import { STORES } from '../data/mockData.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  accessToken?: string;
  onAddToList: (productId: string, productName: string, productData?: Product) => Promise<boolean> | void;
  onViewProduct?: (productId: string) => void;
}

const CATEGORIES: ProductCategory[] = [
  'Fructe și legume',
  'Lactate și ouă',
  'Carne și pește',
  'Panificație',
  'Băuturi',
  'Produse congelate',
  'Produse de bază',
  'Curățenie',
  'Igienă personală',
  'Alte produse'
];

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  open,
  onClose,
  accessToken,
  onAddToList,
  onViewProduct
}) => {
  const [manualCode, setManualCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<BarcodeLookupResult | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraSupported, setCameraSupported] = useState<boolean>(true);
  const [addedToast, setAddedToast] = useState(false);

  // Suggestion moderation form state
  const [proposedName, setProposedName] = useState('');
  const [proposedBrand, setProposedBrand] = useState('');
  const [proposedCategory, setProposedCategory] = useState<ProductCategory>('Produse de bază');
  const [proposedWeight, setProposedWeight] = useState('');
  const [proposedUnit, setProposedUnit] = useState<UnitType>('buc');
  const [observedStoreId, setObservedStoreId] = useState('');
  const [observedPrice, setObservedPrice] = useState('');
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);
  const [suggestionResultMsg, setSuggestionResultMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setErrorMsg(null);
      setSuggestionResultMsg(null);
      setAddedToast(false);
    }
    return () => {
      stopCamera();
    };
  }, [open]);

  const handleLookupBarcode = async (codeToSearch: string) => {
    const cleaned = codeToSearch.replace(/\D/g, '').trim();
    if (!cleaned) {
      setErrorMsg('Introdu un cod de bare numeric valid (ex: 5941234567890).');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    setSuggestionResultMsg(null);
    setAddedToast(false);
    try {
      const res = await fetch(`/api/catalog/barcode/${encodeURIComponent(cleaned)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Codul de bare nu a putut fi verificat.');
      }
      setResult(data as BarcodeLookupResult);
      setManualCode(cleaned);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Eroare la căutarea codului de bare.');
    } finally {
      setLoading(false);
    }
  };

  const startCameraScan = async () => {
    setErrorMsg(null);
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCameraSupported(false);
      setErrorMsg('Camera nu este disponibilă în acest browser. Folosește introducerea manuală a codului EAN/UPC.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      streamRef.current = stream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const BarcodeDetectorCtor = (window as any).BarcodeDetector;
      if (typeof BarcodeDetectorCtor !== 'function') {
        setCameraSupported(false);
        setErrorMsg(
          'Browserul nu suportă decodare automată nativă BarcodeDetector. Poți introduce codul EAN/UPC manual mai jos.'
        );
        return;
      }

      const detector = new BarcodeDetectorCtor({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
      });

      const scanFrame = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const detected = await detector.detect(videoRef.current);
          if (Array.isArray(detected) && detected.length > 0 && detected[0]?.rawValue) {
            const rawVal = String(detected[0].rawValue);
            stopCamera();
            await handleLookupBarcode(rawVal);
            return;
          }
        } catch {
          // Ignore single frame detection error
        }
        rafRef.current = requestAnimationFrame(() => {
          void scanFrame();
        });
      };

      rafRef.current = requestAnimationFrame(() => {
        void scanFrame();
      });
    } catch {
      setCameraSupported(false);
      setErrorMsg('Nu am putut accesa camera. Verifică permisiunile sau introdu codul de bare manual.');
      stopCamera();
    }
  };

  const handleSubmitSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!result?.searchedBarcode || !proposedName.trim()) return;
    setSubmittingSuggestion(true);
    setErrorMsg(null);
    setSuggestionResultMsg(null);
    try {
      const res = await fetch('/api/products/suggestions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({
          barcode: result.searchedBarcode,
          proposedName: proposedName.trim(),
          proposedBrand: proposedBrand.trim() || undefined,
          category: proposedCategory,
          packageWeightOrVolume: proposedWeight ? Number(proposedWeight) : undefined,
          packageUnit: proposedUnit,
          observedStoreId: observedStoreId || undefined,
          observedPrice: observedPrice ? Number(observedPrice) : undefined
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Sugestia nu a putut fi înregistrată.');
      }
      setSuggestionResultMsg(
        data.messageRo ||
          'Sugestia a fost salvată pentru moderare și nu este publicată automat în catalog.'
      );
      setProposedName('');
      setProposedBrand('');
      setObservedPrice('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Eroare la trimiterea sugestiei.');
    } finally {
      setSubmittingSuggestion(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 dark:border-slate-800 my-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
              <Barcode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Scanare Cod de Bare (EAN / UPC)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Caută rapid produsul în catalog și compară ofertele active
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            aria-label="Închide scanerul"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Scanner Box */}
        <div className="mb-4">
          {cameraActive ? (
            <div className="relative rounded-2xl overflow-hidden bg-black aspect-video border border-slate-800">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-16 border-2 border-emerald-400/80 rounded-xl pointer-events-none" />
              <button
                type="button"
                onClick={stopCamera}
                className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-slate-900/90 text-white text-xs font-bold cursor-pointer"
              >
                Oprește camera
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { void startCameraScan(); }}
              className="w-full py-3 px-4 rounded-2xl border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>Pornește camera telefonului pentru scanare</span>
            </button>
          )}
          {!cameraSupported && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
              Introdu codul numeric tipărit sub codul de bare mai jos.
            </p>
          )}
        </div>

        {/* Manual Barcode Search */}
        <form
          onSubmit={e => {
            e.preventDefault();
            void handleLookupBarcode(manualCode);
          }}
          className="flex items-center gap-2 mb-4"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              inputMode="numeric"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              placeholder="ex: 5941000012345 (EAN-8 / EAN-13 / UPC)"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold disabled:opacity-50 cursor-pointer shrink-0"
          >
            {loading ? 'Caut...' : 'Caută'}
          </button>
        </form>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        {/* Result: FOUND */}
        {result && result.found && result.product && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/40 dark:bg-emerald-950/30 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                  {result.product.brand} · {result.product.packageWeightOrVolume} {result.product.packageUnit}
                </span>
                <h4 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  {result.product.name}
                </h4>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  EAN: {result.product.barcode || result.searchedBarcode}
                </span>
              </div>
              {result.lowestPrice !== null && (
                <div className="text-right tabular-nums shrink-0">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">Cel mai mic</span>
                  <span className="font-display text-xl font-black text-emerald-700 dark:text-emerald-400">
                    {PriceComparisonService.formatRon(result.lowestPrice)}
                  </span>
                  {result.lowestStoreName && (
                    <span className="text-[11px] text-slate-600 dark:text-slate-300 block">
                      la {result.lowestStoreName}
                    </span>
                  )}
                </div>
              )}
            </div>

            {result.offers.length > 0 ? (
              <div className="space-y-1.5 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Oferte active ({result.offers.length})
                </div>
                {result.offers.slice(0, 4).map(({ offer, store }) => (
                  <div
                    key={offer.id}
                    className="flex items-center justify-between text-xs bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200/80 dark:border-slate-800"
                  >
                    <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <StoreIcon className="w-3.5 h-3.5 text-slate-400" />
                      {store.name}
                    </span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {PriceComparisonService.formatRon(offer.price)}
                      <span className="text-[11px] font-normal text-slate-500 ml-1">
                        ({PriceComparisonService.formatRon(offer.unitPrice)}/{result.product!.normalizedUnit})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Produsul există în catalog, dar nu are oferte active verificate în acest moment.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {onViewProduct && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onViewProduct(result.product!.id);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <span>Detalii produs</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  await onAddToList(result.product!.id, result.product!.name, result.product);
                  setAddedToast(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
              >
                {addedToast ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{addedToast ? 'Adăugat în listă!' : 'Adaugă în listă'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Result: NOT FOUND -> Moderation-first Suggestion Form */}
        {result && !result.found && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/40 dark:bg-amber-950/30 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  Codul {result.searchedBarcode} nu există încă în catalog
                </p>
                <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                  Sugerează produsul pentru verificare editorială. Sugestiile intră în moderare și nu se publică automat.
                </p>
              </div>
            </div>

            {suggestionResultMsg ? (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{suggestionResultMsg}</span>
              </div>
            ) : (
              <form onSubmit={handleSubmitSuggestion} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Denumire produs *
                    </label>
                    <input
                      type="text"
                      required
                      value={proposedName}
                      onChange={e => setProposedName(e.target.value)}
                      placeholder="ex: Iaurt grecesc 10%"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Brand (opțional)
                    </label>
                    <input
                      type="text"
                      value={proposedBrand}
                      onChange={e => setProposedBrand(e.target.value)}
                      placeholder="ex: Olympus"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Categorie
                    </label>
                    <select
                      value={proposedCategory}
                      onChange={e => setProposedCategory(e.target.value as ProductCategory)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                    >
                      {CATEGORIES.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Gramaj
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={proposedWeight}
                      onChange={e => setProposedWeight(e.target.value)}
                      placeholder="ex: 400"
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Unitate
                    </label>
                    <select
                      value={proposedUnit}
                      onChange={e => setProposedUnit(e.target.value as UnitType)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                    >
                      {(['buc', 'g', 'kg', 'ml', 'l', 'pachet'] as UnitType[]).map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Magazin observat (opțional)
                    </label>
                    <select
                      value={observedStoreId}
                      onChange={e => setObservedStoreId(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="">Alege magazin...</option>
                      {STORES.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Preț văzut la raft (lei)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={observedPrice}
                      onChange={e => setObservedPrice(e.target.value)}
                      placeholder="ex: 8.99"
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingSuggestion}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{submittingSuggestion ? 'Se trimite...' : 'Trimite sugestie spre moderare'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
