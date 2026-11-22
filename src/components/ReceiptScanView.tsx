import React, { useState, useRef } from 'react';
import { CameraCapture } from './CameraCapture.js';
import type { ProcessedReceiptImage, ReceiptImageQualityReport } from '../utils/receiptImageProcessor.js';
import {
  Camera,
  Upload,
  RotateCw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Receipt as ReceiptIcon,
  Plus,
  Trash2,
  Clock,
  MapPin,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  Check
} from 'lucide-react';
import { Receipt, ReceiptItem, ProductCategory } from '../types.js';
import { STORES } from '../data/mockData.js';
import { PriceComparisonService } from '../services/PriceComparisonService.js';
import { ReceiptValidator } from '../services/ReceiptValidator.js';

interface ReceiptScanViewProps {
  onReceiptSaved: (receipt: Receipt) => void | Promise<void>;
  onNavigateToHistory: () => void;
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

export const ReceiptScanView: React.FC<ReceiptScanViewProps> = ({
  onReceiptSaved,
  onNavigateToHistory
}) => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [rotation, setRotation] = useState<number>(0);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [imageQuality, setImageQuality] = useState<ReceiptImageQualityReport | null>(null);

  // Editable parsed receipt state
  const [parsedReceipt, setParsedReceipt] = useState<Receipt | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setScanError('Te rugăm să încarci un fișier imagine valid (JPG, PNG, WEBP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      setImageQuality(null);
      setParsedReceipt(null);
      setScanError(null);
      setSaveSuccess(false);
    };
    reader.readAsDataURL(file);
  };


  const handleCameraCapture = (image: ProcessedReceiptImage) => {
    setImageSrc(image.enhancedDataUrl);
    setImageQuality(image.quality);
    setRotation(image.rotation);
    setParsedReceipt(null);
    setScanError(null);
    setSaveSuccess(false);
    setIsCameraOpen(false);
  };

  // Rotate image
  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  // Send to server OCR API
  const handleProcessScan = async () => {
    if (!imageSrc) return;

    setIsScanning(true);
    setScanError(null);

    try {
      const response = await fetch('/api/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageSrc,
          mimeType: 'image/jpeg'
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Nu am putut procesa bonul fiscal.');
      }

      const rec = data.receipt;

      // Match store
      const identifiedStore = STORES.find(
        s => s.name.toLowerCase().includes(rec.storeName?.toLowerCase() || '')
      ) || STORES[0];

      // Format items with IDs
      const mappedItems: ReceiptItem[] = (rec.items || []).map((it: any, idx: number) => ({
        id: `ri-${Date.now()}-${idx}`,
        rawName: it.rawName || 'Produs supermarket',
        matchedProductName: it.rawName,
        quantity: it.quantity || 1,
        unitPrice: it.unitPrice || 0,
        totalPrice: it.totalPrice || (it.quantity || 1) * (it.unitPrice || 0),
        discount: it.discount || 0,
        category: (it.category as ProductCategory) || 'Alte produse',
        confidence: it.confidence === 'low' ? 'low' : it.confidence === 'medium' ? 'medium' : 'high',
        confidenceScore: Number.isFinite(it.confidenceScore) ? it.confidenceScore : undefined,
        vatRate: Number.isFinite(it.vatRate) ? it.vatRate : 9,
        isWeighted: Boolean(it.isWeighted),
        isSgr: Boolean(it.isSgr),
        matchStatus: it.matchStatus === 'ambiguous' || it.matchStatus === 'unmatched' ? it.matchStatus : undefined
      }));

      const finalReceipt: Receipt = {
        id: `rec-${Date.now()}`,
        storeId: identifiedStore.id,
        storeName: identifiedStore.name,
        storeAddress: rec.storeAddress || identifiedStore.sampleAddress,
        fiscalNumber: rec.fiscalNumber || `BF ${Math.floor(1000 + Math.random() * 9000)}`,
        date: rec.date || new Date().toISOString().split('T')[0],
        time: rec.time || '12:00',
        items: mappedItems,
        subtotal: rec.subtotal ?? mappedItems.reduce((s, i) => s + i.totalPrice, 0),
        discountTotal: rec.discountTotal ?? 0,
        sgrTotal: rec.sgrTotal ?? 0,
        vatTotal: rec.vatTotal,
        vatBreakdown: rec.vatBreakdown,
        printedTotal: rec.printedTotal ?? rec.total,
        total: rec.total ?? mappedItems.reduce((s, i) => s + i.totalPrice - i.discount, 0),
        currency: 'RON',
        imageUrl: imageSrc,
        createdAt: new Date().toISOString(),
        verifiedStatus: 'confirmed'
      };

      setParsedReceipt(ReceiptValidator.validate(finalReceipt));
    } catch (err: any) {
      console.error('Eroare scanare:', err);
      setScanError(err.message || 'Eroare la procesarea bonului. Verifică imaginea.');
    } finally {
      setIsScanning(false);
    }
  };

  // Update item field in editable confirmation table
  const handleUpdateItem = (index: number, field: keyof ReceiptItem, val: any) => {
    if (!parsedReceipt) return;

    const updatedItems = parsedReceipt.items.map((item, idx) => {
      if (idx !== index) return item;
      const updated = { ...item, [field]: val };
      if (field === 'quantity' || field === 'unitPrice') {
        updated.totalPrice = Math.round(updated.quantity * updated.unitPrice * 100) / 100;
      }
      return updated;
    });

    // Recalculate subtotal
    const newSubtotal = Math.round(updatedItems.reduce((s, i) => s + i.totalPrice, 0) * 100) / 100;
    const newTotal = Math.round((newSubtotal - parsedReceipt.discountTotal) * 100) / 100;

    setParsedReceipt(ReceiptValidator.validate({
      ...parsedReceipt,
      items: updatedItems,
      subtotal: newSubtotal,
      total: newTotal
    }));
  };

  // Delete line item
  const handleDeleteItem = (index: number) => {
    if (!parsedReceipt) return;
    const updatedItems = parsedReceipt.items.filter((_, idx) => idx !== index);
    const newSubtotal = Math.round(updatedItems.reduce((s, i) => s + i.totalPrice, 0) * 100) / 100;
    const newTotal = Math.max(0, Math.round((newSubtotal - parsedReceipt.discountTotal) * 100) / 100);

    setParsedReceipt(ReceiptValidator.validate({
      ...parsedReceipt,
      items: updatedItems,
      subtotal: newSubtotal,
      total: newTotal
    }));
  };

  // Add line item
  const handleAddLineItem = () => {
    if (!parsedReceipt) return;
    const newItem: ReceiptItem = {
      id: `ri-new-${Date.now()}`,
      rawName: 'Produs nou',
      quantity: 1,
      unitPrice: 5.0,
      totalPrice: 5.0,
      discount: 0,
      vatRate: 9,
      category: 'Alte produse',
      confidence: 'medium'
    };
    const updatedItems = [...parsedReceipt.items, newItem];
    const newSubtotal = Math.round(updatedItems.reduce((s, i) => s + i.totalPrice, 0) * 100) / 100;
    const newTotal = Math.round((newSubtotal - parsedReceipt.discountTotal) * 100) / 100;

    setParsedReceipt(ReceiptValidator.validate({
      ...parsedReceipt,
      items: updatedItems,
      subtotal: newSubtotal,
      total: newTotal
    }));
  };

  // Confirm & Save Receipt
  const handleConfirmAndSave = async () => {
    if (!parsedReceipt || isSaving) return;
    setIsSaving(true);
    setScanError(null);
    try {
      const validatedReceipt = ReceiptValidator.validate(parsedReceipt);
      await onReceiptSaved(validatedReceipt);
      setParsedReceipt(validatedReceipt);
      setSaveSuccess(true);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Bonul nu a putut fi salvat.');
    } finally {
      setIsSaving(false);
    }
  };


  // Calculate items sum vs receipt total discrepancy
  const itemsSum = parsedReceipt
    ? Math.round(parsedReceipt.items.reduce((s, i) => s + i.totalPrice - i.discount, 0) * 100) / 100
    : 0;
  const discrepancy = parsedReceipt ? Math.abs(itemsSum - parsedReceipt.total) : 0;
  const hasDiscrepancy = discrepancy > 0.05;

  return (
    <div className="space-y-6 pb-16">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-50 tracking-tight">
            Scanare Bon Fiscal 🧾
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-0.5">
            Încarcă bonul de cumpărături pentru a extrage automat produsele și a îmbunătăți istoricul personal de prețuri.
          </p>
        </div>
        <button
          onClick={onNavigateToHistory}
          className="self-start sm:self-auto px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <ReceiptIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          Istoric bonuri salvate
        </button>
      </div>

      {/* Success Notification */}
      {saveSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-100 flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div>
              <span className="font-bold text-sm block">Bonul a fost salvat cu succes!</span>
              <span className="text-xs text-emerald-700 dark:text-emerald-300">
                Prețurile au fost adăugate la istoricul tău personal și la statisticile de economii.
              </span>
            </div>
          </div>
          <button
            onClick={onNavigateToHistory}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 shrink-0"
          >
            Vezi în istoric
          </button>
        </div>
      )}

      {/* Upload & Capture Card */}
      {!parsedReceipt && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-xs">
          {!imageSrc ? (
            <div className="space-y-6">
              {/* Drop / Capture Zone */}
              <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-3xl p-8 sm:p-12 text-center transition-colors bg-slate-50/50 dark:bg-slate-950/60">
                <div className="w-16 h-16 rounded-3xl bg-emerald-100/80 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4">
                  <Camera className="w-8 h-8" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-50">
                  Fotografiază sau încarcă bonul fiscal
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  Acceptăm imagini JPG, PNG, WEBP. Asigură-te că magazinul, produsele și totalul sunt vizibile și luminate.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={() => setIsCameraOpen(true)}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Fă o poză cu camera</span>
                  </button>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border dark:border-slate-700 text-white font-semibold text-sm shadow-xs flex items-center gap-2 transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Alege fișier din telefon/PC</span>
                  </button>
                </div>
              </div>


            </div>
          ) : (
            /* Image Preview & Scan Action */
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-50">Previzualizare bon</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Verifică orientarea imaginii</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRotate}
                    className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Rotește imaginea cu 90 de grade"
                  >
                    <RotateCw className="w-4 h-4" />
                    <span className="hidden sm:inline">Rotește</span>
                  </button>
                  <button
                    onClick={() => { setImageSrc(null); setImageQuality(null); }}
                    className="p-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition-colors"
                  >
                    Schimbă imaginea
                  </button>
                </div>
              </div>

              {/* Image Display */}
              <div className="relative bg-slate-900 dark:bg-slate-950 dark:border dark:border-slate-800 rounded-2xl overflow-hidden flex items-center justify-center min-h-[300px] max-h-[480px]">
                <img
                  src={imageSrc}
                  alt="Bon fiscal"
                  style={{ transform: `rotate(${rotation}deg)` }}
                  className="max-h-[450px] object-contain transition-transform duration-300"
                />

                {/* Scanning Animation Overlay */}
                {isScanning && (
                  <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center text-white p-4 overflow-hidden">
                    {/* Laser scanning beam moving up and down */}
                    <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_25px_4px_rgba(52,211,153,0.9)] animate-[scanBeam_2s_ease-in-out_infinite] z-10"></div>
                    
                    {/* Scanning frame corners */}
                    <div className="absolute inset-6 sm:inset-10 border border-emerald-500/30 rounded-2xl pointer-events-none flex flex-col justify-between p-3">
                      <div className="flex justify-between">
                        <div className="w-5 h-5 border-t-2 border-l-2 border-emerald-400"></div>
                        <div className="w-5 h-5 border-t-2 border-r-2 border-emerald-400"></div>
                      </div>
                      <div className="flex justify-between">
                        <div className="w-5 h-5 border-b-2 border-l-2 border-emerald-400"></div>
                        <div className="w-5 h-5 border-b-2 border-r-2 border-emerald-400"></div>
                      </div>
                    </div>

                    <div className="relative z-20 flex flex-col items-center bg-slate-900/90 dark:bg-slate-950/90 border border-emerald-500/40 px-6 py-5 rounded-2xl shadow-2xl backdrop-blur-md">
                      <div className="relative w-40 h-1.5 bg-emerald-950 rounded-full overflow-hidden mb-3">
                        <div className="absolute inset-y-0 w-20 bg-emerald-400 rounded-full animate-[pulse_1s_infinite]"></div>
                      </div>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <Sparkles className="w-5 h-5 text-emerald-400 animate-spin" />
                        <span className="font-bold text-base tracking-tight text-emerald-100">Scanare optică AI în curs...</span>
                      </div>
                      <span className="text-xs text-slate-300 text-center max-w-xs">
                        Identificăm magazinul, produsele, prețurile și reducerile de pe bon
                      </span>
                    </div>

                    <style>{`
                      @keyframes scanBeam {
                        0%, 100% { top: 8%; opacity: 0.8; }
                        50% { top: 92%; opacity: 1; }
                      }
                    `}</style>
                  </div>
                )}
              </div>

              {scanError && (
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{scanError}</span>
                </div>
              )}

              {imageQuality && (
                <div className={`flex gap-3 rounded-xl border p-3.5 text-xs ${imageQuality.status === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100' : imageQuality.status === 'blocked' ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100' : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'}`} role="status" aria-live="polite">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-bold">{imageQuality.status === 'ok' ? 'Calitate bună pentru OCR' : imageQuality.status === 'blocked' ? 'Imaginea trebuie refăcută' : 'Recomandare: refă fotografia'}</p>
                    <p className="mt-1 opacity-80">Claritate {imageQuality.blurScore}% · contrast {imageQuality.contrastScore}% · luminozitate {imageQuality.meanBrightness}/255</p>
                    {imageQuality.warnings.map(warning => <p key={warning} className="mt-1">{warning}</p>)}
                  </div>
                </div>
              )}

              {/* Scan Trigger Button */}
              <div className="flex justify-end gap-3">
                <button
                  disabled={isScanning || imageQuality?.status === 'blocked'}
                  onClick={handleProcessScan}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                >
                  <Sparkles className="w-4 h-4 fill-white" />
                  <span>{isScanning ? 'Se analizează...' : 'Analizează bonul fiscal'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isCameraOpen && (
        <CameraCapture onCapture={handleCameraCapture} onCancel={() => setIsCameraOpen(false)} />
      )}

      {/* Editable Confirmation Review Screen */}
      {parsedReceipt && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-7 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 gap-3">
            <div>
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block mb-1">
                Pasul 2: Verificare & Corectare date
              </span>
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">
                Confirmă produsele extrase
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Poți modifica denumirea, cantitatea sau prețul fiecărui produs înainte de a salva definitiv bonul.
              </p>
            </div>

            <button
              onClick={() => {
                setParsedReceipt(null);
                setImageSrc(null);
              }}
              className="self-start sm:self-auto text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline font-medium"
            >
              Scanează alt bon
            </button>
          </div>

          {/* Store & Date Header Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-sm">
            <div>
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Magazin</label>
              <select
                value={parsedReceipt.storeId}
                onChange={e => {
                  const s = STORES.find(st => st.id === e.target.value);
                  setParsedReceipt({
                    ...parsedReceipt,
                    storeId: e.target.value,
                    storeName: s ? s.name : parsedReceipt.storeName
                  });
                }}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                {STORES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Data emiterii</label>
              <input
                type="date"
                value={parsedReceipt.date}
                onChange={e => setParsedReceipt({ ...parsedReceipt, date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Nr. Bon / CIF</label>
              <input
                type="text"
                value={parsedReceipt.fiscalNumber || ''}
                onChange={e => setParsedReceipt({ ...parsedReceipt, fiscalNumber: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {parsedReceipt.validationStatus === 'NEEDS_REVIEW' && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/70 text-amber-900 dark:text-amber-100 text-xs" role="status" aria-live="polite">
              <p className="font-bold">Bonul necesită verificare manuală</p>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {(parsedReceipt.validationReasons || []).map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
              </ul>
              <p className="mt-2">SGR: {PriceComparisonService.formatRon(parsedReceipt.sgrTotal || 0)} · TVA calculat: {PriceComparisonService.formatRon(parsedReceipt.vatTotal || 0)}</p>
            </div>
          )}

          {/* Discrepancy Warning if Items Sum != Receipt Total */}
          {hasDiscrepancy && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/70 text-amber-900 dark:text-amber-100 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Atenție: verifică totalul bonului!</span>
                <p className="mt-0.5 text-amber-800 dark:text-amber-200">
                  Suma liniilor din tabel este de <span className="font-bold">{PriceComparisonService.formatRon(itemsSum)}</span>, în timp ce totalul declarat pe bon este de <span className="font-bold">{PriceComparisonService.formatRon(parsedReceipt.total)}</span> (diferență: {PriceComparisonService.formatRon(discrepancy)}). Verifică dacă există reduceri globale sau produse lipsă.
                </p>
              </div>
            </div>
          )}

          {/* Editable Items Table */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-x-auto shadow-2xs">
            <table className="w-full text-left text-sm border-collapse min-w-[650px]">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="p-3 pl-4">Denumire produs de pe bon</th>
                  <th className="p-3 text-center w-24">Cantitate</th>
                  <th className="p-3 text-right w-28">Preț unitar</th>
                  <th className="p-3 text-right w-28">Total linie</th>
                  <th className="p-3 text-right w-24">Reducere</th>
                  <th className="p-3 text-center w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {parsedReceipt.items.map((item, idx) => (
                  <tr key={item.id} className={`${item.requiresManualReview ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''} hover:bg-slate-50/50 dark:hover:bg-slate-800/40`}>
                    <td className="p-2.5 pl-4">
                      <input
                        type="text"
                        value={item.rawName}
                        onChange={e => handleUpdateItem(idx, 'rawName', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 focus:border-emerald-500 focus:outline-none text-sm font-semibold text-slate-800 dark:text-slate-100"
                      />
                      {item.requiresManualReview && (
                        <p className="mt-1 text-[11px] font-medium text-amber-800 dark:text-amber-300" role="status">
                          Verificare manuală: {(item.manualReviewReasons || []).join(' ')}
                        </p>
                      )}
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={item.quantity}
                        onChange={e => handleUpdateItem(idx, 'quantity', parseFloat(e.target.value) || 1)}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-center text-sm font-semibold text-slate-900 dark:text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.unitPrice}
                        onChange={e => handleUpdateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-right text-sm font-semibold text-slate-900 dark:text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-2.5 text-right font-bold text-slate-900 dark:text-slate-100">
                      {PriceComparisonService.formatRon(item.totalPrice)}
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={item.discount}
                        onChange={e => handleUpdateItem(idx, 'discount', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-right text-xs font-semibold text-emerald-700 dark:text-emerald-400 focus:border-emerald-500 focus:outline-none"
                      />
                    </td>
                    <td className="p-2.5 text-center">
                      <button
                        onClick={() => handleDeleteItem(idx)}
                        className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-md"
                        title="Șterge linia"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={handleAddLineItem}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:text-emerald-800 dark:hover:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-200/70 dark:border-emerald-800/70 px-3 py-1.5 rounded-xl transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Adaugă o linie suplimentară
            </button>

            {/* Receipt Summary Calculation Box */}
            <div className="text-right space-y-1">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Subtotal produse: <span className="font-semibold text-slate-800 dark:text-slate-200">{PriceComparisonService.formatRon(parsedReceipt.subtotal)}</span>
              </div>
              {parsedReceipt.discountTotal > 0 && (
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                  Total reduceri: -{PriceComparisonService.formatRon(parsedReceipt.discountTotal)}
                </div>
              )}
              <div className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-50 pt-1 border-t border-slate-200 dark:border-slate-700">
                Total bon:{' '}
                <input
                  type="number"
                  step="0.01"
                  value={parsedReceipt.total}
                  onChange={e => setParsedReceipt({ ...parsedReceipt, total: parseFloat(e.target.value) || 0 })}
                  className="w-28 text-right font-black bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-2 py-0.5 rounded-lg border border-slate-300 dark:border-slate-700 ml-1 focus:border-emerald-500 focus:outline-none"
                />{' '}
                lei
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              onClick={() => setParsedReceipt(null)}
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Anulează
            </button>
            <button
              onClick={handleConfirmAndSave}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all disabled:cursor-wait disabled:opacity-60"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>{isSaving ? 'Se salvează…' : 'Confirmă și Salvează în Istoric'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
