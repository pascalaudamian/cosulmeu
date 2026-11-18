import React, { useEffect, useState } from 'react';
import { Check, Cookie, Info, Lock, ShieldCheck, X } from 'lucide-react';
import {
  COOKIE_BANNER_VERSION,
  COOKIE_CATEGORIES_CONFIG,
  COOKIE_POLICY_VERSION,
  DETECTED_COOKIES_AND_STORAGE,
  type LegalRoutePath
} from '../config/legalConfig.js';
import type { CookieConsentCategoriesState } from '../types.js';

interface CookiePreferencesModalProps {
  open: boolean;
  initialCategories: CookieConsentCategoriesState;
  lastUpdatedAt?: string | null;
  onClose: () => void;
  onSavePreferences: (categories: CookieConsentCategoriesState) => void;
  onAcceptAll: () => void;
  onRejectOptional: () => void;
  onWithdrawOptional: () => void;
  onNavigateLegal: (path: LegalRoutePath) => void;
}

export const CookiePreferencesModal: React.FC<CookiePreferencesModalProps> = ({
  open,
  initialCategories,
  lastUpdatedAt,
  onClose,
  onSavePreferences,
  onAcceptAll,
  onRejectOptional,
  onWithdrawOptional,
  onNavigateLegal
}) => {
  const [draft, setDraft] = useState<CookieConsentCategoriesState>(initialCategories);
  const [showInventory, setShowInventory] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft({
        necessary: true,
        preferences: Boolean(initialCategories.preferences),
        analytics: Boolean(initialCategories.analytics),
        marketing: Boolean(initialCategories.marketing)
      });
    }
  }, [open, initialCategories]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const hasAnyOptionalEnabled = draft.preferences || draft.analytics || draft.marketing;

  const handleToggle = (key: 'preferences' | 'analytics' | 'marketing') => {
    setDraft(prev => ({
      ...prev,
      necessary: true,
      [key]: !prev[key]
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-modal-title"
        data-testid="cookie-preferences-modal"
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200/90 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <Cookie className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="cookie-modal-title"
                className="font-display text-lg font-bold text-slate-900 dark:text-slate-100"
              >
                Setări cookie-uri și stocare locală
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Versiune politică: <span className="font-mono">{COOKIE_POLICY_VERSION}</span> · Banner:{' '}
                <span className="font-mono">{COOKIE_BANNER_VERSION}</span>
                {lastUpdatedAt ? ` · Actualizat: ${new Date(lastUpdatedAt).toLocaleString('ro-RO')}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide fereastra de setări cookie-uri"
            className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Poți alege ce categorii opționale sunt permise. Cookie-urile opționale sunt dezactivate implicit și nu sunt încărcate fără acordul tău. Poți modifica sau retrage consimțământul oricând din linkul permanent <strong>„Setări cookie-uri”</strong> din subsolul paginii.
          </p>

          {/* Categories */}
          <div className="space-y-3">
            {COOKIE_CATEGORIES_CONFIG.map(category => {
              const isLocked = category.required;
              const isChecked = isLocked ? true : Boolean(draft[category.id]);

              return (
                <div
                  key={category.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {category.name}
                        </h3>
                        {isLocked && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold">
                            <Lock className="w-3 h-3" />
                            Mereu active
                          </span>
                        )}
                        {!category.installedInApp && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium">
                            0 scripturi instalate în prezent
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {category.description}
                      </p>
                    </div>

                    {isLocked ? (
                      <div
                        aria-label="Strict necesare — mereu active"
                        className="w-11 h-6 rounded-full bg-emerald-600/80 flex items-center justify-end p-1 shrink-0 opacity-85"
                      >
                        <span className="w-4 h-4 rounded-full bg-white shadow-xs" />
                      </div>
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isChecked}
                        aria-label={`Comută categoria ${category.name}`}
                        onClick={() => handleToggle(category.id as 'preferences' | 'analytics' | 'marketing')}
                        className={`w-11 h-6 rounded-full flex items-center p-1 transition-colors shrink-0 cursor-pointer ${
                          isChecked
                            ? 'bg-emerald-600 justify-end'
                            : 'bg-slate-300 dark:bg-slate-700 justify-start'
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-white shadow-xs" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/70 text-[11px] text-slate-600 dark:text-slate-400">
                    <div>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Scop: </span>
                      {category.purpose}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Durată: </span>
                      {category.retention}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Furnizor: </span>
                      {category.provider}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Real Detected Cookies / Storage Toggle */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowInventory(v => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Inventar tehnic real (cookie-uri și stocare locală detectate)</span>
              </span>
              <span>{showInventory ? 'Ascunde' : 'Arată detaliile'}</span>
            </button>
            {showInventory && (
              <div className="p-3 overflow-x-auto bg-white dark:bg-slate-900">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-1.5 pr-3 font-semibold">Nume</th>
                      <th className="py-1.5 pr-3 font-semibold">Tip</th>
                      <th className="py-1.5 pr-3 font-semibold">Categorie</th>
                      <th className="py-1.5 font-semibold">Durată</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                    {DETECTED_COOKIES_AND_STORAGE.map(entry => (
                      <tr key={entry.name}>
                        <td className="py-1.5 pr-3 font-mono break-all">{entry.name}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{entry.mechanism}</td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{entry.category}</td>
                        <td className="py-1.5">{entry.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Notă privind cookie-urile terțe: retragerea consimțământului oprește imediat încărcarea viitoare a scripturilor opționale și șterge cookie-urile opționale controlate de Coșul Meu; dacă un domeniu terț ar fi setat vreodată un cookie extern propriu, acesta se șterge din setările browserului. Detalii în{' '}
              <a
                href="/politica-cookies"
                onClick={e => {
                  e.preventDefault();
                  onClose();
                  onNavigateLegal('/politica-cookies');
                }}
                className="underline font-semibold text-emerald-700 dark:text-emerald-400"
              >
                Politica cookies
              </a>
              .
            </span>
          </p>
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-4 border-t border-slate-200/90 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRejectOptional}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold transition-colors cursor-pointer"
            >
              Respinge opționalele
            </button>
            {hasAnyOptionalEnabled && (
              <button
                type="button"
                onClick={onWithdrawOptional}
                className="px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/70 text-rose-700 dark:text-rose-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Retrage consimțământul
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onAcceptAll}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-bold transition-colors cursor-pointer"
            >
              Acceptă toate
            </button>
            <button
              type="button"
              onClick={() => onSavePreferences(draft)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Salvează preferințele</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
