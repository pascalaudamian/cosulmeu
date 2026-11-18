import React from 'react';
import { ShieldCheck, ShoppingBasket } from 'lucide-react';
import { LEGAL_ROUTES, type LegalRoutePath } from '../config/legalConfig.js';

interface FooterProps {
  activeLegalRoute: LegalRoutePath | null;
  onNavigateLegal: (path: LegalRoutePath) => void;
  onNavigateHome: () => void;
  onOpenCookieSettings?: () => void;
  isAuthenticated: boolean;
}

const FOOTER_SECTIONS: Array<{
  id: 'cosul-meu' | 'informatii' | 'confidentialitate';
  heading: string;
}> = [
  { id: 'cosul-meu', heading: 'Coșul Meu' },
  { id: 'informatii', heading: 'Informații' },
  { id: 'confidentialitate', heading: 'Confidențialitate' }
];

export const Footer: React.FC<FooterProps> = ({
  activeLegalRoute,
  onNavigateLegal,
  onNavigateHome,
  onOpenCookieSettings,
  isAuthenticated
}) => {
  const currentYear = new Date().getFullYear();

  const handleLinkClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    path: LegalRoutePath
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onNavigateLegal(path);
  };

  const handleHomeClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    onNavigateHome();
  };

  return (
    <footer
      aria-label="Subsol pagină și informații legale"
      className="mt-auto border-t border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 no-print pb-24 md:pb-8 pt-9 sm:pt-10 transition-colors"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top grid: Brand summary + 3 legal/info columns */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-10 pb-8 border-b border-slate-200/75 dark:border-slate-800/90">
          {/* Brand Summary */}
          <div className="md:col-span-4 space-y-3">
            <a
              href="/"
              onClick={handleHomeClick}
              className="inline-flex items-center gap-2.5 group focus-visible:outline-emerald-600 rounded-lg"
            >
              <span className="w-8 h-8 rounded-lg bg-slate-900 dark:bg-emerald-600 group-hover:bg-emerald-700 flex items-center justify-center text-white transition-colors shrink-0">
                <ShoppingBasket className="w-4 h-4" />
              </span>
              <span className="font-display font-bold text-lg tracking-tight text-slate-900 dark:text-slate-100">
                Coșul<span className="text-emerald-600 dark:text-emerald-400">Meu</span>
              </span>
            </a>

            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-sm">
              Comparator independent de prețuri și oferte din România pentru cumpărăturile zilnice.
            </p>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400 pt-1">
              <span>RON (lei)</span>
              <span aria-hidden="true">·</span>
              <span>Europe/Bucharest</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                {isAuthenticated ? 'Date protejate în cont' : 'Date locale pe dispozitiv'}
              </span>
            </div>
          </div>

          {/* Link Sections */}
          <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-7 sm:gap-6">
            {FOOTER_SECTIONS.map(section => {
              const items = LEGAL_ROUTES.filter(route => route.section === section.id);
              return (
                <div key={section.id} className="space-y-2.5">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-200">
                    {section.heading}
                  </h2>
                  <ul className="space-y-1">
                    {items.map(route => {
                      const isActive = activeLegalRoute === route.path;
                      return (
                        <li key={route.path}>
                          <a
                            href={route.path}
                            onClick={e => handleLinkClick(e, route.path)}
                            aria-current={isActive ? 'page' : undefined}
                            className={`inline-flex items-center min-h-[34px] py-1 text-sm transition-colors rounded-md focus-visible:outline-emerald-600 ${
                              isActive
                                ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100'
                            }`}
                          >
                            {route.label}
                          </a>
                        </li>
                      );
                    })}
                    {section.id === 'confidentialitate' && onOpenCookieSettings && (
                      <li>
                        <button
                          type="button"
                          onClick={onOpenCookieSettings}
                          className="inline-flex items-center min-h-[34px] py-1 text-sm text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300 font-medium transition-colors rounded-md focus-visible:outline-emerald-600 cursor-pointer text-left"
                        >
                          Setări cookie-uri
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Copyright Row */}
        <div className="pt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs sm:text-[13px] text-slate-500 dark:text-slate-400">
          <p>© {currentYear} Coșul Meu. Toate drepturile rezervate.</p>
          <p className="text-slate-500 dark:text-slate-400">
            Informații cu caracter orientativ și comparativ.
          </p>
        </div>
      </div>
    </footer>
  );
};
