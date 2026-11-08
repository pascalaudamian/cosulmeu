import React from 'react';
import {
  Play,
  AlertTriangle,
  CheckCircle2,
  X,
  Server,
  Layers,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';

interface AdminImportConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isRunning: boolean;
  title: string;
  targetDescription: string;
  retailers: { id: string; name: string; format: string; status?: string; defaultStatus?: string }[];
}

export const AdminImportConfirmModal: React.FC<AdminImportConfirmModalProps> = ({
  open,
  onClose,
  onConfirm,
  isRunning,
  title,
  targetDescription,
  retailers
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
              <Play className="w-5 h-5 ml-0.5" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                {title || 'Confirmare Rulare Import'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Procesare incrementală protejată cu Advisory Lock împotriva execuțiilor concurente.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isRunning}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-600 leading-relaxed">
          {targetDescription || 'Sistemul va iniția descărcarea cataloagelor oficiale, va parsa prețurile și reducerile, și va sincroniza datele în Staging Queue.'}
        </p>

        {/* Retailers List */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-slate-700 block">
            Retaileri și surse ce vor fi procesate ({retailers.length}):
          </span>
          <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 max-h-48 overflow-y-auto text-xs">
            {retailers.map(r => (
              <div key={r.id} className="p-2.5 flex items-center justify-between gap-3 hover:bg-slate-50">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800">{r.name}</span>
                  <span className="text-[10px] text-slate-400">({r.format})</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    (r.status || r.defaultStatus) === 'BLOCKED'
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {r.status || r.defaultStatus || 'ACTIVE'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Safety Note */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-2.5 text-xs text-slate-600">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>
            Idempotență garantată: produsele și prețurile existente neschimbate nu vor fi duplicate. În cazul unei erori, tranzacția este izolată.
          </span>
        </div>

        {/* Actions */}
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button
            onClick={onClose}
            disabled={isRunning}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-xs cursor-pointer transition-colors"
          >
            Anulează
          </button>
          <button
            onClick={onConfirm}
            disabled={isRunning}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm hover:shadow transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Se rulează importul...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Confirmă și Rulează</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
