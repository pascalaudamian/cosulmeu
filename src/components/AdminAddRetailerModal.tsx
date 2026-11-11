import React, { useState } from 'react';
import {
  X,
  Store as StoreIcon,
  Plus,
  Save,
  AlertTriangle,
  Globe,
  Tag,
  CheckCircle2,
  Layers,
  Palette
} from 'lucide-react';
import { CatalogSource } from '../indexing/catalog/catalogTypes.js';

interface AdminAddRetailerModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (retailer: any, initialSource?: CatalogSource) => void;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const COLOR_OPTIONS = [
  { id: 'blue', label: 'Albastru', bg: 'bg-blue-600', ring: 'ring-blue-400' },
  { id: 'red', label: 'Roșu', bg: 'bg-red-600', ring: 'ring-red-400' },
  { id: 'sky', label: 'Azur', bg: 'bg-sky-500', ring: 'ring-sky-400' },
  { id: 'amber', label: 'Chihlimbar', bg: 'bg-amber-500', ring: 'ring-amber-400' },
  { id: 'rose', label: 'Roz/Rubiniu', bg: 'bg-rose-600', ring: 'ring-rose-400' },
  { id: 'emerald', label: 'Smarald', bg: 'bg-emerald-600', ring: 'ring-emerald-400' },
  { id: 'purple', label: 'Violet', bg: 'bg-purple-600', ring: 'ring-purple-400' },
  { id: 'yellow', label: 'Galben', bg: 'bg-yellow-500', ring: 'ring-yellow-400' },
  { id: 'indigo', label: 'Indigo', bg: 'bg-indigo-600', ring: 'ring-indigo-400' },
  { id: 'slate', label: 'Grafit', bg: 'bg-slate-700', ring: 'ring-slate-400' }
];

