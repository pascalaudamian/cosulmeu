import React, { useState } from 'react';
import {
  Receipt as ReceiptIcon,
  Search,
  Calendar,
  Clock,
  Trash2,
  X,
  Printer,
  Tag,
  ArrowRight,
  ShieldCheck,
  ShoppingBag
} from 'lucide-react';
import { Receipt } from '../types';
import { StorageService } from '../services/StorageService';
import { PriceComparisonService } from '../services/PriceComparisonService';
import { STORES } from '../data/mockData';

interface ReceiptHistoryViewProps {
  receipts: Receipt[];
  onUpdateReceipts: (receipts: Receipt[]) => void;
  onNavigateToScan: () => void;
}

export const ReceiptHistoryView: React.FC<ReceiptHistoryViewProps> = ({
  receipts,
  onUpdateReceipts,
  onNavigateToScan
}) => {
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredReceipts = receipts.filter(r => {
    const matchesStore = storeFilter === 'all' || r.storeId === storeFilter;
    const matchesQuery =
      !searchQuery.trim() ||
      r.storeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.items.some(i => i.rawName.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStore && matchesQuery;
  });

  const handleDeleteReceipt = (receiptId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Sigur vrei să ștergi acest bon fiscal din istoric?')) {
      StorageService.deleteReceipt(receiptId);
      const updated = receipts.filter(r => r.id !== receiptId);
      onUpdateReceipts(updated);
      if (selectedReceipt?.id === receiptId) {
        setSelectedReceipt(null);
      }
    }
  };

  const totalSpent = receipts.reduce((acc, r) => acc + r.total, 0);
  const totalSaved = receipts.reduce((acc, r) => acc + (r.discountTotal || 0), 0);

  return (
    <div className="space-y-6 pb-16">
      {/* Header & Stats Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Istoric Bonuri Fiscale 🧾
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Toate bonurile tale confirmate și arhivate pentru analiza cheltuielilor.
          </p>
        </div>

        <button
          onClick={onNavigateToScan}
          className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all"
        >
          <ReceiptIcon className="w-4 h-4" />
          Scanează un bon nou
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 font-medium block">Total cheltuit pe bonuri</span>
          <span className="text-xl sm:text-2xl font-black text-slate-900 mt-1 block">
            {PriceComparisonService.formatRon(totalSpent)}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">{receipts.length} bonuri înregistrate</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 font-medium block">Total reduceri obținute</span>
          <span className="text-xl sm:text-2xl font-black text-emerald-600 mt-1 block">
            {PriceComparisonService.formatRon(totalSaved)}
          </span>
          <span className="text-[11px] text-emerald-700/80 mt-0.5 block">captate direct din bonuri</span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs text-slate-500 font-medium block">Articole observate</span>
          <span className="text-xl sm:text-2xl font-black text-slate-900 mt-1 block">
            {receipts.reduce((s, r) => s + r.items.length, 0)}
          </span>
          <span className="text-[11px] text-slate-400 mt-0.5 block">produse cu istoric de preț actualizat</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Caută magazin sau produs..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-emerald-500"
          />
        </div>

        {/* Store pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto no-scrollbar">
          <button
            onClick={() => setStoreFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
              storeFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Toate ({receipts.length})
          </button>
          {STORES.map(st => {
            const count = receipts.filter(r => r.storeId === st.id).length;
            if (count === 0) return null;
            return (
              <button
                key={st.id}
                onClick={() => setStoreFilter(st.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                  storeFilter === st.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {st.name} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Receipts List */}
      {filteredReceipts.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center">
          <ReceiptIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-800">Niciun bon găsit</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? 'Nu am găsit bonuri corespunzătoare termenului căutat.'
              : 'Nu ai bonuri salvate pentru filtrele selectate.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredReceipts.map(receipt => {
            const store = STORES.find(s => s.id === receipt.storeId);

            return (
              <div
                key={receipt.id}
                onClick={() => setSelectedReceipt(receipt)}
                className="bg-white rounded-2xl border border-slate-200 hover:border-emerald-400 p-4 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-7 h-7 rounded-lg text-white font-black text-xs flex items-center justify-center ${
                          store ? store.brandColor : 'bg-slate-700'
                        }`}
                      >
                        {receipt.storeName.charAt(0)}
                      </div>
                      <span className="font-bold text-sm text-slate-900">{receipt.storeName}</span>
                    </div>

                    <button
                      onClick={e => handleDeleteReceipt(receipt.id, e)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                      title="Șterge bonul"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-1 text-xs text-slate-500 mb-3">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{receipt.date}</span>
                      {receipt.time && <span>• {receipt.time}</span>}
                    </div>
                    {receipt.fiscalNumber && (
                      <div className="text-[11px] text-slate-400 font-mono">
                        {receipt.fiscalNumber}
                      </div>
                    )}
                  </div>

                  {/* Sample items snippet */}
                  <div className="space-y-1 my-2 bg-slate-50 p-2 rounded-xl text-xs text-slate-700">
                    {receipt.items.slice(0, 3).map(it => (
                      <div key={it.id} className="flex items-center justify-between truncate">
                        <span className="truncate">• {it.rawName}</span>
                        <span className="font-semibold ml-2 shrink-0">
                          {PriceComparisonService.formatRon(it.totalPrice)}
                        </span>
                      </div>
                    ))}
                    {receipt.items.length > 3 && (
                      <div className="text-[10px] text-slate-400 italic">
                        + încă {receipt.items.length - 3} produse...
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-medium">
                    {receipt.items.length} articole
                  </span>
                  <div className="text-right">
                    <span className="font-black text-base text-slate-900">
                      {PriceComparisonService.formatRon(receipt.total)}
                    </span>
                    {receipt.discountTotal > 0 && (
                      <span className="block text-[11px] font-bold text-emerald-600">
                        Reducere: -{PriceComparisonService.formatRon(receipt.discountTotal)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fiscal Receipt Paper Modal */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl my-8 overflow-hidden animate-in fade-in zoom-in-95">
            {/* Modal Actions Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <span className="text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 text-emerald-400">
                <ShieldCheck className="w-4 h-4" /> Bon fiscal înregistrat
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => window.print()}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300"
                  title="Tipărește"
                >
                  <Printer className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Receipt Paper Styling */}
            <div className="p-6 bg-slate-50/70 font-mono text-slate-800 text-xs">
              {/* Receipt Header */}
              <div className="text-center pb-4 border-b border-dashed border-slate-300">
                <h3 className="font-bold text-sm tracking-widest uppercase">
                  {selectedReceipt.storeName}
                </h3>
                {selectedReceipt.storeAddress && (
                  <p className="text-[11px] text-slate-500 mt-0.5">{selectedReceipt.storeAddress}</p>
                )}
                <p className="text-[11px] text-slate-500 font-bold mt-1">BON FISCAL</p>
                <div className="flex justify-between text-[11px] text-slate-600 mt-2">
                  <span>DATA: {selectedReceipt.date}</span>
                  <span>ORA: {selectedReceipt.time || '12:00'}</span>
                </div>
                {selectedReceipt.fiscalNumber && (
                  <div className="text-[11px] text-slate-500 text-left mt-0.5">
                    {selectedReceipt.fiscalNumber}
                  </div>
                )}
              </div>

              {/* Items Table */}
              <div className="py-4 border-b border-dashed border-slate-300 space-y-2 max-h-72 overflow-y-auto">
                {selectedReceipt.items.map(item => (
                  <div key={item.id} className="space-y-0.5">
                    <div className="flex justify-between font-bold text-slate-900">
                      <span className="truncate pr-2">{item.rawName}</span>
                      <span>{PriceComparisonService.formatRon(item.totalPrice)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>
                        {item.quantity} x {item.unitPrice.toFixed(2)} lei
                        {item.vatRate ? ` (TVA ${item.vatRate}%)` : ''}
                      </span>
                      {item.discount > 0 && (
                        <span className="text-emerald-700 font-bold">
                          disc: -{item.discount.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals Section */}
              <div className="pt-4 space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>SUBTOTAL:</span>
                  <span>{PriceComparisonService.formatRon(selectedReceipt.subtotal)}</span>
                </div>
                {selectedReceipt.discountTotal > 0 && (
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>TOTAL REDUCERI:</span>
                    <span>-{PriceComparisonService.formatRon(selectedReceipt.discountTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-base text-slate-900 pt-2 border-t border-slate-300">
                  <span>TOTAL LEI:</span>
                  <span>{PriceComparisonService.formatRon(selectedReceipt.total)}</span>
                </div>
              </div>

              {/* Barcode Simulation */}
              <div className="mt-6 pt-4 border-t border-dashed border-slate-300 text-center">
                <div className="h-8 bg-slate-900 flex items-center justify-around px-2 mb-1">
                  {Array.from({ length: 32 }).map((_, i) => (
                    <div
                      key={i}
                      className="bg-white h-full"
                      style={{ width: i % 3 === 0 ? '3px' : '1px' }}
                    ></div>
                  ))}
                </div>
                <span className="text-[10px] text-slate-400 tracking-widest font-mono">
                  {selectedReceipt.id}
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedReceipt(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
              >
                Închide
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
