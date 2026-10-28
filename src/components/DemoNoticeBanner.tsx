import React, { useState } from 'react';
import { Info, X, ShieldAlert } from 'lucide-react';
import { StorageService } from '../services/StorageService';

export const DemoNoticeBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState<boolean>(() => StorageService.isDemoBannerDismissed());

  if (dismissed) return null;

  const handleDismiss = () => {
    StorageService.setDemoBannerDismissed(true);
    setDismissed(true);
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs sm:text-sm px-4 py-2.5 transition-all">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <span className="inline-flex items-center gap-1 font-semibold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded text-[11px] uppercase tracking-wider shrink-0">
            <ShieldAlert className="w-3.5 h-3.5" /> Date Demonstrative
          </span>
          <p className="text-amber-800 leading-tight">
            Prețurile afișate sunt orientative și provin din date demonstrative și bonuri colectate în teste. Aplicația oferă suport complet pentru scanarea bonurilor proprii și actualizarea istoricului personal.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 hover:bg-amber-200/60 rounded text-amber-700 hover:text-amber-900 transition-colors shrink-0"
          title="Închide notificarea"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