export const AdminAddRetailerModal: React.FC<AdminAddRetailerModalProps> = ({
  open,
  onClose,
  onSaved,
  fetchWithAuth
}) => {
  const [name, setName] = useState<string>('');
  const [id, setId] = useState<string>('');
  const [isCustomId, setIsCustomId] = useState<boolean>(false);
  const [chain, setChain] = useState<string>('');
  const [format, setFormat] = useState<string>('HTML & PDF');
  const [storeType, setStoreType] = useState<'supermarket' | 'hypermarket' | 'discounter' | 'proximity'>('supermarket');
  const [defaultStatus, setDefaultStatus] = useState<'ACTIVE' | 'BLOCKED'>('ACTIVE');
  const [color, setColor] = useState<string>('emerald');

  // Initial source config
  const [hasInitialSource, setHasInitialSource] = useState<boolean>(true);
  const [sourceName, setSourceName] = useState<string>('');
  const [catalogUrl, setCatalogUrl] = useState<string>('');
  const [sourceFormat, setSourceFormat] = useState<string>('html');

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!open) return null;

  const handleNameChange = (val: string) => {
    setName(val);
    if (!isCustomId) {
      const generatedSlug = val
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      setId(generatedSlug);
      if (!sourceName || sourceName.startsWith('Catalog & Oferte')) {
        setSourceName(val ? `Catalog & Oferte ${val}` : '');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Numele retailerului este obligatoriu.');
      return;
    }
    if (!id.trim()) {
      setErrorMessage('Identificatorul unic (ID/slug) este obligatoriu.');
      return;
    }

    if (hasInitialSource && catalogUrl.trim()) {
      try {
        new URL(catalogUrl.trim());
      } catch {
        setErrorMessage('Adresa URL a catalogului inițial nu este validă.');
        return;
      }
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        id: id.trim().toLowerCase(),
        name: name.trim(),
        chain: chain.trim() || name.trim(),
        format,
        storeType,
        defaultStatus,
        color,
        catalogUrl: hasInitialSource ? catalogUrl.trim() : undefined,
        sourceName: hasInitialSource ? (sourceName.trim() || `Catalog ${name.trim()}`) : undefined
      };

      const res = await fetchWithAuth('/api/admin/retailers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Eroare la crearea retailerului.');
      }

      onSaved(data.retailer, data.source);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'A apărut o eroare la salvarea retailerului.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
              <StoreIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Definire Retailer Nou
              </h3>
              <p className="text-xs text-slate-500">
                Configurează un nou lanț de magazine pentru monitorizare și import de cataloage.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="flex-1 font-semibold leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {/* Name & ID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Nume Retailer *
              </label>
              <input
                type="text"
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="Ex: Selgros România"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                required
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1 flex items-center justify-between">
                <span>Identificator (Slug) *</span>
                <button
                  type="button"
                  onClick={() => setIsCustomId(!isCustomId)}
                  className="text-[10px] text-emerald-600 hover:underline font-semibold"
                >
                  {isCustomId ? 'Generare auto' : 'Modifică manual'}
                </button>
              </label>
              <input
                type="text"
                value={id}
                disabled={!isCustomId}
                onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="selgros"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white disabled:bg-slate-50 text-slate-800 font-mono text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                required
              />
            </div>
          </div>

          {/* Chain & Store Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Grup / Denumire Rețea
              </label>
              <input
                type="text"
                value={chain}
                onChange={e => setChain(e.target.value)}
                placeholder="Ex: Selgros Cash & Carry"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Tip Magazin
              </label>
              <select
                value={storeType}
                onChange={e => setStoreType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
              >
                <option value="supermarket">Supermarket</option>
                <option value="hypermarket">Hypermarket</option>
                <option value="discounter">Discounter</option>
                <option value="proximity">Proximitate / Magazin local</option>
              </select>
            </div>
          </div>

          {/* Format & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Format Principal Catalog
              </label>
              <select
                value={format}
                onChange={e => setFormat(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
              >
                <option value="HTML & PDF">HTML & PDF (Mixt)</option>
                <option value="HTML Store">HTML Store (Web e-commerce)</option>
                <option value="PDF Catalog">PDF Catalog (Broșură tipărită)</option>
                <option value="Publitas Spreads">Publitas Spreads (Viewer digital)</option>
                <option value="API Feed">API Feed / JSON</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Stare Inițială
              </label>
              <select
                value={defaultStatus}
                onChange={e => setDefaultStatus(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
              >
                <option value="ACTIVE">ACTIV & OPERAȚIONAL</option>
                <option value="BLOCKED">BLOCKED (Necesită verificare WAF)</option>
              </select>
            </div>
          </div>

          {/* Color Palette */}
          <div>
            <label className="block font-bold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-slate-500" />
              <span>Culoare Identitate Brand</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  title={c.label}
                  className={`w-7 h-7 rounded-xl ${c.bg} transition-all transform cursor-pointer flex items-center justify-center text-white ${
                    color === c.id ? `ring-2 ring-offset-2 ${c.ring} scale-110 shadow-sm` : 'opacity-80 hover:opacity-100 hover:scale-105'
                  }`}
                >
                  {color === c.id && <CheckCircle2 className="w-4 h-4" />}
                </button>
              ))}
            </div>
          </div>

          {/* Initial Source Section */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hasInitialSource}
                onChange={e => setHasInitialSource(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500"
              />
              <span className="font-bold text-slate-800 text-xs">
                Configurează imediat prima sursă oficială de catalog
              </span>
            </label>

            {hasInitialSource && (
              <div className="space-y-3 pt-2 border-t border-slate-200/60">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 text-[11px]">
                    Nume Sursă Catalog
                  </label>
                  <input
                    type="text"
                    value={sourceName}
                    onChange={e => setSourceName(e.target.value)}
                    placeholder={name ? `Catalog & Oferte ${name}` : 'Catalog Online'}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1 text-[11px]">
                      URL Pagină / Catalog Oficial
                    </label>
                    <div className="relative">
                      <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="url"
                        value={catalogUrl}
                        onChange={e => setCatalogUrl(e.target.value)}
                        placeholder="https://www.retailer.ro/cataloage"
                        className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 text-[11px]">
                      Format Sursă
                    </label>
                    <select
                      value={sourceFormat}
                      onChange={e => setSourceFormat(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    >
                      <option value="html">HTML</option>
                      <option value="pdf">PDF</option>
                      <option value="api">API</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
            >
              Anulează
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Se creează…' : 'Creează Retailer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
