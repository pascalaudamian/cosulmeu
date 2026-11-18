import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { GdprRequestRecord, GdprRequestStatus } from '../types.js';

interface AdminGdprRequestsTabProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const STATUS_LABELS: Record<GdprRequestStatus, string> = {
  noua: 'Nouă',
  in_verificare: 'În verificare',
  procesata: 'Procesată',
  respinsa_justificat: 'Respinsă justificat'
};

export const AdminGdprRequestsTab: React.FC<AdminGdprRequestsTabProps> = ({ fetchWithAuth }) => {
  const [requests, setRequests] = useState<GdprRequestRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<GdprRequestStatus>('procesata');
  const [draftResponse, setDraftResponse] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/admin/gdpr/requests');
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Nu s-au putut încărca solicitările GDPR.');
        setRequests([]);
        return;
      }
      setRequests(json.requests || []);
    } catch (err: any) {
      setError(err?.message || 'Eroare la citirea solicitărilor GDPR.');
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleSaveUpdate = async (reqId: string) => {
    setSavingId(reqId);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetchWithAuth(`/api/admin/gdpr/requests/${encodeURIComponent(reqId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: draftStatus,
          adminResponse: draftResponse.trim() || null
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Actualizarea solicitării a eșuat.');
      }
      setRequests(prev => prev.map(r => (r.id === reqId ? json.request : r)));
      setEditingId(null);
      setFeedback('Solicitarea GDPR a fost actualizată și înregistrată.');
    } catch (err: any) {
      setError(err?.message || 'Eroare la actualizarea solicitării.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>Administrare Solicitări GDPR</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Vizualizare și soluționare cereri GDPR depuse de utilizatori (necesită SUPABASE_SERVICE_ROLE_KEY configurat exclusiv pe server).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadRequests()}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Reîncarcă</span>
        </button>
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        {requests.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
            {loading ? 'Se încarcă solicitările GDPR…' : 'Nu există solicitări GDPR afișabile în acest moment.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="p-3 font-bold">Data</th>
                  <th className="p-3 font-bold">ID Utilizator</th>
                  <th className="p-3 font-bold">Tip</th>
                  <th className="p-3 font-bold">Status</th>
                  <th className="p-3 font-bold">Detalii / Răspuns</th>
                  <th className="p-3 font-bold">Acțiune</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {requests.map(req => {
                  const isEditing = editingId === req.id;
                  return (
                    <tr key={req.id} className="align-top">
                      <td className="p-3 font-mono text-[11px] whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {new Date(req.requestedAt).toLocaleString('ro-RO')}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {req.userId ? `${req.userId.slice(0, 8)}…` : '—'}
                      </td>
                      <td className="p-3 font-semibold text-slate-900 dark:text-slate-100">
                        {req.requestType}
                      </td>
                      <td className="p-3">
                        {isEditing ? (
                          <select
                            value={draftStatus}
                            onChange={e => setDraftStatus(e.target.value as GdprRequestStatus)}
                            className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                          >
                            {Object.entries(STATUS_LABELS).map(([k, lbl]) => (
                              <option key={k} value={k}>
                                {lbl}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-semibold">
                            {STATUS_LABELS[req.status] || req.status}
                          </span>
                        )}
                      </td>
                      <td className="p-3 space-y-1 max-w-sm">
                        {req.details && <div className="text-slate-700 dark:text-slate-300">{req.details}</div>}
                        {isEditing ? (
                          <textarea
                            rows={2}
                            placeholder="Răspuns operator pentru utilizator..."
                            value={draftResponse}
                            onChange={e => setDraftResponse(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
                          />
                        ) : (
                          req.adminResponse && (
                            <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                              Răspuns: {req.adminResponse}
                            </div>
                          )
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={savingId === req.id}
                              onClick={() => void handleSaveUpdate(req.id)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[11px] cursor-pointer"
                            >
                              {savingId === req.id ? '…' : 'Salvează'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] cursor-pointer"
                            >
                              Anulează
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(req.id);
                              setDraftStatus(req.status);
                              setDraftResponse(req.adminResponse || '');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-[11px] cursor-pointer"
                          >
                            Gestionează
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
