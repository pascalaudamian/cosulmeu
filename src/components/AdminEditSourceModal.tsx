import React, { useState, useEffect } from 'react';
import {
  X,
  ExternalLink,
  Save,
  Trash2,
  AlertTriangle,
  Globe,
  FileCode,
  Clock,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { CatalogSource, CatalogSourceStatus } from '../indexing/catalog/catalogTypes.js';

interface AdminEditSourceModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (source: CatalogSource) => void;
  onDeleted?: (sourceId: string) => void;
  source: CatalogSource | null;
  retailerId: string;
  retailerName: string;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

export const AdminEditSourceModal: React.FC<AdminEditSourceModalProps> = ({
  open,
  onClose,
  onSaved,
  onDeleted,
  source,
  retailerId,
  retailerName,
  fetchWithAuth
}) => {
  const isEditing = Boolean(source);

  const [name, setName] = useState<string>('');
  const [catalogUrl, setCatalogUrl] = useState<string>('');
  const [format, setFormat] = useState<string>('html');
  const [status, setStatus] = useState<CatalogSourceStatus>('active');
  const [updateFrequencyDays, setUpdateFrequencyDays] = useState<number>(7);
  const [authRequired, setAuthRequired] = useState<boolean>(false);
  const [legalStatusNotice, setLegalStatusNotice] = useState<string>('');

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (source) {
      setName(source.name || '');
      setCatalogUrl(source.catalogUrl || '');
      setFormat(source.format || 'html');
      setStatus(source.status || 'active');
      setUpdateFrequencyDays(source.updateFrequencyDays || 7);
      setAuthRequired(Boolean(source.authRequired));
      setLegalStatusNotice(source.legalStatusNotice || '');
    } else {
      setName(`Catalog & Oferte ${retailerName}`);
      setCatalogUrl('');
      setFormat('html');
      setStatus('active');
      setUpdateFrequencyDays(7);
      setAuthRequired(false);
      setLegalStatusNotice(`Catalog oficial ${retailerName}; extragere publică transparentă.`);
    }
    setErrorMessage(null);
  }, [source, retailerName, open]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Numele sursei este obligatoriu.');
      return;
    }
    if (!catalogUrl.trim()) {
      setErrorMessage('Adresa URL a catalogului este obligatorie.');
      return;
    }

    try {
      new URL(catalogUrl.trim());
    } catch {
      setErrorMessage('Adresa URL introdusă nu este validă (trebuie să înceapă cu http:// sau https://).');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const payload = {
        id: source?.id,
        retailerId,
        retailerName,
        name: name.trim(),
        catalogUrl: catalogUrl.trim(),
        format,
        status,
        updateFrequencyDays: Number(updateFrequencyDays) || 7,
        authRequired,
        legalStatusNotice: legalStatusNotice.trim()
      };

      const res = await fetchWithAuth('/api/admin/catalog-importer/sources', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Eroare la salvarea sursei.');
      }

      onSaved(data.source);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'A apărut o eroare la salvarea sursei.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!source) return;
    if (!window.confirm(`Sigur doriți să ștergeți sursa "${source.name}"?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/catalog-importer/sources/${source.id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        if (onDeleted) onDeleted(source.id);
        onClose();
      } else {
        const data = await res.json();
        setErrorMessage(data.error || 'Eroare la ștergerea sursei.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Eroare la ștergerea sursei.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider">
                {retailerName} ({retailerId})
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {isEditing ? source?.id : 'Sursă nouă'}
              </span>
            </div>
            <h3 className="text-base font-extrabold text-slate-900 mt-1">
              {isEditing ? 'Editează Parametrii Sursei' : 'Adaugă Sursă Nouă de Catalog'}
            </h3>
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

          {/* Source Name */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Nume Sursă Catalog *
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Cataloage & Reviste Online Lidl"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
              required
            />
          </div>

          {/* Catalog URL */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-bold text-slate-700">
                URL Catalog / Pagină Sursă *
              </label>
              {catalogUrl && (
                <a
                  href={catalogUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-emerald-600 hover:underline flex items-center gap-1 font-semibold"
                >
                  <span>Testează link</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <div className="relative">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="url"
                value={catalogUrl}
                onChange={e => setCatalogUrl(e.target.value)}
                placeholder="https://www.retailer.ro/cataloage-online"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                required
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Este acceptat orice domeniu public HTTP/HTTPS; localhost și adresele private sunt blocate pentru protecția serverului.
            </p>
          </div>

          {/* Format & Status Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Format Document
              </label>
              <select
                value={format}
                onChange={e => setFormat(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
              >
                <option value="html">HTML (Pagină web magazin)</option>
                <option value="pdf">PDF (Catalog broșură digitală)</option>
                <option value="api">API / JSON (Feed autorizat)</option>
                <option value="csv">CSV (Tabel de prețuri)</option>
                <option value="xml">XML (Feed agregat)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Stare Operațională
              </label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as CatalogSourceStatus)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-semibold text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
              >
                <option value="active">Activ (Operațional în sincronizări)</option>
                <option value="disabled">Dezactivat (Omis de la rulare)</option>
                <option value="pending_authorization">În așteptare autorizare (WAF/API)</option>
                <option value="error">Eroare / Blocat</option>
              </select>
            </div>
          </div>

          {/* Frequency & Auth */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Frecvență Actualizare (zile)
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={updateFrequencyDays}
                  onChange={e => setUpdateFrequencyDays(parseInt(e.target.value, 10) || 7)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer hover:bg-slate-50 transition-colors">
                <input
                  type="checkbox"
                  checked={authRequired}
                  onChange={e => setAuthRequired(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500"
                />
                <span className="font-semibold text-slate-700 text-xs">
                  Necesită cheie API / token autorizat
                </span>
              </label>
            </div>
          </div>

          {/* Legal Notice */}
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              Notă Legalitate & Transparență
            </label>
            <textarea
              rows={2}
              value={legalStatusNotice}
              onChange={e => setLegalStatusNotice(e.target.value)}
              placeholder="Ex: Catalog online oficial săptămânal și campanii tematice; extragere publică transparentă."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none leading-relaxed"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
            {isEditing ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || isSaving}
                className="px-3 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeleting ? 'Se șterge…' : 'Șterge sursa'}</span>
              </button>
            ) : <div />}

            <div className="flex items-center gap-2">
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
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Se salvează…' : 'Salvează Modificările'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
