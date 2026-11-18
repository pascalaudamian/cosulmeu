import React from 'react';
import { Cookie, SlidersHorizontal } from 'lucide-react';
import { LEGAL_CONFIG, type LegalRoutePath } from '../config/legalConfig.js';

interface CookieConsentBannerProps {
  visible: boolean;
  onAcceptAll: () => void;
  onRejectOptional: () => void;
  onCustomize: () => void;
  onNavigateLegal: (path: LegalRoutePath) => void;
}

export const CookieConsentBanner: React.FC<CookieConsentBannerProps> = ({
  visible,
  onAcceptAll,
  onRejectOptional,
  onCustomize,
  onNavigateLegal
}) => {
  if (!visible) return null;

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: LegalRoutePath) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigateLegal(path);
  };

  return (
    <aside
      role="region"
      aria-label="Preferințe privind cookie-urile și stocarea locală"
      data-testid="cookie-consent-banner"
      className="fixed inset-x-3 bottom-20 md:bottom-5 z-40 max-w-5xl mx-auto no-print animate-in fade-in slide-in-from-bottom-4 duration-200"
    >
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/98 dark:bg-slate-900/98 backdrop-blur-md shadow-2xl shadow-slate-900/15 dark:shadow-black/60 p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Cookie className="w-4 h-4" />
              </div>
              <h2 className="font-display text-sm sm:text-base font-bold tracking-tight">
                Cookie-uri și stocare locală pe Coșul Meu
              </h2>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 hidden sm:inline">
                v.{LEGAL_CONFIG.cookiePolicyVersion}
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
              Folosim mecanisme <strong>strict necesare</strong> pentru autentificare, listele tale și salvarea acestei alegeri. În prezent <strong>nu încărcăm trackere de analiză sau marketing</strong>, iar orice categorii opționale rămân dezactivate până la acordul tău explicit. Continuarea navigării nu reprezintă consimțământ. Consultă{' '}
              <a
                href="/politica-cookies"
                onClick={e => handleLinkClick(e, '/politica-cookies')}
                className="font-semibold text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-800 dark:hover:text-emerald-300"
              >
                Politica cookies
              </a>{' '}
              și{' '}
              <a
                href="/politica-de-confidentialitate"
                onClick={e => handleLinkClick(e, '/politica-de-confidentialitate')}
                className="font-semibold text-emerald-700 dark:text-emerald-400 underline hover:text-emerald-800 dark:hover:text-emerald-300"
              >
                Politica de confidențialitate
              </a>
              .
            </p>
          </div>

          {/* 3 butoane cu vizibilitate și accesibilitate egală (fără dark patterns) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex lg:flex-wrap items-stretch sm:items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRejectOptional}
              className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs sm:text-[13px] font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              Respinge opționalele
            </button>

            <button
              type="button"
              onClick={onCustomize}
              className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs sm:text-[13px] font-bold transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>Personalizează</span>
            </button>

            <button
              type="button"
              onClick={onAcceptAll}
              className="px-4 py-2.5 rounded-xl border border-emerald-700 dark:border-emerald-500 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-[13px] font-bold transition-colors cursor-pointer whitespace-nowrap"
            >
              Acceptă toate
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
