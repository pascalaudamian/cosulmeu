import React, { useState, useRef } from 'react';
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
import { Receipt, ReceiptItem, ProductCategory } from '../types';
import { STORES } from '../data/mockData';
import { StorageService } from '../services/StorageService';
import { PriceComparisonService } from '../services/PriceComparisonService';

interface ReceiptScanViewProps {
  onReceiptSaved: (receipt: Receipt) => void;
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

  // Editable parsed receipt state
  const [parsedReceipt, setParsedReceipt] = useState<Receipt | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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
      setParsedReceipt(null);
      setScanError(null);
      setSaveSuccess(false);
    };
    reader.readAsDataURL(file);
  };

  // Load a demo sample receipt for instant testing
  const handleLoadSample = (sampleType: 'kaufland' | 'lidl') => {
    // Generate a clean dummy receipt canvas image
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 400, 600);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(sampleType === 'kaufland' ? 'KAUFLAND ROMANIA' : 'LIDL DISCOUNT', 200, 50);
      ctx.font = '12px monospace';
      ctx.fillText('BON FISCAL', 200, 75);
      ctx.fillText('DATA: 2026-10-26  ORA: 15:30', 200, 95);
      ctx.textAlign = 'left';
      ctx.fillText('-----------------------------------', 20, 120);
      ctx.fillText('LAPTE 1.5% 1L           2 x 6.49', 20, 150);
      ctx.fillText('OUA M 10 BUC            1 x 10.49', 20, 180);
      ctx.fillText('PAINE TOAST 500G        1 x 4.69', 20, 210);
      ctx.fillText('BANANE CAL I 1.45KG     1 x 5.99', 20, 240);
      ctx.fillText('-----------------------------------', 20, 280);
      ctx.font = 'bold 16px monospace';
      ctx.fillText('TOTAL LEI                 36.85', 20, 310);
    }
    const sampleDataUrl = canvas.toDataURL('image/jpeg');
    setImageSrc(sampleDataUrl);
    setParsedReceipt(null);
    setScanError(null);
    setSaveSuccess(false);
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
        vatRate: it.vatRate || 9,
        category: (it.category as ProductCategory) || 'Alte produse',
        confidence: 'high'
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
        subtotal: rec.subtotal || mappedItems.reduce((s, i) => s + i.totalPrice, 0),
        discountTotal: rec.discountTotal || 0,
        total: rec.total || mappedItems.reduce((s, i) => s + i.totalPrice - i.discount, 0),
        currency: 'RON',
        imageUrl: imageSrc,
        createdAt: new Date().toISOString(),
        verifiedStatus: 'confirmed'
      };

      setParsedReceipt(finalReceipt);
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

    setParsedReceipt({
      ...parsedReceipt,
      items: updatedItems,
      subtotal: newSubtotal,
      total: newTotal
    });
  };

  // Delete line item
  const handleDeleteItem = (index: number) => {
    if (!parsedReceipt) return;
    const updatedItems = parsedReceipt.items.filter((_, idx) => idx !== index);
    const newSubtotal = Math.round(updatedItems.reduce((s, i) => s + i.totalPrice, 0) * 100) / 100;
    const newTotal = Math.max(0, Math.round((newSubtotal - parsedReceipt.discountTotal) * 100) / 100);

    setParsedReceipt({
      ...parsedReceipt,
      items: updatedItems,
      subtotal: newSubtotal,
      total: newTotal
    });
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

    setParsedReceipt({
      ...parsedReceipt,
      items: updatedItems,
      subtotal: newSubtotal,
      total: newTotal
    });
  };

  // Confirm & Save Receipt
  const handleConfirmAndSave = () => {
    if (!parsedReceipt) return;
    StorageService.addReceipt(parsedReceipt);

    // Înregistrează produsele de pe bon ca și candidați pentru motorul de căutare și indexare pe retaileri
    const discoveryCandidates = parsedReceipt.items.map((it, idx) => ({
      id: `rec-prod-${parsedReceipt.id}-${idx}`,
      receiptId: parsedReceipt.id,
      rawName: it.rawName,
      extractedPrice: it.unitPrice,
      extractedQuantity: it.quantity,
      category: it.category,
      targetSearchStatus: 'pending' as const,
      matchedProductId: it.matchedProductId,
      searchAttempts: 0,
      createdAt: new Date().toISOString()
    }));
    StorageService.addReceiptProducts(discoveryCandidates);

    onReceiptSaved(parsedReceipt);
    setSaveSuccess(true);
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
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Scanare Bon Fiscal 🧾
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Încarcă bonul de cumpărături pentru a extrage automat produsele și a îmbunătăți istoricul personal de prețuri.
          </p>
        </div>
        <button
          onClick={onNavigateToHistory}
          className="self-start sm:self-auto px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5"
        >
          <ReceiptIcon className="w-4 h-4 text-emerald-600" />
          Istoric bonuri salvate
        </button>
      </div>

      {/* Success Notification */}
      {saveSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-bold text-sm block">Bonul a fost salvat cu succes!</span>
              <span className="text-xs text-emerald-700">
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
        <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-8 shadow-xs">
          {!imageSrc ? (
            <div className="space-y-6">
              {/* Drop / Capture Zone */}
              <div className="border-2 border-dashed border-slate-200 hover:border-emerald-500 rounded-3xl p-8 sm:p-12 text-center transition-colors bg-slate-50/50">
                <div className="w-16 h-16 rounded-3xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center mx-auto mb-4">
                  <Camera className="w-8 h-8" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900">
                  Fotografiază sau încarcă bonul fiscal
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-md mx-auto">
                  Acceptăm imagini JPG, PNG, WEBP. Asigură-te că magazinul, produsele și totalul sunt vizibile și luminate.
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <input
                    type="file"
                    ref={cameraInputRef}
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    onClick={() => cameraInputRef.current?.click()}
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
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm shadow-xs flex items-center gap-2 transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Alege fișier din telefon/PC</span>
                  </button>
                </div>
              </div>

              {/* Instant Demo Samples Selector */}
              <div className="pt-4 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                  Sau testează instant cu un bon demonstrativ:
                </span>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    onClick={() => handleLoadSample('kaufland')}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 hover:border-red-400 bg-slate-50 hover:bg-red-50/30 text-xs font-semibold text-slate-800 flex items-center gap-2 transition-colors"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>
                    Bon Kaufland (36,85 lei)
                  </button>
                  <button
                    onClick={() => handleLoadSample('lidl')}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 hover:border-blue-400 bg-slate-50 hover:bg-blue-50/30 text-xs font-semibold text-slate-800 flex items-center gap-2 transition-colors"
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span>
                    Bon Lidl (61,29 lei)
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Image Preview & Scan Action */
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">Previzualizare bon</span>
                  <span className="text-xs text-slate-500">Verifică orientarea imaginii</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRotate}
                    className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Rotește imaginea cu 90 de grade"
                  >
                    <RotateCw className="w-4 h-4" />
                    <span className="hidden sm:inline">Rotește</span>
                  </button>
                  <button
                    onClick={() => setImageSrc(null)}
                    className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-semibold transition-colors"
                  >
                    Schimbă imaginea
                  </button>
                </div>
              </div>

              {/* Image Display */}
              <div className="relative bg-slate-900 rounded-2xl overflow-hidden flex items-center justify-center min-h-[300px] max-h-[480px]">
                <img
                  src={imageSrc}
                  alt="Bon fiscal"
                  style={{ transform: `rotate(${rotation}deg)` }}
                  className="max-h-[450px] object-contain transition-transform duration-300"
                />

                {/* Scanning Animation Overlay */}
                {isScanning && (
                  <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex flex-col items-center justify-center text-white p-4">
                    <div className="relative w-48 h-1 bg-emerald-500/30 rounded-full overflow-hidden mb-4">
                      <div className="w-24 h-full bg-emerald-400 rounded-full animate-[pulse_1s_infinite]"></div>
                    </div>
                    <Sparkles className="w-8 h-8 text-emerald-400 animate-spin mb-2" />
                    <span className="font-bold text-base">Extragem datele cu AI...</span>
                    <span className="text-xs text-slate-300 mt-1">
                      Identificăm magazinul, produsele, cantitățile și reducerile
                    </span>
                  </div>
                )}
              </div>

              {scanError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{scanError}</span>
                </div>
              )}

              {/* Scan Trigger Button */}
              <div className="flex justify-end gap-3">
                <button
                  disabled={isScanning}
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

      {/* Editable Confirmation Review Screen */}
      {parsedReceipt && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-7 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div>
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block mb-1">
                Pasul 2: Verificare & Corectare date
              </span>
              <h2 className="text-xl font-extrabold text-slate-900">
                Confirmă produsele extrase
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Poți modifica denumirea, cantitatea sau prețul fiecărui produs înainte de a salva definitiv bonul.
              </p>
            </div>

            <button
              onClick={() => {
                setParsedReceipt(null);
                setImageSrc(null);
              }}
              className="self-start sm:self-auto text-xs text-slate-500 hover:text-slate-800 underline font-medium"
            >
              Scanează alt bon
            </button>
          </div>

          {/* Store & Date Header Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl bg-slate-50/80 border border-slate-200/80 text-sm">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Magazin</label>
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
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-semibold text-slate-900"
              >
                {STORES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Data emiterii</label>
              <input
                type="date"
                value={parsedReceipt.date}
                onChange={e => setParsedReceipt({ ...parsedReceipt, date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-semibold text-slate-900"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Nr. Bon / CIF</label>
              <input
                type="text"
                value={parsedReceipt.fiscalNumber || ''}
                onChange={e => setParsedReceipt({ ...parsedReceipt, fiscalNumber: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 font-semibold text-slate-900"
              />
            </div>
          </div>

          {/* Discrepancy Warning if Items Sum != Receipt Total */}
          {hasDiscrepancy && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Atenție: verifică totalul bonului!</span>
                <p className="mt-0.5 text-amber-800">
                  Suma liniilor din tabel este de <span className="font-bold">{PriceComparisonService.formatRon(itemsSum)}</span>, în timp ce totalul declarat pe bon este de <span className="font-bold">{PriceComparisonService.formatRon(parsedReceipt.total)}</span> (diferență: {PriceComparisonService.formatRon(discrepancy)}). Verifică dacă există reduceri globale sau produse lipsă.
                </p>
              </div>
            </div>
          )}

          {/* Editable Items Table */}
          <div className="border border-slate-200 rounded-2xl overflow-x-auto shadow-2xs">
            <table className="w-full text-left text-sm border-collapse min-w-[650px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="p-3 pl-4">Denumire produs de pe bon</th>
                  <th className="p-3 text-center w-24">Cantitate</th>
                  <th className="p-3 text-right w-28">Preț unitar</th>
                  <th className="p-3 text-right w-28">Total linie</th>
                  <th className="p-3 text-right w-24">Reducere</th>
                  <th className="p-3 text-center w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsedReceipt.items.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-slate-50/50">
                    <td className="p-2.5 pl-4">
                      <input
                        type="text"
                        value={item.rawName}
                        onChange={e => handleUpdateItem(idx, 'rawName', e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 focus:border-emerald-500 text-sm font-semibold text-slate-800"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={item.quantity}
                        onChange={e => handleUpdateItem(idx, 'quantity', parseFloat(e.target.value) || 1)}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-center text-sm font-semibold"
                      />
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.unitPrice}
                        onChange={e => handleUpdateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-right text-sm font-semibold"
                      />
                    </td>
                    <td className="p-2.5 text-right font-bold text-slate-900">
                      {PriceComparisonService.formatRon(item.totalPrice)}
                    </td>
                    <td className="p-2.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={item.discount}
                        onChange={e => handleUpdateItem(idx, 'discount', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-right text-xs font-semibold text-emerald-700"
                      />
                    </td>
                    <td className="p-2.5 text-center">
                      <button
                        onClick={() => handleDeleteItem(idx)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded-md"
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

          <div className="flex items-center justify-between">
            <button
              onClick={handleAddLineItem}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/70 px-3 py-1.5 rounded-xl transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Adaugă o linie suplimentară
            </button>

            {/* Receipt Summary Calculation Box */}
            <div className="text-right space-y-1">
              <div className="text-xs text-slate-500">
                Subtotal produse: <span className="font-semibold text-slate-800">{PriceComparisonService.formatRon(parsedReceipt.subtotal)}</span>
              </div>
              {parsedReceipt.discountTotal > 0 && (
                <div className="text-xs text-emerald-600 font-semibold">
                  Total reduceri: -{PriceComparisonService.formatRon(parsedReceipt.discountTotal)}
                </div>
              )}
              <div className="text-base sm:text-lg font-black text-slate-900 pt-1 border-t border-slate-200">
                Total bon:{' '}
                <input
                  type="number"
                  step="0.01"
                  value={parsedReceipt.total}
                  onChange={e => setParsedReceipt({ ...parsedReceipt, total: parseFloat(e.target.value) || 0 })}
                  className="w-28 text-right font-black text-slate-900 px-2 py-0.5 rounded-lg border border-slate-300 ml-1"
                />{' '}
                lei
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              onClick={() => setParsedReceipt(null)}
              className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-semibold transition-colors"
            >
              Anulează
            </button>
            <button
              onClick={handleConfirmAndSave}
              className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>Confirmă și Salvează în Istoric</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
